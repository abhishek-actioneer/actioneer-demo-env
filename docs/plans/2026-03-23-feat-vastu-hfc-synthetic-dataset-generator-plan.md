---
title: "feat: Vastu HFC Synthetic Dataset Generator"
type: feat
status: active
date: 2026-03-23
---

# Vastu HFC Synthetic Dataset Generator

## Overview

Build a production-grade synthetic dataset for Vastu Housing Finance Corporation — an affordable housing finance company — to demo Sentinel's analytics capabilities in a sales pitch. The dataset models Vastu's real business: two lending books (HFC housing + Finserve vehicle/MSME), 226 branches across 15 states, 1.44 lakh active loans, and ₹11,423 Cr consolidated AUM.

**Deliverables:**
1. `scripts/generate-vastu-hfc.ts` — Generates ~12 CSV files with seeded PRNG
2. `scripts/setup-vastu-hfc.ts` — Imports into DuckDB, creates views + summary tables
3. `src/lib/datasets/vastu-hfc.ts` — Full DatasetConfig with schema, domain hints, agents
4. Registration in `src/lib/datasets/index.ts`

## Problem Statement

We need a demo dataset that lets Vastu's FP&A and risk teams ask real questions and see the kind of answers Sentinel provides. The dataset must:
- Produce numbers that match Vastu's published financials (AUM, PAT, GNPA, yields)
- Model both the HFC housing book AND the Finserve subsidiary
- Include planted anomalies for the LLM to discover (GNPA spike, underperforming state, etc.)
- Be fully self-consistent across all tables (FKs, aggregates, derived metrics)

## Technical Approach

### Architecture

Follow the established QuickHelp pattern:
```
scripts/generate-vastu-hfc.ts  →  data/csv/vastu-hfc/*.csv  →  setup-vastu-hfc.ts  →  data/vastu-hfc.duckdb
                                                                                            ↓
                                                              src/lib/datasets/vastu-hfc.ts (DatasetConfig)
```

### Implementation Phases

#### Phase 1: Generator Script — Core Tables (~60% of effort)

**File:** `scripts/generate-vastu-hfc.ts`

**Infrastructure (reuse from generate-quickhelp-v2.ts):**
- Seeded PRNG (seed 42 for reproducibility)
- Helper functions: `rand()`, `randInt()`, `pick()`, `weightedPick()`, `normalRand()`, `clamp()`, `shuffle()`
- `writeCsv(filename, rows, headers)` function
- Date utilities for FY-aware month iteration (Apr-Mar Indian fiscal year)

**Constants to define:**

```typescript
// Time range: 3 fiscal years (Apr 2022 – Mar 2025)
const FY_START = "2022-04-01";
const FY_END = "2025-03-31";

// Scale targets (must reconcile to published numbers)
const TARGET_HFC_AUM_CR = 9102;        // Standalone AUM Mar-25
const TARGET_FINSERVE_AUM_CR = 2435;   // Subsidiary AUM Mar-25
const TARGET_CONSOL_AUM_CR = 11423;    // Consolidated
const TARGET_ACTIVE_LOANS = 144118;    // Consolidated active loans
const TARGET_BRANCHES_HFC = 191;
const TARGET_BRANCHES_FINSERVE = 74;   // Some overlap with HFC

// Customer profile calibration (from annual report)
const SELF_EMPLOYED_PCT = 0.81;
const WOMEN_BORROWER_PCT = 0.99;
const MEDIAN_TICKET_LAKH = 12.5;       // ₹12-13 Lakh for HFC
const MEDIAN_CIBIL = 742;
const MEDIAN_LTV = 0.45;
const HOME_LOAN_PCT = 0.77;            // Of HFC standalone AUM
const NTC_PCT = 0.30;                  // New to credit

// Geographic distribution (15 states, no state >15%)
const STATES = [
  { name: "Maharashtra", weight: 0.14, cities: [...] },
  { name: "Rajasthan", weight: 0.13, cities: [...] },
  { name: "Gujarat", weight: 0.12, cities: [...] },
  { name: "Madhya Pradesh", weight: 0.11, cities: [...] },
  { name: "Uttar Pradesh", weight: 0.10, cities: [...] },
  { name: "Tamil Nadu", weight: 0.09, cities: [...] },
  { name: "Telangana", weight: 0.07, cities: [...] },
  { name: "Karnataka", weight: 0.06, cities: [...] },
  { name: "Andhra Pradesh", weight: 0.05, cities: [...] },
  { name: "Haryana", weight: 0.04, cities: [...] },
  { name: "Punjab", weight: 0.03, cities: [...] },
  { name: "Chhattisgarh", weight: 0.02, cities: [...] },
  { name: "Delhi", weight: 0.02, cities: [...] },
  { name: "Uttarakhand", weight: 0.01, cities: [...] },
  { name: "Puducherry", weight: 0.01, cities: [...] },
];

// Funding mix (from Board's Report)
const FUNDING_MIX = {
  bank: 0.50,
  nhb: 0.31,
  fi_dfi: 0.10,
  ecb: 0.08,
  ncd: 0.01,
};
```

