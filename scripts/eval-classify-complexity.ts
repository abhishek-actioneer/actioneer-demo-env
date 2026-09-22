/**
 * Eval the classifier's `complexity` output on a labeled set of queries.
 *
 * Usage:
 *   npx tsx scripts/eval-classify-complexity.ts                # uses built-in fixture set
 *   npx tsx scripts/eval-classify-complexity.ts custom.json    # uses your own labeled fixtures
 *
 * Fixture format (JSON array):
 *   [{ "query": "...", "expected": "simple" | "complex", "note"?: "..." }, ...]
 *
 * Output: per-query result + precision/recall/F1 on `complex` label.
 *
 * Notes:
 *   - Hits LLM directly via @/lib/llm + @/lib/prompts/classify (does NOT go through /api/classify,
 *     so no auth/dataset gating required).
 *   - Uses DEFAULT_DATASET for suggestedPrompts in the prompt builder.
 *   - Concurrency capped at 4 to avoid rate-limiting.
 */

import { generateText } from "../src/lib/llm";
import { buildClassifyPrompt } from "../src/lib/prompts/classify";
import { getDataset, DEFAULT_DATASET } from "../src/lib/datasets";

interface Fixture {
  query: string;
  expected: "simple" | "complex";
  note?: string;
}

// ── Default fixture set (hand-labeled, ~40 queries) ──
// Edit to match your domain. False positives ("complex" when actually simple) are
// the costly direction since they trigger ~10× more LLM/SQL calls.

const DEFAULT_FIXTURES: Fixture[] = [
  // ── SIMPLE (anything 1–3 SQL queries from a single analytical lens can answer) ──
  // Single metric / aggregate / trend / ranking
  { query: "how many users signed up last week?", expected: "simple" },
  { query: "what's our DAU yesterday?", expected: "simple" },
  { query: "show me top 10 products by revenue", expected: "simple" },
  { query: "revenue trend over the last 30 days", expected: "simple" },
  { query: "users by country", expected: "simple" },
  { query: "what is the conversion rate this month?", expected: "simple" },
  { query: "total bookings yesterday", expected: "simple" },
  { query: "average order value last week", expected: "simple" },
  { query: "list top 5 cities by signups", expected: "simple" },
  { query: "show churn rate over time", expected: "simple" },
  { query: "what's the 7-day retention?", expected: "simple" },
  // Single-domain "why" / "driving" — still answerable with 2–3 SQLs from one agent
  { query: "why did revenue drop last week?", expected: "simple", note: "single-domain diagnostic" },
  { query: "what's driving the spike in churn?", expected: "simple", note: "single-domain root-cause" },
  { query: "investigate why conversion is lower on mobile", expected: "simple", note: "single-domain diagnostic" },
  { query: "explain the slowdown in new user signups", expected: "simple", note: "single-domain diagnostic" },
  { query: "find the root cause of the drop in conversion", expected: "simple", note: "single-domain root-cause" },
  // Two-metric or two-dim — single SQL with GROUP BY handles this
  { query: "compare revenue and active users by region this quarter vs last", expected: "simple", note: "two metrics × dim — single agent" },
  { query: "show me revenue and orders by region", expected: "simple", note: "two metrics — single agent" },
  { query: "how does engagement vary by cohort and plan tier?", expected: "simple", note: "two dims — single agent" },
  { query: "compare DAU, retention, and revenue trends this month vs last", expected: "simple", note: "three trends — single agent" },
  // "Biggest contributor" on a single metric
  { query: "what are the biggest contributors to our growth this month?", expected: "simple", note: "single-metric attribution" },
  { query: "analyze churn by region and figure out the biggest risk segments", expected: "simple", note: "single metric + segmentation" },
  // "Deep dive" on a narrow topic — still single-lens
  { query: "deep dive into onboarding performance", expected: "simple", note: "narrow topic, single lens" },
  { query: "analyze our retention across plan tiers and acquisition channels", expected: "simple", note: "single metric × two dims" },
  // Period / open-ended on a single metric
  { query: "compare this month to last month", expected: "simple" },
  { query: "what changed this week?", expected: "simple", note: "answerable with a top-movers SQL" },

  // ── COMPLEX (genuinely needs 6 lenses + synthesized report) ──
  // Holistic business-health questions
  { query: "how is the business doing across all dimensions?", expected: "complex", note: "holistic health check" },
  { query: "give me a state-of-the-business overview for the QBR", expected: "complex", note: "QBR-style overview" },
  { query: "produce an executive summary of our performance this quarter", expected: "complex", note: "exec summary across business" },
  // End-to-end audits across multiple analytical domains
  { query: "audit our entire growth funnel end-to-end and tell me what to fix first", expected: "complex", note: "full funnel audit with prioritization" },
  { query: "produce a comprehensive report on factors driving LTV across the business", expected: "complex", note: "comprehensive LTV report" },
  { query: "do a complete diagnostic of our retention story across cohorts, geography, and monetization", expected: "complex", note: "multi-lens retention diagnostic" },
  // Strategic prioritization
  { query: "what 3 strategic priorities should we focus on next quarter based on the data?", expected: "complex", note: "strategic prioritization" },
  { query: "where are our biggest growth leverage points across the entire funnel?", expected: "complex", note: "leverage-point search" },
  { query: "give me a prioritized list of growth opportunities backed by the data", expected: "complex", note: "ranked opportunity list" },
  // Comprehensive multi-lens comparisons
  { query: "build me a complete picture of our power users vs casual users — behavior, geography, retention, monetization", expected: "complex", note: "multi-lens segment comparison" },
  { query: "compare top markets vs bottom markets across acquisition, engagement, retention, and monetization", expected: "complex", note: "multi-domain market comparison" },
  { query: "give me a full report on what's working and what's not across the entire product", expected: "complex", note: "full product report" },
];

