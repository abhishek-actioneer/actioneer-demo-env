/**
 * Unit tests for deterministic prompt assembly in src/lib/prompts/sql.ts.
 *
 * We test ONLY the string assembly — no LLM calls, no DuckDB singleton.
 * buildTextToSqlPrompt and buildSegmentSqlPrompt are pure functions:
 * they read dataset config (static, in-memory) and return a string.
 *
 * HARD CONSTRAINT: we never import src/lib/db.ts or open any .duckdb file.
 * All imports ultimately resolve through static dataset configs and the
 * synthetic plan registry (also in-memory).
 */

import { describe, it, expect } from "vitest";
import {
  buildTextToSqlPrompt,
  buildSegmentSqlPrompt,
  OUTPUT_SQL_ONLY,
} from "@/lib/prompts/sql";
import { getDataset } from "@/lib/datasets";

const STATIC_IDS = ["vastu-hfc", "presto", "fundsindia"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT_SQL_ONLY constant
// ─────────────────────────────────────────────────────────────────────────────

describe("OUTPUT_SQL_ONLY", () => {
  it("is a non-empty string", () => {
    expect(typeof OUTPUT_SQL_ONLY).toBe("string");
    expect(OUTPUT_SQL_ONLY.length).toBeGreaterThan(0);
  });

  it("mentions DuckDB SQL", () => {
    expect(OUTPUT_SQL_ONLY.toLowerCase()).toContain("sql");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTextToSqlPrompt — schema context injection
// ─────────────────────────────────────────────────────────────────────────────

describe("buildTextToSqlPrompt — schema context", () => {
  it("returns a non-empty string for vastu-hfc", () => {
    const prompt = buildTextToSqlPrompt("vastu-hfc");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(200);
  });

  it("returns a non-empty string for presto", () => {
    const prompt = buildTextToSqlPrompt("presto");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(200);
  });

  it("returns a non-empty string for fundsindia", () => {
    const prompt = buildTextToSqlPrompt("fundsindia");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(200);
  });

  it("injects the dataset label into the prompt", () => {
    for (const id of STATIC_IDS) {
      const ds = getDataset(id);
      const prompt = buildTextToSqlPrompt(id);
      expect(prompt).toContain(ds.label);
    }
  });

  it("injects schema context from getSchemaContext into the prompt", () => {
    // The schema context for vastu-hfc mentions the loans_full view
    const prompt = buildTextToSqlPrompt("vastu-hfc");
    expect(prompt.toLowerCase()).toMatch(/loans_full|borrower/);
  });

  it("injects presto schema context (installs table)", () => {
    const prompt = buildTextToSqlPrompt("presto");
    expect(prompt.toLowerCase()).toMatch(/installs|session/);
  });

  it("injects fundsindia schema context (transactions/investor)", () => {
    const prompt = buildTextToSqlPrompt("fundsindia");
    expect(prompt.toLowerCase()).toMatch(/transaction|investor|sip/);
  });

  it("prompts differ between datasets (schema injection is per-dataset)", () => {
    const prompts = STATIC_IDS.map((id) => buildTextToSqlPrompt(id));
    const unique = new Set(prompts);
    expect(unique.size).toBe(STATIC_IDS.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTextToSqlPrompt — MEMORY CONSTRAINTS section
// ─────────────────────────────────────────────────────────────────────────────

describe("buildTextToSqlPrompt — MEMORY CONSTRAINTS section", () => {
  it("includes the MEMORY CONSTRAINTS heading for vastu-hfc", () => {
    const prompt = buildTextToSqlPrompt("vastu-hfc");
    expect(prompt).toContain("MEMORY CONSTRAINTS");
  });

  it("includes the MEMORY CONSTRAINTS heading for presto", () => {
    const prompt = buildTextToSqlPrompt("presto");
    expect(prompt).toContain("MEMORY CONSTRAINTS");
  });

  it("includes the MEMORY CONSTRAINTS heading for fundsindia", () => {
    const prompt = buildTextToSqlPrompt("fundsindia");
    expect(prompt).toContain("MEMORY CONSTRAINTS");
  });

  it("mentions pushing WHERE filters before joins", () => {
    // This rule appears in all prompts as a memory optimization instruction
    for (const id of STATIC_IDS) {
      const prompt = buildTextToSqlPrompt(id);
      expect(prompt.toLowerCase()).toMatch(/where.*filter.*join|filter.*before.*join/);
    }
  });

  it("references a memory limit in the MEMORY CONSTRAINTS section", () => {
    // Default is 4GB when DUCKDB_MEMORY_LIMIT env is unset
    for (const id of STATIC_IDS) {
      const prompt = buildTextToSqlPrompt(id);
      expect(prompt).toMatch(/\dGB|\d+ memory/i);
    }
  });

  it("warns about high-cardinality GROUP BY", () => {
    for (const id of STATIC_IDS) {
      const prompt = buildTextToSqlPrompt(id);
      expect(prompt.toLowerCase()).toMatch(/group by.*high.cardinality|cardinality/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTextToSqlPrompt — domain hints injection
// ─────────────────────────────────────────────────────────────────────────────

describe("buildTextToSqlPrompt — domain hints", () => {
  it("injects vastu-hfc domain hints (TWO-BOOK STRUCTURE rule)", () => {
    const prompt = buildTextToSqlPrompt("vastu-hfc");
    // vastu-hfc domainHints start with rule 6 about two-book structure
    expect(prompt).toContain("TWO-BOOK STRUCTURE");
  });

  it("injects presto domain hints (CPI / revenue vocabulary)", () => {
    const prompt = buildTextToSqlPrompt("presto");
    expect(prompt.toLowerCase()).toMatch(/cpi|revenue vocabulary|ltv|roas/);
  });

  it("injects fundsindia domain hints (purchase cohort / SIP rules)", () => {
    const prompt = buildTextToSqlPrompt("fundsindia");
    expect(prompt).toMatch(/PURCHASE COHORTS|AS-OF DATE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTextToSqlPrompt — OUTPUT_SQL_ONLY rule is embedded
// ─────────────────────────────────────────────────────────────────────────────

describe("buildTextToSqlPrompt — output rules", () => {
  it("embeds OUTPUT_SQL_ONLY inside the prompt", () => {
    for (const id of STATIC_IDS) {
      const prompt = buildTextToSqlPrompt(id);
      expect(prompt).toContain(OUTPUT_SQL_ONLY);
    }
  });

  it("includes a LIMIT 500 rows rule", () => {
    for (const id of STATIC_IDS) {
      const prompt = buildTextToSqlPrompt(id);
      expect(prompt).toMatch(/LIMIT.*500|500.*rows/i);
    }
  });

  it("mentions DuckDB SQL dialect", () => {
    for (const id of STATIC_IDS) {
      const prompt = buildTextToSqlPrompt(id);
      expect(prompt.toLowerCase()).toContain("duckdb");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTextToSqlPrompt — dateRangeOverride option
// ─────────────────────────────────────────────────────────────────────────────

describe("buildTextToSqlPrompt — dateRangeOverride option", () => {
  it("inserts the override date range into the prompt when provided", () => {
    const override = "2025-01-01 to 2025-12-31";
    const prompt = buildTextToSqlPrompt("vastu-hfc", { dateRangeOverride: override });
    expect(prompt).toContain(override);
  });

  it("without override, uses the dataset's configured date range", () => {
    const ds = getDataset("vastu-hfc");
    const prompt = buildTextToSqlPrompt("vastu-hfc");
    if (ds.dateRange) {
      expect(prompt).toContain(ds.dateRange.start);
      expect(prompt).toContain(ds.dateRange.end);
    }
  });

  it("with override, adds a WHERE clause instruction for the override range", () => {
    const override = "2024-06-01 to 2024-12-31";
    const prompt = buildTextToSqlPrompt("presto", { dateRangeOverride: override });
    // The override path adds "You MUST add a WHERE clause"
    expect(prompt.toLowerCase()).toMatch(/where clause|must.*filter/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSegmentSqlPrompt — schema context and key rules
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSegmentSqlPrompt — structure and schema injection", () => {
  it("returns a non-empty string for vastu-hfc", () => {
    const prompt = buildSegmentSqlPrompt("vastu-hfc");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(200);
  });

  it("returns a non-empty string for presto", () => {
    const prompt = buildSegmentSqlPrompt("presto");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(200);
  });

  it("returns a non-empty string for fundsindia", () => {
    const prompt = buildSegmentSqlPrompt("fundsindia");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(200);
  });

  it("injects schema context for vastu-hfc (loans table present)", () => {
    const prompt = buildSegmentSqlPrompt("vastu-hfc");
    expect(prompt.toLowerCase()).toMatch(/loans_full|borrower/);
  });

  it("injects schema context for presto (installs table present)", () => {
    const prompt = buildSegmentSqlPrompt("presto");
    expect(prompt.toLowerCase()).toMatch(/installs|user_id/);
  });

  it("requires JSON output format with name and sql fields", () => {
    for (const id of STATIC_IDS) {
      const prompt = buildSegmentSqlPrompt(id);
      expect(prompt).toContain('"name"');
      expect(prompt).toContain('"sql"');
    }
  });

  it("instructs to use primaryTable for segment queries", () => {
    for (const id of STATIC_IDS) {
      const ds = getDataset(id);
      const prompt = buildSegmentSqlPrompt(id);
      expect(prompt).toContain(ds.primaryTable);
    }
  });

  it("includes MEMORY CONSTRAINTS section", () => {
    for (const id of STATIC_IDS) {
      const prompt = buildSegmentSqlPrompt(id);
      expect(prompt).toContain("MEMORY CONSTRAINTS");
    }
  });

  it("includes the userIdField for vastu-hfc (borrower_id)", () => {
    const prompt = buildSegmentSqlPrompt("vastu-hfc");
    expect(prompt).toContain("borrower_id");
  });

  it("includes the userIdField for presto (user_id)", () => {
    const prompt = buildSegmentSqlPrompt("presto");
    expect(prompt).toContain("user_id");
  });

  it("instructs to use SELECT DISTINCT to avoid duplicates", () => {
    for (const id of STATIC_IDS) {
      const prompt = buildSegmentSqlPrompt(id);
      expect(prompt.toLowerCase()).toMatch(/select distinct/);
    }
  });

  it("explicitly prohibits a LIMIT clause in segments (segments must capture all users)", () => {
    for (const id of STATIC_IDS) {
      const prompt = buildSegmentSqlPrompt(id);
      expect(prompt.toLowerCase()).toMatch(/no limit|do not add.*limit|not add a limit/i);
    }
  });

  it("mentions UNSUPPORTED_QUERY as the fallback response", () => {
    for (const id of STATIC_IDS) {
      const prompt = buildSegmentSqlPrompt(id);
      expect(prompt).toContain("UNSUPPORTED_QUERY");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSegmentSqlPrompt — dataset-specific entityName / currency presence
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSegmentSqlPrompt — dataset-specific hints", () => {
  it("vastu-hfc prompt references the INR currency in date range context", () => {
    // domainHints for vastu-hfc contains INR currency references
    const prompt = buildSegmentSqlPrompt("vastu-hfc");
    // The schema mentions ₹ / INR via the injected schema context
    expect(prompt).toMatch(/INR|₹|inr/);
  });

  it("prompts differ between datasets", () => {
    const prompts = STATIC_IDS.map((id) => buildSegmentSqlPrompt(id));
    const unique = new Set(prompts);
    expect(unique.size).toBe(STATIC_IDS.length);
  });
});