**Generation Order (dependencies flow downward):**

```
Step 1:  branches.csv          (~226 rows)    — no dependencies
Step 2:  employees.csv         (~5,500 rows)  — depends on branches
Step 3:  borrowers.csv         (~1,20,000 rows) — depends on branches (for geography)
Step 4:  co_lending_partners.csv (~11 rows)   — no dependencies
Step 5:  loans.csv             (~1,50,000 rows) — depends on borrowers, branches, co_lending_partners
Step 6:  emi_payments.csv      (~25,00,000 rows) — depends on loans (EMI schedule generation)
Step 7:  disbursements.csv     (~5,000 rows)  — aggregated from loans by month × branch × product
Step 8:  borrowings.csv        (~500 rows)    — independent, calibrated to funding mix
Step 9:  collections_actions.csv (~50,000 rows) — depends on loans (delinquent subset)
Step 10: assignments.csv       (~2,000 rows)  — depends on loans (assigned subset)
Step 11: provisions.csv        (~36 rows)     — derived from loans stage distribution
Step 12: npa_movement.csv      (~12 rows)     — derived from loans stage transitions
```

**Step 1: branches.csv (~226 rows)**

| Column | Type | Generation Logic |
|--------|------|-----------------|
| branch_id | INTEGER | Sequential 1-226 |
| branch_name | VARCHAR | "{City} Branch" or "{City} {Area} Branch" |
| entity | VARCHAR | "hfc" (191) or "finserve" (74), some overlap cities |
| state | VARCHAR | Weighted by STATES distribution |
| city | VARCHAR | 2-5 cities per state, weighted by state urban hierarchy |
| city_tier | VARCHAR | "t30" (35%) or "b30" (65%) |
| branch_type | VARCHAR | "main" (30%), "small" (35%), "micro" (20%), "sales_office" (15%) |
| open_date | DATE | Distributed: 55% before FY23, 25% in FY23-24, 20% in FY25 |
| employee_count | INTEGER | main: 25-40, small: 12-20, micro: 5-10, SO: 5-8 |
| monthly_rent_inr | DOUBLE | T30: ₹1.5-3L, B30: ₹0.5-1.5L |
| is_active | BOOLEAN | 98% true (a few closed/merged) |

**Step 2: employees.csv (~5,500 rows)**

| Column | Type | Generation Logic |
|--------|------|-----------------|
| employee_id | INTEGER | Sequential |
| branch_id | INTEGER | FK → branches, distributed by employee_count |
| function | VARCHAR | sales (45%), credit (12%), collections (12%), operations (13%), legal_technical (8%), ho (10%) |
| join_date | DATE | Spread across company history, newer branches have newer employees |
| gender | VARCHAR | 70% male, 30% female (31% women in corporate, lower in field) |
| age | INTEGER | Normal dist, mean 32, std 6, range 22-55 |
| annual_ctc_lakh | DOUBLE | Function-dependent: sales ₹4-8L, credit ₹5-10L, HO ₹8-20L |
| is_active | BOOLEAN | 85% active (15% attrition rate) |

