import type { DatasetConfig } from "./types";

export const absliLifeDataset: DatasetConfig = {
  id: "absli-life",
  label: "Life Insurance",
  companyName: "ABSLI",
  dbFile: "data/absli-life.duckdb",
  sourceType: "csv",
  setupVersion: "absli-life-v2",

  primaryTable: "policies_full",
  userIdField: "policyholder_id",
  dateField: "issue_date",
  dateRange: { start: "2006-01-01", end: "2026-06-24" },
  currency: "₹",
  entityName: "policyholders",

  reportMeta: {
    totalEvents: "250K policies + 908K premium payments + 521K leads + 180K bancassurance prospects",
    totalUsers: "200K policyholders",
    dateRangeLabel: "2006 – Jun 2026",
    dbName: "absli-life.duckdb",
  },

  suggestedPrompts: [
    "What is our 13-month persistency rate by channel and product category?",
    "Show the lead-to-policy conversion funnel by channel for the last 12 months",
    "Which agents have the highest new business APE and what is their lapse rate?",
    "What is the premium payment collection rate and grace usage trend this year?",
    "Compare ULIP vs traditional product mix in new business over the last 3 years",
    "What is our claim settlement ratio and average turnaround time by claim type?",
    "How many bancassurance bank customers have no policy yet, by bank and propensity band?",
  ],

  welcomeSubtitle: "Analyze policy persistency, distribution performance, premium collections, claims, and ULIP fund management across your book of business.",

  domainHints: `
0. AS-OF DATE: Treat this dataset as of DATE '2026-06-24'. Anchor all relative windows ("last 12 months", "YTD") on this date.
1. PRIMARY TABLE: Use policies_full for most policy-level queries — it joins policies + policyholders + agents + products into one denormalized table.
2. POLICY STATUS: status values are 'In-Force', 'Lapsed', 'Paid-Up', 'Matured', 'Surrendered', 'Death Claim', 'Free-Look Cancelled'. Use these exact strings.
3. PERSISTENCY: 13-month persistency = persistency_13m_flag = true. This is a boolean on policies_full. Count policyholders who paid all 13 consecutive monthly premiums.
4. APE (Annualized Premium Equivalent): Use annualized_premium_equivalent column on policies_full. For single-premium products, APE = premium/10 by industry convention (already applied in the column).
5. PREMIUM COLLECTIONS: Use premium_full for payment analysis. status values: 'Paid', 'Missed', 'Overdue'. grace_flag = true means paid within grace period (30 days). collection_rate = COUNT(Paid) / COUNT(total due).
6. LAPSE ANALYSIS: A policy lapses when premium is not paid beyond grace period → status = 'Lapsed'. Use policy_events_full WHERE event_type = 'Lapse' for event-level lapse analysis.
7. REVIVAL: A lapsed policy reinstated = event_type = 'Revival' in policy_events_full. Revival rate = revivals / lapses.
8. CLAIMS: Use claims_full. claim_type: 'Death', 'Maturity', 'Surrender', 'Rider'. decision: 'Settled', 'Repudiated', 'Pending'. Claim settlement ratio = Settled / (Settled + Repudiated). Early claim = is_early_claim_flag = true (claim within 2 years of issue).
9. CHANNEL: Bancassurance (bank partners), Agency (tied agents), Broker (POSP/web brokers), Direct (own website), Group (employer/HR). Join through policies_full.channel.
10. ULIP: Use fund_transactions_full for ULIP fund allocation/switch/withdrawal/partial-withdrawal. Join to fund_nav_history for NAV-based fund value. fund_transactions_full.txn_type values: 'Allocation', 'Switch-In', 'Switch-Out', 'Partial Withdrawal', 'Top-Up Allocation'.
11. PRODUCT CATEGORIES: 'Term', 'Endowment', 'ULIP', 'Child', 'Annuity', 'Pension', 'Health', 'Group'. Use product_category on policies_full (already joined from products).
12. LEAD FUNNEL: Use leads_full. status: 'Converted', 'Not Interested', 'Contacted', 'Prospect'. converted_flag = true means a policy was issued. Conversion rate = converted_flag=true / total leads by channel/campaign.
13. AGENT PERFORMANCE: agent_tier: 'Bronze', 'Silver', 'Gold', 'Platinum'. Use agents_summary for pre-computed metrics. For custom: join policies_full on agent_id.
14. POLICY YEAR: policy_year column on policies_full gives how many full years the policy has been in force.
15. FIRST YEAR PREMIUM (FYP): first_year_premium column on policies_full. Use for new business volume sizing.
16. COMMISSION: first_year_commission on policies_full = FYP × commission_rate (varies by product).
17. CURRENCY: All amounts in INR (₹). Sum-assured is total insured amount (death benefit). annual_premium is the recurring yearly premium.
18. BANCASSURANCE CROSS-SELL: Use bancassurance_leads for the untapped prospect pool — bank customers with a banking relationship but NO ABSLI policy (existing_insurance_flag = false on every row). This is NOT leads_full (that is the active insurance funnel); bancassurance_leads customers are absent from policies_full/policyholders. Target with propensity_band ('High'/'Medium'/'Low'), recommended_product, has_home_loan_flag (loan-protection term cross-sell), customer_segment, and bank_name. lead_status = 'New' means unassigned. Use bancassurance_summary for fast roll-ups by bank × segment × propensity × product.
19. PREFERRED SUMMARY TABLES:
    - New business: monthly_new_business (by month, channel, product)
    - Persistency: persistency_summary (by channel, product, cohort year)
    - Collections: premium_collection_monthly (payment performance by month)
    - Claims: claims_summary (by type, decision, channel)
    - Distribution: channel_performance, agent_leaderboard
    - Leads: lead_funnel_monthly (conversion funnel by month and channel)
    - Bancassurance cross-sell: bancassurance_leads (prospect-level), bancassurance_summary (roll-up)
`,

  summaryTableHint: `Use summary tables when they can answer the question:
- NEW BUSINESS: monthly_new_business, lead_funnel_monthly
- PERSISTENCY: persistency_summary, lapse_analysis
- PREMIUM COLLECTIONS: premium_collection_monthly
- CLAIMS: claims_summary
- DISTRIBUTION: channel_performance, agent_leaderboard
- BANCASSURANCE CROSS-SELL (untapped bank customers with no policy): bancassurance_leads, bancassurance_summary
Use policies_full, premium_full, claims_full, policy_events_full, leads_full, fund_transactions_full, bancassurance_leads for custom cohort or cross-dimensional queries.`,

  schemaContext: `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect)

═══ CORE POLICY TABLES ═══

TABLE/VIEW: policies_full (~250K rows) — USE THIS for policy-level queries
  Denormalized: policies + policyholders + agents + products joined.
  CURRENT DATE: 2026-06-24

  -- Policy core
  - policy_id           VARCHAR     -- Unique policy identifier (e.g. 'POL_6d40b621b3')
  - issue_date          TIMESTAMP   -- Policy issue date
  - commencement_date   TIMESTAMP   -- Risk commencement date
  - status              VARCHAR     -- 'In-Force' | 'Lapsed' | 'Paid-Up' | 'Matured' | 'Surrendered' | 'Death Claim' | 'Free-Look Cancelled'
  - status_date         TIMESTAMP   -- Date status last changed
  - policy_term_years   INTEGER     -- Total policy term
  - premium_payment_term_years INTEGER
  - ppt_type            VARCHAR     -- 'Regular' | 'Limited' | 'Single'
  - policy_year         INTEGER     -- Years in force (1-indexed)
  - sum_assured         DOUBLE      -- Death benefit amount (₹)
  - annual_premium      DOUBLE      -- Annual premium (₹)
  - annualized_premium_equivalent DOUBLE -- APE (₹); single-prem / 10 for singles
  - premium_mode        VARCHAR     -- 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly'
  - modal_premium       DOUBLE      -- Per-installment amount
  - first_year_premium  DOUBLE      -- FYP (₹)
  - first_year_commission DOUBLE    -- Commission earned on FYP (₹)
  - underwriting_type   VARCHAR     -- 'STP' | 'Manual'
  - risk_class          VARCHAR     -- 'Standard' | 'Sub-Standard'
  - medical_required_flag BOOLEAN
  - rider_count         INTEGER     -- 0-3 riders
  - rider_set           VARCHAR     -- e.g. 'Accidental Death Benefit'
  - has_ci_rider        BOOLEAN     -- Critical Illness rider
  - has_adb_rider       BOOLEAN     -- Accidental Death Benefit rider
  - has_wop_rider       BOOLEAN     -- Waiver of Premium rider
  - tax_exempt_10_10d_flag BOOLEAN  -- Qualifies for 10(10D) tax exemption
  - persistency_13m_flag BOOLEAN    -- TRUE = all 13 monthly premiums paid
  - sourced_in_window_flag BOOLEAN  -- Sourced in campaign window
  - fund_id             VARCHAR     -- NULL for non-ULIP
  - fund_value          DOUBLE      -- Current ULIP fund value (NULL for non-ULIP)

  -- Product (joined from products)
  - product_id          VARCHAR
  - product_category    VARCHAR     -- 'Term' | 'Endowment' | 'ULIP' | 'Child' | 'Annuity' | 'Pension' | 'Health' | 'Group'
  - product_name        VARCHAR
  - par_flag            BOOLEAN     -- Participating (with-profits) product
  - first_year_commission_rate DOUBLE

  -- Channel & Agent (joined from agents)
  - agent_id            VARCHAR
  - channel             VARCHAR     -- 'Bancassurance' | 'Agency' | 'Broker' | 'Direct' | 'Group' | 'POSP'
  - partner_name        VARCHAR     -- e.g. 'Bajaj Capital', 'Policybazaar', 'SBI Life'
  - agent_name          VARCHAR
  - agent_tier          VARCHAR     -- 'Bronze' | 'Silver' | 'Gold' | 'Platinum'
  - branch_city         VARCHAR
  - branch_state        VARCHAR

  -- Policyholder (joined from policyholders)
  - policyholder_id     VARCHAR     -- Primary customer identifier
  - full_name           VARCHAR
  - gender              VARCHAR     -- 'M' | 'F'
  - age                 INTEGER     -- Age at time of profile snapshot
  - age_band            VARCHAR     -- '18-24' | '25-34' | '35-44' | '45-54' | '55+'
  - city                VARCHAR
  - state               VARCHAR
  - occupation          VARCHAR     -- 'Salaried' | 'Self-Employed' | 'Business Owner' | 'Professional'
  - annual_income_band  VARCHAR     -- '<5L' | '5-10L' | '10-25L' | '25-50L' | '50L+'
  - smoker_flag         BOOLEAN
  - nri_flag            BOOLEAN
  - kyc_status          VARCHAR     -- 'Verified' | 'Pending' | 'Rejected'
  - customer_segment    VARCHAR     -- 'Mass' | 'Affluent' | 'HNI' | 'UHNI'
  - total_policies      INTEGER     -- Total policies held by customer
  - inforce_policies    INTEGER     -- Currently active policies

TABLE: raw_policies (~250K rows) — raw with foreign keys only (no joins)
TABLE: raw_policyholders (~200K rows) — raw customer demographics
TABLE: raw_agents (~3K rows) — agent master data

═══ PREMIUM PAYMENTS ═══

TABLE/VIEW: premium_full (~908K rows) — USE THIS for payment analysis
  Joins premium_payments + policy info.

  - payment_id          VARCHAR     -- Unique payment ID
  - policy_id           VARCHAR
  - policyholder_id     VARCHAR
  - due_date            TIMESTAMP   -- When premium was due
  - paid_date           TIMESTAMP   -- Actual payment date (NULL if missed)
  - premium_year        INTEGER     -- Policy year of this installment
  - installment_no      INTEGER     -- Installment number within the year
  - amount              DOUBLE      -- Premium amount (₹)
  - premium_mode        VARCHAR     -- 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly'
  - payment_channel     VARCHAR     -- 'Auto-Debit / NACH' | 'Net Banking' | 'UPI' | 'Branch' | 'Agent'
  - payment_type        VARCHAR     -- 'First' | 'Renewal'
  - status              VARCHAR     -- 'Paid' | 'Missed' | 'Overdue'
  - late_days           DOUBLE      -- Days paid after due date (0 if on time, NULL if missed)
  - grace_flag          BOOLEAN     -- TRUE = paid within 30-day grace period
  -- Joined from policies:
  - product_category, channel, partner_name, annual_premium

TABLE: raw_premium_payments (~908K rows) — raw payment table

═══ LEADS & SALES FUNNEL ═══

TABLE/VIEW: leads_full (~521K rows) — USE THIS for funnel analysis
  Joins leads + agents.

  - lead_id             VARCHAR
  - policyholder_id     VARCHAR     -- NULL for anonymous leads
  - created_date        TIMESTAMP   -- Lead creation date
  - channel             VARCHAR     -- 'Direct' | 'Agency' | 'Bancassurance' | 'Broker' | 'POSP'
  - partner_name        VARCHAR
  - agent_id            VARCHAR
  - product_interest    VARCHAR     -- 'Term' | 'Endowment' | 'ULIP' | 'Health' | etc.
  - campaign            VARCHAR     -- e.g. 'Smart Protect', 'Retire Rich', 'Growth Plus'
  - lead_source         VARCHAR     -- 'Website' | 'Agent Prospecting' | 'Bank Branch' | 'Call Center'
  - status              VARCHAR     -- 'Converted' | 'Not Interested' | 'Contacted' | 'Prospect'
  - converted_flag      BOOLEAN
  - policy_id           VARCHAR     -- NULL if not converted
  - converted_date      TIMESTAMP   -- NULL if not converted
  -- Joined from agents:
  - agent_name, agent_tier, branch_city, branch_state

TABLE: raw_leads (~521K rows) — raw lead table

═══ BANCASSURANCE CROSS-SELL POOL ═══

TABLE: bancassurance_leads (~180K rows) — USE THIS for bancassurance cross-sell / untapped prospects
  Bank customers sourced from ABSLI's bancassurance partner banks who hold a banking
  relationship but own NO ABSLI policy (existing_insurance_flag = false for every row).
  This is the untapped list an RM works down — distinct from leads_full (which is the
  active insurance sales funnel). These rows do NOT appear in policies_full / policyholders.

  - bank_lead_id             VARCHAR   -- Unique prospect id (e.g. 'BNK_cfcd208495')
  - bank_name                VARCHAR   -- Partner bank: 'HDFC Bank' | 'Indian Bank' | 'DBS Bank' | 'IDFC First Bank' | 'Ujjivan SFB' | 'Bank of Maharashtra' | 'DCB Bank' | 'Deutsche Bank' | 'Karur Vysya Bank'
  - full_name                VARCHAR
  - gender                   VARCHAR   -- 'M' | 'F'
  - age                      INTEGER
  - age_band                 VARCHAR   -- '18-24' | '25-34' | '35-44' | '45-54' | '55+'
  - city                     VARCHAR
  - state                    VARCHAR
  - occupation               VARCHAR   -- 'Salaried' | 'Self-Employed' | 'Business Owner' | 'Professional' | 'Retired' | 'Homemaker'
  - annual_income_band       VARCHAR   -- '<5L' | '5-10L' | '10-25L' | '25-50L' | '50L+'
  - customer_segment         VARCHAR   -- 'Mass' | 'Mass Affluent' | 'Affluent' | 'HNI'
  - email                    VARCHAR
  - mobile                   VARCHAR
  - relationship_tenure_years INTEGER  -- Years the customer has banked with the partner
  - avg_balance_band         VARCHAR   -- '<3L' | '3-10L' | '10-25L' | '25L+'
  - salary_account_flag      BOOLEAN   -- Holds a salary account with the bank
  - has_fd_flag              BOOLEAN   -- Holds a fixed deposit
  - has_credit_card_flag     BOOLEAN
  - has_home_loan_flag       BOOLEAN   -- Strong term-cover cross-sell trigger (loan protection)
  - has_mutual_fund_flag     BOOLEAN
  - banking_products         VARCHAR   -- Comma list, e.g. 'Savings, Salary Account, Home Loan'
  - existing_insurance_flag  BOOLEAN   -- ALWAYS false (defines this pool)
  - recommended_product      VARCHAR   -- Profile-driven pitch: 'Term' | 'ULIP' | 'Endowment' | 'Child' | 'Annuity'
  - propensity_score         INTEGER   -- 1-99 cross-sell propensity
  - propensity_band          VARCHAR   -- 'High' (>=70) | 'Medium' (>=45) | 'Low'
  - lead_status              VARCHAR   -- 'New' (unassigned) | 'Assigned' | 'Contacted' | 'Not Interested'
  - assigned_agent_id        VARCHAR   -- Bancassurance agent handling the lead (NULL when lead_status='New')
  - created_date             DATE      -- When the bank shared the lead
  - last_contact_date        DATE      -- Last outreach (NULL if never contacted)

═══ CLAIMS ═══

TABLE/VIEW: claims_full (~2.8K rows) — USE THIS for claims analysis
  Joins claims + policy + policyholder info.

  - claim_id            VARCHAR
  - policy_id           VARCHAR
  - policyholder_id     VARCHAR
  - claim_type          VARCHAR     -- 'Death' | 'Maturity' | 'Surrender' | 'Rider'
  - cause_category      VARCHAR     -- 'Accidental' | 'Natural' | 'Critical Illness' | 'Maturity' etc.
  - claim_amount        DOUBLE      -- Claim payout amount (₹)
  - intimation_date     TIMESTAMP   -- Date claim was reported
  - decision_date       TIMESTAMP   -- Date of claim decision
  - payout_date         TIMESTAMP   -- Date payout made (NULL if pending)
  - decision            VARCHAR     -- 'Settled' | 'Repudiated' | 'Pending'
  - repudiation_reason  VARCHAR     -- NULL if settled/pending
  - is_early_claim_flag BOOLEAN     -- TRUE = claim within 2 years of policy issue
  - settled_within_30d_flag BOOLEAN -- TRUE = settled in ≤30 days
  -- Joined from policies:
  - product_category, channel, issue_date

═══ POLICY LIFECYCLE EVENTS ═══

TABLE/VIEW: policy_events_full (~156K rows)
  Joins policy_events + policy info.

  - event_id            VARCHAR
  - policy_id           VARCHAR
  - policyholder_id     VARCHAR
  - event_type          VARCHAR     -- 'Policy Issued' | 'Lapse' | 'Revival' | 'Surrender' |
                                    --   'Maturity' | 'Top-Up Premium' | 'Paid-Up Conversion' |
                                    --   'Nominee Change' | 'Address Change' | 'Mode Change' |
                                    --   'Policy Loan' | 'Partial Withdrawal' | 'Free-Look Cancellation'
  - event_date          TIMESTAMP   -- When the event occurred
  - amount              DOUBLE      -- Amount (for Top-Up, Policy Loan, Partial Withdrawal; else NULL)
  - detail              VARCHAR     -- Human-readable description
  - channel             VARCHAR     -- Channel through which event was triggered

TABLE: raw_policy_events (~156K rows) — raw events

═══ ULIP INVESTMENTS ═══

TABLE/VIEW: fund_transactions_full (~81K rows)
  Joins fund_transactions + fund metadata.

  - fund_txn_id         VARCHAR
  - policy_id           VARCHAR
  - policyholder_id     VARCHAR
  - fund_id             VARCHAR
  - txn_type            VARCHAR     -- 'Allocation' | 'Switch-In' | 'Switch-Out' |
                                    --   'Partial Withdrawal' | 'Top-Up Allocation'
  - units               DOUBLE
  - nav                 DOUBLE      -- NAV at transaction date
  - amount              DOUBLE      -- Transaction amount (₹)
  - txn_date            TIMESTAMP
  -- Joined from funds:
  - fund_name, fund_type, risk_profile  -- fund_type: 'Equity' | 'Hybrid' | 'Debt' | 'Liquid'

TABLE: raw_fund_nav_history (~432 rows) — daily NAV per fund
  - fund_id, nav_date, nav

═══ REFERENCE TABLES ═══

TABLE: raw_products (~34 rows) — Product catalog
  - product_id, product_name, category, par_flag, min/max_sum_assured,
    min/max_term_years, ppt_type, tax_section, launch_year, status,
    first_year_commission_rate

TABLE: raw_funds (~18 rows) — ULIP fund catalog
  - fund_id, fund_name, fund_type, risk_profile, inception_date,
    inception_nav, current_nav, aum_cr, benchmark

═══ SUMMARY TABLES ═══

New Business:
  - monthly_new_business (month, channel, product_category, policies, fyp, ape, commission)
  - lead_funnel_monthly (month, channel, leads, contacted, converted, conversion_rate_pct)

Persistency:
  - persistency_summary (cohort_year, channel, product_category, policies, persistent_13m, persistency_rate_pct)
  - lapse_analysis (cohort_year, policy_year, channel, product_category, lapses, lapse_rate_pct)

Collections:
  - premium_collection_monthly (month, channel, due_count, paid_count, missed_count, collection_rate_pct, grace_usage_pct)

Claims:
  - claims_summary (claim_type, decision, channel, product_category, count, total_amount, avg_turnaround_days, settlement_ratio_pct)

Distribution:
  - channel_performance (channel, policies, fyp, ape, avg_persistency_pct, conversion_rate_pct)
  - agent_leaderboard (agent_id, agent_name, agent_tier, channel, policies, fyp, persistency_rate_pct)

Bancassurance cross-sell:
  - bancassurance_summary (bank_name, customer_segment, propensity_band, recommended_product, prospects, avg_propensity_score, home_loan_prospects, salary_account_prospects, unassigned_prospects)

DATA CONTEXT:
  - Life insurance company (ABSLI — Aditya Birla Sun Life Insurance)
  - ~250K policies issued 2006–2026; ~200K policyholders
  - Channel mix: Bancassurance (52%), Agency (23%), Broker (10%), Direct (9%), Group (4%), POSP (2%)
  - Product mix: Endowment (29%), Term (25%), ULIP (23%), Child (6%), Annuity/Pension/Health/Group (17%)
  - Policy status: In-Force (69%), Lapsed (19%), Paid-Up (7%), Matured (3%), Surrendered (1.5%)
  - Premium in INR; sum_assured is death benefit
`,

  systemContext: `You are Actioneer, an AI-powered analytics assistant for a life insurance company (ABSLI — Aditya Birla Sun Life Insurance).

Dataset: ~250K policies + 908K premium payments + 521K leads + 156K policy events, 2006–2026.
Today's date in this dataset: 2026-06-24.
- ~200K policyholders across India
- 8 product categories: Term, Endowment, ULIP, Child, Annuity, Pension, Health, Group
- Distribution via Bancassurance, Agency, Broker, Direct, Group, POSP
- Currency in INR (₹)

You cover six domains:
1. NEW BUSINESS & SALES — leads, conversion funnel, channel/agent performance, FYP, APE, product mix
2. PERSISTENCY & RETENTION — 13-month persistency, lapse analysis, revival, paid-up conversions
3. PREMIUM COLLECTIONS — payment performance, grace period usage, missed installments, NACH vs UPI
4. CLAIMS — settlement ratio, turnaround time, early claims, repudiation analysis
5. DISTRIBUTION — channel comparison, agent leaderboard, partner performance, campaign effectiveness
6. ULIP INVESTMENTS — fund switches, risk profile migration, NAV performance, fund value

Response guidelines:
- Use markdown: headers, tables, bullet points, bold for emphasis
- Cite specific numbers from query results — never hallucinate data
- Be analytical and actionable — what should the business do?
- Note data limitations
- End with 1-2 suggested follow-up questions
- Never use emojis
- Currency is INR — use ₹ symbol
- Use insurance industry terminology (APE, FYP, persistency, lapse, revival, sum assured)`,

  queryDescriptions: {
    "data-quality": [
      "NULL rates & field completeness across policy and payment tables",
      "Data anomalies: unrealistic premium amounts, duplicate policies",
    ],
    "new-business": [
      "Monthly new policies issued and APE trend",
      "Lead-to-policy conversion rate by channel",
      "Product mix shift over time",
    ],
    "persistency": [
      "13-month persistency rate by channel and product category",
      "Lapse trend by policy year and cohort",
      "Revival rate analysis",
    ],
    "collections": [
      "Monthly premium collection rate and grace period usage",
      "Missed payment frequency by channel and product",
      "Payment mode breakdown (NACH, UPI, Net Banking, Branch)",
    ],
    "claims": [
      "Claim settlement ratio by type and channel",
      "Average claim turnaround time",
      "Early claim analysis (within 2 years of issue)",
    ],
    "distribution": [
      "Channel performance: APE, persistency, conversion rate",
      "Top agent leaderboard by FYP and persistency",
      "Partner/bank comparison in bancassurance channel",
      "Bancassurance cross-sell pool: untapped bank customers with no policy by bank and propensity",
    ],
  },

  multiAgentPrompt: `
data-quality|1| — NULL rates: check policyholder_id, sum_assured, annual_premium, paid_date for completeness
data-quality|2| — Volume sanity: daily policy count and premium payment count to detect anomalies

new-business|1| — Monthly FYP and APE: total FYP and APE by month, channel, product_category from monthly_new_business
new-business|2| — Lead funnel: conversion rates from lead_funnel_monthly by channel and campaign
new-business|3| — Product mix: share of new policies by product_category trend over 3 years

persistency|1| — 13M persistency: persistency_rate_pct by channel and product_category from persistency_summary
persistency|2| — Lapse trend: lapse_rate_pct by policy_year from lapse_analysis
persistency|3| — Revival: count of revivals and revival-to-lapse ratio from policy_events_full

collections|1| — Collection rate: monthly collection_rate_pct and grace_usage_pct from premium_collection_monthly
collections|2| — Missed payments: missed installments by premium_mode and payment_channel
collections|3| — Payment channel split: NACH vs UPI vs Branch share of paid installments

claims|1| — Settlement ratio: claim decision breakdown from claims_summary by claim_type
claims|2| — Turnaround: avg_turnaround_days by channel and decision from claims_summary
claims|3| — Early claims: is_early_claim_flag rate and product mix from claims_full

distribution|1| — Channel comparison: APE, persistency, conversion_rate from channel_performance
distribution|2| — Agent leaders: top 20 agents by FYP and persistency from agent_leaderboard
distribution|3| — Partner breakdown: bancassurance partner performance by APE and persistency
distribution|4| — Bancassurance cross-sell pool: untapped prospects (existing_insurance_flag=false) by bank_name and propensity_band from bancassurance_summary, with % holding a home loan (term cross-sell trigger)
distribution|5| — Cross-sell targeting: high-propensity prospects (propensity_band='High') by recommended_product and customer_segment from bancassurance_leads, and count still unassigned (lead_status='New')`,

  // No viewSQL — all tables and views are pre-materialized in the .duckdb file by setup-absli-life.ts.
  summaryTableSQL: [],
};
