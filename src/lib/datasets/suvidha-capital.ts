import type { EventDefinition } from "../explorer-types";
import type { DatasetConfig } from "./types";

// ══════════════════════════════════════════════════════════
// EVENT PROPERTIES (for Analytics Explorer / funnel builder)
// Every column below is real on the referenced view.
// ══════════════════════════════════════════════════════════

const LOAN_PROPERTIES: EventDefinition["properties"] = [
  { column: "product_type", displayName: "Product Type", type: "string", cardinalityHint: "low" },
  { column: "sourcing_channel", displayName: "Sourcing Channel", type: "string", cardinalityHint: "low" },
  { column: "loan_status", displayName: "Loan Status", type: "string", cardinalityHint: "low" },
  { column: "dpd_bucket", displayName: "DPD Bucket", type: "string", cardinalityHint: "low" },
  { column: "stage", displayName: "IndAS Stage", type: "number", cardinalityHint: "low" },
  { column: "is_crosssell", displayName: "Is Cross-sell", type: "string", cardinalityHint: "low" },
  { column: "repossessed", displayName: "Repossessed", type: "string", cardinalityHint: "low" },
  { column: "dealer_type", displayName: "Dealer Type", type: "string", cardinalityHint: "low" },
  { column: "state", displayName: "State", type: "string", cardinalityHint: "medium" },
  { column: "city", displayName: "City", type: "string", cardinalityHint: "medium" },
  { column: "city_tier", displayName: "City Tier", type: "string", cardinalityHint: "low" },
  { column: "employment_type", displayName: "Employment Type", type: "string", cardinalityHint: "low" },
  { column: "occupation", displayName: "Occupation", type: "string", cardinalityHint: "medium" },
  { column: "income_category", displayName: "Income Category", type: "string", cardinalityHint: "low" },
  { column: "is_ntc", displayName: "New-to-Credit", type: "string", cardinalityHint: "low" },
  { column: "is_repeat_borrower", displayName: "Repeat Borrower", type: "string", cardinalityHint: "low" },
  { column: "borrower_gender", displayName: "Borrower Gender", type: "string", cardinalityHint: "low" },
];

const APPLICATION_PROPERTIES: EventDefinition["properties"] = [
  { column: "product_type", displayName: "Product Type", type: "string", cardinalityHint: "low" },
  { column: "status", displayName: "Application Status", type: "string", cardinalityHint: "low" },
  { column: "rejection_reason", displayName: "Rejection Reason", type: "string", cardinalityHint: "low" },
  { column: "dealer_type", displayName: "Dealer Type", type: "string", cardinalityHint: "low" },
  { column: "state", displayName: "State", type: "string", cardinalityHint: "medium" },
  { column: "city_tier", displayName: "City Tier", type: "string", cardinalityHint: "low" },
  { column: "employment_type", displayName: "Employment Type", type: "string", cardinalityHint: "low" },
  { column: "income_category", displayName: "Income Category", type: "string", cardinalityHint: "low" },
  { column: "is_ntc", displayName: "New-to-Credit", type: "string", cardinalityHint: "low" },
];

const EMI_PROPERTIES: EventDefinition["properties"] = [
  { column: "payment_mode", displayName: "Payment Mode", type: "string", cardinalityHint: "low" },
  { column: "collection_bucket", displayName: "Collection Bucket", type: "string", cardinalityHint: "low" },
  { column: "bounce", displayName: "Bounced", type: "string", cardinalityHint: "low" },
  { column: "product_type", displayName: "Product Type", type: "string", cardinalityHint: "low" },
  { column: "loan_status", displayName: "Loan Status", type: "string", cardinalityHint: "low" },
  { column: "sourcing_channel", displayName: "Sourcing Channel", type: "string", cardinalityHint: "low" },
  { column: "employment_type", displayName: "Employment Type", type: "string", cardinalityHint: "low" },
  { column: "income_category", displayName: "Income Category", type: "string", cardinalityHint: "low" },
  { column: "is_ntc", displayName: "New-to-Credit", type: "string", cardinalityHint: "low" },
  { column: "state", displayName: "State", type: "string", cardinalityHint: "medium" },
  { column: "city_tier", displayName: "City Tier", type: "string", cardinalityHint: "low" },
];

const ACTION_PROPERTIES: EventDefinition["properties"] = [
  { column: "action_type", displayName: "Action Type", type: "string", cardinalityHint: "low" },
  { column: "result", displayName: "Result", type: "string", cardinalityHint: "low" },
  { column: "dpd_at_action", displayName: "DPD at Action", type: "number", cardinalityHint: "high" },
  { column: "product_type", displayName: "Product Type", type: "string", cardinalityHint: "low" },
  { column: "loan_status", displayName: "Loan Status", type: "string", cardinalityHint: "low" },
  { column: "region", displayName: "Agent Region", type: "string", cardinalityHint: "low" },
  { column: "function_type", displayName: "Agent Function", type: "string", cardinalityHint: "low" },
];

