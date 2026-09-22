/**
 * Prompt for the fallback URL picker.
 *
 * Used when the company's own IR page failed to yield extractable data (e.g.
 * Vastu HFC's pre-signed Oracle URLs that Parallel can't fetch). We run a
 * domain-scoped web search and ask OpenAI to pick the best alternate sources.
 *
 * The picker prefers primary filings (NSE/BSE archives, rating-agency reports)
 * over aggregators (screener.in, moneycontrol). Aggregators are accepted only
 * when no primary alternative is in the candidate set.
 */

export const FALLBACK_PICKER_PROMPT = `You are picking alternate sources for a company whose own IR page failed to yield data.

You will receive search results across credible third-party domains. Pick AT MOST 3 URLs that will best fill the financial-data gap for this company.

PRIORITY ORDER:
  1. Stock-exchange filings — nseindia.com, nsearchives.nseindia.com, bseindia.com (primary regulatory filings, even for unlisted debt issuers)
  2. Credit-rating reports — careratings.com, careedge.in, crisil.com, icra.in, indiaratings.co.in (these restate company financials with analyst commentary)
  3. Structured financial aggregators — screener.in (preferred — full P&L/BS tables), moneycontrol.com (acceptable)
  4. Reputable financial news — livemint.com, business-standard.com, economictimes.indiatimes.com (only for narrative / strategic moves, not headline financials)

STRONGLY PREFER:
  - PDFs over HTML pages (more likely to contain audited tables)
  - More recent dates (use publish_date if available)
  - URLs whose title mentions: "audited results", "annual report", "FY", "Q1/Q2/Q3/Q4", "rating rationale", "credit profile"

STRONGLY AVOID:
  - Social media (any X / Twitter / LinkedIn / Facebook / Instagram / YouTube)
  - Wikipedia
  - Generic homepages or product pages (e.g. screener.in/ or moneycontrol.com/)
  - Paywalled article stubs where excerpts contain no actual numbers
  - Press-release lists or news archives without a specific dated filing

If fewer than 3 candidates meet the bar, return what you have — even 1 good source beats 3 weak ones.

Output: JSON only, no prose, no markdown fences.
{
  "picks": [
    {
      "n": <result number from input list>,
      "type": "quarterly_results" | "annual_report" | "investor_presentation" | "transcript" | "press_release" | "rating" | "other",
      "period": "<most-recent FY/quarter the doc covers, e.g. 'FY26 Q4', 'FY25'>",
      "reason": "<one short sentence explaining why this fills the gap>"
    }
  ]
}`;
