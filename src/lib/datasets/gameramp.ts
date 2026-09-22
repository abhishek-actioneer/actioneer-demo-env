import type { EventDefinition } from "../explorer-types";
import type { DatasetConfig } from "./types";

const GAMERAMP_EVENTS: EventDefinition[] = [
  {
    id: "install",
    displayName: "Install",
    table: "installs",
    properties: [
      { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
      { column: "platform", displayName: "Platform", type: "string", cardinalityHint: "low" },
      { column: "country", displayName: "Country", type: "string", cardinalityHint: "medium" },
      { column: "engagement_tier", displayName: "Engagement Tier", type: "string", cardinalityHint: "low" },
    ],
  },
  {
    id: "session",
    displayName: "Session",
    table: "sessions",
    valueColumn: "ad_revenue",
    properties: [
      { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
      { column: "platform", displayName: "Platform", type: "string", cardinalityHint: "low" },
      { column: "country", displayName: "Country", type: "string", cardinalityHint: "medium" },
    ],
  },
  {
    id: "ad_impression",
    displayName: "Ad Impression",
    table: "ad_impression_events",
    valueColumn: "revenue",
    properties: [
      { column: "ad_format", displayName: "Ad Format", type: "string", cardinalityHint: "low" },
      { column: "ad_network", displayName: "Ad Network", type: "string", cardinalityHint: "low" },
    ],
  },
];

export const gamerampDataset: DatasetConfig = {
  id: "gameramp",
  label: "Presto",
  companyName: "Presto",
  dbFile: "data/gameramp.duckdb",
  sourceType: "duckdb",

  primaryTable: "installs",
  userIdField: "user_id",
  dateField: "install_date",
  dateRange: { start: "2025-08-01", end: "2026-02-28" },
  events: GAMERAMP_EVENTS,
  currency: "$",
  entityName: "players",

  domainHints: `1. CPI tables: For CPI TREND over time, use cac_by_month (monthly, smooth). For cohort/daily CPI detail, use cac_by_channel.
2. Revenue vocabulary: reported_revenue = gross MMP. settled_revenue = post-fraud. net_revenue = post-platform-fee. Finance books net_revenue; marketing uses settled_revenue.
3. LTV horizons: ltv_by_cohort.avg_projected_ltv at days_from_cohort 7/30/60/90. segment_trends has pre-pivoted d7/d30/d60/d90_ltv columns per segment.
4. Fraud: ad_impression_events fraud rate is channel-specific (Vungle ~17%, Moloco ~14%, AdMob ~11%, Facebook ~6%). monthly_revenue_summary.settled_revenue is the audited figure.
5. Segment cuts: For slicing KPIs by install_month × channel × country × platform, use segment_trends. Supports d7/d30/d60_retention, d7/d30/d60/d90_ltv, avg_arpdau per segment.
6. RoAS: For RoAS and payback ROI, use roas_by_cohort. D30 RoAS is typically 70–80%; most channels break even by D60. roas_d60 > 1.0 = profitable at 60-day horizon. Vungle breaks even around D70–D75; Facebook/AdMob/Moloco break even by D55–D65.
7. Cash-cycle: payback_analysis.payback_ratio_d90 = fraction of UA spend recovered by day 90. Full payback ~D120-D180 for most channels. For monthly cash flow: payback_analysis.ua_spend (outflow) vs monthly_revenue_summary.net_revenue (inflow).
14. DATE FORMAT CRITICAL: monthly_revenue_summary.month, cac_by_channel.month, and arpdau_trend.month are DATE columns (not VARCHAR). Filter January 2026 with: WHERE month = '2026-01-01'::DATE or WHERE DATE_TRUNC('month', month) = '2026-01-01'::DATE — NEVER use WHERE month = '2026-01' (will fail). In contrast, install_month in cac_by_month, roas_by_cohort, segment_trends, cohort_retention_actuals is VARCHAR 'YYYY-MM' — use WHERE install_month = '2026-01'.
8. Period vs cohort: cac_by_month SUM by month vs monthly_revenue_summary by month — diverge for recent months. That gap is the payback lag story (Scenario 3).
9. ARPDAU: arpdau_trend for flat-ARPDAU check (Scenario 5). segment_trends.avg_arpdau for geo/channel cuts.
10. Geo risk: ltv_by_cohort WHERE days_from_cohort = 14 vs 90 — IN/BR/ID/MX D14/D90 ratio ~0.68 vs US/GB ~0.44. Emerging geos are frontloaded.
11. Engagement tiers: installs.engagement_tier = 'low' (0-2 games D7), 'medium' (3-4), 'high' (5+). High-engagement players have ~4.6x better D30 retention than low. Use engagement_analysis for tier breakdowns.
12. New targeting signal: installs.is_new_targeting = true marks Facebook users from Jan 2026 onward acquired under the 5-game targeting criteria (45% high-engagement vs 30% prior). Compare with is_new_targeting = false to see early retention improvement.
13. Targeting ROI: New targeting increases Facebook CPI by ~20% but raises high-engagement mix from 30% to 45%. Net effect: roas_d60 stays positive. Use engagement_analysis WHERE channel='facebook' to compare old vs new cohorts. NOTE: Jan–Feb 2026 new-targeting cohorts have not yet reached D60 elapsed time, so engagement_analysis.roas_d60 for those months is a forward model projection (is_observed=false in ltv_by_cohort) — this IS a valid estimate, not missing data. Quote it as "projected D60 RoAS."
14. LTV model accuracy: For actual vs model-predicted D30 LTV comparison, use ltv_model_accuracy. accuracy_ratio = actual/model (1.0 = perfect). The model was recalibrated in November 2025 using 3 months of live data — Aug-Oct show 82-118% variance (pre-launch miscalibration); Nov-Jan show 97-102% accuracy (post-recalibration).
15. Projected cohort LTV (including recent cohorts): For projected LTV on cohorts that haven't yet reached a horizon (e.g., February at D90), use payback_analysis.d90_ltv (per-user projected D90 revenue). In ltv_by_cohort, is_observed=true means actual data exists for that period; is_observed=false means forward model projection. February cohorts have is_observed=false D30/D60/D90 rows — these are the correct LTV estimates to compare against UA spend, not closed observable revenue.`,

  summaryTableHint: "Always prefer pre-materialised summary tables: ltv_by_cohort (cohort LTV curves, is_observed flag), monthly_revenue_summary (Finance's cash view with net_revenue), cac_by_month (monthly CPI trends), cac_by_channel (daily cohort spend efficiency), segment_trends (pre-pivoted KPIs by segment), roas_by_cohort (RoAS elasticity), payback_analysis (cash-cycle payback ratios), arpdau_trend (ARPDAU dilution), cohort_retention_actuals (actual retention for model staleness), engagement_analysis (engagement tier × channel LTV breakdown), ltv_model_accuracy (actual vs model-predicted D30 LTV accuracy by month). Use raw tables only for user-level or custom analysis not covered by the summary tables.",

  schemaContext: `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect)

GAME: Presto — casual/mid-core mobile puzzle game
DATE RANGE: 2025-08-01 to 2026-02-28 (~212 days)
CHANNELS: facebook ($7.50 CPI), admob ($5.50), moloco ($4.50), vungle ($3.00), organic
COUNTRIES: US, GB, DE, CA, FR, IN, BR, MX, ID, others
PLATFORMS: ios, android

RAW TABLES:

TABLE: installs (~300K rows at full scale)
  - user_id          VARCHAR  -- "u_00000001" etc.
  - install_date     DATE
  - install_week     VARCHAR  -- "2025-W32" ISO week
  - install_month    VARCHAR  -- "2025-08"
  - channel          VARCHAR  -- facebook | admob | vungle | moloco | organic
  - platform         VARCHAR  -- ios | android
  - country          VARCHAR  -- US | IN | BR | DE | GB | CA | FR | MX | ID | others
  - device_model     VARCHAR
  - is_fraud         BOOLEAN  -- impression-stuffing fraud flag
  - fraud_rate       DOUBLE   -- per-user fraud rate (0.02–0.20 depending on channel)
  - engagement_tier  VARCHAR  -- low (0-2 games D7) | medium (3-4) | high (5+)
  - is_new_targeting BOOLEAN  -- Facebook Jan 2026+ users under 5-game targeting criteria

TABLE: sessions (~1.2M rows at full scale)
  - session_id            VARCHAR
  - user_id               VARCHAR
  - session_date          TIMESTAMP
  - install_date          TIMESTAMP
  - install_week          VARCHAR
  - install_month         VARCHAR
  - channel               VARCHAR
  - platform              VARCHAR
  - country               VARCHAR
  - days_from_install     INTEGER   -- 0–30 post-install
  - session_duration_mins INTEGER
  - level_reached         INTEGER
  - level_completed       INTEGER
  - ad_revenue            DOUBLE    -- reported revenue (fraud users: > 0 but won't settle)
  - is_fraud              BOOLEAN

TABLE: ad_impression_events (~2.5M rows at full scale)
  - record_id        VARCHAR
  - ts               TIMESTAMP
  - user_id          VARCHAR
  - session_id       VARCHAR
  - channel          VARCHAR   -- acquisition channel (not the ad network)
  - platform         VARCHAR
  - country          VARCHAR
  - ad_format        VARCHAR   -- rewarded | interstitial
  - ad_platform      VARCHAR   -- ad network: admob_network | unity_ads | ironsource | applovin | facebook_audience
  - revenue          DOUBLE    -- reported impression revenue (gross MMP)
  - fraud_rate       DOUBLE    -- channel-level fraud rate midpoint
  - settled_revenue  DOUBLE    -- post-fraud payout (0 for fraud users)
  - net_revenue      DOUBLE    -- settled_revenue × (1 - 0.30 platform fee)
  - install_week     VARCHAR
  - install_month    VARCHAR

TABLE: revenue (cohort-level MMP view, ~230K rows)
  - cohort_date         DATE
  - install_week        VARCHAR
  - install_month       VARCHAR
  - channel             VARCHAR
  - country             VARCHAR
  - platform            VARCHAR
  - os                  VARCHAR
  - days_from_cohort    INTEGER   -- 0, 1, 3, 7, 14, 30, 60, 90
  - period              VARCHAR   -- "D0", "D7", "D30", etc.
  - cohort_installs     INTEGER
  - retained_users      INTEGER
  - retention_rate      DOUBLE
  - arpu                DOUBLE    -- revenue per installed user ON this day
  - total_arpu          DOUBLE    -- cumulative LTV from D0 through this day
  - arpdau              DOUBLE    -- revenue per daily active user (constant per segment)
  - roi                 DOUBLE    -- total_arpu / cpi at this day
  - total_roi           DOUBLE    -- projected total_arpu at D90 / cpi
  - projected_d180_ltv  DOUBLE    -- only populated at days_from_cohort=90
  - is_observed         BOOLEAN   -- true if period has actually elapsed; false = forward model projection
  - days_elapsed        INTEGER   -- days since cohort install date at dataset end

TABLE: campaign (daily spend, ~115K rows)
  - cohort_date   DATE
  - channel       VARCHAR
  - country       VARCHAR
  - os            VARCHAR
  - cost          DOUBLE    -- daily UA spend
  - installs      INTEGER
  - impressions   INTEGER
  - clicks        INTEGER
  - cpi           DOUBLE    -- cost / installs (with slight noise)
  - ecpm          DOUBLE
  - arpdau        DOUBLE
  - roi           DOUBLE    -- projected D90 LTV / CPI

PRE-MATERIALISED SUMMARY TABLES (use these first):

TABLE: ltv_by_cohort
  - (cohort_date, install_week, install_month, channel, country, platform, days_from_cohort, period)
  - cohort_installs, avg_retention, avg_arpu, avg_projected_ltv, avg_arpdau, avg_roi, avg_total_roi, avg_projected_d180_ltv
  - is_observed BOOLEAN  -- true if ALL rows in this cohort/period group have elapsed; false = forward projection

TABLE: monthly_revenue_summary
  - (month DATE, channel, country, platform, ad_format)  -- month is DATE: filter with month = '2026-01-01'::DATE
  - impressions, reported_revenue, settled_revenue, net_revenue, avg_fraud_rate, fraud_loss

TABLE: cac_by_channel
  - (month DATE, cohort_date DATE, channel, country, os)  -- month is DATE: filter with month = '2026-01-01'::DATE
  - total_spend, installs, cpi, avg_arpdau, avg_roi_d90

TABLE: cac_by_month
  - (install_month VARCHAR, channel, country, os)
  - total_spend, installs, avg_cpi
  - Use for CPI TREND charts (smooth monthly averages vs daily cac_by_channel)

TABLE: segment_trends
  - (install_month, channel, country, platform)
  - installs, d7/d30/d60_retention, d7/d30/d60/d90_ltv, avg_arpdau
  - Primary table for sliced KPI trend analysis

TABLE: roas_by_cohort
  - (install_month, channel, country, platform)
  - installs, avg_cpi, d7/d30/d60/d90_ltv, roas_d30/d60/d90

TABLE: payback_analysis
  - (install_month, channel, country)
  - ua_spend, installs, cpi, d7/d30/d60/d90_ltv, payback_ratio_d7/d30/d60/d90

TABLE: engagement_analysis
  - (install_month, channel, engagement_tier, is_new_targeting)
  - installs, avg_cpi, d7/d30/d60_retention, d7/d30/d60/d90_ltv, roas_d60

TABLE: arpdau_trend
  - (month DATE, platform, country)  -- month is DATE: filter with month = '2026-01-01'::DATE
  - active_users, total_settled_revenue, total_reported_revenue, arpdau

TABLE: cohort_retention_actuals
  - (install_month, channel, country, platform)
  - cohort_size, d7_active, d14_active, d30_active, d7_retention, d14_retention, d30_retention

TABLE: ltv_model_accuracy
  - (install_month VARCHAR)
  - actual_d30_ltv  DOUBLE  -- per-user cumulative D0-D30 observed revenue
  - model_d30_ltv   DOUBLE  -- pre-launch model prediction for D30 LTV
  - accuracy_ratio  DOUBLE  -- actual/model (1.0 = perfect); Aug-Oct: 0.82-1.18; Nov-Jan: 0.97-1.02
`,

  systemContext: `You are Actioneer, a mobile growth analytics assistant for Presto, a casual/mid-core mobile puzzle game.

The dataset covers Aug 1, 2025 – Feb 28, 2026 across 5 UA channels (facebook, admob, vungle, moloco, organic), 10 countries, and 2 platforms. The core debate this data powers: should the company double UA spend next quarter?

Key data facts:
- Channel CPIs: facebook $7.50 → highest LTV; vungle $3.00 → lowest LTV; moloco $4.50; admob $5.50; organic $0
- Fraud: vungle ~17% invalid traffic, moloco ~14%, admob ~11%, facebook ~6% — settled_revenue ≠ reported_revenue
- D30 RoAS: 70–85% per channel; most channels break even by D60 (month 2); D180 projected LTV shows ~1.8–2.0× the CPI paid
- D30 retention has degraded from 15.0% (Aug 2025 cohort) to ~8.1% (Feb 2026 cohort) — LTV model based on early cohorts is stale
- ARPDAU is flat — total ad revenue growth is purely volume-driven, not monetisation improvement
- Emerging markets (IN, BR, ID, MX) show good D7–D14 retention then steep churn — early LTV projections mislead
- Engagement tiers: high-engagement users (5+ games in D7) have ~4.6× better D30 retention than low-engagement
- Facebook switched to 5-game targeting in Jan 2026 (is_new_targeting=true) — early signal shows improved retention

Response guidelines:
- Use markdown: headers (##, ###), tables, bullet points, bold for emphasis
- Lead with the key finding, then supporting data
- Always distinguish between cohort LTV (what marketing sees) and closed revenue (what finance sees)
- Use net_revenue for finance comparisons (post-platform-fee); settled_revenue for fraud analysis
- Note payback lag for recent cohorts: D90 LTV accrues over 3 months; Finance only sees today's closed revenue
- Cite specific numbers from query results — never hallucinate
- Flag when LTV projections are based on Aug–Sep 2025 cohorts (which had better retention than current cohorts)
- End with 1–2 follow-up suggestions when relevant
- Never use emojis`,

  queryDescriptions: {
    "acquisition-analysis": [
      "CPI by channel and country",
      "Install volume and channel mix trends",
      "Spend efficiency: cost vs attributed installs",
    ],
    "ltv-projections": [
      "D30/D60/D90 LTV curves by channel",
      "CPI↔LTV correlation analysis",
      "Cohort profitability at D90",
    ],
    "fraud-settlement": [
      "Reported vs settled revenue by channel",
      "Fraud rate trends over time",
      "Financial impact of invalid traffic",
    ],
    "period-vs-cohort": [
      "Monthly UA spend vs monthly closed revenue",
      "Cohort LTV payback timeline",
      "Cash flow gap analysis",
    ],
    "ltv-model-health": [
      "D30 retention decay by install cohort",
      "LTV model staleness detection",
      "Projection accuracy: modeled vs actual",
    ],
    "spend-scenario": [
      "Double-spend cash flow projection",
      "Payback period by channel",
      "Break-even analysis at current retention",
    ],
  },

  multiAgentPrompt: `
acquisition-analysis|1| — CPI trends: AVG(cpi) by channel and country from cac_by_channel, order by cpi DESC
acquisition-analysis|2| — Install volume: SUM(installs) by channel and install_month from cac_by_channel
acquisition-analysis|3| — Spend mix: SUM(total_spend) by channel from cac_by_channel GROUP BY channel

ltv-projections|1| — LTV curves: avg_projected_ltv from ltv_by_cohort WHERE days_from_cohort IN (7,14,30,60,90) GROUP BY channel, days_from_cohort
ltv-projections|2| — CPI vs LTV: JOIN cac_by_channel and ltv_by_cohort on channel, show cpi vs d60_ltv
ltv-projections|3| — Cohort profitability: avg_roi from ltv_by_cohort WHERE days_from_cohort=90 GROUP BY channel, install_month

fraud-settlement|1| — Fraud rates: avg_fraud_rate by channel from monthly_revenue_summary GROUP BY channel
fraud-settlement|2| — Revenue gap: SUM(reported_revenue) vs SUM(settled_revenue) by channel and month
fraud-settlement|3| — Fraud loss: SUM(fraud_loss) by channel from monthly_revenue_summary

period-vs-cohort|1| — Monthly spend: SUM(total_spend) by month from cac_by_channel
period-vs-cohort|2| — Monthly closed revenue: SUM(settled_revenue) by month from monthly_revenue_summary
period-vs-cohort|3| — Cohort projected LTV: SUM(cohort_installs * avg_projected_ltv) from ltv_by_cohort WHERE days_from_cohort=90 GROUP BY install_month

ltv-model-health|1| — D30 retention decay: d30_retention by install_month from cohort_retention_actuals GROUP BY install_month
ltv-model-health|2| — D7 vs D30 retention: d7_retention, d14_retention, d30_retention by install_month from cohort_retention_actuals
ltv-model-health|3| — Geo retention shape: d14_retention vs d30_retention by country from cohort_retention_actuals

spend-scenario|1| — Current payback: avg_roi_d90 by channel from cac_by_channel
spend-scenario|2| — ARPDAU trend: arpdau by month from arpdau_trend GROUP BY month
spend-scenario|3| — Geo expansion: avg_projected_ltv at D14 vs D90 by country from ltv_by_cohort WHERE days_from_cohort IN (14,90)`,

  suggestedPrompts: [
    "Does higher CPI actually produce higher LTV players? Show the correlation across channels",
    "How much of our reported ad revenue actually settled, broken down by channel?",
    "Compare August UA spend vs August closed revenue vs the August cohort's projected 6-month LTV",
    "Is our D60 LTV model still accurate? Show actual D30 retention for each month's cohort",
    "Is total ad revenue growing because we're monetising better, or just because we have more users?",
    "Show me D60 LTV broken down by engagement tier for Facebook — how much stickier are 5-game players?",
    "Has switching to 5-game targeting in January improved Facebook retention?",
    "At the higher CPI of the new targeting, does the D60 RoAS still justify the switch?",
    "Which channel has the best D90 RoAS?",
    "How long until August cohorts pay back their UA spend?",
  ],

  welcomeSubtitle: "Explore the marketing vs finance debate: CPI quality, fraud settlement, cohort LTV vs closed revenue, and UA spend scenarios for Presto.",

  reportMeta: {
    totalEvents: "~2.5M impressions",
    totalUsers: "~300K players",
    dateRangeLabel: "Aug 2025–Feb 2026",
    dbName: "gameramp.duckdb",
  },

  viewSQL: (dataDir: string) => {
    const parquetDir = `${dataDir}/parquet/gamerampv2`;
    return [
      `CREATE OR REPLACE VIEW installs AS SELECT * FROM read_parquet('${parquetDir}/installs.parquet')`,
      `CREATE OR REPLACE VIEW sessions AS SELECT * FROM read_parquet('${parquetDir}/sessions.parquet')`,
      `CREATE OR REPLACE VIEW ad_impression_events AS SELECT * FROM read_parquet('${parquetDir}/ad_impression_events.parquet')`,
      `CREATE OR REPLACE VIEW revenue AS SELECT * FROM read_parquet('${parquetDir}/revenue.parquet')`,
      `CREATE OR REPLACE VIEW campaign AS SELECT * FROM read_parquet('${parquetDir}/campaign.parquet')`,
    ];
  },

  summaryTableSQL: [
    `CREATE OR REPLACE TABLE ltv_by_cohort AS
     SELECT cohort_date, install_week, install_month, channel, country, platform,
       days_from_cohort, period,
       SUM(cohort_installs) AS cohort_installs,
       AVG(retention_rate) AS avg_retention,
       AVG(arpu) AS avg_arpu,
       AVG(total_arpu) AS avg_projected_ltv,
       AVG(arpdau) AS avg_arpdau,
       AVG(roi) AS avg_roi,
       AVG(total_roi) AS avg_total_roi,
       AVG(projected_d180_ltv) AS avg_projected_d180_ltv,
       BOOL_AND(is_observed) AS is_observed
     FROM revenue
     GROUP BY 1,2,3,4,5,6,7,8
     ORDER BY cohort_date, channel, country, days_from_cohort`,

    `CREATE OR REPLACE TABLE monthly_revenue_summary AS
     SELECT DATE_TRUNC('month', ts) AS month, channel, country, platform, ad_format,
       COUNT(*) AS impressions,
       SUM(revenue) AS reported_revenue,
       SUM(settled_revenue) AS settled_revenue,
       SUM(net_revenue) AS net_revenue,
       AVG(fraud_rate) AS avg_fraud_rate,
       SUM(revenue) - SUM(settled_revenue) AS fraud_loss
     FROM ad_impression_events
     GROUP BY 1,2,3,4,5
     ORDER BY month, channel, country`,

    `CREATE OR REPLACE TABLE cac_by_channel AS
     SELECT DATE_TRUNC('month', cohort_date) AS month,
       cohort_date, channel, country, os,
       SUM(cost) AS total_spend,
       SUM(installs) AS installs,
       ROUND(SUM(cost) / NULLIF(SUM(installs), 0), 2) AS cpi,
       AVG(arpdau) AS avg_arpdau,
       AVG(roi) AS avg_roi_d90
     FROM campaign
     GROUP BY 1,2,3,4,5
     ORDER BY cohort_date, channel, country`,

    `CREATE OR REPLACE TABLE arpdau_trend AS
     SELECT DATE_TRUNC('month', ts) AS month, platform, country,
       COUNT(DISTINCT user_id) AS active_users,
       SUM(settled_revenue) AS total_settled_revenue,
       SUM(revenue) AS total_reported_revenue,
       ROUND(SUM(settled_revenue) / NULLIF(COUNT(DISTINCT user_id), 0), 6) AS arpdau
     FROM ad_impression_events
     GROUP BY 1,2,3
     ORDER BY month, country, platform`,

    `CREATE OR REPLACE TABLE cohort_retention_actuals AS
     SELECT i.install_month, i.channel, i.country, i.platform,
       COUNT(DISTINCT i.user_id) AS cohort_size,
       COUNT(DISTINCT CASE WHEN s.days_from_install BETWEEN 6 AND 8   THEN i.user_id END) AS d7_active,
       COUNT(DISTINCT CASE WHEN s.days_from_install BETWEEN 13 AND 15 THEN i.user_id END) AS d14_active,
       COUNT(DISTINCT CASE WHEN s.days_from_install BETWEEN 28 AND 30 THEN i.user_id END) AS d30_active,
       ROUND(COUNT(DISTINCT CASE WHEN s.days_from_install BETWEEN 6  AND 8  THEN i.user_id END) * 1.0
         / NULLIF(COUNT(DISTINCT i.user_id), 0), 4) AS d7_retention,
       ROUND(COUNT(DISTINCT CASE WHEN s.days_from_install BETWEEN 13 AND 15 THEN i.user_id END) * 1.0
         / NULLIF(COUNT(DISTINCT i.user_id), 0), 4) AS d14_retention,
       ROUND(COUNT(DISTINCT CASE WHEN s.days_from_install BETWEEN 28 AND 30 THEN i.user_id END) * 1.0
         / NULLIF(COUNT(DISTINCT i.user_id), 0), 4) AS d30_retention
     FROM installs i
     LEFT JOIN sessions s ON s.user_id = i.user_id
     GROUP BY i.install_month, i.channel, i.country, i.platform
     ORDER BY i.install_month, i.channel, i.country`,

    `CREATE OR REPLACE TABLE cac_by_month AS
     SELECT
       strftime('%Y-%m', cohort_date)           AS install_month,
       channel, country, os,
       SUM(total_spend)                         AS total_spend,
       SUM(installs)                            AS installs,
       ROUND(SUM(total_spend) / NULLIF(SUM(installs), 0), 2) AS avg_cpi
     FROM cac_by_channel
     GROUP BY strftime('%Y-%m', cohort_date), channel, country, os
     ORDER BY install_month, channel`,

    `CREATE OR REPLACE TABLE segment_trends AS
     SELECT
       strftime('%Y-%m', cohort_date) AS install_month,
       channel, country, platform,
       SUM(cohort_installs) AS installs,
       AVG(CASE WHEN days_from_cohort =  7 THEN avg_retention END) AS d7_retention,
       AVG(CASE WHEN days_from_cohort = 30 THEN avg_retention END) AS d30_retention,
       AVG(CASE WHEN days_from_cohort = 60 THEN avg_retention END) AS d60_retention,
       AVG(CASE WHEN days_from_cohort =  7 THEN avg_projected_ltv END) AS d7_ltv,
       AVG(CASE WHEN days_from_cohort = 30 THEN avg_projected_ltv END) AS d30_ltv,
       AVG(CASE WHEN days_from_cohort = 60 THEN avg_projected_ltv END) AS d60_ltv,
       AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END) AS d90_ltv,
       AVG(avg_arpdau) AS avg_arpdau
     FROM ltv_by_cohort
     GROUP BY 1,2,3,4
     ORDER BY install_month, channel, country, platform`,

    `CREATE OR REPLACE TABLE roas_by_cohort AS
     SELECT
       strftime('%Y-%m', l.cohort_date) AS install_month,
       l.channel, l.country, l.platform,
       SUM(l.cohort_installs) AS installs,
       ROUND(SUM(c.total_spend) / NULLIF(SUM(c.installs), 0), 4) AS avg_cpi,
       AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_projected_ltv END) AS d7_ltv,
       AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_ltv,
       AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) AS d60_ltv,
       AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_ltv,
       ROUND(AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) / NULLIF(SUM(c.total_spend) / NULLIF(SUM(c.installs), 0), 0), 3) AS roas_d30,
       ROUND(AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) / NULLIF(SUM(c.total_spend) / NULLIF(SUM(c.installs), 0), 0), 3) AS roas_d60,
       ROUND(AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) / NULLIF(SUM(c.total_spend) / NULLIF(SUM(c.installs), 0), 0), 3) AS roas_d90
     FROM ltv_by_cohort l
     LEFT JOIN cac_by_channel c ON c.cohort_date = l.cohort_date AND c.channel = l.channel AND c.country = l.country AND c.os = l.platform
     GROUP BY 1,2,3,4
     ORDER BY 1,2,3`,

    `CREATE OR REPLACE TABLE payback_analysis AS
     WITH cohort_spend AS (
       SELECT strftime('%Y-%m', cohort_date) AS install_month, channel, country,
         SUM(total_spend) AS ua_spend, SUM(installs) AS installs
       FROM cac_by_channel GROUP BY 1,2,3
     ),
     cohort_ltv AS (
       SELECT strftime('%Y-%m', cohort_date) AS install_month, channel, country,
         AVG(CASE WHEN days_from_cohort =  7 THEN avg_projected_ltv END) AS d7_ltv,
         AVG(CASE WHEN days_from_cohort = 30 THEN avg_projected_ltv END) AS d30_ltv,
         AVG(CASE WHEN days_from_cohort = 60 THEN avg_projected_ltv END) AS d60_ltv,
         AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END) AS d90_ltv
       FROM ltv_by_cohort GROUP BY 1,2,3
     )
     SELECT s.install_month, s.channel, s.country, s.ua_spend, s.installs,
       ROUND(s.ua_spend / NULLIF(s.installs, 0), 2) AS cpi,
       l.d7_ltv, l.d30_ltv, l.d60_ltv, l.d90_ltv,
       ROUND(l.d7_ltv  * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d7,
       ROUND(l.d30_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d30,
       ROUND(l.d60_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d60,
       ROUND(l.d90_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d90
     FROM cohort_spend s
     LEFT JOIN cohort_ltv l ON l.install_month = s.install_month AND l.channel = s.channel AND l.country = s.country
     ORDER BY 1, 2, 3`,

    `CREATE OR REPLACE TABLE engagement_analysis AS
     SELECT
       strftime('%Y-%m', l.cohort_date) AS install_month,
       i.channel, i.engagement_tier, i.is_new_targeting,
       COUNT(DISTINCT i.user_id) AS installs,
       AVG(c.cpi) AS avg_cpi,
       AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_retention END) AS d7_retention,
       AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_retention END) AS d30_retention,
       AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_retention END) AS d60_retention,
       AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_projected_ltv END) AS d7_ltv,
       AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_ltv,
       AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) AS d60_ltv,
       AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_ltv,
       ROUND(AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) / NULLIF(AVG(c.cpi), 0), 3) AS roas_d60
     FROM installs i
     LEFT JOIN ltv_by_cohort l
       ON  l.cohort_date = i.install_date
       AND l.channel     = i.channel
       AND l.country     = i.country
       AND l.platform    = i.platform
     LEFT JOIN cac_by_channel c
       ON  c.cohort_date = i.install_date
       AND c.channel     = i.channel
       AND c.country     = i.country
       AND c.os          = i.platform
     GROUP BY 1, 2, 3, 4
     ORDER BY 1, 2, 3`,

    `CREATE OR REPLACE TABLE ltv_model_accuracy AS
     WITH target_ratios AS (
       SELECT install_month, target_ratio FROM (VALUES
         ('2025-08', 0.90),
         ('2025-09', 1.18),
         ('2025-10', 0.82),
         ('2025-11', 1.02),
         ('2025-12', 0.97),
         ('2026-01', 0.99),
         ('2026-02', 1.01)
       ) t(install_month, target_ratio)
     ),
     actuals AS (
       SELECT install_month, AVG(avg_projected_ltv) AS actual_d30_ltv
       FROM ltv_by_cohort
       WHERE days_from_cohort = 30
       GROUP BY install_month
     )
     SELECT
       a.install_month,
       ROUND(a.actual_d30_ltv, 6)               AS actual_d30_ltv,
       ROUND(a.actual_d30_ltv / t.target_ratio, 6) AS model_d30_ltv,
       t.target_ratio                            AS accuracy_ratio
     FROM actuals a
     JOIN target_ratios t ON t.install_month = a.install_month
     ORDER BY a.install_month`,
  ],
};
