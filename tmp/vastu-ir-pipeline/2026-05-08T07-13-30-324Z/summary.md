# Vastu IR-first competitor pipeline
- Query: compare Vastu Housing Finance to Aavas Financiers, Aptus Value Housing Finance, Home First Finance and India Shelter Finance on financials of last 2 years
- As of: 2026-05-08T07:13:30.325Z
- Synthesize: yes
- Output: `/Users/vimarsh/Documents/baby-sentinel/tmp/vastu-ir-pipeline/2026-05-08T07-13-30-324Z`

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
- 3.9s

## Stage B — Doc picker (LLM, timeScope=`last_2_years`)
### Vastu Housing Finance
- [quarterly_results · FY26] Audited Financial Result for quarter and year ended 31st March 2026
  - _This provides the most recent audited full-year financials for the year ended March 31, 2026._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/financial-reports/Audited-Financial-Result-for-quarter-and-year-ended-31st-March-…
- [annual_report · FY25] ANNUAL REPORT 2024-25
  - _This is the most recent comprehensive annual report, containing the MD&A and strategy narrative for the 2024-25 fiscal year._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-24-25.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
- [annual_report · FY24] ANNUAL REPORT 2023-24
  - _This annual report covers the prior fiscal year, providing the necessary depth and historical context for a two-year performance analysis._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-23-24.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
### Aavas Financiers
- [quarterly_results · FY26] Financial Result approved by the Board of Directors
  - _This is the most recent audited financial result for the full year ended March 31, 2026._
  - https://www.aavas.in/uploads/pdf/financials-85794283.pdf
- [quarterly_results · FY25] Financial Result approved by the Board of Directors
  - _This represents the audited financial results for the previous full fiscal year ended March 31, 2025._
  - https://www.aavas.in/uploads/pdf/outcome-of-board-meetingq4-42612506.pdf
- [quarterly_results · FY26 Q3] Financial Result approved by the Board of Directors
  - _Provides the most recent quarterly narrative and financial breakdown leading into the full-year FY26 results._
  - https://www.aavas.in/uploads/pdf/outcome-46562990.pdf
### Aptus Value Housing Finance
- [annual_report · FY25] Annual Report 2024-2025
  - _This is the most recent annual report available, providing audited financials and strategic commentary for the financial year ending March 2025._
  - https://aptusindia.s3.us-east-1.amazonaws.com/Aptus_AR_Mar+2025.pdf
- [annual_report · FY24] Annual Report 2023-2024
  - _This provides the previous year's full audited results and management discussion, completing the two-year historical look-back required._
  - https://aptusindia.s3.amazonaws.com/Aptus+Value+Housing+Finance+India+Ltd_Annual+Report+FY24.pdf
### Home First Finance
- [investor_presentation · FY26 Q4] Investor Presentation
  - _This is the most recent investor deck providing a compact narrative and key metrics (AUM, GNPA, NIM) for the full year ended March 2026._
  - https://homefirstindia.com/files/Investor%20Deck%20Q4FY26.pdf
- [annual_report · FY25] Annual Report 2024-25
  - _This is the integrated annual report for the preceding financial year, offering comprehensive audited financials and management strategy._
  - https://homefirstindia.com/files/Integrated%20Annual%20Report%20FY25.pdf
- [press_release · FY26 Q4] Investor Press Release
  - _This press release provides the official summary and highlights for the full-year FY26 financial results._
  - https://homefirstindia.com/files/HomeFirst_Q4FY26_Press_Release.pdf
### India Shelter Finance
- [quarterly_results · FY26] Financial Results March 2026
  - _This document contains the audited financial results for the full year ended March 31, 2026, providing the most recent annual data._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777707511562-Financial+Results+March+2026.pdf
- [annual_report · FY25] Integrated Annual Report- 2024-25
  - _The integrated annual report for FY25 offers comprehensive coverage of the prior year's strategy, financials, and MD&A._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1751527210017-Integrated+Annual+Report-+2024-25.pdf
- [investor_presentation · FY26 Q4] Investor Presentation March 2026
  - _The latest investor presentation provides current business narrative, AUM trends, and key operational metrics as of the end of FY26._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777716210890-Investor%20Presentation%20intimation%20%283%29.pdf
- Total picked: **14** docs across 5 companies
- 20.4s

## Stage C — Extract (14 URLs in one batch call)
### Vastu Housing Finance
- 5,967 chars → `C-extract-vastu-housing-finance-1.md`
  - _Income (NII), reflecting efficient management of interest- earning assets and liabilities. A 27% YoY increase in Profit After Tax (PAT) underscores enhanced profitability, with a PAT of ₹361 crore on a consolidated basis…_
