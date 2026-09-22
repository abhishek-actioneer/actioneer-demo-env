/**
 * Structured extractors for the competitor research pipeline.
 *
 * Per company per objective, takes the raw Parallel /extract output and asks
 * OpenAI to convert it into typed JSON matching our CompanyDataset shape.
 * One call per (company, objective) — 4 × N companies total.
 *
 * Strict grounding rules: only use what's in the extracts. Cite the exact quote.
 */

import { generateText, type ModelId } from "@/lib/llm";
import type { ExtractResult } from "@/lib/parallel-client";
import {
  type CompanyDataset,
  type PeriodFinancials,
  type PerformanceNarrative,
  type RiskOutlook,
  type StrategicMove,
  type StrategicMoveType,
  type Citation,
  type AssetMix,
  type CustomerMix,
  type GeographicMix,
  type FundingMix,
} from "./competitor-data-types";

interface ExtractorContext {
  company: string;
  extracts: ExtractResult[];
  asOfDate: Date;
  modelId?: ModelId;
}

function buildSourceBlock(extracts: ExtractResult[]): string {
  return extracts
    .map((r, i) =>
      `--- SOURCE ${i + 1}\nURL: ${r.url}\nTitle: ${r.title}\n\n${r.fullContent.slice(0, 12_000)}`,
    )
    .join("\n\n");
}

function parseJsonOrEmpty<T>(raw: string, fallback: T, label: string): T {
  if (!raw) return fallback;
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try greedy match {...}
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        // Truncation recovery: count brackets and append closers.
        const repaired = repairTruncatedJson(cleaned);
        if (repaired) {
          try {
            return JSON.parse(repaired) as T;
          } catch {
            // give up
          }
        }
      }
    }
    console.warn(`[${label}] failed to parse JSON. Length=${raw.length}, last 200 chars:`, raw.slice(-200));
    return fallback;
  }
}

/** Best-effort repair for JSON truncated mid-array/object. Closes any open
 *  brackets in order. Drops trailing commas + incomplete final value. */
function repairTruncatedJson(s: string): string | null {
  // Find last balanced closing point — back up to the last `,` or `}` or `]`
  // at the top of the bracket stack, then close the rest.
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let lastSafeIdx = -1;

  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (escape) { escape = false; continue; }
    if (c === "\\" && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (c === "{" || c === "[") {
      stack.push(c === "{" ? "}" : "]");
    } else if (c === "}" || c === "]") {
      if (stack[stack.length - 1] === c) stack.pop();
      else return null;
      if (stack.length === 0) return s.slice(0, i + 1); // outermost closed cleanly
    } else if (c === "," && stack.length > 0 && !inString) {
      lastSafeIdx = i;
    }
  }

  if (stack.length === 0) return s;
  // Truncated. Cut at last safe comma (drops the partial trailing element), then close.
  if (lastSafeIdx === -1) return null;
  const truncated = s.slice(0, lastSafeIdx);
  return truncated + stack.reverse().join("");
}

// ── 1. Financials extractor ──────────────────────────────────────────────────

const NUMBERS_PROMPT = `You convert raw extract content into structured per-period financial JSON.

Indian fiscal year: April to March. FY26 = April 2025 to March 2026.

Read all SOURCE blocks for ONE company and output a JSON array of period-financials.

Output schema (strict):
{
  "financials": [
    {
      "period": "FY26" | "FY25" | "FY24" | "Q4 FY26" | "Q3 FY26" | ... ,
      "aum_inr_cr": <number or null>,
      "disbursements_inr_cr": <number or null>,
      "net_worth_inr_cr": <number or null>,
      "total_income_inr_cr": <number or null>,
      "nii_inr_cr": <number or null>,
      "pat_inr_cr": <number or null>,
      "nim_pct": <number or null>,
      "roa_pct": <number or null>,
      "roe_pct": <number or null>,
      "gnpa_pct": <number or null>,
      "nnpa_pct": <number or null>,
      "pcr_pct": <number or null>,
      "credit_cost_pct": <number or null>,
      "crar_pct": <number or null>,
      "branches": <number or null>,
      "employees": <number or null>,
      "customers": <number or null>,
      "avg_ticket_size_inr_lakh": <number or null>,
      "citations": {
        "<field_name>": { "quote": "<exact text from source ≤150 chars>", "sourceUrl": "<url from SOURCE block>" }
      }
    }
  ]
}

Rules:
- Numbers in INR Crores for money fields, decimal for percentages (12.96 not "12.96%").
- Group all numbers for the same reporting period into one row. Don't duplicate periods.
- Order rows from MOST RECENT to oldest.
- ONLY include fields you can directly cite. Set to null if not stated.
- For each non-null numeric field, include a "<field>" entry in "citations" with the exact source quote.
- Avg ticket size: convert to Lakh if document uses other units (e.g. ₹9.2 Lakh stays 9.2; ₹920,000 → 9.2; ₹0.092 Cr → 9.2).
- If the document quotes an absolute YoY change (e.g. "AUM grew 25% YoY to ₹11,423 Cr") and you have current period only, infer the prior period number ONLY if the absolute current and the YoY % are both stated — else leave null.
- Return JSON only — no prose, no markdown fences.`;

