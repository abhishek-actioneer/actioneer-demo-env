import type { EventDefinition } from "../explorer-types";
import type { DatasetConfig } from "./types";

// ══════════════════════════════════════════════════════════
// EVENT PROPERTIES (for Analytics Explorer)
// ══════════════════════════════════════════════════════════

// Properties available on loans_full (raw_loans + borrower + branch + co-lending joins).
// Every column below is a real column produced by the generator / viewSQL join.
const LOAN_PROPERTIES: EventDefinition["properties"] = [
  { column: "entity", displayName: "Entity", type: "string", cardinalityHint: "low" },
  { column: "product_type", displayName: "Product Type", type: "string", cardinalityHint: "medium" },
  { column: "sourcing_channel", displayName: "Sourcing Channel", type: "string", cardinalityHint: "low" },
  { column: "loan_status", displayName: "Loan Status", type: "string", cardinalityHint: "low" },
  { column: "dpd_bucket", displayName: "DPD Bucket", type: "string", cardinalityHint: "low" },
  { column: "stage", displayName: "IndAS Stage", type: "number", cardinalityHint: "low" },
  { column: "co_lending_partner", displayName: "Co-lending Partner", type: "string", cardinalityHint: "low" },
  { column: "co_lending_partner_type", displayName: "Co-lending Partner Type", type: "string", cardinalityHint: "low" },
  { column: "state", displayName: "State", type: "string", cardinalityHint: "medium" },
  { column: "city", displayName: "City", type: "string", cardinalityHint: "medium" },
  { column: "city_tier", displayName: "City Tier", type: "string", cardinalityHint: "low" },
  { column: "branch_name", displayName: "Branch", type: "string", cardinalityHint: "high" },
  { column: "branch_type", displayName: "Branch Type", type: "string", cardinalityHint: "low" },
  { column: "employment_type", displayName: "Employment Type", type: "string", cardinalityHint: "low" },
  { column: "income_category", displayName: "Income Category", type: "string", cardinalityHint: "low" },
  { column: "industry", displayName: "Industry", type: "string", cardinalityHint: "high" },
  { column: "property_type", displayName: "Property Type", type: "string", cardinalityHint: "low" },
  { column: "borrower_gender", displayName: "Borrower Gender", type: "string", cardinalityHint: "low" },
  { column: "is_ntc", displayName: "New-to-Credit", type: "string", cardinalityHint: "low" },
];

// Properties available on collections_full (raw_emi_payments + loan + borrower + branch joins).
const EMI_PROPERTIES: EventDefinition["properties"] = [
  { column: "collection_bucket", displayName: "Collection Bucket", type: "string", cardinalityHint: "low" },
  { column: "payment_mode", displayName: "Payment Mode", type: "string", cardinalityHint: "low" },
  { column: "bounce", displayName: "Bounced", type: "string", cardinalityHint: "low" },
  { column: "entity", displayName: "Entity", type: "string", cardinalityHint: "low" },
  { column: "product_type", displayName: "Product Type", type: "string", cardinalityHint: "medium" },
  { column: "loan_status", displayName: "Loan Status", type: "string", cardinalityHint: "low" },
  { column: "loan_dpd_bucket", displayName: "Loan DPD Bucket", type: "string", cardinalityHint: "low" },
  { column: "loan_stage", displayName: "Loan Stage", type: "number", cardinalityHint: "low" },
  { column: "sourcing_channel", displayName: "Sourcing Channel", type: "string", cardinalityHint: "low" },
  { column: "co_lending_partner", displayName: "Co-lending Partner", type: "string", cardinalityHint: "low" },
  { column: "employment_type", displayName: "Employment Type", type: "string", cardinalityHint: "low" },
  { column: "income_category", displayName: "Income Category", type: "string", cardinalityHint: "low" },
  { column: "is_ntc", displayName: "New-to-Credit", type: "string", cardinalityHint: "low" },
  { column: "state", displayName: "State", type: "string", cardinalityHint: "medium" },
  { column: "city", displayName: "City", type: "string", cardinalityHint: "medium" },
  { column: "city_tier", displayName: "City Tier", type: "string", cardinalityHint: "low" },
];

// Properties available on collections_actions_full (raw_collections_actions + loan join).
// NOTE: no state/city/branch_name — the loan join only adds entity/product_type/loan_status.
const COLLECTION_PROPERTIES: EventDefinition["properties"] = [
  { column: "action_type", displayName: "Action Type", type: "string", cardinalityHint: "low" },
  { column: "result", displayName: "Result", type: "string", cardinalityHint: "low" },
  { column: "dpd_at_action", displayName: "DPD at Action", type: "number", cardinalityHint: "high" },
  { column: "entity", displayName: "Entity", type: "string", cardinalityHint: "low" },
  { column: "product_type", displayName: "Product Type", type: "string", cardinalityHint: "medium" },
  { column: "loan_status", displayName: "Loan Status", type: "string", cardinalityHint: "low" },
];

// Properties available on raw_branches.
const BRANCH_PROPERTIES: EventDefinition["properties"] = [
  { column: "entity", displayName: "Entity", type: "string", cardinalityHint: "low" },
  { column: "state", displayName: "State", type: "string", cardinalityHint: "medium" },
  { column: "city", displayName: "City", type: "string", cardinalityHint: "medium" },
  { column: "city_tier", displayName: "City Tier", type: "string", cardinalityHint: "low" },
  { column: "branch_type", displayName: "Branch Type", type: "string", cardinalityHint: "low" },
];

// ══════════════════════════════════════════════════════════
// EVENTS CATALOG (Analytics Explorer)
//
// Coverage notes:
//  - disbursement_date is the only real per-event timestamp on loans, so
//    ORIGINATION / DISBURSEMENT events are funnelEligible (true by default).
//  - REPAYMENT / COLLECTION-ACTION events have real per-event timestamps
//    (due_date, paid_date, action_date) and are funnelEligible.
//  - DELINQUENCY / portfolio-status events are state flags on the parent loan
//    row with no transition timestamp, so they are funnelEligible: false
//    (their dateColumn falls back to disbursement/last_payment date). They are
//    still valid for trends and segment breakdowns.
//  - Branch openings have no borrower_id, so they are funnelEligible: false.
// ══════════════════════════════════════════════════════════

