/**
 * alpha_setup.ts — Build the Alpha DuckDB database
 *
 * Reads parquet files from data/parquet/alpha/, creates 6 views, and
 * pre-materialises 12 summary tables for fast query execution.
 *
 * Run AFTER alpha_generate.py:
 *   python3 scripts/alpha_generate.py [--scale 0.01]
 *   npx tsx scripts/alpha_setup.ts
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync, readdirSync } from "fs";
import { resolve } from "path";

const DB_PATH     = resolve(__dirname, "../data/alpha.duckdb");
const PARQUET_DIR = resolve(__dirname, "../data/parquet/alpha");

async function main() {
  console.log("Creating Alpha DuckDB database at:", DB_PATH);

  if (!existsSync(PARQUET_DIR)) {
    console.error(
      `\nParquet directory not found: ${PARQUET_DIR}\n` +
      "Run the generator first:\n" +
      "  python3 scripts/alpha_generate.py --scale 0.01",
    );
    process.exit(1);
  }

  const parquetFiles = readdirSync(PARQUET_DIR).filter((f) => f.endsWith(".parquet"));
  if (parquetFiles.length === 0) {
    console.error("No parquet files found in", PARQUET_DIR);
    process.exit(1);
  }
  console.log("Parquet files found:", parquetFiles.join(", "));

  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();

  // ── 1. Views over raw parquet files ─────────────────────────────────────────

  console.log("\n1. Creating views over parquet files...");

  const viewDefs: Array<[string, string]> = [
    ["installs",             `${PARQUET_DIR}/alpha_installs.parquet`],
    ["sessions",             `${PARQUET_DIR}/alpha_sessions.parquet`],
    ["races",                `${PARQUET_DIR}/alpha_races.parquet`],
    ["ad_impression_events", `${PARQUET_DIR}/alpha_ad_impression_events.parquet`],
    ["revenue",              `${PARQUET_DIR}/alpha_revenue.parquet`],
    ["campaign",             `${PARQUET_DIR}/alpha_campaign.parquet`],
  ];

  for (const [viewName, filePath] of viewDefs) {
    if (!existsSync(filePath)) {
      console.warn(`  ⚠ Skipping ${viewName} (file not found: ${filePath})`);
      continue;
    }
    await conn.run(
      `CREATE OR REPLACE VIEW ${viewName} AS SELECT * FROM read_parquet('${filePath}')`,
    );
    const cnt = await conn.run(`SELECT COUNT(*) FROM ${viewName}`);
    const rows = await cnt.getRows();
    console.log(`  ✓ ${viewName}: ${rows?.[0]?.[0]?.toLocaleString() ?? "?"} rows`);
  }

  // ── 2. ltv_by_cohort ─────────────────────────────────────────────────────────
  // Cohort LTV curves by channel/country/platform with projected LTV columns (Gap 3 fix)

  console.log("\n2. Creating ltv_by_cohort...");
  await conn.run(`
    CREATE OR REPLACE TABLE ltv_by_cohort AS
    SELECT
      r.cohort_date,
      r.install_week,
      r.install_month,
      r.channel,
      r.country,
      r.platform,
      r.days_from_cohort,
      r.period,
      SUM(r.cohort_installs)        AS cohort_installs,
      AVG(r.retention_rate)         AS avg_retention,
      AVG(r.arpu)                   AS avg_arpu,
      AVG(r.total_arpu)             AS avg_projected_ltv,
      AVG(r.arpdau)                 AS avg_arpdau,
      AVG(r.roi)                    AS avg_roi,
      AVG(r.total_roi)              AS avg_total_roi,
      BOOL_AND(r.is_observed)       AS is_observed,
      AVG(r.d30_projected_ltv)      AS d30_projected_ltv,
      AVG(r.d90_projected_ltv)      AS d90_projected_ltv
    FROM revenue r
    GROUP BY
      r.cohort_date, r.install_week, r.install_month,
      r.channel, r.country, r.platform,
      r.days_from_cohort, r.period
    ORDER BY
      r.cohort_date, r.channel, r.country, r.days_from_cohort
  `);
  const ltv = await conn.run("SELECT COUNT(*) FROM ltv_by_cohort");
  console.log(`  ✓ ltv_by_cohort: ${(await ltv.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 3. monthly_revenue_summary ───────────────────────────────────────────────
  // Finance view: reported/settled/net revenue with fraud gap (Scenario 2)
  // Uses dt DATE (not ts TIMESTAMP), reported_revenue/settled_revenue/net_revenue columns

  console.log("\n3. Creating monthly_revenue_summary...");
  await conn.run(`
    CREATE OR REPLACE TABLE monthly_revenue_summary AS
    SELECT
      DATE_TRUNC('month', a.dt)::DATE  AS month,
      a.channel,
      a.country,
      a.platform,
      a.ad_format,
      COUNT(*)                         AS impressions,
      SUM(a.reported_revenue)          AS reported_revenue,
      SUM(a.settled_revenue)           AS settled_revenue,
      SUM(a.net_revenue)               AS net_revenue,
      AVG(a.fraud_rate)                AS avg_fraud_rate,
      SUM(a.reported_revenue) - SUM(a.settled_revenue) AS fraud_loss
    FROM ad_impression_events a
    GROUP BY
      DATE_TRUNC('month', a.dt)::DATE,
      a.channel, a.country, a.platform, a.ad_format
    ORDER BY
      month, a.channel, a.country
  `);
  const mrs = await conn.run("SELECT COUNT(*) FROM monthly_revenue_summary");
  console.log(`  ✓ monthly_revenue_summary: ${(await mrs.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 4. cac_by_channel ────────────────────────────────────────────────────────
  // Spend efficiency: CPI by channel × country × OS

  console.log("\n4. Creating cac_by_channel...");
  await conn.run(`
    CREATE OR REPLACE TABLE cac_by_channel AS
    SELECT
      DATE_TRUNC('month', c.cohort_date)::DATE AS month,
      c.cohort_date,
      c.channel,
      c.country,
      c.os,
      SUM(c.cost)                              AS total_spend,
      SUM(c.installs)                          AS installs,
      ROUND(SUM(c.cost) / NULLIF(SUM(c.installs), 0), 2) AS cpi,
      AVG(c.arpdau)                            AS avg_arpdau,
      AVG(c.roi)                               AS avg_roi_d90
    FROM campaign c
    GROUP BY
      DATE_TRUNC('month', c.cohort_date)::DATE,
      c.cohort_date, c.channel, c.country, c.os
    ORDER BY
      c.cohort_date, c.channel, c.country
  `);
  const cac = await conn.run("SELECT COUNT(*) FROM cac_by_channel");
  console.log(`  ✓ cac_by_channel: ${(await cac.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 5. cac_by_month ──────────────────────────────────────────────────────────
  // Monthly CPI aggregation — smooth trend view

  console.log("\n5. Creating cac_by_month...");
  await conn.run(`
    CREATE OR REPLACE TABLE cac_by_month AS
    SELECT
      strftime('%Y-%m', c.cohort_date)                    AS install_month,
      c.channel, c.country, c.os,
      SUM(c.total_spend)                                  AS total_spend,
      SUM(c.installs)                                     AS installs,
      ROUND(SUM(c.total_spend) / NULLIF(SUM(c.installs), 0), 2) AS avg_cpi
    FROM cac_by_channel c
    GROUP BY
      strftime('%Y-%m', c.cohort_date), c.channel, c.country, c.os
    ORDER BY
      install_month, c.channel
  `);
  const cacMonth = await conn.run("SELECT COUNT(*) FROM cac_by_month");
  console.log(`  ✓ cac_by_month: ${(await cacMonth.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 6. segment_trends ────────────────────────────────────────────────────────
  // Pre-pivoted KPIs by install_month × channel × country × platform

  console.log("\n6. Creating segment_trends...");
  await conn.run(`
    CREATE OR REPLACE TABLE segment_trends AS
    SELECT
      strftime('%Y-%m', l.cohort_date)   AS install_month,
      l.channel, l.country, l.platform,
      SUM(l.cohort_installs)             AS installs,
      AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_retention END) AS d7_retention,
      AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_retention END) AS d30_retention,
      AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_retention END) AS d60_retention,
      AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_projected_ltv END) AS d7_ltv,
      AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_ltv,
      AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) AS d60_ltv,
      AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_ltv,
      AVG(l.avg_arpdau)                  AS avg_arpdau
    FROM ltv_by_cohort l
    GROUP BY
      strftime('%Y-%m', l.cohort_date), l.channel, l.country, l.platform
    ORDER BY
      install_month, l.channel, l.country, l.platform
  `);
  const st = await conn.run("SELECT COUNT(*) FROM segment_trends");
  console.log(`  ✓ segment_trends: ${(await st.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 7. roas_by_cohort ────────────────────────────────────────────────────────
  // ROAS: LTV / CPI by cohort (Scenario 1)

  console.log("\n7. Creating roas_by_cohort...");
  await conn.run(`
    CREATE OR REPLACE TABLE roas_by_cohort AS
    SELECT
      strftime('%Y-%m', l.cohort_date)   AS install_month,
      l.channel, l.country, l.platform,
      SUM(l.cohort_installs)             AS installs,
      AVG(c.cpi)                         AS avg_cpi,
      AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_projected_ltv END) AS d7_ltv,
      AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_ltv,
      AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) AS d60_ltv,
      AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_ltv,
      ROUND(
        AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END)
        / NULLIF(AVG(c.cpi), 0), 3
      ) AS roas_d30,
      ROUND(
        AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END)
        / NULLIF(AVG(c.cpi), 0), 3
      ) AS roas_d60,
      ROUND(
        AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END)
        / NULLIF(AVG(c.cpi), 0), 3
      ) AS roas_d90
    FROM ltv_by_cohort l
    LEFT JOIN cac_by_channel c
      ON  c.cohort_date = l.cohort_date
      AND c.channel     = l.channel
      AND c.country     = l.country
    GROUP BY
      strftime('%Y-%m', l.cohort_date), l.channel, l.country, l.platform
    ORDER BY
      install_month, l.channel, l.country
  `);
  const roas = await conn.run("SELECT COUNT(*) FROM roas_by_cohort");
  console.log(`  ✓ roas_by_cohort: ${(await roas.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 8. payback_analysis ──────────────────────────────────────────────────────
  // Cash-cycle view: payback ratio at D7/D30/D60/D90

  console.log("\n8. Creating payback_analysis...");
  await conn.run(`
    CREATE OR REPLACE TABLE payback_analysis AS
    WITH cohort_spend AS (
      SELECT
        strftime('%Y-%m', c.cohort_date) AS install_month,
        c.channel, c.country,
        SUM(c.total_spend) AS ua_spend,
        SUM(c.installs)    AS installs
      FROM cac_by_channel c
      GROUP BY
        strftime('%Y-%m', c.cohort_date), c.channel, c.country
    ),
    cohort_ltv AS (
      SELECT
        strftime('%Y-%m', l.cohort_date) AS install_month,
        l.channel, l.country,
        AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_projected_ltv END) AS d7_ltv,
        AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_ltv,
        AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) AS d60_ltv,
        AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_ltv
      FROM ltv_by_cohort l
      GROUP BY
        strftime('%Y-%m', l.cohort_date), l.channel, l.country
    )
    SELECT
      s.install_month, s.channel, s.country,
      s.ua_spend, s.installs,
      ROUND(s.ua_spend / NULLIF(s.installs, 0), 2) AS cpi,
      l.d7_ltv, l.d30_ltv, l.d60_ltv, l.d90_ltv,
      ROUND(l.d7_ltv  * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d7,
      ROUND(l.d30_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d30,
      ROUND(l.d60_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d60,
      ROUND(l.d90_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d90
    FROM cohort_spend s
    LEFT JOIN cohort_ltv l
      ON  l.install_month = s.install_month
      AND l.channel       = s.channel
      AND l.country       = s.country
    ORDER BY
      s.install_month, s.channel, s.country
  `);
  const pa_tbl = await conn.run("SELECT COUNT(*) FROM payback_analysis");
  console.log(`  ✓ payback_analysis: ${(await pa_tbl.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 9. arpdau_trend ──────────────────────────────────────────────────────────
  // iOS/Android ARPDAU split (Scenario 5)
  // Uses dt DATE column (not ts TIMESTAMP), settled_revenue for fraud-adjusted view

  console.log("\n9. Creating arpdau_trend...");
  await conn.run(`
    CREATE OR REPLACE TABLE arpdau_trend AS
    SELECT
      DATE_TRUNC('month', a.dt)::DATE       AS month,
      a.platform,
      a.country,
      COUNT(DISTINCT a.user_id)             AS active_users,
      SUM(a.settled_revenue)                AS total_settled_revenue,
      SUM(a.reported_revenue)               AS total_reported_revenue,
      ROUND(
        SUM(a.settled_revenue) / NULLIF(COUNT(DISTINCT a.user_id), 0),
        6
      )                                     AS arpdau
    FROM ad_impression_events a
    GROUP BY
      DATE_TRUNC('month', a.dt)::DATE, a.platform, a.country
    ORDER BY
      month, a.country, a.platform
  `);
  const arp = await conn.run("SELECT COUNT(*) FROM arpdau_trend");
  console.log(`  ✓ arpdau_trend: ${(await arp.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 10. cohort_retention_actuals ─────────────────────────────────────────────
  // Actual retention from sessions — validates stale model (Scenario 4)
  // Uses install_dt (not install_date), days_from_install in sessions

  console.log("\n10. Creating cohort_retention_actuals...");
  await conn.run(`
    CREATE OR REPLACE TABLE cohort_retention_actuals AS
    SELECT
      i.install_month                       AS install_month,
      i.channel                             AS channel,
      i.country                             AS country,
      i.platform                            AS platform,
      COUNT(DISTINCT i.user_id)             AS cohort_size,
      COUNT(DISTINCT CASE
        WHEN s.days_from_install BETWEEN 6 AND 8 THEN i.user_id END)  AS d7_active,
      COUNT(DISTINCT CASE
        WHEN s.days_from_install BETWEEN 13 AND 15 THEN i.user_id END) AS d14_active,
      COUNT(DISTINCT CASE
        WHEN s.days_from_install BETWEEN 28 AND 30 THEN i.user_id END) AS d30_active,
      ROUND(
        COUNT(DISTINCT CASE WHEN s.days_from_install BETWEEN 6  AND 8  THEN i.user_id END) * 1.0
        / NULLIF(COUNT(DISTINCT i.user_id), 0), 4
      ) AS d7_retention,
      ROUND(
        COUNT(DISTINCT CASE WHEN s.days_from_install BETWEEN 13 AND 15 THEN i.user_id END) * 1.0
        / NULLIF(COUNT(DISTINCT i.user_id), 0), 4
      ) AS d14_retention,
      ROUND(
        COUNT(DISTINCT CASE WHEN s.days_from_install BETWEEN 28 AND 30 THEN i.user_id END) * 1.0
        / NULLIF(COUNT(DISTINCT i.user_id), 0), 4
      ) AS d30_retention
    FROM installs i
    LEFT JOIN sessions s ON s.user_id = i.user_id
    GROUP BY
      i.install_month, i.channel, i.country, i.platform
    ORDER BY
      i.install_month, i.channel, i.country
  `);
  const cra = await conn.run("SELECT COUNT(*) FROM cohort_retention_actuals");
  console.log(`  ✓ cohort_retention_actuals: ${(await cra.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 11. engagement_analysis ──────────────────────────────────────────────────
  // Engagement tier × channel LTV breakdown — new targeting A/B (Scenario 3)
  // Uses install_dt (not install_date), is_new_targeting dimension

  console.log("\n11. Creating engagement_analysis...");
  await conn.run(`
    CREATE OR REPLACE TABLE engagement_analysis AS
    SELECT
      strftime('%Y-%m', l.cohort_date)     AS install_month,
      i.channel,
      i.engagement_tier,
      i.is_new_targeting,
      COUNT(DISTINCT i.user_id)            AS installs,
      AVG(c.cpi)                           AS avg_cpi,
      AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_retention END) AS d7_retention,
      AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_retention END) AS d30_retention,
      AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_retention END) AS d60_retention,
      AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_projected_ltv END) AS d7_ltv,
      AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_ltv,
      AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) AS d60_ltv,
      AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_ltv,
      ROUND(
        AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END)
        / NULLIF(AVG(c.cpi), 0), 3
      ) AS roas_d60
    FROM installs i
    LEFT JOIN ltv_by_cohort l
      ON  l.cohort_date = i.install_dt
      AND l.channel     = i.channel
      AND l.country     = i.country
      AND l.platform    = i.platform
    LEFT JOIN cac_by_channel c
      ON  c.cohort_date = i.install_dt
      AND c.channel     = i.channel
      AND c.country     = i.country
    GROUP BY
      strftime('%Y-%m', l.cohort_date), i.channel, i.engagement_tier, i.is_new_targeting
    ORDER BY
      install_month, i.channel, i.engagement_tier
  `);
  const ea = await conn.run("SELECT COUNT(*) FROM engagement_analysis");
  console.log(`  ✓ engagement_analysis: ${(await ea.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 12. race_performance_by_level_type ───────────────────────────────────────
  // Racing engagement analytics — NEW table for Alpha
  // Bug fix (Gap 2): named GROUP BY with table aliases (not positional GROUP BY 1,2,3,4,12)
  // Bug fix (Gap 4): LEFT JOIN routes through installs → ltv_by_cohort (not user_id FROM ltv_by_cohort)

  console.log("\n12. Creating race_performance_by_level_type...");
  await conn.run(`
    CREATE OR REPLACE TABLE race_performance_by_level_type AS
    SELECT
      DATE_TRUNC('month', r.dt)::DATE                     AS month,
      r.level_type,
      r.platform,
      r.country,
      i_ltv.channel,
      COUNT(*)                                             AS total_races,
      COUNT(DISTINCT r.user_id)                           AS unique_players,
      ROUND(
        AVG(CASE WHEN r.result = 'Win' THEN 1.0 ELSE 0.0 END)
          FILTER (WHERE r.result IS NOT NULL), 4
      )                                                    AS win_rate,
      ROUND(AVG(r.level_duration), 2)                     AS avg_duration_secs,
      ROUND(AVG(r.score) FILTER (WHERE r.score IS NOT NULL), 2)         AS avg_score,
      ROUND(AVG(r.overtakes) FILTER (WHERE r.overtakes IS NOT NULL), 2) AS avg_overtakes,
      ROUND(AVG(r.crash_number) FILTER (WHERE r.crash_number IS NOT NULL), 2) AS avg_crashes,
      ROUND(AVG(r.is_level_completed::FLOAT), 4)         AS completion_rate,
      ROUND(AVG(i_ltv.d30_ltv), 4)                       AS avg_player_d30_ltv
    FROM races r
    LEFT JOIN (
      -- Gap 4 fix: ltv_by_cohort has no user_id column (cohort-level aggregate).
      -- Route through installs to get per-user d30_ltv.
      SELECT
        inst.user_id,
        inst.channel,
        MAX(CASE WHEN ltv.days_from_cohort = 30 THEN ltv.avg_projected_ltv END) AS d30_ltv
      FROM installs inst
      LEFT JOIN ltv_by_cohort ltv
        ON  ltv.cohort_date = inst.install_dt
        AND ltv.channel     = inst.channel
        AND ltv.country     = inst.country
        AND ltv.platform    = inst.platform
      GROUP BY inst.user_id, inst.channel
    ) i_ltv ON r.user_id = i_ltv.user_id
    GROUP BY
      DATE_TRUNC('month', r.dt)::DATE,
      r.level_type,
      r.platform,
      r.country,
      i_ltv.channel
    ORDER BY
      month, r.level_type, r.platform, r.country
  `);
  const rp = await conn.run("SELECT COUNT(*) FROM race_performance_by_level_type");
  console.log(`  ✓ race_performance_by_level_type: ${(await rp.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 13. ltv_projection_vs_actuals ────────────────────────────────────────────
  // January 2026 cohorts: frozen model projected vs actual LTV (Scenario 4/7)
  // Requires d30_projected_ltv + d90_projected_ltv on ltv_by_cohort (from gen_revenue)

  console.log("\n13. Creating ltv_projection_vs_actuals...");
  await conn.run(`
    CREATE OR REPLACE TABLE ltv_projection_vs_actuals AS
    SELECT
      DATE_TRUNC('week', l.cohort_date)::DATE          AS install_week,
      l.channel,
      l.country,
      l.platform,
      COUNT(DISTINCT l.cohort_date)                    AS cohort_days,
      SUM(l.cohort_installs)                           AS cohort_size,
      AVG(l.d30_projected_ltv)                         AS d30_projected_ltv,
      AVG(l.d90_projected_ltv)                         AS d90_projected_ltv,
      AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_actual_ltv,
      AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_actual_ltv,
      ROUND(
        AVG(l.d30_projected_ltv) /
        NULLIF(AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END), 0) - 1.0, 3
      )                                                AS d30_projection_error_pct,
      ROUND(
        AVG(l.d90_projected_ltv) /
        NULLIF(AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END), 0) - 1.0, 3
      )                                                AS d90_projection_error_pct
    FROM ltv_by_cohort l
    WHERE l.cohort_date BETWEEN '2026-01-01'::DATE AND '2026-01-31'::DATE
      AND l.days_from_cohort IN (30, 90)
    GROUP BY
      DATE_TRUNC('week', l.cohort_date)::DATE,
      l.channel, l.country, l.platform
    ORDER BY
      install_week, l.channel, l.country, l.platform
  `);
  const pva = await conn.run("SELECT COUNT(*) FROM ltv_projection_vs_actuals");
  console.log(`  ✓ ltv_projection_vs_actuals: ${(await pva.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── CHECKPOINT ───────────────────────────────────────────────────────────────
  // Flush WAL to prevent replay issues on next startup (WAL safety rule)
  console.log("\nCheckpointing...");
  await conn.run("CHECKPOINT");
  console.log("✓ CHECKPOINT complete");

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("Setup complete!");
  console.log("Database:", DB_PATH);

  // ── Scenario verification ─────────────────────────────────────────────────────

  const scenarioChecks = [
    {
      label: "S1. CPI↔LTV correlation: higher CPI → higher D90 LTV",
      sql: `
        SELECT r.channel,
          ROUND(AVG(r.avg_cpi), 2)    AS avg_cpi,
          ROUND(AVG(r.d90_ltv), 4)    AS d90_ltv
        FROM roas_by_cohort r
        GROUP BY r.channel
        ORDER BY avg_cpi ASC
      `,
      note: "PASS if apple_search_ads D90 LTV > facebook_ads > google_uac",
    },
    {
      label: "S2. Fraud/settlement gap by channel",
      sql: `
        SELECT m.channel,
          ROUND(SUM(m.reported_revenue), 2)                               AS reported,
          ROUND(SUM(m.settled_revenue), 2)                                AS settled,
          ROUND(SUM(m.settled_revenue) / NULLIF(SUM(m.reported_revenue), 0), 4) AS settlement_ratio
        FROM monthly_revenue_summary m
        GROUP BY m.channel
        ORDER BY settlement_ratio ASC
      `,
      note: "PASS if apple_search_ads ~0.995, google_uac ~0.960, facebook_ads ~0.895",
    },
    {
      label: "S3. New targeting A/B: Facebook is_new_targeting D30 retention",
      sql: `
        SELECT e.is_new_targeting,
          ROUND(AVG(e.d30_retention), 4) AS d30_ret,
          COUNT(*)                       AS cohorts
        FROM engagement_analysis e
        WHERE e.channel = 'facebook_ads'
        GROUP BY e.is_new_targeting
      `,
      note: "PASS if is_new_targeting=1 D30 > is_new_targeting=0 D30 by ≥15%",
    },
    {
      label: "S4. Retention decay (Jan organic D30 vs Jun)",
      sql: `
        SELECT s.install_month,
          ROUND(AVG(s.d30_retention), 4) AS d30_retention
        FROM segment_trends s
        WHERE s.channel = 'organic'
        GROUP BY s.install_month
        ORDER BY s.install_month
      `,
      note: "PASS if 2026-01 ~0.180 and 2026-06 ~0.114 (37% decline)",
    },
    {
      label: "S5. iOS/Android ARPDAU ratio",
      sql: `
        SELECT a.platform,
          ROUND(AVG(a.arpdau), 4) AS avg_arpdau
        FROM arpdau_trend a
        GROUP BY a.platform
      `,
      note: "PASS if IOS/ANDROID ratio ~1.5–1.8×",
    },
    {
      label: "S6. Geo expansion risk: D14/D90 LTV ratio",
      sql: `
        SELECT l.country,
          ROUND(AVG(CASE WHEN l.days_from_cohort = 14 THEN l.avg_projected_ltv END), 4) AS d14_ltv,
          ROUND(AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END), 4) AS d90_ltv,
          ROUND(
            AVG(CASE WHEN l.days_from_cohort = 14 THEN l.avg_projected_ltv END) /
            NULLIF(AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END), 0), 3
          ) AS ratio
        FROM ltv_by_cohort l
        WHERE l.cohort_date <= '2026-03-31'::DATE
        GROUP BY l.country
        ORDER BY ratio DESC
        LIMIT 8
      `,
      note: "PASS if Brazil/Mexico ratio ~0.62–0.74; United States/United Kingdom ~0.40–0.48",
    },
    {
      label: "S7. LTV projection accuracy (January cohorts)",
      sql: `
        SELECT p.channel,
          ROUND(AVG(p.d30_projected_ltv), 4)      AS projected,
          ROUND(AVG(p.d30_actual_ltv), 4)         AS actual,
          ROUND(AVG(p.d30_projection_error_pct), 3) AS error_pct
        FROM ltv_projection_vs_actuals p
        GROUP BY p.channel
        ORDER BY p.channel
      `,
      note: "Jan organic: model under-predicts (~-0.25 to -0.30 error). Jun: over-predicts.",
    },
    {
      label: "S8. Race win rates by level type",
      sql: `
        SELECT rp.level_type,
          ROUND(AVG(rp.win_rate), 4)  AS avg_win_rate,
          SUM(rp.total_races)         AS total_races
        FROM race_performance_by_level_type rp
        GROUP BY rp.level_type
        ORDER BY avg_win_rate DESC
      `,
      note: "PASS if ClassicRace win_rate > 0.40, Survival ~0.55, FreeDrive/Multiplayer NULL",
    },
  ];

  for (const check of scenarioChecks) {
    console.log(`\n  ${check.label}:`);
    console.log(`  Note: ${check.note}`);
    try {
      const result = await conn.run(check.sql);
      const rows = await result.getRows();
      const cols = result.columnNames();
      console.log("  " + cols.join(" | "));
      for (const row of rows.slice(0, 6)) {
        console.log("  " + row.join(" | "));
      }
    } catch (e) {
      console.warn(`  (skipped — ${(e as Error).message})`);
    }
  }

  console.log("\nDone! Use dataset ID \"alpha\" in the app.");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
