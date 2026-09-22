/**
 * Fallback search for companies whose own IR page failed to yield data.
 *
 * Flow: domain-scoped web search → URL allowlist filter → LLM pick → multi-extract
 *   → fresh per-company dataset → merged into the primary dataset (gap-fill).
 *
 * Triggered per-company only when the primary dataset is "sparse" (see
 * `isDatasetSparse`). Keeps cost bounded — typical 4-peer report adds ~1 fallback
 * pass when one company misbehaves.
 */

import { searchWeb } from "@/lib/parallel-client";
import { generateText, type ModelId } from "@/lib/llm";
import { multiExtract, extractsByCompany } from "./parallel-multi-extract";
import { buildCompanyDataset } from "./competitor-extractors";
import { FALLBACK_PICKER_PROMPT } from "@/lib/prompts/fallback-search";
import type { PickedDoc, TimeScope } from "./ir-doc-picker";
import type { CompanyDataset } from "./competitor-data-types";

/**
 * Hostname suffixes we trust as fallback sources. Anything else is dropped
 * before the LLM picker even sees it.
 */
export const ALLOWED_FALLBACK_DOMAINS: readonly string[] = [
  // Tier A — primary regulatory filings
  "nseindia.com",
  "nsearchives.nseindia.com",
  "bseindia.com",
  "rbi.org.in",
  // Tier B — rating agencies
  "careratings.com",
  "careedge.in",
  "crisil.com",
  "icra.in",
  "indiaratings.co.in",
  // Tier C — aggregators
  "screener.in",
  "moneycontrol.com",
  // Tier D — narrative-only news (filtered later by picker)
  "livemint.com",
  "business-standard.com",
  "economictimes.indiatimes.com",
];

export function isAllowedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return ALLOWED_FALLBACK_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * A company dataset is "sparse" when we have no period-level financials to
 * compare. Strategic moves alone can come from press releases without numbers,
 * so we key off the financial table.
 */
export function isDatasetSparse(d: CompanyDataset): boolean {
  return d.financials.length === 0;
}

/** Pre-templated search queries per tier. Cheap and predictable; no LLM. */
function buildFallbackQueries(company: string, sector: string, timeScope: TimeScope): string[] {
  const fyTag = timeScope === "last_2_years" || timeScope === "last_3_years"
    ? "FY25 FY26"
    : "FY26 Q4 results";
  return [
    // Primary filings
    `${company} audited financial results ${fyTag} site:nseindia.com OR site:bseindia.com`,
    // Rating agency reports — restate company financials with commentary
    `${company} rating rationale ${sector} site:careratings.com OR site:careedge.in OR site:crisil.com OR site:icra.in OR site:indiaratings.co.in`,
    // Aggregators (last resort)
    `${company} ${sector} AUM PAT GNPA site:screener.in OR site:moneycontrol.com`,
  ];
}

interface FallbackPick {
  n: number;
  type?: string;
  period?: string;
  reason?: string;
}

/**
 * Call the LLM picker to choose up to `maxDocs` URLs from filtered search hits.
 * Returns PickedDoc[] (compatible with the rest of the pipeline).
 */
