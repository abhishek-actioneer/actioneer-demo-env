import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { MetricDefinition } from "@/lib/metric-types";
import type { FunnelConfig } from "@/lib/funnel-types";
import type { RetentionConfig } from "@/lib/retention-types";
import type { Board, BoardCard, BoardSection } from "@/lib/board-types";
import { DATASETS_DIR } from "@/lib/datasets/schema-loader";
import { fundsindiaDataset } from "@/lib/datasets/fundsindia";
import { executeSQLInternal } from "@/lib/sql-executor";
import { computeFunnelHeadlineConversion, computeD7Retention } from "@/lib/server/seed-metric-helpers";
import { upsertSegment } from "@/lib/server/segment-repo";
import { upsertFunnel } from "@/lib/server/funnel-repo";
import { upsertRetention } from "@/lib/server/retention-repo";
import { upsertBoard, upsertCard, upsertSection } from "@/lib/server/board-repo";
import { getPlaybook, upsertPlaybook } from "@/lib/server/playbook-repo";
import type { PlaybookV2 } from "@/lib/playbook-types";

export const FUNDSINDIA_DATASET_ID = "fundsindia";
const DATA_RANGE = { start: "2024-06-01", end: "2026-05-31" } as const;

export const FUNDSINDIA_METRICS: MetricDefinition[] = [
  {
    id: "m-total-invested",
    name: "Total Invested AUM",
    description: "Total invested corpus across FundsIndia platform funds.",
    type: "kpi",
    category: "Platform",
    valueFormat: "currency",
    aggregation: "sum",
    valueSql: "SELECT COALESCE(SUM(total_invested), 0) AS value FROM fund_platform_stats",
    timeSeriesSql: "SELECT CAST(month AS VARCHAR) AS date, COALESCE(SUM(CASE WHEN txn_type = 'redemption' THEN -total_amount ELSE total_amount END), 0) AS value FROM monthly_txn_summary GROUP BY 1 ORDER BY 1",
    table: "fund_platform_stats",
    column: "total_invested",
    timeColumn: "month",
    formula: "SUM(total_invested)",
    timeGrain: "monthly",
    dimensions: ["amc_name", "category", "is_fi_select"],
    relationships: [],
  },
  {
    id: "m-net-inflow",
    name: "Net Monthly Inflow",
    description: "Successful purchases minus redemptions by month.",
    type: "kpi",
    category: "Platform",
    valueFormat: "currency",
    aggregation: "sum",
    valueSql: "SELECT COALESCE(SUM(CASE WHEN txn_type = 'redemption' THEN -total_amount ELSE total_amount END), 0) AS value FROM monthly_txn_summary",
    timeSeriesSql: "SELECT CAST(month AS VARCHAR) AS date, COALESCE(SUM(CASE WHEN txn_type = 'redemption' THEN -total_amount ELSE total_amount END), 0) AS value FROM monthly_txn_summary GROUP BY 1 ORDER BY 1",
    table: "monthly_txn_summary",
    column: "total_amount",
    timeColumn: "month",
    formula: "SUM(purchases) - SUM(redemptions)",
    timeGrain: "monthly",
    dimensions: ["txn_type"],
    relationships: [{ metricId: "m-total-invested", metricName: "Total Invested AUM", direction: "drives", type: "component" }],
  },
  {
    id: "m-active-sips",
    name: "Active SIPs",
    description: "Current active systematic investment plans.",
    type: "kpi",
    category: "SIP Book",
    valueFormat: "integer",
    aggregation: "sum",
    valueSql: "SELECT COALESCE(SUM(active_sip_count), 0) AS value FROM fund_platform_stats",
    timeSeriesSql: "SELECT CAST(month AS VARCHAR) AS date, COALESCE(SUM(new_sips - cancelled_sips) OVER (ORDER BY month), 0) AS value FROM monthly_platform_kpis ORDER BY 1",
    table: "fund_platform_stats",
    column: "active_sip_count",
    timeColumn: "month",
    formula: "SUM(active_sip_count)",
    timeGrain: "monthly",
    dimensions: ["amc_name", "category", "is_fi_select"],
    relationships: [{ metricId: "m-total-invested", metricName: "Total Invested AUM", direction: "drives", type: "component" }],
  },
  {
    id: "m-new-sips",
    name: "New SIPs",
    description: "New SIPs created during the dataset period.",
    type: "indicator",
    category: "SIP Book",
    valueFormat: "integer",
    aggregation: "sum",
    valueSql: "SELECT COALESCE(SUM(new_sips), 0) AS value FROM monthly_platform_kpis",
    timeSeriesSql: "SELECT CAST(month AS VARCHAR) AS date, new_sips AS value FROM monthly_platform_kpis ORDER BY 1",
    table: "monthly_platform_kpis",
    column: "new_sips",
    timeColumn: "month",
    formula: "SUM(new_sips)",
    timeGrain: "monthly",
    dimensions: [],
    relationships: [{ metricId: "m-active-sips", metricName: "Active SIPs", direction: "drives", type: "component" }],
  },
  {
    id: "m-sip-cancel-rate",
    name: "SIP Cancellation Rate",
    description: "Cancelled SIPs as a percentage of newly created SIPs.",
    type: "diagnostic",
    category: "SIP Book",
    valueFormat: "percent",
    aggregation: "ratio",
    valueSql: "SELECT COALESCE(SUM(cancelled_sips) * 100.0 / NULLIF(SUM(new_sips), 0), 0) AS value FROM monthly_platform_kpis",
    timeSeriesSql: "SELECT CAST(month AS VARCHAR) AS date, COALESCE(cancelled_sips * 100.0 / NULLIF(new_sips, 0), 0) AS value FROM monthly_platform_kpis ORDER BY 1",
    table: "monthly_platform_kpis",
    column: "cancelled_sips",
    timeColumn: "month",
    formula: "cancelled_sips / new_sips",
    timeGrain: "monthly",
    dimensions: [],
    relationships: [{ metricId: "m-active-sips", metricName: "Active SIPs", direction: "drives", type: "influence" }],
  },
  {
    id: "m-est-monthly-commission",
    name: "Estimated Monthly Commission",
    description: "Estimated monthly trailing commission across AMCs.",
    type: "kpi",
    category: "Revenue",
    valueFormat: "currency",
    aggregation: "sum",
    valueSql: "SELECT COALESCE(SUM(est_monthly_commission), 0) AS value FROM amc_performance",
    timeSeriesSql: "SELECT CAST(month AS VARCHAR) AS date, COALESCE(SUM(total_amount) * 0.008 / 12, 0) AS value FROM monthly_txn_summary WHERE txn_type <> 'redemption' GROUP BY 1 ORDER BY 1",
    table: "amc_performance",
    column: "est_monthly_commission",
    timeColumn: "month",
    formula: "SUM(total_invested * trailing_commission_pct / 100 / 12)",
    timeGrain: "monthly",
    dimensions: ["amc_name"],
    relationships: [{ metricId: "m-total-invested", metricName: "Total Invested AUM", direction: "drives", type: "component" }],
  },
  {
    id: "m-activation-rate",
    name: "First Investment Rate",
    description: "Share of signups who completed their first investment.",
    type: "kpi",
    category: "Activation",
    valueFormat: "percent",
    aggregation: "ratio",
    valueSql: "SELECT COALESCE(SUM(first_invested) * 100.0 / NULLIF(SUM(signups), 0), 0) AS value FROM investor_funnel",
    timeSeriesSql: "SELECT CAST(cohort_month AS VARCHAR) AS date, COALESCE(SUM(first_invested) * 100.0 / NULLIF(SUM(signups), 0), 0) AS value FROM investor_funnel GROUP BY 1 ORDER BY 1",
    table: "investor_funnel",
    column: "first_invested",
    timeColumn: "cohort_month",
    formula: "first_invested / signups",
    timeGrain: "monthly",
    dimensions: ["acquisition_channel", "city_tier"],
    relationships: [{ metricId: "m-new-sips", metricName: "New SIPs", direction: "drives", type: "influence" }],
  },
  {
    id: "m-kyc-completion-rate",
    name: "KYC Completion Rate",
    description: "Share of signups whose KYC status is verified.",
    type: "indicator",
    category: "Activation",
    valueFormat: "percent",
    aggregation: "ratio",
    valueSql: "SELECT COALESCE(COUNT(*) FILTER (WHERE kyc_status = 'verified') * 100.0 / NULLIF(COUNT(*), 0), 0) AS value FROM raw_investors WHERE signup_date >= DATE '2024-06-01'",
    timeSeriesSql: "SELECT CAST(strftime(signup_date::DATE, '%Y-%m') || '-01' AS VARCHAR) AS date, COALESCE(COUNT(*) FILTER (WHERE kyc_status = 'verified') * 100.0 / NULLIF(COUNT(*), 0), 0) AS value FROM raw_investors WHERE signup_date >= DATE '2024-06-01' GROUP BY 1 ORDER BY 1",
    table: "raw_investors",
    column: "kyc_status",
    timeColumn: "signup_date",
    formula: "verified KYC signups / signups",
    timeGrain: "monthly",
    dimensions: ["acquisition_channel", "city_tier"],
    relationships: [{ metricId: "m-activation-rate", metricName: "First Investment Rate", direction: "drives", type: "component" }],
  },
  {
    id: "m-fi-select-share",
    name: "FI Select AUM Share",
    description: "Share of invested AUM in curated FI Select funds.",
    type: "indicator",
    category: "Fund Quality",
    valueFormat: "percent",
    aggregation: "ratio",
    valueSql: "SELECT COALESCE(SUM(CASE WHEN is_fi_select THEN total_invested ELSE 0 END) * 100.0 / NULLIF(SUM(total_invested), 0), 0) AS value FROM fund_platform_stats",
    timeSeriesSql: "SELECT CAST(txn_date AS VARCHAR) AS date, COALESCE(SUM(CASE WHEN is_fi_select THEN amount_inr ELSE 0 END) * 100.0 / NULLIF(SUM(amount_inr), 0), 0) AS value FROM transactions_full WHERE status = 'success' AND txn_type <> 'redemption' GROUP BY 1 ORDER BY 1",
    table: "fund_platform_stats",
    column: "is_fi_select",
    timeColumn: "txn_date",
    formula: "FI Select invested / total invested",
    timeGrain: "daily",
    dimensions: ["amc_name", "category"],
    relationships: [{ metricId: "m-active-sips", metricName: "Active SIPs", direction: "drives", type: "influence" }],
  },
  {
    id: "m-campaign-conversion-rate",
    name: "Campaign Conversion Rate",
    description: "Share of delivered CRM messages that converted.",
    type: "diagnostic",
    category: "CRM",
    valueFormat: "percent",
    aggregation: "ratio",
    valueSql: "SELECT COALESCE(SUM(converted) * 100.0 / NULLIF(SUM(delivered), 0), 0) AS value FROM campaign_performance",
    timeSeriesSql: "SELECT CAST(month AS VARCHAR) AS date, COALESCE(SUM(converted) * 100.0 / NULLIF(SUM(delivered), 0), 0) AS value FROM campaign_performance GROUP BY 1 ORDER BY 1",
    table: "campaign_performance",
    column: "converted",
    timeColumn: "month",
    formula: "converted / delivered",
    timeGrain: "monthly",
    dimensions: ["campaign_type", "channel"],
    relationships: [{ metricId: "m-activation-rate", metricName: "First Investment Rate", direction: "drives", type: "influence" }],
  },
  {
    id: "m-b30-active-sip-book",
    name: "B30 Active SIP Book",
    description: "Monthly active SIP book from B30 cities.",
    type: "indicator",
    category: "Geography",
    valueFormat: "currency",
    aggregation: "sum",
    valueSql: "SELECT COALESCE(SUM(active_sip_book_inr), 0) AS value FROM city_tier_kpis WHERE city_tier = 'b30'",
    timeSeriesSql: "SELECT CAST(month AS VARCHAR) AS date, COALESCE(SUM(active_sip_book_inr), 0) AS value FROM city_tier_kpis WHERE city_tier = 'b30' GROUP BY 1 ORDER BY 1",
    table: "city_tier_kpis",
    column: "active_sip_book_inr",
    timeColumn: "month",
    formula: "SUM(active_sip_book_inr) WHERE city_tier = b30",
    timeGrain: "monthly",
    dimensions: ["city_tier"],
    relationships: [{ metricId: "m-active-sips", metricName: "Active SIPs", direction: "drives", type: "component" }],
  },
  {
    id: "m-goal-on-track-rate",
    name: "Goal On-Track Rate",
    description: "Share of goal plans currently on track.",
    type: "diagnostic",
    category: "Goals",
    valueFormat: "percent",
    aggregation: "ratio",
    valueSql: "SELECT COALESCE(SUM(on_track) * 100.0 / NULLIF(SUM(total_goals), 0), 0) AS value FROM goal_achievement",
    timeSeriesSql: "SELECT CAST(strftime(created_date::DATE, '%Y-%m') || '-01' AS VARCHAR) AS date, COALESCE(COUNT(*) FILTER (WHERE status = 'on_track') * 100.0 / NULLIF(COUNT(*), 0), 0) AS value FROM raw_goals GROUP BY 1 ORDER BY 1",
    table: "raw_goals",
    column: "status",
    timeColumn: "created_date",
    formula: "on_track / total_goals",
    timeGrain: "monthly",
    dimensions: ["goal_type", "created_by"],
    relationships: [{ metricId: "m-active-sips", metricName: "Active SIPs", direction: "drives", type: "influence" }],
  },
];

