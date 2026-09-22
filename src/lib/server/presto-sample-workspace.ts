import { createHash } from "crypto";
import type { FunnelConfig } from "@/lib/funnel-types";
import type { RetentionConfig } from "@/lib/retention-types";
import { prestoDataset } from "@/lib/datasets/presto";
import { executeSQLInternal } from "@/lib/sql-executor";
import { computeFunnelHeadlineConversion, computeD7Retention } from "@/lib/server/seed-metric-helpers";
import { upsertSegment } from "@/lib/server/segment-repo";
import { upsertFunnel } from "@/lib/server/funnel-repo";
import { upsertRetention } from "@/lib/server/retention-repo";
import { getPlaybook, upsertPlaybook } from "@/lib/server/playbook-repo";
import type { PlaybookV2 } from "@/lib/playbook-types";

export const PRESTO_DATASET_ID = "presto";
const DATA_RANGE = { start: "2025-08-01", end: "2026-02-28" } as const;

function seedId(userId: string, kind: string, slug: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `presto_${hash}_${kind}_${slug}`;
}

async function countSegment(sql: string): Promise<number> {
  const wrapped = `SELECT COUNT(*) AS n FROM (${sql}) AS s`;
  const result = await executeSQLInternal(wrapped, PRESTO_DATASET_ID);
  if (result.error || result.rows.length === 0) return 0;
  const row = result.rows[0] as Record<string, unknown>;
  return Number(row.n) || 0;
}

// ─────────────────────────────────────────────────────────────────────
// SEGMENTS: handcrafted SQL, user_id is the player entity
// ─────────────────────────────────────────────────────────────────────
const SEGMENTS = [
  {
    slug: "high-engagement-players",
    name: "High-Engagement Players",
    description: "Players who played 5+ games in their first 7 days (engagement_tier = high). Nearly 4x the D30 retention of low-engagement installs.",
    sql: "SELECT DISTINCT user_id FROM installs WHERE engagement_tier = 'high'",
  },
  {
    slug: "high-ad-value-players",
    name: "High Ad-Value Players",
    description: "Players who have generated $10+ in settled ad revenue: the monetisation backbone of an ad-funded game.",
    sql: "SELECT user_id FROM ad_impression_events GROUP BY user_id HAVING SUM(settled_revenue) >= 10",
  },
  {
    slug: "paid-acquisition-cohort",
    name: "Paid Acquisition Cohort",
    description: "All players acquired through paid UA channels (facebook, admob, vungle, moloco), excludes organic. The cohort UA spend has to pay back.",
    sql: "SELECT DISTINCT user_id FROM installs WHERE channel <> 'organic'",
  },
  {
    slug: "organic-installs",
    name: "Organic Installs",
    description: "Players acquired with zero UA spend: free, high-margin installs to protect and grow.",
    sql: "SELECT DISTINCT user_id FROM installs WHERE channel = 'organic'",
  },
  {
    slug: "facebook-players",
    name: "Facebook Players",
    description: "Players acquired via Facebook: the highest-volume paid channel and the highest blended CPI.",
    sql: "SELECT DISTINCT user_id FROM installs WHERE channel = 'facebook'",
  },
  {
    slug: "new-targeting-cohort",
    name: "Facebook 5-Game Targeting Cohort",
    description: "Facebook players acquired from Jan 2026 under the 5-game targeting criteria (is_new_targeting). Higher high-engagement mix, early retention test.",
    sql: "SELECT DISTINCT user_id FROM installs WHERE is_new_targeting = true",
  },
  {
    slug: "low-engagement-churn-risk",
    name: "Low-Engagement Churn Risk",
    description: "Players who played 0-2 games in their first 7 days (engagement_tier = low): the steepest early-churn segment.",
    sql: "SELECT DISTINCT user_id FROM installs WHERE engagement_tier = 'low'",
  },
  {
    slug: "emerging-market-players",
    name: "Emerging-Market Players",
    description: "Players in IN, BR, ID, MX: strong early retention then steep churn, which inflates early LTV projections.",
    sql: "SELECT DISTINCT user_id FROM installs WHERE country IN ('IN','BR','ID','MX')",
  },
  {
    slug: "tier1-geo-players",
    name: "Tier-1 Geo Players",
    description: "Players in US, GB, DE, CA, FR: lower early retention shape but more durable long-tail LTV.",
    sql: "SELECT DISTINCT user_id FROM installs WHERE country IN ('US','GB','DE','CA','FR')",
  },
  {
    slug: "us-ios-whales",
    name: "US iOS High-Engagement",
    description: "US iOS players with high engagement: the premium ad-monetisation slice (highest eCPM geo + platform).",
    sql: "SELECT DISTINCT user_id FROM installs WHERE country = 'US' AND platform = 'ios' AND engagement_tier = 'high'",
  },
  {
    slug: "fraud-flagged-installs",
    name: "Fraud-Flagged Installs",
    description: "Installs flagged for impression-stuffing fraud: revenue reported but never settles. Exclude from LTV and ROAS truth.",
    sql: "SELECT DISTINCT user_id FROM installs WHERE is_fraud = true",
  },
  {
    slug: "vungle-players",
    name: "Vungle Players (High-Fraud Channel)",
    description: "Players acquired via Vungle: lowest CPI but ~17% invalid traffic, so settled revenue lags reported the most here.",
    sql: "SELECT DISTINCT user_id FROM installs WHERE channel = 'vungle'",
  },
];

