# Vastu IR-first competitor pipeline
- Query: compare Vastu Housing Finance to Aavas Financiers, Aptus Value Housing Finance, Home First Finance and India Shelter Finance on financials of last 2 years
- As of: 2026-05-08T08:18:19.801Z
- Synthesize: no (pass --synthesize)
- Extract mode: **multi-objective /extract** (4 batches: numbers, strategy, performance, risk → structured assembly)
- Output: `/Users/vimarsh/Documents/baby-sentinel/tmp/vastu-ir-pipeline/2026-05-08T08-18-19-800Z`

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
- 2.9s

## Stage B — Doc picker (LLM, timeScope=`last_2_years`)
### Vastu Housing Finance
- [quarterly_results · FY26] Audited Financial Result for quarter and year ended 31st March 2026
  - _Most recent audited financial results covering the full fiscal year 2025-26._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/financial-reports/Audited-Financial-Result-for-quarter-and-year-ended-31st-March-…
- [annual_report · FY25] ANNUAL REPORT 2024-25
  - _Comprehensive annual report for the previous fiscal year containing detailed MD&A and audited financials._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-24-25.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
- [annual_report · FY24] ANNUAL REPORT 2023-24
  - _Provides full-year historical financials and strategy for the year preceding the immediate comparison period._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-23-24.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
### Aavas Financiers
- [quarterly_results · FY26 Q4] Financial Result approved by the Board of Directors
  - _Most recent audited financial results for the full year ending March 2026, containing the most current annual performance data._
  - https://www.aavas.in/uploads/pdf/financials-85794283.pdf
- [quarterly_results · FY25 Q4] Financial Result approved by the Board of Directors
  - _Audited financial results for the full year ending March 2025, providing the necessary comparative data for the prior fiscal year._
  - https://www.aavas.in/uploads/pdf/outcome-of-board-meetingq4-42612506.pdf
- [quarterly_results · FY24 Q4] Financial Result approved by the Board of Directors
  - _Audited financial results for the year ending March 2024, which serves as the historical baseline for analyzing the last two years of growth._
  - https://www.aavas.in/uploads/pdf/finaloutcome25042024-1252982600.pdf
### Aptus Value Housing Finance
- [annual_report · FY25] Annual Report 2024-2025
  - _This is the most recent full-year report available in the list, covering the financial results and strategy for the fiscal year ended March 2025._
  - https://aptusindia.s3.us-east-1.amazonaws.com/Aptus_AR_Mar+2025.pdf
- [annual_report · FY24] Annual Report 2023-2024
  - _This document covers the prior fiscal year (FY24), providing the necessary historical comparison for a two-year analysis._
  - https://aptusindia.s3.amazonaws.com/Aptus+Value+Housing+Finance+India+Ltd_Annual+Report+FY24.pdf
- [annual_report · FY23] Annual Report 2022-2023
  - _This provides a third year of comprehensive financial data and narrative to establish a clear growth and asset quality trend._
  - https://aptusindia.s3.amazonaws.com/Aptus_AR_2022-23.pdf
### Home First Finance
- [annual_report · FY25] Annual Report 2024-25
  - _This is the most recent full integrated annual report, providing audited financials and strategic overview for the 2024-25 fiscal year._
  - https://homefirstindia.com/files/Integrated%20Annual%20Report%20FY25.pdf
- [investor_presentation · FY26 Q4] Investor Presentation
  - _Provides the most recent narrative, AUM growth, and key performance metrics for the full year ended March 31, 2026._
  - https://homefirstindia.com/files/Investor%20Deck%20Q4FY26.pdf
- [press_release · FY26 Q4] Investor Press Release
  - _Provides a summary of the audited financial results for the full year FY26, serving as the primary source for the most recent year-end numbers._
  - https://homefirstindia.com/files/HomeFirst_Q4FY26_Press_Release.pdf
### India Shelter Finance
- [quarterly_results · FY26] Financial Results March 2026
  - _This document contains the audited financial results for the full year ended March 31, 2026, serving as the primary source for FY26 financials._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777707511562-Financial+Results+March+2026.pdf
- [annual_report · FY25] Integrated Annual Report- 2024-25
  - _This is the complete integrated annual report for the previous fiscal year (FY25), providing comprehensive strategy and financial detail._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1751527210017-Integrated+Annual+Report-+2024-25.pdf
- [investor_presentation · FY26 Q4] Investor Presentation March 2026
  - _This is the most recent investor presentation, providing the narrative, AUM growth, and asset quality metrics for the end of FY26._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777716210890-Investor%20Presentation%20intimation%20%283%29.pdf
- Total picked: **15** docs across 5 companies
- 14.8s

## Stage C — Multi-objective extract (4 batches: numbers, strategy, performance, risk_outlook)
- `numbers`: 14 extracts, 99,860 total chars
- `strategy`: 14 extracts, 99,859 total chars
- `performance`: 13 extracts, 99,643 total chars
- `risk_outlook`: 14 extracts, 99,817 total chars
- 37.0s

## Stage D — Structured extract per company (Gemini, 4 calls × 5 companies in parallel)
