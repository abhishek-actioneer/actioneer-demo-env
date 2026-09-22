# Vastu HFC — Synthetic Dataset Schema Proposal

## Coverage Assessment

### What We Have (Strong)

| Domain | Coverage | Confidence | Source |
|--------|----------|------------|--------|
| P&L / Income Statement | 3 years quarterly | High | Filings (FY23-FY25 + Q3 FY26) |
| Balance Sheet | 3 years annual | High | Filings |
| Cash Flow | 3 years annual | High | Filings |
| Asset quality (GNPA, NNPA, PCR) | 3 data points + trend | High | Filings |
| Credit cost modeling (co-lending) | Deep — vintage, MOB, partner-wise, 84 sheets | Very High | Project Aegis / KPMG |
| Industry benchmarks (6 peers) | All key ratios, DuPont, product mix | Very High | Investec, Citi, JM, MS reports |
| Funding structure | NCD/bank split, D/E trend, ALM proxy | High | Filings + cash flow |
| Assignment / securitisation | LTV, tenure, volumes, buyer type | High | Filings notes |
| Customer profile (qualitative) | Employment type, income range, NTC | Medium | Website + peer calibration |
| Interest rates / pricing | Product-wise rates, PLR | High | Website |

### What We're Missing (Gaps to Fill from Peer Calibration)

| Domain | Gap | How We Fill It | Confidence |
|--------|-----|---------------|------------|
| Branch-level data | No state/city breakdown, no per-branch metrics | Aadhar state distribution + industry productivity benchmarks | Medium |
| Loan book composition | No housing vs LAP vs construction split | Industry typical (60/20/10/10) adjusted for Vastu's higher LAP | Medium |
| Disbursement data | Only cash flow proxy, no channel-wise | Aadhar sourcing channel evolution as template | Medium |
| Customer segments | No salaried/SE split, no income distribution | Vastu is ~60-70% SE (inferred from positioning); Aadhar income categories | Medium |
| Geographic breakdown | No state-wise AUM or NPA | Aadhar/Aptus state-wise data as template | Medium |
| Collections / DPD flow | Only aggregate Stage 1/2/3 | Industry bounce rates (19-21%), Aegis GDR curves | Medium |
| Employee / branch economics | Only total count and total cost | Aadhar employee split + cost per employee benchmarks | Medium |
| Borrower-level profile | Only from assignment data (LTV 45-52%) | Peer ATS, LTV, tenure distributions | Medium |
| Yield curve by product | Only blended ~15.2% | Website rates + peer product-wise yields | High |

---

## Proposed Tables (20 total)

### Core Fact Tables (12)