function seedId(userId: string, kind: string, slug: string): string {
  const hash = createHash("sha1").update(userId).digest("hex").slice(0, 10);
  return `fi_${hash}_${kind}_${slug}`;
}

function ensureMetricsFile(): number {
  const datasetDir = join(DATASETS_DIR, FUNDSINDIA_DATASET_ID);
  if (!existsSync(datasetDir)) mkdirSync(datasetDir, { recursive: true });
  const metricsPath = join(datasetDir, "metrics.json");
  writeFileSync(
    metricsPath,
    JSON.stringify({ rootMetricId: "m-total-invested", metrics: FUNDSINDIA_METRICS }, null, 2),
  );
  const g = globalThis as Record<string, unknown>;
  if (g.__metrics_cache__ instanceof Map) g.__metrics_cache__.delete(FUNDSINDIA_DATASET_ID);
  return FUNDSINDIA_METRICS.length;
}

async function countSegment(sql: string): Promise<number> {
  const result = await executeSQLInternal(`SELECT COUNT(DISTINCT investor_id) AS value FROM (${sql}) s`, FUNDSINDIA_DATASET_ID);
  if (result.error) return 0;
  return Number(result.rows[0]?.value ?? 0);
}

async function queryRows(sql: string): Promise<Record<string, unknown>[]> {
  const result = await executeSQLInternal(sql, FUNDSINDIA_DATASET_ID);
  if (result.error) {
    console.warn(`[fundsindia-sample] SQL failed: ${result.error}`);
    return [];
  }
  return result.rows;
}

function chartRows(rows: Record<string, unknown>[]): Record<string, string | number>[] {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "number" || typeof value === "string" ? value : String(value ?? ""),
    ]),
  ));
}

const SEGMENTS = [
  {
    slug: "active-sip",
    name: "Active SIP Investors",
    description: "Investors with at least one currently active SIP.",
    sql: "SELECT DISTINCT investor_id FROM sips_full WHERE status = 'active'",
  },
  {
    slug: "kyc-hold",
    name: "KYC On Hold",
    description: "Signed-up investors whose KYC is currently on hold.",
    sql: "SELECT DISTINCT investor_id FROM raw_investors WHERE kyc_status = 'on_hold'",
  },
  {
    slug: "blocked-high-intent",
    name: "Blocked High-Intent Investors",
    description: "Investors browsing funds or starting SIP flows but blocked by incomplete KYC or bank verification.",
    sql: "SELECT DISTINCT i.investor_id FROM raw_investors i JOIN raw_user_events e ON e.investor_id = i.investor_id WHERE i.account_activated_date IS NULL AND (i.kyc_status <> 'verified' OR i.bank_verified_date IS NULL) AND e.event_name IN ('fund_searched', 'fund_page_viewed', 'fund_watchlisted', 'sip_flow_started', 'sip_amount_entered', 'sip_flow_abandoned')",
  },
  {
    slug: "b30-equity",
    name: "B30 Equity SIP Investors",
    description: "B30 investors with active equity or ELSS SIPs.",
    sql: "SELECT DISTINCT investor_id FROM sips_full WHERE status = 'active' AND city_tier = 'b30' AND fund_category IN ('equity', 'elss')",
  },
  {
    slug: "fi-select",
    name: "FI Select Investors",
    description: "Investors buying or holding curated FI Select funds.",
    sql: "SELECT DISTINCT investor_id FROM transactions_full WHERE status = 'success' AND is_fi_select = true",
  },
  {
    slug: "elss-season",
    name: "ELSS Tax Savers",
    description: "Investors who purchased ELSS funds in the tax-planning window.",
    sql: "SELECT DISTINCT investor_id FROM transactions_full WHERE status = 'success' AND fund_category = 'elss' AND EXTRACT(MONTH FROM txn_date) IN (1, 2, 3)",
  },
];

