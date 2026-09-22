/**
 * LLM-based IR document picker.
 *
 * Given the harvested {url, title, sectionContext} list per company and the
 * requested timeScope, ask OpenAI to choose the 3 most relevant PDFs to extract.
 * No regex pile, no per-naming-convention rules — the LLM handles every IR-page
 * variant naturally given URL, title, and section breadcrumb.
 */

import type { IRDocument } from "./ir-crawler";
import { generateText, type ModelId } from "@/lib/llm";

export type TimeScope = "latest" | "last_2_quarters" | "last_year" | "last_2_years" | "last_3_years";

export type DocType =
  | "quarterly_results"
  | "annual_report"
  | "investor_presentation"
  | "transcript"
  | "press_release"
  | "rating"
  | "other";

export interface PickedDoc {
  url: string;
  title: string;
  type: DocType;
  period?: string;
  reason: string;
  sectionContext?: string;
}

const SYSTEM_PROMPT = `You are picking the most relevant PDFs to extract for a competitor research report on a single company.

Indian fiscal year convention: April to March. FY26 = April 2025 - March 2026 (full year). FY25 = April 2024 - March 2025.

Time-scope picking guide:
- "latest" → 2 docs: (a) most recent full-year audited results OR most recent quarterly result, (b) latest investor presentation / earnings deck.
- "last_year" → 2-3 docs: (a) most recent full-year audited results / annual report, (b) latest investor presentation, (c) most recent quarterly if not covered.
- "last_2_quarters" → 3 docs: (a) latest quarterly, (b) prior quarterly, (c) latest investor presentation.
- "last_2_years" → 3 docs: (a) most recent full-year/Q4 audited results (or current-year annual report if available), (b) prior-year annual report or Q4 audited results, (c) latest investor presentation for narrative.
- "last_3_years" → 3 docs: (a)(b)(c) most recent three full-year reports.

STRONGLY PREFER (in this priority order):
  1. "Audited Financial Results for the year ended 31st March YYYY" type docs (full-year audit) — single best source for annual financials
  2. Annual Reports (full integrated report — covers strategy, MD&A, full P&L)
  3. Q4 quarterly results (give full-year numbers as the balancing figure)
  4. Investor presentations / earnings decks (carry the narrative, AUM, NIM, GNPA in compact form)
  5. Earnings call transcripts (only when no presentation available)

STRONGLY AVOID:
  - NCD / debenture interest payments, record dates, interest payment intimations
  - Shareholding pattern intimations
  - Board meeting *prior* intimations (the schedule, not the outcome)
  - Fair practice codes, KYC/AML policies, vigil mechanism, archival policies
  - CSR plans, sustainability reports (unless no other narrative doc exists)
  - Board committee composition, familiarisation programmes
  - Generic homepage / about / product PDFs
  - Annual returns (MGT-7) — these are statutory filings, not financial reports
  - AGM notices, voting results, scrutinizer reports (unless that's all that's available)

For "last_2_years" when today is during/after Q4 FY26 (April-July 2026), the ideal picks are:
  1. The Q4 FY26 audited results (year ended 31st March 2026) — covers full FY26
  2. The FY25 annual report OR Q4 FY25 audited results (year ended 31st March 2025) — covers full FY25
  3. The latest investor presentation (any quarter of FY26)

Output: JSON only, no prose, no markdown fences.
{
  "picks": [
    {
      "n": <doc number from input list>,
      "type": "quarterly_results" | "annual_report" | "investor_presentation" | "transcript" | "press_release" | "rating" | "other",
      "period": "<the most-recent FY/quarter the doc covers, e.g. 'FY26 Q4', 'FY25', 'Q3 FY 2025-26'>",
      "reason": "<one short sentence explaining why this is the right pick for its slot>"
    }
  ]
}`;

export async function pickDocsForCompany(
  companyName: string,
  docs: IRDocument[],
  timeScope: TimeScope,
  asOf: Date = new Date(),
  maxDocs: number = 3,
  modelId?: ModelId,
): Promise<PickedDoc[]> {
  if (docs.length === 0) return [];

  // Cap input list — pages with 200+ docs (Aavas, Home First, India Shelter) waste tokens
  // on shareholding-pattern noise. Drop obvious noise via title keyword filter (this is the
  // ONE place we use a lightweight filter, since it's a 90%-precision pre-filter, not an
  // attempt to fully classify).
  const filtered = docs.filter((d) => {
    const blob = `${d.title} ${d.sectionContext ?? ""} ${d.url}`.toLowerCase();
    if (/shareholding[\s-]?pattern|investor[\s-]?(complaint|grievance)|interest[\s-]?payment|record[\s-]?date|mgt-7|annual[\s-]?return\b/.test(blob)) {
      return false;
    }
    return true;
  });
  const inputDocs = filtered.length >= 3 ? filtered : docs;

  const todayStr = asOf.toISOString().slice(0, 10);
  const fyEnd = asOf.getUTCMonth() >= 3 ? asOf.getUTCFullYear() + 1 : asOf.getUTCFullYear();

  const userInput =
    `Company: ${companyName}\n` +
    `Time scope: ${timeScope}\n` +
    `Today: ${todayStr} (current Indian FY: FY${fyEnd % 100})\n` +
    `Max picks: ${maxDocs}\n\n` +
    `Documents (numbered — choose by 'n'):\n\n` +
    inputDocs
      .map(
        (d, i) =>
          `${i + 1}. URL: ${d.url}\n   Title: ${d.title}` +
          (d.sectionContext ? `\n   Section: ${d.sectionContext}` : ""),
      )
      .join("\n\n");

  const json = await generateText(userInput, {
    systemPrompt: SYSTEM_PROMPT,
    jsonMode: true,
    feature: "competitor_research.ir_pick",
    timeoutMs: 30_000,
    modelId,
  });

  const cleaned = json.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let parsed: { picks?: Array<{ n: number; type?: string; period?: string; reason?: string }> };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`IR picker returned invalid JSON for ${companyName}: ${err instanceof Error ? err.message : "unknown"}. Raw: ${json.slice(0, 200)}`);
  }
  if (!parsed.picks || !Array.isArray(parsed.picks)) {
    throw new Error(`IR picker for ${companyName} returned no "picks" array. Raw: ${json.slice(0, 200)}`);
  }

  const allowedTypes: DocType[] = [
    "quarterly_results", "annual_report", "investor_presentation", "transcript", "press_release", "rating", "other",
  ];

  const picks: PickedDoc[] = [];
  const seen = new Set<string>();
  for (const p of parsed.picks.slice(0, maxDocs)) {
    const idx = (p.n ?? 0) - 1;
    const doc = inputDocs[idx];
    if (!doc) continue;
    if (seen.has(doc.url)) continue;
    seen.add(doc.url);
    const type = (allowedTypes as string[]).includes(p.type ?? "") ? (p.type as DocType) : "other";
    picks.push({
      url: doc.url,
      title: doc.title,
      sectionContext: doc.sectionContext,
      type,
      period: p.period,
      reason: p.reason ?? "",
    });
  }
  return picks;
}