**Step 3: borrowers.csv (~1,20,000 rows)**

| Column | Type | Generation Logic |
|--------|------|-----------------|
| borrower_id | INTEGER | Sequential |
| first_name | VARCHAR | Pick from Indian name lists (state-appropriate) |
| gender | VARCHAR | 60% female, 40% male (99% have female applicant/co-applicant) |
| age | INTEGER | Normal dist, mean 35, std 8, range 22-60 |
| employment_type | VARCHAR | salaried_formal (10%), salaried_informal (9%), self_employed_formal (15%), self_employed_informal (66%) — total 81% SE |
| monthly_income_inr | DOUBLE | By employment type: SE-informal ₹20-60K, SE-formal ₹40-80K, salaried ₹25-70K. Log-normal. |
| income_category | VARCHAR | Derived: EWS (<₹25K), LIG (₹25-50K), MIG (₹50K+). Target: EWS 25%, LIG 47%, MIG 28% |
| industry | VARCHAR | 50+ industries: kirana_shop, tailoring, auto_repair, vegetable_vendor, dairy, poultry, construction_labor, etc. |
| state | VARCHAR | Weighted by branch distribution (borrowers cluster near branches) |
| city | VARCHAR | From branch cities + surrounding areas |
| city_tier | VARCHAR | "t30" or "b30" |
| bureau_score | INTEGER | 0 for NTC (~30%), else normal dist mean 742, std 60, range 550-850 |
| is_ntc | BOOLEAN | ~30% (new to credit, no bureau history) |
| signup_date | DATE | Spread across 3 FYs, front-loaded for older cohorts |
| property_type | VARCHAR | "independent_house" (70%), "apartment" (15%), "plot" (10%), "commercial" (5%) |

**Step 4: co_lending_partners.csv (~11 rows)**

| Column | Type | Generation Logic |
|--------|------|-----------------|
| partner_id | VARCHAR | DMI, TVS, HDB, NAC, Piramal, Utkarsh, VCPL, Finnable, Axis, Gosree, Tata |
| partner_name | VARCHAR | Full names |
| partner_type | VARCHAR | bank/nbfc/fintech |
| start_date | DATE | From Aegis vintage data (earliest cohort per partner) |
| product_focus | VARCHAR | "vehicle" / "msme" / "micro_housing" / "personal" |
| active | BOOLEAN | 9 active, 2 wound down |

**Step 5: loans.csv (~1,50,000 rows) — THE CRITICAL TABLE**

This is the most complex table. Two sub-populations:

**HFC Loans (~1,10,000 accounts):**