const FUNNELS: Array<{ slug: string; name: string; description: string; config: FunnelConfig }> = [
  {
    slug: "activation",
    name: "Investor Activation Funnel",
    description: "Signup to account activation to first investment.",
    config: {
      steps: [{ eventId: "investor_signup" }, { eventId: "account_activated" }, { eventId: "first_investment" }],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "sip-start",
    name: "SIP Start Funnel",
    description: "Activated investors creating SIPs and completing installments.",
    config: {
      steps: [{ eventId: "account_activated" }, { eventId: "sip_created" }, { eventId: "sip_installment" }],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "advisory",
    name: "Advisory Follow-Through",
    description: "Advisor sessions followed by investment activity.",
    config: {
      steps: [{ eventId: "advisor_session" }, { eventId: "advisory_followed" }, { eventId: "purchase" }],
      conversionWindow: "90d",
      // any_order (>=) so a "followed" outcome logged in the same advisory session
      // qualifies; this_order's strict > collapsed 8,444 followed investors to 331.
      order: "any_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "full-onboarding",
    name: "Full Onboarding to First Investment",
    description: "Signup through PAN, KYC, bank verification, and activation to first investment, split by acquisition channel.",
    config: {
      steps: [
        { eventId: "investor_signup" },
        { eventId: "pan_confirmed" },
        { eventId: "kyc_verified" },
        { eventId: "bank_verified" },
        { eventId: "account_activated" },
        { eventId: "first_investment" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
      breakdown: "acquisition_channel",
    },
  },
  {
    slug: "activated-to-recurring-sip",
    name: "Activated to Recurring SIP",
    description: "Activated investors moving from first investment to repeat purchases, a created SIP, and a paid SIP installment, split by acquisition channel.",
    config: {
      steps: [
        { eventId: "account_activated" },
        { eventId: "first_investment" },
        { eventId: "purchase" },
        { eventId: "sip_created" },
        { eventId: "sip_installment" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
      breakdown: "acquisition_channel",
    },
  },
  {
    slug: "behavioral-sip-flow",
    name: "Discovery to Paid SIP (Behavioral)",
    description: "In-app behavior from fund discovery through the SIP setup flow to the first paid installment, split by city tier.",
    config: {
      steps: [
        { eventId: "fund_page_viewed" },
        { eventId: "sip_flow_started" },
        { eventId: "sip_amount_entered" },
        { eventId: "sip_created_app_event" },
        { eventId: "sip_installment" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
      breakdown: "city_tier",
    },
  },
];

const DORMANT_HOLDERS_PLAYBOOK_SLUG = "dormant-holders";

export function buildFundsIndiaDormantHoldersPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", DORMANT_HOLDERS_PLAYBOOK_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "Dormant Current Fund Holders",
    description: "Identify investors who still hold current fund positions but have no portfolio/dashboard visits, fund searches, or email clicks in the last 60 days, then summarize the dormant-holder segment.",
    category: "Lifecycle",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: FUNDSINDIA_DATASET_ID,
    sourceQuery: "Identify investors who still hold current fund positions but have shown no portfolio/dashboard visits, fund searches, or email clicks in the last 60 days, then summarize the dormant-holder segment.",
    params: [
      { name: "as_of_date", label: "As-of date", type: "date", defaultVal: "2026-05-28", group: "Dormancy window" },
      { name: "dormancy_days", label: "Dormancy days", type: "integer", defaultVal: "60", group: "Dormancy window" },
      { name: "priority_limit", label: "Priority investor rows", type: "integer", defaultVal: "50", group: "Output" },
    ],
    produces: [
      {
        name: "dormant_holders",
        description: "Investor-level dormant-holder segment with portfolio value, last core engagement date, demographics, and current holding traits.",
        columns: [
          { name: "investor_id", description: "FundsIndia investor identifier." },
          { name: "net_invested_inr", description: "Current invested value across fund positions." },
          { name: "days_since_last_core_engagement", description: "Days since last dashboard, portfolio, search, or email-click event before the as-of date." },
          { name: "portfolio_value_bucket", description: "Current value bucket for prioritization." },
        ],
      },
      {
        name: "dormant_holder_kpis",
        description: "Headline segment size, dormant-holder rate, AUM at risk, and priority cohort counts.",
      },
      {
        name: "dormant_priority_investors",
        description: "Top dormant current holders by current invested value for follow-up action planning.",
      },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Dormancy Inputs",
        description: "Confirm current-holder records and core engagement events exist for the selected 60-day dormancy window.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT
    'current_holders' AS check_name,
    COUNT(DISTINCT investor_id) AS record_count
  FROM investor_portfolio_summary
  WHERE has_current_holding = true
  UNION ALL
  SELECT
    'core_engagement_events_in_window' AS check_name,
    COUNT(*) AS record_count
  FROM user_events_full
  WHERE investor_id IS NOT NULL
    AND event_name IN ('dashboard_visited', 'portfolio_visited', 'fund_searched', 'email_link_clicked')
    AND CAST(event_timestamp AS DATE) > CAST({{as_of_date}} AS DATE) - ({{dormancy_days}} * INTERVAL '1 day')
    AND CAST(event_timestamp AS DATE) <= CAST({{as_of_date}} AS DATE)
  UNION ALL
  SELECT
    'email_click_events_in_window' AS check_name,
    COUNT(*) AS record_count
  FROM user_events_full
  WHERE investor_id IS NOT NULL
    AND event_name = 'email_link_clicked'
    AND CAST(event_timestamp AS DATE) > CAST({{as_of_date}} AS DATE) - ({{dormancy_days}} * INTERVAL '1 day')
    AND CAST(event_timestamp AS DATE) <= CAST({{as_of_date}} AS DATE)
)
SELECT
  check_name,
  record_count,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks`,
      },
      {
        id: "c2_dormant_segment",
        label: "Build Dormant Holder Segment",
        description: "Create the investor-level segment: current fund holders with zero core engagement events in the dormancy window.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["dormant_holders"],
        sql: `WITH recent_core_engagement AS (
  SELECT
    investor_id,
    COUNT(*) AS core_events_60d,
    COUNT(*) FILTER (WHERE event_name = 'dashboard_visited') AS dashboard_visits_60d,
    COUNT(*) FILTER (WHERE event_name = 'portfolio_visited') AS portfolio_visits_60d,
    COUNT(*) FILTER (WHERE event_name = 'fund_searched') AS fund_searches_60d,
    COUNT(*) FILTER (WHERE event_name = 'email_link_clicked') AS email_clicks_60d,
    MAX(CAST(event_timestamp AS DATE)) AS last_core_engagement_in_window
  FROM user_events_full
  WHERE investor_id IS NOT NULL
    AND event_name IN ('dashboard_visited', 'portfolio_visited', 'fund_searched', 'email_link_clicked')
    AND CAST(event_timestamp AS DATE) > CAST({{as_of_date}} AS DATE) - ({{dormancy_days}} * INTERVAL '1 day')
    AND CAST(event_timestamp AS DATE) <= CAST({{as_of_date}} AS DATE)
  GROUP BY investor_id
),
last_core_engagement AS (
  SELECT
    investor_id,
    MAX(CAST(event_timestamp AS DATE)) AS last_core_engagement_date
  FROM user_events_full
  WHERE investor_id IS NOT NULL
    AND event_name IN ('dashboard_visited', 'portfolio_visited', 'fund_searched', 'email_link_clicked')
    AND CAST(event_timestamp AS DATE) <= CAST({{as_of_date}} AS DATE)
  GROUP BY investor_id
)
SELECT
  p.investor_id,
  p.net_invested_inr,
  p.net_units,
  p.current_fund_count,
  p.current_category_count,
  p.current_amc_count,
  p.dominant_current_category,
  p.dominant_current_amc,
  p.portfolio_value_bucket,
  p.portfolio_breadth_bucket,
  p.city_tier,
  p.state,
  p.city,
  p.risk_profile,
  p.acquisition_channel,
  p.annual_income,
  p.age,
  p.has_fi_select_holding,
  p.has_elss_holding,
  p.has_sip_linked_holding,
  p.last_purchase_date,
  p.last_activity_date AS last_investment_activity_date,
  l.last_core_engagement_date,
  date_diff('day', l.last_core_engagement_date, CAST({{as_of_date}} AS DATE)) AS days_since_last_core_engagement,
  CASE
    WHEN l.last_core_engagement_date IS NULL THEN 'never_seen_in_core_events'
    WHEN date_diff('day', l.last_core_engagement_date, CAST({{as_of_date}} AS DATE)) BETWEEN 61 AND 90 THEN '61-90 days'
    WHEN date_diff('day', l.last_core_engagement_date, CAST({{as_of_date}} AS DATE)) BETWEEN 91 AND 180 THEN '91-180 days'
    WHEN date_diff('day', l.last_core_engagement_date, CAST({{as_of_date}} AS DATE)) > 180 THEN '180+ days'
    ELSE 'within_window'
  END AS dormant_tenure_bucket,
  COALESCE(r.core_events_60d, 0) AS core_events_60d,
  COALESCE(r.dashboard_visits_60d, 0) AS dashboard_visits_60d,
  COALESCE(r.portfolio_visits_60d, 0) AS portfolio_visits_60d,
  COALESCE(r.fund_searches_60d, 0) AS fund_searches_60d,
  COALESCE(r.email_clicks_60d, 0) AS email_clicks_60d
FROM investor_portfolio_summary p
LEFT JOIN recent_core_engagement r ON p.investor_id = r.investor_id
LEFT JOIN last_core_engagement l ON p.investor_id = l.investor_id
WHERE p.has_current_holding = true
  AND r.investor_id IS NULL`,
      },
      {
        id: "c3_segment_kpis",
        label: "Size Dormant Holder Opportunity",
        description: "Calculate dormant-holder count, share of current holders, invested value, and high-priority opportunity size.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_dormant_segment"],
        outputs: ["dormant_holder_kpis"],
        sql: `WITH current_holders AS (
  SELECT
    COUNT(*) AS current_holder_count,
    SUM(net_invested_inr) AS current_holder_net_invested_inr
  FROM investor_portfolio_summary
  WHERE has_current_holding = true
),
dormant AS (
  SELECT * FROM dormant_holders
)
SELECT
  CAST({{as_of_date}} AS DATE) AS as_of_date,
  {{dormancy_days}} AS dormancy_days,
  ch.current_holder_count,
  COUNT(*) AS dormant_holder_count,
  ROUND(COUNT(*) * 100.0 / NULLIF(ch.current_holder_count, 0), 2) AS dormant_holder_rate_pct,
  ROUND(SUM(d.net_invested_inr), 0) AS dormant_net_invested_inr,
  ROUND(SUM(d.net_invested_inr) * 100.0 / NULLIF(ch.current_holder_net_invested_inr, 0), 2) AS dormant_net_invested_share_pct,
  ROUND(AVG(d.net_invested_inr), 0) AS avg_dormant_net_invested_inr,
  COUNT(*) FILTER (WHERE d.portfolio_value_bucket = '>2L') AS dormant_gt_2l_holders,
  ROUND(SUM(CASE WHEN d.portfolio_value_bucket = '>2L' THEN d.net_invested_inr ELSE 0 END), 0) AS dormant_gt_2l_net_invested_inr,
  COUNT(*) FILTER (WHERE d.has_sip_linked_holding = true) AS dormant_sip_linked_holders,
  COUNT(*) FILTER (WHERE d.has_fi_select_holding = true) AS dormant_fi_select_holders,
  ROUND(AVG(d.days_since_last_core_engagement), 1) AS avg_days_since_last_core_engagement
FROM dormant d
CROSS JOIN current_holders ch
GROUP BY ch.current_holder_count, ch.current_holder_net_invested_inr`,
      },
      {
        id: "c4_profile_breakdown",
        label: "Profile Dormant Holders",
        description: "Break the dormant-holder segment by portfolio value, risk profile, city tier, acquisition channel, and dormant tenure.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_dormant_segment"],
        outputs: ["dormant_holder_profile"],
        sql: `WITH base AS (
  SELECT * FROM dormant_holders
)
SELECT * FROM (
  SELECT
    'Portfolio value' AS dimension_type,
    portfolio_value_bucket AS segment_value,
    COUNT(*) AS dormant_holders,
    ROUND(SUM(net_invested_inr), 0) AS net_invested_inr,
    ROUND(AVG(net_invested_inr), 0) AS avg_net_invested_inr,
    ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS share_of_dormant_pct
  FROM base
  GROUP BY portfolio_value_bucket
  UNION ALL
  SELECT
    'Risk profile' AS dimension_type,
    risk_profile AS segment_value,
    COUNT(*) AS dormant_holders,
    ROUND(SUM(net_invested_inr), 0) AS net_invested_inr,
    ROUND(AVG(net_invested_inr), 0) AS avg_net_invested_inr,
    ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS share_of_dormant_pct
  FROM base
  GROUP BY risk_profile
  UNION ALL
  SELECT
    'City tier' AS dimension_type,
    city_tier AS segment_value,
    COUNT(*) AS dormant_holders,
    ROUND(SUM(net_invested_inr), 0) AS net_invested_inr,
    ROUND(AVG(net_invested_inr), 0) AS avg_net_invested_inr,
    ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS share_of_dormant_pct
  FROM base
  GROUP BY city_tier
  UNION ALL
  SELECT
    'Acquisition channel' AS dimension_type,
    acquisition_channel AS segment_value,
    COUNT(*) AS dormant_holders,
    ROUND(SUM(net_invested_inr), 0) AS net_invested_inr,
    ROUND(AVG(net_invested_inr), 0) AS avg_net_invested_inr,
    ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS share_of_dormant_pct
  FROM base
  GROUP BY acquisition_channel
  UNION ALL
  SELECT
    'Dormant tenure' AS dimension_type,
    dormant_tenure_bucket AS segment_value,
    COUNT(*) AS dormant_holders,
    ROUND(SUM(net_invested_inr), 0) AS net_invested_inr,
    ROUND(AVG(net_invested_inr), 0) AS avg_net_invested_inr,
    ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS share_of_dormant_pct
  FROM base
  GROUP BY dormant_tenure_bucket
) profile
ORDER BY dimension_type, dormant_holders DESC`,
      },
      {
        id: "c5_fund_exposure",
        label: "Map Fund Exposure",
        description: "Show where dormant-holder value is concentrated by fund category and AMC.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_dormant_segment"],
        outputs: ["dormant_holder_exposure"],
        sql: `WITH dormant AS (
  SELECT investor_id FROM dormant_holders
),
positions AS (
  SELECT
    p.investor_id,
    p.fund_category,
    p.amc_name,
    p.net_invested_inr,
    p.is_fi_select,
    p.is_sip_linked
  FROM investor_fund_positions p
  INNER JOIN dormant d ON p.investor_id = d.investor_id
  WHERE p.is_current_holding = true
)
SELECT * FROM (
  SELECT
    'Fund category' AS exposure_type,
    fund_category AS exposure,
    COUNT(DISTINCT investor_id) AS dormant_holders,
    ROUND(SUM(net_invested_inr), 0) AS net_invested_inr,
    ROUND(AVG(net_invested_inr), 0) AS avg_position_value_inr,
    COUNT(DISTINCT investor_id) FILTER (WHERE is_sip_linked = true) AS sip_linked_holders,
    COUNT(DISTINCT investor_id) FILTER (WHERE is_fi_select = true) AS fi_select_holders
  FROM positions
  GROUP BY fund_category
  UNION ALL
  SELECT
    'AMC' AS exposure_type,
    amc_name AS exposure,
    COUNT(DISTINCT investor_id) AS dormant_holders,
    ROUND(SUM(net_invested_inr), 0) AS net_invested_inr,
    ROUND(AVG(net_invested_inr), 0) AS avg_position_value_inr,
    COUNT(DISTINCT investor_id) FILTER (WHERE is_sip_linked = true) AS sip_linked_holders,
    COUNT(DISTINCT investor_id) FILTER (WHERE is_fi_select = true) AS fi_select_holders
  FROM positions
  GROUP BY amc_name
) exposure
ORDER BY exposure_type, net_invested_inr DESC
LIMIT 30`,
      },
      {
        id: "c6_engagement_evidence",
        label: "Explain Inactivity Evidence",
        description: "Summarize dormant tenure and recent CRM touches to separate unreachable holders from quiet but reachable holders.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_dormant_segment"],
        outputs: ["dormant_holder_engagement_evidence"],
        sql: `WITH dormant AS (
  SELECT * FROM dormant_holders
),
recent_comms AS (
  SELECT
    investor_id,
    COUNT(*) FILTER (
      WHERE CAST(sent_at AS DATE) > CAST({{as_of_date}} AS DATE) - (90 * INTERVAL '1 day')
        AND CAST(sent_at AS DATE) <= CAST({{as_of_date}} AS DATE)
    ) AS messages_sent_90d,
    COUNT(*) FILTER (
      WHERE opened = true
        AND CAST(sent_at AS DATE) > CAST({{as_of_date}} AS DATE) - (90 * INTERVAL '1 day')
        AND CAST(sent_at AS DATE) <= CAST({{as_of_date}} AS DATE)
    ) AS messages_opened_90d,
    COUNT(*) FILTER (
      WHERE clicked = true
        AND CAST(sent_at AS DATE) > CAST({{as_of_date}} AS DATE) - (90 * INTERVAL '1 day')
        AND CAST(sent_at AS DATE) <= CAST({{as_of_date}} AS DATE)
    ) AS messages_clicked_90d
  FROM comms_full
  GROUP BY investor_id
)
SELECT
  d.dormant_tenure_bucket,
  d.acquisition_channel,
  COUNT(*) AS dormant_holders,
  ROUND(SUM(d.net_invested_inr), 0) AS net_invested_inr,
  ROUND(AVG(d.current_fund_count), 2) AS avg_current_fund_count,
  SUM(COALESCE(c.messages_sent_90d, 0)) AS messages_sent_90d,
  SUM(COALESCE(c.messages_opened_90d, 0)) AS messages_opened_90d,
  SUM(COALESCE(c.messages_clicked_90d, 0)) AS messages_clicked_90d
FROM dormant d
LEFT JOIN recent_comms c ON d.investor_id = c.investor_id
GROUP BY d.dormant_tenure_bucket, d.acquisition_channel
ORDER BY dormant_holders DESC
LIMIT 25`,
      },
      {
        id: "c7_priority_list",
        label: "Rank Priority Investors",
        description: "Return the highest-value dormant current holders to power follow-up, export, or campaign creation.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_dormant_segment"],
        outputs: ["dormant_priority_investors"],
        sql: `SELECT
  investor_id,
  ROUND(net_invested_inr, 0) AS net_invested_inr,
  portfolio_value_bucket,
  current_fund_count,
  current_category_count,
  current_amc_count,
  dominant_current_category,
  dominant_current_amc,
  city_tier,
  risk_profile,
  acquisition_channel,
  has_sip_linked_holding,
  has_fi_select_holding,
  last_core_engagement_date,
  days_since_last_core_engagement,
  dormant_tenure_bucket
FROM dormant_holders
ORDER BY net_invested_inr DESC, current_fund_count DESC, investor_id
LIMIT {{priority_limit}}`,
      },
      {
        id: "c8_segment_analysis",
        label: "Diagnose Dormant Holder Segment",
        description: "Interpret the dormant-holder shape, concentration, and follow-up priority using the computed data.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_segment_kpis", "c4_profile_breakdown", "c5_fund_exposure", "c6_engagement_evidence", "c7_priority_list"],
        outputs: ["dormant_holder_diagnosis"],
        prompt: `Analyze the dormant current-holder segment using only the upstream query results.

Focus on:
- how large the segment is relative to all current fund holders;
- how much current invested value is attached to it;
- which portfolio-value, risk, city-tier, acquisition, fund-category, and AMC slices are most concentrated;
- what the lack of last-60-day dashboard/portfolio/search/email-click activity implies operationally;
- which investors should be prioritized first for compliant reactivation.

Use actual numbers from the tables. Do not make return promises or investment advice claims.`,
      },
      {
        id: "c9_final_summary",
        label: "Dormant Holder Activation Brief",
        description: "Produce the final rich segment summary with KPI table, charts, operational interpretation, and recommended next actions.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c3_segment_kpis", "c4_profile_breakdown", "c5_fund_exposure", "c6_engagement_evidence", "c7_priority_list", "c8_segment_analysis"],
        outputs: ["dormant_holder_activation_brief"],
        prompt: `Create a rich executive-ready markdown brief for the dormant-holder segment.

The brief must include:
1. A one-paragraph direct answer defining the dormant-holder segment exactly as: current fund holders with zero dashboard visits, portfolio visits, fund searches, or email link clicks in the last {{dormancy_days}} days as of {{as_of_date}}.
2. A compact KPI table with current-holder base, dormant-holder count, dormant rate, dormant invested value, value share, high-value count, SIP-linked count, and FI Select count.
3. At least two charts when supported by upstream rows:
   - dormant holders by portfolio value or dormant tenure;
   - invested value by fund category or AMC.
4. A profile section naming the highest-concentration slices and why they matter.
5. A priority-action section: who to contact first, what message angle to use, and what operational guardrails to keep.
6. A short SQL provenance note naming the core source views: investor_portfolio_summary, investor_fund_positions, user_events_full, and comms_full.

Use raw rupee values from the data. Keep recommendations compliant: no guaranteed returns, no tax promises, no personalized investment advice.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded dormant current-holder analysis for FundsIndia.",
        changes: [
          {
            type: "add",
            cellLabel: "Dormant holder segment",
            cellId: "c2_dormant_segment",
            detail: "Defines current fund holders with no dashboard, portfolio, search, or email-click activity in the dormancy window.",
          },
        ],
      },
    ],
  };
}

const SIP_CANCELLATION_SAVE_PLAYBOOK_SLUG = "sip-cancellation-save";

export function buildFundsIndiaSipCancellationSavePlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", SIP_CANCELLATION_SAVE_PLAYBOOK_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "SIP Cancellation Save Pipeline",
    description:
      "Find the active SIPs most likely to cancel next, size the monthly and annualized SIP value at risk, learn what actually drives historical cancellations, and hand collections/retention a CRM-reachable, value-ranked save list.",
    category: "Retention",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: FUNDSINDIA_DATASET_ID,
    sourceQuery:
      "Which active SIPs are most at risk of cancelling, how much recurring SIP value is at stake, what drives our cancellations historically, and who should retention call first?",
    params: [
      { name: "as_of_date", label: "As-of date", type: "date", defaultVal: "2026-05-28", group: "Window" },
      { name: "failure_lookback_days", label: "Recent-failure lookback (days)", type: "integer", defaultVal: "90", group: "Window" },
      { name: "comms_lookback_days", label: "CRM reach lookback (days)", type: "integer", defaultVal: "90", group: "Window" },
      { name: "priority_limit", label: "Priority SIP rows", type: "integer", defaultVal: "50", group: "Output" },
    ],
    produces: [
      {
        name: "at_risk_sips",
        description: "Active SIPs flagged at cancellation risk from recent installment failures or low early commitment, with a risk tier.",
        columns: [
          { name: "sip_id", description: "Systematic investment plan identifier." },
          { name: "investor_id", description: "FundsIndia investor identifier." },
          { name: "failed_installments_90d", description: "Count of failed installments on this SIP inside the failure window." },
          { name: "risk_tier", description: "Cancellation-risk tier from failure recency and installment maturity." },
        ],
      },
      { name: "cancellation_drivers", description: "Historical cancelled-SIP counts, monthly value lost, and average installments before cancel by reason and mandate type." },
      { name: "save_pipeline_kpis", description: "Headline at-risk SIP count, at-risk rate, monthly and annualized SIP value at risk, and distinct investors." },
      { name: "save_reachability", description: "At-risk SIPs by risk tier and mandate type with how many investors are CRM-reachable and engaging." },
      { name: "save_priority_sips", description: "Highest-value at-risk SIPs ranked for retention follow-up." },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Cancellation Inputs",
        description: "Confirm cancelled SIPs, active SIPs, and failed SIP installments all exist before building the save pipeline.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT 'cancelled_sips' AS check_name, COUNT(*) AS record_count FROM sips_full WHERE status = 'cancelled'
  UNION ALL
  SELECT 'active_sips' AS check_name, COUNT(*) AS record_count FROM sips_full WHERE status = 'active'
  UNION ALL
  SELECT 'failed_sip_installments' AS check_name, COUNT(*) AS record_count
  FROM transactions_full
  WHERE status = 'failed' AND txn_type = 'sip_installment'
)
SELECT
  check_name,
  record_count,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks`,
      },
      {
        id: "c2_at_risk_segment",
        label: "Build At-Risk SIP Segment",
        description: "Flag active SIPs showing cancellation-risk signals: one or more failed installments in the window, or an early-stage SIP with three or fewer installments paid. Note: failed installment rows carry no amount, so SIP value is taken from sips_full.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["at_risk_sips"],
        sql: `WITH recent_fails AS (
  SELECT
    sip_id,
    COUNT(*) AS failed_installments_90d,
    MAX(txn_date) AS last_failed_date
  FROM transactions_full
  WHERE txn_type = 'sip_installment'
    AND status = 'failed'
    AND sip_id IS NOT NULL
    AND txn_date > CAST({{as_of_date}} AS DATE) - ({{failure_lookback_days}} * INTERVAL '1 day')
    AND txn_date <= CAST({{as_of_date}} AS DATE)
  GROUP BY sip_id
)
SELECT
  s.sip_id,
  s.investor_id,
  s.amount_inr,
  s.mandate_type,
  s.fund_category,
  s.city_tier,
  s.risk_profile,
  s.acquisition_channel,
  s.total_installments_paid,
  date_diff('day', s.start_date, CAST({{as_of_date}} AS DATE)) AS sip_age_days,
  COALESCE(rf.failed_installments_90d, 0) AS failed_installments_90d,
  rf.last_failed_date,
  CASE
    WHEN COALESCE(rf.failed_installments_90d, 0) >= 2 THEN '1. high (2+ recent fails)'
    WHEN COALESCE(rf.failed_installments_90d, 0) = 1 THEN '2. medium (1 recent fail)'
    WHEN s.total_installments_paid <= 3 THEN '3. early-stage low-commitment'
    ELSE '4. watch'
  END AS risk_tier
FROM sips_full s
LEFT JOIN recent_fails rf ON rf.sip_id = s.sip_id
WHERE s.status = 'active'
  AND (rf.sip_id IS NOT NULL OR s.total_installments_paid <= 3)`,
      },
      {
        id: "c3_cancellation_drivers",
        label: "Diagnose Historical Cancellations",
        description: "Break already-cancelled SIPs by reason and mandate type to show what really drives churn and how much recurring value each driver has cost.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["cancellation_drivers"],
        sql: `SELECT
  COALESCE(cancellation_reason, 'not_recorded') AS cancellation_reason,
  mandate_type,
  COUNT(*) AS cancelled_sips,
  ROUND(AVG(total_installments_paid), 1) AS avg_installments_before_cancel,
  ROUND(AVG(amount_inr), 0) AS avg_sip_amount_inr,
  ROUND(SUM(amount_inr), 0) AS monthly_sip_value_lost_inr,
  ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS share_of_cancelled_pct
FROM sips_full
WHERE status = 'cancelled'
GROUP BY COALESCE(cancellation_reason, 'not_recorded'), mandate_type
ORDER BY cancelled_sips DESC`,
      },
      {
        id: "c4_save_kpis",
        label: "Size the Save Opportunity",
        description: "Quantify the at-risk SIP count, at-risk rate against the active book, monthly and annualized SIP value at risk, and how many distinct investors are involved.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_at_risk_segment"],
        outputs: ["save_pipeline_kpis"],
        sql: `WITH active_base AS (
  SELECT COUNT(*) AS active_sips, SUM(amount_inr) AS active_monthly_inr
  FROM sips_full
  WHERE status = 'active'
),
at_risk AS (
  SELECT * FROM at_risk_sips
)
SELECT
  CAST({{as_of_date}} AS DATE) AS as_of_date,
  ab.active_sips,
  COUNT(*) AS at_risk_sips,
  ROUND(COUNT(*) * 100.0 / NULLIF(ab.active_sips, 0), 2) AS at_risk_rate_pct,
  ROUND(SUM(a.amount_inr), 0) AS monthly_sip_value_at_risk_inr,
  ROUND(SUM(a.amount_inr) * 12, 0) AS annualized_sip_value_at_risk_inr,
  COUNT(*) FILTER (WHERE a.risk_tier = '1. high (2+ recent fails)') AS high_risk_sips,
  COUNT(*) FILTER (WHERE a.failed_installments_90d > 0) AS sips_with_recent_failure,
  COUNT(DISTINCT a.investor_id) AS distinct_investors
FROM at_risk a
CROSS JOIN active_base ab
GROUP BY ab.active_sips, ab.active_monthly_inr`,
      },
      {
        id: "c5_save_reachability",
        label: "Map CRM Reachability",
        description: "Cross-reference at-risk SIPs against recent CRM communications so retention can see which tiers and mandate types are reachable and already engaging.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_at_risk_segment"],
        outputs: ["save_reachability"],
        sql: `WITH at_risk AS (
  SELECT * FROM at_risk_sips
),
comms_window AS (
  SELECT
    investor_id,
    COUNT(*) AS messages_sent,
    COUNT(*) FILTER (WHERE opened = true) AS messages_opened,
    COUNT(*) FILTER (WHERE clicked = true) AS messages_clicked
  FROM comms_full
  WHERE CAST(sent_at AS DATE) > CAST({{as_of_date}} AS DATE) - ({{comms_lookback_days}} * INTERVAL '1 day')
    AND CAST(sent_at AS DATE) <= CAST({{as_of_date}} AS DATE)
  GROUP BY investor_id
)
SELECT
  a.risk_tier,
  a.mandate_type,
  COUNT(*) AS at_risk_sips,
  ROUND(SUM(a.amount_inr), 0) AS monthly_value_at_risk_inr,
  COUNT(*) FILTER (WHERE c.investor_id IS NOT NULL) AS reached_in_window,
  SUM(COALESCE(c.messages_opened, 0)) AS messages_opened,
  SUM(COALESCE(c.messages_clicked, 0)) AS messages_clicked
FROM at_risk a
LEFT JOIN comms_window c ON c.investor_id = a.investor_id
GROUP BY a.risk_tier, a.mandate_type
ORDER BY a.risk_tier, monthly_value_at_risk_inr DESC`,
      },
      {
        id: "c6_priority_list",
        label: "Rank Priority Saves",
        description: "Return the highest-value at-risk SIPs, ranked by recent failures then SIP amount, to power retention calling, export, or a save campaign.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_at_risk_segment"],
        outputs: ["save_priority_sips"],
        sql: `SELECT
  investor_id,
  sip_id,
  amount_inr,
  mandate_type,
  fund_category,
  city_tier,
  risk_profile,
  acquisition_channel,
  total_installments_paid,
  failed_installments_90d,
  last_failed_date,
  risk_tier
FROM at_risk_sips
ORDER BY failed_installments_90d DESC, amount_inr DESC, sip_id
LIMIT {{priority_limit}}`,
      },
      {
        id: "c7_analysis",
        label: "Diagnose the Save Pipeline",
        description: "Interpret the at-risk segment, historical drivers, reachability, and priority list to locate where SIP value leaks and where a save attempt is most worthwhile.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_cancellation_drivers", "c4_save_kpis", "c5_save_reachability", "c6_priority_list"],
        outputs: ["save_pipeline_diagnosis"],
        prompt: `Analyze the SIP cancellation save pipeline using only the upstream query results.

Address:
- how large the at-risk active SIP book is and how much recurring value (monthly and annualized) is exposed;
- which historical cancellation reasons and mandate types dominate, and what that says about whether failures are payment-mechanical (financial_constraint, mandate failure) versus conviction-led (returns_unsatisfactory, switched_platform);
- which risk tiers are CRM-reachable versus dark, and where engagement (opens, clicks) suggests a save attempt can land;
- which investors should be called first for a compliant retention conversation.

Quote actual counts, values, and percentages from the tables. Do not fabricate numbers and do not make return promises or investment-advice claims.`,
      },
      {
        id: "c8_summary",
        label: "SIP Save Action Brief",
        description: "Produce the final executive brief with the KPI table, cancellation-driver and reachability charts, and a prioritized save plan.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c3_cancellation_drivers", "c4_save_kpis", "c5_save_reachability", "c6_priority_list", "c7_analysis"],
        outputs: ["save_action_brief"],
        prompt: `Create a rich, executive-ready markdown brief titled "SIP Cancellation Save Pipeline" for the retention and CRM leadership.

The brief must include:
1. A one-paragraph headline answer stating, as of {{as_of_date}}, the at-risk active SIP count, the at-risk rate, and the monthly and annualized SIP value at risk.
2. A KPI table: active SIPs, at-risk SIPs, at-risk rate, monthly value at risk, annualized value at risk, high-risk SIPs, SIPs with a recent failure, and distinct investors.
3. At least two charts when the upstream rows support them: cancelled SIPs (or value lost) by cancellation reason, and at-risk SIPs or value at risk by risk tier.
4. A drivers section separating payment-mechanical churn from conviction-led churn, each with a different recommended save play.
5. A priority-action section: who to contact first, what angle to use (mandate fix, step-down, reassurance), and the compliance guardrails to keep.
6. A short SQL provenance note naming the source views: sips_full, transactions_full, and comms_full.

Use raw values and percentages from the data. Keep recommendations compliant: no guaranteed returns, no tax promises, no personalized investment advice.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded SIP cancellation save pipeline for FundsIndia.",
        changes: [
          {
            type: "add",
            cellLabel: "At-risk SIP segment",
            cellId: "c2_at_risk_segment",
            detail: "Flags active SIPs at cancellation risk from recent installment failures and low early commitment.",
          },
        ],
      },
    ],
  };
}

const NACH_MANDATE_RECOVERY_PLAYBOOK_SLUG = "nach-mandate-failure-recovery";

export function buildFundsIndiaNachMandateRecoveryPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", NACH_MANDATE_RECOVERY_PLAYBOOK_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "NACH Mandate Failure Recovery",
    description:
      "Track failed SIP installments by mandate type and payment mode, measure how many recover within a follow-up window, expose where failures turn into cancelled SIPs versus self-cure, and hand operations a value-ranked list of unrecovered active SIPs to fix before the mandate lapses.",
    category: "Operations",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: FUNDSINDIA_DATASET_ID,
    sourceQuery:
      "How many SIP installments are failing on NACH versus UPI autopay, how many recover, where do failures turn into churn, and which failed mandates should operations fix first?",
    params: [
      { name: "as_of_date", label: "As-of date", type: "date", defaultVal: "2026-05-28", group: "Window" },
      { name: "failure_lookback_days", label: "Failure lookback (days)", type: "integer", defaultVal: "180", group: "Window" },
      { name: "recovery_window_days", label: "Recovery follow-up window (days)", type: "integer", defaultVal: "45", group: "Window" },
      { name: "priority_limit", label: "Priority SIP rows", type: "integer", defaultVal: "50", group: "Output" },
    ],
    produces: [
      {
        name: "mandate_failure_base",
        description: "Distinct SIP installment failures in the window with SIP amount, mandate type, and whether a successful installment followed inside the recovery window.",
        columns: [
          { name: "sip_id", description: "Systematic investment plan identifier." },
          { name: "failed_date", description: "Date the installment failed." },
          { name: "sip_amount_inr", description: "Monthly SIP amount from sips_full (failed txn rows carry no amount)." },
          { name: "recovered_45d", description: "1 if a successful installment followed within the recovery window, else 0." },
        ],
      },
      { name: "recovery_by_mandate", description: "Failure volume, value disrupted, and recovery rate by mandate type and payment mode." },
      { name: "failure_funnel", description: "Per-failed-SIP funnel by city tier: failed, recovered, unrecovered-but-active, and churned-after-failure with recovery rate." },
      { name: "recovery_priority_sips", description: "Highest-value unrecovered active SIPs for operations to fix before the mandate lapses." },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Mandate Failure Inputs",
        description: "Confirm failed installments in the window, failed NACH installments, and multiple payment modes exist before running the recovery analysis.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT 'failed_installments_in_window' AS check_name, COUNT(*) AS record_count
  FROM transactions_full
  WHERE txn_type = 'sip_installment'
    AND status = 'failed'
    AND txn_date > CAST({{as_of_date}} AS DATE) - ({{failure_lookback_days}} * INTERVAL '1 day')
    AND txn_date <= CAST({{as_of_date}} AS DATE)
  UNION ALL
  SELECT 'failed_nach_installments' AS check_name, COUNT(*) AS record_count
  FROM transactions_full
  WHERE txn_type = 'sip_installment' AND status = 'failed' AND payment_mode = 'nach'
  UNION ALL
  SELECT 'distinct_payment_modes' AS check_name, COUNT(DISTINCT payment_mode) AS record_count
  FROM transactions_full
  WHERE txn_type = 'sip_installment'
)
SELECT
  check_name,
  record_count,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks`,
      },
      {
        id: "c2_failure_base",
        label: "Build Mandate Failure Base",
        description: "Identify each SIP installment failure in the window, attach the SIP's monthly amount and mandate type from sips_full, and flag whether a successful installment followed within the recovery window.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["mandate_failure_base"],
        sql: `WITH failures AS (
  SELECT DISTINCT
    t.sip_id,
    t.investor_id,
    t.txn_date AS failed_date,
    t.payment_mode
  FROM transactions_full t
  WHERE t.txn_type = 'sip_installment'
    AND t.status = 'failed'
    AND t.sip_id IS NOT NULL
    AND t.txn_date > CAST({{as_of_date}} AS DATE) - ({{failure_lookback_days}} * INTERVAL '1 day')
    AND t.txn_date <= CAST({{as_of_date}} AS DATE)
)
SELECT
  f.sip_id,
  f.investor_id,
  f.failed_date,
  f.payment_mode,
  s.amount_inr AS sip_amount_inr,
  s.mandate_type,
  s.fund_category,
  s.city_tier,
  s.risk_profile,
  s.acquisition_channel,
  s.status AS sip_status,
  CASE WHEN EXISTS (
    SELECT 1
    FROM transactions_full r
    WHERE r.sip_id = f.sip_id
      AND r.txn_type = 'sip_installment'
      AND r.status = 'success'
      AND r.txn_date > f.failed_date
      AND r.txn_date <= f.failed_date + ({{recovery_window_days}} * INTERVAL '1 day')
  ) THEN 1 ELSE 0 END AS recovered_45d
FROM failures f
JOIN sips_full s ON s.sip_id = f.sip_id`,
      },
      {
        id: "c3_recovery_by_mandate",
        label: "Measure Recovery by Mandate",
        description: "Compare failure volume, value disrupted, and recovery rate across mandate type and payment mode to see whether NACH or UPI autopay failures self-heal faster.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_failure_base"],
        outputs: ["recovery_by_mandate"],
        sql: `SELECT
  mandate_type,
  payment_mode,
  COUNT(*) AS failed_installments,
  COUNT(DISTINCT sip_id) AS failed_sips,
  ROUND(SUM(sip_amount_inr), 0) AS sip_value_disrupted_inr,
  COUNT(*) FILTER (WHERE recovered_45d = 1) AS recovered_within_window,
  ROUND(COUNT(*) FILTER (WHERE recovered_45d = 1) * 100.0 / NULLIF(COUNT(*), 0), 2) AS recovery_rate_pct
FROM mandate_failure_base
GROUP BY mandate_type, payment_mode
ORDER BY failed_installments DESC`,
      },
      {
        id: "c4_failure_funnel",
        label: "Build Recovery Funnel",
        description: "Collapse to one row per failed SIP and split by city tier into recovered, unrecovered-but-still-active, and churned-after-failure to show where mandate failures turn into lost SIPs.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_failure_base"],
        outputs: ["failure_funnel"],
        sql: `WITH per_sip AS (
  SELECT
    sip_id,
    ANY_VALUE(city_tier) AS city_tier,
    ANY_VALUE(sip_amount_inr) AS sip_amount_inr,
    ANY_VALUE(sip_status) AS sip_status,
    MAX(recovered_45d) AS ever_recovered
  FROM mandate_failure_base
  GROUP BY sip_id
)
SELECT
  city_tier,
  COUNT(*) AS failed_sips,
  ROUND(SUM(sip_amount_inr), 0) AS monthly_sip_value_disrupted_inr,
  COUNT(*) FILTER (WHERE ever_recovered = 1) AS recovered_sips,
  COUNT(*) FILTER (WHERE ever_recovered = 0 AND sip_status = 'active') AS unrecovered_still_active,
  COUNT(*) FILTER (WHERE ever_recovered = 0 AND sip_status = 'cancelled') AS churned_after_failure,
  ROUND(COUNT(*) FILTER (WHERE ever_recovered = 1) * 100.0 / NULLIF(COUNT(*), 0), 2) AS recovery_rate_pct
FROM per_sip
GROUP BY city_tier
ORDER BY failed_sips DESC`,
      },
      {
        id: "c5_priority_list",
        label: "Rank Priority Fixes",
        description: "Return the highest-value unrecovered active SIPs, ranked by SIP amount, so operations can fix the mandate before it lapses into a cancellation.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_failure_base"],
        outputs: ["recovery_priority_sips"],
        sql: `SELECT
  sip_id,
  investor_id,
  MAX(failed_date) AS last_failed_date,
  ANY_VALUE(sip_amount_inr) AS sip_amount_inr,
  ANY_VALUE(mandate_type) AS mandate_type,
  ANY_VALUE(payment_mode) AS payment_mode,
  ANY_VALUE(fund_category) AS fund_category,
  ANY_VALUE(city_tier) AS city_tier,
  ANY_VALUE(risk_profile) AS risk_profile,
  ANY_VALUE(acquisition_channel) AS acquisition_channel,
  COUNT(*) AS failed_installments_in_window
FROM mandate_failure_base
WHERE recovered_45d = 0
  AND sip_status = 'active'
GROUP BY sip_id, investor_id
ORDER BY sip_amount_inr DESC, failed_installments_in_window DESC, sip_id
LIMIT {{priority_limit}}`,
      },
      {
        id: "c6_analysis",
        label: "Diagnose Mandate Recovery",
        description: "Interpret the recovery rates, funnel, and priority list to separate mechanical mandate failures that self-heal from failures that bleed into churn.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_recovery_by_mandate", "c4_failure_funnel", "c5_priority_list"],
        outputs: ["mandate_recovery_diagnosis"],
        prompt: `Analyze SIP mandate failure recovery using only the upstream query results.

Address:
- the failure volume and value disrupted by mandate type and payment mode, and which mandate recovers fastest within the follow-up window;
- where in the funnel failures convert to churned SIPs versus self-cure, and how that differs by city tier;
- how much active-SIP value is sitting unrecovered and at risk of lapsing;
- which SIPs operations should fix first before the mandate cancels.

Quote actual counts, values, and recovery percentages from the tables. Do not fabricate numbers and do not make return promises or investment-advice claims.`,
      },
      {
        id: "c7_summary",
        label: "Mandate Recovery Brief",
        description: "Produce the final executive brief with recovery KPIs, mandate and funnel charts, and a prioritized operations fix plan.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c3_recovery_by_mandate", "c4_failure_funnel", "c5_priority_list", "c6_analysis"],
        outputs: ["mandate_recovery_brief"],
        prompt: `Create a rich, executive-ready markdown brief titled "NACH Mandate Failure Recovery" for operations and CRM leadership.

The brief must include:
1. A one-paragraph headline answer stating, for the {{failure_lookback_days}}-day window ending {{as_of_date}}, the failed-installment count, the blended recovery rate within {{recovery_window_days}} days, and the active-SIP value still unrecovered.
2. A recovery table by mandate type and payment mode: failed installments, value disrupted, and recovery rate.
3. At least two charts when the upstream rows support them: recovery rate by mandate type or payment mode, and failed versus recovered versus churned SIPs by city tier.
4. A funnel section explaining where mandate failures leak into cancelled SIPs.
5. A priority-action section: which unrecovered active SIPs to fix first and the operational play (mandate re-registration, alternate payment mode, proactive nudge).
6. A short SQL provenance note naming the source views: transactions_full and sips_full.

Use raw values and percentages from the data. Keep recommendations compliant: no guaranteed returns, no tax promises, no personalized investment advice.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded NACH mandate failure recovery analysis for FundsIndia.",
        changes: [
          {
            type: "add",
            cellLabel: "Mandate failure base",
            cellId: "c2_failure_base",
            detail: "Builds the failed-installment base with recovery-window flag, joined to sips_full for amount and mandate type.",
          },
        ],
      },
    ],
  };
}

