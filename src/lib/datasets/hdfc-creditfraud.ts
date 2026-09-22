import type { DatasetConfig } from "./types";
import type { EventDefinition } from "../explorer-types";

// Curated event catalog for the analytics explorer. Columns verified against the
// HDFC_CreditFraud_Demo data dictionary.
const TXN_PROPS: EventDefinition["properties"] = [
  { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
  { column: "txn_type", displayName: "Transaction Type", type: "string", cardinalityHint: "low" },
  { column: "response", displayName: "Auth Response", type: "string", cardinalityHint: "low" },
  { column: "auth_method", displayName: "Auth Method", type: "string", cardinalityHint: "low" },
  { column: "mcc", displayName: "MCC", type: "number", cardinalityHint: "high" },
  { column: "txn_city", displayName: "Transaction City", type: "string", cardinalityHint: "high" },
  { column: "txn_country", displayName: "Transaction Country", type: "string", cardinalityHint: "low" },
];
const ALERT_PROPS: EventDefinition["properties"] = [
  { column: "severity", displayName: "Severity", type: "string", cardinalityHint: "low" },
  { column: "alert_channel", displayName: "Alert Channel", type: "string", cardinalityHint: "low" },
  { column: "customer_response", displayName: "Customer Response", type: "string", cardinalityHint: "low" },
  { column: "analyst_decision", displayName: "Analyst Decision", type: "string", cardinalityHint: "low" },
  { column: "disposition", displayName: "Disposition", type: "string", cardinalityHint: "low" },
  { column: "shift", displayName: "Shift", type: "string", cardinalityHint: "low" },
];
const LIFECYCLE_PROPS: EventDefinition["properties"] = [
  { column: "event_type", displayName: "Event Type", type: "string", cardinalityHint: "low" },
  { column: "reason", displayName: "Reason", type: "string", cardinalityHint: "low" },
  { column: "initiated_by", displayName: "Initiated By", type: "string", cardinalityHint: "low" },
];
const CASE_PROPS: EventDefinition["properties"] = [
  { column: "reporting_delay_bucket", displayName: "Reporting Delay", type: "string", cardinalityHint: "low" },
  { column: "liability_outcome", displayName: "Liability Outcome", type: "string", cardinalityHint: "low" },
  { column: "chargeback_status", displayName: "Chargeback Status", type: "string", cardinalityHint: "low" },
  { column: "final_status", displayName: "Final Status", type: "string", cardinalityHint: "low" },
];
const SERVICE_PROPS: EventDefinition["properties"] = [
  { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
  { column: "category", displayName: "Category", type: "string", cardinalityHint: "low" },
];
const HDFC_EVENTS: EventDefinition[] = [
  // Transactions
  { id: "purchase", displayName: "Purchase", category: "Spend", table: "transactions", filterColumn: "txn_type", filterValue: "PURCHASE", valueColumn: "amount_inr", dateColumn: "txn_ts", properties: TXN_PROPS },
  { id: "approved_txn", displayName: "Approved Transaction", category: "Spend", table: "transactions", filterColumn: "response", filterValue: "APPROVED", valueColumn: "amount_inr", dateColumn: "txn_ts", properties: TXN_PROPS },
  { id: "declined_txn", displayName: "Declined Transaction", category: "Spend", table: "transactions", filterColumn: "response", filterValue: "DECLINED", valueColumn: "amount_inr", dateColumn: "txn_ts", properties: TXN_PROPS },
  { id: "intl_txn", displayName: "International Transaction", category: "Spend", table: "transactions", filterSQL: "channel IN ('INTL_ECOM','INTL_POS')", valueColumn: "amount_inr", dateColumn: "txn_ts", properties: TXN_PROPS },
  { id: "fraud_txn", displayName: "Fraud Transaction", category: "Fraud", table: "transactions", filterColumn: "is_fraud_flag", filterValue: "true", valueColumn: "amount_inr", dateColumn: "txn_ts", properties: TXN_PROPS },
  { id: "emi_conversion", displayName: "EMI Conversion", category: "Spend", table: "transactions", filterColumn: "txn_type", filterValue: "EMI_CONVERSION", valueColumn: "amount_inr", dateColumn: "txn_ts", properties: TXN_PROPS },
  // Fraud alerts
  { id: "alert_raised", displayName: "Fraud Alert Raised", category: "Fraud Ops", table: "fraud_alerts", dateColumn: "alert_sent_ts", properties: ALERT_PROPS },
  { id: "alert_confirmed", displayName: "Confirmed Fraud", category: "Fraud Ops", table: "fraud_alerts", filterColumn: "analyst_decision", filterValue: "CONFIRM_FRAUD", dateColumn: "analyst_decision_ts", properties: ALERT_PROPS },
  { id: "alert_false_positive", displayName: "False Positive Alert", category: "Fraud Ops", table: "fraud_alerts", filterColumn: "disposition", filterValue: "FALSE_POSITIVE", dateColumn: "alert_sent_ts", properties: ALERT_PROPS },
  { id: "sla_breach", displayName: "SLA Breach", category: "Fraud Ops", table: "fraud_alerts", filterColumn: "sla_breached_flag", filterValue: "true", dateColumn: "alert_sent_ts", funnelEligible: false, properties: ALERT_PROPS },
  // Card lifecycle
  { id: "card_hotlisted", displayName: "Card Hotlisted", category: "Card Lifecycle", table: "card_lifecycle_events", filterColumn: "event_type", filterValue: "HOTLISTED", dateColumn: "event_ts", properties: LIFECYCLE_PROPS },
  { id: "card_reissued", displayName: "Card Reissued", category: "Card Lifecycle", table: "card_lifecycle_events", filterColumn: "event_type", filterValue: "REISSUED", dateColumn: "event_ts", properties: LIFECYCLE_PROPS },
  // Cases & service
  { id: "case_opened", displayName: "Fraud Case Opened", category: "Cases", table: "case_resolutions", dateColumn: "case_opened_ts", properties: CASE_PROPS },
  { id: "chargeback_raised", displayName: "Chargeback Raised", category: "Cases", table: "case_resolutions", filterColumn: "chargeback_raised_flag", filterValue: "true", dateColumn: "case_opened_ts", properties: CASE_PROPS },
  { id: "false_decline_complaint", displayName: "False Decline Complaint", category: "Customer Impact", table: "service_interactions", filterColumn: "category", filterValue: "FALSE_DECLINE_COMPLAINT", dateColumn: "opened_ts", properties: SERVICE_PROPS },
];

/**
 * HDFC Credit Fraud — credit-card fraud operations demo dataset.
 *
 * Source data is generated by ~/projects/actioneer-demo-data (HDFC_CreditFraud_Demo)
 * and copied to data/csv/hdfc-creditfraud/ (gitignored, local-only). The dataset
 * powers both the analytics chat and Vimarsh's voice fraud-verification flows,
 * which query this dataset by the id "hdfc-creditfraud".
 */

const CSV_TABLES = [
  "customers",
  "cards",
  "merchants",
  "fraud_episodes",
  "blocking_actions",
  "case_resolutions",
  "case_events",
  "card_lifecycle_events",
  "service_interactions",
  "device_intelligence",
  "analyst_roster",
  "fraud_rules",
  "benchmarks",
  "calendar_events",
  "hero_case_index",
];

// Large / hot-join tables are materialized (real tables) instead of CSV views,
// so they get a raw_ view here and a real table in summaryTableSQL. fraud_alerts
// is the central join table for alert-quality, analyst-ops, and the enrichment
// view, so it is materialized too.
const RAW_MATERIALIZED = ["transactions", "statements", "fraud_alerts"];

export const hdfcCreditfraudDataset: DatasetConfig = {
  id: "hdfc-creditfraud",
  label: "Credit Risk",
  companyName: "HDFC Bank",
  dbFile: "data/hdfc-creditfraud.duckdb",
  sourceType: "csv",
  primaryTable: "transactions",
  entityTable: "customers",
  userIdField: "customer_id",
  dateField: "txn_ts",
  dateRange: { start: "2024-06-01", end: "2026-05-31" },
  currency: "₹",
  entityName: "customers",
  reportMeta: {
    totalEvents: "19.3L transactions · 33K alerts",
    totalUsers: "5,000 customers · 4,000+ cards",
    dateRangeLabel: "Jun 2024 – May 2026",
    dbName: "hdfc-creditfraud.duckdb",
  },
  welcomeSubtitle:
    "Ask about fraud trends, alert quality, analyst load, chargebacks, and customer impact across the credit-card book.",
  suggestedPrompts: [
    "What is the monthly fraud trend over the two years, and which months spike?",
    "How much fraud did we prevent vs lose, gross and by month?",
    "What share of our alerts are false positives, and which trigger reasons are worst?",
    "How do night-shift queue waits and SLA breaches compare to day shift?",
    "Break down fraud by typology, channel, MCC, city and card product.",
    "What is our chargeback win rate and how fast do we resolve cases?",
  ],
  systemContext: `You are Actioneer, an AI-powered analytics assistant for the credit-card fraud-operations team at a large Indian bank (HDFC Bank cards).

Dataset: ~1.93 million card transactions over two years (Jun 2024 – May 2026) across 5,000 customers and 4,000+ cards, with a fully traceable fraud chain: transaction → risk score → alert → customer response → analyst queue → case → resolution/chargeback.

You cover these analytics domains:
1. FRAUD DETECTION — typologies, detection source (real-time vs batch vs customer-reported vs network), time-to-detect, prevented vs lost amounts.
2. ALERT QUALITY — false-positive rate, trigger-reason precision, alert volume by hour/severity, model risk scores.
3. ANALYST OPERATIONS — queue waits, SLA breaches by shift, handle time, alerts per analyst, fully-loaded review cost.
4. CUSTOMER IMPACT — false declines (insult rate), alert fatigue complaints, repeat fraud victims, CSAT.
5. CASE & LIABILITY — chargeback win rate, RBI liability buckets by reporting delay, provisional-credit aging, recovery.
6. PORTFOLIO & SPEND — spend per active card by segment, revolve rate, interest/fee income, card lifecycle.

Every fraud label and trigger re-derives from raw transactions — answers should be honest and grounded in the data.`,
  schemaContext: `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect). Currency is INR (₹).

═══ CORE TABLES ═══

TABLE: transactions (~1.93M rows) — one row per card transaction
  - txn_id, card_id (FK cards), merchant_id (FK merchants), txn_ts (TIMESTAMP, IST)
  - amount_inr (DOUBLE), currency, fx_amount, mcc, channel (POS|ECOM|UPI|INTL_ECOM|INTL_POS|ATM_CASH_AD|CONTACTLESS)
  - pos_entry_mode (CHIP|SWIPE|TAP), auth_method (OTP_3DS|PIN|TAP_NO_PIN), otp_attempts, token_used_flag
  - txn_city, txn_country, device_id, ip_address
  - txn_type (PURCHASE|REFUND|REVERSAL|FEE|EMI_CONVERSION|AUTOPAY), response (APPROVED|DECLINED|HELD_FOR_CONFIRMATION), decline_reason
  - is_fraud_flag (BOOLEAN, ground truth), fraud_episode_id (FK fraud_episodes), original_txn_id

TABLE: fraud_alerts (~33K rows) — one row per fraud alert raised on a transaction
  - alert_id, txn_id (FK transactions), card_id, customer_id, fraud_episode_id
  - risk_score (0-1000), trigger_reasons (pipe-separated, FK fraud_rules), severity (LOW|MEDIUM|HIGH|CRITICAL), alert_channel
  - risk_scored_ts, alert_sent_ts, alert_delivered_ts, delivery_status, customer_response (CONFIRMED_GENUINE|REPORTED_FRAUD|NO_RESPONSE), response_latency_s
  - auto_disposed_flag, queue_entered_ts, analyst_id (FK analyst_roster), analyst_picked_ts, analyst_decision (CLEAR_GENUINE|CONFIRM_FRAUD|ESCALATE), handle_time_s
  - shift (DAY|EVENING|NIGHT), sla_target_min, sla_breached_flag, disposition (TRUE_POSITIVE|FALSE_POSITIVE|UNRESOLVED)

TABLE: fraud_episodes (~5.7K rows) — a grouped fraud incident across one or more txns
  - episode_id, typology (CARD_TESTING|CNP_INTL|LOST_STOLEN|OTP_SOCIAL_ENGINEERING_ATO|SKIMMING_CLONE|MULE_CYCLING|SUBSCRIPTION_DRAIN|MERCHANT_COLLUSION_FIRST_PARTY)
  - detection_source (SYSTEM_REALTIME|SYSTEM_BATCH|CUSTOMER_REPORTED|NETWORK_COMPROMISE_ALERT), first_fraud_txn_ts, detected_ts, time_to_detect_s
  - txns_attempted, txns_before_block, amount_attempted_inr, amount_prevented_inr, amount_lost_inr, cards_involved_count, status

TABLE: customers (5,000 rows) — customer_id, full_name, gender, dob, age, city, state, segment (Classic|Preferred|Imperia), occupation, income_band, kyc_status (VERIFIED|RE_KYC_DUE), relationship_since, repeat_fraud_victim_flag
TABLE: cards (4,000+ rows) — card_id, customer_id, masked_pan, bin, network (VISA|MASTERCARD|RUPAY|DINERS), product, card_tier, credit_limit_current, issue_date, expiry, intl_enabled_flag, upi_linked_flag, status (ACTIVE|BLOCKED|DORMANT|REISSUED)
TABLE: merchants — merchant_id, merchant_name, mcc, mcc_description, category, city, state, country, channel, risk_tier (LOW|MEDIUM|HIGH), onboarded_since

═══ OPERATIONS / CASE TABLES ═══

TABLE: blocking_actions — action_id, alert_id, card_id, action_type (CARD_HOTLISTED|CARD_REISSUED|TXN_HELD|TXN_DECLINED_INFLIGHT|UNBLOCKED_AFTER_CONFIRMATION), action_ts, initiated_by, amount_at_risk_inr, amount_prevented_inr, amount_lost_inr
TABLE: case_resolutions — case_id, alert_id, customer_id, fraud_episode_id, case_opened_ts, reporting_delay_bucket (WITHIN_3_DAYS|4_7_DAYS|BEYOND_7_DAYS), liability_outcome (ZERO_LIABILITY|LIMITED_LIABILITY|CUSTOMER_LIABLE), chargeback_raised_flag, chargeback_status (WON|LOST|REPRESENTED|NA), resolution_days, final_status, amount_recovered_inr
TABLE: case_events — case_event_id, case_id, event_ts, from_status, to_status, actor (ANALYST|SYSTEM|NETWORK)
TABLE: card_lifecycle_events — event_id, card_id, event_ts, event_type (ISSUED|ACTIVATED|LIMIT_INCREASED|HOTLISTED|REISSUED), reason, initiated_by, linked_card_id
TABLE: service_interactions — ticket_id, customer_id, opened_ts, channel, category (FALSE_DECLINE_COMPLAINT|ALERT_FATIGUE_COMPLAINT|DISPUTE_STATUS_QUERY|OTHER), linked_alert_id, resolved_ts, resolution_days, csat_1_5
TABLE: statements (~card-cycle rows) — statement_id, card_id, cycle_start, cycle_end, due_date, total_spend_inr, payments_received_inr, revolve_flag, interest_charged_inr, fees_inr, closing_balance_inr, utilization_pct, dpd_bucket

═══ REFERENCE TABLES ═══

TABLE: device_intelligence — device_id (FK transactions.device_id), cards_seen, customers_seen, txns, fraud_txns, device_risk_tier, shared_device_flag, device_risk_score
TABLE: analyst_roster — analyst_id, analyst_name, primary_shift, team, seniority, tenure_months, fully_loaded_hourly_cost_inr (use with fraud_alerts.handle_time_s to cost alert review)
TABLE: fraud_rules — trigger_reason (FK fraud_alerts.trigger_reasons via pipe-split), rule_description, severity_band, live_alerts, false_positive_share_pct, recommended_action
TABLE: hero_case_index — hero_id (H1-H15), title, customer_id, card_id, episode_id, key_txn_ids, alert_ids, case_ids, narrative — curated walkthrough stories
TABLE: benchmarks — metric, your_value, industry_median, better_direction
TABLE: calendar_events — event_name, start_date, end_date, overall_multiplier, category_effects, note

═══ KEY JOINS ═══
  fraud_alerts.txn_id = transactions.txn_id
  fraud_alerts.fraud_episode_id = fraud_episodes.episode_id
  transactions.card_id = cards.card_id ; cards.customer_id = customers.customer_id
  transactions.merchant_id = merchants.merchant_id
  case_resolutions.alert_id = fraud_alerts.alert_id
  fraud_alerts.analyst_id = analyst_roster.analyst_id

NOTES:
  - False-positive rate = fraud_alerts where disposition = 'FALSE_POSITIVE' / all dispositioned alerts.
  - Prevented vs lost amounts live on fraud_episodes (amount_prevented_inr, amount_lost_inr) and blocking_actions.
  - trigger_reasons is pipe-separated; UNNEST(string_split(trigger_reasons, '|')) to analyze per rule.
  - Use is_fraud_flag for ground-truth fraud; use disposition/analyst_decision for operational outcomes.`,
  domainHints: `1. TIME: txn_ts is a TIMESTAMP in IST. Use strftime(txn_ts, '%Y-%m') for monthly trends.
2. FRAUD RATE: count is_fraud_flag = true over all transactions; fraud is rare (~0.1%), so always show counts alongside rates.
3. FALSE POSITIVES: a false positive is fraud_alerts.disposition = 'FALSE_POSITIVE' (the majority of alerts). Distinguish from is_fraud_flag.
4. AMOUNTS: monetary columns end in _inr and are in rupees. Prevented/lost amounts come from fraud_episodes, not from summing transactions.
5. ANALYST COST: cost = SUM(handle_time_s)/3600 * analyst_roster.fully_loaded_hourly_cost_inr.
6. TRIGGER REASONS: fraud_alerts.trigger_reasons is pipe-delimited; split with string_split before grouping.
7. CASES: chargeback win rate uses case_resolutions.chargeback_status IN ('WON','LOST','REPRESENTED'); NA means no chargeback raised.`,
  summaryTableHint:
    "transactions and statements are materialized tables (fast). All other tables are views over CSV. Prefer fraud_episodes for prevented/lost amounts and fraud_alerts for alert-quality and analyst-ops metrics.",
  // `agents` drives deep-research SQL generation (takes priority over the legacy
  // multiAgentPrompt, which is only a fallback parse). queryDescriptions below is
  // still read live for deep-mode per-agent summary headers, so keep it in sync
  // with these agents' query descriptions.
  agents: [
    {
      id: "data-quality",
      queries: [
        { description: "Transaction volume, approval rate, and fraud rate by month", hint: "GROUP BY strftime(txn_ts,'%Y-%m'); fraud rate = COUNT(*) FILTER (WHERE is_fraud_flag) / COUNT(*)" },
        { description: "Alert false-positive share and SLA breach rate by severity and shift", hint: "fraud_alerts: disposition='FALSE_POSITIVE', sla_breached_flag; GROUP BY severity, shift" },
      ],
    },
    {
      id: "daily-metrics",
      queries: [
        { description: "Monthly fraud prevented vs lost", hint: "fraud_episodes: SUM(amount_prevented_inr), SUM(amount_lost_inr) GROUP BY strftime(detected_ts,'%Y-%m')" },
        { description: "Spend per active card and revolve/interest income", hint: "statements: SUM(total_spend_inr), revolve_flag, interest_charged_inr, fees_inr" },
      ],
    },
    {
      id: "rev-opt",
      queries: [
        { description: "Chargeback win rate and recovery by reporting-delay bucket", hint: "case_resolutions: chargeback_status IN ('WON','LOST','REPRESENTED'); GROUP BY reporting_delay_bucket; SUM(amount_recovered_inr)" },
        { description: "Analyst review cost from handle time and fully-loaded hourly cost", hint: "SUM(fraud_alerts.handle_time_s)/3600 * analyst_roster.fully_loaded_hourly_cost_inr, joined on analyst_id" },
      ],
    },
    {
      id: "geographic",
      queries: [
        { description: "Fraud and transactions by city, country, and merchant risk tier", hint: "GROUP BY txn_city, txn_country; join merchants for risk_tier" },
      ],
    },
  ],
  queryDescriptions: {
    "data-quality": [
      "Transaction volume, approval rate, and fraud rate by month",
      "Alert volume, false-positive share, and SLA breach rate by severity and shift",
    ],
    "daily-metrics": [
      "Monthly fraud prevented vs lost (from fraud_episodes)",
      "Spend per active card and revolve/interest income (from statements)",
    ],
    "rev-opt": [
      "Chargeback win rate and recovery by reporting-delay bucket",
      "Analyst review cost from handle time and fully-loaded hourly cost",
    ],
    geographic: [
      "Fraud and transactions by city, country, and merchant risk tier",
    ],
  },
  multiAgentPrompt:
    "Analyze the HDFC credit-card fraud-operations dataset. Cover fraud detection (typology, detection source, prevented vs lost), alert quality (false positives, trigger reasons, SLA), analyst operations (queue, handle time, cost), customer impact (false declines, complaints, repeat victims), and case/liability outcomes (chargebacks, RBI liability). Ground every metric in the raw transactions and fraud tables.",
  viewSQL: (dataDir: string) => {
    const csvDir = `${dataDir}/csv/hdfc-creditfraud`;
    const views = CSV_TABLES.map(
      (t) =>
        `CREATE OR REPLACE VIEW ${t} AS SELECT * FROM read_csv('${csvDir}/${t}.csv', auto_detect=true, ignore_errors=true)`,
    );
    const rawViews = RAW_MATERIALIZED.map(
      (t) =>
        `CREATE OR REPLACE VIEW raw_${t} AS SELECT * FROM read_csv('${csvDir}/${t}.csv', auto_detect=true, ignore_errors=true)`,
    );
    // Placeholder for the table Vimarsh's voice analysis writes to on call
    // completion. Pre-created (IF NOT EXISTS, so existing call data is kept) so
    // the fraud-alerts dashboard's LEFT JOIN works before any call is made.
    // Schema mirrors fraud-analysis.ts writeFraudAnalysisToDuckDB exactly.
    const voiceCalls = `CREATE TABLE IF NOT EXISTS voice_verification_calls (
      call_id VARCHAR PRIMARY KEY, alert_id VARCHAR, customer_id VARCHAR, amount_at_risk_inr DOUBLE,
      recommendation VARCHAR, tool_name VARCHAR, tool_args VARCHAR,
      voice_onset_ms DOUBLE, elaboration_ratio DOUBLE, echo_score DOUBLE,
      duress_score DOUBLE, stress_class INTEGER, jitter DOUBLE, shimmer DOUBLE, hnr DOUBLE,
      mean_f0 DOUBLE, f0_variance DOUBLE, background_voice BOOLEAN, feature_importances VARCHAR,
      turn_count INTEGER, transcript VARCHAR,
      detected_gender VARCHAR, gender_confidence DOUBLE, gender_mismatch BOOLEAN, gender_signals VARCHAR,
      called_at TIMESTAMP, resolved_at TIMESTAMP
    )`;
    return [...views, ...rawViews, voiceCalls];
  },
  summaryTableSQL: [
    `CREATE OR REPLACE TABLE transactions AS SELECT * FROM raw_transactions`,
    `CREATE OR REPLACE TABLE statements AS SELECT * FROM raw_statements`,
    `CREATE OR REPLACE TABLE fraud_alerts AS SELECT * FROM raw_fraud_alerts`,
    // Per-card spend profile used to score how far a flagged txn deviates from the
    // cardholder's normal behaviour (powers the voice agent's talking points). The
    // avg_amt_90d/p95_amt_90d/intl_txn_count column NAMES are inherited from
    // Vimarsh's voice route (FraudCallContext); the VALUES are computed over the
    // card's full purchase history (robust + always populated), not a 90-day window.
    `CREATE OR REPLACE TABLE card_spend_stats AS
       SELECT
         card_id,
         AVG(amount_inr) AS avg_amt_90d,
         QUANTILE_CONT(amount_inr, 0.95) AS p95_amt_90d,
         MODE(txn_country) AS usual_country,
         COUNT(*) FILTER (WHERE txn_country <> 'IN') AS intl_txn_count
       FROM transactions
       WHERE txn_type = 'PURCHASE' AND response = 'APPROVED'
       GROUP BY card_id`,
    // Denormalized per-alert enrichment view that Vimarsh's fraud-verify and
    // fraud-alerts routes read (SELECT * FROM fraud_call_context). Joins the
    // alert to its transaction, merchant, customer, card, episode, rule, device,
    // and the card's spend profile, plus the deviation factor his prompt cites.
    `CREATE OR REPLACE TABLE fraud_call_context AS
       SELECT
         fa.alert_id,
         fa.severity,
         fa.trigger_reasons,
         fa.risk_score,
         fr.false_positive_share_pct AS rule_fp_rate,
         fr.rule_description AS trigger_rule_description,
         fa.txn_id,
         t.amount_inr,
         t.txn_city,
         t.txn_ts,
         t.channel,
         t.auth_method,
         t.device_id,
         m.merchant_name,
         m.category AS merchant_category,
         m.risk_tier AS merchant_risk_tier,
         fa.customer_id,
         c.full_name,
         c.city AS home_city,
         c.state,
         c.segment,
         c.repeat_fraud_victim_flag,
         CAST(NULL AS VARCHAR) AS demo_phone,
         c.gender,
         cd.masked_pan,
         cd.card_tier,
         cd.network,
         cd.product,
         fe.typology,
         di.device_risk_tier,
         di.shared_device_flag,
         di.device_risk_score,
         CASE WHEN css.avg_amt_90d > 0 THEN t.amount_inr / css.avg_amt_90d ELSE NULL END AS deviation_factor,
         css.avg_amt_90d,
         css.p95_amt_90d,
         css.usual_country,
         css.intl_txn_count
       FROM fraud_alerts fa
       LEFT JOIN transactions t ON t.txn_id = fa.txn_id
       LEFT JOIN merchants m ON m.merchant_id = t.merchant_id
       LEFT JOIN customers c ON c.customer_id = fa.customer_id
       LEFT JOIN cards cd ON cd.card_id = fa.card_id
       LEFT JOIN fraud_episodes fe ON fe.episode_id = fa.fraud_episode_id
       LEFT JOIN fraud_rules fr ON fr.trigger_reason = split_part(fa.trigger_reasons, '|', 1)
       LEFT JOIN device_intelligence di ON di.device_id = t.device_id
       LEFT JOIN card_spend_stats css ON css.card_id = fa.card_id`,
  ],
  setupVersion: "hdfc-creditfraud-v3",
  events: HDFC_EVENTS,
};