| Column | Type | Generation Logic |
|--------|------|-----------------|
| loan_id | INTEGER | Sequential |
| borrower_id | INTEGER | FK → borrowers |
| branch_id | INTEGER | FK → branches (entity=hfc) |
| entity | VARCHAR | "hfc" |
| product_type | VARCHAR | "home_purchase" (50%), "home_construction" (15%), "home_improvement" (12%), "lap_residential" (15%), "lap_commercial" (5%), "micro_housing" (3%) |
| disbursement_date | DATE | Spread across 3 FYs. Monthly volume: ~2,400/mo × growth curve |
| sanctioned_amount | DOUBLE | By product: HL ₹8-18L (normal, mean ₹13.2L), LAP ₹5-12L, micro ₹2-5L |
| disbursed_amount | DOUBLE | 95-100% of sanctioned |
| interest_rate | DOUBLE | HL: 12.5-16% (salaried lower), LAP: 15-19%, micro: 16-20%. PLR-based. |
| tenure_months | INTEGER | HL: 120-240, LAP: 60-180, micro: 36-120 |
| emi_amount | DOUBLE | = PMT(rate/12, tenure, -disbursed) |
| ltv_ratio | DOUBLE | Normal dist, mean 0.45, std 0.08, range 0.30-0.65 |
| property_value | DOUBLE | = disbursed / ltv |
| sourcing_channel | VARCHAR | "direct_sales" (40%), "dsa" (35%), "connector" (15%), "digital" (10%) |
| co_lending_partner | VARCHAR | NULL for all HFC loans (on-book) |
| loan_status | VARCHAR | "active" (65%), "closed" (22%), "npa" (2%), "written_off" (1%), "assigned" (10%) |
| dpd_bucket | VARCHAR | Current distribution: current 93%, sma_0 2%, sma_1 1.5%, sma_2 1.5%, npa 2% |
| stage | INTEGER | Derived from dpd: 0-30→1, 31-90→2, 90+→3. Target: S1 95%, S2 3.5%, S3 1.31% |
| overdue_amount | DOUBLE | 0 for current, calculated for delinquent |
| last_payment_date | DATE | Recent for current, stale for delinquent |

**Finserve Loans (~40,000 accounts):**

Same columns but different distributions:
- product_type: "used_cv" (40%), "used_car" (25%), "msme" (25%), "micro_housing_finserve" (10%)
- sanctioned_amount: ₹2-8L (mean ₹3.5L for vehicle, ₹5L for MSME)
- interest_rate: 18-25% (higher risk)
- tenure_months: 36-84 (shorter)
- co_lending_partner: One of 11 partners (weighted by Aegis volume)
- Stage 3 target: 2.23% (higher than HFC)
- Sourcing: more DSA-heavy (50%)

**Loan Status State Machine:**
```
disbursed → active → [closed | prepaid | assigned | npa → written_off]
                                                     ↑
                                              sma_0 → sma_1 → sma_2 → npa
```

**Vintage Cohort Logic:**
- Each month of origination is a "cohort"
- Older cohorts have higher closure rates (amortization) and higher cumulative defaults
- GDR curves from Project Aegis calibrate the Finserve default trajectory
- HFC GDR is much flatter (~0.3% per year reaching terminal ~2% at MOB 36)

**Step 6: emi_payments.csv (~25,00,000 rows) — LARGEST TABLE**

For each active/closed loan, generate monthly EMI records from disbursement to current date (or closure):

| Column | Type | Generation Logic |
|--------|------|-----------------|
| payment_id | INTEGER | Sequential |
| loan_id | INTEGER | FK → loans |
| due_date | DATE | 1st or 5th of each month after disbursement |
| amount_due | DOUBLE | EMI amount (from loan schedule) |
| amount_paid | DOUBLE | Full (79%), partial (4%), bounced-then-recovered (15%), missed (2%) |
| paid_date | DATE | On-time: due_date. Late: +1 to +90 days. Missed: NULL |
| payment_mode | VARCHAR | "nach" (55%), "upi" (20%), "cash" (15%), "cheque" (5%), "neft" (5%) |
| bounce | BOOLEAN | ~20% first presentation bounce rate. Higher for NTC, lower for seasoned. |
| dpd_at_payment | INTEGER | 0 if on-time, else days between due and paid |
| collection_bucket | VARCHAR | Derived from dpd: on_time/1_30/31_60/61_90/90_plus |

**Bounce pattern:**
- Base bounce rate: 20% (industry benchmark)
- NTC borrowers: +5% higher bounce first 6 months, then normalizes
- Monsoon months (Jul-Sep): +3% bounce
- Diwali/festival months (Oct-Nov): +2% bounce
- Self-employed informal: +4% vs salaried
- Finserve book: +8% vs HFC book

**Step 7-12: Supporting tables** (generated from loans/payments data)