// ── Eval ──

interface EvalResult {
  fixture: Fixture;
  predicted: "simple" | "complex";
  predictedReason: string | null;
  predictedMode: string;
  raw: string;
  ok: boolean;
}

async function classifyOne(query: string): Promise<{ mode: string; complexity: "simple" | "complex"; complexityReason: string | null; raw: string }> {
  const ds = getDataset(DEFAULT_DATASET);
  const systemPrompt = buildClassifyPrompt("", ds.suggestedPrompts);
  const text = await generateText(query, { systemPrompt, jsonMode: true });
  const cleaned = text.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
  try {
    const result = JSON.parse(cleaned);
    const mode = typeof result.mode === "string" ? result.mode : "unknown";
    const complexity = result.complexity === "complex" ? "complex" : "simple";
    const complexityReason = typeof result.complexityReason === "string" ? result.complexityReason : null;
    return { mode, complexity, complexityReason, raw: cleaned };
  } catch {
    return { mode: "parse_error", complexity: "simple", complexityReason: null, raw: cleaned };
  }
}

async function runConcurrent<T>(factories: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(factories.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= factories.length) return;
      results[i] = await factories[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, factories.length) }, () => worker()));
  return results;
}

async function main() {
  const fixturePath = process.argv[2];
  let fixtures: Fixture[];

  if (fixturePath) {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(fixturePath, "utf-8");
    fixtures = JSON.parse(raw);
    console.log(`Loaded ${fixtures.length} fixtures from ${fixturePath}\n`);
  } else {
    fixtures = DEFAULT_FIXTURES;
    console.log(`Using ${fixtures.length} default fixtures\n`);
  }

  const factories = fixtures.map((f) => async () => {
    try {
      const out = await classifyOne(f.query);
      return {
        fixture: f,
        predicted: out.complexity,
        predictedReason: out.complexityReason,
        predictedMode: out.mode,
        raw: out.raw,
        ok: out.complexity === f.expected,
      } satisfies EvalResult;
    } catch (err) {
      return {
        fixture: f,
        predicted: "simple" as const,
        predictedReason: null,
        predictedMode: "error",
        raw: err instanceof Error ? err.message : String(err),
        ok: false,
      };
    }
  });

  console.log("Running classifier (concurrency=4)...\n");
  const start = Date.now();
  const results = await runConcurrent(factories, 4);
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

  // ── Per-query output ──
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    const expected = r.fixture.expected.padEnd(7);
    const predicted = r.predicted.padEnd(7);
    const reason = r.predictedReason ? ` [${r.predictedReason}]` : "";
    const modeFlag = r.predictedMode !== "analytics" ? ` (mode=${r.predictedMode})` : "";
    console.log(`${mark} expected=${expected} got=${predicted}${modeFlag} | ${r.fixture.query}${reason}`);
    if (r.fixture.note) console.log(`    note: ${r.fixture.note}`);
  }

  // ── Confusion matrix on `complex` label ──
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of results) {
    if (r.fixture.expected === "complex" && r.predicted === "complex") tp++;
    else if (r.fixture.expected === "simple" && r.predicted === "complex") fp++;
    else if (r.fixture.expected === "simple" && r.predicted === "simple") tn++;
    else if (r.fixture.expected === "complex" && r.predicted === "simple") fn++;
  }

  const accuracy = (tp + tn) / results.length;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  console.log(`\n────────── Results (${elapsedSec}s) ──────────`);
  console.log(`Total:        ${results.length}`);
  console.log(`Correct:      ${tp + tn}/${results.length}  (accuracy ${(accuracy * 100).toFixed(1)}%)`);
  console.log(`\nConfusion matrix on "complex" label:`);
  console.log(`  TP (correct complex):     ${tp}`);
  console.log(`  FP (wrongly complex):     ${fp}   ← costly direction`);
  console.log(`  TN (correct simple):      ${tn}`);
  console.log(`  FN (missed complex):      ${fn}`);
  console.log(`\nPrecision (complex): ${(precision * 100).toFixed(1)}%   ← target ≥ 85%`);
  console.log(`Recall    (complex): ${(recall * 100).toFixed(1)}%`);
  console.log(`F1        (complex): ${(f1 * 100).toFixed(1)}%`);

  if (fp > 0) {
    console.log(`\n⚠️  ${fp} false-positive(s) — these would auto-upgrade simple queries to deep mode (~10× cost):`);
    for (const r of results) {
      if (r.fixture.expected === "simple" && r.predicted === "complex") {
        console.log(`    "${r.fixture.query}"  →  reason: ${r.predictedReason ?? "(none)"}`);
      }
    }
  }

  if (fn > 0) {
    console.log(`\nℹ️  ${fn} false-negative(s) — these complex queries would stay on quick mode:`);
    for (const r of results) {
      if (r.fixture.expected === "complex" && r.predicted === "simple") {
        console.log(`    "${r.fixture.query}"`);
      }
    }
  }

  // Exit non-zero if precision below threshold so this can gate CI later
  process.exit(precision < 0.85 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
