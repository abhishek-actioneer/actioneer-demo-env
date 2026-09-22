# Vastu IR-first competitor pipeline
- Query: compare Vastu Housing Finance to Aavas Financiers, Aptus Value Housing Finance, Home First Finance and India Shelter Finance on financials of last 2 years
- As of: 2026-05-08T07:12:25.071Z
- Synthesize: no (pass --synthesize)
- Output: `/Users/vimarsh/Documents/baby-sentinel/tmp/vastu-ir-pipeline/2026-05-08T07-12-25-069Z`

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
- 2.4s

## Stage B — Doc picker (LLM, timeScope=`last_2_years`)
### Vastu Housing Finance
- [quarterly_results · FY26] Audited Financial Result for quarter and year ended 31st March 2026
  - _Most recent audited full-year financial results covering the period ended 31st March 2026._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/financial-reports/Audited-Financial-Result-for-quarter-and-year-ended-31st-March-…
- [annual_report · FY25] ANNUAL REPORT 2024-25
  - _Latest available integrated annual report providing comprehensive financials and management discussion for the prior fiscal year._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-24-25.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
- [annual_report · FY24] ANNUAL REPORT 2023-24
  - _Annual report for the preceding year to provide a complete two-year historical comparison and narrative context._
  - https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/annual-reports/annual-report-23-24.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Am…
### Aavas Financiers
- [quarterly_results · FY26 Q4] Financial Result approved by the Board of Directors
  - _This is the most recent audited full-year financial result for the period ended March 31, 2026, providing the latest annual data._
  - https://www.aavas.in/uploads/pdf/financials-85794283.pdf
- [quarterly_results · FY25 Q4] Financial Result approved by the Board of Directors
  - _This document contains the audited full-year results for the previous fiscal year (FY25), essential for a two-year comparison._
  - https://www.aavas.in/uploads/pdf/outcome-of-board-meetingq4-42612506.pdf
- [quarterly_results · FY25 Q3] Financial Result approved by the Board of Directors
  - _Provides interim performance data and management commentary for the quarter ended December 2024, bridging the two full-year reports._
  - https://www.aavas.in/uploads/pdf/financial-results-dec-2024-76747944.pdf
### Aptus Value Housing Finance
- [annual_report · FY25] Annual Report 2024-2025
  - _This is the most recent annual report available in the list, covering the 2024-25 financial year._
  - https://aptusindia.s3.us-east-1.amazonaws.com/Aptus_AR_Mar+2025.pdf
- [annual_report · FY24] Annual Report 2023-2024
  - _This report covers the previous full financial year (2023-24), essential for year-on-year comparison._
  - https://aptusindia.s3.amazonaws.com/Aptus+Value+Housing+Finance+India+Ltd_Annual+Report+FY24.pdf
- [annual_report · FY23] Annual Report 2022-2023
  - _Provides a third year of audited financial data to establish historical performance trends._
  - https://aptusindia.s3.amazonaws.com/Aptus_AR_2022-23.pdf
### Home First Finance
- [press_release · FY26 Q4] Investor Press Release
  - _This press release contains the condensed audited financial results for the full fiscal year ended March 31, 2026._
  - https://homefirstindia.com/files/HomeFirst_Q4FY26_Press_Release.pdf
- [investor_presentation · FY26 Q4] Investor Presentation
  - _This is the most recent investor presentation, providing the full-year narrative, AUM growth, and key performance indicators for FY26._
  - https://homefirstindia.com/files/Investor%20Deck%20Q4FY26.pdf
- [annual_report · FY25] Annual Report 2024-25
  - _The FY25 Integrated Annual Report provides comprehensive audited financials and strategic management discussion for the prior full fiscal year._
  - https://homefirstindia.com/files/Integrated%20Annual%20Report%20FY25.pdf
### India Shelter Finance
- [quarterly_results · FY26 Q4] Financial Results March 2026
  - _This document contains the audited financial results for the full year ended March 31, 2026, providing the most recent annual data for FY26._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777707511562-Financial+Results+March+2026.pdf
- [annual_report · FY25] Integrated Annual Report- 2024-25
  - _This integrated annual report provides comprehensive financial and strategic details for the full fiscal year 2024-25._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1751527210017-Integrated+Annual+Report-+2024-25.pdf
- [investor_presentation · FY26 Q4] Investor Presentation March 2026
  - _This is the most recent investor presentation, offering narrative context, AUM growth, and asset quality metrics alongside the FY26 results._
  - https://india-shelter.s3.ap-south-1.amazonaws.com/uploads/1777716210890-Investor%20Presentation%20intimation%20%283%29.pdf
- Total picked: **15** docs across 5 companies
- 15.9s

## Stage C — Extract (15 URLs in one batch call)
### Vastu Housing Finance
- 5,918 chars → `C-extract-vastu-housing-finance-1.md`
  - _**Corporate Overview** Statutory Reports Financial Statements Annual Report 2024-25 | 05 **Business Metrics** **Key Performance** **Indicators** **Consolidated** **Financial Metrics** 5-year CAGR 5-year CAGR **AUM** **45…_