- `disbursements.csv`: Aggregate loans by (month, branch, product, entity) → monthly disbursement log
- `borrowings.csv`: 500 funding lines (bank/NHB/NCD/ECB/FI), each with rate, maturity, outstanding. Calibrate to published funding mix.
- `collections_actions.csv`: For loans with DPD > 0, generate collection actions (call, visit, notice, legal). 2-5 actions per delinquent loan.
- `assignments.csv`: ~2,000 loan sale events to banks/ARCs, with LTV 45-52%, residual maturity 128-177 months (from filing data)
- `provisions.csv`: Monthly ECL by stage. Stage 1 PCR 0.3%, Stage 2 12%, Stage 3 40%. Derive from loan stage distribution.
- `npa_movement.csv`: Quarterly GNPA flow: opening → additions → upgrades → write-offs → recoveries → closing

#### Phase 2: Setup Script + DuckDB Views (~20% of effort)

**File:** `scripts/setup-vastu-hfc.ts`

**Views to create (denormalized):**

```sql
-- Primary denormalized view
CREATE VIEW loans_full AS
  SELECT l.*, b.first_name, b.gender, b.age, b.employment_type, b.monthly_income_inr,
         b.income_category, b.industry, b.bureau_score, b.is_ntc, b.property_type,
         br.branch_name, br.state, br.city, br.city_tier, br.entity AS branch_entity,
         c.partner_name, c.partner_type
  FROM loans l
  LEFT JOIN borrowers b USING (borrower_id)
  LEFT JOIN branches br ON l.branch_id = br.branch_id
  LEFT JOIN co_lending_partners c ON l.co_lending_partner = c.partner_id;

-- Collections view
CREATE VIEW collections_full AS
  SELECT cp.*, l.loan_status, l.product_type, l.entity, l.dpd_bucket,
         b.employment_type, b.income_category,
         br.state, br.city
  FROM emi_payments cp
  JOIN loans l USING (loan_id)
  JOIN borrowers b ON l.borrower_id = b.borrower_id
  JOIN branches br ON l.branch_id = br.branch_id;

-- Funding overview
CREATE VIEW funding_full AS
  SELECT * FROM borrowings;
```

**Summary tables to create (~20):**

```
OPERATIONS:
  monthly_disbursements     — month, entity, product_type, count, amount, avg_ticket
  branch_monthly_kpis       — branch_id, month, disbursements, aum_proxy, collections, bounce_rate, gnpa
  state_monthly_kpis        — state, month, branches, aum, disbursements, gnpa, bounce_rate

PORTFOLIO:
  product_performance       — product_type, entity, aum, yield, gnpa, avg_ticket, avg_ltv, avg_tenure
  vintage_cohort_analysis   — cohort_month, mob, cumulative_gdr_30, gdr_60, gdr_90
  stage_distribution        — month, stage_1_pct, stage_2_pct, stage_3_pct, pcr_1, pcr_2, pcr_3

RISK:
  dpd_flow_matrix           — month, from_bucket, to_bucket, count, amount (flow rates)
  npa_quarterly_movement    — quarter, opening, additions, upgrades, write_offs, recoveries, closing
  co_lending_performance    — partner_id, aum, gnpa, gdr_90, lgd, credit_cost

FINANCIAL:
  monthly_financials        — month, interest_income, fee_income, finance_cost, employee_cost, impairment, pbt, pat
  funding_position          — month, total_borrowings, bank_pct, nhb_pct, ncd_pct, ecb_pct, weighted_avg_cost
  assignment_summary        — quarter, count, amount, avg_ltv, avg_residual_maturity

COMPANY KPIs:
  monthly_company_kpis      — month, aum, disbursements, pat, roa, roe, nim, spread, gnpa, nnpa, pcr, car, d_e, branches, employees, active_loans, bounce_rate, collection_efficiency
  quarterly_company_kpis    — quarter, same metrics aggregated
```

#### Phase 3: Dataset Config + Registration (~20% of effort)

