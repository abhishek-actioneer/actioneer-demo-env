/**
 * Unit tests for sql-generator.ts — pure helpers that do NOT call any LLM.
 *
 * What is tested here:
 *   - getAgentSpecs: agent list assembly from static dataset configs,
 *     UNIVERSAL_AGENTS injection, deduplication, queryDescriptions overlay,
 *     and the parseMultiAgentPrompt code path (via real static datasets).
 *   - UNIVERSAL_AGENTS constant: verifies the three universal agent IDs and
 *     their query counts so regressions in the constant are caught.
 *   - parseMultiAgentPrompt (exercised indirectly through getAgentSpecs):
 *     pipe-delimited format, multi-agent extraction, description overlay.
 *
 * Functions that require LLM calls (NOT tested here):
 *   - generateQueries     — calls generateText (Gemini/OpenAI)
 *   - generateSingleQuery — calls generateText
 *   - generateAgentQueries — calls generateText + batchDryRunSQL (DB)
 *   - generateMultipleQueries — orchestrates generateAgentQueries
 *   - validateAndFix      — calls dryRunSQL (DB) + generateText on failure
 *   - retryWithError      — calls generateText
 *   - cleanSQL            — private; exercised only through LLM output parsing
 *
 * No network calls, no DuckDB connection, no external I/O in these tests.
 */

import { describe, it, expect } from "vitest";
import { getAgentSpecs } from "@/lib/sql-generator";

// ---------------------------------------------------------------------------
// UNIVERSAL_AGENTS — static constant contract
//
// Verified through getAgentSpecs: every dataset must include all three
// universal agents. We test this by calling getAgentSpecs on a known dataset
// and asserting all three IDs are present regardless of dataset-specific agents.
// ---------------------------------------------------------------------------

const EXPECTED_UNIVERSAL_IDS = ["research", "data-analysis", "marketing-optimization"];

describe("UNIVERSAL_AGENTS — always present in every dataset", () => {
  it("presto dataset includes all three universal agent IDs", () => {
    const specs = getAgentSpecs("presto");
    const ids = specs.map((s) => s.id);
    for (const uid of EXPECTED_UNIVERSAL_IDS) {
      expect(ids).toContain(uid);
    }
  });

  it("fundsindia dataset includes all three universal agent IDs", () => {
    const specs = getAgentSpecs("fundsindia");
    const ids = specs.map((s) => s.id);
    for (const uid of EXPECTED_UNIVERSAL_IDS) {
      expect(ids).toContain(uid);
    }
  });

  it("vastu-hfc dataset includes all three universal agent IDs", () => {
    const specs = getAgentSpecs("vastu-hfc");
    const ids = specs.map((s) => s.id);
    for (const uid of EXPECTED_UNIVERSAL_IDS) {
      expect(ids).toContain(uid);
    }
  });

  it("universal agents are not duplicated in the returned list", () => {
    const specs = getAgentSpecs("presto");
    const ids = specs.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });
});

// ---------------------------------------------------------------------------
// getAgentSpecs — return shape
// ---------------------------------------------------------------------------