| # | Table | Est. Rows | Primary Key | Description | Key Columns |
|---|-------|-----------|------------|-------------|-------------|
| 1 | `loans` | ~1,50,000 | loan_id | **Primary fact table.** One row per loan account — active, closed, NPA, written off, or assigned. | loan_id, disbursement_date, customer_id, branch_id, product_type, sanctioned_amount, disbursed_amount, interest_rate, tenure_months, emi_amount, ltv_ratio, property_value, property_type, employment_type, income_category, monthly_income, bureau_score, new_to_credit, sourcing_channel, co_lending_partner, loan_status, dpd_bucket, stage, state, city, city_tier |
| 2 | `customers` | ~1,20,000 | customer_id | **Borrower master.** Demographics, income, credit profile. One row per unique borrower. | customer_id, age, gender, employment_type, income_category, monthly_income, state, city, city_tier, property_type_owned, first_loan_date, total_loans, total_outstanding, is_ntc, bureau_score_at_origination, bureau_score_current |
| 3 | `emi_payments` | ~25,00,000 | payment_id | **Monthly EMI collection records.** Every scheduled EMI — paid, bounced, partial, or missed. | payment_id, loan_id, due_date, paid_date, amount_due, amount_paid, payment_mode, bounce, dpd_at_payment, collection_bucket |
| 4 | `branches` | ~200 | branch_id | **Branch master.** Location, type, vintage, staffing, operational metrics. | branch_id, branch_name, state, city, city_tier, branch_type, open_date, employee_count, monthly_opex, active_loans, total_aum, monthly_disbursement |
| 5 | `employees` | ~3,000 | employee_id | **Staff master.** Function, branch assignment, cost. | employee_id, branch_id, function, join_date, annual_ctc, is_active |
| 6 | `disbursements` | ~5,000 | disbursement_id | **Monthly disbursement log.** Aggregated disbursement events by branch × product × channel. | disbursement_id, loan_id, month, amount, branch_id, product_type, sourcing_channel, co_lending_partner |
| 7 | `borrowings` | ~500 | borrowing_id | **Funding line master.** Every bank line, NCD, NHB refinance — rate, maturity, outstanding. | borrowing_id, source_type, lender_name, sanctioned_amount, outstanding_amount, interest_rate, start_date, maturity_date, is_fixed_rate, repayment_frequency |
| 8 | `collections_actions` | ~50,000 | action_id | **Collection follow-up log.** Calls, visits, notices, legal actions on delinquent loans. | action_id, loan_id, action_date, action_type, dpd_at_action, result, agent_id, branch_id |
| 9 | `assignments` | ~2,000 | assignment_id | **Loan sales / securitisation.** Every sell-down to banks, ARCs, or co-lending assignment. | assignment_id, transaction_date, buyer_type, buyer_name, loan_count, amount_assigned, mrr_pct, ltv_coverage, wtd_avg_residual_maturity, wtd_avg_holding_period |
| 10 | `provisions` | ~36 | month | **Monthly ECL provision.** Stage-wise exposure, provision, coverage ratios. | month, stage_1_exposure, stage_2_exposure, stage_3_exposure, stage_1_provision, stage_2_provision, stage_3_provision, pcr_stage_1, pcr_stage_2, pcr_stage_3, total_ecl, write_offs, recoveries |
| 11 | `npa_movement` | ~12 | quarter | **Quarterly NPA flow.** Opening → additions → upgrades → write-offs → recoveries → closing. | quarter, opening_gnpa, additions, upgradations, write_offs, recoveries, closing_gnpa, opening_nnpa, closing_nnpa |
| 12 | `co_lending_partners` | ~11 | partner_id | **Co-lending partner master.** Performance, default curves, concentration. | partner_id, partner_name, partner_type, start_date, total_disbursed, active_loans, aum, gdr_90plus, lgd, ultimate_loss_rate |

### Summary / Aggregated Tables (8)

| # | Table | Est. Rows | Primary Key | Description | Key Columns |
|---|-------|-----------|------------|-------------|-------------|
| 13 | `monthly_financials` | ~36 | month | **Monthly P&L.** Full income statement with derived ratios (yield, CoF, NIM, RoA). | month, interest_income, fee_income, other_income, total_income, finance_cost, employee_cost, other_opex, depreciation, impairment, pbt, tax, pat, avg_aum, yield_pct, cof_pct, nim_pct, opex_ratio, credit_cost_pct, roa_pct |
| 14 | `monthly_aum` | ~36 | month | **AUM composition.** By product, on-book vs off-book, inflows vs outflows. | month, total_aum, housing_aum, lap_aum, construction_aum, finserve_aum, on_book_aum, off_book_aum, inflows_disbursements, outflows_repayments, outflows_prepayments, outflows_write_offs |
| 15 | `branch_performance` | ~7,200 | branch_id × month | **Monthly per-branch metrics.** Disbursement, AUM, collections, bounce rate, GNPA. | branch_id, month, disbursement_count, disbursement_amount, active_loans, aum, collections_amount, bounce_rate, gnpa_pct, employee_count, opex |
| 16 | `state_performance` | ~540 | state × month | **Monthly per-state aggregates.** Geographic performance dashboard. | state, month, branches, employees, aum, disbursements, gnpa_pct, bounce_rate, yield, new_customers |
| 17 | `vintage_cohort` | ~3,000 | cohort_month × mob | **MOB seasoning curves.** GDR at 30/60/90 DPD by origination cohort. | cohort_month, mob, cumulative_gdr_30, cumulative_gdr_60, cumulative_gdr_90, extrapolation_factor, expected_loss_rate |
| 18 | `product_performance` | ~180 | product_type × month | **Monthly per-product metrics.** Yield, NPA, ATS, disbursement mix. | product_type, month, aum, disbursements, yield, gnpa_pct, avg_ticket_size, avg_ltv, avg_tenure_months |
| 19 | `funding_position` | ~36 | month | **Monthly ALM / liability side.** Borrowing mix, cost, maturity profile. | month, total_borrowings, bank_loans, ncds, nhb_refinance, securitisation, weighted_avg_cost, fixed_rate_pct, floating_rate_pct, avg_maturity_months, liquidity_coverage_ratio |
| 20 | `company_kpis` | ~36 | month | **Monthly board-level dashboard.** The "one page" executive view. | month, aum, disbursements, pat, roa, roe, nim, spread, gnpa_pct, nnpa_pct, pcr, crar, d_e_ratio, branches, employees, customers, loans_active, bounce_rate, collection_efficiency |