**File:** `src/lib/datasets/vastu-hfc.ts` (~800-1200 lines)

Key sections:
1. **schemaContext** — Full SQL schema documentation for LLM consumption (every table, column, type, description)
2. **systemContext** — AI persona: "You are Sentinel, an analytics assistant for an affordable housing finance company..."
3. **domainHints** — 25+ numbered rules for SQL generation:
   - "Only count Stage 3 (90+ DPD) as NPA, not SMA"
   - "Use loans_full view for any borrower-level query (pre-joined)"
   - "For collections analysis, use collections_full view"
   - "LTV is stored as decimal (0.45 = 45%)"
   - "Interest rates are annual (14.5% = 0.145)"
   - "Always filter entity = 'hfc' or 'finserve' when comparing books"
   - "For funding analysis, use funding_full view"
   - "GNPA = Stage 3 amount / total outstanding"
   - "Credit cost = impairment charge / average AUM"
   - "NIM = (interest income - finance cost) / average AUM"
   - etc.
4. **summaryTableHint** — When to use pre-computed tables vs raw data
5. **suggestedPrompts** — 6 questions for welcome screen:
   - "What's our GNPA trend by product type over the last 12 months?"
   - "Which state has the highest bounce rate and how has it trended?"
   - "Compare credit cost between HFC and Finserve books"
   - "Show me the vintage cohort analysis — which origination quarters are tracking worst?"
   - "What's our disbursement mix by sourcing channel and how has DSA quality changed?"
   - "Break down our funding cost by source type and show the NCD rundown"
6. **events** — 25+ curated events for Analytics Explorer:
   - Loan disbursed, EMI paid, EMI bounced, Loan closed, Loan defaulted (90+ DPD)
   - NPA addition, NPA upgrade, Write-off, Recovery
   - Assignment to bank, Assignment to ARC
   - Collection call, Collection visit, Legal notice
   - Branch opened, Employee joined
7. **agents** — 8 analysis agents:
   - data-quality, portfolio-health, vintage-analysis, credit-risk
   - collections-efficiency, funding-alm, branch-performance, profitability
8. **viewSQL** — CREATE VIEW statements (from Phase 2)
9. **summaryTableSQL** — CREATE TABLE statements (from Phase 2)

**Registration in `src/lib/datasets/index.ts`:**
```typescript
import { vastuHfcDataset } from "./vastu-hfc";
// Add to STATIC_DATASETS map
```

## Planted Anomalies (for demo discovery)

| # | Anomaly | Where | What FP&A Should Find |
|---|---------|-------|----------------------|
| 1 | **GNPA spike Q3-Q4 FY25** | loans (stage distribution over time) | Finserve vintage H1 FY24 cohorts hitting 18-24 MOB, GDR inflection. HFC book is stable at ~1.3% but Finserve jumped to 2.2%+ |
| 2 | **Madhya Pradesh underperformance** | branch_monthly_kpis, state_monthly_kpis | MP has 2x average bounce rate, 1.5x GNPA vs other states. Collections efficiency dropping. |
| 3 | **Seasonal collection dip** | emi_payments (Oct-Nov, Jun-Jul) | Diwali season and monsoon months show +3-5% bounce rate spikes. Recovery normalizes in 30-60 days. |
| 4 | **DSA sourcing quality degradation** | loans (by sourcing_channel × vintage) | DSA-sourced loans have 1.5x NPA rate vs direct. Getting worse in recent vintages (scale vs quality tradeoff). |
| 5 | **Finnable co-lending partner deteriorating** | co_lending_performance, vintage_cohort | Finnable-originated loans have 2x the GDR of other partners. Should be exited or repriced. |
| 6 | **NCD rundown** | borrowings, funding_position | NCDs dropped from ₹222 Cr → ₹38 Cr over 2 years, replaced by cheaper bank funding. Cost of funds improved 25bps. |
| 7 | **Assignment income volatility** | monthly_financials, assignment_summary | Q4 lumpy — most assignments happen in Mar for year-end optimization. Creates PAT volatility. |
| 8 | **New branch ramp-up cost** | branch_monthly_kpis | Branches <1yr old have 3x cost/AUM ratio. Takes 18-24 months to break even. |
| 9 | **NTC borrower first-year bounce then improvement** | emi_payments (by is_ntc × mob) | NTC borrowers bounce 25% in months 1-6, then drop to 15% by month 12 — they learn to pay. |
| 10 | **Prepayment surge in HL book** | loans (prepaid status × product) | Salaried HL borrowers prepaying at 2x rate in Q3-Q4 FY25 as banks offer lower rates — AUM leakage risk. |