- 5,964 chars → `C-extract-vastu-housing-finance-2.md`
  - _**ROE** <sup>*****</sup> **ROA** **PAT** **(₹ in Cr)** **| 27%**  **YoY** **FY20** **FY21** **FY23** **FY22** **FY24** 90 96 182 285 **361** **FY20** **FY21** **FY23** **FY22** **FY24** **Net Worth** **(₹ in Cr)** **| 4…_
### Aavas Financiers
- 3,930 chars → `C-extract-aavas-financiers-1.md`
  - _**AAVAS FINANCIERS LIMITED** **(CIN:L65922RJ2011PLC034297)** **Statement of financial results for the quarter ended June 30, 2025** **(INR in lakh)** **Particulars** **Quarter ended** **Year ended** **30.06.2025** **31.0…_
- 3,948 chars → `C-extract-aavas-financiers-2.md`
  - _**Statement of financial results for the quarter and year ended March 31,2025** **(INR in lakh)** **Particulars** **Quarter ended** **Year ended** **31.03.2025** **31.12.2024** **31.03.2024** **31.03.2025** **31.03.2024*…_
### Aptus Value Housing Finance
- 11,912 chars → `C-extract-aptus-value-housing-finance-1.md`
  - _we serve. We are proud of our journey and our milestones, including being awarded ‘India’s Leading Housing Finance NBFC (Mid)’ by Dun & Bradstreet at the BFSI & FinTech Awards 2023 and best NBFC for 2022-23 by Financial…_
- 11,894 chars → `C-extract-aptus-value-housing-finance-2.md`
  - _digital platforms to ensure efficient loan processing and servicing. We gain insights for better business decision-making and risk management by prioritising data management and analytics. Data security and privacy are p…_
- 5,836 chars → `C-extract-aptus-value-housing-finance-3.md`
  - _**Aptus closed FY25 with a network of 300 branches, up from 262 in FY24 — a** **net addition of 38 branches, including 10 new branches in the new markets** **of Maharashtra and Odisha. The company also expanded in its co…_
### Home First Finance
- 5,871 chars → `C-extract-home-first-finance-1.md`
  - _▪ **AUM at** **₹** **15,878 Cr; strong growth of 24.9% y-o-y and 6.4% q-o-q.** ▪ **Disbursal reaches new high of** **₹** **1,572 Cr with a y-o-y growth of 23.5% and a q-o-q of 19.3%.** ▪ **Asset Quality Strengthens: 1+/3…_
- 5,877 chars → `C-extract-home-first-finance-2.md`
  - _Investor Presentation – Q4 FY26 | Home First Finance Company India Ltd. **Executive Summary | FY26** FY26 Highlights 3 **Assets Under Management (AUM)** **Spread** <sup>**(1)**</sup> **Profit After Tax (PAT)** **Disburse…_
- 11,864 chars → `C-extract-home-first-finance-3.md`
  - _Net Interest Income `567 Crs in `Crs 567 471 379 262 190 35.8% Cost to Income 273 381 492 658 826 FY’21 FY’22 FY’23 FY’24 FY’25 Net Total Income `826 Crs 2.7% in Crs ` CAGR 31.9% Y-o-Y 25.5% Opex to Asse…_
### India Shelter Finance
- 9,870 chars → `C-extract-india-shelter-finance-1.md`
  - _The Statement includes the results for the quarter ended March 31, 2026 being the balancing figure between the audited figures in respect of the full financial year ended March 31, 2026 and the published unaudited year-t…_
- 11,833 chars → `C-extract-india-shelter-finance-2.md`
  - _142 1,964 248 215 2,646 378 251 3,355 2020-21 2021-22 2022-23 2023-24 2024-25 323 460 606 861 1,176 2020-21 2021-22 2022-23 2023-24 2024-25 1.4 1.6 0.8 0.7 0.8 2020-21 2021-22 2022-23 2023-24 2024-25…_
- 4,962 chars → `C-extract-india-shelter-finance-3.md`
  - _**FY26 Snapshot** 1 – Includes AUM and Partner’s Share in Co -Lending Loans | 2 – On disbursement | 3 – Sanctioned LTV On Gross AUM | 4 - PCR – Stage 3 | 5 – CARE Rating, ICRA, IND RA **Investors and Analysts can downloa…_
#### Extract errors
- https://bmkzz2nd6igg.compat.objectstorage.ap-mumbai-1.oraclecloud.com/hfc-g-dc-vastu-website/uploads/public/assets/pdf/financial-reports/Audited-Financial-Result-for-quarter-and-year-ended-31st-March-… → `fetch_error` (200)
- https://www.aavas.in/uploads/pdf/financial-results-dec-2024-76747944.pdf → `fetch_error` (200)
- 27.5s


---
Done. Open `tmp/vastu-ir-pipeline/2026-05-08T07-12-25-069Z/summary.md`
