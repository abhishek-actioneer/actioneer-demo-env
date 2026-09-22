import { FUNDSINDIA_EVENTS, getFundsIndiaViewSQL } from "./fundsindia-events";
import type { DatasetConfig } from "./types";

// ══════════════════════════════════════════════════════════
// DATASET CONFIG
// ══════════════════════════════════════════════════════════

export const fundsindiaDataset: DatasetConfig = {
  id: "fundsindia",
  label: "Wealth & AMC",
  dbFile: "data/fundsindia.duckdb",
  sourceType: "csv",
  setupVersion: "fundsindia-events-v2",
  primaryTable: "transactions_full",
  userIdField: "investor_id",
  dateField: "txn_date",
  dateRange: { start: "2024-06-01", end: "2026-05-28" },
  currency: "₹",
  entityName: "investors",

  reportMeta: {
    totalEvents: "475K transactions + 1.18M behavior events",
    totalUsers: "50K sample investors",
    dateRangeLabel: "Jun 2024 – May 2026",
    dbName: "fundsindia.duckdb",
  },

  suggestedPrompts: [
    "How healthy is our SIP book this year: new SIPs created versus cancelled by fund category?",
    "Which asset managers generate the most trailing commission on our platform?",
    "How does our investor activation funnel convert from signup to KYC to first SIP by channel?",
    "How do T30 and B30 investors compare on average SIP size, equity allocation, and retention?",
    "Which campaign types drive the highest SIP creation rate?",
    "What share of SIPs from each quarter's cohort is still active today?",
  ],

  welcomeSubtitle: "Ask about your investor base, SIP book health, fund performance, commission revenue, and campaign effectiveness.",

  // ═══════════════════════════════════════════════════════
  // DOMAIN HINTS
  // ═══════════════════════════════════════════════════════

  domainHints: `
0. AS-OF DATE / RELATIVE WINDOWS: Treat this sample as-of DATE '2026-05-28'. For "last N days", "recent", or follow-up windows, anchor on DATE '2026-05-28'. Do NOT use CURRENT_DATE and do NOT use MAX(txn_date), MAX(activity_date), or MAX(event_timestamp) as the business as-of date; future-dated redemption/lifecycle rows can extend past the sample as-of date and will shift purchase cohorts into sparse future periods.
1. PURCHASE COHORTS: A mutual-fund purchase is transactions_full WHERE status = 'success' AND txn_type IN ('sip_installment','lumpsum','stp_purchase'). Never filter txn_type = 'purchase' because that literal does not exist. For a "last 90 days" purchase cohort use CAST(txn_date AS DATE) BETWEEN DATE '2026-05-28' - INTERVAL '90' DAY AND DATE '2026-05-28'.
2. POST-PURCHASE FOLLOW-UP: For "no engagement in the following 45 days", join user_events_full on investor_id with event_timestamp > purchase_anchor_date and <= purchase_anchor_date + INTERVAL '45' DAY, capped at DATE '2026-05-28'. If a full 45-day observation window is required, only classify anchors where purchase_anchor_date <= DATE '2026-05-28' - INTERVAL '45' DAY, or expose a followup_complete flag.
3. POST-PURCHASE ENGAGEMENT EVENTS: Use lowercase snake_case event_name values such as dashboard_visited, portfolio_visited, fund_searched, fund_page_viewed, fund_watchlisted, sip_flow_started, sip_amount_entered, email_opened, email_link_clicked, goal_created, redemption_initiated. Do not use display labels.
6. ACTIVE SIPs: Use sips_full WHERE status = 'active'. For active SIP count over time use sip_cohort_retention summary table.
7. SIP vs LUMPSUM: txn_type = 'sip_installment' for SIP monthly debits. txn_type = 'lumpsum' for one-time purchases. sip_id IS NULL for lumpsums.
8. COMMISSION REVENUE: estimated monthly = total_invested × trailing_commission_pct / 100 / 12. Use amc_performance table for pre-computed values.
9. ELSS = tax-saving funds (fund_category = 'elss'). Eligible for 80C deduction up to ₹1.5L/year. 3-year lock-in. SIP creation spikes every Jan-Mar.
10. T30/B30 = city_tier in investors and sips_full. T30 = top 30 cities by AUM (metros). B30 = all others (smaller cities).
11. INDIAN FISCAL YEAR: April to March. FY25 = Apr 2024–Mar 2025. FY26 = Apr 2025–Mar 2026. Q1 = Apr-Jun, Q4 = Jan-Mar.
12. ACTIVATION FUNNEL: All steps are date columns — signup_date, pan_confirmed_date, kyc_submitted_date, bank_verified_date, account_activated_date, first_investment_date. NULL = dropped off at that step. Use investor_funnel summary table for pre-computed rates when available; for user-level cohorts use raw_investors if available, otherwise use the equivalent columns on user_events_full. Do not derive the primary KYC funnel from display-case event labels.
13. RETENTION: sip_installment is the best retention signal (monthly recurrence). Use sip_cohort_retention table for pre-computed cohort retention by start quarter.
14. BLOCKED HIGH-INTENT USERS: Users can browse/search/watchlist funds and start SIP flows after signup, but cannot complete SIP creation or transactions until KYC and bank verification are done. Use user_events_full where account_activated_date IS NULL, kyc_status <> 'verified' OR bank_verified_date IS NULL, and event_name is fund_searched/fund_page_viewed/fund_watchlisted/sip_flow_started/sip_amount_entered/sip_flow_abandoned.
14a. EVENT NAME LITERALS: user_events_full.event_name values are lowercase snake_case, for example signup_started, pan_confirmed, kyc_details_submitted, kyc_on_hold, bank_verified, account_activated, fund_searched, fund_page_viewed, fund_watchlisted, sip_flow_started, sip_amount_entered, sip_flow_abandoned. Never use display labels like 'Signup Started' or 'Bank Verified' in SQL filters.
15. CAMPAIGN ATTRIBUTION: Use campaign_performance summary table for open/click/conversion rates by campaign_type and month. For cross-table attribution join comms_log with transactions on investor_id WHERE txn_date BETWEEN sent_at AND sent_at + INTERVAL 30 DAYS.
16. NACH vs UPI FAILURE: NACH mandate failure rate is ~6.2%, UPI autopay ~1.9%. Filter: payment_mode = 'nach' or 'upi' in transactions_full.
17. FI SELECT FUNDS: is_fi_select = true in funds/transactions_full/sips_full. These funds have 76% 12-month SIP retention vs 48% for non-FI-Select.
18. REGULAR PLANS ONLY: FundsIndia distributes only regular plans. All trailing_commission_pct values are > 0.
19. SIP AMOUNT RANGES: Use amount_range column in sips_full: '<2K' / '2-5K' / '5-15K' / '>15K'.
20. MONEY MITR vs HUMAN ADVISOR: advisor_type in advisory_full. money_mitr = robo-advisory. human_advisor = real advisor call.
21. GOAL-LINKED SIPs: raw_goals/goals_full do not join directly to sips_full. A SIP is tied to a goal through transactions_full.goal_id plus transactions_full.sip_id. For "created a goal but no SIP toward that goal", use goals_full/raw_goals LEFT JOIN transactions_full ON goal_id and txn_type='sip_installment' and keep goals with no matching SIP transaction.
22. PRE-REDEMPTION CALLS: session_type = 'pre_redemption_call' in advisory_full. outcome = 'followed' means investor did NOT redeem (retained). 55% retention rate.
23. SEBI KYC CRISIS: Jun-Jul 2024 saw kyc_status = 'on_hold' spike to ~11% (vs ~3% normal). Support tickets of category = 'kyc' were ~3× higher those months.
24. ELSS TAX SEASON SPIKE: Jan-Mar months show 3-4× higher ELSS SIP creation rate vs other months. Visible in sips_full WHERE fund_category = 'elss' GROUP BY month.
25. CURRENCY: All amounts in INR (₹). No lakh/crore conversion needed — amounts are raw INR.
26. PREFERRED SUMMARY TABLES:
    - Platform: monthly_platform_kpis, monthly_txn_summary
    - Funds: fund_platform_stats (by fund), amc_performance (by AMC)
    - SIPs: sip_cohort_retention (retention by quarter)
    - Funnel: investor_funnel (signup → first investment)
    - Campaigns: campaign_performance
    - Geography: city_tier_kpis
    - Goals: goal_achievement
    - Support: support_metrics
    Use transactions_full / sips_full / systematic_plans_full / investor_investment_history / investor_fund_positions / user_events_full / raw_investors for custom queries.
`,

  summaryTableHint: `Use summary tables when they can answer the question:
- PLATFORM LEVEL: monthly_platform_kpis (new SIPs, cancellations by month), monthly_txn_summary (transactions by type/month)
- FUND / AMC: fund_platform_stats (per-fund investor count, AUM, active SIPs), amc_performance (AMC-level AUM + commission)
- SIP RETENTION: sip_cohort_retention (retention % at 3/6/12 months by start quarter)
- INVESTOR FUNNEL: investor_funnel (signup → KYC → bank → activated → invested by channel + city_tier)
- CAMPAIGNS: campaign_performance (open/click/conversion rates by campaign type and month)
- GEOGRAPHY: city_tier_kpis (T30 vs B30: SIP count, amount, active sips by month)
- GOALS: goal_achievement (on-track/at-risk/achieved by goal type and created_by)
- SUPPORT: support_metrics (ticket volume, resolution time, NPS by category and month)

Use raw views / full views for custom analysis:
- transactions_full: per-transaction analysis, payment mode breakdowns, channel attribution
- sips_full: per-SIP analysis, step-up patterns, cancellation reasons
- sips_ending_soon: SIPs with end_date in the next 90 days from dataset as-of date 2026-05-28
- systematic_plans_full: STP/SWP/super-savings lifecycle and source-to-target fund movement
- investor_investment_history: user-level timeline across transactions, SIP lifecycle, and systematic-plan lifecycle
- investor_fund_positions: user-level current/closed fund positions, net invested, net units, product/category/AMC holdings
- investor_portfolio_summary: one row per investor for portfolio segmentation, breadth, value buckets, dominant AMC/category
- fund_position_summary: one row per fund for holders, buyers, redemptions, net invested, SIP-linked holders
- raw_investors: KYC funnel, demographic breakdowns
- user_events_full: behavioral funnel analysis (onboarding steps, SIP flow abandonment, calculator attribution). Blocked users can browse funds and start SIP flows; successful purchase requires completed KYC + bank verification.

Relative-date rule: use DATE '2026-05-28' as the fixed as-of date for "last N days" analysis. Do not anchor relative windows on MAX(txn_date), MAX(activity_date), or MAX(event_timestamp), because a small number of future-dated redemption/lifecycle rows extend beyond the product sample window.`,

  // ═══════════════════════════════════════════════════════
  // SCHEMA CONTEXT (for LLM SQL generation)
  // ═══════════════════════════════════════════════════════

  schemaContext: `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect)

PLATFORM: FundsIndia — advisory-led mutual fund distribution platform
DATE RANGE: 2024-06-01 to 2026-05-28 (24 months)
AS-OF DATE FOR RELATIVE WINDOWS: 2026-05-28
CURRENCY: INR (all amounts in raw rupees — no lakh/crore conversion needed)
PRIMARY ENTITY: investor_id

CRITICAL RELATIVE-DATE RULE:
- For "last N days", "recent", "post-purchase", and retention/engagement windows, use DATE '2026-05-28' as the as-of date.
- Do not use CURRENT_DATE.
- Do not use MAX(txn_date), MAX(activity_date), or MAX(event_timestamp) as the as-of date; future-dated redemption/lifecycle rows exist after 2026-05-28 and will make purchase cohorts empty.
- Purchase means transactions_full.status = 'success' AND txn_type IN ('sip_installment','lumpsum','stp_purchase').

DENORMALIZED VIEWS (query these for most analysis):

VIEW: transactions_full (~475K rows)
  Pre-joined: transactions + funds + investors
  - txn_id            VARCHAR  -- unique transaction ID
  - investor_id       VARCHAR  -- "INV_000001" etc.
  - fund_id           VARCHAR  -- "FI_001" etc.
  - sip_id            VARCHAR  -- FK to sip (NULL for lumpsums)
  - txn_date          DATE
  - txn_type          VARCHAR  -- sip_installment | lumpsum | stp_purchase | redemption
  - amount_inr        DOUBLE   -- 0 for failed transactions
  - units             DOUBLE
  - nav_at_txn        DOUBLE
  - status            VARCHAR  -- success | failed | pending
  - channel           VARCHAR  -- app | web | email_link | advisor_assisted
  - payment_mode      VARCHAR  -- nach | upi | netbanking | bank_transfer | internal_transfer
  - amount_range      VARCHAR  -- <2K | 2-5K | 5-15K | 15-50K | >50K
  - fund_name         VARCHAR
  - amc_name          VARCHAR  -- SBI Mutual Fund | HDFC Mutual Fund | ICICI Prudential | Nippon India | Kotak Mahindra | Axis Mutual Fund | Mirae Asset | Parag Parikh (PPFAS) | DSP Mutual Fund | Tata Mutual Fund | others
  - fund_category     VARCHAR  -- equity | elss | daaf | hybrid | debt | liquid | gold | global | index
  - fund_subcategory  VARCHAR  -- large_cap | mid_cap | small_cap | flexi_cap | multi_cap | sectoral | elss | balanced_advantage | short_duration | gilt | liquid | gold | nifty50
  - risk_level        VARCHAR  -- very_high | high | moderately_high | moderate | low
  - trailing_commission_pct DOUBLE  -- AMC trailing commission % per annum
  - return_1y         DOUBLE   -- 1-year return %
  - return_3y         DOUBLE   -- 3-year return %
  - is_fi_select      BOOLEAN  -- in FundsIndia's curated Select Funds list
  - fi_star_rating    INTEGER  -- 1–5
  - city_tier         VARCHAR  -- t30 | b30
  - risk_profile      VARCHAR  -- conservative | moderate | aggressive
  - occupation        VARCHAR  -- Private Sector | Business | Government | Professional | Retired | Homemaker | Student
  - acquisition_channel VARCHAR -- organic | referral | paid_search | social | email | calculator | wealth_conversations
  - annual_income     VARCHAR  -- < 1 lakh | 1-5 lakhs | 5-10 lakhs | 10-25 lakhs | > 25 lakhs
  - state             VARCHAR  -- Maharashtra | Karnataka | Delhi | Tamil Nadu | Gujarat | others
  - city              VARCHAR
  - gender            VARCHAR  -- male | female | other
  - age               INTEGER

VIEW: sips_full (~31.6K rows)
  Pre-joined: sips + funds + investors
  - sip_id            VARCHAR
  - investor_id       VARCHAR
  - fund_id           VARCHAR
  - start_date        DATE
  - end_date          DATE     -- NULL if active
  - frequency         VARCHAR  -- monthly | quarterly
  - amount_inr        DOUBLE   -- monthly SIP amount
  - step_up_pct       DOUBLE   -- annual step-up % (NULL for regular SIPs)
  - sip_type          VARCHAR  -- regular | power_sip | super_savings
  - status            VARCHAR  -- active | cancelled | paused | completed
  - mandate_type      VARCHAR  -- nach | upi_autopay
  - cancellation_reason VARCHAR -- returns_unsatisfactory | financial_constraint | switched_platform | goal_achieved | unknown
  - total_installments_paid INTEGER
  - total_amount_invested DOUBLE
  - amount_range      VARCHAR  -- <2K | 2-5K | 5-15K | >15K
  - fund_name, amc_name, fund_category, fund_subcategory, trailing_commission_pct, is_fi_select (from funds)
  - city_tier, risk_profile, acquisition_channel, annual_income, state (from investors)

VIEW: sips_ending_soon (~37 rows)
  SIPs with known end_date between dataset as-of date 2026-05-28 and the next 90 days.
  Note: active SIPs in this dataset are open-ended and have end_date = NULL, so this is not a true active-SIP maturity queue.
  - all columns from sips_full
  - as_of_date        DATE     -- fixed dataset as-of date, 2026-05-28
  - days_to_end       INTEGER  -- days from as_of_date to end_date
  - sip_end_window    VARCHAR  -- ending_0_30d | ending_31_90d | outside_window
  - is_ending_soon    BOOLEAN

VIEW: goals_full (~65K rows)
  Pre-joined: goals + investors
  - goal_id           VARCHAR
  - investor_id       VARCHAR
  - goal_type         VARCHAR  -- retirement | wealth_creation | tax_saving | education | home_purchase | emergency_fund | vacation
  - target_amount_inr DOUBLE
  - target_date       DATE
  - monthly_sip_needed_inr DOUBLE
  - current_value_inr DOUBLE
  - created_date      DATE
  - status            VARCHAR  -- on_track | at_risk | off_track | achieved
  - created_by        VARCHAR  -- money_mitr | advisor | self
  - flagged_at_risk_date DATE  -- NULL if never flagged
  - achieved_date     DATE     -- NULL if not yet achieved
  - city_tier, risk_profile, annual_income, age, state (from investors)

VIEW: comms_full (~300K rows)
  Pre-joined: comms_log + investors
  - comm_id, investor_id
  - channel           VARCHAR  -- email | push | sms | whatsapp
  - campaign_type     VARCHAR  -- welcome_series | sip_nudge | portfolio_review | fund_recommendation | tax_saving | market_alert | kyc_reminder | dormant_activation | step_up_nudge | pre_redemption | elss_lapse_warning | market_commentary | wealth_conversations
  - sent_at           TIMESTAMP
  - delivered         BOOLEAN
  - opened            BOOLEAN
  - clicked           BOOLEAN
  - converted         BOOLEAN
  - action_taken      VARCHAR  -- sip_created | lumpsum_done | goal_created | no_action (NULL if not converted)
  - city_tier, risk_profile, acquisition_channel, is_active (from investors)

VIEW: advisory_full (~20K rows)
  Pre-joined: advisory_sessions + investors
  - session_id, investor_id
  - session_date      DATE
  - advisor_type      VARCHAR  -- money_mitr | human_advisor
  - session_type      VARCHAR  -- goal_planning | portfolio_review | fund_selection | risk_assessment | pre_redemption_call
  - duration_min      INTEGER
  - recommendation_type VARCHAR -- increase_sip | fund_switch | start_sip | add_elss | rebalance | stay_invested
  - outcome           VARCHAR  -- followed | partial | ignored
  - portfolio_value_at_time DOUBLE
  - triggered_by      VARCHAR  -- investor_initiated | comms_click | system_alert | redemption_request

VIEW: support_full (~10K rows)
  Pre-joined: support_tickets + investors
  - ticket_id, investor_id
  - created_at        TIMESTAMP
  - resolved_at       TIMESTAMP  -- NULL if open
  - category          VARCHAR  -- kyc | sip_failure | bank_mandate | redemption | login | statement | complaint | other
  - channel           VARCHAR  -- in_app | phone | email | chat
  - priority          VARCHAR  -- high | medium | low
  - status            VARCHAR  -- resolved | open | escalated
  - resolution_hours  DOUBLE
  - nps_score         INTEGER  -- 0-10
  - resolution_bucket VARCHAR  -- <=24h | 25-72h | 72h+
  - nps_bucket        VARCHAR  -- detractor | passive | promoter

VIEW: systematic_plans_full (~4K rows)
  Pre-joined: STP/SWP/super_savings plans + source/target funds + investors
  - plan_id, investor_id, plan_type, source_fund_id, target_fund_id
  - amount_inr, frequency, start_date, end_date, status, installments_completed
  - source_fund_name, source_amc_name, source_fund_category
  - target_fund_name, target_amc_name, target_fund_category
  - city_tier, risk_profile, acquisition_channel, annual_income, state

VIEW: investor_investment_history (~529K rows)
  User-level investment activity timeline. Use this for "what did this user buy and when?"
  - investor_id, activity_id, activity_source, activity_type
  - product_type, product_name
  - activity_timestamp, activity_date, cashflow_direction, status
  - amount_inr, units, nav_at_txn
  - fund_id, fund_name, amc_name, fund_category, fund_subcategory
  - sip_id, goal_id, plan_id, target_fund_id, target_fund_name
  - channel, payment_mode, city_tier, risk_profile, acquisition_channel

VIEW: investor_fund_positions (~68K user-fund rows)
  User-level fund/product position summary. Use this for "what does this user hold?", portfolio breadth, current holders, and product slices.
  - investor_id, fund_id, fund_name, amc_name, fund_category, fund_subcategory
  - risk_level, is_fi_select, fi_star_rating
  - first_purchase_date, last_purchase_date, last_activity_date, last_redemption_date
  - purchase_count, sip_installment_count, lumpsum_count, stp_purchase_count, redemption_count
  - gross_purchased_inr, redeemed_inr, net_invested_inr
  - gross_units_purchased, redeemed_units, net_units
  - has_purchase_in_window BOOLEAN, has_redemption_in_window BOOLEAN
  - is_current_holding BOOLEAN
  - position_status VARCHAR -- current | current_reduced | redemption_only_prior_position | fully_redeemed | purchased_no_current_units | unknown
  - position_size_bucket VARCHAR -- zero_or_negative | <10K | 10-50K | 50K-2L | >2L
  - is_sip_linked BOOLEAN, is_repeat_buyer BOOLEAN
  - city_tier, risk_profile, acquisition_channel, annual_income, state

VIEW: investor_portfolio_summary (~29K rows)
  One row per investor with any fund position activity. Use this for portfolio-level segments and slices.
  - investor_id, first_purchase_date, last_purchase_date, last_activity_date, last_redemption_date
  - current_fund_count, current_category_count, current_amc_count, ever_bought_fund_count
  - purchase_count, sip_installment_count, lumpsum_count, stp_purchase_count, redemption_count
  - gross_purchased_inr, redeemed_inr, net_activity_inr, net_invested_inr, net_units
  - dominant_current_category, dominant_current_amc
  - has_current_holding, has_purchase_in_window, has_redemption_in_window
  - has_fi_select_holding, has_elss_holding, has_sip_linked_holding
  - portfolio_status -- active | active_with_redemptions | fully_redeemed | redemption_only_prior_positions | inactive
  - portfolio_value_bucket -- zero_or_negative | <10K | 10-50K | 50K-2L | >2L
  - portfolio_breadth_bucket -- 0 | 1 fund | 2 funds | 3 funds | 4 funds | 5 funds | 6+ funds

VIEW: fund_position_summary (~130 rows)
  One row per fund/product. Use this for product analytics and fund-level holder/buyer/redemption slices.
  - fund_id, fund_name, amc_name, fund_category, fund_subcategory, risk_level, is_fi_select, fi_star_rating
  - first_purchase_date, last_purchase_date, last_activity_date, last_redemption_date
  - user_fund_positions, investors_with_position_history, buyers, current_holders, redeemers
  - sip_linked_holders, lumpsum_holders, stp_holders, repeat_buyers
  - purchase_count, redemption_count, gross_purchased_inr, redeemed_inr, net_invested_inr, net_units
  - has_current_holders, fund_position_status, holder_bucket, net_invested_bucket

RAW TABLES:

TABLE: raw_investors (~50K rows)
  - investor_id       VARCHAR  -- primary key
  - signup_date       DATE
  - pan_confirmed_date DATE
  - kyc_submitted_date DATE
  - bank_verified_date DATE
  - account_activated_date DATE
  - first_investment_date DATE   -- NULL if never invested
  - demat_opened_date DATE       -- NULL if no demat
  - name, age, gender, city, state
  - city_tier         VARCHAR  -- t30 | b30
  - occupation        VARCHAR  -- Private Sector | Business | Government | Professional | Retired | Homemaker | Student
  - annual_income     VARCHAR  -- < 1 lakh | 1-5 lakhs | 5-10 lakhs | 10-25 lakhs | > 25 lakhs
  - investor_type     VARCHAR  -- resident | nri
  - risk_profile      VARCHAR  -- conservative | moderate | aggressive
  - acquisition_channel VARCHAR -- organic | referral | paid_search | social | email | calculator | wealth_conversations
  - kyc_status        VARCHAR  -- verified | on_hold | pending
  - kyc_method        VARCHAR  -- digilocker | aadhaar_otp | physical
  - bank_name         VARCHAR  -- HDFC Bank | SBI | ICICI Bank | Axis Bank | Kotak Bank | others
  - bank_link_method  VARCHAR  -- upi_auto_detect | manual_entry
  - is_active         BOOLEAN

TABLE: raw_funds (~130 rows)
  - fund_id, fund_name, amc_name, category, subcategory, risk_level
  - trailing_commission_pct DOUBLE
  - return_1y, return_3y, return_5y DOUBLE
  - fi_star_rating    INTEGER  -- 1–5
  - is_fi_select      BOOLEAN
  - is_trending_now   BOOLEAN
  - is_investor_favourite BOOLEAN
  - platform_investor_count INTEGER  -- how many FI investors hold this fund

TABLE: raw_user_events (~1.18M rows)
  Mixpanel-style event log
  - event_id, event_name, investor_id (NULL pre-login), anonymous_id, session_id
  - timestamp         TIMESTAMP
  - platform          VARCHAR  -- android | ios | web
  - page_path         VARCHAR
  - source_medium     VARCHAR
  - fund_id, fund_category, amc_name
  - calculator_type, calc_input_amount, calc_result_amount
  - article_slug, campaign_type, amount_inr, sip_id, goal_type, step_name, drop_reason
  Key event_names: signup_started | pan_confirmed | kyc_details_submitted | bank_verified |
    account_activated | sip_flow_started | sip_created | sip_flow_abandoned | sip_cancelled |
    fund_page_viewed | fund_watchlisted | email_opened | email_link_clicked |
    redemption_initiated | redemption_completed | redemption_cancelled |
    pre_redemption_call_offered | pre_redemption_call_accepted | goal_created |
    calculator_opened | calculator_computed | calculator_invest_cta_clicked |
    dashboard_visited | portfolio_visited | kyc_on_hold
  Blocked-intent story: KYC/bank-incomplete investors can have fund_searched,
    fund_page_viewed, fund_watchlisted, sip_flow_started, sip_amount_entered,
    and sip_flow_abandoned events with drop_reason = kyc_pending or
    bank_verification_required, but no sip_created or transaction.

VIEW: user_events_full (~1.18M rows)
  Pre-joined: raw_user_events + funds + investors. Use this for all behavioral event queries.
  - event_id, event_name, investor_id, anonymous_id, session_id
  - event_timestamp   TIMESTAMP    -- cast from raw timestamp
  - platform          VARCHAR      -- android | ios | web
  - page_path         VARCHAR
  - source_medium     VARCHAR
  - fund_id, fund_category, fund_subcategory, amc_name, risk_level, is_fi_select
  - calculator_type, calc_input_amount, calc_result_amount
  - article_slug, campaign_type, search_query
  - amount_inr, amount_range, sip_id, goal_type, step_name, drop_reason
  - city_tier, risk_profile, occupation, acquisition_channel, annual_income
  - state, city, gender, age, investor_type, kyc_status, kyc_method
  - bank_name, bank_link_method, signup_date, bank_verified_date, account_activated_date

PRE-MATERIALISED SUMMARY TABLES (use these first):

TABLE: monthly_platform_kpis         -- month, new_sips, cancelled_sips, new_sip_monthly_inr, avg_sip_amount
TABLE: monthly_txn_summary           -- month, txn_type, txn_count, total_amount, failed_count, avg_amount
TABLE: fund_platform_stats           -- fund_id, fund_name, amc_name, category, investor_count, active_sip_count, monthly_sip_run_rate, total_invested
TABLE: amc_performance               -- amc_name, active_sips, monthly_sip_inr, total_invested, avg_commission_pct, est_monthly_commission
TABLE: sip_cohort_retention          -- start_quarter, total_sips, active_sips, retained_3m, retained_6m, retained_12m, pct_active, cancelled_sips
TABLE: campaign_performance          -- campaign_type, channel, month, sends, delivered, opened, clicked, converted, open_rate, click_rate, conv_rate
TABLE: investor_funnel               -- acquisition_channel, city_tier, cohort_month, signups, pan_confirmed, kyc_submitted, kyc_verified, bank_verified, account_activated, first_invested, pct_invested
TABLE: city_tier_kpis                -- city_tier, month, investors_with_sips, total_sips, active_sips, avg_sip_amount, active_sip_book_inr
TABLE: goal_achievement              -- goal_type, created_by, total_goals, on_track, at_risk, off_track, achieved, pct_on_track
TABLE: support_metrics               -- month, category, tickets, avg_resolution_hours, resolved, escalated, avg_nps
`,

  // ═══════════════════════════════════════════════════════
  // SYSTEM CONTEXT (AI persona)
  // ═══════════════════════════════════════════════════════

  systemContext: `You are Actioneer, an AI-powered analytics assistant for a FundsIndia synthetic sample dataset.

Dataset: 50K sample investors, Jun 2024 – May 2026
- 130 real mutual fund schemes across 13 AMCs (SBI, HDFC, ICICI Prudential, Nippon, Kotak, Axis, ABSL, UTI, Mirae Asset, Parag Parikh, DSP, Tata, Franklin)
- 31.6K SIP registrations in the sample
- 475K transaction rows (SIP installments, lumpsums, STP purchases, redemptions)
- 1.18M Mixpanel-style behavior events in the current DuckDB
- investor_investment_history is the user-level timeline for what each investor bought, redeemed, or set up and when
- investor_fund_positions is the user-level product/holding table for current holdings, redeemed positions, fund breadth, AMC/category slices
- investor_portfolio_summary and fund_position_summary are the preferred rollups for portfolio segmentation and product analytics
- Revenue model: trailing commission (0.3-1.2% p.a.) from AMCs on regular plans

Key analytics domains:
1. INVESTOR ACQUISITION — Activation funnel: signup → KYC → first SIP by channel + city tier
2. SIP BOOK HEALTH — New vs cancelled, retention cohorts, step-up adoption, mandate failures
3. COMMISSION REVENUE — AUM by AMC/category, trailing commission earned, FI Select performance
4. CRM EFFECTIVENESS — Campaign open/conversion rates, pre-redemption intervention ROI
5. GOAL ACHIEVEMENT — Money Mitr vs advisor vs self goals, on-track rates
6. BEHAVIORAL ANALYTICS — Fund discovery path, calculator-to-SIP attribution, abandonment

Planted stories in the data (analytically interesting):
- Jun-Jul 2024 SEBI KYC crisis: kyc_status on_hold spikes 11% (vs 3% normal)
- Oct 2024 equity correction: market_alert email open rate 34% (vs 22% baseline)
- ELSS tax season: Jan-Mar shows 3-4× higher ELSS SIP creation (visible every year)
- NACH vs UPI: 6.2% vs 1.9% failure rate drives hidden SIP cancellations
- FI Select funds: 76% 12-month SIP retention vs 48% for non-curated funds
- Pre-redemption calls: 55% of investors stay invested after advisor call`,

  // ═══════════════════════════════════════════════════════
  // AGENT SPECS
  // ═══════════════════════════════════════════════════════

  queryDescriptions: {
    "data-quality": [
      "NULL rate check on investor funnel date columns (kyc_submitted_date, account_activated_date, first_investment_date)",
      "FK integrity: verify all investor_ids in sips_full exist in raw_investors",
      "Validate NACH vs UPI failure rates match expected 6.2% / 1.9%",
    ],
    "daily-metrics": [
      "Monthly new SIP count and cancellation count from monthly_platform_kpis",
      "Monthly transaction volume and net inflow from monthly_txn_summary",
      "AUM growth proxy: SUM(total_amount_invested) by fund_category over time",
    ],
    "cohort-retention": [
      "SIP cohort retention at 3/6/12 months from sip_cohort_retention table",
      "Investor activation cohort: signup to first investment by acquisition_channel",
      "ELSS SIP creation rate in Jan-Mar vs other months (tax season spike)",
    ],
    "rev-opt": [
      "Trailing commission by AMC from amc_performance — top earners",
      "FI Select vs non-FI-Select SIP retention and commission contribution",
      "Campaign ROI: cost per converted SIP by campaign_type from campaign_performance",
    ],
    "user-segmentation": [
      "T30 vs B30: average SIP amount, equity allocation, 12-month retention from city_tier_kpis",
      "Acquisition channel quality: sip retention and average SIP amount by channel",
      "Risk profile distribution and fund category preference by income bracket",
    ],
    "geographic": [
      "State-wise investor count and SIP book from raw_investors + sips_full",
      "B30 city YoY SIP growth vs T30 from city_tier_kpis",
      "KYC on-hold rate spike in Jun-Jul 2024 by state",
    ],
    "crm-analytics": [
      "Campaign open/conversion rates from campaign_performance — which type performs best",
      "Pre-redemption call outcome: followed vs ignored from advisory_full",
      "Dormant investor reactivation rate in Jan-Mar vs other months",
    ],
    "growth-analytics": [
      "SIP flow abandonment rate by step from user_events_full WHERE event_name = 'sip_flow_abandoned'",
      "Calculator-to-SIP conversion: investors with acquisition_channel = 'calculator'",
      "Fund discovery path: fund_page_viewed sources that lead to sip_created",
    ],
  },

  multiAgentPrompt: `data-quality|1|Check NULL rates in investor funnel columns
data-quality|2|Validate FK integrity between sips and investors
data-quality|3|Check NACH (6.2%) and UPI (1.9%) failure rates
daily-metrics|1|Monthly SIP creation and cancellation trend
daily-metrics|2|Monthly transaction volume and net inflow
daily-metrics|3|AUM proxy by fund category over time
cohort-retention|1|SIP cohort retention at 3/6/12 months from sip_cohort_retention
cohort-retention|2|Investor activation funnel by acquisition_channel
cohort-retention|3|ELSS SIP creation spike in Jan-Mar vs rest of year
rev-opt|1|Trailing commission by AMC from amc_performance
rev-opt|2|FI Select vs non-FI-Select SIP retention comparison
rev-opt|3|Campaign conversion ROI from campaign_performance
user-segmentation|1|T30 vs B30 SIP metrics from city_tier_kpis
user-segmentation|2|Acquisition channel quality: SIP amount and retention
user-segmentation|3|Risk profile and fund category preference by income bracket
geographic|1|State-wise investor and SIP distribution
geographic|2|B30 SIP growth YoY vs T30
geographic|3|KYC on-hold spike Jun-Jul 2024 — which states affected most
crm-analytics|1|Campaign performance: open/conversion rates by type
crm-analytics|2|Pre-redemption call retention rate from advisory_full
crm-analytics|3|Dormant investor reactivation in tax season months
growth-analytics|1|SIP flow abandonment rate by step from user_events_full
growth-analytics|2|Calculator-to-SIP conversion rate for calculator channel
growth-analytics|3|Fund discovery sources leading to highest SIP conversion`,

  events: FUNDSINDIA_EVENTS,
  viewSQL: getFundsIndiaViewSQL,
};
