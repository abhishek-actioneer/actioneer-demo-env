/**
 * Pipeline prompts for the explicit competitor-research workflow:
 *   plan → query-gen → search → url-pick → extract → synthesize
 *
 * Each prompt is small and single-purpose so the pipeline stages are independent
 * and the LLM stays focused.
 */

// ── Stage 1: Plan ──

export const PLAN_PROMPT = `You are planning a competitor-research run.

Given the user's request, return a JSON object identifying:
- "ownCompany": { name, websiteGuess?, sector } — the company the user is asking ABOUT (often "us" / "our")
- "competitors": [{ name, websiteGuess? }] — STRICT rule: if the user named ANY specific competitor(s), use EXACTLY those names — do NOT add additional peers, do NOT pad. Only infer peers when the user named ZERO competitors (e.g. "compare us to peers" / "research competitors") — then infer 3-4.
- "timeScope": one of "latest" | "last_2_quarters" | "last_year" | "last_2_years" | "last_3_years" — derived from the user's request. Examples:
    * "compare us on financials" → "latest"
    * "compare us on financials of last 2 years" → "last_2_years"
    * "compare YoY trends" → "last_2_years"
    * "show last 4 quarters" → "last_2_quarters" (rounded to nearest)
- "focusAreas": ["financials", "strategy"] — fixed for v1, always return both.

For each company, provide a websiteGuess if you have high confidence (e.g. "vastuhfc.com", "aavas.in"). Leave undefined if uncertain.

Return ONLY a JSON object, no prose, no markdown fences.

Example A — user named exactly 1 competitor (DO NOT add others):
User: "compare Vaastu Housing Finance to Avanse Financial Services on financials of last 2 years"
{"ownCompany":{"name":"Vastu Housing Finance","websiteGuess":"vastuhfc.com","sector":"Indian housing finance / NBFC"},"competitors":[{"name":"Avanse Financial Services","websiteGuess":"avanse.com"}],"timeScope":"last_2_years","focusAreas":["financials","strategy"]}

Example B — user named no competitors (infer 3-4):
User: "research our competitors in housing finance and benchmark our growth"
{"ownCompany":{"name":"Vastu Housing Finance","websiteGuess":"vastuhfc.com","sector":"Indian housing finance / NBFC"},"competitors":[{"name":"Aavas Financiers","websiteGuess":"aavas.in"},{"name":"Aptus Value Housing Finance","websiteGuess":"aptusindia.com"},{"name":"Home First Finance","websiteGuess":"homefirstindia.com"}],"timeScope":"latest","focusAreas":["financials","strategy"]}`;

// ── Stage 2: Generate search queries per company ──

export const QUERY_GEN_PROMPT = `You are generating Parallel Search queries for one company in a competitor-research pipeline.

Given the company name, optional websiteGuess, sector, and TIME SCOPE, produce 3-5 search queries optimized for finding PRIMARY-SOURCE financial documents. Each query should be 4-12 words.

Return JSON: {"queries": [{ "lane": "ir_landing" | "latest_results" | "historical_results" | "strategy_news", "query": string }]}

Lane meanings:
- "ir_landing" — find the company's investor-relations / financial-reports landing page (helpful for discovering links to specific PDFs)
- "latest_results" — find the most recent quarterly/annual audited result PDF
- "historical_results" — for time scopes other than "latest", search for prior-period reports (e.g. last year's annual report, FY24 results)
- "strategy_news" — recent strategic moves, M&A, leadership, expansion (for narrative)

Time scope rules:
- "latest" → 1 ir_landing + 1 latest_results + 1 strategy_news (3 queries)
- "last_2_quarters" → 1 ir_landing + 2 latest_results (different quarters) + 1 strategy_news (4 queries)
- "last_year" → 1 ir_landing + 1 latest_results + 1 historical_results (annual report) + 1 strategy_news (4 queries)
- "last_2_years" → 1 ir_landing + 1 latest_results (most recent FY) + 1 historical_results (prior FY annual report) + 1 strategy_news (4 queries)
- "last_3_years" → 1 ir_landing + 1 latest_results + 2 historical_results (FY-1 + FY-2 annual reports) + 1 strategy_news (5 queries)

Make queries SPECIFIC. Include the actual fiscal year / quarter you want. Use site: operator when you have a confident websiteGuess.

Examples for "Aavas Financiers" with website "aavas.in":

Time scope = "last_2_years":
{"queries":[
  {"lane":"ir_landing","query":"Aavas Financiers investor relations site:aavas.in"},
  {"lane":"latest_results","query":"Aavas Financiers FY26 annual report investor presentation pdf"},
  {"lane":"historical_results","query":"Aavas Financiers FY25 annual report pdf"},
  {"lane":"strategy_news","query":"Aavas Financiers 2026 expansion leadership announcements"}
]}

Time scope = "latest":
{"queries":[
  {"lane":"ir_landing","query":"Aavas Financiers investor relations site:aavas.in"},
  {"lane":"latest_results","query":"Aavas Financiers Q4 FY26 audited results pdf"},
  {"lane":"strategy_news","query":"Aavas Financiers 2026 strategic moves"}
]}

Adapt sector terminology to the company. For SaaS use ARR, ACV. For banks use NIM, CASA. For HFCs use AUM, NPA, GNPA.
Return ONLY JSON, no prose, no markdown fences.`;

