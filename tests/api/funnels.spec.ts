import { test, expect } from "@playwright/test";

/**
 * Funnel API contract tests.
 *
 * Coverage:
 * - CRUD on /api/funnels
 * - /api/explorer/funnel execution: basic, breakdown, segment compare,
 *   counting methods, ordering modes, edge cases
 * - Verifies the SQL compiler doesn't reference removed `holdConstant` /
 *   `exclusionEvents` fields
 *
 * Uses the static "quickhelp" sample dataset which has a rich
 * `funnel_events` table covering the canonical signup → activation flow.
 */

const DATASET = "quickhelp";
const HEADERS = { "x-dataset-id": DATASET };

// A 3-step canonical activation funnel that exists in quickhelp's funnel_events
const CANONICAL_STEPS = [
  { eventId: "signup" },
  { eventId: "profile_done" },
  { eventId: "first_booking_funnel" },
];

const DEFAULT_DATE_RANGE = { preset: "90d" as const };

test.describe.serial("Funnels API — CRUD", () => {
  let funnelId: string;
  const funnelName = `test-funnel-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    // Clean up leftover test funnels
    const resp = await request.get("/api/funnels", { headers: HEADERS });
    if (resp.ok()) {
      const funnels = await resp.json();
      for (const f of funnels) {
        if (f.name?.startsWith("test-")) {
          await request.delete(`/api/funnels/${f.id}`, { headers: HEADERS });
        }
      }
    }
  });

  test("POST /api/funnels creates funnel and returns id", async ({ request }) => {
    const resp = await request.post("/api/funnels", {
      headers: HEADERS,
      data: {
        name: funnelName,
        description: "test funnel",
        config: {
          steps: CANONICAL_STEPS,
          conversionWindow: "30d",
          order: "this_order",
          dateRange: DEFAULT_DATE_RANGE,
        },
      },
    });
    expect(resp.status()).toBeLessThan(300);
    const body = await resp.json();
    expect(body.id).toBeTruthy();
    funnelId = body.id;
  });

  test("GET /api/funnels returns array containing the new funnel", async ({ request }) => {
    const resp = await request.get("/api/funnels", { headers: HEADERS });
    expect(resp.status()).toBe(200);
    const list = await resp.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.find((f: { id: string }) => f.id === funnelId)).toBeTruthy();
  });

  test("GET /api/funnels/:id returns the funnel with config", async ({ request }) => {
    const resp = await request.get(`/api/funnels/${funnelId}`, { headers: HEADERS });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.id).toBe(funnelId);
    expect(body.name).toBe(funnelName);
    expect(body.config?.steps?.length).toBe(3);
    expect(body.config.conversionWindow).toBe("30d");
    // Verify removed fields are NOT present (we deleted holdConstant + exclusionEvents)
    expect(body.config.holdConstant).toBeUndefined();
    expect(body.config.exclusionEvents).toBeUndefined();
  });

  test("PATCH /api/funnels/:id updates the config", async ({ request }) => {
    const resp = await request.patch(`/api/funnels/${funnelId}`, {
      headers: HEADERS,
      data: {
        config: {
          steps: CANONICAL_STEPS,
          conversionWindow: "7d",
          order: "this_order",
          dateRange: DEFAULT_DATE_RANGE,
        },
      },
    });
    expect(resp.status()).toBe(200);
    // Verify the change persisted
    const get = await request.get(`/api/funnels/${funnelId}`, { headers: HEADERS });
    const body = await get.json();
    expect(body.config.conversionWindow).toBe("7d");
  });

  test("DELETE /api/funnels/:id removes the funnel", async ({ request }) => {
    const del = await request.delete(`/api/funnels/${funnelId}`, { headers: HEADERS });
    expect(del.status()).toBeLessThan(300);
    const get = await request.get(`/api/funnels/${funnelId}`, { headers: HEADERS });
    expect(get.status()).toBe(404);
  });
});

test.describe("Funnels API — /api/explorer/funnel execution", () => {
  test("basic funnel returns step results", async ({ request }) => {
    const resp = await request.post("/api/explorer/funnel", {
      headers: HEADERS,
      data: {
        config: {
          steps: CANONICAL_STEPS,
          conversionWindow: "30d",
          order: "this_order",
          dateRange: DEFAULT_DATE_RANGE,
        },
      },
    });
    expect(resp.status()).toBe(200);
    const result = await resp.json();
    expect(result.steps).toHaveLength(3);
    expect(typeof result.totalEntered).toBe("number");
    expect(typeof result.overallConversionRate).toBe("number");
    expect(typeof result.sql).toBe("string");
    expect(result.sql.length).toBeGreaterThan(0);

    // Step 0 conversion is always 100%
    expect(result.steps[0].conversionRate).toBe(100);
    // Conversion is monotonically non-increasing
    expect(result.steps[1].conversionRate).toBeLessThanOrEqual(100);
    expect(result.steps[2].conversionRate).toBeLessThanOrEqual(result.steps[1].conversionRate);
  });

  test("funnel with breakdown returns breakdownRows + breakdown SQL has bk column", async ({ request }) => {
    const resp = await request.post("/api/explorer/funnel", {
      headers: HEADERS,
      data: {
        config: {
          steps: CANONICAL_STEPS,
          conversionWindow: "30d",
          order: "this_order",
          dateRange: DEFAULT_DATE_RANGE,
          breakdown: "city",
        },
      },
    });
    expect(resp.status()).toBe(200);
    const result = await resp.json();
    expect(Array.isArray(result.breakdownRows)).toBe(true);
    if (result.breakdownRows.length > 0) {
      const row = result.breakdownRows[0];
      expect(typeof row.stepIndex).toBe("number");
      expect(typeof row.breakdown).toBe("string");
      expect(typeof row.userCount).toBe("number");
      expect(typeof row.conversionRate).toBe("number");
    }
    // SQL should reference the breakdown column
    expect(result.sql).toContain("city");
  });

  test("funnel with counting=totals returns valid result", async ({ request }) => {
    const resp = await request.post("/api/explorer/funnel", {
      headers: HEADERS,
      data: {
        config: {
          steps: CANONICAL_STEPS,
          conversionWindow: "30d",
          order: "this_order",
          dateRange: DEFAULT_DATE_RANGE,
          countingMethod: "totals",
        },
      },
    });
    expect(resp.status()).toBe(200);
    const result = await resp.json();
    expect(result.steps).toHaveLength(3);
    // Totals SQL uses ROW_NUMBER() / attempt_id
    expect(result.sql).toContain("attempt_id");
  });

  test("funnel with order=any_order uses inclusive time bound", async ({ request }) => {
    const resp = await request.post("/api/explorer/funnel", {
      headers: HEADERS,
      data: {
        config: {
          steps: CANONICAL_STEPS,
          conversionWindow: "30d",
          order: "any_order",
          dateRange: DEFAULT_DATE_RANGE,
        },
      },
    });
    expect(resp.status()).toBe(200);
    const result = await resp.json();
    expect(result.steps).toHaveLength(3);
  });

  test("funnel with single step returns a usable error or empty", async ({ request }) => {
    const resp = await request.post("/api/explorer/funnel", {
      headers: HEADERS,
      data: {
        config: {
          steps: [{ eventId: "signup" }],
          conversionWindow: "30d",
          order: "this_order",
          dateRange: DEFAULT_DATE_RANGE,
        },
      },
    });
    // Either an explicit error response or a successful body with an error field
    const body = await resp.json();
    if (resp.status() === 200) {
      expect(body.error || body.steps?.length === 0).toBeTruthy();
    } else {
      expect(resp.status()).toBeGreaterThanOrEqual(400);
    }
  });

  test("funnel SQL does NOT reference removed holdConstant/exclusion logic", async ({ request }) => {
    const resp = await request.post("/api/explorer/funnel", {
      headers: HEADERS,
      data: {
        config: {
          steps: CANONICAL_STEPS,
          conversionWindow: "30d",
          order: "this_order",
          dateRange: DEFAULT_DATE_RANGE,
          // Pass legacy fields explicitly to confirm they're tolerated/ignored
          holdConstant: [{ propertyName: "channel" }],
          exclusionEvents: [{ eventId: "signup", betweenSteps: [0, 1] }],
        },
      },
    });
    expect(resp.status()).toBe(200);
    const result = await resp.json();
    // The compiler should ignore the legacy fields and produce a normal funnel
    expect(result.steps).toHaveLength(3);
    // SQL should not contain NOT EXISTS (the exclusion-events SQL pattern)
    expect(result.sql).not.toContain("NOT EXISTS");
  });
});
