/**
 * Wraps a user's competitor-research question with a structured report spec
 * for Parallel's Deep Research Task API.
 *
 * Stays under Parallel's 15,000-char input limit (cap user message at 12,000 chars).
 */

const REPORT_SPEC = `Produce a competitor comparison report. Focus on FINANCIALS and STRATEGY.

SOURCING PRIORITY — for every financial number, walk this hierarchy in order; only fall back to the next tier if the higher tier is unavailable.

Tier 1 — Company-issued primary sources (BEST):
- The company's own Investor Relations / Financials / Financial Reports / Disclosures page (links almost always in the FOOTER of the company website; sometimes under "Investors" in the header). Examples: vastuhfc.com/financial-reports, aavas.in/investor-relations, aptusindia.com/investor-relations, homefirstindia.com/investor-relations.
- The actual PDFs hosted there: annual reports, audited Q4/Q3/Q2/Q1 results, investor presentations, press releases.

Tier 2 — Stock-exchange filings (also primary):
- nsearchives.nseindia.com or bseindia.com archives for any listed Indian NBFC / HFC / fintech. These are official regulatory submissions of the same numbers.
- Credit-rating agency reports (CARE, CRISIL, ICRA) — careratings.com, icra.in, crisil.com — when they restate company financials, they're authoritative.

Tier 3 — Reputable financial data sites (acceptable when Tier 1/2 not surfaced):
- screener.in, scanx.trade, tipranks.com, moneycontrol.com, livemint.com, economictimes.indiatimes.com, business-standard.com, bullscreen.in, gurufocus.com.
- These often summarize the same numbers from Tier 1/2. Use them BEFORE falling back to "data unavailable".

Tier 4 — News articles (acceptable for strategic moves, not for headline financials):
- Use for M&A announcements, leadership changes, geographic expansion, branch milestones, regulatory actions. NOT for AUM / revenue / PAT / NPA numbers unless no Tier 1-3 source is available.

DO NOT trust as primary financial sources: Facebook posts, Instagram reels, X (Twitter), random blog posts, paywalled stub articles where the number isn't in the visible text.

CRITICAL: NEVER write "Data unavailable" if you have not yet checked Tier 3. If a metric is genuinely missing across all four tiers for a competitor, write "N/D" (not disclosed) with a one-line note explaining what you searched. The goal is a COMPLETE comparison table — partial cells are a worse outcome than slightly-less-recent numbers from a Tier 3 source.

When citing a number, prefer the higher-tier URL — but always cite SOMETHING.

REPORT STRUCTURE (use exact section headings):
# {Subject company} vs Peers
## Snapshot
A markdown table comparing the subject company to each competitor on the most relevant metrics for their sector, **as of the latest reported quarter / fiscal year you found in primary sources**. Note the period (e.g. "Q4 FY26") in the column header. Use whichever metrics the public data supports (e.g. revenue, AUM, PAT, growth %, NPAs, capital adequacy, branch count — pick what's actually disclosed).

## Where {Subject} is ahead
3–5 short bullets, each citing a primary-source URL.

## Where competitors are ahead
3–5 short bullets, each citing a primary-source URL.

## Recent strategic moves (last 6 months)
For each company: 1–3 bullets on launches, M&A, leadership changes, geographic expansion, or notable news. Cite sources (news/press is acceptable here, but link directly to the press release where possible).

## Sources
Bulleted list of all URLs cited above. **Group by company.** For each company, list the primary-source documents (annual report PDF, investor presentation, audited results) FIRST, then secondary sources. Note publish dates where known.

GENERAL RULES:
- Cite EVERY number with an inline source link in markdown.
- If competitors are not named in the user's request, infer 3–4 from the sector and proceed.
- If the subject company can't be identified, return a one-paragraph response asking for clarification — do NOT fabricate a report.
- Keep the report under 1800 words. Tables and bullets are preferred over prose.`;

const MAX_USER_MESSAGE_CHARS = 12_000;

export function buildCompetitorResearchInput(userMessage: string): string {
  const trimmed = userMessage.slice(0, MAX_USER_MESSAGE_CHARS);
  return `${REPORT_SPEC}\n\n---\n\nUSER REQUEST:\n${trimmed}`;
}