// ── Stage 3: Pick URLs to extract from search results ──

export const URL_PICKER_PROMPT = `You are picking which URLs to extract for the next pipeline stage.

You will be given search results grouped by company. For each company, pick AT MOST 3 URLs to extract.

CRITICAL RULES:

1. **NEVER pick a generic homepage or product/category landing page.** These extract to empty content (only navigation chrome and lead-capture forms). Examples to ALWAYS REJECT:
   - https://{company}.com/
   - https://{company}.com/about
   - https://{company}.com/products
   - https://{company}.com/home-loans
   - https://{company}.com/ratings
   - https://{company}.com/contact

2. **STRONGLY prefer URLs that point to a SPECIFIC DOCUMENT.** Look for these signals in the URL:
   - Ends in .pdf
   - Path contains: "annual-report", "investor-presentation", "investor-deck", "audited", "results", "outcome", "earnings", "Q1"/"Q2"/"Q3"/"Q4"/"FY24"/"FY25"/"FY26", "press-release", "intimation", "filing"
   - Hosted at nsearchives.nseindia.com or bseindia.com (stock exchange archives are ALWAYS specific filings)
   - Hosted at credit-rating sites (careratings.com, icra.in, crisil.com) with /Rating/ or /CompanyFiles/ in path

3. **The investor-relations LANDING page is acceptable ONLY as a last resort.** If the search results contain a specific PDF, prefer the PDF over the IR landing page. The IR landing page (e.g. /investor-relations, /financial-reports) typically returns navigation only when extracted.

PRIORITY ORDER (within "specific document" candidates):
- Priority 1: PDFs on the company's own domain matching financial-result keywords
- Priority 2: PDFs on stock-exchange archives (NSE/BSE)
- Priority 3: PDFs on credit-rating sites (CARE, CRISIL, ICRA)
- Priority 4: Specific data pages on aggregators (screener.in, moneycontrol.com — only when no PDF available)

ALWAYS REJECT:
- Social media (facebook.com, instagram.com, twitter.com, x.com, linkedin.com, youtube.com)
- Wikipedia
- Generic homepages or product/category landing pages (per Rule 1)
- Paywalled article stubs
- Duplicate content (two news articles saying the same thing — pick the most authoritative one)

Return JSON:
{"selections": [{ "company": string, "url": string, "reason": string, "priority": 1 | 2 | 3 | 4 }]}

If a company has fewer than 3 acceptable URLs after applying these rules, return WHAT YOU HAVE — even just 1 good PDF beats 3 generic landing pages.

Return ONLY JSON, no prose, no markdown fences.`;

// ── Stage 4: Synthesis prompt (streamed) ──

