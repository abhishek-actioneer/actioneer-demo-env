/**
 * Unit tests for src/lib/schema.ts
 *
 * Covers getSystemContext(datasetId):
 * - Returns a non-empty, domain-appropriate persona string for each known static dataset
 * - Differs meaningfully between datasets
 * - Appends the ASSISTANT_IDENTITY_GUARD to every context
 * - Does NOT silently default to ecommerce when datasetId is provided
 * - getSchemaContext still falls back (it has an optional param) — we document that behavior
 *
 * NOTE: Dynamic-registry is NOT called here. We only test static datasets whose
 * configs are bundled without fs I/O. The dynamic-registry uses Node fs at module
 * load time; tests that touch it would race with or lock the running dev server's
 * DuckDB files. This suite is pure-function only.
 */

import { describe, it, expect } from "vitest";
import { getSystemContext, getSchemaContext } from "@/lib/schema";
import { ASSISTANT_IDENTITY_GUARD } from "@/lib/assistant-identity";

// The three static datasets registered in STATIC_DATASETS in src/lib/datasets/index.ts
const KNOWN_DATASET_IDS = ["vastu-hfc", "presto", "fundsindia"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// getSystemContext — per-dataset tests
// ─────────────────────────────────────────────────────────────────────────────

describe("getSystemContext", () => {
  it("returns a non-empty string for vastu-hfc", () => {
    const ctx = getSystemContext("vastu-hfc");
    expect(typeof ctx).toBe("string");
    expect(ctx.length).toBeGreaterThan(50);
  });

  it("returns a non-empty string for presto", () => {
    const ctx = getSystemContext("presto");
    expect(typeof ctx).toBe("string");
    expect(ctx.length).toBeGreaterThan(50);
  });

  it("returns a non-empty string for fundsindia", () => {
    const ctx = getSystemContext("fundsindia");
    expect(typeof ctx).toBe("string");
    expect(ctx.length).toBeGreaterThan(50);
  });

  it("vastu-hfc context mentions housing/lending domain", () => {
    const ctx = getSystemContext("vastu-hfc");
    // Should reference the housing finance / HFC domain
    expect(ctx.toLowerCase()).toMatch(/housing|lending|loan|hfc|finance/);
  });

  it("presto context mentions mobile/gaming domain", () => {
    const ctx = getSystemContext("presto");
    expect(ctx.toLowerCase()).toMatch(/game|mobile|player|install|ua|presto/);
  });

  it("fundsindia context mentions wealth/investment domain", () => {
    const ctx = getSystemContext("fundsindia");
    expect(ctx.toLowerCase()).toMatch(/investor|sip|fund|mutual|investment|wealth/);
  });

  it("vastu-hfc and presto contexts differ substantially", () => {
    const vastuCtx = getSystemContext("vastu-hfc");
    const prestoCtx = getSystemContext("presto");
    // They share the identity guard but the domain content should differ
    expect(vastuCtx).not.toBe(prestoCtx);
    // The first 200 chars should differ (the domain-specific part)
    expect(vastuCtx.slice(0, 200)).not.toBe(prestoCtx.slice(0, 200));
  });

  it("presto and fundsindia contexts differ substantially", () => {
    const prestoCtx = getSystemContext("presto");
    const fundsindiaCtx = getSystemContext("fundsindia");
    expect(prestoCtx).not.toBe(fundsindiaCtx);
    expect(prestoCtx.slice(0, 200)).not.toBe(fundsindiaCtx.slice(0, 200));
  });

  it("vastu-hfc and fundsindia contexts differ substantially", () => {
    const vastuCtx = getSystemContext("vastu-hfc");
    const fundsindiaCtx = getSystemContext("fundsindia");
    expect(vastuCtx).not.toBe(fundsindiaCtx);
  });

  it("all known datasets produce distinct system contexts", () => {
    const contexts = KNOWN_DATASET_IDS.map((id) => getSystemContext(id));
    const unique = new Set(contexts);
    expect(unique.size).toBe(KNOWN_DATASET_IDS.length);
  });

  it("appends ASSISTANT_IDENTITY_GUARD to every context", () => {
    for (const id of KNOWN_DATASET_IDS) {
      const ctx = getSystemContext(id);
      expect(ctx).toContain(ASSISTANT_IDENTITY_GUARD);
    }
  });

  it("ASSISTANT_IDENTITY_GUARD appears at the end of every context", () => {
    for (const id of KNOWN_DATASET_IDS) {
      const ctx = getSystemContext(id);
      expect(ctx.trimEnd().endsWith(ASSISTANT_IDENTITY_GUARD.trimEnd())).toBe(true);
    }
  });

  /**
   * BUG REPORT: getSystemContext has a runtime silent-fallback.
   *
   * The signature is `getSystemContext(datasetId: string)` — datasetId looks
   * required. But the first line is:
   *   `const id = datasetId || DEFAULT_DATASET;`
   * This means passing an empty string "" silently returns the DEFAULT_DATASET
   * context instead of the context for the supplied argument.
   *
   * The test below documents the ACTUAL (buggy) behavior so it will turn red
   * if the bug is ever fixed: at that point the test should be updated to assert
   * that an empty string throws or returns an error.
   */
  it("BUG: empty string silently falls back to DEFAULT_DATASET context (documents current behavior)", () => {
    const emptyCtx = getSystemContext("");
    const defaultCtx = getSystemContext("vastu-hfc"); // DEFAULT_DATASET = "vastu-hfc"
    // Currently they ARE equal due to the `|| DEFAULT_DATASET` guard
    expect(emptyCtx).toBe(defaultCtx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSchemaContext — supplementary coverage (optional datasetId)
// ─────────────────────────────────────────────────────────────────────────────

describe("getSchemaContext", () => {
  it("returns a non-empty schema string for vastu-hfc", () => {
    const schema = getSchemaContext("vastu-hfc");
    expect(typeof schema).toBe("string");
    expect(schema.length).toBeGreaterThan(100);
  });

  it("returns a non-empty schema string for presto", () => {
    const schema = getSchemaContext("presto");
    expect(typeof schema).toBe("string");
    expect(schema.length).toBeGreaterThan(100);
  });

  it("returns a non-empty schema string for fundsindia", () => {
    const schema = getSchemaContext("fundsindia");
    expect(typeof schema).toBe("string");
    expect(schema.length).toBeGreaterThan(100);
  });

  it("schemas differ between datasets", () => {
    const schemas = KNOWN_DATASET_IDS.map((id) => getSchemaContext(id));
    const unique = new Set(schemas);
    expect(unique.size).toBe(KNOWN_DATASET_IDS.length);
  });

  it("vastu-hfc schema mentions loan/borrower columns", () => {
    const schema = getSchemaContext("vastu-hfc");
    expect(schema.toLowerCase()).toMatch(/loan|borrower|disburs/);
  });

  it("presto schema mentions install/session tables", () => {
    const schema = getSchemaContext("presto");
    expect(schema.toLowerCase()).toMatch(/install|session|channel/);
  });
});