const CROSSSELL_PROPERTIES: EventDefinition["properties"] = [
  { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
  { column: "status", displayName: "Offer Status", type: "string", cardinalityHint: "low" },
  { column: "income_category", displayName: "Income Category", type: "string", cardinalityHint: "low" },
  { column: "state", displayName: "State", type: "string", cardinalityHint: "medium" },
  { column: "city_tier", displayName: "City Tier", type: "string", cardinalityHint: "low" },
  { column: "is_ntc", displayName: "New-to-Credit", type: "string", cardinalityHint: "low" },
];

// ══════════════════════════════════════════════════════════
// EVENTS CATALOG
//
// funnelEligible events carry both a real per-event timestamp AND borrower_id
// (the funnel entity). Portfolio state-flag events (delinquency/asset quality)
// have no transition timestamp, so funnelEligible: false — still valid for
// trends and segment breakdowns.
// ══════════════════════════════════════════════════════════

const SUVIDHA_EVENTS: EventDefinition[] = [
  // ── ORIGINATION / ONBOARDING FUNNEL ──
  { id: "application_submitted", displayName: "Application Submitted", category: "Origination", table: "applications_full", dateColumn: "apply_date", countColumn: "*", valueColumn: "requested_amount", properties: APPLICATION_PROPERTIES },
  { id: "application_approved", displayName: "Application Approved (Disbursed)", category: "Origination", table: "applications_full", dateColumn: "decision_date", countColumn: "*", filterSQL: "status = 'disbursed'", properties: APPLICATION_PROPERTIES },
  { id: "application_rejected", displayName: "Application Rejected", category: "Origination", table: "applications_full", dateColumn: "decision_date", countColumn: "*", filterSQL: "status = 'rejected'", properties: APPLICATION_PROPERTIES },
  { id: "loan_disbursed", displayName: "Loan Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", properties: LOAN_PROPERTIES },
  { id: "two_wheeler_disbursed", displayName: "Two-Wheeler Loan Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "product_type IN ('two_wheeler','used_two_wheeler')", properties: LOAN_PROPERTIES },
  { id: "consumer_durable_disbursed", displayName: "Consumer Durable Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "product_type = 'consumer_durable'", properties: LOAN_PROPERTIES },
  { id: "ntc_disbursed", displayName: "New-to-Credit Loan Disbursed", category: "Disbursement", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "is_ntc = true", properties: LOAN_PROPERTIES },

  // ── LOAN LIFECYCLE / EXITS ──
  { id: "loan_closed", displayName: "Loan Closed", category: "Loan Lifecycle", table: "loans_full", dateColumn: "last_payment_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "loan_status = 'closed'", properties: LOAN_PROPERTIES },
  { id: "loan_prepaid", displayName: "Loan Prepaid (Early Closure)", category: "Loan Lifecycle", table: "loans_full", dateColumn: "last_payment_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "loan_status = 'prepaid'", properties: LOAN_PROPERTIES },

  // ── REPAYMENT (EMI) ──
  { id: "emi_due", displayName: "EMI Due", category: "Repayment", table: "collections_full", dateColumn: "due_date", countColumn: "*", valueColumn: "amount_due", properties: EMI_PROPERTIES },
  { id: "emi_paid", displayName: "EMI Paid", category: "Repayment", table: "collections_full", dateColumn: "paid_date", countColumn: "*", valueColumn: "amount_paid", filterSQL: "amount_paid > 0 AND paid_date IS NOT NULL", properties: EMI_PROPERTIES },
  { id: "emi_paid_on_time", displayName: "EMI Paid On Time", category: "Repayment", table: "collections_full", dateColumn: "paid_date", countColumn: "*", valueColumn: "amount_paid", filterSQL: "amount_paid > 0 AND paid_date IS NOT NULL AND dpd_at_payment = 0", properties: EMI_PROPERTIES },
  { id: "emi_via_nach", displayName: "EMI Paid via NACH/eNACH", category: "Repayment", table: "collections_full", dateColumn: "paid_date", countColumn: "*", valueColumn: "amount_paid", filterSQL: "payment_mode IN ('nach','enach') AND amount_paid > 0 AND paid_date IS NOT NULL", properties: EMI_PROPERTIES },
  { id: "emi_via_upi", displayName: "EMI Paid via UPI", category: "Repayment", table: "collections_full", dateColumn: "paid_date", countColumn: "*", valueColumn: "amount_paid", filterSQL: "payment_mode IN ('upi','upi_autopay') AND amount_paid > 0 AND paid_date IS NOT NULL", properties: EMI_PROPERTIES },

  // ── DELINQUENCY (EMI-level, real timestamps) ──
  { id: "emi_bounced", displayName: "EMI Bounced", category: "Delinquency", table: "collections_full", dateColumn: "due_date", countColumn: "*", valueColumn: "amount_due", filterSQL: "bounce = true", properties: EMI_PROPERTIES },
  { id: "emi_missed", displayName: "EMI Missed (Unpaid)", category: "Delinquency", table: "collections_full", dateColumn: "due_date", countColumn: "*", valueColumn: "amount_due", filterSQL: "amount_paid = 0", properties: EMI_PROPERTIES },

  // ── ASSET QUALITY (portfolio state flags — no transition timestamp) ──
  { id: "sma_loan", displayName: "SMA (1-90 DPD)", category: "Asset Quality", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "overdue_amount", filterSQL: "dpd_bucket IN ('sma_0','sma_1','sma_2')", funnelEligible: false, properties: LOAN_PROPERTIES },
  { id: "npa_loan", displayName: "NPA (90+ DPD, Stage 3)", category: "Asset Quality", table: "loans_full", dateColumn: "disbursement_date", countColumn: "*", valueColumn: "overdue_amount", filterSQL: "stage = 3", funnelEligible: false, properties: LOAN_PROPERTIES },
  { id: "written_off", displayName: "Written Off", category: "Asset Quality", table: "loans_full", dateColumn: "last_payment_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "loan_status = 'written_off'", funnelEligible: false, properties: LOAN_PROPERTIES },
  { id: "repossessed", displayName: "Asset Repossessed", category: "Asset Quality", table: "loans_full", dateColumn: "last_payment_date", countColumn: "*", valueColumn: "disbursed_amount", filterSQL: "repossessed = true", funnelEligible: false, properties: LOAN_PROPERTIES },

  // ── COLLECTIONS ACTIONS (real per-action timestamps) ──
  { id: "collection_call", displayName: "Collection Call", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type = 'call'", properties: ACTION_PROPERTIES },
  { id: "sms_reminder", displayName: "SMS Reminder", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type = 'sms_reminder'", properties: ACTION_PROPERTIES },
  { id: "field_visit", displayName: "Field Visit", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type = 'field_visit'", properties: ACTION_PROPERTIES },
  { id: "demand_notice", displayName: "Demand Notice", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type = 'demand_notice'", properties: ACTION_PROPERTIES },
  { id: "legal_notice", displayName: "Legal Notice", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type = 'legal_notice'", properties: ACTION_PROPERTIES },
  { id: "repossession_action", displayName: "Repossession Action", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "action_type IN ('repossession','repossession_notice')", properties: ACTION_PROPERTIES },
  { id: "promise_to_pay", displayName: "Promise to Pay Secured", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "result = 'promise_to_pay'", properties: ACTION_PROPERTIES },
  { id: "collection_resolved", displayName: "Collection Resolved", category: "Collections", table: "collections_actions_full", dateColumn: "action_date", countColumn: "*", filterSQL: "result = 'resolved'", properties: ACTION_PROPERTIES },

  // ── CROSS-SELL FUNNEL (real timestamps) ──
  { id: "crosssell_offer_sent", displayName: "Cross-sell Offer Sent", category: "Cross-sell", table: "crosssell_full", dateColumn: "offer_date", countColumn: "*", valueColumn: "pre_approved_amount", properties: CROSSSELL_PROPERTIES },
  { id: "crosssell_accepted", displayName: "Cross-sell Offer Accepted", category: "Cross-sell", table: "crosssell_full", dateColumn: "accepted_date", countColumn: "*", valueColumn: "pre_approved_amount", filterSQL: "accepted_date IS NOT NULL", properties: CROSSSELL_PROPERTIES },
  { id: "crosssell_disbursed", displayName: "Cross-sell Loan Disbursed", category: "Cross-sell", table: "crosssell_full", dateColumn: "disbursed_date", countColumn: "*", valueColumn: "pre_approved_amount", filterSQL: "status = 'disbursed' AND disbursed_date IS NOT NULL", properties: CROSSSELL_PROPERTIES },
];

export const suvidhaCapitalDataset: DatasetConfig = {
  id: "suvidha-capital",
  label: "Consumer Finance",
  companyName: "Suvidha Capital",
  dbFile: "data/suvidha-capital.duckdb",
  sourceType: "csv",
  primaryTable: "loans_full",
  // Segments are a set of borrowers, so the Users/Composition tabs and preview
  // resolve against the borrower-level table (one row per borrower with rolled-up
  // behaviour), not the loan-grained primaryTable.
  entityTable: "borrowers_full",
  userIdField: "borrower_id",
  dateField: "disbursement_date",
  dateRange: { start: "2024-06-01", end: "2026-05-31" },
  currency: "₹",
  entityName: "borrowers",
  events: SUVIDHA_EVENTS,

  reportMeta: {
    totalEvents: "2.06L loans · 18.3L EMI payments · 2.76L applications",
    totalUsers: "1.65L borrowers",
    dateRangeLabel: "Jun 2024 – May 2026",
    dbName: "suvidha-capital.duckdb",
  },

  suggestedPrompts: [
    "How has monthly disbursement volume trended across two-wheeler, consumer durable, used car, and personal loans?",
    "What is our GNPA by product type, and which cohorts are deteriorating fastest?",
    "What is our EMI collection efficiency and bounce rate trend over the last 12 months?",
    "Which dealers are driving the most disbursement volume, and how does their NPA compare?",
    "What is the loan application approval rate by product, and what are the top rejection reasons?",
    "How is our cross-sell personal loan funnel converting by channel — offer to disbursement?",
  ],

  welcomeSubtitle: "Ask about originations, portfolio quality, EMI collections, dealer network performance, and cross-sell conversion.",

  // ═══════════════════════════════════════════════════════
  // DOMAIN HINTS (injected into SQL generation prompts)
  // ═══════════════════════════════════════════════════════

  domainHints: `
1. AS-OF DATE: Treat this dataset as of DATE '2026-05-31'. Anchor all relative windows ("last 12 months", "YTD") on this date.
2. USE loans_full VIEW for any loan-level query — pre-joined with borrowers and dealers. Never join raw_loans + raw_borrowers manually.
2b. USE borrowers_full TABLE for SEGMENTS and per-borrower targeting (one row per borrower, with rolled-up loan + repayment behavior: worst_dpd_bucket, has_npa, bounce_rate_pct, ontime_rate_pct, active_exposure, mobile). loans_full is loan-grained and double-counts multi-loan borrowers — do NOT build user segments on it directly; either use borrowers_full or SELECT DISTINCT borrower_id.
3. USE applications_full VIEW for application/funnel queries — pre-joined with borrowers and dealers.
4. USE collections_full VIEW for EMI/payment analysis — pre-joined with loan, borrower, and dealer context.
5. USE collections_actions_full VIEW for recovery/collections-action analysis — pre-joined with loan and agent context.
6. USE crosssell_full VIEW for cross-sell offer analysis — pre-joined with borrower context.
7. PRODUCT TYPES: two_wheeler, used_two_wheeler, consumer_durable, used_car, personal (personal loans are cross-sell only — see is_crosssell and crosssell_full).
8. LOAN STATUS: 'active' (performing), 'closed' (fully repaid), 'prepaid' (early closure), 'npa' (non-performing), 'written_off' (irrecoverable).
9. DPD BUCKETS: current (0 DPD), sma_0 (1-30), sma_1 (31-60), sma_2 (61-90), npa_90 (90-180), npa_180 (180-360), npa_360_plus (>360). Stage 1 = current+sma_0+sma_1, Stage 2 = sma_2, Stage 3 = npa_*.
10. GNPA = Gross NPA = COUNT/SUM(Stage 3 loans) / COUNT/SUM(active + npa loans) × 100. Only count live loans (loan_status IN ('active','npa')) in the denominator.
11. SOURCING CHANNELS: dealer_pos (financed at point-of-sale), dsa (direct sales agent), direct (walk-in/branch), digital_saathi (in-app digital channel for existing/repeat borrowers).
12. DEALER NETWORK: dealer_type is tvs_authorized_2w → renamed raahi_authorized_2w (Raahi Motors-authorized 2-wheeler dealer), multi_brand_2w, used_car_dealer, electronics_retail, sub_dealer. Use dealers_full or dealer_leaderboard for dealer-level analysis.
13. CROSS-SELL: crosssell_full / raw_crosssell_offers only cover personal loans offered to existing borrowers (pre-approved based on repayment history). status flows: sent → viewed → accepted/declined/expired → disbursed. channel is saathi_app (in-app), sms, or telecalling.
14. APPLICATION FUNNEL: raw_loan_applications.status is disbursed, rejected, withdrawn, or pending_docs. rejection_reason (only set when rejected): doc_mismatch, existing_overdue, fraud_flag, high_foir, insufficient_income, low_bureau_score, negative_area. Use rejection_reason_summary for reason-level breakdowns.
15. COLLECTIONS ACTIONS: action_type is call, sms_reminder, field_visit, demand_notice, legal_notice, repossession, repossession_notice, escalating in severity with DPD. result is promise_to_pay, partial_payment, resolved, no_contact, dispute, escalated.
16. BUREAU_SCORE: 0 means New-to-Credit (is_ntc = true). Valid scores are 300-900.
17. EMPLOYMENT TYPE: salaried_formal, salaried_informal, self_employed_formal, self_employed_informal. Most borrowers are self-employed informal (small traders, gig workers).
18. INCOME CATEGORY: ews (economically weaker section, <₹25K/month), lig (low income, ₹25-50K), mig (middle income, ₹50K+). Derived from monthly_income_inr.
19. CITY TIER: Metro, Urban, Semi-Urban, Rural — applies to both borrower location (borrower_city_tier on loans_full) and dealer location (city_tier on loans_full, from the dealer join).
20. CURRENCY is INR (₹). All monetary columns (sanctioned_amount, disbursed_amount, emi_amount, asset_value, overdue_amount) are in absolute INR, not Lakh or Cr.
21. LTV is stored as decimal (0.81 = 81%). asset_value is the financed asset's value; down_payment + disbursed_amount ≈ asset_value.
22. REPOSSESSION: repossessed = true means the financed asset was repossessed after severe delinquency — check alongside action_type = 'repossession' in collections_actions_full.
23. SEASONALITY: calendar_seasonality has festival/sale-season demand multipliers (e.g. Diwali, e-commerce sale events) that drove origination spikes — use overall_multiplier and category_effects for seasonal-spike explanations.
24. SUMMARY TABLES — prefer these for broad aggregations:
    - ORIGINATIONS: monthly_originations, application_funnel_monthly, rejection_reason_summary
    - PORTFOLIO: product_performance, stage_dpd_distribution
    - COLLECTIONS: monthly_collections, collection_action_effectiveness, collection_agent_leaderboard
    - CROSS-SELL: crosssell_funnel_monthly
    - BORROWER: borrower_profile_summary, occupation_performance
    - GEOGRAPHIC/DEALER: state_city_tier_kpis, dealer_leaderboard, sourcing_channel_performance
    - COMPANY: monthly_company_kpis
    Use loans_full/collections_full for custom cohort or cross-dimensional queries not covered by summary tables.
`,

  summaryTableHint: `Use summary tables when they can answer the question:
- ORIGINATIONS: monthly_originations (by month, product, channel), application_funnel_monthly, rejection_reason_summary
- PORTFOLIO: product_performance (by product), stage_dpd_distribution (by product, cohort month)
- COLLECTIONS: monthly_collections (by month, product), collection_action_effectiveness, collection_agent_leaderboard
- CROSS-SELL: crosssell_funnel_monthly (by month, channel)
- BORROWER: borrower_profile_summary (employment/income/NTC), occupation_performance
- GEOGRAPHIC/DEALER: state_city_tier_kpis, dealer_leaderboard, sourcing_channel_performance
- COMPANY: monthly_company_kpis (board-level rollup)
Use loans_full, collections_full, applications_full, crosssell_full for custom cohort or drill-down queries.`,

  // ═══════════════════════════════════════════════════════
  // SCHEMA CONTEXT (for LLM SQL generation)
  // ═══════════════════════════════════════════════════════

  schemaContext: `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect)

═══ DENORMALIZED VIEWS (USE THESE FOR QUERIES) ═══

VIEW: loans_full (~2.06L rows, Jun 2024 – May 2026) — USE THIS for loan-level queries
  Pre-joined: loans + borrowers + dealers
  -- Loan core
  - loan_id             VARCHAR   -- e.g. 'LON_009e3779b1'
  - borrower_id         VARCHAR
  - dealer_id           VARCHAR
  - product_type        VARCHAR   -- two_wheeler | used_two_wheeler | consumer_durable | used_car | personal
  - is_crosssell        BOOLEAN   -- TRUE if sourced via cross-sell offer to an existing borrower
  - prior_loan_id       VARCHAR   -- FK to a prior loan (repeat borrowers); empty if first loan
  - disbursement_date   DATE
  - sanctioned_amount   DOUBLE    -- INR
  - disbursed_amount    DOUBLE    -- INR (used for AUM)
  - down_payment        DOUBLE    -- INR
  - asset_value         DOUBLE    -- INR (financed asset's value)
  - ltv_ratio           DOUBLE    -- decimal, e.g. 0.81 = 81%
  - interest_rate       DOUBLE    -- annual %, e.g. 21.64
  - tenure_months       INTEGER
  - emi_amount          DOUBLE    -- INR
  - sourcing_channel    VARCHAR   -- dealer_pos | dsa | direct | digital_saathi
  - due_day             INTEGER   -- day of month EMI is due
  - asset_description   VARCHAR   -- e.g. 'Raahi Apache RTR 160', 'Refrigerator', 'Used Maruti Alto'
  - overdue_amount      DOUBLE    -- INR overdue
  - current_dpd         INTEGER
  - last_payment_date   DATE
  - dpd_bucket          VARCHAR   -- current | sma_0 | sma_1 | sma_2 | npa_90 | npa_180 | npa_360_plus
  - stage               INTEGER   -- 1, 2, or 3 (IndAS classification)
  - loan_status         VARCHAR   -- active | closed | prepaid | npa | written_off
  - repossessed         BOOLEAN
  -- Borrower fields
  - borrower_name       VARCHAR
  - borrower_gender      VARCHAR  -- M | F
  - borrower_age        INTEGER
  - employment_type     VARCHAR   -- salaried_formal | salaried_informal | self_employed_formal | self_employed_informal
  - occupation          VARCHAR   -- e.g. shopkeeper, auto_driver, delivery_rider, farmer, tailor
  - monthly_income_inr  DOUBLE
  - income_category     VARCHAR   -- ews | lig | mig
  - borrower_state      VARCHAR
  - borrower_city       VARCHAR
  - borrower_city_tier  VARCHAR   -- Metro | Urban | Semi-Urban | Rural
  - bureau_score        INTEGER   -- 0 = New-to-Credit
  - is_ntc              BOOLEAN
  - is_repeat_borrower  BOOLEAN
  -- Dealer fields (unqualified — this is the dealer's location, used for geographic analysis)
  - dealer_name         VARCHAR   -- e.g. 'ROYAL Raahi Motors Chennai'
  - dealer_type         VARCHAR   -- raahi_authorized_2w | multi_brand_2w | used_car_dealer | electronics_retail | sub_dealer
  - state               VARCHAR   -- dealer's state
  - city                VARCHAR   -- dealer's city
  - city_tier           VARCHAR   -- dealer's city tier

VIEW: applications_full (~2.76L rows) — USE THIS for application funnel queries
  Pre-joined: loan_applications + borrowers + dealers
  - application_id      VARCHAR
  - borrower_id         VARCHAR
  - dealer_id           VARCHAR
  - product_type        VARCHAR
  - apply_date          DATE
  - requested_amount    DOUBLE
  - decision_date       DATE
  - status              VARCHAR   -- disbursed | rejected | withdrawn | pending_docs
  - rejection_reason    VARCHAR   -- doc_mismatch | existing_overdue | fraud_flag | high_foir | insufficient_income | low_bureau_score | negative_area (empty unless rejected)
  - loan_id             VARCHAR   -- FK to loans_full if disbursed
  -- Joined: employment_type, occupation, income_category, bureau_score, is_ntc, dealer_name, dealer_type, state, city, city_tier

VIEW: collections_full (~18.3L rows) — USE THIS for EMI/payment analysis
  Pre-joined: emi_payments + loans + borrowers + dealers
  - payment_id          VARCHAR
  - loan_id             VARCHAR
  - installment_no      INTEGER
  - due_date            DATE
  - amount_due           DOUBLE
  - amount_paid         DOUBLE    -- 0 if missed
  - paid_date           DATE      -- empty if missed
  - payment_mode        VARCHAR   -- nach | enach | upi | upi_autopay | cash | cheque | neft
  - bounce              BOOLEAN
  - dpd_at_payment      INTEGER
  - collection_bucket   VARCHAR   -- on_time | 1_30 | 31_60 | 61_90 | 90_plus
  -- Joined from loans: borrower_id, dealer_id, product_type, interest_rate, loan_status, loan_dpd_bucket, loan_stage, sourcing_channel
  -- Joined from borrowers: employment_type, income_category, is_ntc
  -- Joined from dealers: state, city, city_tier, dealer_name

VIEW: collections_actions_full (~1.41L rows) — USE THIS for recovery/collections-action analysis
  Pre-joined: collections_actions + loans + collection_agents
  - action_id           VARCHAR
  - loan_id             VARCHAR
  - agent_id            VARCHAR
  - action_date         DATE
  - action_type         VARCHAR   -- call | sms_reminder | field_visit | demand_notice | legal_notice | repossession | repossession_notice
  - dpd_at_action       INTEGER
  - result              VARCHAR   -- promise_to_pay | partial_payment | resolved | no_contact | dispute | escalated
  -- Joined from loans: borrower_id, product_type, loan_status
  -- Joined from agents: agent_name, region, function_type

VIEW: crosssell_full (~2.19L rows) — USE THIS for cross-sell offer analysis
  Pre-joined: crosssell_offers + borrowers
  - offer_id            VARCHAR
  - borrower_id         VARCHAR
  - product_type        VARCHAR   -- always 'personal'
  - offer_date          DATE
  - pre_approved_amount DOUBLE
  - channel             VARCHAR   -- saathi_app | sms | telecalling
  - status              VARCHAR   -- sent | viewed | declined | expired | accepted | disbursed
  - loan_id             VARCHAR   -- FK to loans_full if disbursed
  - accepted_date       DATE
  - disbursed_date      DATE
  -- Joined from borrowers: employment_type, income_category, state, city, city_tier, bureau_score, is_ntc

TABLE: borrowers_full (~1.65L rows, one row per borrower) — USE THIS for SEGMENTS and per-borrower targeting
  Borrower master + rolled-up loan & repayment behavior. Loan-grained tables (loans_full)
  double-count multi-loan borrowers; use this for clean user-level segments and voice/campaign lists.
  -- Borrower master (from borrowers)
  - borrower_id         VARCHAR
  - borrower_name       VARCHAR
  - gender              VARCHAR   -- M | F
  - age                 INTEGER
  - employment_type     VARCHAR
  - occupation          VARCHAR
  - monthly_income_inr  DOUBLE
  - income_category     VARCHAR   -- ews | lig | mig
  - state               VARCHAR
  - city                VARCHAR
  - city_tier           VARCHAR
  - bureau_score        INTEGER   -- 0 = New-to-Credit
  - is_ntc              BOOLEAN
  - mobile              VARCHAR   -- phone number (for voice/SMS campaign targeting)
  - signup_date         DATE
  - total_loans         INTEGER   -- as recorded on borrower master
  - is_repeat_borrower  BOOLEAN
  -- Rolled-up loan behavior (derived)
  - loan_count_actual   INTEGER   -- actual loans found in raw_loans
  - active_loans        INTEGER
  - total_disbursed     DOUBLE    -- lifetime disbursed across all loans
  - active_exposure     DOUBLE    -- disbursed on live (active+npa) loans
  - total_overdue       DOUBLE
  - max_current_dpd     INTEGER   -- worst current DPD across the borrower's loans
  - worst_stage         INTEGER   -- worst IndAS stage (1/2/3)
  - worst_dpd_bucket    VARCHAR   -- worst DPD bucket across loans
  - has_npa             BOOLEAN   -- has at least one Stage 3 loan
  - ever_repossessed    BOOLEAN
  - has_crosssell_loan  BOOLEAN
  - primary_product_type VARCHAR
  - latest_disbursement_date DATE
  -- Rolled-up repayment behavior (derived from EMI ledger)
  - total_emis          INTEGER
  - paid_emis           INTEGER
  - bounced_emis        INTEGER
  - ontime_emis         INTEGER
  - ontime_rate_pct     DOUBLE    -- ontime_emis / paid_emis × 100 (NULL if no paid EMIs)
  - bounce_rate_pct     DOUBLE    -- bounced_emis / total_emis × 100

VIEW: dealers_full (~2.5K rows)
  - dealer_id, dealer_name, dealer_type, state, city, city_tier, onboard_date, is_active
  - loan_count          INTEGER   -- Derived: total loans sourced through this dealer
  - total_disbursed     DOUBLE    -- Derived: total disbursed amount
  - npa_count           INTEGER   -- Derived: count of Stage 3 loans

═══ RAW REFERENCE TABLES ═══

TABLE: raw_collection_agents (~320 rows) — agent_id, agent_name, region (North|South|East|West), function_type (tele_calling|field_collections|legal_recovery), is_active
TABLE: raw_calendar_events (~29 rows) — event_name, start_date, end_date, overall_multiplier, category_effects, note (festival/sale-season demand multipliers)

═══ SUMMARY TABLES ═══

TABLE: monthly_originations          — month, product_type, sourcing_channel, loan_count, total_sanctioned, total_disbursed, avg_ticket_size, avg_rate, avg_ltv
TABLE: application_funnel_monthly    — month, product_type, applications, disbursed, rejected, withdrawn, pending_docs, approval_rate_pct
TABLE: rejection_reason_summary      — product_type, rejection_reason, rejection_count
TABLE: product_performance           — product_type, total_loans, active_loans, total_disbursed, aum, avg_ticket_size, avg_yield, avg_ltv, avg_tenure_months, npa_count, gnpa_pct
TABLE: stage_dpd_distribution        — product_type, cohort_month, total_loans, stage_1, stage_2, stage_3, stage_1_pct, stage_2_pct, stage_3_pct
TABLE: monthly_collections           — month, product_type, total_emis, total_due, total_collected, bounced, bounce_rate_pct, collection_efficiency_pct, avg_dpd
TABLE: collection_action_effectiveness — action_type, result, action_count
TABLE: collection_agent_leaderboard  — agent_id, agent_name, region, function_type, total_actions, resolved_count, promise_to_pay_count, resolution_rate_pct
TABLE: crosssell_funnel_monthly      — month, channel, offers_sent, viewed, accepted, disbursed, total_disbursed_amount, acceptance_rate_pct, conversion_rate_pct
TABLE: borrower_profile_summary      — employment_type, income_category, is_ntc, loan_count, total_disbursed, avg_ticket, avg_bureau_score, npa_count, gnpa_pct
TABLE: occupation_performance        — occupation, loan_count, total_disbursed, avg_ticket, avg_bureau_score, npa_count, gnpa_pct
TABLE: state_city_tier_kpis          — state, city_tier, month, loans_disbursed, total_disbursed, avg_ticket, npa_count, gnpa_pct
TABLE: dealer_leaderboard            — dealer_id, dealer_name, dealer_type, state, city, city_tier, loan_count, total_disbursed, avg_ticket, npa_count, gnpa_pct
TABLE: sourcing_channel_performance  — sourcing_channel, product_type, total_loans, total_disbursed, avg_ticket, avg_rate, npa_count, gnpa_pct
TABLE: monthly_company_kpis          — month, total_loans_originated, total_disbursed, avg_ticket_size, active_loans, active_aum, stage_3_count, gnpa_pct, two_wheeler_pct, crosssell_pct, avg_yield, avg_ltv, dsa_sourced_pct
TABLE: calendar_seasonality          — event_name, start_date, end_date, overall_multiplier, category_effects, note

DATA CONTEXT:
  - Suvidha Capital — a multi-product NBFC financing two-wheelers, consumer durables, used cars, and personal loans via a dealer network + digital channel
  - ~2.06L loans across ~1.65L borrowers, Jun 2024 – May 2026
  - Product mix: two-wheeler and used two-wheeler (financed via Raahi Motors-authorized and multi-brand dealers), consumer durables (electronics retail), used cars, and personal loans (cross-sell only)
  - Distribution: dealer POS, DSA, direct/branch, and digital (in-app cross-sell to existing borrowers)
  - Currency in INR (₹)
`,

  systemContext: `You are Actioneer, an AI-powered analytics assistant for Suvidha Capital, a consumer and vehicle finance NBFC in India.

Dataset: ~2.06 lakh loans + 18.3 lakh EMI payments + 2.76 lakh applications + 2.19 lakh cross-sell offers, Jun 2024 – May 2026.
Today's date in this dataset: 2026-05-31.
- ~1.65 lakh borrowers, largely self-employed informal (small traders, gig workers, shopkeepers)
- Products: two-wheeler & used two-wheeler, consumer durables, used cars, and cross-sell personal loans
- Distribution via a ~2,500-dealer network (2-wheeler dealers, electronics retailers, used-car dealers) plus DSA, direct, and a digital in-app channel
- Currency in INR (₹)

You cover six analytics domains:
1. ORIGINATIONS & FUNNEL — application volume, approval/rejection rates, rejection reasons, disbursement trends by product and channel
2. PORTFOLIO QUALITY — DPD bucket and IndAS stage distribution, GNPA by product, vintage cohort deterioration
3. COLLECTIONS & RECOVERY — EMI collection efficiency, bounce rates, collection-action effectiveness, agent performance
4. CROSS-SELL — personal loan offer funnel (sent → viewed → accepted → disbursed) by channel
5. DEALER NETWORK & SOURCING — dealer-level disbursement and NPA, sourcing channel quality, geographic concentration
6. BORROWER ANALYTICS — employment type, income segment, occupation, New-to-Credit performance, bureau score distribution

Response guidelines:
- Use markdown: headers, tables, bullet points, bold for emphasis
- Cite specific numbers from query results — never hallucinate data
- Be analytical and actionable — what should the business do?
- Note data limitations
- End with 1-2 suggested follow-up questions
- Never use emojis
- Currency is INR — use ₹ symbol`,

  // ═══════════════════════════════════════════════════════
  // AGENT SPECS (for deep research mode) — canonical 6 core agent IDs
  // ═══════════════════════════════════════════════════════

  queryDescriptions: {
    "data-quality": [
      "NULL rates & field completeness across loans, borrowers, and EMI tables",
      "Referential integrity between loans, borrowers, and dealers",
      "Outliers in interest rates, LTV, and ticket sizes",
    ],
    "daily-metrics": [
      "Monthly disbursement volume and amount by product type",
      "Active loan count and AUM growth trajectory",
      "Application volume and approval rate trend",
    ],
    "cohort-retention": [
      "Vintage cohort analysis: which disbursement months show highest NPA rates",
      "DPD bucket seasoning curves by product type",
      "Prepayment and early-closure rates by vintage",
    ],
    "rev-opt": [
      "Yield analysis by product type",
      "Collection efficiency and bounce rate trends",
      "Cross-sell conversion rate and revenue by channel",
    ],
    "user-segmentation": [
      "Borrower risk profiles: NTC vs credit-tested performance",
      "Employment type and occupation analysis: NPA rates by segment",
      "Income category (EWS/LIG/MIG) credit performance",
    ],
    "geographic": [
      "State and city-tier disbursement and NPA concentration",
      "Dealer network performance: top dealers by volume and quality",
      "Sourcing channel quality: dealer POS vs DSA vs digital",
    ],
  },

  multiAgentPrompt: `data-quality|1|Check NULL rates and data completeness across loans_full, collections_full, and applications_full
data-quality|2|Validate stage/dpd_bucket consistency: loans with stage=3 should have dpd_bucket starting with 'npa'
data-quality|3|Check for outliers in interest_rate, ltv_ratio, and disbursed_amount

daily-metrics|1|Monthly disbursement volume and amount by product_type — use monthly_originations
daily-metrics|2|AUM build-up over time: SUM(disbursed_amount) WHERE loan_status IN ('active','npa'), by month
daily-metrics|3|Application funnel trend: applications, disbursed, rejected by month — use application_funnel_monthly

cohort-retention|1|Vintage cohort NPA rates by disbursement month and product — use stage_dpd_distribution
cohort-retention|2|Prepayment rates by vintage: count of loan_status='prepaid' as % of total, by disbursement month
cohort-retention|3|Repeat borrower behavior: is_repeat_borrower loans vs first-time, NPA comparison

rev-opt|1|Portfolio yield by product type: AVG(interest_rate) weighted by disbursed_amount — use product_performance
rev-opt|2|Collection efficiency and bounce rate trend — use monthly_collections
rev-opt|3|Cross-sell funnel conversion and disbursed value by channel — use crosssell_funnel_monthly

user-segmentation|1|NPA rates by employment_type and occupation — use borrower_profile_summary, occupation_performance
user-segmentation|2|NTC vs credit-tested: compare GNPA rates for is_ntc=true vs is_ntc=false borrowers
user-segmentation|3|Income category performance: EWS vs LIG vs MIG credit quality

geographic|1|State and city-tier disbursement and GNPA — use state_city_tier_kpis
geographic|2|Dealer leaderboard: top dealers by disbursement volume and NPA rate — use dealer_leaderboard
geographic|3|Sourcing channel comparison: dealer_pos vs dsa vs direct vs digital_saathi — use sourcing_channel_performance`,

  // No viewSQL — all tables and views are pre-materialized in the .duckdb file by setup-suvidha-capital.ts.
  summaryTableSQL: [],
};