async function safeGenerate(label: string, opts: Parameters<typeof generateText>[1] & { input: string }): Promise<string> {
  try {
    const { input, ...gen } = opts;
    return await generateText(input, gen);
  } catch (err) {
    console.warn(`[${label}] generation failed: ${err instanceof Error ? err.message : err}`);
    return "";
  }
}

export async function extractFinancials(ctx: ExtractorContext): Promise<PeriodFinancials[]> {
  if (ctx.extracts.length === 0) return [];
  const userInput =
    `Company: ${ctx.company}\nAs of: ${ctx.asOfDate.toISOString().slice(0, 10)}\n\nSOURCE BLOCKS:\n\n${buildSourceBlock(ctx.extracts)}`;
  const json = await safeGenerate(`financials.${ctx.company}`, {
    input: userInput,
    systemPrompt: NUMBERS_PROMPT,
    jsonMode: true,
    feature: "competitor.numbers_extract",
    timeoutMs: 180_000,
    maxOutputTokens: 16_000,
    modelId: ctx.modelId,
  });
  const parsed = parseJsonOrEmpty<{ financials?: PeriodFinancials[] }>(json, {}, `financials.${ctx.company}`);
  return Array.isArray(parsed.financials) ? parsed.financials : [];
}

// ── 2. Strategic moves extractor ─────────────────────────────────────────────

const STRATEGY_PROMPT = `You convert raw extract content into a structured list of strategic moves for ONE company.

Read all SOURCE blocks and output:
{
  "moves": [
    {
      "date": "YYYY-MM" | "YYYY" | null,
      "type": "capital_raise" | "m_and_a" | "leadership" | "expansion" | "regulatory" | "product_launch" | "credit_rating" | "other",
      "description": "<single sentence ≤140 chars>",
      "detail": "<optional 1-2 line elaboration>" | null,
      "citation": { "quote": "<exact source text ≤200 chars>", "sourceUrl": "<url>" }
    }
  ]
}

Rules:
- ONE move per array item. Don't conflate.
- Order most-recent first.
- Skip generic strategy / vision boilerplate. ONLY concrete dated actions.
- Skip moves older than 18 months from the as-of date.
- "type" must come from the enum exactly.
- Every move MUST have a citation with an exact source quote.
- Return JSON only.`;

export async function extractStrategicMoves(ctx: ExtractorContext): Promise<StrategicMove[]> {
  if (ctx.extracts.length === 0) return [];
  const userInput =
    `Company: ${ctx.company}\nAs of: ${ctx.asOfDate.toISOString().slice(0, 10)}\n\nSOURCE BLOCKS:\n\n${buildSourceBlock(ctx.extracts)}`;
  const json = await safeGenerate(`strategy.${ctx.company}`, {
    input: userInput,
    systemPrompt: STRATEGY_PROMPT,
    jsonMode: true,
    feature: "competitor.strategy_extract",
    timeoutMs: 120_000,
    maxOutputTokens: 12_000,
    modelId: ctx.modelId,
  });
  const parsed = parseJsonOrEmpty<{ moves?: Array<Partial<StrategicMove> & { type?: string }> }>(json, {}, `strategy.${ctx.company}`);
  const allowedTypes: StrategicMoveType[] = [
    "capital_raise", "m_and_a", "leadership", "expansion", "regulatory", "product_launch", "credit_rating", "other",
  ];
  return (parsed.moves ?? [])
    .filter((m): m is Partial<StrategicMove> & { description: string } => typeof m.description === "string" && m.description.length > 0)
    .map((m) => ({
      date: m.date ?? undefined,
      type: (allowedTypes as string[]).includes(m.type ?? "") ? (m.type as StrategicMoveType) : "other",
      description: m.description,
      detail: m.detail ?? undefined,
      citation: m.citation,
    }));
}

// ── 3. Performance narrative extractor ───────────────────────────────────────