## Calibration Targets

These numbers MUST match when the dataset is queried:

| Metric | Target | Source | Tolerance |
|--------|--------|--------|-----------|
| Consolidated AUM (Mar-25) | ₹11,423 Cr | FY25 AR | ±2% |
| HFC Standalone AUM | ₹9,102 Cr | FY25 AR | ±2% |
| Finserve AUM | ₹2,435 Cr | FY25 AR | ±5% |
| Active loans (consolidated) | 1,44,118 | FY25 AR | ±3% |
| HFC GNPA (Mar-25) | 1.31% | FY25 AR | ±0.1pp |
| Finserve GNPA | 2.23% | FY25 AR | ±0.2pp |
| Home loan % (standalone) | 77% | FY25 AR | ±2pp |
| Self-employed % | 81% | FY24 AR | ±2pp |
| Median LTV | 45% | FY24 AR | exact |
| Median CIBIL | 742 | FY24 AR | ±10 |
| Branches (consolidated) | 226 | FY25 AR | exact |
| Employees | 5,523 | FY25 AR | ±5% |
| Funding: Bank % | 50% | FY25 Board's Report | ±3pp |
| Funding: NHB % | 31% | FY25 Board's Report | ±3pp |
| No state >15% AUM | Yes | FY25 AR | Must hold |
| Interest income (FY25) | ~₹1,034 Cr | FY25 filing | ±10% |
| PAT (FY25) | ~₹328 Cr standalone | FY25 filing | ±10% |

## System-Wide Impact

### Interaction Graph
- Generator script → CSVs → Setup script → DuckDB
- DatasetConfig → registered in index.ts → DatasetProvider picks it up → all LLM queries use it
- Schema context → injected into every SQL generation prompt
- Events catalog → powers Analytics Explorer tabs

### State Lifecycle Risks
- **Referential integrity:** Every loan_id in emi_payments must exist in loans. Every borrower_id in loans must exist in borrowers. Every branch_id must exist in branches.
- **Aggregate consistency:** SUM(outstanding) across all active loans ≈ published AUM. Stage distribution must produce correct GNPA.
- **Temporal consistency:** No EMI payment before loan disbursement date. No branch employee before branch open date.

### Integration Test Scenarios
1. Query "What's our AUM?" → should return ~₹11,423 Cr (consolidated) or ~₹9,102 Cr (HFC)
2. Query "GNPA by entity" → HFC ~1.31%, Finserve ~2.23%
3. Query "Bounce rate by month" → should show seasonal pattern (Oct/Nov + Jul spike)
4. Query "Credit cost trend" → should show rising trend in recent quarters
5. Query "State-wise AUM" → no state >15%, MP should show as problem state

## Acceptance Criteria

### Functional Requirements
- [ ] Generator produces 12 CSV files with correct row counts and column types
- [ ] All FK relationships are valid (no orphan references)
- [ ] Aggregated metrics match calibration targets within tolerance
- [ ] DuckDB setup creates all views and summary tables without errors
- [ ] DatasetConfig loads in the app and LLM can generate valid SQL
- [ ] All 6 suggested prompts produce meaningful results
- [ ] Analytics Explorer events work for trends/funnel/retention
- [ ] All 10 planted anomalies are discoverable via natural language queries

