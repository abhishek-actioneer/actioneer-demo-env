import type { DatasetConfig } from "./types";
import type { EventDefinition } from "../explorer-types";

// Curated event catalog for the analytics explorer. Columns verified against the
// YesBank_Cards_Demo data dictionary.
const TXN_PROPS: EventDefinition["properties"] = [
  { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
  { column: "txn_type", displayName: "Transaction Type", type: "string", cardinalityHint: "low" },
  { column: "mcc", displayName: "MCC", type: "number", cardinalityHint: "high" },
  { column: "txn_city", displayName: "Transaction City", type: "string", cardinalityHint: "high" },
  { column: "txn_country", displayName: "Transaction Country", type: "string", cardinalityHint: "low" },
];
const CAMPAIGN_PROPS: EventDefinition["properties"] = [
  { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
  { column: "outcome", displayName: "Outcome", type: "string", cardinalityHint: "low" },
  { column: "offer_id", displayName: "Offer", type: "string", cardinalityHint: "medium" },
];
const LIFECYCLE_PROPS: EventDefinition["properties"] = [
  { column: "event_type", displayName: "Event Type", type: "string", cardinalityHint: "low" },
  { column: "reason", displayName: "Reason", type: "string", cardinalityHint: "low" },
  { column: "initiated_by", displayName: "Initiated By", type: "string", cardinalityHint: "low" },
];
const HOLDINGS_PROPS: EventDefinition["properties"] = [
  { column: "product_type", displayName: "Product Type", type: "string", cardinalityHint: "low" },
  { column: "value_band", displayName: "Value Band", type: "string", cardinalityHint: "low" },
  { column: "status", displayName: "Status", type: "string", cardinalityHint: "low" },
];
const PROPENSITY_PROPS: EventDefinition["properties"] = [
  { column: "event_type", displayName: "Signal Type", type: "string", cardinalityHint: "low" },
];
const SERVICE_PROPS: EventDefinition["properties"] = [
  { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
  { column: "category", displayName: "Category", type: "string", cardinalityHint: "low" },
];
const YESBANK_EVENTS: EventDefinition[] = [
  // Transactions
  { id: "purchase", displayName: "Purchase", category: "Spend", table: "transactions", filterColumn: "txn_type", filterValue: "PURCHASE", valueColumn: "amount_inr", dateColumn: "txn_ts", properties: TXN_PROPS },
  { id: "upi_txn", displayName: "UPI Transaction", category: "Spend", table: "transactions", filterColumn: "channel", filterValue: "UPI", valueColumn: "amount_inr", dateColumn: "txn_ts", properties: TXN_PROPS },
  { id: "intl_txn", displayName: "International Transaction", category: "Spend", table: "transactions", filterColumn: "is_intl_flag", filterValue: "true", valueColumn: "amount_inr", dateColumn: "txn_ts", properties: TXN_PROPS },
  { id: "emi_conversion", displayName: "EMI Conversion", category: "Spend", table: "transactions", filterColumn: "emi_converted_flag", filterValue: "true", valueColumn: "amount_inr", dateColumn: "txn_ts", properties: TXN_PROPS },
  // Campaign funnel
  { id: "campaign_sent", displayName: "Campaign Sent", category: "Campaigns", table: "campaign_history", dateColumn: "sent_ts", properties: CAMPAIGN_PROPS },
  { id: "campaign_delivered", displayName: "Campaign Delivered", category: "Campaigns", table: "campaign_history", dateColumn: "delivered_ts", properties: CAMPAIGN_PROPS },
  { id: "campaign_opened", displayName: "Campaign Opened", category: "Campaigns", table: "campaign_history", dateColumn: "opened_ts", properties: CAMPAIGN_PROPS },
  { id: "campaign_clicked", displayName: "Campaign Clicked", category: "Campaigns", table: "campaign_history", dateColumn: "clicked_ts", properties: CAMPAIGN_PROPS },
  { id: "campaign_converted", displayName: "Campaign Converted", category: "Campaigns", table: "campaign_history", filterColumn: "outcome", filterValue: "CONVERTED", valueColumn: "conversion_value_inr", dateColumn: "outcome_ts", properties: CAMPAIGN_PROPS },
  { id: "campaign_opted_out", displayName: "Opted Out", category: "Campaigns", table: "campaign_history", filterColumn: "outcome", filterValue: "OPTED_OUT", dateColumn: "outcome_ts", properties: CAMPAIGN_PROPS },
  // Card lifecycle
  { id: "card_issued", displayName: "Card Issued", category: "Card Lifecycle", table: "card_lifecycle_events", filterColumn: "event_type", filterValue: "ISSUED", dateColumn: "event_ts", properties: LIFECYCLE_PROPS },
  { id: "card_activated", displayName: "Card Activated", category: "Card Lifecycle", table: "card_lifecycle_events", filterColumn: "event_type", filterValue: "ACTIVATED", dateColumn: "event_ts", properties: LIFECYCLE_PROPS },
  { id: "card_upgraded", displayName: "Card Upgraded", category: "Card Lifecycle", table: "card_lifecycle_events", filterColumn: "event_type", filterValue: "UPGRADED_TO", dateColumn: "event_ts", properties: LIFECYCLE_PROPS },
  { id: "card_closed", displayName: "Card Closed", category: "Card Lifecycle", table: "card_lifecycle_events", filterColumn: "event_type", filterValue: "CLOSED", dateColumn: "event_ts", properties: LIFECYCLE_PROPS },
  // Cross-sell & propensity
  { id: "cross_sell_opened", displayName: "Cross-sell Product Opened", category: "Cross-sell", table: "product_holdings", dateColumn: "opened_date", properties: HOLDINGS_PROPS },
  { id: "propensity_signal", displayName: "Propensity Signal", category: "Propensity", table: "propensity_events", dateColumn: "event_ts", properties: PROPENSITY_PROPS },
  // Service
  { id: "spam_complaint", displayName: "Offer Spam Complaint", category: "Customer Impact", table: "service_tickets", filterColumn: "category", filterValue: "OFFER_SPAM_COMPLAINT", dateColumn: "opened_ts", properties: SERVICE_PROPS },
];

/**
 * YES Bank Credit Cards — credit-card growth, cross-sell, and lifecycle demo dataset.
 *
 * Source data is generated by ~/projects/actioneer-demo-data (YesBank_Cards_Demo)
 * and copied to data/csv/yesbank-cards/ (gitignored, local-only). The dataset
 * powers both the analytics chat and Vimarsh's voice KYC / cross-sell flows,
 * which query this dataset by the id "yesbank-cards".
 */

const CSV_TABLES = [
  "customers",
  "cards",
  "merchants",
  "card_lifecycle_events",
  "product_holdings",
  "offers_catalog",
  "propensity_events",
  "service_tickets",
  "calendar_events",
  "hero_case_index",
  "product_economics",
  "benchmarks",
  "cibil_risk_reference",
  "rewards_summary",
  "collections",
];

// Large / hot-join tables are materialized (real tables) instead of CSV views,
// so they get a raw_ view here and a real table in summaryTableSQL.
// campaign_history is the central marketing-funnel fact table.
const RAW_MATERIALIZED = ["transactions", "statements", "campaign_history"];

export const yesbankCardsDataset: DatasetConfig = {
  id: "yesbank-cards",
  label: "Credit Cards",
  companyName: "YES Bank",
  dbFile: "data/yesbank-cards.duckdb",
  sourceType: "csv",
  primaryTable: "transactions",
  userIdField: "customer_id",
  dateField: "txn_ts",
  dateRange: { start: "2024-06-01", end: "2026-05-31" },
  currency: "₹",
  entityName: "customers",
  reportMeta: {
    totalEvents: "13.5L transactions · 53K campaign contacts",
    totalUsers: "4,000 customers · 4,000+ cards",
    dateRangeLabel: "Jun 2024 – May 2026",
    dbName: "yesbank-cards.duckdb",
  },
  welcomeSubtitle:
    "Ask about campaign effectiveness, cross-sell, upgrades, rewards, spend, and lifecycle across the credit-card portfolio.",
  suggestedPrompts: [
    "What is our campaign conversion rate by channel, and what does each acquisition cost?",
    "How much spend lift do cardholders show in the three months after an upgrade?",
    "Which propensity signals convert best into cross-sell or upgrades?",
    "What share of statements revolve, and how much interest and fee income do we earn?",
    "Where is the whitespace: cardholders with no other YES Bank products?",
    "How are rewards points piling up, and how much value is expiring in 90 days?",
  ],
  systemContext: `You are Actioneer, an AI-powered analytics assistant for the credit-card growth and portfolio team at YES Bank.

Dataset: ~1.35 million card transactions over two years (Jun 2024 – May 2026) across 4,000 customers and 4,000+ cards, plus a full marketing funnel: campaign contact → delivery → open/click → conversion → fulfilment → first use, with propensity signals, rewards, cross-sell holdings, and collections.

You cover these analytics domains:
1. CAMPAIGN EFFECTIVENESS — conversion by channel/offer, cost per acquisition, delivery and open/click rates, opt-outs and suppression.
2. CROSS-SELL & UPGRADES — propensity signals, offer targeting, product holdings (whitespace), upgrade ladders and post-upgrade spend lift.
3. SPEND & ENGAGEMENT — spend per active card by CIBIL band and income band, UPI-on-credit adoption, category mix, festive/seasonal effects.
4. REVENUE & ECONOMICS — interest/fee income, forex markup, surcharge, interchange, net revenue per active card.
5. REWARDS — points earned/redeemed, redemption rate, expiring points, subscription-plan ROI.
6. RISK & COLLECTIONS — revolve and DPD buckets, CIBIL bands, delinquency, recovery.

Conversion is real money — keep recommendations grounded in the customer's own transaction history.`,
  schemaContext: `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect). Currency is INR (₹).

═══ CORE TABLES ═══

TABLE: transactions (~1.35M rows) — one row per card transaction
  - txn_id, card_id (FK cards), merchant_id (FK merchants), txn_ts (TIMESTAMP, IST)
  - amount_inr (DOUBLE), currency, fx_amount, mcc, channel (POS|ECOM|UPI|INTL_ECOM|INTL_POS|ATM_CASH_AD|CONTACTLESS)
  - pos_entry_mode, auth_method, txn_type (PURCHASE|REFUND|REVERSAL|FEE|EMI_CONVERSION|AUTOPAY), response (APPROVED|DECLINED), decline_reason
  - emi_converted_flag, emi_tenure_months, is_intl_flag, forex_markup_paid_inr, surcharge_levied_inr (only on/after 15 Jan 2026), original_txn_id

TABLE: campaign_history (~53K rows) — one row per campaign contact (the marketing funnel)
  - campaign_id, offer_id (FK offers_catalog), customer_id, card_id, channel (RM_CALL|IVR|SMS|EMAIL|APP_PUSH), contact_cost_inr
  - created_ts, sent_ts, delivered_ts, opened_ts, clicked_ts, outcome (CONVERTED|CLICKED_NO_CONVERT|IGNORED|OPTED_OUT), outcome_ts
  - application_ts, approved_ts, fulfilled_ts, first_use_ts, conversion_value_inr

TABLE: customers (4,000 rows) — customer_id, full_name, gender, age, city, state, kyc_status (VERIFIED|RE_KYC_DUE), cibil_band (650-699|700-749|750-799|800+), employment_type, monthly_income_band (25K-50K|50K-1L|1L-2L|2L-4L|4L+), tenure_months, salary_account_with_yes_flag, rm_assigned_flag, email_opt_in_flag, sms_opt_in_flag, push_opt_in_flag, dnd_flag (hard suppression). NOTE: there is NO "segment" column — segment customers by cibil_band, monthly_income_band, employment_type, or tenure.
TABLE: cards (4,000+ rows) — card_id, customer_id, masked_pan, network, product (YES PREMIA|YES ELITE|ELITE+|RESERV|MARQUEE|Select|Klick|POP-CLUB|BankBazaar FinBooster), tier, annual_fee, fee_waived_flag, credit_limit_current, issue_date, rewards_subscription_plan (NONE|3X|5X), upi_linked_flag, status (ACTIVE|DORMANT|CLOSED), legacy_migration_pending_flag, closure_reason
TABLE: merchants — merchant_id, merchant_name, mcc, mcc_description, category, city, country, channel, risk_tier

═══ GROWTH / LIFECYCLE TABLES ═══

TABLE: offers_catalog — offer_id, offer_name, offer_type (CARD_UPGRADE|CROSS_SELL_CARD|LIMIT_ENHANCEMENT|REWARDS_SUBSCRIPTION_UPSELL|FD|INSURANCE_ATTACH|PERSONAL_LOAN_PREAPPROVED|EMI_CONVERSION|FOREX_REPOSITIONING|WINBACK), source_product, target_product, eligibility_rule_text, expected_value_inr, validity_window
TABLE: propensity_events — event_id, customer_id, card_id, event_ts, event_type (SPEND_TRAJECTORY_CROSS|DORMANCY_ONSET|EMI_ELIGIBLE_BIGTICKET|FIRST_INTL_TXN|RENT_PAYMENT_ONSET|SALARY_JUMP_DETECTED|TRAVEL_BOOKING_CLUSTER|UTILITY_SURCHARGE_HIT|MILESTONE_SPEND|LIFE_EVENT_WEDDING_PATTERN), supporting_txn_ids (pipe-separated), detail_json
TABLE: product_holdings — holding_id, customer_id, product_type (SAVINGS|SALARY_ACCT|FD|RD|DEMAT|PERSONAL_LOAN|INSURANCE_LIFE|INSURANCE_HEALTH), opened_date, value_band, status, source_campaign_id (cross-sell attribution)
TABLE: rewards_summary — card_id, customer_id, product, reward_plan, points_earned_lifetime, points_redeemed_lifetime, points_balance, points_expiring_90d, reward_value_inr, redemption_rate_pct
TABLE: card_lifecycle_events — event_id, card_id, event_ts, event_type (ISSUED|ACTIVATED|UPGRADED_TO|LIMIT_INCREASED|REWARDS_PLAN_CHANGED|CLOSED), old_value, new_value, linked_card_id, reason
TABLE: statements — statement_id, card_id, cycle_start, cycle_end, due_date, total_spend_inr, payments_received_inr, revolve_flag, interest_charged_inr, fees_inr, closing_balance_inr, utilization_pct, dpd_bucket
TABLE: service_tickets — ticket_id, customer_id, opened_ts, channel, category (OFFER_SPAM_COMPLAINT|SURCHARGE_COMPLAINT|FEE_DISPUTE|REWARDS_ISSUE|CARD_DELIVERY|OTHER), linked_campaign_id, resolved_ts, csat_1_5
TABLE: collections — card_id, customer_id, cibil_band, worst_dpd_bucket, collection_stage, months_delinquent, outstanding_inr, promise_to_pay_flag, amount_recovered_inr, recovery_rate_pct, status

═══ REFERENCE TABLES ═══

TABLE: product_economics — product, tier, annual_fee_inr, interchange_pct, forex_markup_pct, reward_cost_pct, avg_net_revenue_per_active_card_inr, upgrade_target_product, fee_waivable_flag
TABLE: cibil_risk_reference — cibil_band, risk_grade, approval_odds_pct, expected_annual_loss_rate_pct, avg_limit_enhancement_eligibility_pct
TABLE: hero_case_index — hero_id (Y1-Y12), title, customer_id, card_id, campaign_ids, key_txn_ids, narrative — curated walkthrough stories
TABLE: benchmarks — metric, your_value, industry_median, better_direction
TABLE: calendar_events — event_name, start_date, end_date, overall_multiplier, category_effects

═══ KEY JOINS ═══
  campaign_history.customer_id = customers.customer_id ; campaign_history.offer_id = offers_catalog.offer_id
  transactions.card_id = cards.card_id ; cards.customer_id = customers.customer_id
  transactions.merchant_id = merchants.merchant_id
  product_holdings.source_campaign_id = campaign_history.campaign_id (cross-sell attribution)
  propensity_events.customer_id = customers.customer_id

NOTES:
  - Campaign conversion = campaign_history.outcome = 'CONVERTED' / contacts. CPA = SUM(contact_cost_inr) / conversions.
  - Suppression: never contact customers with dnd_flag = true or who OPTED_OUT; respect the relevant channel opt-in flag.
  - Post-upgrade spend lift: compare per-card monthly spend before vs after card_lifecycle_events.event_type = 'UPGRADED_TO'.
  - Whitespace: customers whose only product_holdings is the card (no SAVINGS/FD/etc.).
  - Surcharge only appears on/after 15 Jan 2026 (transactions.surcharge_levied_inr).`,
  domainHints: `1. TIME: txn_ts is a TIMESTAMP in IST. Use strftime(txn_ts, '%Y-%m') for monthly trends.
2. CAMPAIGNS: outcome IN ('CONVERTED','CLICKED_NO_CONVERT','IGNORED','OPTED_OUT'); delivered_ts IS NOT NULL means delivered.
3. CPA: cost per acquisition = SUM(contact_cost_inr) / COUNT(*) FILTER (WHERE outcome = 'CONVERTED'), grouped by channel/offer.
4. SUPPRESSION: exclude dnd_flag = true and prior OPTED_OUT customers from any targeting.
5. SPEND LIFT: join transactions to card_lifecycle_events UPGRADED_TO; compare 3 months pre vs post by card.
6. AMOUNTS: monetary columns end in _inr (rupees). Revenue components: interest_charged_inr, fees_inr (statements), forex_markup_paid_inr, surcharge_levied_inr (transactions).
7. REWARDS: redemption_rate_pct = points_redeemed_lifetime / points_earned_lifetime; points_expiring_90d signals churn-of-value.`,
  summaryTableHint:
    "transactions and statements are materialized tables (fast). All other tables are views over CSV. Use campaign_history for the marketing funnel and propensity_events for targeting signals.",
  // `agents` drives deep-research SQL generation (takes priority over the legacy
  // multiAgentPrompt, which is only a fallback parse). queryDescriptions below is
  // still read live for deep-mode per-agent summary headers, so keep it in sync
  // with these agents' query descriptions.
  agents: [
    {
      id: "data-quality",
      queries: [
        { description: "Campaign volume, delivery rate, and conversion by channel and offer type", hint: "campaign_history: outcome='CONVERTED', delivered_ts IS NOT NULL; GROUP BY channel, offer_id" },
        { description: "Active vs dormant cards and spend per active card by CIBIL band", hint: "cards.status, statements.total_spend_inr; join customers for cibil_band" },
      ],
    },
    {
      id: "daily-metrics",
      queries: [
        { description: "Monthly conversions, CPA, and conversion value", hint: "campaign_history: COUNT FILTER (outcome='CONVERTED'), SUM(contact_cost_inr)/conversions; GROUP BY strftime(sent_ts,'%Y-%m')" },
        { description: "Revolve rate and interest/fee income from statements", hint: "statements: AVG(revolve_flag::INT), SUM(interest_charged_inr), SUM(fees_inr)" },
      ],
    },
    {
      id: "rev-opt",
      queries: [
        { description: "Post-upgrade spend lift and net revenue per active card", hint: "join transactions to card_lifecycle_events UPGRADED_TO; compare 3mo pre vs post by card" },
        { description: "Cross-sell whitespace and propensity-signal conversion", hint: "product_holdings whitespace (card-only customers); propensity_events.event_type -> conversion" },
      ],
    },
    {
      id: "user-segmentation",
      queries: [
        { description: "Customer cohorts by CIBIL band, income band, tenure, and product holdings", hint: "GROUP BY customers.cibil_band, monthly_income_band; count product_holdings" },
      ],
    },
  ],
  queryDescriptions: {
    "data-quality": [
      "Campaign volume, delivery rate, and conversion by channel and offer type",
      "Active vs dormant cards and spend per active card by CIBIL band",
    ],
    "daily-metrics": [
      "Monthly conversions, CPA, and conversion value from campaign_history",
      "Revolve rate and interest/fee income from statements",
    ],
    "rev-opt": [
      "Post-upgrade spend lift and net revenue per active card",
      "Cross-sell whitespace and propensity-signal conversion",
    ],
    "user-segmentation": [
      "Customer cohorts by CIBIL band, income, tenure, and product holdings",
    ],
  },
  multiAgentPrompt:
    "Analyze the YES Bank credit-card growth dataset. Cover campaign effectiveness (conversion, CPA, channels), cross-sell and upgrades (propensity signals, whitespace, spend lift), spend and engagement (UPI adoption, category mix), revenue economics (interest, fees, forex, interchange), rewards (redemption, expiry, plan ROI), and collections risk. Respect suppression rules and ground targeting in the customer's own transactions.",
  viewSQL: (dataDir: string) => {
    const csvDir = `${dataDir}/csv/yesbank-cards`;
    const views = CSV_TABLES.map(
      (t) =>
        `CREATE OR REPLACE VIEW ${t} AS SELECT * FROM read_csv('${csvDir}/${t}.csv', auto_detect=true, ignore_errors=true)`,
    );
    const rawViews = RAW_MATERIALIZED.map(
      (t) =>
        `CREATE OR REPLACE VIEW raw_${t} AS SELECT * FROM read_csv('${csvDir}/${t}.csv', auto_detect=true, ignore_errors=true)`,
    );
    return [...views, ...rawViews];
  },
  summaryTableSQL: [
    `CREATE OR REPLACE TABLE transactions AS SELECT * FROM raw_transactions`,
    `CREATE OR REPLACE TABLE statements AS SELECT * FROM raw_statements`,
    `CREATE OR REPLACE TABLE campaign_history AS SELECT * FROM raw_campaign_history`,
  ],
  setupVersion: "yesbank-cards-v2",
  events: YESBANK_EVENTS,
};
