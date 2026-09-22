# Vastu IR-first competitor pipeline
- Query: compare Vastu Housing Finance to Aavas Financiers, Aptus Value Housing Finance, Home First Finance and India Shelter Finance on financials of last 2 years
- As of: 2026-05-08T07:07:54.189Z
- Synthesize: no (pass --synthesize)
- Output: `/Users/vimarsh/Documents/baby-sentinel/tmp/vastu-ir-pipeline/2026-05-08T07-07-54-187Z`

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
- Source: `footer` · Docs harvested: **180**
- IR page: https://homefirstindia.com/investor-relations
### India Shelter Finance
- Source: `header` · Docs harvested: **179**
- IR page: https://indiashelter.in/investor-relations
- 2.3s

## Stage B — Doc picker (timeScope=`last_2_years`)
### Vastu Housing Finance
- [quarterly_results · FY26 Q4] Audited Financial Result for quarter and year ended 31st March 2026
  - _Latest Q4 audited results_
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/financial-reports/Audited-Financial-Result-for-quarter-and-year-ended-31st-March-…
- [annual_report · FY24] ANNUAL REPORT 2023-24
  - _Prior annual report (FY24)_
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-23-24.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
### Aavas Financiers
- [quarterly_results · FY24] Financial Result approved by the Board of Directors
  - _Latest Q4 audited results_
  - https://www.aavas.in/uploads/pdf/financia-results-july-25-2024-853887582.pdf
### Aptus Value Housing Finance
- [annual_report · FY25] Annual Report 2024-2025
  - _Annual report (FY25)_
  - https://aptusindia.s3.us-east-1.amazonaws.com/Aptus_AR_Mar+2025.pdf
- [annual_report · FY24] Annual Report 2023-2024
  - _Prior annual report (FY24)_
  - https://aptusindia.s3.amazonaws.com/Aptus+Value+Housing+Finance+India+Ltd_Annual+Report+FY24.pdf
### Home First Finance
- [quarterly_results · FY23 Q4] Financial%20Result%20Q4%20FY23.pdf
  - _Latest Q4 audited results_
  - https://homefirstindia.com/files/Financial%20Result%20Q4%20FY23.pdf
- [annual_report · FY25] Annual Report 2024-25
  - _Annual report (FY25)_
  - https://homefirstindia.com/files/Integrated%20Annual%20Report%20FY25.pdf
- [investor_presentation] Investor Press Release
  - _Latest investor presentation_
  - https://homefirstindia.com/files/HomeFirst%20Q1FY26%20Investor%20Press%20Release.pdf
### India Shelter Finance
- [quarterly_results · FY26 Q4] Financial Results March 2026
  - _Latest Q4 audited results_
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777707511562-Financial+Results+March+2026.pdf
- [investor_presentation · FY26 Q4] Investor Presentation March 2026
  - _Latest investor presentation_
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777716210890-Investor%20Presentation%20intimation%20%283%29.pdf
- Total picked: **10** docs across 5 companies
- 0.0s

## Stage C — Extract (10 URLs in one batch call)
### Vastu Housing Finance
- 18,751 chars → `C-extract-vastu-housing-finance-1.md`
  - _**40** **EXCELLENCE** **LEADING THE WAY** **DRIVING AN** **INCLUSIVE CULTURE** **46** **CELEBRATING** **ACHIEVEMENTS** **38** **ACCELERATING** **ACCESS** **98** **CORPORATE** **GOVERNANCE REPORT** **216** **224** **CONSO…_
### Aavas Financiers
- _no successful extracts_
### Aptus Value Housing Finance
- 15,894 chars → `C-extract-aptus-value-housing-finance-1.md`
  - _which `54,500 crore is earmarked for PMAY (Rural). These substantial allocations highlight the government’s commitment to enhancing housing infrastructure across the country, particularly in rural regions. At Aptus, we…_
- 17,613 chars → `C-extract-aptus-value-housing-finance-2.md`
  - _**Aptus closed FY25 with a network of 300 branches, up from 262 in FY24 — a** **net addition of 38 branches, including 10 new branches in the new markets** **of Maharashtra and Odisha. The company also expanded in its co…_
### Home First Finance
- 19,814 chars → `C-extract-home-first-finance-1.md`
  - _232 25 757 94 306 7,302 2,121 9,534 9,698 3,963 35 3.8% 15.5% 39.5% 39.1% 2 240 2.9% 88,516,167 IndAS FY25 1,539 713 826 1,280 713 567 91 168 826 295 29 1,038 120 382 9,551 2,521 12,2…_
- 5,933 chars → `C-extract-home-first-finance-2.md`
  - _▪ AUM at ₹ 13,479 Cr; strong growth of 28.6% y-o-y and 6.0% q-o-q. ▪ Long Term Credit Rating upgraded to AA ‘Stable’. ▪ PAT at ₹ 119 Cr – up 35.5% y-o-y and 13.6% q-o-q. ▪ Successful QIP enhances Net worth by ₹ 1,231…_
- 962 chars → `C-extract-home-first-finance-3.md`
  - _**A.** **Audited Financial Results for the quarter and year ended March 31, 2023:** 1. Pursuant to Regulation 33 and 52 of SEBI Listing Regulations, we hereby inform you that the Board of Directors (“Board”) of the Compa…_
### India Shelter Finance
- 9,870 chars → `C-extract-india-shelter-finance-1.md`
  - _The Statement includes the results for the quarter ended March 31, 2026 being the balancing figure between the audited figures in respect of the full financial year ended March 31, 2026 and the published unaudited year-t…_
- 10,865 chars → `C-extract-india-shelter-finance-2.md`
  - _**FY26 Snapshot** 1 – Includes AUM and Partner’s Share in Co -Lending Loans | 2 – On disbursement | 3 – Sanctioned LTV On Gross AUM | 4 - PCR – Stage 3 | 5 – CARE Rating, ICRA, IND RA **Investors and Analysts can downloa…_
#### Extract errors
- https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/financial-reports/Audited-Financial-Result-for-quarter-and-year-ended-31st-March-… → `fetch_error` (200)
- https://www.aavas.in/uploads/pdf/financia-results-july-25-2024-853887582.pdf → `fetch_error` (200)
- 16.2s


---
Done. Open `tmp/vastu-ir-pipeline/2026-05-08T07-07-54-187Z/summary.md`