// ─────────────────────────────────────────────────────────────────────
// FUNNELS: use EventDefinition IDs from presto.ts
// ─────────────────────────────────────────────────────────────────────
const FUNNELS: Array<{ slug: string; name: string; description: string; config: FunnelConfig }> = [
  {
    slug: "install-to-monetization",
    name: "Install → Session → Settled Ad Revenue",
    description: "The full activation-to-money chain: a player installs, returns for a gameplay session, then serves an impression that actually settles post-fraud. Each step is a real place we lose players before they earn revenue.",
    config: {
      steps: [
        { eventId: "install" },
        { eventId: "session" },
        { eventId: "settled_ad_revenue", filters: [{ property: "settled_revenue", operator: "gt", value: 0 }] },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "impression-to-settled-revenue",
    name: "Ad Impression → Settled Ad Revenue",
    description: "Of players who serve an ad impression, how many serve one that actually settles post-fraud (settled_revenue > 0): the invalid-traffic leakage chain. The drop is the fraud-flagged players whose revenue never pays out.",
    config: {
      steps: [
        { eventId: "ad_impression" },
        { eventId: "settled_ad_revenue", filters: [{ property: "settled_revenue", operator: "gt", value: 0 }] },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  // ── COMPLEX: deep 5-step activation-to-high-value-revenue journey ──
  {
    slug: "deep-activation-to-high-value",
    name: "Install → Session → D7 Return → Settled Ad Revenue → High-Value Impression",
    description: "The full value chain in five steps: a player installs, returns for a first session, is still active on day 7+ (the retention gate), then serves an impression that settles post-fraud, and finally serves a high-value impression (settled_revenue >= $0.50). Each compounding drop is a real place we lose value before a player becomes monetisation-grade. Deep funnels compound, so the overall rate is low by design: what matters is which step leaks the most.",
    config: {
      steps: [
        { eventId: "install" },
        { eventId: "session" },
        { eventId: "session", filters: [{ property: "days_from_install", operator: "gte", value: 7 }] },
        { eventId: "settled_ad_revenue", filters: [{ property: "settled_revenue", operator: "gt", value: 0 }] },
        { eventId: "settled_ad_revenue", filters: [{ property: "settled_revenue", operator: "gte", value: 0.5 }] },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
];

// ─────────────────────────────────────────────────────────────────────
// RETENTIONS: use EventDefinition IDs from presto.ts
// ─────────────────────────────────────────────────────────────────────
const RETENTIONS: Array<{ slug: string; name: string; description: string; config: RetentionConfig }> = [
  {
    slug: "install-session-retention",
    name: "Install → Session Retention",
    description: "Classic single-day retention: of newly-installed players, what share are back playing a session on exactly D1/D7/D30. The core stickiness curve.",
    config: {
      startEventId: "install",
      returnEventIds: ["session"],
      mode: "on",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "high-engagement-retention",
    name: "High-Engagement Player Retention",
    description: "Single-day retention for high-engagement installs (5+ games in D7) returning for sessions: the cohort that drives most long-tail LTV, and it retains roughly 1.8x the install base at D7.",
    config: {
      startEventId: "high_engagement_install",
      returnEventIds: ["session"],
      mode: "on",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  // ── COMPLEX: paid-acquisition cohort, dual return (play vs ad-served) ──
  {
    slug: "paid-cohort-play-vs-ad-retention",
    name: "Paid-Acquisition Retention: Return to Play vs Serve an Ad",
    description: "Two return curves on the same paid-acquisition cohort (channel <> organic): returning for a gameplay session, and serving an ad impression. In an ad-funded title these track 1:1 (every active day serves an ad), which is exactly the point: there is no engagement-to-monetisation gap, so retention is the entire revenue lever. Paid players retain slightly below the blended install base, which is why UA payback hinges on the high-engagement mix.",
    config: {
      startEventId: "install",
      startFilters: [{ property: "channel", operator: "neq", value: "organic" }],
      returnEventIds: ["session", "ad_impression"],
      mode: "on",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
];

async function funnelConversion(config: FunnelConfig): Promise<number | null> {
  return computeFunnelHeadlineConversion(config, prestoDataset, PRESTO_DATASET_ID);
}

async function d7Retention(config: RetentionConfig): Promise<number | null> {
  return computeD7Retention(config, prestoDataset, PRESTO_DATASET_ID);
}

// ─────────────────────────────────────────────────────────────────────
// PLAYBOOKS (V2): handcrafted multi-step growth analyses for Presto
// ─────────────────────────────────────────────────────────────────────

const PLAYBOOK_OWNER = "Actioneer";
const PLAYBOOK_OWNER_INITIALS = "A";

// ── Playbook 1: Paid UA Channel ROAS & Payback ──
const ROAS_PAYBACK_SLUG = "ua-channel-roas-payback";

function buildPrestoRoasPaybackPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", ROAS_PAYBACK_SLUG);
  return {
    id,
    schemaVersion: 2,
    name: "Paid UA Channel ROAS & Payback",
    description:
      "Trace every paid acquisition dollar from spend to install to D7/D30/D60/D90 cohort LTV, rank channels and channel x country pockets by return on ad spend, measure how far each channel is along its payback curve, and reconcile the cohort LTV view marketing sees against the closed settled-revenue cash view finance books.",
    category: "Acquisition",
    version: "1.0",
    approvalStatus: "approved",
    owner: PLAYBOOK_OWNER,
    ownerInitials: PLAYBOOK_OWNER_INITIALS,
    datasetId: PRESTO_DATASET_ID,
    sourceQuery:
      "Which paid UA channels and channel x country pockets earn back their acquisition spend, how far along the payback curve is each channel, and does the cohort LTV picture reconcile with closed settled revenue?",
    params: [
      { name: "min_installs", label: "Minimum installs per pocket", type: "integer", defaultVal: "300", group: "Filters" },
      { name: "pocket_limit", label: "Channel x country rows", type: "integer", defaultVal: "20", group: "Output" },
    ],
    produces: [
      {
        name: "channel_roas",
        description: "Channel-level paid UA rollup: spend, installs, blended CPI, weighted D30/D60/D90 LTV and ROAS.",
        columns: [
          { name: "channel", description: "Paid acquisition channel (organic excluded)." },
          { name: "ua_spend", description: "Total UA spend booked to the channel." },
          { name: "blended_cpi", description: "Spend divided by installs for the channel." },
          { name: "roas_d90", description: "Install-weighted D90 LTV divided by CPI; above 1.0 is profitable at 90 days." },
        ],
      },
      { name: "channel_country_pockets", description: "Best and worst channel x country ROAS pockets above the install floor." },
      { name: "payback_curve", description: "Payback ratio progression D7 to D90 by channel: fraction of UA spend recovered." },
      { name: "cash_reconciliation", description: "Monthly paid UA spend vs settled and net closed revenue, with the net cash gap." },
      { name: "blended_view", description: "Paid vs organic install mix, paid CPI, and blended CPI across all installs." },
    ],
    cells: [
      {
        id: "c1_guardrail",
        label: "Check UA Inputs",
        description: "Confirm the spend, ROAS, and payback summary tables are populated and current before any economics are computed.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT 'payback_analysis' AS check_name, COUNT(*) AS record_count, MAX(install_month) AS latest_month FROM payback_analysis
  UNION ALL
  SELECT 'roas_by_cohort' AS check_name, COUNT(*) AS record_count, MAX(install_month) AS latest_month FROM roas_by_cohort
  UNION ALL
  SELECT 'cac_by_month' AS check_name, COUNT(*) AS record_count, MAX(install_month) AS latest_month FROM cac_by_month
  UNION ALL
  SELECT 'monthly_revenue_summary' AS check_name, COUNT(*) AS record_count, CAST(MAX(month) AS VARCHAR) AS latest_month FROM monthly_revenue_summary
)
SELECT
  check_name,
  record_count,
  latest_month,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks
ORDER BY check_name`,
      },
      {
        id: "c2_latest_month",
        label: "Resolve Latest Cohort Month",
        description: "Compute the most recent install month present in the payback table so downstream reads describe the live window.",
        type: "sql",
        role: "parameter",
        status: "idle",
        dependsOn: ["c1_guardrail"],
        outputs: ["latest_month"],
        sql: `SELECT
  MAX(install_month) AS latest_install_month,
  MIN(install_month) AS earliest_install_month,
  COUNT(DISTINCT install_month) AS months_covered
FROM payback_analysis`,
      },
      {
        id: "c3_channel_roas",
        label: "Rank Channels by ROAS",
        description: "Roll spend, installs, blended CPI, and install-weighted D30/D60/D90 LTV into a channel-level ROAS league table for paid channels only.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_latest_month"],
        outputs: ["channel_roas"],
        sql: `WITH spend AS (
  SELECT channel, SUM(total_spend) AS ua_spend, SUM(installs) AS installs
  FROM cac_by_month
  WHERE channel <> 'organic'
  GROUP BY channel
),
ltv AS (
  SELECT
    channel,
    SUM(d30_ltv * installs) / NULLIF(SUM(installs), 0) AS w_d30_ltv,
    SUM(d60_ltv * installs) / NULLIF(SUM(installs), 0) AS w_d60_ltv,
    SUM(d90_ltv * installs) / NULLIF(SUM(installs), 0) AS w_d90_ltv
  FROM roas_by_cohort
  WHERE channel <> 'organic'
  GROUP BY channel
)
SELECT
  s.channel,
  ROUND(s.ua_spend, 0) AS ua_spend,
  s.installs,
  ROUND(s.ua_spend / NULLIF(s.installs, 0), 2) AS blended_cpi,
  ROUND(l.w_d30_ltv, 3) AS d30_ltv,
  ROUND(l.w_d60_ltv, 3) AS d60_ltv,
  ROUND(l.w_d90_ltv, 3) AS d90_ltv,
  ROUND(l.w_d30_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS roas_d30,
  ROUND(l.w_d60_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS roas_d60,
  ROUND(l.w_d90_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS roas_d90
FROM spend s
JOIN ltv l ON l.channel = s.channel
ORDER BY ua_spend DESC`,
      },
      {
        id: "c4_country_pockets",
        label: "Find ROAS Pockets",
        description: "Cut ROAS by channel x country above the install floor to surface where paid spend overperforms and underperforms inside each channel.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_latest_month"],
        outputs: ["channel_country_pockets"],
        sql: `WITH pocket AS (
  SELECT
    channel,
    country,
    SUM(installs) AS installs,
    SUM(avg_cpi * installs) / NULLIF(SUM(installs), 0) AS cpi,
    SUM(d30_ltv * installs) / NULLIF(SUM(installs), 0) AS d30_ltv,
    SUM(d90_ltv * installs) / NULLIF(SUM(installs), 0) AS d90_ltv
  FROM roas_by_cohort
  WHERE channel <> 'organic'
  GROUP BY channel, country
  HAVING SUM(installs) >= {{min_installs}}
)
SELECT
  channel,
  country,
  installs,
  ROUND(cpi, 2) AS cpi,
  ROUND(d30_ltv, 3) AS d30_ltv,
  ROUND(d90_ltv, 3) AS d90_ltv,
  ROUND(d30_ltv / NULLIF(cpi, 0), 3) AS roas_d30,
  ROUND(d90_ltv / NULLIF(cpi, 0), 3) AS roas_d90,
  CASE WHEN d90_ltv / NULLIF(cpi, 0) >= 1.0 THEN 'profitable_by_d90' ELSE 'underwater_at_d90' END AS verdict_d90
FROM pocket
ORDER BY roas_d90 DESC
LIMIT {{pocket_limit}}`,
      },
      {
        id: "c5_payback_curve",
        label: "Trace Payback Curve",
        description: "Show the share of UA spend recovered at D7, D30, D60, and D90 by channel to read how long each channel takes to break even.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_latest_month"],
        outputs: ["payback_curve"],
        sql: `SELECT
  channel,
  ROUND(SUM(ua_spend), 0) AS ua_spend,
  SUM(installs) AS installs,
  ROUND(SUM(d7_ltv  * installs) / NULLIF(SUM(ua_spend), 0), 3) AS payback_ratio_d7,
  ROUND(SUM(d30_ltv * installs) / NULLIF(SUM(ua_spend), 0), 3) AS payback_ratio_d30,
  ROUND(SUM(d60_ltv * installs) / NULLIF(SUM(ua_spend), 0), 3) AS payback_ratio_d60,
  ROUND(SUM(d90_ltv * installs) / NULLIF(SUM(ua_spend), 0), 3) AS payback_ratio_d90,
  CASE
    WHEN SUM(d30_ltv * installs) / NULLIF(SUM(ua_spend), 0) >= 1.0 THEN 'breaks_even_by_d30'
    WHEN SUM(d60_ltv * installs) / NULLIF(SUM(ua_spend), 0) >= 1.0 THEN 'breaks_even_by_d60'
    WHEN SUM(d90_ltv * installs) / NULLIF(SUM(ua_spend), 0) >= 1.0 THEN 'breaks_even_by_d90'
    ELSE 'past_d90_payback'
  END AS breakeven_band
FROM payback_analysis
WHERE channel <> 'organic'
GROUP BY channel
ORDER BY payback_ratio_d90 DESC`,
      },
      {
        id: "c6_cash_reconciliation",
        label: "Reconcile Cohort vs Cash",
        description: "Compare monthly paid UA spend against the closed settled and net revenue finance books, exposing the payback-lag cash gap by month.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_latest_month"],
        outputs: ["cash_reconciliation"],
        sql: `WITH spend AS (
  SELECT install_month, SUM(total_spend) AS ua_spend, SUM(installs) AS paid_installs
  FROM cac_by_month
  WHERE channel <> 'organic'
  GROUP BY install_month
),
rev AS (
  SELECT
    CAST(strftime(month, '%Y-%m') AS VARCHAR) AS install_month,
    SUM(settled_revenue) AS settled_revenue,
    SUM(net_revenue) AS net_revenue
  FROM monthly_revenue_summary
  GROUP BY 1
)
SELECT
  s.install_month,
  ROUND(s.ua_spend, 0) AS ua_spend,
  s.paid_installs,
  ROUND(r.settled_revenue, 0) AS settled_revenue,
  ROUND(r.net_revenue, 0) AS net_revenue,
  ROUND(r.net_revenue - s.ua_spend, 0) AS net_cash_gap,
  ROUND(r.settled_revenue / NULLIF(s.ua_spend, 0), 3) AS settled_to_spend_ratio
FROM spend s
LEFT JOIN rev r ON r.install_month = s.install_month
ORDER BY s.install_month`,
      },
      {
        id: "c7_blended_view",
        label: "Add Organic Context",
        description: "Quantify the organic install share and the gap between paid CPI and blended CPI so the spend story is read against free volume.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_latest_month"],
        outputs: ["blended_view"],
        sql: `WITH inst AS (
  SELECT
    COUNT(*) FILTER (WHERE channel <> 'organic') AS paid_installs,
    COUNT(*) FILTER (WHERE channel = 'organic') AS organic_installs,
    COUNT(*) AS total_installs
  FROM installs
),
spend AS (
  SELECT SUM(total_spend) AS ua_spend FROM cac_by_month WHERE channel <> 'organic'
)
SELECT
  ROUND(sp.ua_spend, 0) AS total_paid_spend,
  i.paid_installs,
  i.organic_installs,
  i.total_installs,
  ROUND(i.organic_installs * 100.0 / NULLIF(i.total_installs, 0), 1) AS organic_install_pct,
  ROUND(sp.ua_spend / NULLIF(i.paid_installs, 0), 2) AS paid_cpi,
  ROUND(sp.ua_spend / NULLIF(i.total_installs, 0), 2) AS blended_cpi
FROM inst i
CROSS JOIN spend sp`,
      },
      {
        id: "c8_analysis",
        label: "Diagnose Channel Economics",
        description: "Interpret the ROAS ranking, payback curve, cash reconciliation, and organic context using only the computed rows.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_channel_roas", "c4_country_pockets", "c5_payback_curve", "c6_cash_reconciliation", "c7_blended_view"],
        outputs: ["channel_diagnosis"],
        prompt: `Analyze paid UA channel economics for Presto using only the upstream query results.

Cover:
- which channels clear ROAS of 1.0 at D90 and how that ranking changes from D30 to D90;
- which channel x country pockets are the strongest and weakest, and what the install floor implies about confidence;
- how far along the payback curve each channel sits, naming the breakeven band (D30, D60, D90, or past D90);
- how the monthly net cash gap reflects payback lag, distinguishing cohort LTV (what marketing sees) from closed settled and net revenue (what finance books);
- what the organic install share does to blended CPI versus paid CPI.

Cite actual numbers and channel names from the tables. Treat any LTV beyond elapsed time as a forward model projection, not closed revenue. Do not invent figures.`,
      },
      {
        id: "c9_summary",
        label: "UA Spend Decision Brief",
        description: "Produce the final executive-ready brief with a ROAS league table, a payback curve, a cash-gap read, and a clear spend recommendation.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_guardrail", "c3_channel_roas", "c4_country_pockets", "c5_payback_curve", "c6_cash_reconciliation", "c7_blended_view", "c8_analysis"],
        outputs: ["ua_decision_brief"],
        prompt: `Create a rich markdown brief that answers whether Presto should lean harder into paid UA next quarter.

Include:
1. A one-paragraph direct answer naming the most and least efficient paid channel at D90 ROAS.
2. A channel ROAS league table with spend, installs, blended CPI, and D30/D60/D90 ROAS.
3. A payback curve chart or table showing the D7 to D90 recovery ratio by channel and the breakeven band.
4. A pockets section calling out the top and bottom channel x country slices and the install floor used.
5. A cash section that contrasts cohort LTV with monthly settled and net revenue, and explains the net cash gap as payback lag rather than loss.
6. A spend recommendation: where to add budget, where to cap, and which pockets to test, with the operational caveat that recent cohorts have not fully elapsed so their D60/D90 LTV is projected.

Use the raw numbers from the data. Keep it decision-ready and avoid guaranteed-return language.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded paid UA channel ROAS and payback analysis for Presto.",
        changes: [
          {
            type: "add",
            cellLabel: "Rank Channels by ROAS",
            cellId: "c3_channel_roas",
            detail: "Builds the channel-level spend to install to D30/D60/D90 LTV and ROAS league table.",
          },
        ],
      },
    ],
  };
}

// ── Playbook 2: Retention & Engagement Cohort Teardown ──
const RETENTION_TEARDOWN_SLUG = "retention-engagement-teardown";

function buildPrestoRetentionTeardownPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", RETENTION_TEARDOWN_SLUG);
  return {
    id,
    schemaVersion: 2,
    name: "Retention & Engagement Cohort Teardown",
    description:
      "Tear down the install-cohort retention curve month by month, expose the early-engagement signal that separates sticky players from churn, link engagement tier to D90 LTV and ROAS, isolate the frontloaded emerging-market retention shape that inflates early projections, and tie session depth back to value.",
    category: "Retention",
    version: "1.0",
    approvalStatus: "approved",
    owner: PLAYBOOK_OWNER,
    ownerInitials: PLAYBOOK_OWNER_INITIALS,
    datasetId: PRESTO_DATASET_ID,
    sourceQuery:
      "How is install-cohort retention trending, how much does early engagement drive retention and downstream LTV, and which geos are frontloaded so that early LTV projections mislead?",
    params: [
      { name: "min_cohort_size", label: "Minimum cohort size per geo", type: "integer", defaultVal: "500", group: "Filters" },
      { name: "exclude_unelapsed_month", label: "Exclude right-censored month", type: "string", defaultVal: "2026-02", group: "Filters" },
    ],
    produces: [
      {
        name: "retention_curve",
        description: "Monthly install cohort D7/D14/D30 retention curve with cohort size.",
        columns: [
          { name: "install_month", description: "Install cohort month." },
          { name: "d30_retention_pct", description: "Share of the cohort active on D28 to D30." },
        ],
      },
      { name: "engagement_retention", description: "D7/D30/D60 retention by early-engagement tier (low, medium, high)." },
      { name: "engagement_monetization", description: "CPI, D30/D90 LTV and D60 ROAS by engagement tier: the engagement-to-money link." },
      { name: "geo_retention_shape", description: "Geo retention shape with the D30-to-D14 survival ratio that flags frontloaded markets." },
      { name: "session_depth", description: "Sessions per player, session minutes, and level reached by engagement tier." },
    ],
    cells: [
      {
        id: "c1_guardrail",
        label: "Check Retention Inputs",
        description: "Confirm cohort retention, engagement, and segment trend tables are populated and current before the teardown runs.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT 'cohort_retention_actuals' AS check_name, COUNT(*) AS record_count, MAX(install_month) AS latest_month FROM cohort_retention_actuals
  UNION ALL
  SELECT 'engagement_analysis' AS check_name, COUNT(*) AS record_count, MAX(install_month) AS latest_month FROM engagement_analysis
  UNION ALL
  SELECT 'segment_trends' AS check_name, COUNT(*) AS record_count, MAX(install_month) AS latest_month FROM segment_trends
  UNION ALL
  SELECT 'sessions' AS check_name, COUNT(*) AS record_count, CAST(MAX(session_date) AS VARCHAR) AS latest_month FROM sessions
)
SELECT
  check_name,
  record_count,
  latest_month,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks
ORDER BY check_name`,
      },
      {
        id: "c2_latest_elapsed_month",
        label: "Resolve Elapsed Cohort Window",
        description: "Identify the latest install month whose D30 retention has fully elapsed so right-censored cohorts are read with care downstream.",
        type: "sql",
        role: "parameter",
        status: "idle",
        dependsOn: ["c1_guardrail"],
        outputs: ["elapsed_window"],
        sql: `SELECT
  MAX(install_month) AS latest_install_month,
  MAX(install_month) FILTER (WHERE install_month <> '{{exclude_unelapsed_month}}') AS latest_elapsed_month,
  COUNT(DISTINCT install_month) AS months_covered
FROM cohort_retention_actuals`,
      },
      {
        id: "c3_retention_curve",
        label: "Build Retention Curve",
        description: "Compute the D7/D14/D30 retention curve for each install cohort month from actual session activity.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_latest_elapsed_month"],
        outputs: ["retention_curve"],
        sql: `SELECT
  install_month,
  SUM(cohort_size) AS cohort_size,
  ROUND(SUM(d7_active)  * 100.0 / NULLIF(SUM(cohort_size), 0), 2) AS d7_retention_pct,
  ROUND(SUM(d14_active) * 100.0 / NULLIF(SUM(cohort_size), 0), 2) AS d14_retention_pct,
  ROUND(SUM(d30_active) * 100.0 / NULLIF(SUM(cohort_size), 0), 2) AS d30_retention_pct,
  CASE WHEN install_month = '{{exclude_unelapsed_month}}' THEN 'right_censored' ELSE 'elapsed' END AS cohort_state
FROM cohort_retention_actuals
GROUP BY install_month
ORDER BY install_month`,
      },
      {
        id: "c4_engagement_retention",
        label: "Split Retention by Engagement",
        description: "Break D7/D30/D60 retention by early-engagement tier to size the gap between sticky and churn-prone installs.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_latest_elapsed_month"],
        outputs: ["engagement_retention"],
        sql: `SELECT
  engagement_tier,
  SUM(installs) AS installs,
  ROUND(SUM(d7_retention  * installs) / NULLIF(SUM(installs), 0), 4) AS d7_retention,
  ROUND(SUM(d30_retention * installs) / NULLIF(SUM(installs), 0), 4) AS d30_retention,
  ROUND(SUM(d60_retention * installs) / NULLIF(SUM(installs), 0), 4) AS d60_retention,
  ROUND(
    (SUM(d30_retention * installs) / NULLIF(SUM(installs), 0))
    / NULLIF(SUM(d7_retention * installs) / NULLIF(SUM(installs), 0), 0), 3
  ) AS d30_to_d7_survival
FROM engagement_analysis
GROUP BY engagement_tier
ORDER BY d30_retention DESC`,
      },
      {
        id: "c5_engagement_monetization",
        label: "Link Engagement to Money",
        description: "Tie engagement tier to CPI, D30/D90 LTV, and D60 ROAS to show how stickiness converts into ad value.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_latest_elapsed_month"],
        outputs: ["engagement_monetization"],
        sql: `SELECT
  engagement_tier,
  SUM(installs) AS installs,
  ROUND(SUM(avg_cpi * installs) / NULLIF(SUM(installs), 0), 2) AS cpi,
  ROUND(SUM(d30_ltv * installs) / NULLIF(SUM(installs), 0), 3) AS d30_ltv,
  ROUND(SUM(d90_ltv * installs) / NULLIF(SUM(installs), 0), 3) AS d90_ltv,
  ROUND(
    (SUM(d60_ltv * installs) / NULLIF(SUM(installs), 0))
    / NULLIF(SUM(avg_cpi * installs) / NULLIF(SUM(installs), 0), 0), 3
  ) AS roas_d60
FROM engagement_analysis
GROUP BY engagement_tier
ORDER BY d90_ltv DESC`,
      },
      {
        id: "c6_geo_shape",
        label: "Flag Frontloaded Geos",
        description: "Rank geos by the D30-to-D14 survival ratio so emerging markets that retain early then churn hard are separated from durable markets.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_latest_elapsed_month"],
        outputs: ["geo_retention_shape"],
        sql: `SELECT
  country,
  SUM(cohort_size) AS cohort_size,
  ROUND(SUM(d7_active)  * 100.0 / NULLIF(SUM(cohort_size), 0), 2) AS d7_retention_pct,
  ROUND(SUM(d14_active) * 100.0 / NULLIF(SUM(cohort_size), 0), 2) AS d14_retention_pct,
  ROUND(SUM(d30_active) * 100.0 / NULLIF(SUM(cohort_size), 0), 2) AS d30_retention_pct,
  ROUND(SUM(d30_active) * 1.0 / NULLIF(SUM(d14_active), 0), 3) AS d30_to_d14_survival,
  CASE
    WHEN SUM(d30_active) * 1.0 / NULLIF(SUM(d14_active), 0) < 0.45 THEN 'frontloaded_churn_risk'
    ELSE 'durable_tail'
  END AS retention_shape
FROM cohort_retention_actuals
WHERE install_month <> '{{exclude_unelapsed_month}}'
GROUP BY country
HAVING SUM(cohort_size) >= {{min_cohort_size}}
ORDER BY d30_to_d14_survival ASC`,
      },
      {
        id: "c7_session_depth",
        label: "Measure Session Depth",
        description: "Join raw sessions to installs to quantify sessions per player, session minutes, and level reached by engagement tier.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_latest_elapsed_month"],
        outputs: ["session_depth"],
        sql: `SELECT
  i.engagement_tier,
  COUNT(DISTINCT s.user_id) AS active_players,
  COUNT(*) AS total_sessions,
  ROUND(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT s.user_id), 0), 2) AS sessions_per_player,
  ROUND(AVG(s.session_duration_mins), 2) AS avg_session_mins,
  ROUND(AVG(s.level_reached), 2) AS avg_level_reached,
  ROUND(AVG(s.level_completed), 2) AS avg_level_completed
FROM sessions s
JOIN installs i ON i.user_id = s.user_id
GROUP BY i.engagement_tier
ORDER BY sessions_per_player DESC`,
      },
      {
        id: "c8_analysis",
        label: "Diagnose Retention Health",
        description: "Interpret the retention curve, engagement split, monetization link, geo shape, and session depth using only the computed rows.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_retention_curve", "c4_engagement_retention", "c5_engagement_monetization", "c6_geo_shape", "c7_session_depth"],
        outputs: ["retention_diagnosis"],
        prompt: `Analyze Presto retention and engagement health using only the upstream query results.

Cover:
- the direction of the monthly D7/D14/D30 retention curve, explicitly flagging any right-censored cohort whose D30 has not elapsed so a near-zero D30 is not read as collapse;
- how much early engagement tier separates retention and how that gap compounds from D7 to D60;
- the engagement-to-money link: how D90 LTV and D60 ROAS scale with engagement tier;
- which geos are frontloaded (low D30-to-D14 survival) versus durable, and why that inflates early blended LTV projections;
- how session depth differs by tier and what that says about the early-engagement mechanic.

Cite actual numbers and tier and country names. Do not invent figures or read censored cohorts as churn.`,
      },
      {
        id: "c9_summary",
        label: "Retention Teardown Brief",
        description: "Produce the final markdown brief with the retention curve, the engagement and monetization link, the geo shape, and concrete retention levers.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_guardrail", "c3_retention_curve", "c4_engagement_retention", "c5_engagement_monetization", "c6_geo_shape", "c7_session_depth", "c8_analysis"],
        outputs: ["retention_brief"],
        prompt: `Create a rich markdown brief tearing down Presto retention and engagement.

Include:
1. A one-paragraph direct answer on the retention trend and the single biggest lever.
2. A retention curve table or chart of monthly D7/D14/D30 retention, with right-censored cohorts labelled.
3. An engagement section quantifying the retention and LTV gap between low, medium, and high tiers, and the D60 ROAS link.
4. A geo section naming the frontloaded churn-risk markets versus durable markets, using the D30-to-D14 survival ratio, and the projection-bias warning.
5. A session-depth read tying sessions per player to engagement tier.
6. A levers section: how to grow the high-engagement mix, where to guard against frontloaded-geo LTV bias, and what to watch next.

Use the raw numbers from the data. Be precise about elapsed versus projected windows and avoid guaranteed-outcome language.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded retention and engagement cohort teardown for Presto.",
        changes: [
          {
            type: "add",
            cellLabel: "Flag Frontloaded Geos",
            cellId: "c6_geo_shape",
            detail: "Ranks geos by the D30-to-D14 survival ratio to separate frontloaded churn-risk markets from durable markets.",
          },
        ],
      },
    ],
  };
}

// ── Playbook 3: Ad Monetization & Fill Quality ──
const AD_MONETIZATION_SLUG = "ad-monetization-fill-quality";

function buildPrestoAdMonetizationPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", AD_MONETIZATION_SLUG);
  return {
    id,
    schemaVersion: 2,
    name: "Ad Monetization & Fill Quality",
    description:
      "Audit the ad-revenue engine end to end for an ad-funded game: walk the reported to settled to net revenue waterfall by channel to size fraud leakage, test whether ARPDAU is growing or whether revenue is purely volume-driven, break value by ad format and geo and platform, and grade settled fill quality by ad network.",
    category: "Monetization",
    version: "1.0",
    approvalStatus: "approved",
    owner: PLAYBOOK_OWNER,
    ownerInitials: PLAYBOOK_OWNER_INITIALS,
    datasetId: PRESTO_DATASET_ID,
    sourceQuery:
      "How much reported ad revenue actually settles after fraud by channel, is ARPDAU improving or flat, and where is monetization concentrated by format, geo, platform, and ad network?",
    params: [
      { name: "min_active_users", label: "Minimum active users per geo cell", type: "integer", defaultVal: "1000", group: "Filters" },
      { name: "geo_limit", label: "Geo x platform rows", type: "integer", defaultVal: "12", group: "Output" },
    ],
    produces: [
      {
        name: "revenue_waterfall",
        description: "Reported to settled to net revenue by channel with fraud loss and loss percentage.",
        columns: [
          { name: "channel", description: "Acquisition channel attributed to the impression." },
          { name: "fraud_loss_pct", description: "Reported revenue lost to fraud as a percentage." },
        ],
      },
      { name: "arpdau_trend", description: "Monthly active users, settled revenue, and blended ARPDAU to test volume versus monetization growth." },
      { name: "format_mix", description: "Impressions, reported and settled revenue, and settle rate by ad format." },
      { name: "geo_arpdau", description: "Blended ARPDAU by country and platform above the active-user floor." },
      { name: "network_quality", description: "Settle rate and fraud rate by ad network for fill-quality grading." },
    ],
    cells: [
      {
        id: "c1_guardrail",
        label: "Check Monetization Inputs",
        description: "Confirm the revenue summary, ARPDAU trend, and raw impression tables are populated and current before the audit runs.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT 'monthly_revenue_summary' AS check_name, COUNT(*) AS record_count, CAST(MAX(month) AS VARCHAR) AS latest_month FROM monthly_revenue_summary
  UNION ALL
  SELECT 'arpdau_trend' AS check_name, COUNT(*) AS record_count, CAST(MAX(month) AS VARCHAR) AS latest_month FROM arpdau_trend
  UNION ALL
  SELECT 'ad_impression_events' AS check_name, COUNT(*) AS record_count, CAST(MAX(ts) AS VARCHAR) AS latest_month FROM ad_impression_events
)
SELECT
  check_name,
  record_count,
  latest_month,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks
ORDER BY check_name`,
      },
      {
        id: "c2_revenue_scale",
        label: "Resolve Revenue Window",
        description: "Compute total reported and settled revenue and the blended fraud loss to anchor the audit before slicing.",
        type: "sql",
        role: "parameter",
        status: "idle",
        dependsOn: ["c1_guardrail"],
        outputs: ["revenue_scale"],
        sql: `SELECT
  CAST(MIN(month) AS VARCHAR) AS earliest_month,
  CAST(MAX(month) AS VARCHAR) AS latest_month,
  ROUND(SUM(reported_revenue), 0) AS total_reported_revenue,
  ROUND(SUM(settled_revenue), 0) AS total_settled_revenue,
  ROUND(SUM(fraud_loss), 0) AS total_fraud_loss,
  ROUND(SUM(fraud_loss) * 100.0 / NULLIF(SUM(reported_revenue), 0), 2) AS blended_fraud_loss_pct
FROM monthly_revenue_summary`,
      },
      {
        id: "c3_revenue_waterfall",
        label: "Build Revenue Waterfall",
        description: "Walk reported to settled to net revenue by channel and size the fraud leakage that never settles.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_revenue_scale"],
        outputs: ["revenue_waterfall"],
        sql: `SELECT
  channel,
  SUM(impressions) AS impressions,
  ROUND(SUM(reported_revenue), 0) AS reported_revenue,
  ROUND(SUM(settled_revenue), 0) AS settled_revenue,
  ROUND(SUM(net_revenue), 0) AS net_revenue,
  ROUND(SUM(fraud_loss), 0) AS fraud_loss,
  ROUND(SUM(fraud_loss) * 100.0 / NULLIF(SUM(reported_revenue), 0), 2) AS fraud_loss_pct,
  ROUND(AVG(avg_fraud_rate), 4) AS avg_fraud_rate,
  ROUND(SUM(net_revenue) * 100.0 / NULLIF(SUM(reported_revenue), 0), 2) AS net_to_reported_pct
FROM monthly_revenue_summary
GROUP BY channel
ORDER BY reported_revenue DESC`,
      },
      {
        id: "c4_arpdau_trend",
        label: "Test ARPDAU Growth",
        description: "Track monthly active users, settled revenue, and blended ARPDAU to separate volume-driven growth from monetization improvement.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_revenue_scale"],
        outputs: ["arpdau_trend"],
        sql: `WITH monthly AS (
  SELECT
    CAST(strftime(month, '%Y-%m') AS VARCHAR) AS month,
    SUM(active_users) AS active_users,
    SUM(total_settled_revenue) AS settled_revenue
  FROM arpdau_trend
  GROUP BY 1
)
SELECT
  month,
  active_users,
  ROUND(settled_revenue, 0) AS settled_revenue,
  ROUND(settled_revenue / NULLIF(active_users, 0), 4) AS arpdau_blended,
  ROUND(
    (settled_revenue / NULLIF(active_users, 0))
    - LAG(settled_revenue / NULLIF(active_users, 0)) OVER (ORDER BY month), 4
  ) AS arpdau_mom_change
FROM monthly
ORDER BY month`,
      },
      {
        id: "c5_format_mix",
        label: "Break Value by Format",
        description: "Split impressions, reported and settled revenue, and settle rate by ad format from raw impression events.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_revenue_scale"],
        outputs: ["format_mix"],
        sql: `SELECT
  ad_format,
  COUNT(*) AS impressions,
  ROUND(SUM(revenue), 0) AS reported_revenue,
  ROUND(SUM(settled_revenue), 0) AS settled_revenue,
  ROUND(SUM(settled_revenue) * 1000.0 / NULLIF(COUNT(*), 0), 3) AS settled_ecpm,
  ROUND(SUM(settled_revenue) * 100.0 / NULLIF(SUM(revenue), 0), 2) AS settle_rate_pct,
  ROUND(SUM(revenue) * 100.0 / NULLIF(SUM(SUM(revenue)) OVER (), 0), 2) AS reported_revenue_share_pct
FROM ad_impression_events
GROUP BY ad_format
ORDER BY reported_revenue DESC`,
      },
      {
        id: "c6_geo_arpdau",
        label: "Map ARPDAU by Geo",
        description: "Rank blended ARPDAU by country and platform above the active-user floor to locate the premium monetization slices.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_revenue_scale"],
        outputs: ["geo_arpdau"],
        sql: `SELECT
  country,
  platform,
  SUM(active_users) AS active_users,
  ROUND(SUM(total_settled_revenue), 0) AS settled_revenue,
  ROUND(SUM(total_settled_revenue) / NULLIF(SUM(active_users), 0), 4) AS arpdau
FROM arpdau_trend
GROUP BY country, platform
HAVING SUM(active_users) >= {{min_active_users}}
ORDER BY arpdau DESC
LIMIT {{geo_limit}}`,
      },
      {
        id: "c7_network_quality",
        label: "Grade Network Fill Quality",
        description: "Grade settled fill quality and fraud exposure by ad network from raw impression events.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_revenue_scale"],
        outputs: ["network_quality"],
        sql: `SELECT
  ad_platform AS ad_network,
  COUNT(*) AS impressions,
  ROUND(SUM(revenue), 0) AS reported_revenue,
  ROUND(SUM(settled_revenue), 0) AS settled_revenue,
  ROUND(SUM(settled_revenue) * 100.0 / NULLIF(SUM(revenue), 0), 2) AS settle_rate_pct,
  ROUND(AVG(fraud_rate), 4) AS avg_fraud_rate,
  ROUND(SUM(settled_revenue) * 1000.0 / NULLIF(COUNT(*), 0), 3) AS settled_ecpm
FROM ad_impression_events
GROUP BY ad_platform
ORDER BY reported_revenue DESC`,
      },
      {
        id: "c8_analysis",
        label: "Diagnose Monetization Quality",
        description: "Interpret the revenue waterfall, ARPDAU trend, format mix, geo ARPDAU, and network quality using only the computed rows.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_revenue_waterfall", "c4_arpdau_trend", "c5_format_mix", "c6_geo_arpdau", "c7_network_quality"],
        outputs: ["monetization_diagnosis"],
        prompt: `Analyze Presto ad monetization and fill quality using only the upstream query results.

Cover:
- the reported to settled to net waterfall by channel, naming the highest fraud-leakage channels and how much reported revenue never settles;
- whether ARPDAU is rising, flat, or falling month over month, and the implication that revenue growth is volume-driven versus monetization-driven;
- how value splits by ad format and which format carries the higher settled eCPM;
- which country and platform slices are the premium ARPDAU pockets and which are thin;
- how settle rate and fraud rate vary by ad network for fill-quality grading.

Cite actual numbers, channel names, and network names. Distinguish reported revenue from settled and net revenue throughout. Do not invent figures.`,
      },
      {
        id: "c9_summary",
        label: "Ad Monetization Audit Brief",
        description: "Produce the final markdown brief with the revenue waterfall, the ARPDAU verdict, the format and geo mix, and concrete monetization actions.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_guardrail", "c2_revenue_scale", "c3_revenue_waterfall", "c4_arpdau_trend", "c5_format_mix", "c6_geo_arpdau", "c7_network_quality", "c8_analysis"],
        outputs: ["monetization_brief"],
        prompt: `Create a rich markdown brief auditing Presto ad monetization and fill quality.

Include:
1. A one-paragraph direct answer on total settled vs reported revenue, the blended fraud loss, and whether monetization is improving.
2. A revenue waterfall table by channel with reported, settled, net, and fraud loss percentage.
3. An ARPDAU section with a monthly trend chart or table and an explicit volume-versus-monetization verdict.
4. A format and geo section naming the higher-eCPM format and the premium country and platform pockets.
5. A network fill-quality section grading settle rate and fraud rate by ad network.
6. An actions section: where to tighten fraud controls, which networks or geos to lean into, and what monetization experiments to run, with the caveat that settled revenue is the audited figure and reported revenue overstates value.

Use the raw numbers from the data. Keep settled and net revenue distinct from reported throughout and avoid guaranteed-outcome language.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded ad monetization and fill quality audit for Presto.",
        changes: [
          {
            type: "add",
            cellLabel: "Build Revenue Waterfall",
            cellId: "c3_revenue_waterfall",
            detail: "Walks reported to settled to net revenue by channel and sizes the fraud leakage that never settles.",
          },
        ],
      },
    ],
  };
}

export function seedPrestoPlaybooks(userId: string): number {
  const builders = [
    buildPrestoRoasPaybackPlaybook,
    buildPrestoRetentionTeardownPlaybook,
    buildPrestoAdMonetizationPlaybook,
  ];
  let count = 0;
  for (const build of builders) {
    const playbook = build(userId);
    if (getPlaybook(userId, playbook.id)) continue;
    upsertPlaybook(userId, playbook);
    count++;
  }
  return count;
}

export async function seedPrestoSampleWorkspace(userId: string): Promise<{
  segments: number;
  funnels: number;
  retentions: number;
  playbooks: number;
  voiceCampaigns: number;
}> {
  let segmentCount = 0;
  for (const segment of SEGMENTS) {
    try {
      const userCount = await countSegment(segment.sql);
      upsertSegment(userId, {
        id: seedId(userId, "seg", segment.slug),
        name: segment.name,
        description: segment.description,
        sql: segment.sql,
        userCount,
        datasetId: PRESTO_DATASET_ID,
      });
      segmentCount++;
    } catch (err) {
      console.warn(`[presto-seed] segment ${segment.slug} failed:`, err);
    }
  }

  let funnelCount = 0;
  for (const funnel of FUNNELS) {
    try {
      const overallConversion = await funnelConversion(funnel.config);
      upsertFunnel(userId, {
        id: seedId(userId, "fun", funnel.slug),
        name: funnel.name,
        description: funnel.description,
        config: funnel.config,
        source: "auto",
        overallConversion,
        datasetId: PRESTO_DATASET_ID,
      });
      funnelCount++;
    } catch (err) {
      console.warn(`[presto-seed] funnel ${funnel.slug} failed:`, err);
    }
  }

  let retentionCount = 0;
  for (const retention of RETENTIONS) {
    try {
      const d7 = await d7Retention(retention.config);
      upsertRetention(userId, {
        id: seedId(userId, "ret", retention.slug),
        name: retention.name,
        description: retention.description,
        config: retention.config,
        source: "auto",
        d7Retention: d7,
        datasetId: PRESTO_DATASET_ID,
      });
      retentionCount++;
    } catch (err) {
      console.warn(`[presto-seed] retention ${retention.slug} failed:`, err);
    }
  }

  let playbookCount = 0;
  try {
    playbookCount = seedPrestoPlaybooks(userId);
  } catch (err) {
    console.warn("[presto-seed] playbooks failed:", err);
  }

  // Voice campaigns are created manually per workspace; not seeded.
  const voiceCampaignCount = 0;

  return {
    segments: segmentCount,
    funnels: funnelCount,
    retentions: retentionCount,
    playbooks: playbookCount,
    voiceCampaigns: voiceCampaignCount,
  };
}