describe("getAgentSpecs — return shape and structure", () => {
  it("returns a non-empty array", () => {
    const specs = getAgentSpecs("presto");
    expect(Array.isArray(specs)).toBe(true);
    expect(specs.length).toBeGreaterThan(0);
  });

  it("every AgentSpec has an id string", () => {
    const specs = getAgentSpecs("presto");
    for (const spec of specs) {
      expect(typeof spec.id).toBe("string");
      expect(spec.id.length).toBeGreaterThan(0);
    }
  });

  it("every AgentSpec has a non-empty queries array", () => {
    const specs = getAgentSpecs("presto");
    for (const spec of specs) {
      expect(Array.isArray(spec.queries)).toBe(true);
      expect(spec.queries.length).toBeGreaterThan(0);
    }
  });

  it("every query has a description string", () => {
    const specs = getAgentSpecs("presto");
    for (const spec of specs) {
      for (const q of spec.queries) {
        expect(typeof q.description).toBe("string");
        expect(q.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("every query has a hint string (may be empty)", () => {
    const specs = getAgentSpecs("presto");
    for (const spec of specs) {
      for (const q of spec.queries) {
        expect(typeof q.hint).toBe("string");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getAgentSpecs — presto dataset (multiAgentPrompt path)
//
// presto defines multiAgentPrompt with agents: acquisition-analysis,
// ltv-projections, fraud-settlement, period-vs-cohort, ltv-model-health,
// spend-scenario — each with 3 queries. queryDescriptions overlays
// description strings for these agent IDs.
// ---------------------------------------------------------------------------

describe("getAgentSpecs — presto (multiAgentPrompt path)", () => {
  it("includes dataset-specific agents from multiAgentPrompt", () => {
    const specs = getAgentSpecs("presto");
    const ids = specs.map((s) => s.id);
    expect(ids).toContain("acquisition-analysis");
    expect(ids).toContain("ltv-projections");
    expect(ids).toContain("fraud-settlement");
    expect(ids).toContain("period-vs-cohort");
    expect(ids).toContain("ltv-model-health");
    expect(ids).toContain("spend-scenario");
  });

  it("acquisition-analysis has exactly 3 queries", () => {
    const specs = getAgentSpecs("presto");
    const agent = specs.find((s) => s.id === "acquisition-analysis");
    expect(agent).toBeDefined();
    expect(agent!.queries.length).toBe(3);
  });

  it("ltv-projections has exactly 3 queries", () => {
    const specs = getAgentSpecs("presto");
    const agent = specs.find((s) => s.id === "ltv-projections");
    expect(agent).toBeDefined();
    expect(agent!.queries.length).toBe(3);
  });

  it("queryDescriptions overlay is applied: acquisition-analysis descriptions match config", () => {
    const specs = getAgentSpecs("presto");
    const agent = specs.find((s) => s.id === "acquisition-analysis");
    expect(agent).toBeDefined();
    // From presto.queryDescriptions["acquisition-analysis"]
    expect(agent!.queries[0].description).toBe("CPI by channel and country");
    expect(agent!.queries[1].description).toBe("Install volume and channel mix trends");
    expect(agent!.queries[2].description).toBe("Spend efficiency: cost vs attributed installs");
  });

  it("ltv-projections queryDescriptions are overlaid", () => {
    const specs = getAgentSpecs("presto");
    const agent = specs.find((s) => s.id === "ltv-projections");
    expect(agent).toBeDefined();
    expect(agent!.queries[0].description).toBe("D30/D60/D90 LTV curves by channel");
    expect(agent!.queries[1].description).toBe("CPI↔LTV correlation analysis");
    expect(agent!.queries[2].description).toBe("Cohort profitability at D90");
  });
});

// ---------------------------------------------------------------------------
// getAgentSpecs — fundsindia dataset (multiAgentPrompt path, more agents)
//
// fundsindia has 8 domain agents plus queryDescriptions for all of them.
// ---------------------------------------------------------------------------

describe("getAgentSpecs — fundsindia (multiAgentPrompt path, 8 domain agents)", () => {
  it("includes core domain agents: data-quality, daily-metrics, cohort-retention, rev-opt", () => {
    const specs = getAgentSpecs("fundsindia");
    const ids = specs.map((s) => s.id);
    expect(ids).toContain("data-quality");
    expect(ids).toContain("daily-metrics");
    expect(ids).toContain("cohort-retention");
    expect(ids).toContain("rev-opt");
  });

  it("includes domain agents: user-segmentation, geographic, crm-analytics, growth-analytics", () => {
    const specs = getAgentSpecs("fundsindia");
    const ids = specs.map((s) => s.id);
    expect(ids).toContain("user-segmentation");
    expect(ids).toContain("geographic");
    expect(ids).toContain("crm-analytics");
    expect(ids).toContain("growth-analytics");
  });

  it("data-quality has exactly 3 queries", () => {
    const specs = getAgentSpecs("fundsindia");
    const agent = specs.find((s) => s.id === "data-quality");
    expect(agent).toBeDefined();
    expect(agent!.queries.length).toBe(3);
  });

  it("daily-metrics queryDescriptions are overlaid correctly", () => {
    const specs = getAgentSpecs("fundsindia");
    const agent = specs.find((s) => s.id === "daily-metrics");
    expect(agent).toBeDefined();
    expect(agent!.queries[0].description).toBe(
      "Monthly new SIP count and cancellation count from monthly_platform_kpis"
    );
    expect(agent!.queries[1].description).toBe(
      "Monthly transaction volume and net inflow from monthly_txn_summary"
    );
  });

  it("total agent count includes 8 domain agents plus 3 universal agents = 11", () => {
    const specs = getAgentSpecs("fundsindia");
    // 8 domain (data-quality, daily-metrics, cohort-retention, rev-opt,
    // user-segmentation, geographic, crm-analytics, growth-analytics)
    // + 3 universal (research, data-analysis, marketing-optimization)
    expect(specs.length).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// getAgentSpecs — universal agents use dataset-specific descriptions when available
//
// When a dataset's queryDescriptions has an entry for a universal agent ID,
// getAgentSpecs should use those descriptions instead of the default ones.
// ---------------------------------------------------------------------------

describe("getAgentSpecs — universal agent description overlay", () => {
  it("universal agent descriptions are non-empty strings", () => {
    // For any dataset, universal agents must have non-empty descriptions
    const specs = getAgentSpecs("presto");
    for (const uid of EXPECTED_UNIVERSAL_IDS) {
      const agent = specs.find((s) => s.id === uid);
      expect(agent).toBeDefined();
      for (const q of agent!.queries) {
        expect(q.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("research agent has exactly 2 queries (universal default)", () => {
    // UNIVERSAL_AGENTS defines research with 2 queries
    // presto has no queryDescriptions["research"], so defaults are used
    const specs = getAgentSpecs("presto");
    const agent = specs.find((s) => s.id === "research");
    expect(agent).toBeDefined();
    expect(agent!.queries.length).toBe(2);
  });

  it("data-analysis agent has exactly 3 queries (universal default)", () => {
    const specs = getAgentSpecs("presto");
    const agent = specs.find((s) => s.id === "data-analysis");
    expect(agent).toBeDefined();
    expect(agent!.queries.length).toBe(3);
  });

  it("marketing-optimization agent has exactly 3 queries (universal default)", () => {
    const specs = getAgentSpecs("presto");
    const agent = specs.find((s) => s.id === "marketing-optimization");
    expect(agent).toBeDefined();
    expect(agent!.queries.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getAgentSpecs — parseMultiAgentPrompt edge cases
//
// These test the internal parseMultiAgentPrompt behavior indirectly
// by constructing scenarios through the real static dataset configs.
// ---------------------------------------------------------------------------

describe("getAgentSpecs — agent IDs are lowercased", () => {
  it("all returned agent IDs are lowercase", () => {
    const specs = getAgentSpecs("presto");
    for (const spec of specs) {
      expect(spec.id).toBe(spec.id.toLowerCase());
    }
  });

  it("fundsindia agent IDs are all lowercase", () => {
    const specs = getAgentSpecs("fundsindia");
    for (const spec of specs) {
      expect(spec.id).toBe(spec.id.toLowerCase());
    }
  });
});

describe("getAgentSpecs — hint is always a string", () => {
  it("all query hints from parsed multiAgentPrompt are empty strings (no hint in format)", () => {
    // The pipe-delimited format does not carry a hint field — parseMultiAgentPrompt
    // always sets hint: "" for parsed queries
    const specs = getAgentSpecs("presto");
    const domainAgents = specs.filter(
      (s) => !EXPECTED_UNIVERSAL_IDS.includes(s.id)
    );
    for (const spec of domainAgents) {
      for (const q of spec.queries) {
        expect(q.hint).toBe("");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getAgentSpecs — unknown dataset ID falls back gracefully
//
// getDataset() silently falls back to DEFAULT_DATASET for unknown IDs
// (documented in datasets/index.ts). getAgentSpecs should not throw.
// ---------------------------------------------------------------------------

describe("getAgentSpecs — unknown dataset ID falls back to default", () => {
  it("does not throw for an unknown dataset ID", () => {
    expect(() => getAgentSpecs("non-existent-dataset-xyz")).not.toThrow();
  });

  it("returns a non-empty array for an unknown dataset ID (fallback to default)", () => {
    const specs = getAgentSpecs("non-existent-dataset-xyz");
    expect(Array.isArray(specs)).toBe(true);
    expect(specs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getAgentSpecs — vastu-hfc dataset (another real dataset, sanity check)
// ---------------------------------------------------------------------------

describe("getAgentSpecs — vastu-hfc dataset", () => {
  it("returns specs with at least 3 entries (3 universal minimum)", () => {
    const specs = getAgentSpecs("vastu-hfc");
    expect(specs.length).toBeGreaterThanOrEqual(3);
  });

  it("all universal agents present", () => {
    const specs = getAgentSpecs("vastu-hfc");
    const ids = specs.map((s) => s.id);
    for (const uid of EXPECTED_UNIVERSAL_IDS) {
      expect(ids).toContain(uid);
    }
  });

  it("no agent has zero queries", () => {
    const specs = getAgentSpecs("vastu-hfc");
    for (const spec of specs) {
      expect(spec.queries.length).toBeGreaterThan(0);
    }
  });
});
