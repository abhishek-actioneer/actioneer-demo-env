/**
 * Unit tests for dataset ID validation and registry lookups.
 *
 * Covers:
 * - DEFAULT_DATASET is one of the registered static datasets
 * - getDataset(id) returns correct configs for known static IDs
 * - getDataset(id) behavior for unknown IDs (bug documented below)
 * - safeDatasetId-style validation logic (format: /^[a-z0-9-]+$/, max 64 chars)
 * - getDatasetForUser access control
 *
 * NOTE: validateDatasetId is NOT a named export anywhere in the codebase.
 * The CLAUDE.md describes it as exported from src/lib/datasets but this
 * function does not exist. Validation logic lives inline in
 * src/app/api/assets/generate/route.ts as a private `safeDatasetId` helper.
 * Tests below validate the DESCRIBED behavior using inline logic equivalent
 * to what exists in the codebase, and document the missing export as a bug.
 *
 * HARD CONSTRAINT: dynamic-registry uses Node.js `fs` at module load time.
 * We import from @/lib/datasets (which re-exports static configs only when
 * the dynamic datasets dir does not exist on disk), but we do NOT call
 * getDynamicDataset or getDynamicDatasets directly.
 */

import { describe, it, expect } from "vitest";
import { getDataset, getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { DEFAULT_DATASET as CONSTANTS_DEFAULT } from "@/lib/datasets/constants";
import { prestoDataset } from "@/lib/datasets/presto";
import { vastuHfcDataset } from "@/lib/datasets/vastu-hfc";
import { fundsindiaDataset } from "@/lib/datasets/fundsindia";

// The known static datasets registered in STATIC_DATASETS
const STATIC_IDS = ["vastu-hfc", "presto", "fundsindia"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_DATASET constants
// ─────────────────────────────────────────────────────────────────────────────

describe("DEFAULT_DATASET", () => {
  it("is a non-empty string", () => {
    expect(typeof DEFAULT_DATASET).toBe("string");
    expect(DEFAULT_DATASET.length).toBeGreaterThan(0);
  });

  it("matches the client-safe constant from datasets/constants.ts", () => {
    expect(DEFAULT_DATASET).toBe(CONSTANTS_DEFAULT);
  });

  it("is one of the registered static dataset IDs", () => {
    expect(STATIC_IDS).toContain(DEFAULT_DATASET as typeof STATIC_IDS[number]);
  });

  it("satisfies the dataset ID format: /^[a-z0-9-]+$/ with max 64 chars", () => {
    expect(/^[a-z0-9-]+$/.test(DEFAULT_DATASET)).toBe(true);
    expect(DEFAULT_DATASET.length).toBeLessThanOrEqual(64);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDataset — happy path for known static IDs
// ─────────────────────────────────────────────────────────────────────────────

describe("getDataset — known static datasets", () => {
  it("returns the vastu-hfc dataset config", () => {
    const ds = getDataset("vastu-hfc");
    expect(ds.id).toBe("vastu-hfc");
    expect(ds.label).toBe("Banking & Lending");
    expect(ds.currency).toBe("₹");
    expect(ds.entityName).toBe("borrowers");
  });

  it("returns the presto dataset config", () => {
    const ds = getDataset("presto");
    expect(ds.id).toBe("presto");
    expect(ds.label).toBe("Consumer Apps & Gaming");
    expect(ds.currency).toBe("$");
    expect(ds.entityName).toBe("players");
  });

  it("returns the fundsindia dataset config", () => {
    const ds = getDataset("fundsindia");
    expect(ds.id).toBe("fundsindia");
    expect(ds.label).toBe("Wealth & AMC");
    expect(ds.currency).toBe("₹");
    expect(ds.entityName).toBe("investors");
  });

  it("returned config has a non-empty schemaContext", () => {
    for (const id of STATIC_IDS) {
      const ds = getDataset(id);
      expect(typeof ds.schemaContext).toBe("string");
      expect(ds.schemaContext.length).toBeGreaterThan(50);
    }
  });

  it("returned config has a non-empty systemContext", () => {
    for (const id of STATIC_IDS) {
      const ds = getDataset(id);
      expect(typeof ds.systemContext).toBe("string");
      expect(ds.systemContext.length).toBeGreaterThan(50);
    }
  });

  it("returned config id matches the requested id", () => {
    for (const id of STATIC_IDS) {
      const ds = getDataset(id);
      expect(ds.id).toBe(id);
    }
  });

  it("returned config has a primaryTable", () => {
    for (const id of STATIC_IDS) {
      const ds = getDataset(id);
      expect(typeof ds.primaryTable).toBe("string");
      expect(ds.primaryTable.length).toBeGreaterThan(0);
    }
  });

  it("each static dataset exports a config that matches what getDataset returns", () => {
    expect(getDataset("vastu-hfc")).toBe(vastuHfcDataset);
    expect(getDataset("presto")).toBe(prestoDataset);
    expect(getDataset("fundsindia")).toBe(fundsindiaDataset);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDataset — unknown ID behavior (BUG DOCUMENTED)
// ─────────────────────────────────────────────────────────────────────────────

describe("getDataset — unknown dataset ID", () => {
  /**
   * BUG REPORT: getDataset does NOT throw for unknown dataset IDs.
   *
   * CLAUDE.md states: "getDataset(id) throws on an unknown id (no silent fallback)"
   * The actual implementation in src/lib/datasets/index.ts:
   *
   *   if (STATIC_DATASETS[id]) return STATIC_DATASETS[id];
   *   const dynamic = getDynamicDataset(id);
   *   if (dynamic) return dynamic;
   *   // Fall back to default instead of throwing — handles stale localStorage values
   *   const fallback = STATIC_DATASETS[DEFAULT_DATASET];
   *   if (fallback) return fallback;
   *   throw new Error(`[getDataset] unknown dataset: "${id}"`);
   *
   * The throw is only reached if DEFAULT_DATASET itself is not in STATIC_DATASETS,
   * which never happens in practice. For any unknown id, the function silently
   * returns the DEFAULT_DATASET config.
   *
   * The test below documents the ACTUAL (buggy) behavior. If this test starts
   * failing (i.e. the function starts throwing), the bug has been fixed and
   * this test should be updated to `expect(() => getDataset(...)).toThrow(...)`.
   */
  it("BUG: silently falls back to DEFAULT_DATASET for unknown ids instead of throwing", () => {
    const result = getDataset("completely-unknown-id-xyz-123");
    // Documents current behavior: returns the fallback dataset, NOT a throw
    expect(result.id).toBe(DEFAULT_DATASET);
  });

  it("BUG: silent fallback means getDataset result id != requested id for unknown ids", () => {
    const unknownId = "nonexistent-dataset-abc";
    const result = getDataset(unknownId);
    expect(result.id).not.toBe(unknownId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dataset ID format validation (mirrors the safeDatasetId logic from the codebase)
// The CLAUDE.md describes this as validateDatasetId — it does not exist as a
// named export, but the format rules are described and partially implemented.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * This helper mirrors the inline `safeDatasetId` from
 * src/app/api/assets/generate/route.ts. It is the ONLY place in the codebase
 * that enforces the /^[a-z0-9-]+$/ + max-64-char rules.
 *
 * BUG REPORT: validateDatasetId is not exported from @/lib/datasets or anywhere
 * in src/lib. The CLAUDE.md convention describes it as a shared utility but it
 * is only implemented inline in one API route. Any other route that validates
 * dataset IDs must duplicate this logic (or skip validation entirely, which many
 * routes do — falling back to DEFAULT_DATASET silently instead).
 */
function safeDatasetId(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_DATASET;
  if (!/^[a-z0-9-]+$/.test(raw) || raw.length > 64) return DEFAULT_DATASET;
  return raw;
}

describe("dataset ID format validation (safeDatasetId rules)", () => {
  it("accepts a valid lowercase id like vastu-hfc", () => {
    expect(safeDatasetId("vastu-hfc")).toBe("vastu-hfc");
  });

  it("accepts a valid lowercase id like presto", () => {
    expect(safeDatasetId("presto")).toBe("presto");
  });

  it("accepts a valid lowercase id with numbers like dataset-123", () => {
    expect(safeDatasetId("dataset-123")).toBe("dataset-123");
  });

  it("accepts a 64-character id (boundary: max allowed)", () => {
    const maxLen = "a".repeat(64);
    expect(safeDatasetId(maxLen)).toBe(maxLen);
  });

  it("rejects a 65-character id (boundary: one over max) and returns DEFAULT", () => {
    const tooLong = "a".repeat(65);
    expect(safeDatasetId(tooLong)).toBe(DEFAULT_DATASET);
  });

  it("rejects uppercase characters and returns DEFAULT", () => {
    expect(safeDatasetId("MyDataset")).toBe(DEFAULT_DATASET);
  });

  it("rejects mixed-case id and returns DEFAULT", () => {
    expect(safeDatasetId("Vastu-HFC")).toBe(DEFAULT_DATASET);
  });

  it("rejects id with underscore and returns DEFAULT", () => {
    expect(safeDatasetId("vastu_hfc")).toBe(DEFAULT_DATASET);
  });

  it("rejects id with spaces and returns DEFAULT", () => {
    expect(safeDatasetId("vastu hfc")).toBe(DEFAULT_DATASET);
  });

  it("rejects id with special SQL characters and returns DEFAULT", () => {
    expect(safeDatasetId("vastu'; DROP TABLE--")).toBe(DEFAULT_DATASET);
  });

  it("rejects id with dot and returns DEFAULT", () => {
    expect(safeDatasetId("vastu.hfc")).toBe(DEFAULT_DATASET);
  });

  it("rejects id with slash and returns DEFAULT", () => {
    expect(safeDatasetId("vastu/hfc")).toBe(DEFAULT_DATASET);
  });

  it("rejects id with unicode / emoji and returns DEFAULT", () => {
    expect(safeDatasetId("vastu-hfc-\u{1F600}")).toBe(DEFAULT_DATASET);
  });

  it("rejects empty string and returns DEFAULT", () => {
    expect(safeDatasetId("")).toBe(DEFAULT_DATASET);
  });

  it("rejects null and returns DEFAULT", () => {
    expect(safeDatasetId(null)).toBe(DEFAULT_DATASET);
  });

  it("rejects undefined and returns DEFAULT", () => {
    expect(safeDatasetId(undefined)).toBe(DEFAULT_DATASET);
  });

  it("accepts all three static dataset IDs as valid", () => {
    for (const id of STATIC_IDS) {
      expect(safeDatasetId(id)).toBe(id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDatasetForUser — access control
// ─────────────────────────────────────────────────────────────────────────────

describe("getDatasetForUser", () => {
  const userId = "user_test_abc123";

  it("returns the vastu-hfc dataset for any userId (static sample)", () => {
    const ds = getDatasetForUser("vastu-hfc", userId);
    expect(ds).not.toBeNull();
    expect(ds!.id).toBe("vastu-hfc");
  });

  it("returns the presto dataset for any userId (static sample)", () => {
    const ds = getDatasetForUser("presto", userId);
    expect(ds).not.toBeNull();
    expect(ds!.id).toBe("presto");
  });

  it("returns the fundsindia dataset for any userId (static sample)", () => {
    const ds = getDatasetForUser("fundsindia", userId);
    expect(ds).not.toBeNull();
    expect(ds!.id).toBe("fundsindia");
  });

  it("returns null for a completely unknown id (no silent fallback to default)", () => {
    // getDatasetForUser has an id-mismatch check that catches the silent fallback
    const result = getDatasetForUser("does-not-exist-xyz", userId);
    expect(result).toBeNull();
  });
});