### Non-Functional Requirements
- [ ] Generator runs in <5 minutes on standard laptop
- [ ] DuckDB file size <500MB
- [ ] EMI payments table queryable within 2 seconds (with appropriate indexes)
- [ ] Seeded PRNG produces identical output on re-run

### Quality Gates
- [ ] Validation script confirms all calibration targets
- [ ] No NULL in required columns
- [ ] Date ranges are within FY23-FY25
- [ ] Financial calculations are arithmetically correct (EMI = PMT formula)

## Dependencies & Prerequisites

- Node.js 22+ with tsx runner
- DuckDB node-api package (already in project)
- Existing helper patterns from generate-quickhelp-v2.ts
- Research data in `docs/vastu-hfc/complete-research-consolidated.md`
- Schema proposal in `docs/vastu-hfc/dataset-schema-proposal.md`

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| EMI payments table too large (25M rows) | Slow queries, large DuckDB file | Cap at 15M rows (last 18 months only for detailed payments, summarize older) |
| Financial numbers don't reconcile | Demo credibility destroyed | Build validation script that checks all calibration targets, run as CI gate |
| LLM generates wrong SQL for HFC domain | Demo fails in front of client | Extensive domain hints (25+ rules), test all 6 suggested prompts manually |
| Seeded PRNG doesn't reproduce across platforms | Different datasets on different machines | Use simple LCG algorithm (same as QuickHelp), test on Mac + Linux |

## File List

| File | Action | Description |
|------|--------|-------------|
| `scripts/generate-vastu-hfc.ts` | CREATE | Main generator (~2500 lines) |
| `scripts/setup-vastu-hfc.ts` | CREATE | DuckDB setup (~200 lines) |
| `scripts/validate-vastu-hfc.ts` | CREATE | Calibration validation (~100 lines) |
| `src/lib/datasets/vastu-hfc.ts` | CREATE | DatasetConfig (~1000 lines) |
| `src/lib/datasets/index.ts` | EDIT | Register vastu-hfc in STATIC_DATASETS |
| `src/lib/datasets/constants.ts` | EDIT | Possibly update DEFAULT_DATASET for demo |
| `data/csv/vastu-hfc/` | CREATE | Output directory for generated CSVs |
| `data/vastu-hfc.duckdb` | CREATE | Final DuckDB database |

## Sources & References

### Internal References
- Research consolidation: `docs/vastu-hfc/complete-research-consolidated.md`
- Schema proposal: `docs/vastu-hfc/dataset-schema-proposal.md`
- QuickHelp generator (pattern): `scripts/generate-quickhelp-v2.ts`
- QuickHelp setup (pattern): `scripts/setup-quickhelp.ts`
- Dataset types: `src/lib/datasets/types.ts`
- QuickHelp config (example): `src/lib/datasets/quickhelp.ts`

### External Data Sources
- Vastu FY25 Annual Report: `/Users/vimarsh/Downloads/Documents/vaastu /annual-report-24-25-vaastu.pdf`
- Vastu FY24 Annual Report: `/Users/vimarsh/Downloads/Documents/vaastu /annual-report-23-240-vaastu.pdf`
- Project Aegis KPMG Credit Model: `/Users/vimarsh/Downloads/Documents/vaastu /Project Aegis - Draft Credit Cost Databook 040725 (Caps) - next 12 months.xlsx`
- Vastu FY25 Financial Results: `/Users/vimarsh/Downloads/Documents/vaastu /Audited-Financial-Results-for-the-quarter-and-year-ended-31st-March-2025.pdf`
- Vastu Q3 FY26 Results: `/Users/vimarsh/Downloads/Documents/vaastu /Audited-Financial-Results-for-the-quarter-ended-31st-December-2025.pdf`
- Analyst Reports (Investec, Citi, JM Financial, Morgan Stanley): `/Users/vimarsh/Downloads/Documents/vaastu /`