const PERFORMANCE_PROMPT = `You convert raw extract content into structured performance narrative for ONE company.

Read all SOURCE blocks and output:
{
  "growth_drivers": [{ "description": "<≤200 chars>", "citation": { "quote": "<≤200 chars>", "sourceUrl": "<url>" } }],
  "segment_commentary": [{ "segment": "<segment name or null>", "description": "<≤200 chars>", "citation": {...} }],
  "guidance": [{ "description": "<forward-looking statement ≤200 chars>", "citation": {...} }],
  "cohort_or_customer_notes": [{ "description": "<≤200 chars>", "citation": {...} }]
}

Rules:
- 0-5 items per array. Empty array if nothing relevant.
- Each description must be specific and sourced — no generic platitudes.
- Every entry must have a citation.
- Return JSON only.`;

export async function extractPerformance(ctx: ExtractorContext): Promise<PerformanceNarrative> {
  const empty: PerformanceNarrative = { growth_drivers: [], segment_commentary: [], guidance: [], cohort_or_customer_notes: [] };
  if (ctx.extracts.length === 0) return empty;
  const userInput =
    `Company: ${ctx.company}\nAs of: ${ctx.asOfDate.toISOString().slice(0, 10)}\n\nSOURCE BLOCKS:\n\n${buildSourceBlock(ctx.extracts)}`;
  const json = await safeGenerate(`performance.${ctx.company}`, {
    input: userInput,
    systemPrompt: PERFORMANCE_PROMPT,
    jsonMode: true,
    feature: "competitor.performance_extract",
    timeoutMs: 120_000,
    maxOutputTokens: 12_000,
    modelId: ctx.modelId,
  });
  const parsed = parseJsonOrEmpty<PerformanceNarrative>(json, empty, `performance.${ctx.company}`);
  return {
    growth_drivers: parsed.growth_drivers ?? [],
    segment_commentary: parsed.segment_commentary ?? [],
    guidance: parsed.guidance ?? [],
    cohort_or_customer_notes: parsed.cohort_or_customer_notes ?? [],
  };
}

// ── 4. Risk + outlook extractor ──────────────────────────────────────────────

const RISK_PROMPT = `You convert raw extract content into structured risk + outlook narrative for ONE company.

Read all SOURCE blocks and output:
{
  "risk_factors": [{ "description": "<≤200 chars>", "citation": { "quote": "<≤200 chars>", "sourceUrl": "<url>" } }],
  "asset_quality_concerns": [{ "description": "<≤200 chars>", "citation": {...} }],
  "headwinds": [{ "description": "<≤200 chars>", "citation": {...} }],
  "outlook": [{ "description": "<forward-looking statement ≤200 chars>", "citation": {...} }]
}

Rules:
- 0-5 items per array.
- Skip generic 'standard risks' boilerplate (cyber, business continuity etc.) — only company-specific or sector-specific concerns.
- Every entry must have a citation.
- Return JSON only.`;

export async function extractRiskOutlook(ctx: ExtractorContext): Promise<RiskOutlook> {
  const empty: RiskOutlook = { risk_factors: [], asset_quality_concerns: [], headwinds: [], outlook: [] };
  if (ctx.extracts.length === 0) return empty;
  const userInput =
    `Company: ${ctx.company}\nAs of: ${ctx.asOfDate.toISOString().slice(0, 10)}\n\nSOURCE BLOCKS:\n\n${buildSourceBlock(ctx.extracts)}`;
  const json = await safeGenerate(`risk.${ctx.company}`, {
    input: userInput,
    systemPrompt: RISK_PROMPT,
    jsonMode: true,
    feature: "competitor.risk_extract",
    timeoutMs: 120_000,
    maxOutputTokens: 12_000,
    modelId: ctx.modelId,
  });
  const parsed = parseJsonOrEmpty<RiskOutlook>(json, empty, `risk.${ctx.company}`);
  return {
    risk_factors: parsed.risk_factors ?? [],
    asset_quality_concerns: parsed.asset_quality_concerns ?? [],
    headwinds: parsed.headwinds ?? [],
    outlook: parsed.outlook ?? [],
  };
}

// ── 5. Mix + geography extractor ─────────────────────────────────────────────