async function pickFallbackUrls(
  company: string,
  sector: string,
  filtered: Array<{ url: string; title: string; publishDate?: string; excerpts: string[] }>,
  maxDocs: number,
  modelId?: ModelId,
): Promise<PickedDoc[]> {
  if (filtered.length === 0) return [];

  const userInput =
    `Company: ${company}\n` +
    `Sector: ${sector}\n` +
    `Max picks: ${maxDocs}\n\n` +
    `Candidate results (numbered — choose by 'n'):\n\n` +
    filtered
      .map((r, i) => {
        const snippet = r.excerpts.slice(0, 2).join(" / ").slice(0, 300);
        const dateStr = r.publishDate ? ` [${r.publishDate}]` : "";
        return `${i + 1}. URL: ${r.url}\n   Title: ${r.title}${dateStr}\n   Snippet: ${snippet || "—"}`;
      })
      .join("\n\n");

  const json = await generateText({
    messages: [
      { role: "system", content: FALLBACK_PICKER_PROMPT },
      { role: "user", content: userInput },
    ],
    jsonMode: true,
    feature: "competitor_research.fallback_pick",
    timeoutMs: 120_000,
    modelId,
  });

  const cleaned = json.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let parsed: { picks?: FallbackPick[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.warn(`[fallback-search] picker returned invalid JSON for ${company}: ${err instanceof Error ? err.message : "unknown"}`);
    return [];
  }
  if (!parsed.picks || !Array.isArray(parsed.picks)) return [];

  const allowedTypes = new Set([
    "quarterly_results", "annual_report", "investor_presentation", "transcript", "press_release", "rating", "other",
  ]);

  const picks: PickedDoc[] = [];
  const seen = new Set<string>();
  for (const p of parsed.picks.slice(0, maxDocs)) {
    const idx = (p.n ?? 0) - 1;
    const cand = filtered[idx];
    if (!cand) continue;
    if (seen.has(cand.url)) continue;
    seen.add(cand.url);
    const type = (allowedTypes.has(p.type ?? "") ? p.type : "other") as PickedDoc["type"];
    picks.push({
      url: cand.url,
      title: cand.title,
      type,
      period: p.period,
      reason: p.reason ?? "",
    });
  }
  return picks;
}

export interface FallbackResult {
  /** URLs that were picked and sent to multi-extract. */
  pickedUrls: PickedDoc[];
  /** Fresh dataset for the company — caller merges into primary. */
  dataset: CompanyDataset | null;
}

/**
 * Run the full fallback pipeline for one company: search → filter → pick →
 * multi-extract → buildCompanyDataset. Returns a fresh dataset (or null if
 * we couldn't find anything usable).
 */
export async function runFallbackForCompany(input: {
  company: string;
  sector: string;
  timeScope: TimeScope;
  asOfDate: Date;
  modelId?: ModelId;
  signal?: AbortSignal;
  maxDocs?: number;
}): Promise<FallbackResult> {
  const { company, sector, timeScope, asOfDate, modelId, signal } = input;
  const maxDocs = input.maxDocs ?? 3;

  const queries = buildFallbackQueries(company, sector, timeScope);
  const objective = `Find primary-source financial filings, rating reports, or structured-data pages for ${company} (${sector}).`;

  let searchResults;
  try {
    searchResults = await searchWeb(objective, queries, signal);
  } catch (err) {
    console.warn(`[fallback-search] search failed for ${company}:`, err instanceof Error ? err.message : err);
    return { pickedUrls: [], dataset: null };
  }

  // Domain allowlist filter — dedupe by URL, drop anything off-list.
  const seenUrls = new Set<string>();
  const filtered = [] as Array<{ url: string; title: string; publishDate?: string; excerpts: string[] }>;
  for (const r of searchResults) {
    if (seenUrls.has(r.url)) continue;
    if (!isAllowedDomain(r.url)) continue;
    seenUrls.add(r.url);
    filtered.push(r);
  }
  if (filtered.length === 0) return { pickedUrls: [], dataset: null };

  // Cap input to the picker — top 8 candidates is plenty.
  const picks = await pickFallbackUrls(company, sector, filtered.slice(0, 8), maxDocs, modelId);
  if (picks.length === 0) return { pickedUrls: [], dataset: null };

  // Re-run multi-extract for just this company's new URLs.
  const allPicks = picks.map((doc) => ({ company, doc }));
  const bundle = await multiExtract(allPicks, signal);

  // Group + build dataset for this company.
  const numbers = extractsByCompany(bundle, "numbers").get(company) ?? [];
  const strategy = extractsByCompany(bundle, "strategy").get(company) ?? [];
  const performance = extractsByCompany(bundle, "performance").get(company) ?? [];
  const risk = extractsByCompany(bundle, "risk_outlook").get(company) ?? [];
  const mix = extractsByCompany(bundle, "mix_and_geography").get(company) ?? [];

  // If multi-extract returned nothing either (worst case), bail.
  if (numbers.length + strategy.length + performance.length + risk.length + mix.length === 0) {
    return { pickedUrls: picks, dataset: null };
  }

  const dataset = await buildCompanyDataset({
    company,
    numbersExtracts: numbers,
    strategyExtracts: strategy,
    performanceExtracts: performance,
    riskExtracts: risk,
    mixExtracts: mix,
    asOfDate,
    modelId,
  });
  return { pickedUrls: picks, dataset };
}

/**
 * Merge a fallback dataset into the primary. Primary wins where it has data;
 * fallback fills gaps. Conservative — does not overwrite existing values.
 */
export function mergeDatasets(primary: CompanyDataset, fallback: CompanyDataset): CompanyDataset {
  // Financial periods: union by `period` key, prefer primary's period row when
  // both have it; otherwise add the fallback row.
  const byPeriod = new Map(primary.financials.map((p) => [p.period, p]));
  for (const fb of fallback.financials) {
    if (!byPeriod.has(fb.period)) byPeriod.set(fb.period, fb);
  }
  const mergedFinancials = [...byPeriod.values()];

  const merged: CompanyDataset = {
    company: primary.company,
    financials: mergedFinancials,
    strategic_moves: primary.strategic_moves.length > 0 ? primary.strategic_moves : fallback.strategic_moves,
    performance: hasNarrativeContent(primary.performance) ? primary.performance : fallback.performance,
    risk_outlook: hasNarrativeContent(primary.risk_outlook) ? primary.risk_outlook : fallback.risk_outlook,
    asset_mix: primary.asset_mix.length > 0 ? primary.asset_mix : fallback.asset_mix,
    customer_mix: primary.customer_mix.length > 0 ? primary.customer_mix : fallback.customer_mix,
    geographic_mix: primary.geographic_mix.length > 0 ? primary.geographic_mix : fallback.geographic_mix,
    funding_mix: primary.funding_mix.length > 0 ? primary.funding_mix : fallback.funding_mix,
    source_urls: [...new Set([...primary.source_urls, ...fallback.source_urls])],
  };
  return merged;
}

function hasNarrativeContent(p: object): boolean {
  return Object.values(p).some((arr) => Array.isArray(arr) && arr.length > 0);
}
