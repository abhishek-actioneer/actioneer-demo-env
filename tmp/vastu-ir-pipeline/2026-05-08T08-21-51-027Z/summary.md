# Vastu IR-first competitor pipeline
- Query: compare Vastu Housing Finance to Aavas Financiers, Aptus Value Housing Finance, Home First Finance and India Shelter Finance on financials of last 2 years
- As of: 2026-05-08T08:21:51.029Z
- Synthesize: no (pass --synthesize)
- Extract mode: **multi-objective /extract** (4 batches: numbers, strategy, performance, risk → structured assembly)
- Output: `/Users/vimarsh/Documents/baby-sentinel/tmp/vastu-ir-pipeline/2026-05-08T08-21-51-027Z`

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
  - _Most recent audited full-year and Q4 financial results for the period ended March 31, 2026._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/financial-reports/Audited-Financial-Result-for-quarter-and-year-ended-31st-March-…
- [annual_report · FY25] ANNUAL REPORT 2024-25
  - _Comprehensive annual report for the prior fiscal year including management discussion and strategy narrative._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-24-25.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
- [annual_report · FY24] ANNUAL REPORT 2023-24
  - _Provides historical baseline and comparative performance data for the two-year lookback period._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-23-24.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
### Aavas Financiers
- [quarterly_results · FY26 Q4] Financial Result approved by the Board of Directors
  - _This is the most recent audited full-year and Q4 result available for the year ended March 31, 2026._
  - https://www.aavas.in/uploads/pdf/financials-85794283.pdf
- [quarterly_results · FY25 Q4] Financial Result approved by the Board of Directors
  - _This document represents the audited full-year results for the prior financial year (FY25), essential for a two-year comparison._
  - https://www.aavas.in/uploads/pdf/outcome-of-board-meetingq4-42612506.pdf
- [quarterly_results · FY26 Q3] Financial Result approved by the Board of Directors
  - _Provides the most recent quarterly narrative and performance trend leading up to the full-year FY26 results._
  - https://www.aavas.in/uploads/pdf/outcome-46562990.pdf
### Aptus Value Housing Finance
- [annual_report · FY25] Annual Report 2024-2025
  - _This is the most recent available full-year integrated report covering the company's financial performance and strategic outlook for the year ending March 2025._
  - https://aptusindia.s3.us-east-1.amazonaws.com/Aptus_AR_Mar+2025.pdf
- [annual_report · FY24] Annual Report 2023-2024
  - _This provides the comparative full-year audited financials and management discussion for the prior year, satisfying the two-year research scope._
  - https://aptusindia.s3.amazonaws.com/Aptus+Value+Housing+Finance+India+Ltd_Annual+Report+FY24.pdf
### Home First Finance
- [annual_report · FY25] Annual Report 2024-25
  - _This is the most recent integrated annual report, providing comprehensive audited financials and strategic depth for the full fiscal year 2024-25._
  - https://homefirstindia.com/files/Integrated%20Annual%20Report%20FY25.pdf
- [investor_presentation · FY26 Q4] Investor Presentation
  - _This is the most recent investor deck covering the full-year FY26 performance, narrative, and key operational metrics like AUM and asset quality._
  - https://homefirstindia.com/files/Investor%20Deck%20Q4FY26.pdf
- [press_release · FY26 Q4] Investor Press Release
  - _This document contains the finalized financial results and summary tables for the full year ended March 31, 2026._
  - https://homefirstindia.com/files/HomeFirst_Q4FY26_Press_Release.pdf
### India Shelter Finance
- [quarterly_results · FY26 Q4] Financial Results March 2026
  - _This document contains the audited financial results for the full year ended March 31, 2026, providing the most recent annual data._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777707511562-Financial+Results+March+2026.pdf
- [annual_report · FY25] Integrated Annual Report- 2024-25
  - _This is the complete integrated annual report for the previous fiscal year, containing detailed management discussion and financial disclosures._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1751527210017-Integrated+Annual+Report-+2024-25.pdf
- [investor_presentation · FY26 Q4] Investor Presentation March 2026
  - _The latest investor presentation provides narrative context, strategy updates, and visual breakdown of key metrics like AUM and asset quality for the most recent period._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777716210890-Investor%20Presentation%20intimation%20%283%29.pdf
- Total picked: **14** docs across 5 companies
- 21.0s

## Stage C — Multi-objective extract (4 batches: numbers, strategy, performance, risk_outlook)
- `numbers`: 12 extracts, 1,00,003 total chars
- `strategy`: 12 extracts, 99,891 total chars
- `performance`: 12 extracts, 99,396 total chars
- `risk_outlook`: 12 extracts, 99,657 total chars
- 73.3s

## Stage D — Structured extract per company (Gemini, 4 calls × 5 companies in parallel)
### Vastu Housing Finance
- Financials: 3 period rows · Strategic moves: 6 · Performance items: 9 · Risk items: 10
- Top period `FY25`: 14 fields populated
### Aavas Financiers
- Financials: 5 period rows · Strategic moves: 4 · Performance items: 7 · Risk items: 8
- Top period `Q2 FY26`: 5 fields populated
### Aptus Value Housing Finance
- Financials: 5 period rows · Strategic moves: 4 · Performance items: 10 · Risk items: 10
- Top period `FY25`: 16 fields populated
### Home First Finance
- Financials: 6 period rows · Strategic moves: 6 · Performance items: 10 · Risk items: 11
- Top period `Q4 FY26`: 11 fields populated
### India Shelter Finance
- Financials: 5 period rows · Strategic moves: 5 · Performance items: 14 · Risk items: 7
- Top period `FY26`: 17 fields populated
- 75.4s

## Stage E — Deterministic report assembly (no LLM)
- Charts emitted: 4/4
  - ✓ AUM trend
  - ✓ PAT (latest)
  - ✓ GNPA over time
  - ✓ Branches
- 33,391 chars → `E-report.md`
- 0.0s

---
Done. Open `tmp/vastu-ir-pipeline/2026-05-08T08-21-51-027Z/E-report.md`