---

## Column Detail — Core Tables

### Table 1: `loans` (~1,50,000 rows)

| Column | Type | Values / Range | Source / Calibration |
|--------|------|---------------|---------------------|
| loan_id | INTEGER | PK, sequential | Generated |
| disbursement_date | DATE | Apr 2019 – Dec 2025 | 3yr synthetic range |
| customer_id | INTEGER | FK → customers | Generated |
| branch_id | INTEGER | FK → branches | Generated |
| product_type | VARCHAR | home_purchase, home_construction, home_improvement, lap_residential, lap_commercial, business_loan, auto_loan | Vastu product catalog |
| sanctioned_amount | DOUBLE | ₹1L – ₹1Cr | ATS: HL ₹8-12L, LAP ₹5-8L, BL ₹2-3L |
| disbursed_amount | DOUBLE | ≤ sanctioned | 95-100% of sanctioned |
| interest_rate | DOUBLE | 12.5% – 23.5% | Website rates by product × employment |
| tenure_months | INTEGER | 36 – 240 | HL: 180-240, LAP: 120-180, BL: 36-60 |
| emi_amount | DOUBLE | Calculated | = PMT(rate, tenure, principal) |
| ltv_ratio | DOUBLE | 30% – 65% | HL: 55-62%, LAP: 40-50%, from assignment data |
| property_value | DOUBLE | ₹3L – ₹2Cr | = disbursed / ltv |
| property_type | VARCHAR | residential_independent, residential_apartment, commercial, plot | 70% independent, 20% apartment, 10% commercial/plot |
| employment_type | VARCHAR | salaried_formal, salaried_informal, self_employed_formal, self_employed_informal | 30% salaried, 70% SE (Vastu positioning) |
| income_category | VARCHAR | ews, lig, mig | EWS 25%, LIG 47%, MIG 28% (Aadhar calibration) |
| monthly_income | DOUBLE | ₹15K – ₹1.5L | Distribution by income_category |
| bureau_score | INTEGER | 0 (NTC) or 300-900 | 30% NTC, rest 550-750 median |
| new_to_credit | BOOLEAN | true/false | ~30% NTC |
| sourcing_channel | VARCHAR | direct_sales, dsa, connector, digital, co_lending | DST 35%, DSA 40%, Connector 15%, Digital 5%, Co-lending 5% |
| co_lending_partner | VARCHAR | null, DMI, TVS, HDB, NAC, Piramal, Utkarsh, VCPL, Finnable, Axis, Gosree, Tata | null for on-book (~85%), partner name for co-lending (~15%) |
| loan_status | VARCHAR | active, closed, npa, written_off, assigned | 65% active, 20% closed, 5% assigned, 8% NPA, 2% written off |
| dpd_bucket | VARCHAR | current, sma_0, sma_1, sma_2, npa_90, npa_180, npa_360 | 93% current, 2% SMA-0, 1.5% SMA-1, 1.5% SMA-2, 2% NPA |
| stage | INTEGER | 1, 2, 3 | Stage 1: 94%, Stage 2: 4%, Stage 3: 2% |
| state | VARCHAR | Maharashtra, UP, Rajasthan, Gujarat, MP, TN, Telangana, AP, Karnataka, etc. | Aadhar state distribution |
| city | VARCHAR | City name | Generated per state |
| city_tier | VARCHAR | t30, b30 | 35% T30, 65% B30 (affordable HFC skew) |

### Table 2: `customers` (~1,20,000 rows)