- 4,957 chars → `C-extract-vastu-housing-finance-2.md`
  - _**Corporate Overview** Statutory Reports Financial Statements Annual Report 2024-25 | 05 **Business Metrics** **Key Performance** **Indicators** **Consolidated** **Financial Metrics** 5-year CAGR 5-year CAGR **AUM** **45…_
### Aavas Financiers
- 5,826 chars → `C-extract-aavas-financiers-1.md`
  - _**Statement of financial results for the quarter and half year ended September 30, 2025** **(INR in lakh)** **Particulars** **Quarter ended** **Half Year ended** **Year ended** **30.09.2025** **30.06.2025** **30.09.2024*…_
- 5,830 chars → `C-extract-aavas-financiers-2.md`
  - _**Statement of financial results for the quarter and year ended March 31,2025** **(INR in lakh)** **Particulars** **Quarter ended** **Year ended** **31.03.2025** **31.12.2024** **31.03.2024** **31.03.2025** **31.03.2024*…_
- 5,884 chars → `C-extract-aavas-financiers-3.md`
  - _**AAVAS FINANCIERS LIMITED** **(CIN:L65922RJ2011PLC034297)** **Statement of financial results for the quarter ended June 30, 2025** **(INR in lakh)** **Particulars** **Quarter ended** **Year ended** **30.06.2025** **31.0…_
### Aptus Value Housing Finance
- 11,842 chars → `C-extract-aptus-value-housing-finance-1.md`
  - _which `54,500 crore is earmarked for PMAY (Rural). These substantial allocations highlight the government’s commitment to enhancing housing infrastructure across the country, particularly in rural regions. At Aptus, we…_
- 5,844 chars → `C-extract-aptus-value-housing-finance-2.md`
  - _**Aptus closed FY25 with a network of 300 branches, up from 262 in FY24 — a** **net addition of 38 branches, including 10 new branches in the new markets** **of Maharashtra and Odisha. The company also expanded in its co…_
### Home First Finance
- 11,914 chars → `C-extract-home-first-finance-1.md`
  - _We have been delivering high growth since our inception without compromising on quality of the growth. India presents enormous opportunities in the affordable housing space that must be dealt responsibly. Being a len…_
- 5,892 chars → `C-extract-home-first-finance-2.md`
  - _▪ **AUM at** **₹** **15,878 Cr; strong growth of 24.9% y-o-y and 6.4% q-o-q.** ▪ **Disbursal reaches new high of** **₹** **1,572 Cr with a y-o-y growth of 23.5% and a q-o-q of 19.3%.** ▪ **Asset Quality Strengthens: 1+/3…_
- 5,923 chars → `C-extract-home-first-finance-3.md`
  - _Investor Presentation – Q4 FY26 | Home First Finance Company India Ltd. **Executive Summary | FY26** FY26 Highlights 3 **Assets Under Management (AUM)** **Spread** <sup>**(1)**</sup> **Profit After Tax (PAT)** **Disburse…_
### India Shelter Finance
- 11,830 chars → `C-extract-india-shelter-finance-1.md`
  - _The Statement includes the results for the quarter ended March 31, 2026 being the balancing figure between the audited figures in respect of the full financial year ended March 31, 2026 and the published unaudited year-t…_
- 11,806 chars → `C-extract-india-shelter-finance-2.md`
  - _142 1,964 248 215 2,646 378 251 3,355 2020-21 2021-22 2022-23 2023-24 2024-25 323 460 606 861 1,176 2020-21 2021-22 2022-23 2023-24 2024-25 1.4 1.6 0.8 0.7 0.8 2020-21 2021-22 2022-23 2023-24 2024-25…_
- 5,959 chars → `C-extract-india-shelter-finance-3.md`
  - _**FY26 Snapshot** 1 – Includes AUM and Partner’s Share in Co -Lending Loans | 2 – On disbursement | 3 – Sanctioned LTV On Gross AUM | 4 - PCR – Stage 3 | 5 – CARE Rating, ICRA, IND RA **Investors and Analysts can downloa…_
#### Extract errors
- https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/financial-reports/Audited-Financial-Result-for-quarter-and-year-ended-31st-March-… → `fetch_error` (200)
- 8.2s

## Stage D — Synthesize

- 10,973 chars → `D-report.md`
- 41.3s

---
Done. Open `tmp/vastu-ir-pipeline/2026-05-08T07-13-30-324Z/summary.md`
