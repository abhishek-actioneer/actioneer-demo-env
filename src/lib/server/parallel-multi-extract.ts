/**
 * Multi-objective extraction via Parallel /v1/extract.
 *
 * Same URL set, fired N times in parallel with N different objectives. Each
 * objective biases what content surfaces from the same PDF — e.g. one
 * objective pulls financial tables, another pulls strategic moves narrative,
 * a third pulls risk factors. Yields an ExtractedBundle keyed by objective.
 *
 * Each individual /extract call is itself a batch over all picked URLs.
 * So total wire calls = OBJECTIVES.length (typically 4), not URLs × OBJECTIVES.
 */

import { extractUrls, type ExtractResult } from "@/lib/parallel-client";
import {
  EXTRACT_OBJECTIVES,
  type ExtractObjective,
  type ExtractedBundle,
} from "./competitor-data-types";
import type { PickedDoc } from "./ir-doc-picker";

const OBJECTIVE_PROMPTS: Record<ExtractObjective, string> = {
  numbers:
    "Extract every disclosed financial metric in the document, with the EXACT period it covers. " +
    "Pull: AUM, disbursements, total income / revenue, net interest income (NII), profit after tax (PAT), " +
    "gross NPA % (GNPA), net NPA % (NNPA), provision coverage ratio (PCR), credit cost %, " +
    "net interest margin (NIM) %, return on assets (RoA) %, return on equity (RoE) %, " +
    "capital adequacy ratio (CRAR) %, branch count, employee count, customer count, average ticket size. " +
    "For every number, quote the EXACT source text WITH its period label (e.g. 'FY26', 'Q4 FY26', 'FY25', 'as at 31 March 2026'). " +
    "If two periods are reported (e.g. FY26 vs FY25), surface BOTH. Prefer audited figures over unaudited. " +
    "Skip non-financial filler (boilerplate, director bios, code-of-conduct text).",

  strategy:
    "Extract every recent strategic action and corporate move stated in the document. " +
    "Capture: equity raises (QIP, rights issue, primary infusion), debt raises (NCDs, bonds), " +
    "M&A and stake changes (acquisitions, divestitures, promoter stake sales), " +
    "leadership changes (CEO, CFO, board appointments), " +
    "geographic expansion (new states, new branches, new markets), " +
    "regulatory actions (RBI directions, NHB compliance, listing events), " +
    "product launches (new loan products, digital initiatives), " +
    "credit-rating changes (upgrades, reaffirmations). " +
    "For each, quote the exact source text with the date or period mentioned. " +
    "Skip generic boilerplate about strategy or vision — only concrete dated actions.",

  performance:
    "Extract management's narrative on business performance from this document. Capture: " +
    "growth drivers (what the business attributes growth to), " +
    "segment-level commentary (mix shifts, vertical performance, geographic mix), " +
    "MD&A highlights (key themes from Management Discussion & Analysis if present), " +
    "customer / cohort notes (vintage performance, retention, sourcing channel), " +
    "operational metrics narrative (productivity, digital adoption, collection efficiency), " +
    "guidance (forward statements about growth, margin, asset quality). " +
    "For each point, quote the exact source text. Avoid generic platitudes — only specific, sourced commentary.",

  risk_outlook:
    "Extract every risk factor, asset-quality concern, headwind, and outlook statement from the document. " +
    "Capture: stated risk factors (sector, regulatory, concentration, liquidity, interest-rate), " +
    "asset-quality watch points (specific cohort or segment concerns, NPA trajectory commentary), " +
    "macro / sector headwinds (interest rate cycle, competitive pressure, regulatory tightening), " +
    "management's forward-looking outlook (growth guidance, margin guidance, expansion plans). " +
    "For each, quote the exact source text. Skip generic 'standard risks' boilerplate.",

  mix_and_geography:
    "Extract structured portfolio composition data from this document. Capture: " +
    "ASSET / PRODUCT MIX — percentage share of AUM by product type (home loan, loan against property / LAP, MSME, construction loan, top-up, other). " +
    "CUSTOMER / BORROWER MIX — percentage by self-employed vs salaried, formal vs informal income, rural vs semi-urban vs urban. " +
    "GEOGRAPHIC CONCENTRATION — top 3-5 states by AUM share, with the state name and percentage; total state count. " +
    "FUNDING MIX — borrowings by source as a percentage of total borrowings (bank borrowings, NCDs, NHB refinance, securitization, ECB, other), and the weighted average cost of funds %. " +
    "For every percentage, quote the EXACT source text with the period label. Numbers expressed as decimal % (e.g. 78 not '78%'). " +
    "Skip narrative; only structured / tabular composition data.",
};

export async function multiExtract(
  picks: { company: string; doc: PickedDoc }[],
  signal?: AbortSignal,
): Promise<ExtractedBundle> {
  const urls = picks.map((p) => p.doc.url);
  const urlToCompany = new Map(picks.map((p) => [p.doc.url, p.company]));
  const urlToTitle = new Map(picks.map((p) => [p.doc.url, p.doc.title]));

  // Fire one /extract call per objective, in parallel.
  const results = await Promise.all(
    EXTRACT_OBJECTIVES.map(async (objective) => {
      const objectivePrompt = OBJECTIVE_PROMPTS[objective];
      try {
        const { results: extractResults } = await extractUrls(urls, objectivePrompt, signal);
        return [objective, extractResults] as const;
      } catch (err) {
        console.warn(`[multi-extract] objective="${objective}" failed:`, err instanceof Error ? err.message : err);
        return [objective, [] as ExtractResult[]] as const;
      }
    }),
  );

  const byObjective: Record<ExtractObjective, ExtractResult[]> = {
    numbers: [],
    strategy: [],
    performance: [],
    risk_outlook: [],
    mix_and_geography: [],
  };
  for (const [objective, extracts] of results) byObjective[objective] = extracts;

  return { byObjective, urlToCompany, urlToTitle };
}

/** Group extracts by company within a single objective. */
export function extractsByCompany(
  bundle: ExtractedBundle,
  objective: ExtractObjective,
): Map<string, ExtractResult[]> {
  const out = new Map<string, ExtractResult[]>();
  for (const r of bundle.byObjective[objective]) {
    const company = bundle.urlToCompany.get(r.url);
    if (!company) continue;
    if (r.fullContent.length === 0) continue;
    const existing = out.get(company) ?? [];
    existing.push(r);
    out.set(company, existing);
  }
  return out;
}
