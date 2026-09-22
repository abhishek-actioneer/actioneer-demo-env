# Vastu IR-first competitor pipeline
- Query: compare Vastu Housing Finance to Aavas Financiers, Aptus Value Housing Finance, Home First Finance and India Shelter Finance on financials of last 2 years
- As of: 2026-05-08T09:07:23.437Z
- Synthesize: no (pass --synthesize)
- Extract mode: **multi-objective /extract** (4 batches: numbers, strategy, performance, risk → structured assembly)
- Output: `/Users/vimarsh/Documents/baby-sentinel/tmp/vastu-ir-pipeline/2026-05-08T09-07-23-433Z`

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
- 2.7s

## Stage B — Doc picker (LLM, timeScope=`last_2_years`)
### Vastu Housing Finance
- [quarterly_results · FY26] Audited Financial Result for quarter and year ended 31st March 2026
  - _This is the most recent audited financial report covering the full fiscal year ended March 2026, providing the latest data for the research._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/financial-reports/Audited-Financial-Result-for-quarter-and-year-ended-31st-March-…
- [annual_report · FY25] ANNUAL REPORT 2024-25
  - _This comprehensive integrated report for FY25 includes the MD&A and strategic overview missing from simple financial tables._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-24-25.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
- [annual_report · FY24] ANNUAL REPORT 2023-24
  - _Provides a historical baseline for year-on-year comparison and strategic trajectory analysis across the requested two-year window._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-23-24.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
### Aavas Financiers
- [quarterly_results · FY26] Financial Result approved by the Board of Directors
  - _This is likely the most recent audited full-year and Q4 result for the fiscal year ended March 31, 2026, as it is the top-listed result near the current date of May 2026._
  - https://www.aavas.in/uploads/pdf/financials-85794283.pdf
- [quarterly_results · FY25] Financial Result approved by the Board of Directors
  - _This document covers the Q4 and audited full-year results for the previous fiscal year (FY25), identified by the 'q4' slug and chronological placement._
  - https://www.aavas.in/uploads/pdf/outcome-of-board-meetingq4-42612506.pdf
- [quarterly_results · FY24] Financial Result approved by the Board of Directors
  - _This is the audited full-year result for FY24 (ended March 31, 2024), providing the necessary historical comparison for a two-year scope._
  - https://www.aavas.in/uploads/pdf/finaloutcome25042024-1252982600.pdf
### Aptus Value Housing Finance
- [annual_report · FY25] Annual Report 2024-2025
  - _This is the most recent full-year integrated annual report covering audited financials and strategy for the fiscal year ended March 2025._
  - https://aptusindia.s3.us-east-1.amazonaws.com/Aptus_AR_Mar+2025.pdf
- [annual_report · FY24] Annual Report 2023-2024
  - _This provides the audited financials and management discussion for the prior fiscal year, completing the two-year comparison scope._
  - https://aptusindia.s3.amazonaws.com/Aptus+Value+Housing+Finance+India+Ltd_Annual+Report+FY24.pdf
### Home First Finance
- [investor_presentation · FY26 Q4] Investor Presentation
  - _This is the most recent investor presentation covering full-year performance and strategy for the fiscal year ended March 2026._
  - https://homefirstindia.com/files/Investor%20Deck%20Q4FY26.pdf
- [annual_report · FY25] Annual Report 2024-25
  - _The most recent integrated annual report provides comprehensive audited financials and management discussion for the prior full fiscal year._
  - https://homefirstindia.com/files/Integrated%20Annual%20Report%20FY25.pdf
- [annual_report · FY24] Annual Report 2023-24
  - _This annual report provides the necessary audited historical data to complete the two-year comparative trend analysis for competitor research._
  - https://homefirstindia.com/files/Annual%20Report%202023-24.pdf
### India Shelter Finance
- [quarterly_results · FY26] Financial Results March 2026
  - _This document provides the most recent audited full-year financial results for the year ended March 31, 2026._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777707511562-Financial+Results+March+2026.pdf
- [annual_report · FY25] Integrated Annual Report- 2024-25
  - _This is the integrated annual report for the previous financial year, offering comprehensive data on strategy and performance._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1751527210017-Integrated+Annual+Report-+2024-25.pdf
- [investor_presentation · FY26 Q4] Investor Presentation March 2026
  - _This is the latest investor presentation available, providing key narrative and operational metrics for the full year FY26._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777716210890-Investor%20Presentation%20intimation%20%283%29.pdf
- Total picked: **14** docs across 5 companies
- 19.4s

## Stage C — Multi-objective extract (4 batches: numbers, strategy, performance, risk_outlook)
- `numbers`: 12 extracts, 1,00,185 total chars
- `strategy`: 12 extracts, 1,00,195 total chars
- `performance`: 12 extracts, 1,00,367 total chars
- `risk_outlook`: 12 extracts, 99,575 total chars
- `mix_and_geography`: 12 extracts, 1,00,262 total chars
- 27.4s

## Stage D — Structured extract per company (Gemini, 4 calls × 5 companies in parallel)
### Vastu Housing Finance
- Financials: 3 period rows · Strategic moves: 6 · Performance items: 7 · Risk items: 10
- Top period `FY25`: 13 fields populated
### Aavas Financiers
- Financials: 0 period rows · Strategic moves: 7 · Performance items: 6 · Risk items: 9
### Aptus Value Housing Finance
- Financials: 6 period rows · Strategic moves: 3 · Performance items: 8 · Risk items: 9
- Top period `FY25`: 17 fields populated
### Home First Finance
- Financials: 5 period rows · Strategic moves: 4 · Performance items: 12 · Risk items: 11
- Top period `FY26`: 10 fields populated
### India Shelter Finance
- Financials: 5 period rows · Strategic moves: 5 · Performance items: 8 · Risk items: 7
- Top period `FY26`: 17 fields populated
- 54.7s

## Stage E — Deterministic report assembly (no LLM)
- Charts emitted: 4/5
  - ✓ AUM trend
  - ✓ PAT FY26
  - ✓ GNPA over time
  - ✓ Branches FY26
  - ✗ Asset mix FY26
- 36,640 chars → `E-report.md`
- 0.0s

---
Done. Open `tmp/vastu-ir-pipeline/2026-05-08T09-07-23-433Z/E-report.md`
