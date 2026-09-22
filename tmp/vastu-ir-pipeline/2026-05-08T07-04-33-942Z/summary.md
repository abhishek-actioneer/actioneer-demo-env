# Vastu IR-first competitor pipeline
- Query: compare Vastu Housing Finance to Aavas Financiers, Aptus Value Housing Finance, Home First Finance and India Shelter Finance on financials of last 2 years
- As of: 2026-05-08T07:04:33.943Z
- Synthesize: no (pass --synthesize)
- Output: `/Users/vimarsh/Documents/baby-sentinel/tmp/vastu-ir-pipeline/2026-05-08T07-04-33-942Z`

## Stage A — IR crawl (5 companies in parallel)
### Vastu Housing Finance
- Source: `failed` · Docs harvested: **0**
- ⚠ Could not fetch https://vastuhfc.com (network error or non-HTML response).
### Aavas Financiers
- Source: `header` · Docs harvested: **200**
- IR page: https://aavas.in/#
### Aptus Value Housing Finance
- Source: `header` · Docs harvested: **14**
- IR page: https://aptusindia.com/annual-reports
### Home First Finance
- Source: `footer` · Docs harvested: **180**
- IR page: https://homefirstindia.com/investor-relations
### India Shelter Finance
- Source: `header` · Docs harvested: **179**
- IR page: https://indiashelter.in/investor-relations
- 2.7s

## Stage B — Doc picker (timeScope=`last_2_years`)
### Vastu Housing Finance
- _no docs picked (crawl returned 0)_
### Aavas Financiers
- [quarterly_results · FY20] Investor Release on Financial Results
  - _Latest Q4 audited results_
  - https://www.aavas.in/uploads/pdf/investorrelease29102020-998637295.pdf
- [investor_presentation · FY25] Investor Presentation
  - _Latest investor presentation_
  - https://www.aavas.in/uploads/pdf/aavasinvestor-presentationq4-fy2025-42953184.pdf
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
- Total picked: **9** docs across 5 companies
- 0.0s

## Stage C — Extract (9 URLs in one batch call)
### Vastu Housing Finance
- _no successful extracts_
### Aavas Financiers
- 2,967 chars → `C-extract-aavas-financiers-1.md`
  - __\ _Employees refers to employees who are covered under SEBI (PIT ) Regulations, 2015_ _@_ _Includes_ _holding by Board’s immediate relative._ _# Aquilo (belonging to CVC Capital) Ltd acquired this stake in the open offe…_
- 1,978 chars → `C-extract-aavas-financiers-2.md`
  - _(Formerly known as "Au HOUSING FINANCE LIMITED") **An ISO 9001:2015 Certified Company** **CIN NO.: L65922RJ2011PLC034297** **Regd. & Corp. Office:** 201-202, 2nd Floor, Southend Square, Mansarover Industrial Area, Jaipur…_
### Aptus Value Housing Finance
- 16,599 chars → `C-extract-aptus-value-housing-finance-1.md`
  - _which `54,500 crore is earmarked for PMAY (Rural). These substantial allocations highlight the government’s commitment to enhancing housing infrastructure across the country, particularly in rural regions. At Aptus, we…_
- 19,531 chars → `C-extract-aptus-value-housing-finance-2.md`
  - _**Aptus closed FY25 with a network of 300 branches, up from 262 in FY24 — a** **net addition of 38 branches, including 10 new branches in the new markets** **of Maharashtra and Odisha. The company also expanded in its co…_
### Home First Finance
- 19,829 chars → `C-extract-home-first-finance-1.md`
  - _232 25 757 94 306 7,302 2,121 9,534 9,698 3,963 35 3.8% 15.5% 39.5% 39.1% 2 240 2.9% 88,516,167 IndAS FY25 1,539 713 826 1,280 713 567 91 168 826 295 29 1,038 120 382 9,551 2,521 12,2…_
- 7,913 chars → `C-extract-home-first-finance-2.md`
  - _▪ AUM at ₹ 13,479 Cr; strong growth of 28.6% y-o-y and 6.0% q-o-q. ▪ Long Term Credit Rating upgraded to AA ‘Stable’. ▪ PAT at ₹ 119 Cr – up 35.5% y-o-y and 13.6% q-o-q. ▪ Successful QIP enhances Net worth by ₹ 1,231…_
- 962 chars → `C-extract-home-first-finance-3.md`
  - _**A.** **Audited Financial Results for the quarter and year ended March 31, 2023:** 1. Pursuant to Regulation 33 and 52 of SEBI Listing Regulations, we hereby inform you that the Board of Directors (“Board”) of the Compa…_
### India Shelter Finance
- 19,726 chars → `C-extract-india-shelter-finance-1.md`
  - _The Statement includes the results for the quarter ended March 31, 2026 being the balancing figure between the audited figures in respect of the full financial year ended March 31, 2026 and the published unaudited year-t…_
- 9,867 chars → `C-extract-india-shelter-finance-2.md`
  - _**FY26 Snapshot** 1 – Includes AUM and Partner’s Share in Co -Lending Loans | 2 – On disbursement | 3 – Sanctioned LTV On Gross AUM | 4 - PCR – Stage 3 | 5 – CARE Rating, ICRA, IND RA **Investors and Analysts can downloa…_
- 6.4s


---
Done. Open `tmp/vastu-ir-pipeline/2026-05-08T07-04-33-942Z/summary.md`