export const SYNTHESIZE_PROMPT = `You are writing the final competitor-research report from extracted source content.

You will receive:
- The user's original request
- A planning summary (own company, competitors, sector, time scope)
- For each company: extracted markdown content from 1-3 primary sources, with source URLs

Your job: produce a markdown comparison report.

TIME SCOPE — pay close attention to the planning summary's "timeScope" field. It tells you what period(s) to compare:
- "latest" → single-period snapshot of the most recent reported quarter / fiscal year
- "last_2_quarters" → show 2 most recent quarters side by side, plus QoQ delta
- "last_year" → show full last fiscal year, with key quarterly waypoints
- "last_2_years" → show last 2 full fiscal years (e.g. FY25 and FY26 columns), surface YoY growth rates explicitly
- "last_3_years" → show last 3 full fiscal years with YoY growth rates and any inflection points

REPORT STRUCTURE (use exact headings):

# {Subject company} vs Peers

## Snapshot
A markdown table comparing all companies side-by-side. Structure depends on timeScope:
- For "latest": columns are companies; rows are metrics. Include the reporting period in the column header (e.g. "Aavas (Q4 FY26)").
- For "last_2_years" or longer: include period in row labels (e.g. "AUM (FY25)", "AUM (FY26)", "AUM YoY %"). Make growth rates explicit rows.
- For "last_2_quarters": columns are companies, rows are metrics × quarter (e.g. "AUM Q3 FY26", "AUM Q4 FY26", "AUM QoQ %").

Pick metrics based on what's actually disclosed AND what the sector benchmarks on. For Indian NBFCs/HFCs: AUM, Net Interest Income, PAT, GNPA %, NIM, branch count, capital adequacy. For SaaS: ARR, NRR, customer count, gross margin. For marketplaces: GMV, take rate, MAUs.

If a metric is missing for one company, write "—" (em-dash) and add a footnote like "[a]" referring to a source-not-found note immediately after the table.

## Where {Subject} is ahead
3-5 short bullets, each citing the source URL inline as a markdown link. Compare specific numbers, not vague claims. For multi-year scopes: highlight where {Subject}'s GROWTH RATE (not just absolute value) leads.

## Where competitors are ahead
3-5 short bullets, same shape.

## Recent strategic moves (last 6 months)
Per company: 1-3 bullets. Geographic expansion, leadership changes, M&A, regulatory actions, product launches, capital raises. Cite source URL inline.

## Sources
Bulleted list, **grouped by company**. List PRIMARY sources (PDF, IR page) first, then secondary. Note publish dates where extracted.

CRITICAL RULES:
- Cite EVERY number with the source URL.
- NEVER fabricate numbers. If it's not in the extracted content, write "—" and add a footnote.
- NEVER use information from your training data. ONLY use what's in the extracted content for THIS run.
- Keep under 1800 words. Tables and bullets, not paragraphs.
- If the extracted content for a company is too thin to populate the table (e.g. only website navigation, product pages, no actual financial figures), say so EXPLICITLY in a footnote — don't pad with hallucinated numbers, and don't mark "Data unavailable" for the company without explaining what was missing in the source.
- For multi-year requests: if you only have ONE year of data for some company, note this in a footnote and don't fabricate prior-year numbers.`;

// ── Helpers to build complete inputs ──

export type TimeScope = "latest" | "last_2_quarters" | "last_year" | "last_2_years" | "last_3_years";

export interface PlanResult {
  ownCompany: { name: string; websiteGuess?: string; sector: string };
  competitors: { name: string; websiteGuess?: string }[];
  timeScope: TimeScope;
  focusAreas: string[];
}

export interface QueryGenResult {
  queries: { lane: "ir_landing" | "latest_results" | "strategy_news"; query: string }[];
}

export interface UrlPickerResult {
  selections: { company: string; url: string; reason: string; priority: 1 | 2 | 3 }[];
}

export function buildSynthesisInput(
  userMessage: string,
  plan: PlanResult,
  perCompanyContent: { company: string; sources: { url: string; title: string; publishDate?: string; content: string }[] }[],
): string {
  const sections: string[] = [];
  sections.push(`USER REQUEST:\n${userMessage}`);
  sections.push(
    `PLAN:\n- Subject: ${plan.ownCompany.name} (${plan.ownCompany.sector})\n- Competitors: ${plan.competitors.map((c) => c.name).join(", ")}\n- Time scope: ${plan.timeScope}\n- Focus: ${plan.focusAreas.join(", ")}`,
  );
  for (const company of perCompanyContent) {
    sections.push(`\n=== ${company.company} ===`);
    if (company.sources.length === 0) {
      sections.push("(No sources successfully extracted for this company.)");
      continue;
    }
    for (const src of company.sources) {
      const dateStr = src.publishDate ? ` (published ${src.publishDate})` : "";
      sections.push(`\n--- SOURCE: ${src.title}${dateStr}\nURL: ${src.url}\n\n${src.content.slice(0, 8000)}`);
    }
  }
  return sections.join("\n\n");
}