const MIX_PROMPT = `You convert raw extract content into structured portfolio composition for ONE company.

Read all SOURCE blocks and output:
{
  "asset_mix": [
    {
      "period": "FY26" | "FY25" | "Q4 FY26" | ...,
      "home_loan_pct": <number 0-100 or null>,
      "lap_pct": <number 0-100 or null>,
      "msme_pct": <number 0-100 or null>,
      "construction_pct": <number 0-100 or null>,
      "other_pct": <number 0-100 or null>,
      "citations": { "<field>": { "quote": "<≤120 chars>", "sourceUrl": "<url>" } }
    }
  ],
  "customer_mix": [
    {
      "period": "FY26" | "FY25" | ...,
      "self_employed_pct": <number 0-100 or null>,
      "salaried_pct": <number 0-100 or null>,
      "formal_income_pct": <number 0-100 or null>,
      "informal_income_pct": <number 0-100 or null>,
      "rural_pct": <number 0-100 or null>,
      "semi_urban_pct": <number 0-100 or null>,
      "urban_pct": <number 0-100 or null>,
      "citations": { ... }
    }
  ],
  "geographic_mix": [
    {
      "period": "FY26" | "FY25" | ...,
      "top_states": [{ "state": "<state name>", "aum_share_pct": <0-100 or null>, "branches": <number or null>, "citation": { "quote": "...", "sourceUrl": "..." } }],
      "states_total": <number or null>,
      "citation": { "quote": "...", "sourceUrl": "..." }
    }
  ],
  "funding_mix": [
    {
      "period": "FY26" | "FY25" | ...,
      "bank_borrowings_pct": <0-100 or null>,
      "ncds_pct": <0-100 or null>,
      "nhb_refinance_pct": <0-100 or null>,
      "securitization_pct": <0-100 or null>,
      "ecb_pct": <0-100 or null>,
      "other_pct": <0-100 or null>,
      "weighted_avg_cost_pct": <0-100 or null>,
      "citations": { ... }
    }
  ]
}

Rules:
- Percentages as decimal numbers without % suffix (78 not "78%").
- Group all values for the same period into one row per array.
- Order most-recent first.
- ONLY include fields you can directly cite from the document. Use null for unstated.
- Each populated field must have a citation entry with the exact source text.
- Empty array if no relevant data is found.
- Return JSON only, no prose, no markdown fences.`;

interface MixExtractionResult {
  asset_mix: AssetMix[];
  customer_mix: CustomerMix[];
  geographic_mix: GeographicMix[];
  funding_mix: FundingMix[];
}

export async function extractMix(ctx: ExtractorContext): Promise<MixExtractionResult> {
  const empty: MixExtractionResult = { asset_mix: [], customer_mix: [], geographic_mix: [], funding_mix: [] };
  if (ctx.extracts.length === 0) return empty;
  const userInput =
    `Company: ${ctx.company}\nAs of: ${ctx.asOfDate.toISOString().slice(0, 10)}\n\nSOURCE BLOCKS:\n\n${buildSourceBlock(ctx.extracts)}`;
  const json = await safeGenerate(`mix.${ctx.company}`, {
    input: userInput,
    systemPrompt: MIX_PROMPT,
    jsonMode: true,
    feature: "competitor.mix_extract",
    timeoutMs: 120_000,
    maxOutputTokens: 12_000,
    modelId: ctx.modelId,
  });
  const parsed = parseJsonOrEmpty<MixExtractionResult>(json, empty, `mix.${ctx.company}`);
  return {
    asset_mix: parsed.asset_mix ?? [],
    customer_mix: parsed.customer_mix ?? [],
    geographic_mix: parsed.geographic_mix ?? [],
    funding_mix: parsed.funding_mix ?? [],
  };
}

// ── Aggregator: run all 5 extractors per company in parallel ─────────────────

export interface BuildDatasetInput {
  company: string;
  numbersExtracts: ExtractResult[];
  strategyExtracts: ExtractResult[];
  performanceExtracts: ExtractResult[];
  riskExtracts: ExtractResult[];
  mixExtracts: ExtractResult[];
  asOfDate: Date;
  modelId?: ModelId;
}

export async function buildCompanyDataset(input: BuildDatasetInput): Promise<CompanyDataset> {
  const ctx = (extracts: ExtractResult[]): ExtractorContext => ({
    company: input.company,
    extracts,
    asOfDate: input.asOfDate,
    modelId: input.modelId,
  });

  const [financials, strategic_moves, performance, risk_outlook, mix] = await Promise.all([
    extractFinancials(ctx(input.numbersExtracts)),
    extractStrategicMoves(ctx(input.strategyExtracts)),
    extractPerformance(ctx(input.performanceExtracts)),
    extractRiskOutlook(ctx(input.riskExtracts)),
    extractMix(ctx(input.mixExtracts)),
  ]);

  const allUrls = new Set<string>();
  for (const e of [...input.numbersExtracts, ...input.strategyExtracts, ...input.performanceExtracts, ...input.riskExtracts, ...input.mixExtracts]) {
    allUrls.add(e.url);
  }

  return {
    company: input.company,
    financials,
    strategic_moves,
    performance,
    risk_outlook,
    asset_mix: mix.asset_mix,
    customer_mix: mix.customer_mix,
    geographic_mix: mix.geographic_mix,
    funding_mix: mix.funding_mix,
    source_urls: [...allUrls],
  };
}