| Column | Type | Values / Range | Source / Calibration |
|--------|------|---------------|---------------------|
| customer_id | INTEGER | PK | Generated |
| age | INTEGER | 22 – 60 | Median 32, normal distribution |
| gender | VARCHAR | male, female | 60% male, 40% female (99% women claim is for specific program) |
| employment_type | VARCHAR | salaried_formal, salaried_informal, self_employed_formal, self_employed_informal | Matches loan distribution |
| income_category | VARCHAR | ews, lig, mig | EWS <₹25K, LIG ₹25-50K, MIG ₹50K+ |
| monthly_income | DOUBLE | ₹15K – ₹1.5L | Log-normal, median ₹35K |
| state | VARCHAR | State name | Weighted by branch distribution |
| city | VARCHAR | City name | Generated |
| city_tier | VARCHAR | t30, b30 | 35/65 split |
| property_type_owned | VARCHAR | residential_independent, residential_apartment, commercial, plot, none | 80% independent house |
| first_loan_date | DATE | Apr 2019 – Dec 2025 | First disbursement date |
| total_loans | INTEGER | 1 – 3 | 85% have 1 loan, 12% have 2, 3% have 3 |
| total_outstanding | DOUBLE | ₹0 – ₹1Cr | Sum of active loan balances |
| is_ntc | BOOLEAN | true/false | ~30% |
| bureau_score_at_origination | INTEGER | 0 or 300-900 | 0 for NTC, 550-750 for existing |
| bureau_score_current | INTEGER | 300-900 | Improves by 20-50 points after 12+ months of payments |

### Table 3: `emi_payments` (~25,00,000 rows)

| Column | Type | Values / Range | Source / Calibration |
|--------|------|---------------|---------------------|
| payment_id | INTEGER | PK | Generated |
| loan_id | INTEGER | FK → loans | Generated |
| due_date | DATE | Monthly EMI dates | 1st or 5th of each month |
| paid_date | DATE | null (missed) or actual date | Within 0-90 days of due date |
| amount_due | DOUBLE | EMI amount | From loan schedule |
| amount_paid | DOUBLE | 0 / partial / full | 79% full, 15% bounce then recovered, 4% partial, 2% missed |
| payment_mode | VARCHAR | nach, upi, cash, cheque, neft | NACH 60%, UPI 20%, Cash 10%, Cheque 5%, NEFT 5% |
| bounce | BOOLEAN | true/false | ~20% first presentation bounce (industry benchmark) |
| dpd_at_payment | INTEGER | 0, 1-30, 31-60, 61-90, 90+ | Derived from due vs paid date |
| collection_bucket | VARCHAR | on_time, 1_30, 31_60, 61_90, 90_plus | Derived |

### Table 4: `branches` (~200 rows)

| Column | Type | Values / Range | Source / Calibration |
|--------|------|---------------|---------------------|
| branch_id | INTEGER | PK | Generated |
| branch_name | VARCHAR | "{City} Branch" | Generated |
| state | VARCHAR | 12-15 states | Maharashtra 14%, UP 13%, Rajasthan 13%, Gujarat 11%, MP 9%, TN 9%, Telangana 7%, AP 4%, Karnataka 4%, others 17% |
| city | VARCHAR | City name | Mix of T30 and B30 cities |
| city_tier | VARCHAR | t30, b30 | 35% T30, 65% B30 |
| branch_type | VARCHAR | main, small, micro, sales_office | Main 30%, Small 35%, Micro 20%, Sales Office 15% |
| open_date | DATE | 2017 – 2025 | 55% >3yr, 20% 1-3yr, 25% <1yr |
| employee_count | INTEGER | 5 – 40 | Main: 25-40, Small: 12-20, Micro: 5-10, SO: 5-8 |
| monthly_opex | DOUBLE | ₹3L – ₹15L | Varies by type and city tier |
| active_loans | INTEGER | 100 – 3,000 | Mature branches higher |
| total_aum | DOUBLE | ₹10Cr – ₹100Cr | ₹27-73 Cr per branch (peer benchmark) |
| monthly_disbursement | DOUBLE | ₹0.5Cr – ₹5Cr | ₹1-2.5 Cr/month per branch |

### Table 12: `co_lending_partners` (~11 rows)