export function seedFundsIndiaPlaybooks(userId: string): number {
  const playbooks = [
    buildFundsIndiaDormantHoldersPlaybook(userId),
    buildFundsIndiaSipCancellationSavePlaybook(userId),
    buildFundsIndiaNachMandateRecoveryPlaybook(userId),
  ];
  let count = 0;
  for (const playbook of playbooks) {
    if (getPlaybook(userId, playbook.id)) continue;
    upsertPlaybook(userId, playbook);
    count++;
  }
  return count;
}

const RETENTIONS: Array<{ slug: string; name: string; description: string; config: RetentionConfig }> = [
  {
    slug: "sip-installment",
    name: "SIP Installment Retention",
    description: "Whether first-time investors continue with recurring SIP installments.",
    config: {
      startEventId: "first_investment",
      returnEventIds: ["sip_installment"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "purchase-repeat",
    name: "Repeat Purchase Retention",
    description: "Whether first-purchase investors come back with more purchases.",
    config: {
      startEventId: "first_investment",
      returnEventIds: ["purchase"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "sip-vs-lumpsum-repeat",
    name: "SIP vs Lumpsum Repeat Retention",
    description: "After a first investment, do investors come back via recurring SIP installments versus one-off lumpsum purchases?",
    config: {
      startEventId: "first_investment",
      returnEventIds: ["sip_installment", "lumpsum_purchase"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "sip-installment-vs-stepup",
    name: "SIP Installment vs Step-Up Retention",
    description: "After creating a SIP, how many investors keep paying installments versus going further and adding a step-up SIP.",
    config: {
      startEventId: "sip_created",
      returnEventIds: ["sip_installment", "step_up_sip_created"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
];

async function funnelConversion(config: FunnelConfig): Promise<number | null> {
  return computeFunnelHeadlineConversion(config, fundsindiaDataset, FUNDSINDIA_DATASET_ID);
}

async function d7Retention(config: RetentionConfig): Promise<number | null> {
  return computeD7Retention(config, fundsindiaDataset, FUNDSINDIA_DATASET_ID);
}

export async function buildFundsIndiaBoardData(): Promise<{
  name: string;
  description: string;
  sections: BoardSection[];
  cards: BoardCard[];
}> {
  const now = new Date().toISOString();
  const boardId = "";
  const monthlyInflowSql = "SELECT CAST(month AS VARCHAR) AS month, ROUND(SUM(CASE WHEN txn_type = 'redemption' THEN -total_amount ELSE total_amount END)) AS net_inflow FROM monthly_txn_summary GROUP BY 1 ORDER BY 1";
  const sipSql = "SELECT CAST(month AS VARCHAR) AS month, new_sips, cancelled_sips FROM monthly_platform_kpis ORDER BY 1";
  const amcSql = "SELECT amc_name, ROUND(total_invested) AS total_invested, ROUND(est_monthly_commission) AS commission FROM amc_performance ORDER BY total_invested DESC LIMIT 10";
  const activationSql = "SELECT acquisition_channel, SUM(signups) AS signups, SUM(first_invested) AS first_invested, ROUND(SUM(first_invested) * 100.0 / NULLIF(SUM(signups), 0), 2) AS activation_rate FROM investor_funnel GROUP BY 1 ORDER BY signups DESC";
  const crmSql = "SELECT campaign_type, ROUND(SUM(converted) * 100.0 / NULLIF(SUM(delivered), 0), 2) AS conversion_rate FROM campaign_performance GROUP BY 1 ORDER BY conversion_rate DESC LIMIT 10";

  const [monthlyInflow, sipRows, amcRows, activationRows, crmRows] = await Promise.all([
    queryRows(monthlyInflowSql),
    queryRows(sipSql),
    queryRows(amcSql),
    queryRows(activationSql),
    queryRows(crmSql),
  ]);

  const sections: BoardSection[] = [
    { id: "fi-sec-platform", boardId, title: "Platform Momentum", prose: "Net inflows and SIP creation show the current growth pulse.", order: 0, collapsed: false },
    { id: "fi-sec-book", boardId, title: "SIP Book Quality", prose: "AUM and commissions are concentrated across leading AMCs.", order: 1, collapsed: false },
    { id: "fi-sec-activation", boardId, title: "Activation & CRM", prose: "Channel and campaign performance explain investor conversion quality.", order: 2, collapsed: false },
  ];

  const cards: BoardCard[] = [
    {
      id: "fi-card-net-inflow",
      boardId,
      type: "chart",
      title: "Net Monthly Inflow",
      author: "system",
      pinnedAt: now,
      chartSpec: { type: "area", title: "Net Monthly Inflow", data: chartRows(monthlyInflow), xKey: "month", yKeys: ["net_inflow"], yLabels: ["Net inflow"], format: { net_inflow: "currency" }, sql: monthlyInflowSql, currency: "₹", datasetId: FUNDSINDIA_DATASET_ID },
      data: monthlyInflow.slice(0, 30),
      sql: monthlyInflowSql,
      position: { x: 0, y: 0 },
      size: { width: 450, height: 400 },
      refreshCadence: "manual",
      lastRefreshed: now,
      comments: [],
      sectionId: "fi-sec-platform",
      orderInSection: 0,
      colSpan: 3,
    },
    {
      id: "fi-card-sip-creates",
      boardId,
      type: "chart",
      title: "New vs Cancelled SIPs",
      author: "system",
      pinnedAt: now,
      chartSpec: { type: "line", title: "New vs Cancelled SIPs", data: chartRows(sipRows), xKey: "month", yKeys: ["new_sips", "cancelled_sips"], yLabels: ["New SIPs", "Cancelled SIPs"], sql: sipSql, datasetId: FUNDSINDIA_DATASET_ID },
      data: sipRows.slice(0, 30),
      sql: sipSql,
      position: { x: 0, y: 420 },
      size: { width: 450, height: 400 },
      refreshCadence: "manual",
      lastRefreshed: now,
      comments: [],
      sectionId: "fi-sec-platform",
      orderInSection: 1,
      colSpan: 3,
    },
    {
      id: "fi-card-amc",
      boardId,
      type: "table",
      title: "Top AMCs by AUM",
      author: "system",
      pinnedAt: now,
      data: amcRows,
      sql: amcSql,
      position: { x: 0, y: 840 },
      size: { width: 450, height: 380 },
      refreshCadence: "manual",
      lastRefreshed: now,
      comments: [],
      sectionId: "fi-sec-book",
      orderInSection: 0,
      colSpan: 3,
    },
    {
      id: "fi-card-activation",
      boardId,
      type: "chart",
      title: "Activation by Channel",
      author: "system",
      pinnedAt: now,
      chartSpec: { type: "bar", title: "Activation by Channel", data: chartRows(activationRows), xKey: "acquisition_channel", yKeys: ["activation_rate"], yLabels: ["Activation rate"], format: { activation_rate: "percent" }, sql: activationSql, datasetId: FUNDSINDIA_DATASET_ID },
      data: activationRows,
      sql: activationSql,
      position: { x: 0, y: 1260 },
      size: { width: 450, height: 400 },
      refreshCadence: "manual",
      lastRefreshed: now,
      comments: [],
      sectionId: "fi-sec-activation",
      orderInSection: 0,
      colSpan: 1,
    },
    {
      id: "fi-card-crm",
      boardId,
      type: "chart",
      title: "CRM Conversion Rate",
      author: "system",
      pinnedAt: now,
      chartSpec: { type: "bar", title: "CRM Conversion Rate", data: chartRows(crmRows), xKey: "campaign_type", yKeys: ["conversion_rate"], yLabels: ["Conversion rate"], format: { conversion_rate: "percent" }, sql: crmSql, datasetId: FUNDSINDIA_DATASET_ID },
      data: crmRows,
      sql: crmSql,
      position: { x: 500, y: 1260 },
      size: { width: 450, height: 400 },
      refreshCadence: "manual",
      lastRefreshed: now,
      comments: [],
      sectionId: "fi-sec-activation",
      orderInSection: 1,
      colSpan: 1,
    },
  ];

  return {
    name: "FundsIndia Growth Dashboard",
    description: "SIP book, activation, AUM, and campaign performance",
    sections,
    cards,
  };
}

export async function seedFundsIndiaSampleWorkspace(userId: string): Promise<{
  metrics: number;
  segments: number;
  funnels: number;
  retentions: number;
  boards: number;
  playbooks: number;
  voiceCampaigns: number;
}> {
  const metrics = ensureMetricsFile();
  const playbooks = seedFundsIndiaPlaybooks(userId);

  for (const segment of SEGMENTS) {
    upsertSegment(userId, {
      id: seedId(userId, "seg", segment.slug),
      name: segment.name,
      description: segment.description,
      sql: segment.sql,
      userCount: await countSegment(segment.sql),
      datasetId: FUNDSINDIA_DATASET_ID,
    });
  }

  for (const funnel of FUNNELS.slice(0, 3)) {
    upsertFunnel(userId, {
      id: seedId(userId, "fun", funnel.slug),
      name: funnel.name,
      description: funnel.description,
      config: funnel.config,
      source: "auto",
      overallConversion: await funnelConversion(funnel.config),
      datasetId: FUNDSINDIA_DATASET_ID,
    });
  }

  for (const retention of RETENTIONS.slice(0, 3)) {
    upsertRetention(userId, {
      id: seedId(userId, "ret", retention.slug),
      name: retention.name,
      description: retention.description,
      config: retention.config,
      source: "auto",
      d7Retention: await d7Retention(retention.config),
      datasetId: FUNDSINDIA_DATASET_ID,
    });
  }

  const boardData = await buildFundsIndiaBoardData();
  const boardId = seedId(userId, "board", "growth");
  const now = new Date().toISOString();
  const board: Board = {
    id: boardId,
    name: boardData.name,
    description: boardData.description,
    datasetId: FUNDSINDIA_DATASET_ID,
    viewMode: "document",
    createdAt: now,
    updatedAt: now,
  };
  upsertBoard(userId, board);
  for (const section of boardData.sections) {
    upsertSection(boardId, { ...section, boardId });
  }
  for (const card of boardData.cards) {
    upsertCard(boardId, { ...card, boardId });
  }

  // Voice campaigns are created manually per workspace; not seeded.
  const voiceCampaigns = 0;

  return {
    metrics,
    segments: SEGMENTS.length,
    funnels: FUNNELS.length,
    retentions: RETENTIONS.length,
    boards: 1,
    playbooks,
    voiceCampaigns,
  };
}