const VASTU_EVENTS: EventDefinition[] = [
  // ── ORIGINATION & DISBURSEMENT ──────────────────────────────────────────
  { id: "loan_disbursed", displayName: "Loan Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", properties: LOAN_PROPERTIES },
  { id: "loan_sanctioned", displayName: "Loan Sanctioned (Amount)", category: "Origination", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "sanctioned_amount", properties: LOAN_PROPERTIES },
  { id: "hfc_loan_disbursed", displayName: "HFC Loan Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "entity = 'hfc'", properties: LOAN_PROPERTIES },
  { id: "finserve_loan_disbursed", displayName: "Finserve Loan Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "entity = 'finserve'", properties: LOAN_PROPERTIES },
  { id: "home_loan_disbursed", displayName: "Home Loan Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "product_type LIKE 'home%'", properties: LOAN_PROPERTIES },
  { id: "lap_disbursed", displayName: "LAP Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "product_type LIKE 'lap%'", properties: LOAN_PROPERTIES },
  { id: "micro_housing_disbursed", displayName: "Micro-Housing Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "product_type LIKE 'micro_housing%'", properties: LOAN_PROPERTIES },
  { id: "vehicle_loan_disbursed", displayName: "Vehicle Loan Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "product_type IN ('used_cv', 'used_car')", properties: LOAN_PROPERTIES },
  { id: "msme_loan_disbursed", displayName: "MSME Loan Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "product_type = 'msme'", properties: LOAN_PROPERTIES },
  { id: "co_lending_disbursed", displayName: "Co-Lending Loan Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "co_lending_partner != ''", properties: LOAN_PROPERTIES },
  { id: "ntc_loan_disbursed", displayName: "New-to-Credit Loan Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "is_ntc = true", properties: LOAN_PROPERTIES },

  // ── LOAN LIFECYCLE / EXITS ──────────────────────────────────────────────
  { id: "loan_closed", displayName: "Loan Closed", category: "Loan Lifecycle", table: "loans_full", dateColumn: "last_payment_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "loan_status = 'closed'", properties: LOAN_PROPERTIES },
  { id: "loan_prepaid", displayName: "Loan Prepaid (Early Closure)", category: "Loan Lifecycle", table: "loans_full", dateColumn: "last_payment_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "loan_status = 'prepaid'", properties: LOAN_PROPERTIES },
  { id: "loan_assigned", displayName: "Loan Assigned (Sold)", category: "Loan Lifecycle", table: "loans_full", dateColumn: "last_payment_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "loan_status = 'assigned'", funnelEligible: false, properties: LOAN_PROPERTIES },

  // ── REPAYMENT (EMI) ─────────────────────────────────────────────────────
  { id: "emi_due", displayName: "EMI Due", category: "Repayment", table: "collections_full", dateColumn: "due_date", countColumn: "*", valueColumn: "amount_due", properties: EMI_PROPERTIES },
  { id: "emi_paid", displayName: "EMI Paid", category: "Repayment", table: "collections_full", dateColumn: "paid_date", countColumn: "*", valueColumn: "amount_paid", filterSQL: "amount_paid > 0 AND paid_date IS NOT NULL", properties: EMI_PROPERTIES },
  { id: "emi_paid_on_time", displayName: "EMI Paid On Time", category: "Repayment", table: "collections_full", dateColumn: "paid_date", countColumn: "*", valueColumn: "amount_paid", filterSQL: "amount_paid > 0 AND paid_date IS NOT NULL AND dpd_at_payment = 0", properties: EMI_PROPERTIES },
  { id: "emi_late", displayName: "EMI Paid Late (DPD > 0)", category: "Repayment", table: "collections_full", dateColumn: "paid_date", countColumn: "*", valueColumn: "amount_paid", filterSQL: "dpd_at_payment > 0 AND amount_paid > 0 AND paid_date IS NOT NULL", properties: EMI_PROPERTIES },
  { id: "emi_partial", displayName: "EMI Partial Payment", category: "Repayment", table: "collections_full", dateColumn: "paid_date", countColumn: "*", valueColumn: "amount_paid", filterSQL: "amount_paid > 0 AND amount_paid < amount_due AND paid_date IS NOT NULL", properties: EMI_PROPERTIES },
  { id: "emi_via_nach", displayName: "EMI Paid via NACH", category: "Repayment", table: "collections_full", dateColumn: "paid_date", countColumn: "*", valueColumn: "amount_paid", filterSQL: "payment_mode = 'nach' AND amount_paid > 0 AND paid_date IS NOT NULL", properties: EMI_PROPERTIES },
  { id: "emi_via_upi", displayName: "EMI Paid via UPI", category: "Repayment", table: "collections_full", dateColumn: "paid_date", countColumn: "*", valueColumn: "amount_paid", filterSQL: "payment_mode = 'upi' AND amount_paid > 0 AND paid_date IS NOT NULL", properties: EMI_PROPERTIES },

  // ── DELINQUENCY (EMI-level, real timestamps) ────────────────────────────
  { id: "emi_bounced", displayName: "EMI Bounced", category: "Delinquency", table: "collections_full", dateColumn: "due_date", countColumn: "*", valueColumn: "amount_due", filterSQL: "bounce = true", properties: EMI_PROPERTIES },
  { id: "emi_missed", displayName: "EMI Missed (Unpaid)", category: "Delinquency", table: "collections_full", dateColumn: "due_date", countColumn: "*", valueColumn: "amount_due", filterSQL: "amount_paid = 0", properties: EMI_PROPERTIES },

  // ── ASSET QUALITY (portfolio status flags — no transition timestamp) ─────
  { id: "npa_addition", displayName: "NPA Addition (90+ DPD)", category: "Asset Quality", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "overdue_amount", filterSQL: "stage = 3 AND loan_status = 'npa'", funnelEligible: false, properties: LOAN_PROPERTIES },
  { id: "written_off", displayName: "Written Off", category: "Asset Quality", table: "loans_full", dateColumn: "last_payment_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "loan_status = 'written_off'", funnelEligible: false, properties: LOAN_PROPERTIES },
  { id: "sma_0_loan", displayName: "SMA-0 (1-30 DPD)", category: "Asset Quality", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "overdue_amount", filterSQL: "dpd_bucket = 'sma_0'", funnelEligible: false, properties: LOAN_PROPERTIES },
  { id: "sma_1_loan", displayName: "SMA-1 (31-60 DPD)", category: "Asset Quality", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "overdue_amount", filterSQL: "dpd_bucket = 'sma_1'", funnelEligible: false, properties: LOAN_PROPERTIES },
  { id: "sma_2_loan", displayName: "SMA-2 (61-90 DPD)", category: "Asset Quality", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "overdue_amount", filterSQL: "dpd_bucket = 'sma_2'", funnelEligible: false, properties: LOAN_PROPERTIES },
  { id: "stage_2_loan", displayName: "Stage 2 (Under-performing)", category: "Asset Quality", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "overdue_amount", filterSQL: "stage = 2", funnelEligible: false, properties: LOAN_PROPERTIES },
  { id: "stage_3_loan", displayName: "Stage 3 (NPA)", category: "Asset Quality", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "overdue_amount", filterSQL: "stage = 3", funnelEligible: false, properties: LOAN_PROPERTIES },

  // ── COLLECTION ACTIONS (real per-action timestamps) ─────────────────────
  { id: "collection_call", displayName: "Collection Call", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type = 'call'", properties: COLLECTION_PROPERTIES },
  { id: "sms_reminder", displayName: "SMS Reminder", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type = 'sms_reminder'", properties: COLLECTION_PROPERTIES },
  { id: "field_visit", displayName: "Field Visit", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type = 'field_visit'", properties: COLLECTION_PROPERTIES },
  { id: "demand_notice", displayName: "Demand Notice", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type = 'demand_notice'", properties: COLLECTION_PROPERTIES },
  { id: "legal_notice", displayName: "Legal Notice", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type = 'legal_notice'", properties: COLLECTION_PROPERTIES },
  { id: "sarfaesi_action", displayName: "SARFAESI Action", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type = 'sarfaesi'", properties: COLLECTION_PROPERTIES },
  { id: "collection_promise_to_pay", displayName: "Promise to Pay Secured", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "result = 'promise_to_pay'", properties: COLLECTION_PROPERTIES },
  { id: "collection_resolved", displayName: "Collection Resolved", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "result = 'resolved'", properties: COLLECTION_PROPERTIES },

  // ── BRANCH OPERATIONS (no borrower_id → not funnel-eligible) ─────────────
  { id: "branch_opened", displayName: "Branch Opened", category: "Branch Operations", table: "raw_branches", dateColumn: "open_date", countColumn: "*", funnelEligible: false, properties: BRANCH_PROPERTIES },
];

// ══════════════════════════════════════════════════════════
// DATASET CONFIG
// ══════════════════════════════════════════════════════════

export const vastuHfcDataset: DatasetConfig = {
  id: "vastu-hfc",
  label: "Banking & Lending",
  companyName: "Vastu Housing Finance",
  dbFile: "data/vastu-hfc.duckdb",
  sourceType: "csv",
  primaryTable: "loans_full",
  userIdField: "borrower_id",
  dateField: "disbursement_date",
  dateRange: { start: "2022-04-01", end: "2025-03-31" },
  currency: "₹",
  entityName: "borrowers",
  events: VASTU_EVENTS,

  reportMeta: {
    totalEvents: "1.87L loans · 18L EMIs",
    totalUsers: "1.20L borrowers",
    dateRangeLabel: "Apr 2022 – Mar 2025 (FY23–FY25)",
    dbName: "vastu-hfc.duckdb",
  },

  suggestedPrompts: [
    "How has our GNPA trended over the last 12 months across housing and vehicle finance?",
    "Which states have the highest bounce rates and NPA, and where is it worsening?",
    "How do credit cost and yield compare between housing loans and vehicle loans?",
    "Which origination quarters show the worst NPA in our vintage cohorts?",
    "What is our disbursement mix by sourcing channel, and how has DSA quality changed?",
    "What is our funding cost by source, and how is the borrowing book maturing?",
  ],

  welcomeSubtitle: "Ask about your loan book, collections, asset quality, branches, and funding across housing and vehicle finance.",

  // ═══════════════════════════════════════════════════════
  // DOMAIN HINTS (injected into SQL generation prompts)
  // ═══════════════════════════════════════════════════════

  domainHints: `
6. TWO-BOOK STRUCTURE: The data has two entities — 'hfc' (housing finance, standalone) and 'finserve' (subsidiary — vehicle/MSME loans). Always filter by entity when comparing books. Use entity = 'hfc' for housing questions, entity = 'finserve' for vehicle/MSME.
7. USE loans_full VIEW for any loan-level query — it is pre-joined with borrowers, branches, and co-lending partners. Never join raw_loans + raw_borrowers manually.
8. USE collections_full VIEW for EMI/payment analysis — pre-joined with loan, borrower, and branch context.
9. USE funding_full VIEW for borrowings/liability analysis.
10. GNPA = Gross NPA = (count or amount of Stage 3 loans) / (count or amount of active + NPA loans) × 100. Stage 3 means 90+ DPD.
11. DPD BUCKETS: current (0 DPD), sma_0 (1-30 DPD), sma_1 (31-60 DPD), sma_2 (61-90 DPD), npa_90 (90-180), npa_180 (180-360), npa_360_plus (>360). Stage 1 = current+sma_0+sma_1, Stage 2 = sma_2, Stage 3 = npa_*.
12. LOAN STATUS: 'active' (performing), 'closed' (fully repaid), 'prepaid' (early closure), 'npa' (non-performing), 'written_off' (irrecoverable), 'assigned' (sold to bank/ARC).
13. AUM = Assets Under Management = SUM(disbursed_amount) WHERE loan_status IN ('active', 'npa'). Only count live loans.
14. PRODUCT TYPES: HFC has home_purchase, home_construction, home_improvement, lap_residential, lap_commercial, micro_housing. Finserve has used_cv, used_car, msme, micro_housing_finserve.
15. HOME LOAN % = share of home_purchase + home_construction + home_improvement + micro_housing in HFC AUM.
16. INTEREST RATES are annual (e.g., 14.5 means 14.5% per annum). HFC rates: 12.5-21%, Finserve: 17-25%.
17. LTV is stored as decimal (0.45 = 45%). Median LTV is ~45% for HFC book.
18. BUREAU_SCORE: 0 means New-to-Credit (NTC). Valid scores range 550-850. Median is ~742 for credit-tested borrowers.
19. EMPLOYMENT TYPE: salaried_formal, salaried_informal, self_employed_formal, self_employed_informal. ~81% of borrowers are self-employed.
20. INCOME CATEGORY: ews (< ₹25K/month), lig (₹25-50K), mig (₹50K+). Derived from monthly_income_inr.
21. INDIAN FISCAL YEAR: FY runs April to March. FY25 = Apr 2024 to Mar 2025. Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar.
22. CURRENCY is INR (₹). All amounts in the loans table are in INR (not Lakh or Cr). To convert: 1 Lakh = 100,000, 1 Cr = 10,000,000.
23. CO-LENDING: Only Finserve loans have co_lending_partner set. HFC loans have empty co_lending_partner. Use co_lending_performance summary table for partner-level analysis.
24. BOUNCE RATE = COUNT(bounce = true) / total EMIs × 100. Industry benchmark ~20%. Check monthly_collections summary table.
25. COLLECTION EFFICIENCY = SUM(amount_paid) / SUM(amount_due) × 100. Target >95%.
26. FUNDING MIX: Use funding_position summary table. Sources: bank (50%), nhb (31%), fi_dfi (10%), ecb (8%), ncd (1%). borrowings amounts are in Cr (crore).
27. PROVISIONS: ECL provisioning follows IndAS 109. Stage 1 PCR ~0.3%, Stage 2 ~12%, Stage 3 ~40%. Use ecl_provisions table.
28. NPA MOVEMENT: Use npa_quarterly_movement table for opening → additions → upgrades → write-offs → recoveries → closing analysis.
29. ASSIGNMENTS: Use assignment_summary table for loan sale data (to banks and ARCs). MRR = Minimum Risk Retention (10% for most).
30. SUMMARY TABLES: Prefer these for broad aggregations:
    - OPERATIONS: monthly_disbursements, branch_monthly_kpis, state_monthly_kpis
    - PORTFOLIO: product_performance, stage_distribution
    - RISK: collection_efficiency, co_lending_performance, npa_quarterly_movement, ecl_provisions
    - FINANCIAL: funding_position, assignment_summary
    - SOURCING: sourcing_channel_performance, borrower_profile_summary
    - COMPANY KPIs: monthly_company_kpis, quarterly_company_kpis
    - COLLECTIONS: monthly_collections
    - HR: employee_summary
    Use raw loans_full/collections_full for custom analysis, cohorts, or per-loan drilldowns.
31. STATE CONCENTRATION: No single state should contribute >15% of AUM. 15 states covered. Use state_monthly_kpis.
32. BRANCH VINTAGE matters — newer branches (<1yr) have higher cost/AUM ratios. Use branch_open_date for vintage analysis.
33. SOURCING CHANNEL QUALITY: DSA-sourced loans tend to have higher NPA than direct_sales. Check sourcing_channel_performance.
`,

  summaryTableHint: `Use summary tables when they can answer the question:
- OPERATIONS: monthly_disbursements (by entity, product, month), branch_monthly_kpis, state_monthly_kpis
- PORTFOLIO: product_performance (by entity, product), stage_distribution (by entity, cohort month)
- RISK: collection_efficiency (monthly bounce/collection rates), co_lending_performance (partner-level), npa_quarterly_movement, ecl_provisions
- FINANCIAL: funding_position (by source type), assignment_summary
- SOURCING: sourcing_channel_performance (by entity, channel), borrower_profile_summary (by employment, income, NTC)
- COMPANY KPIs: monthly_company_kpis, quarterly_company_kpis (board-level metrics)
- COLLECTIONS: monthly_collections (by entity, month)
- HR: employee_summary (by entity, state, function)

Use raw loans_full/collections_full for custom analysis like:
- Cohort analysis (by disbursement_date vintage)
- Per-borrower or per-loan drilldowns
- Cross-dimensional queries not covered by summary tables`,

  // ═══════════════════════════════════════════════════════
  // SCHEMA CONTEXT (for LLM SQL generation)
  // ═══════════════════════════════════════════════════════

  schemaContext: `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect)

═══ DENORMALIZED VIEWS (USE THESE FOR QUERIES) ═══

VIEW: loans_full (~1.87L rows, Apr 2022 – Mar 2025)
  Pre-joined: loans + borrowers + branches + co_lending_partners
  -- Loan core
  - loan_id             INTEGER       -- Unique loan identifier
  - borrower_id         INTEGER       -- FK to borrower
  - branch_id           INTEGER       -- FK to branch
  - entity              VARCHAR       -- 'hfc' or 'finserve' (CRITICAL: always filter by this)
  - product_type        VARCHAR       -- home_purchase, home_construction, home_improvement, lap_residential, lap_commercial, micro_housing, used_cv, used_car, msme, micro_housing_finserve
  - disbursement_date   DATE          -- When the loan was disbursed
  - sanctioned_amount   DOUBLE        -- Sanctioned amount in INR
  - disbursed_amount    DOUBLE        -- Disbursed amount in INR (used for AUM calculation)
  - interest_rate       DOUBLE        -- Annual interest rate (e.g., 14.5 = 14.5%)
  - tenure_months       INTEGER       -- Loan tenure in months
  - emi_amount          DOUBLE        -- Monthly EMI in INR
  - ltv_ratio           DOUBLE        -- Loan-to-Value ratio (decimal, e.g., 0.45 = 45%)
  - property_value      DOUBLE        -- Property/asset value in INR
  - sourcing_channel    VARCHAR       -- direct_sales, dsa, connector, digital
  - co_lending_partner  VARCHAR       -- Partner ID (Finserve only) or empty string
  - loan_status         VARCHAR       -- active, closed, prepaid, npa, written_off, assigned
  - dpd_bucket          VARCHAR       -- current, sma_0, sma_1, sma_2, npa_90, npa_180, npa_360_plus
  - stage               INTEGER       -- 1, 2, or 3 (IndAS classification)
  - overdue_amount      DOUBLE        -- Amount overdue in INR
  - last_payment_date   DATE          -- Date of last EMI payment received
  -- Borrower fields (from borrowers table)
  - borrower_name       VARCHAR       -- First name
  - borrower_gender     VARCHAR       -- male, female
  - borrower_age        INTEGER       -- Age
  - employment_type     VARCHAR       -- salaried_formal, salaried_informal, self_employed_formal, self_employed_informal
  - monthly_income_inr  DOUBLE        -- Monthly income in INR
  - income_category     VARCHAR       -- ews, lig, mig
  - industry            VARCHAR       -- 50+ industries (kirana_shop, tailoring, auto_repair, etc.)
  - bureau_score        INTEGER       -- CIBIL score (0 = NTC)
  - is_ntc              BOOLEAN       -- New to Credit flag
  - property_type       VARCHAR       -- independent_house, apartment, plot, commercial
  -- Branch fields
  - branch_name         VARCHAR       -- Branch name
  - state               VARCHAR       -- State (15 states)
  - city                VARCHAR       -- City name
  - city_tier           VARCHAR       -- t30 or b30
  - branch_type         VARCHAR       -- main, small, micro, sales_office
  - branch_open_date    DATE          -- When branch was opened
  -- Co-lending fields
  - co_lending_partner_name  VARCHAR  -- Partner full name (Finserve only)
  - co_lending_partner_type  VARCHAR  -- bank, nbfc, fintech

VIEW: collections_full (~18L rows, Oct 2023 – Mar 2025)
  Pre-joined: emi_payments + loans + borrowers + branches
  - payment_id          INTEGER
  - loan_id             INTEGER
  - borrower_id         INTEGER       -- FK to borrower (from loans)
  - due_date            DATE          -- EMI due date (5th of month)
  - amount_due          DOUBLE        -- EMI amount due in INR
  - amount_paid         DOUBLE        -- Amount actually paid (0 if missed)
  - paid_date           DATE          -- When payment was received (empty if missed)
  - payment_mode        VARCHAR       -- nach, upi, cash, cheque, neft
  - bounce              BOOLEAN       -- First presentation bounce
  - dpd_at_payment      INTEGER       -- Days past due when paid
  - collection_bucket   VARCHAR       -- on_time, 1_30, 31_60, 61_90, 90_plus
  -- Joined from loans
  - entity              VARCHAR       -- hfc or finserve
  - product_type        VARCHAR
  - interest_rate       DOUBLE
  - loan_status         VARCHAR
  - loan_dpd_bucket     VARCHAR
  - loan_stage          INTEGER
  - sourcing_channel    VARCHAR
  - co_lending_partner  VARCHAR
  -- Joined from borrowers
  - employment_type     VARCHAR
  - income_category     VARCHAR
  - is_ntc              BOOLEAN
  -- Joined from branches
  - state               VARCHAR
  - city                VARCHAR
  - city_tier           VARCHAR
  - branch_name         VARCHAR

VIEW: funding_full (~253 rows)
  - borrowing_id          INTEGER
  - source_type           VARCHAR     -- bank, nhb, fi_dfi, ecb, ncd
  - lender_name           VARCHAR
  - sanctioned_amount_cr  DOUBLE      -- In crore
  - outstanding_amount_cr DOUBLE      -- In crore
  - interest_rate         DOUBLE      -- Annual rate
  - start_date            DATE
  - maturity_date         DATE
  - is_fixed_rate         BOOLEAN
  - repayment_frequency   VARCHAR     -- monthly, quarterly, semi_annual, annual

VIEW: branches_full (~266 rows)
  - branch_id, branch_name, entity, state, city, city_tier, branch_type, open_date
  - employee_count, monthly_rent_inr, is_active
  - active_employees      INTEGER     -- Derived: count of active employees
  - total_annual_ctc_lakh DOUBLE      -- Derived: total CTC of active employees

VIEW: collections_actions_full
  Pre-joined: raw_collections_actions + loan context
  - action_id           INTEGER
  - loan_id             INTEGER
  - action_date         DATE      -- Real per-action timestamp
  - action_type         VARCHAR   -- call | sms_reminder | field_visit | demand_notice | legal_notice | sarfaesi
  - dpd_at_action       INTEGER   -- Days past due when the action was taken
  - result              VARCHAR   -- promise_to_pay | partial_payment | no_contact | dispute | resolved | escalated
  - agent_id            INTEGER   -- Collection agent reference
  - branch_id           INTEGER   -- Branch of the loan
  - borrower_id         INTEGER   -- from loans join
  - entity              VARCHAR   -- hfc or finserve
  - product_type        VARCHAR
  - loan_status         VARCHAR

═══ SUMMARY TABLES ═══

TABLE: monthly_disbursements         — month, entity, product_type, loan_count, total_amount, avg_ticket_size, avg_rate, avg_ltv
TABLE: branch_monthly_kpis           — branch_id, branch_name, state, city, entity, month, disbursement_count, disbursement_amount, avg_rate, active_loans, aum_proxy, npa_count, gnpa_pct
TABLE: state_monthly_kpis            — state, month, entity, branches, loans_disbursed, disbursement_amount, avg_ticket, avg_rate, avg_ltv, npa_count, gnpa_pct
TABLE: product_performance           — entity, product_type, total_loans, active_loans, total_disbursed, aum, avg_ticket_size, avg_yield, avg_ltv, avg_tenure_months, stage_3_count, gnpa_pct
TABLE: stage_distribution            — entity, cohort_month, total_loans, stage_1, stage_2, stage_3, stage_1_pct, stage_2_pct, stage_3_pct
TABLE: collection_efficiency         — month, total_emis, paid_emis, total_due, total_collected, collection_efficiency_pct, bounced_emis, bounce_rate_pct, avg_dpd
TABLE: co_lending_performance        — partner_id, partner_name, partner_type, product_focus, total_loans, active_loans, total_disbursed, aum, avg_yield, npa_count, gnpa_pct
TABLE: npa_quarterly_movement        — quarter, entity, opening_gnpa_cr, additions_cr, upgradations_cr, write_offs_cr, recoveries_cr, closing_gnpa_cr, gnpa_pct
TABLE: ecl_provisions                — month, entity, stage_1/2/3_exposure_cr, stage_1/2/3_provision_cr, pcr_stage_1/2/3, total_ecl_cr, write_offs_cr, recoveries_cr
TABLE: funding_position              — source_type, facility_count, total_sanctioned_cr, total_outstanding_cr, weighted_avg_cost, min_rate, max_rate, fixed_rate_count, floating_rate_count
TABLE: assignment_summary            — assignment_id, transaction_date, buyer_type, buyer_name, loan_count, amount_assigned_cr, mrr_pct, avg_ltv, wtd_avg_residual_maturity_months, wtd_avg_holding_period_months
TABLE: sourcing_channel_performance  — entity, sourcing_channel, total_loans, total_disbursed, avg_ticket, avg_rate, npa_count, gnpa_pct
TABLE: borrower_profile_summary      — entity, employment_type, income_category, is_ntc, loan_count, total_disbursed, avg_ticket, avg_cibil, avg_ltv, npa_count, gnpa_pct
TABLE: monthly_company_kpis          — month, total_loans_originated, total_disbursed, avg_ticket_size, active_loans, active_aum, hfc_aum, finserve_aum, stage_3_count, gnpa_pct, home_loan_pct, avg_yield, avg_ltv, dsa_sourced_pct
TABLE: quarterly_company_kpis        — fy_quarter, fy, loans_originated, total_disbursed, avg_yield, avg_gnpa_pct, avg_home_loan_pct, avg_dsa_pct
TABLE: monthly_collections           — month, entity, total_emis, total_due, total_collected, bounced, bounce_rate, collection_efficiency, avg_dpd
TABLE: employee_summary              — entity, state, function_type, total, active, avg_age, avg_ctc_lakh, female_pct

═══ REFERENCE TABLES ═══

TABLE: raw_branches                  — branch_id, branch_name, entity, state, city, city_tier, branch_type, open_date, employee_count, monthly_rent_inr, is_active
TABLE: raw_employees                 — employee_id, branch_id, function_type, join_date, gender, age, annual_ctc_lakh, is_active
TABLE: raw_co_lending_partners       — partner_id, partner_name, partner_type, start_date, product_focus, active
TABLE: raw_borrowers                 — borrower_id, first_name, gender, age, employment_type, monthly_income_inr, income_category, industry, state, city, city_tier, bureau_score, is_ntc, signup_date, property_type
`,

  systemContext: `You are Actioneer, an AI-powered analytics assistant for a Housing Finance Corporation — an affordable housing finance company in India.

Dataset: ~1.87 lakh loans across two entities (HFC standalone + Finserve subsidiary) with ~₹11,400 crore consolidated AUM
- ~1.20 lakh unique borrowers across 15 states and 340 districts
- 226 branches (191 HFC + 74 Finserve, some overlap)
- 81% self-employed borrowers, 99% women as primary/co-applicant
- Average ticket size ₹12-13 lakh (HFC), ₹3-5 lakh (Finserve)
- Products: Home loans (77% of HFC AUM), LAP, micro-housing, used CV/car, MSME
- Two risk profiles: HFC (1.31% GNPA, low risk) vs Finserve (2.23% GNPA, higher risk)
- Funding: 50% bank, 31% NHB, 10% DFI, 8% ECB, 1% NCD
- PULSE proprietary technology platform for undocumented income underwriting
- 11 co-lending partners for Finserve book
- Revenue in INR, all amounts in Indian Rupees

You cover six analytics domains:
1. PORTFOLIO HEALTH — AUM composition, product mix, geographic spread, entity comparison (HFC vs Finserve)
2. ASSET QUALITY & RISK — GNPA/NNPA trends, DPD buckets, stage distribution, vintage cohort analysis, NPA movement
3. COLLECTIONS & RECOVERY — Bounce rates, collection efficiency, DPD flow, collection actions, seasonal patterns
4. SOURCING & DISTRIBUTION — Channel performance (direct vs DSA vs connector vs digital), co-lending partner quality, branch productivity
5. FUNDING & ALM — Borrowing mix, cost of funds, NCD rundown, maturity profile, interest rate risk
6. BORROWER ANALYTICS — Employment type, income segments, NTC performance, CIBIL distribution, LTV analysis, geographic concentration`,

  // ═══════════════════════════════════════════════════════
  // AGENT SPECS (for deep research mode)
  // ═══════════════════════════════════════════════════════

  queryDescriptions: {
    "data-quality": [
      "Data completeness and NULL rates across key columns",
      "Referential integrity between loans and borrowers",
      "Unusual values or outliers in interest rates, LTV, and ticket sizes",
    ],
    "daily-metrics": [
      "Monthly disbursement trends by entity and product",
      "AUM growth trajectory — HFC vs Finserve",
      "Active loan count and average ticket size over time",
    ],
    "cohort-retention": [
      "Vintage cohort analysis: which origination quarters have highest NPA rates",
      "Months-on-book seasoning curves for default rates",
      "Prepayment and early closure rates by vintage",
    ],
    "rev-opt": [
      "Yield analysis by product type and entity",
      "Spread analysis: yield minus cost of funds",
      "Collection efficiency and bounce rate trends",
    ],
    "user-segmentation": [
      "Borrower risk profiles: NTC vs credit-tested performance",
      "Employment type analysis: salaried vs self-employed NPA rates",
      "Income category (EWS/LIG/MIG) and their credit performance",
    ],
    "geographic": [
      "State-wise AUM concentration and NPA rates",
      "Branch productivity: disbursement per branch, AUM per branch",
      "City tier (T30 vs B30) performance comparison",
    ],
  },

  multiAgentPrompt: `data-quality|1|Check NULL rates and data completeness across loans_full, collections_full, and summary tables
data-quality|2|Validate Stage classification consistency: loans with stage=3 should have dpd_bucket starting with 'npa'
data-quality|3|Check for outliers in interest_rate (should be 10-26%), ltv_ratio (0.25-0.90), disbursed_amount (>100000)
daily-metrics|1|Monthly disbursement volume and amount, split by entity (hfc vs finserve) — use monthly_disbursements
daily-metrics|2|AUM build-up over time: SUM(disbursed_amount) WHERE loan_status IN ('active','npa'), by entity and month
daily-metrics|3|Average ticket size trend by entity and product type
cohort-retention|1|Vintage cohort NPA rates: for each disbursement quarter, what % of loans are Stage 3 — use stage_distribution
cohort-retention|2|Prepayment rates by vintage: count of loan_status='prepaid' as % of total, by disbursement quarter
cohort-retention|3|Co-lending partner performance by vintage — which partners' older cohorts show deterioration
rev-opt|1|Portfolio yield by entity and product: AVG(interest_rate) weighted by disbursed_amount
rev-opt|2|Funding cost by source type from funding_position table; calculate blended cost
rev-opt|3|Collection efficiency trend from monthly_collections — bounce rate and recovery rate by entity
user-segmentation|1|NPA rates by employment_type: salaried vs self-employed, and formal vs informal within each
user-segmentation|2|NTC vs credit-tested: compare GNPA rates for is_ntc=true vs is_ntc=false borrowers
user-segmentation|3|Income category performance: EWS vs LIG vs MIG — which segment has best/worst credit quality
geographic|1|State-wise AUM and GNPA from state_monthly_kpis — identify the worst-performing state
geographic|2|Branch productivity: disbursement amount per branch and AUM per branch, by branch vintage
geographic|3|T30 vs B30 performance: compare city_tier groups on NPA, yield, and collection efficiency`,

  // ═══════════════════════════════════════════════════════
  // VIEW SQL (for DuckDB setup)
  // ═══════════════════════════════════════════════════════

  viewSQL: (dataDir: string) => {
    const csvDir = `${dataDir}/csv/vastu-hfc`;
    return [
      // Raw views
      `CREATE OR REPLACE VIEW raw_branches AS SELECT * FROM read_csv('${csvDir}/branches.csv', auto_detect=true, ignore_errors=true)`,
      `CREATE OR REPLACE VIEW raw_employees AS SELECT * FROM read_csv('${csvDir}/employees.csv', auto_detect=true, ignore_errors=true)`,
      `CREATE OR REPLACE VIEW raw_borrowers AS SELECT * FROM read_csv('${csvDir}/borrowers.csv', auto_detect=true, ignore_errors=true)`,
      `CREATE OR REPLACE VIEW raw_co_lending_partners AS SELECT * FROM read_csv('${csvDir}/co_lending_partners.csv', auto_detect=true, ignore_errors=true)`,
      `CREATE OR REPLACE VIEW raw_loans AS SELECT * FROM read_csv('${csvDir}/loans.csv', auto_detect=true, ignore_errors=true)`,
      `CREATE OR REPLACE VIEW raw_emi_payments AS SELECT * FROM read_csv('${csvDir}/emi_payments.csv', auto_detect=true, ignore_errors=true)`,
      `CREATE OR REPLACE VIEW raw_disbursements AS SELECT * FROM read_csv('${csvDir}/disbursements.csv', auto_detect=true, ignore_errors=true)`,
      `CREATE OR REPLACE VIEW raw_borrowings AS SELECT * FROM read_csv('${csvDir}/borrowings.csv', auto_detect=true, ignore_errors=true)`,
      `CREATE OR REPLACE VIEW raw_collections_actions AS SELECT * FROM read_csv('${csvDir}/collections_actions.csv', auto_detect=true, ignore_errors=true)`,
      `CREATE OR REPLACE VIEW raw_assignments AS SELECT * FROM read_csv('${csvDir}/assignments.csv', auto_detect=true, ignore_errors=true)`,
      `CREATE OR REPLACE VIEW raw_provisions AS SELECT * FROM read_csv('${csvDir}/provisions.csv', auto_detect=true, ignore_errors=true)`,
      `CREATE OR REPLACE VIEW raw_npa_movement AS SELECT * FROM read_csv('${csvDir}/npa_movement.csv', auto_detect=true, ignore_errors=true)`,

      // Denormalized views
      `CREATE OR REPLACE VIEW loans_full AS
       SELECT l.*, b.first_name AS borrower_name, b.gender AS borrower_gender, b.age AS borrower_age,
              b.employment_type, b.monthly_income_inr, b.income_category, b.industry, b.bureau_score, b.is_ntc, b.property_type,
              br.branch_name, br.state, br.city, br.city_tier, br.branch_type, br.open_date AS branch_open_date,
              c.partner_name AS co_lending_partner_name, c.partner_type AS co_lending_partner_type
       FROM raw_loans l
       LEFT JOIN raw_borrowers b ON l.borrower_id = b.borrower_id
       LEFT JOIN raw_branches br ON l.branch_id = br.branch_id
       LEFT JOIN raw_co_lending_partners c ON l.co_lending_partner = c.partner_id`,

      `CREATE OR REPLACE VIEW collections_full AS
       SELECT ep.*, l.borrower_id, l.entity, l.product_type, l.interest_rate, l.loan_status, l.dpd_bucket AS loan_dpd_bucket, l.stage AS loan_stage, l.sourcing_channel, l.co_lending_partner,
              b.employment_type, b.income_category, b.is_ntc,
              br.state, br.city, br.city_tier, br.branch_name
       FROM raw_emi_payments ep
       JOIN raw_loans l ON ep.loan_id = l.loan_id
       LEFT JOIN raw_borrowers b ON l.borrower_id = b.borrower_id
       LEFT JOIN raw_branches br ON l.branch_id = br.branch_id`,

      `CREATE OR REPLACE VIEW collections_actions_full AS
       SELECT ca.*, l.borrower_id, l.entity, l.product_type, l.loan_status
       FROM raw_collections_actions ca
       JOIN raw_loans l ON ca.loan_id = l.loan_id`,

      `CREATE OR REPLACE VIEW funding_full AS SELECT * FROM raw_borrowings`,

      `CREATE OR REPLACE VIEW branches_full AS
       SELECT br.*, COALESCE(emp.active_employees, 0) AS active_employees, COALESCE(emp.total_ctc_lakh, 0) AS total_annual_ctc_lakh
       FROM raw_branches br
       LEFT JOIN (SELECT branch_id, COUNT(*) FILTER (WHERE is_active = true) AS active_employees, SUM(annual_ctc_lakh) FILTER (WHERE is_active = true) AS total_ctc_lakh FROM raw_employees GROUP BY branch_id) emp ON br.branch_id = emp.branch_id`,
    ];
  },

  summaryTableSQL: [
    // --- OPERATIONS ---
    `CREATE OR REPLACE TABLE monthly_disbursements AS
    SELECT
      CAST(strftime(disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      entity, product_type,
      COUNT(*) AS loan_count,
      SUM(disbursed_amount) AS total_amount,
      AVG(disbursed_amount) AS avg_ticket_size,
      AVG(interest_rate) AS avg_rate,
      AVG(ltv_ratio) AS avg_ltv
    FROM raw_loans
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3`,

    `CREATE OR REPLACE TABLE branch_monthly_kpis AS
    SELECT
      br.branch_id, br.branch_name, br.state, br.city, br.entity,
      CAST(strftime(l.disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*) AS disbursement_count,
      SUM(l.disbursed_amount) AS disbursement_amount,
      AVG(l.interest_rate) AS avg_rate,
      COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') AS active_loans,
      SUM(l.disbursed_amount) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') AS aum_proxy,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    JOIN raw_branches br ON l.branch_id = br.branch_id
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY 6, 1`,

    `CREATE OR REPLACE TABLE state_monthly_kpis AS
    SELECT
      br.state,
      CAST(strftime(l.disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      l.entity,
      COUNT(DISTINCT br.branch_id) AS branches,
      COUNT(*) AS loans_disbursed,
      SUM(l.disbursed_amount) AS disbursement_amount,
      AVG(l.disbursed_amount) AS avg_ticket,
      AVG(l.interest_rate) AS avg_rate,
      AVG(l.ltv_ratio) AS avg_ltv,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    JOIN raw_branches br ON l.branch_id = br.branch_id
    GROUP BY 1, 2, 3
    ORDER BY 2, 1`,

    // --- PORTFOLIO ---
    `CREATE OR REPLACE TABLE product_performance AS
    SELECT
      entity, product_type,
      COUNT(*) AS total_loans,
      COUNT(*) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') AS active_loans,
      SUM(disbursed_amount) AS total_disbursed,
      SUM(disbursed_amount) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') AS aum,
      AVG(disbursed_amount) AS avg_ticket_size,
      AVG(interest_rate) AS avg_yield,
      AVG(ltv_ratio) AS avg_ltv,
      AVG(tenure_months) AS avg_tenure_months,
      COUNT(*) FILTER (WHERE stage = 3) AS stage_3_count,
      CASE WHEN COUNT(*) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') > 0
        THEN CAST(COUNT(*) FILTER (WHERE stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans
    GROUP BY 1, 2
    ORDER BY aum DESC`,

    `CREATE OR REPLACE TABLE stage_distribution AS
    SELECT
      entity,
      CAST(strftime(disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS cohort_month,
      COUNT(*) AS total_loans,
      COUNT(*) FILTER (WHERE stage = 1) AS stage_1,
      COUNT(*) FILTER (WHERE stage = 2) AS stage_2,
      COUNT(*) FILTER (WHERE stage = 3) AS stage_3,
      CAST(COUNT(*) FILTER (WHERE stage = 1) AS DOUBLE) / COUNT(*) * 100 AS stage_1_pct,
      CAST(COUNT(*) FILTER (WHERE stage = 2) AS DOUBLE) / COUNT(*) * 100 AS stage_2_pct,
      CAST(COUNT(*) FILTER (WHERE stage = 3) AS DOUBLE) / COUNT(*) * 100 AS stage_3_pct
    FROM raw_loans
    WHERE loan_status IN ('active', 'npa')
    GROUP BY 1, 2
    ORDER BY 2, 1`,

    // --- RISK ---
    `CREATE OR REPLACE TABLE collection_efficiency AS
    SELECT
      CAST(strftime(due_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*) AS total_emis,
      COUNT(*) FILTER (WHERE amount_paid > 0) AS paid_emis,
      SUM(amount_due) AS total_due,
      SUM(amount_paid) AS total_collected,
      CASE WHEN SUM(amount_due) > 0
        THEN SUM(amount_paid) / SUM(amount_due) * 100
        ELSE 0 END AS collection_efficiency_pct,
      COUNT(*) FILTER (WHERE bounce = true) AS bounced_emis,
      CAST(COUNT(*) FILTER (WHERE bounce = true) AS DOUBLE) / COUNT(*) * 100 AS bounce_rate_pct,
      AVG(dpd_at_payment) AS avg_dpd
    FROM raw_emi_payments
    GROUP BY 1
    ORDER BY 1`,

    `CREATE OR REPLACE TABLE co_lending_performance AS
    SELECT
      l.co_lending_partner AS partner_id,
      c.partner_name, c.partner_type, c.product_focus,
      COUNT(*) AS total_loans,
      COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') AS active_loans,
      SUM(l.disbursed_amount) AS total_disbursed,
      SUM(l.disbursed_amount) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') AS aum,
      AVG(l.interest_rate) AS avg_yield,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    LEFT JOIN raw_co_lending_partners c ON l.co_lending_partner = c.partner_id
    WHERE l.entity = 'finserve' AND l.co_lending_partner != ''
    GROUP BY 1, 2, 3, 4
    ORDER BY aum DESC`,

    `CREATE OR REPLACE TABLE npa_quarterly_movement AS SELECT * FROM raw_npa_movement`,
    `CREATE OR REPLACE TABLE ecl_provisions AS SELECT * FROM raw_provisions`,

    // --- FINANCIAL ---
    `CREATE OR REPLACE TABLE funding_position AS
    SELECT
      source_type,
      COUNT(*) AS facility_count,
      SUM(sanctioned_amount_cr) AS total_sanctioned_cr,
      SUM(outstanding_amount_cr) AS total_outstanding_cr,
      AVG(interest_rate) AS weighted_avg_cost,
      MIN(interest_rate) AS min_rate,
      MAX(interest_rate) AS max_rate,
      COUNT(*) FILTER (WHERE is_fixed_rate = true) AS fixed_rate_count,
      COUNT(*) FILTER (WHERE is_fixed_rate = false) AS floating_rate_count
    FROM raw_borrowings
    GROUP BY 1
    ORDER BY total_outstanding_cr DESC`,

    `CREATE OR REPLACE TABLE assignment_summary AS SELECT * FROM raw_assignments`,

    // --- SOURCING & CHANNEL ---
    `CREATE OR REPLACE TABLE sourcing_channel_performance AS
    SELECT
      entity, sourcing_channel,
      COUNT(*) AS total_loans,
      SUM(disbursed_amount) AS total_disbursed,
      AVG(disbursed_amount) AS avg_ticket,
      AVG(interest_rate) AS avg_rate,
      COUNT(*) FILTER (WHERE stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') > 0
        THEN CAST(COUNT(*) FILTER (WHERE stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans
    GROUP BY 1, 2
    ORDER BY total_disbursed DESC`,

    // --- BORROWER PROFILE ---
    `CREATE OR REPLACE TABLE borrower_profile_summary AS
    SELECT
      l.entity, b.employment_type, b.income_category, b.is_ntc,
      COUNT(*) AS loan_count,
      SUM(l.disbursed_amount) AS total_disbursed,
      AVG(l.disbursed_amount) AS avg_ticket,
      AVG(b.bureau_score) FILTER (WHERE b.bureau_score > 0) AS avg_cibil,
      AVG(l.ltv_ratio) AS avg_ltv,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    JOIN raw_borrowers b ON l.borrower_id = b.borrower_id
    GROUP BY 1, 2, 3, 4
    ORDER BY total_disbursed DESC`,

    // --- COMPANY KPIs ---
    `CREATE OR REPLACE TABLE monthly_company_kpis AS
    SELECT
      CAST(strftime(l.disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*) AS total_loans_originated,
      SUM(l.disbursed_amount) AS total_disbursed,
      AVG(l.disbursed_amount) AS avg_ticket_size,
      COUNT(*) FILTER (WHERE l.loan_status IN ('active', 'npa')) AS active_loans,
      SUM(l.disbursed_amount) FILTER (WHERE l.loan_status IN ('active', 'npa')) AS active_aum,
      SUM(l.disbursed_amount) FILTER (WHERE l.entity = 'hfc' AND l.loan_status IN ('active', 'npa')) AS hfc_aum,
      SUM(l.disbursed_amount) FILTER (WHERE l.entity = 'finserve' AND l.loan_status IN ('active', 'npa')) AS finserve_aum,
      COUNT(*) FILTER (WHERE l.stage = 3) AS stage_3_count,
      CASE WHEN COUNT(*) FILTER (WHERE l.loan_status IN ('active', 'npa')) > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE l.loan_status IN ('active', 'npa')) * 100
        ELSE 0 END AS gnpa_pct,
      CAST(COUNT(*) FILTER (WHERE l.product_type LIKE 'home%') AS DOUBLE) / NULLIF(COUNT(*), 0) * 100 AS home_loan_pct,
      AVG(l.interest_rate) AS avg_yield,
      AVG(l.ltv_ratio) AS avg_ltv,
      CAST(COUNT(*) FILTER (WHERE l.sourcing_channel = 'dsa') AS DOUBLE) / NULLIF(COUNT(*), 0) * 100 AS dsa_sourced_pct
    FROM raw_loans l
    GROUP BY 1
    ORDER BY 1`,

    `CREATE OR REPLACE TABLE quarterly_company_kpis AS
    SELECT
      CASE
        WHEN EXTRACT(MONTH FROM month) BETWEEN 4 AND 6 THEN 'Q1'
        WHEN EXTRACT(MONTH FROM month) BETWEEN 7 AND 9 THEN 'Q2'
        WHEN EXTRACT(MONTH FROM month) BETWEEN 10 AND 12 THEN 'Q3'
        ELSE 'Q4'
      END AS fy_quarter,
      CASE
        WHEN EXTRACT(MONTH FROM month) >= 4 THEN 'FY' || CAST((EXTRACT(YEAR FROM month) + 1) % 100 AS VARCHAR)
        ELSE 'FY' || CAST(EXTRACT(YEAR FROM month) % 100 AS VARCHAR)
      END AS fy,
      SUM(total_loans_originated) AS loans_originated,
      SUM(total_disbursed) AS total_disbursed,
      AVG(avg_yield) AS avg_yield,
      AVG(gnpa_pct) AS avg_gnpa_pct,
      AVG(home_loan_pct) AS avg_home_loan_pct,
      AVG(dsa_sourced_pct) AS avg_dsa_pct
    FROM monthly_company_kpis
    GROUP BY 1, 2
    ORDER BY fy, fy_quarter`,

    // --- COLLECTIONS SUMMARY ---
    `CREATE OR REPLACE TABLE monthly_collections AS
    SELECT
      CAST(strftime(ep.due_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      l.entity,
      COUNT(*) AS total_emis,
      SUM(ep.amount_due) AS total_due,
      SUM(ep.amount_paid) AS total_collected,
      COUNT(*) FILTER (WHERE ep.bounce = true) AS bounced,
      CAST(COUNT(*) FILTER (WHERE ep.bounce = true) AS DOUBLE) / COUNT(*) * 100 AS bounce_rate,
      CASE WHEN SUM(ep.amount_due) > 0 THEN SUM(ep.amount_paid) / SUM(ep.amount_due) * 100 ELSE 0 END AS collection_efficiency,
      AVG(ep.dpd_at_payment) AS avg_dpd
    FROM raw_emi_payments ep
    JOIN raw_loans l ON ep.loan_id = l.loan_id
    GROUP BY 1, 2
    ORDER BY 1, 2`,

    // --- HR ---
    `CREATE OR REPLACE TABLE employee_summary AS
    SELECT
      br.entity, br.state, e.function_type,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE e.is_active = true) AS active,
      AVG(e.age) AS avg_age,
      AVG(e.annual_ctc_lakh) AS avg_ctc_lakh,
      CAST(COUNT(*) FILTER (WHERE e.gender = 'female') AS DOUBLE) / COUNT(*) * 100 AS female_pct
    FROM raw_employees e
    JOIN raw_branches br ON e.branch_id = br.branch_id
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3`,
  ],
};
