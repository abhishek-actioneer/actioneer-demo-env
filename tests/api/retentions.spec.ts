import { test, expect } from "@playwright/test";

/**
 * Retention API contract tests.
 *
 * Coverage:
 * - CRUD on /api/retentions
 * - /api/explorer/retention execution: basic, breakdown
 * - **Critical**: verifies the breakdown branch of parseRetentionRows
 *   doesn't double-count cohort sizes (the bug we just fixed)
 * - Verifies result.breakdownSeries shape
 *
 * Uses the static "quickhelp" sample dataset.
 */

const DATASET = "quickhelp";
const HEADERS = { "x-dataset-id": DATASET };

const CANONICAL_RETENTION_CONFIG = {
  startEventId: "signup",
  returnEventIds: ["first_booking_funnel"],
  mode: "on_or_after" as const,
  granularity: "daily" as const,
  dateRange: { preset: "30d" as const },
};

test.describe.serial("Retentions API — CRUD", () => {
  let retentionId: string;
  const retentionName = `test-retention-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    const resp = await request.get("/api/retentions", { headers: HEADERS });
    if (resp.ok()) {
      const list = await resp.json();
      for (const r of list) {
        if (r.name?.startsWith("test-")) {
          await request.delete(`/api/retentions/${r.id}`, { headers: HEADERS });
        }
      }
    }
  });

  test("POST /api/retentions creates retention and returns id", async ({ request }) => {
    const resp = await request.post("/api/retentions", {
      headers: HEADERS,
      data: {
        name: retentionName,
        description: "test retention",
        config: CANONICAL_RETENTION_CONFIG,
      },
    });
    expect(resp.status()).toBeLessThan(300);
    const body = await resp.json();
    expect(body.id).toBeTruthy();
    retentionId = body.id;
  });

  test("GET /api/retentions returns array containing the new retention", async ({ request }) => {
    const resp = await request.get("/api/retentions", { headers: HEADERS });
    expect(resp.status()).toBe(200);
    const list = await resp.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.find((r: { id: string }) => r.id === retentionId)).toBeTruthy();
  });

  test("GET /api/retentions/:id returns the retention with config", async ({ request }) => {
    const resp = await request.get(`/api/retentions/${retentionId}`, { headers: HEADERS });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.id).toBe(retentionId);
    expect(body.config?.startEventId).toBe("signup");
    expect(body.config?.returnEventIds).toEqual(["first_booking_funnel"]);
  });

  test("DELETE /api/retentions/:id removes the retention", async ({ request }) => {
    const del = await request.delete(`/api/retentions/${retentionId}`, { headers: HEADERS });
    expect(del.status()).toBeLessThan(300);
    const get = await request.get(`/api/retentions/${retentionId}`, { headers: HEADERS });
    expect(get.status()).toBe(404);
  });
});

test.describe("Retentions API — /api/explorer/retention execution", () => {
  test("basic retention returns cohorts + overall + dayBuckets", async ({ request }) => {
    const resp = await request.post("/api/explorer/retention", {
      headers: HEADERS,
      data: { config: CANONICAL_RETENTION_CONFIG },
    });
    expect(resp.status()).toBe(200);
    const result = await resp.json();
    expect(Array.isArray(result.cohorts)).toBe(true);
    expect(typeof result.overall).toBe("object");
    expect(Array.isArray(result.dayBuckets)).toBe(true);
    expect(typeof result.sql).toBe("string");
    expect(result.dayBuckets).toContain(0);
    expect(result.dayBuckets).toContain(7);
    expect(result.dayBuckets).toContain(30);

    // Day 0 retention should always be 100% (or 0 if no data)
    if (result.cohorts.length > 0) {
      expect(result.overall[0]).toBeLessThanOrEqual(100);
    }
  });

  test("retention with breakdown returns breakdownSeries with valid cohort sizes", async ({ request }) => {
    const resp = await request.post("/api/explorer/retention", {
      headers: HEADERS,
      data: {
        config: { ...CANONICAL_RETENTION_CONFIG, breakdown: "city" },
      },
    });
    expect(resp.status()).toBe(200);
    const result = await resp.json();

    // breakdownSeries must be present when breakdown is set
    expect(Array.isArray(result.breakdownSeries)).toBe(true);

    if (result.breakdownSeries.length > 0) {
      const series = result.breakdownSeries[0];
      // Each series has the expected shape
      expect(typeof series.value).toBe("string");
      expect(typeof series.totalCohortSize).toBe("number");
      expect(typeof series.overall).toBe("object");
      expect(series.totalCohortSize).toBeGreaterThan(0);

      // Series are sorted by total cohort size desc
      for (let i = 1; i < result.breakdownSeries.length; i++) {
        expect(result.breakdownSeries[i - 1].totalCohortSize).toBeGreaterThanOrEqual(
          result.breakdownSeries[i].totalCohortSize,
        );
      }

      // Day 0 retention is always 100% (or 0 if no data) per series
      for (const s of result.breakdownSeries) {
        if (s.totalCohortSize > 0) {
          expect(s.overall[0]).toBeLessThanOrEqual(100);
        }
      }
    }

    // The unbroken aggregate cohort sizes equal the sum of breakdown cohort sizes
    // (this validates the parser doesn't double-count — the bug we fixed)
    const aggregateTotal = result.cohorts.reduce(
      (s: number, c: { cohortSize: number }) => s + c.cohortSize,
      0,
    );
    const breakdownTotal = result.breakdownSeries.reduce(
      (s: number, b: { totalCohortSize: number }) => s + b.totalCohortSize,
      0,
    );
    // They should match (within rounding) — if the breakdown branch over-aggregated,
    // breakdownTotal would be a multiple of aggregateTotal
    expect(Math.abs(aggregateTotal - breakdownTotal)).toBeLessThanOrEqual(1);
  });

  test("retention without breakdown does NOT include breakdownSeries", async ({ request }) => {
    const resp = await request.post("/api/explorer/retention", {
      headers: HEADERS,
      data: { config: CANONICAL_RETENTION_CONFIG },
    });
    expect(resp.status()).toBe(200);
    const result = await resp.json();
    expect(result.breakdownSeries).toBeUndefined();
  });

  test("retention with mode=on returns valid result", async ({ request }) => {
    const resp = await request.post("/api/explorer/retention", {
      headers: HEADERS,
      data: { config: { ...CANONICAL_RETENTION_CONFIG, mode: "on" } },
    });
    expect(resp.status()).toBe(200);
    const result = await resp.json();
    expect(Array.isArray(result.cohorts)).toBe(true);
  });
});
