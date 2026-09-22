# Vastu IR-first competitor pipeline
- Query: compare Vastu Housing Finance to Aavas Financiers, Aptus Value Housing Finance, Home First Finance and India Shelter Finance on financials of last 2 years
- As of: 2026-05-08T08:15:06.618Z
- Synthesize: no (pass --synthesize)
- Extract mode: **multi-objective /extract** (4 batches: numbers, strategy, performance, risk → structured assembly)
- Output: `/Users/vimarsh/Documents/baby-sentinel/tmp/vastu-ir-pipeline/2026-05-08T08-15-06-615Z`

## Stage A — IR crawl (5 companies in parallel)
### Vastu Housing Finance
- Source: `footer` · Docs harvested: **74**
- IR page: https://www.vastuhfc.com/financial-reports
### Aavas Financiers
- Source: `header` · Docs harvested: **32**
- IR page: https://www.aavas.in/investor-relations/financial-results
### Aptus Value Housing Finance
- Source: `header` · Docs harvested: **14**
- IR page: https://aptusindia.com/annual-reports
### Home First Finance
- Source: `footer` · Docs harvested: **200**
- IR page: https://homefirstindia.com/investor-relations
### India Shelter Finance
- Source: `header` · Docs harvested: **200**
- IR page: https://indiashelter.in/investor-relations
- 2.6s

## Stage B — Doc picker (LLM, timeScope=`last_2_years`)
### Vastu Housing Finance
- [quarterly_results · FY26] Audited Financial Result for quarter and year ended 31st March 2026
  - _This doc provides the most recent full-year audited financial results for the fiscal year ended March 31, 2026._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/financial-reports/Audited-Financial-Result-for-quarter-and-year-ended-31st-March-…
- [annual_report · FY25] ANNUAL REPORT 2024-25
  - _This is the complete annual report for the previous fiscal year, containing detailed strategic narrative and audited financials._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-24-25.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
- [annual_report · FY24] ANNUAL REPORT 2023-24
  - _This annual report covers the fiscal year prior to last, providing the necessary comparative data for a two-year performance analysis._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-23-24.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
### Aavas Financiers
- [quarterly_results · FY26] Financial Result approved by the Board of Directors
  - _This is the most recent audited full-year financial result for the year ended March 31, 2026, providing the latest annual performance data._
  - https://www.aavas.in/uploads/pdf/financials-85794283.pdf
- [quarterly_results · FY25] Financial Result approved by the Board of Directors
  - _This contains the audited full-year results for the previous fiscal year ended March 31, 2025, essential for year-on-year comparison._
  - https://www.aavas.in/uploads/pdf/outcome-of-board-meetingq4-42612506.pdf
- [quarterly_results · FY26 Q3] Financial Result approved by the Board of Directors
  - _This provides the quarterly narrative and detailed financial breakdown for the third quarter of the most recent fiscal year._
  - https://www.aavas.in/uploads/pdf/outcome-46562990.pdf
### Aptus Value Housing Finance
- [annual_report · FY25] Annual Report 2024-2025
  - _This is the most recent full-year integrated report available, providing audited financials and strategic commentary for the year ended March 2025._
  - https://aptusindia.s3.us-east-1.amazonaws.com/Aptus_AR_Mar+2025.pdf
- [annual_report · FY24] Annual Report 2023-2024
  - _Provides the audited financial results and MD&A for the preceding fiscal year, essential for a two-year comparative analysis._
  - https://aptusindia.s3.amazonaws.com/Aptus+Value+Housing+Finance+India+Ltd_Annual+Report+FY24.pdf
- [annual_report · FY23] Annual Report 2022-2023
  - _Offers an additional year of historical data to establish financial trends in the absence of more recent quarterly decks or presentations._
  - https://aptusindia.s3.amazonaws.com/Aptus_AR_2022-23.pdf
### Home First Finance
- [annual_report · FY25] Annual Report 2024-25
  - _This is the complete integrated annual report for the previous fiscal year, providing full audited financials and management discussion._
  - https://homefirstindia.com/files/Integrated%20Annual%20Report%20FY25.pdf
- [investor_presentation · FY26 Q4] Investor Presentation
  - _This is the most recent investor deck covering the full-year FY26 performance and narrative strategy._
  - https://homefirstindia.com/files/Investor%20Deck%20Q4FY26.pdf
- [press_release · FY26 Q4] Investor Press Release
  - _Provides the audited financial summary and key metrics for the full year ended March 31, 2026._
  - https://homefirstindia.com/files/HomeFirst_Q4FY26_Press_Release.pdf
### India Shelter Finance
- [quarterly_results · FY26 Q4] Financial Results March 2026
  - _This doc contains the audited financial results for the full year ended March 2026, covering the most recent fiscal year._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777707511562-Financial+Results+March+2026.pdf
- [annual_report · FY25] Integrated Annual Report- 2024-25
  - _This is the integrated annual report for the prior fiscal year, providing deep narrative on strategy, MD&A, and full-year financials._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1751527210017-Integrated+Annual+Report-+2024-25.pdf
- [investor_presentation · FY26 Q4] Investor Presentation March 2026
  - _This is the latest investor deck providing the compact narrative, AUM trends, and key performance indicators for the full year FY26._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777716210890-Investor%20Presentation%20intimation%20%283%29.pdf
- Total picked: **15** docs across 5 companies
- 16.9s

## Stage C — Multi-objective extract (4 batches: numbers, strategy, performance, risk_outlook)
- `numbers`: 14 extracts, 1,00,205 total chars
- `strategy`: 14 extracts, 1,00,314 total chars
- `performance`: 14 extracts, 99,963 total chars
- `risk_outlook`: 14 extracts, 1,00,242 total chars
- 35.6s

## Stage D — Structured extract per company (Gemini, 4 calls × 5 companies in parallel)
### Vastu Housing Finance
- Financials: 0 period rows · Strategic moves: 4 · Performance items: 7 · Risk items: 10
### Aavas Financiers
- Financials: 0 period rows · Strategic moves: 6 · Performance items: 5 · Risk items: 8
### Aptus Value Housing Finance
- Financials: 4 period rows · Strategic moves: 2 · Performance items: 9 · Risk items: 11
- Top period `FY25`: 16 fields populated
### Home First Finance
- Financials: 0 period rows · Strategic moves: 0 · Performance items: 10 · Risk items: 11
### India Shelter Finance
- Financials: 0 period rows · Strategic moves: 6 · Performance items: 11 · Risk items: 11
- 41.0s

## Stage E — Deterministic report assembly (no LLM)
- Charts emitted: 2/4
  - ✓ AUM trend
  - ✗ PAT (latest)
  - ✓ GNPA over time
  - ✗ Branches
- 26,537 chars → `E-report.md`
- 0.0s

---
Done. Open `tmp/vastu-ir-pipeline/2026-05-08T08-15-06-615Z/E-report.md`