| Column | Type | Values / Range | Source / Calibration |
|--------|------|---------------|---------------------|
| partner_id | VARCHAR | PK | DMI, TVS, HDB, NAC, Piramal, Utkarsh, VCPL, Finnable, Axis, Gosree, Tata |
| partner_name | VARCHAR | Full name | From Aegis |
| partner_type | VARCHAR | bank, nbfc, fintech | Axis=bank, DMI/Finnable=fintech, others=nbfc |
| start_date | DATE | 2019 – 2024 | From Aegis vintage data |
| total_disbursed | DOUBLE | ₹10Cr – ₹500Cr | From Aegis cohort sums |
| active_loans | INTEGER | 500 – 20,000 | From Aegis account counts |
| aum | DOUBLE | ₹5Cr – ₹300Cr | From Aegis POS data |
| gdr_90plus | DOUBLE | 5% – 15% | From Aegis per-partner GDR sheets |
| lgd | DOUBLE | 65% – 80% | From Aegis LGD analysis |
| ultimate_loss_rate | DOUBLE | 4% – 10% | = gdr × lgd |

---

## Pre-Joined Views (for LLM querying)

| View | Base Tables | Purpose |
|------|------------|---------|
| `loans_full` | loans + customers + branches | Denormalized loan fact table with borrower demographics and branch location |
| `collections_full` | emi_payments + loans + branches | EMI payments with loan and branch context |
| `portfolio_health` | loans + provisions + npa_movement | Current portfolio snapshot with asset quality |
| `branch_dashboard` | branch_performance + branches + state_performance | Branch-level operational metrics |
| `funding_overview` | borrowings + funding_position + monthly_financials | Liability side with P&L context |
| `co_lending_book` | loans (where co_lending_partner is not null) + co_lending_partners + vintage_cohort | Co-lending portfolio with partner performance and seasoning |

---

## Planted Anomalies (for analysis discovery)

| Anomaly | Where | What the FP&A team should discover |
|---------|-------|-----------------------------------|
| GNPA spike Q2-Q3 FY26 | loans, npa_movement | Co-lending vintage FY23 H2 cohorts hitting 18-24 MOB, GDR inflection |
| One underperforming state | state_performance, branch_performance | MP or Karnataka with 2x average bounce rate, 3x GNPA |
| NCD rundown | borrowings, funding_position | NCDs declining 90% over 2 years, replaced by cheaper bank lines |
| Seasonal collection dip | emi_payments, collections_actions | October-November (Diwali) and June-July (monsoon) bounce spikes |
| DSA quality problem | loans (by sourcing_channel) | DSA-sourced loans have 1.5x the NPA rate of direct-sourced |
| One co-lending partner deteriorating | co_lending_partners, vintage_cohort | Finnable or VCPL with 2x average GDR — should be exited |
| Derecognition income volatility | monthly_financials, assignments | Q4 lumpy assignment income distorting quarterly PAT |
| New branch ramp-up lag | branch_performance | Branches <1yr old have 3x the cost/AUM ratio of mature branches |
| NTC borrower performance | loans (by new_to_credit) | NTC loans have higher bounce but lower terminal default (once they learn to pay) |
| Prepayment surge in low-rate environment | monthly_aum, emi_payments | Salaried borrowers prepaying as banks offer lower rates — AUM leakage |

---

## Summary Stats (what the dataset should produce when queried)

| Metric | Target Value | Calibrated From |
|--------|-------------|----------------|
| Total AUM (latest month) | ~₹10,000 Cr | Website |
| GNPA (latest) | ~1.9-2.0% | Q3 FY26 filing |
| NNPA (latest) | ~1.5% | Q3 FY26 filing |
| PCR | ~51% | Q3 FY26 filing |
| Annual PAT | ~₹330 Cr | FY25 filing |
| D/E ratio | ~1.45 | Q3 FY26 filing |
| Interest income yield | ~15% | Derived from P&L |
| Cost of funds | ~8.7% | Derived from P&L |
| NIM | ~9.4% | Derived |
| Credit cost | ~0.4% (HFC book) | Derived |
| Opex/AUM | ~4.7% | Derived |
| RoA | ~3.8% | Derived |
| Branches | ~200 | Website |
| Employees | ~3,000 | Website |
| Housing:LAP:Other mix | ~60:25:15 | Industry calibration |
| Salaried:Self-employed | ~30:70 | Vastu positioning |
| T30:B30 | ~35:65 | Industry calibration |
| Bounce rate | ~20% | Industry benchmark |
| Collection efficiency | ~98% | Industry benchmark |
