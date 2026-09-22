/**
 * setup-gameramp.ts — Build the GamerRamp DuckDB database
 *
 * Reads parquet files from data/parquet/gameramp/, creates views, and
 * pre-materialises 5 summary tables for fast query execution.
 *
 * Run AFTER generate-gameramp.py:
 *   python3 scripts/generate-gameramp.py [--scale 0.1]
 *   npx tsx scripts/setup-gameramp.ts
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync, readdirSync } from "fs";
import { resolve } from "path";

const DB_PATH      = resolve(__dirname, "../data/gameramp.duckdb");
const PARQUET_DIR  = resolve(__dirname, "../data/parquet/gamerampv2");

async function main() {
  console.log("Creating GamerRamp DuckDB database at:", DB_PATH);

  if (!existsSync(PARQUET_DIR)) {
    console.error(
      `\nParquet directory not found: ${PARQUET_DIR}\n` +
      "Run the generator first:\n" +
      "  python3 scripts/generate-gameramp.py --scale 0.1",
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

  const tables = ["installs", "sessions", "ad_impression_events", "revenue", "campaign"];
  for (const t of tables) {
    const path = `${PARQUET_DIR}/${t}.parquet`;
    if (!existsSync(path)) {
      console.warn(`  ⚠ Skipping ${t} (file not found)`);
      continue;
    }
    await conn.run(
      `CREATE OR REPLACE VIEW ${t} AS SELECT * FROM read_parquet('${path}')`,
    );
    const cnt = await conn.run(`SELECT COUNT(*) FROM ${t}`);
    const rows = await cnt.getRows();
    console.log(`  ✓ ${t}: ${rows?.[0]?.[0]?.toLocaleString() ?? "?"} rows`);
  }

  // ── 2. ltv_by_cohort ─────────────────────────────────────────────────────────
  // Marketing's view: D30/D60/D90 LTV curves by channel (scenario 1, 3, 6)

  console.log("\n2. Creating ltv_by_cohort...");
  await conn.run(`
    CREATE OR REPLACE TABLE ltv_by_cohort AS
    SELECT
      cohort_date,
      install_week,
      install_month,
      channel,
      country,
      platform,
      days_from_cohort,
      period,
      SUM(cohort_installs)           AS cohort_installs,
      AVG(retention_rate)            AS avg_retention,
      AVG(arpu)                      AS avg_arpu,
      AVG(total_arpu)                AS avg_projected_ltv,
      AVG(arpdau)                    AS avg_arpdau,
      AVG(roi)                       AS avg_roi,
      AVG(total_roi)                 AS avg_total_roi,
      AVG(projected_d180_ltv)        AS avg_projected_d180_ltv,
      BOOL_AND(is_observed)          AS is_observed
    FROM revenue
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
    ORDER BY cohort_date, channel, country, days_from_cohort
  `);
  const ltv = await conn.run("SELECT COUNT(*) FROM ltv_by_cohort");
  console.log(`  ✓ ltv_by_cohort: ${(await ltv.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 3. monthly_revenue_summary ───────────────────────────────────────────────
  // Finance's view: closed cash by calendar month (scenario 2, 3, 5)

  console.log("\n3. Creating monthly_revenue_summary...");
  await conn.run(`
    CREATE OR REPLACE TABLE monthly_revenue_summary AS
    SELECT
      DATE_TRUNC('month', ts)        AS month,
      channel,
      country,
      platform,
      ad_format,
      COUNT(*)                       AS impressions,
      SUM(revenue)                   AS reported_revenue,
      SUM(settled_revenue)           AS settled_revenue,
      SUM(net_revenue)               AS net_revenue,
      AVG(fraud_rate)                AS avg_fraud_rate,
      SUM(revenue) - SUM(settled_revenue)  AS fraud_loss
    FROM ad_impression_events
    GROUP BY 1, 2, 3, 4, 5
    ORDER BY month, channel, country
  `);
  const mrs = await conn.run("SELECT COUNT(*) FROM monthly_revenue_summary");
  console.log(`  ✓ monthly_revenue_summary: ${(await mrs.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 4. cac_by_channel ────────────────────────────────────────────────────────
  // Spend efficiency: CPI by channel × country (scenario 1, 3)

  console.log("\n4. Creating cac_by_channel...");
  await conn.run(`
    CREATE OR REPLACE TABLE cac_by_channel AS
    SELECT
      DATE_TRUNC('month', cohort_date) AS month,
      cohort_date,
      channel,
      country,
      os,
      SUM(cost)                        AS total_spend,
      SUM(installs)                    AS installs,
      ROUND(SUM(cost) / NULLIF(SUM(installs), 0), 2) AS cpi,
      AVG(arpdau)                      AS avg_arpdau,
      AVG(roi)                         AS avg_roi_d90
    FROM campaign
    GROUP BY 1, 2, 3, 4, 5
    ORDER BY cohort_date, channel, country
  `);
  const cac = await conn.run("SELECT COUNT(*) FROM cac_by_channel");
  console.log(`  ✓ cac_by_channel: ${(await cac.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 5. cac_by_month ─────────────────────────────────────────────────────────
  // Monthly CPI aggregation — smooth trend view vs daily cac_by_channel (scenario 1, 3)

  console.log("\n5. Creating cac_by_month...");
  await conn.run(`
    CREATE OR REPLACE TABLE cac_by_month AS
    SELECT
      strftime('%Y-%m', cohort_date)           AS install_month,
      channel, country, os,
      SUM(total_spend)                         AS total_spend,
      SUM(installs)                            AS installs,
      ROUND(SUM(total_spend) / NULLIF(SUM(installs), 0), 2) AS avg_cpi
    FROM cac_by_channel
    GROUP BY strftime('%Y-%m', cohort_date), channel, country, os
    ORDER BY install_month, channel
  `);
  const cacMonth = await conn.run("SELECT COUNT(*) FROM cac_by_month");
  console.log(`  ✓ cac_by_month: ${(await cacMonth.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 6. arpdau_trend ──────────────────────────────────────────────────────────
  // ARPDAU flat while total revenue grows — pure volume dilution (scenario 5)

  console.log("\n6. Creating arpdau_trend...");
  await conn.run(`
    CREATE OR REPLACE TABLE arpdau_trend AS
    SELECT
      DATE_TRUNC('month', ts)           AS month,
      platform,
      country,
      COUNT(DISTINCT user_id)           AS active_users,
      SUM(settled_revenue)              AS total_settled_revenue,
      SUM(revenue)                      AS total_reported_revenue,
      ROUND(
        SUM(settled_revenue) / NULLIF(COUNT(DISTINCT user_id), 0),
        6
      )                                 AS arpdau
    FROM ad_impression_events
    GROUP BY 1, 2, 3
    ORDER BY month, country, platform
  `);
  const arp = await conn.run("SELECT COUNT(*) FROM arpdau_trend");
  console.log(`  ✓ arpdau_trend: ${(await arp.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 6. cohort_retention_actuals ──────────────────────────────────────────────
  // Actual retention from sessions (for stale model detection — scenario 4)

  console.log("\n7. Creating cohort_retention_actuals...");
  await conn.run(`
    CREATE OR REPLACE TABLE cohort_retention_actuals AS
    SELECT
      i.install_month AS install_month,
      i.channel       AS channel,
      i.country       AS country,
      i.platform      AS platform,
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
    GROUP BY 1, 2, 3, 4
    ORDER BY install_month, channel, country
  `);
  const cra = await conn.run("SELECT COUNT(*) FROM cohort_retention_actuals");
  console.log(`  ✓ cohort_retention_actuals: ${(await cra.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 8. segment_trends ────────────────────────────────────────────────────────
  // Pre-pivoted KPIs by install_month × channel × country × platform

  console.log("\n8. Creating segment_trends...");
  await conn.run(`
    CREATE OR REPLACE TABLE segment_trends AS
    SELECT
      strftime('%Y-%m', cohort_date)   AS install_month,
      channel, country, platform,
      SUM(cohort_installs)             AS installs,
      AVG(CASE WHEN days_from_cohort =  7 THEN avg_retention END) AS d7_retention,
      AVG(CASE WHEN days_from_cohort = 30 THEN avg_retention END) AS d30_retention,
      AVG(CASE WHEN days_from_cohort = 60 THEN avg_retention END) AS d60_retention,
      AVG(CASE WHEN days_from_cohort =  7 THEN avg_projected_ltv END) AS d7_ltv,
      AVG(CASE WHEN days_from_cohort = 30 THEN avg_projected_ltv END) AS d30_ltv,
      AVG(CASE WHEN days_from_cohort = 60 THEN avg_projected_ltv END) AS d60_ltv,
      AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END) AS d90_ltv,
      AVG(avg_arpdau)                  AS avg_arpdau
    FROM ltv_by_cohort
    GROUP BY 1, 2, 3, 4
    ORDER BY install_month, channel, country, platform
  `);
  const st = await conn.run("SELECT COUNT(*) FROM segment_trends");
  console.log(`  ✓ segment_trends: ${(await st.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 9. roas_by_cohort ────────────────────────────────────────────────────────
  // RoAS elasticity: LTV / CPI by cohort

  console.log("\n9. Creating roas_by_cohort...");
  await conn.run(`
    CREATE OR REPLACE TABLE roas_by_cohort AS
    SELECT
      strftime('%Y-%m', l.cohort_date) AS install_month,
      l.channel, l.country, l.platform,
      SUM(l.cohort_installs)           AS installs,
      AVG(c.cpi)                       AS avg_cpi,
      AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_projected_ltv END) AS d7_ltv,
      AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_ltv,
      AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) AS d60_ltv,
      AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_ltv,
      ROUND(AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END)
        / NULLIF(AVG(c.cpi), 0), 3) AS roas_d30,
      ROUND(AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END)
        / NULLIF(AVG(c.cpi), 0), 3) AS roas_d60,
      ROUND(AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END)
        / NULLIF(AVG(c.cpi), 0), 3) AS roas_d90
    FROM ltv_by_cohort l
    LEFT JOIN cac_by_channel c
      ON  c.cohort_date = l.cohort_date
      AND c.channel     = l.channel
      AND c.country     = l.country
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3
  `);
  const roas = await conn.run("SELECT COUNT(*) FROM roas_by_cohort");
  console.log(`  ✓ roas_by_cohort: ${(await roas.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 10. payback_analysis ─────────────────────────────────────────────────────
  // Cash-cycle finance view: payback_ratio at D7/D30/D60/D90

  console.log("\n10. Creating payback_analysis...");
  await conn.run(`
    CREATE OR REPLACE TABLE payback_analysis AS
    WITH cohort_spend AS (
      SELECT
        strftime('%Y-%m', cohort_date) AS install_month,
        channel, country,
        SUM(total_spend) AS ua_spend,
        SUM(installs)    AS installs
      FROM cac_by_channel
      GROUP BY 1, 2, 3
    ),
    cohort_ltv AS (
      SELECT
        strftime('%Y-%m', cohort_date) AS install_month,
        channel, country,
        AVG(CASE WHEN days_from_cohort =  7 THEN avg_projected_ltv END) AS d7_ltv,
        AVG(CASE WHEN days_from_cohort = 30 THEN avg_projected_ltv END) AS d30_ltv,
        AVG(CASE WHEN days_from_cohort = 60 THEN avg_projected_ltv END) AS d60_ltv,
        AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END) AS d90_ltv
      FROM ltv_by_cohort
      GROUP BY 1, 2, 3
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
    ORDER BY s.install_month, s.channel, s.country
  `);
  const pa = await conn.run("SELECT COUNT(*) FROM payback_analysis");
  console.log(`  ✓ payback_analysis: ${(await pa.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 11. engagement_analysis ──────────────────────────────────────────────────
  // Engagement tier × channel LTV breakdown (targeting justification)

  console.log("\n11. Creating engagement_analysis...");
  await conn.run(`
    CREATE OR REPLACE TABLE engagement_analysis AS
    SELECT
      strftime('%Y-%m', l.cohort_date) AS install_month,
      i.channel,
      i.engagement_tier,
      i.is_new_targeting,
      COUNT(DISTINCT i.user_id)        AS installs,
      AVG(c.cpi)                       AS avg_cpi,
      AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_retention END) AS d7_retention,
      AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_retention END) AS d30_retention,
      AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_retention END) AS d60_retention,
      AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_projected_ltv END) AS d7_ltv,
      AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_ltv,
      AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) AS d60_ltv,
      AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_ltv,
      ROUND(
        AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END)
        / NULLIF(AVG(c.cpi), 0), 3) AS roas_d60
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
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3
  `);
  const ea = await conn.run("SELECT COUNT(*) FROM engagement_analysis");
  console.log(`  ✓ engagement_analysis: ${(await ea.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── 12. ltv_model_accuracy ───────────────────────────────────────────────────
  // Engineered model accuracy story: actual D30 LTV vs pre-launch model prediction
  // Aug-Oct: pre-launch model miscalibrated (82-118% variance)
  // Nov-Jan: model recalibrated in Nov 2025 with live data (97-102% accuracy)

  console.log("\n12. Creating ltv_model_accuracy...");
  await conn.run(`
    CREATE OR REPLACE TABLE ltv_model_accuracy AS
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
      SELECT
        install_month,
        AVG(avg_projected_ltv) AS actual_d30_ltv
      FROM ltv_by_cohort
      WHERE days_from_cohort = 30
      GROUP BY install_month
    )
    SELECT
      a.install_month,
      ROUND(a.actual_d30_ltv, 6)                              AS actual_d30_ltv,
      ROUND(a.actual_d30_ltv / t.target_ratio, 6)             AS model_d30_ltv,
      t.target_ratio                                           AS accuracy_ratio
    FROM actuals a
    JOIN target_ratios t ON t.install_month = a.install_month
    ORDER BY a.install_month
  `);
  const lma = await conn.run("SELECT COUNT(*) FROM ltv_model_accuracy");
  console.log(`  ✓ ltv_model_accuracy: ${(await lma.getRows())?.[0]?.[0]?.toLocaleString()} rows`);

  // ── CHECKPOINT ───────────────────────────────────────────────────────────────
  // Flush WAL to prevent replay issues on next startup
  console.log("\n12. Checkpointing...");
  await conn.run("CHECKPOINT");

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("Setup complete!");
  console.log("Database:", DB_PATH);

  // Quick scenario verification
  const scenarioChecks = [
    {
      label: "Scenario 1 — CPI↔LTV: Facebook D60 LTV vs Vungle",
      sql: `
        SELECT channel,
          ROUND(AVG(cpi), 2) AS avg_cpi,
          ROUND(AVG(avg_projected_ltv), 4) AS avg_d60_ltv
        FROM cac_by_channel c
        LEFT JOIN (
          SELECT channel, AVG(avg_projected_ltv) AS avg_projected_ltv
          FROM ltv_by_cohort
          WHERE days_from_cohort = 60
          GROUP BY channel
        ) ltv USING (channel)
        WHERE channel IN ('facebook', 'vungle')
        GROUP BY channel
        ORDER BY avg_cpi DESC
      `,
    },
    {
      label: "Scenario 4 — D30 retention decay",
      sql: `
        SELECT install_month, ROUND(AVG(d30_retention), 4) AS d30_retention
        FROM cohort_retention_actuals
        GROUP BY install_month
        ORDER BY install_month
        LIMIT 5
      `,
    },
    {
      label: "Scenario 2 — Fraud gap by channel",
      sql: `
        SELECT channel,
          ROUND(AVG(avg_fraud_rate) * 100, 1) AS fraud_pct,
          ROUND(SUM(reported_revenue), 0) AS reported,
          ROUND(SUM(settled_revenue), 0) AS settled
        FROM monthly_revenue_summary
        GROUP BY channel
        ORDER BY fraud_pct DESC
      `,
    },
    {
      label: "Scenario 3 — Cohort vs calendar: UA spend vs settled revenue gap",
      sql: `
        SELECT
          strftime('%Y-%m', c.cohort_date) AS month,
          ROUND(SUM(c.cost), 0)            AS ua_spend,
          COALESCE(ROUND(SUM(m.settled_revenue), 0), 0) AS settled_rev,
          ROUND(SUM(c.cost) / NULLIF(COALESCE(SUM(m.settled_revenue), 0), 0), 2) AS spend_to_rev_ratio
        FROM cac_by_channel c
        LEFT JOIN (
          SELECT strftime('%Y-%m', month) AS mo, SUM(settled_revenue) AS settled_revenue
          FROM monthly_revenue_summary GROUP BY 1
        ) m ON strftime('%Y-%m', c.cohort_date) = m.mo
        GROUP BY 1 ORDER BY 1
      `,
    },
    {
      label: "Scenario 5 — ARPDAU dilution: revenue grows, ARPDAU flat",
      sql: `
        SELECT
          strftime('%Y-%m', month) AS mo,
          ROUND(SUM(total_revenue), 2)  AS total_rev,
          SUM(active_users)             AS active_users,
          ROUND(SUM(total_revenue) / NULLIF(SUM(active_users), 0), 4) AS arpdau
        FROM (
          SELECT month,
            SUM(total_reported_revenue) AS total_revenue,
            SUM(active_users)           AS active_users
          FROM arpdau_trend
          GROUP BY month
        )
        GROUP BY 1 ORDER BY 1
      `,
    },
    {
      label: "Scenario 6 — Geo expansion risk: IN/BR/ID/MX D14/D90 LTV ratio",
      sql: `
        SELECT
          country,
          ROUND(AVG(CASE WHEN days_from_cohort = 14 THEN avg_projected_ltv END), 4) AS d14_ltv,
          ROUND(AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END), 4) AS d90_ltv,
          ROUND(
            AVG(CASE WHEN days_from_cohort = 14 THEN avg_projected_ltv END)
            / NULLIF(AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END), 0),
          3) AS d14_d90_ratio
        FROM ltv_by_cohort
        WHERE cohort_date <= DATE '2025-11-30'
        GROUP BY country ORDER BY country
      `,
    },
  ];

  for (const check of scenarioChecks) {
    console.log(`\n  ${check.label}:`);
    try {
      const result = await conn.run(check.sql);
      const rows = await result.getRows();
      const cols = result.columnNames();
      console.log("  ", cols.join(" | "));
      for (const row of rows.slice(0, 5)) {
        console.log("  ", row.join(" | "));
      }
    } catch (e) {
      console.warn("  (skipped — insufficient data at this scale)");
    }
  }

  console.log("\nDone! Use dataset ID \"gameramp\" in the app.");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
