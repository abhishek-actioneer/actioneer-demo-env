# Vastu IR-first competitor pipeline
- Query: compare Vastu Housing Finance to Aavas Financiers, Aptus Value Housing Finance, Home First Finance and India Shelter Finance on financials of last 2 years
- As of: 2026-05-08T07:35:21.239Z
- Synthesize: yes
- Extract mode: **deep research per PDF** (slow, ~3 min total, structured analysis output)
- Output: `/Users/vimarsh/Documents/baby-sentinel/tmp/vastu-ir-pipeline/2026-05-08T07-35-21-235Z`

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
- 3.1s

## Stage B — Doc picker (LLM, timeScope=`last_2_years`)
### Vastu Housing Finance
- [quarterly_results · FY26] Audited Financial Result for quarter and year ended 31st March 2026
  - _This provides the most recent audited full-year financial results for the period ending March 31, 2026._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/financial-reports/Audited-Financial-Result-for-quarter-and-year-ended-31st-March-…
- [annual_report · FY25] ANNUAL REPORT 2024-25
  - _This is the most recent complete annual report, containing the full narrative, strategy, and management discussion for the prior fiscal year._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-24-25.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
- [annual_report · FY24] ANNUAL REPORT 2023-24
  - _This report provides the audited comparative baseline and comprehensive historical context for the last two full fiscal years._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-23-24.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
### Aavas Financiers
- [quarterly_results · FY26] Financial Result approved by the Board of Directors
  - _This is the most recent audited full-year result for the period ending March 31, 2026, providing the latest annual financial data._
  - https://www.aavas.in/uploads/pdf/financials-85794283.pdf
- [quarterly_results · FY25] Financial Result approved by the Board of Directors
  - _This document contains the audited financial results for the previous fiscal year ending March 31, 2025, essential for year-over-year comparison._
  - https://www.aavas.in/uploads/pdf/outcome-of-board-meetingq4-42612506.pdf
- [quarterly_results · FY24] Financial Result approved by the Board of Directors
  - _This report for the year ending March 31, 2024, provides the necessary baseline data to complete the two-year historical performance review._
  - https://www.aavas.in/uploads/pdf/finaloutcome25042024-1252982600.pdf
### Aptus Value Housing Finance
- [annual_report · FY25] Annual Report 2024-2025
  - _This is the most recent full-year annual report available in the list, covering the first of the last two years._
  - https://aptusindia.s3.us-east-1.amazonaws.com/Aptus_AR_Mar+2025.pdf
- [annual_report · FY24] Annual Report 2023-2024
  - _This provides the full audited financials and management commentary for the second-to-last completed fiscal year._
  - https://aptusindia.s3.amazonaws.com/Aptus+Value+Housing+Finance+India+Ltd_Annual+Report+FY24.pdf
- [annual_report · FY23] Annual Report 2022-2023
  - _In the absence of a recent investor presentation or FY26 quarterly results, this annual report provides a necessary third data point for financial trend analysis._
  - https://aptusindia.s3.amazonaws.com/Aptus_AR_2022-23.pdf
### Home First Finance
- [investor_presentation · FY26 Q4] Investor Presentation
  - _This is the latest investor deck providing management narrative and a summary of full-year FY26 financial performance._
  - https://homefirstindia.com/files/Investor%20Deck%20Q4FY26.pdf
- [annual_report · FY25] Annual Report 2024-25
  - _This is the most recent full integrated annual report, providing audited financials and detailed strategy for the previous fiscal year._
  - https://homefirstindia.com/files/Integrated%20Annual%20Report%20FY25.pdf
- [press_release · FY26 Q4] Investor Press Release
  - _This release contains the financial highlights for the full year ended March 31, 2026, which is the most recent reporting period._
  - https://homefirstindia.com/files/HomeFirst_Q4FY26_Press_Release.pdf
### India Shelter Finance
- [quarterly_results · FY26] Financial Results March 2026
  - _This document contains the audited financial results for the full year ended March 31, 2026, providing the most recent annual data._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777707511562-Financial+Results+March+2026.pdf
- [annual_report · FY25] Integrated Annual Report- 2024-25
  - _This is the integrated annual report for the previous fiscal year, offering comprehensive audited financials and strategic management commentary._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1751527210017-Integrated+Annual+Report-+2024-25.pdf
- [investor_presentation · FY26 Q4] Investor Presentation March 2026
  - _The latest investor presentation provides a compact narrative of performance, asset quality, and growth metrics for the most recent fiscal year._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777716210890-Investor%20Presentation%20intimation%20%283%29.pdf
- Total picked: **15** docs across 5 companies
- 15.2s

## Stage C — Deep Research per PDF (15 parallel Task API runs)
### Vastu Housing Finance
- ✓ [quarterly_results · FY26] (187.8s, 2,288 chars) → `C-deep-vastu-housing-finance-1.md`
- ✓ [annual_report · FY25] (139.6s, 2,192 chars) → `C-deep-vastu-housing-finance-2.md`
- ✓ [annual_report · FY24] (147.6s, 2,418 chars) → `C-deep-vastu-housing-finance-3.md`
### Aavas Financiers
- ✓ [quarterly_results · FY26] (240.0s, 9,277 chars) → `C-deep-aavas-financiers-1.md`
- ✓ [quarterly_results · FY25] (250.0s, 6,625 chars) → `C-deep-aavas-financiers-2.md`
- ✓ [quarterly_results · FY24] (273.9s, 5,315 chars) → `C-deep-aavas-financiers-3.md`
### Aptus Value Housing Finance
- ✓ [annual_report · FY25] (263.9s, 2,629 chars) → `C-deep-aptus-value-housing-finance-1.md`
- ✓ [annual_report · FY24] (242.0s, 9,609 chars) → `C-deep-aptus-value-housing-finance-2.md`
- ✓ [annual_report · FY23] (260.0s, 5,478 chars) → `C-deep-aptus-value-housing-finance-3.md`
### Home First Finance
- ✓ [investor_presentation · FY26 Q4] (270.2s, 2,489 chars) → `C-deep-home-first-finance-1.md`
- ✓ [annual_report · FY25] (265.6s, 11,511 chars) → `C-deep-home-first-finance-2.md`
- ✓ [press_release · FY26 Q4] (261.8s, 7,413 chars) → `C-deep-home-first-finance-3.md`
### India Shelter Finance
- ✓ [quarterly_results · FY26] (153.7s, 1,165 chars) → `C-deep-india-shelter-finance-1.md`
- ✓ [annual_report · FY25] (149.6s, 3,117 chars) → `C-deep-india-shelter-finance-2.md`
- ✓ [investor_presentation · FY26 Q4] (280.1s, 2,289 chars) → `C-deep-india-shelter-finance-3.md`
- 280.2s

## Stage D — Synthesize

- 6,775 chars → `D-report.md`
- 28.1s

---
Done. Open `tmp/vastu-ir-pipeline/2026-05-08T07-35-21-235Z/summary.md`
