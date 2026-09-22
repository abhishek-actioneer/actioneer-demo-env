/**
 * Sets up the FundsIndia DuckDB database from generated CSVs.
 *
 * Creates:
 *   - 10 raw views from CSV files
 *   - Expanded denormalized views for events, funnels, and user investment history
 *   - 9 summary / materialized tables for fast querying
 *
 * Prerequisites: Run generate-fundsindia.ts first to produce CSVs in data/csv/fundsindia/
 *
 * Usage: npx tsx scripts/setup-fundsindia.ts
 */

import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { getFundsIndiaViewSQL } from "../src/lib/datasets/fundsindia-events";

const CSV_DIR = resolve(__dirname, "../data/csv/fundsindia");
const DB_PATH = resolve(__dirname, "../data/fundsindia.duckdb");

const REQUIRED = [
  "funds.csv","investors.csv","sips.csv","transactions.csv",
  "systematic_plans.csv","goals.csv","comms_log.csv",
  "advisory_sessions.csv","support_tickets.csv","user_events.csv",
];

for (const f of REQUIRED) {
  if (!existsSync(resolve(CSV_DIR, f))) {
    console.error(`❌ Missing ${f}. Run generate-fundsindia.ts first.`);
    process.exit(1);
  }
}

async function main() {
  if (existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log("Removed old database");
  }

  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();

  const run = async (sql: string, label?: string) => {
    try {
      await conn.run(sql);
      if (label) console.log(`  ✓ ${label}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`SQL Error on ${label ?? "?"}: ${msg}`);
      console.error(sql.slice(0, 300));
      throw e;
    }
  };

  const query = async (sql: string): Promise<unknown> => {
    const r = await conn.runAndReadAll(sql);
    return r.getRows()[0]?.[0] ?? 0;
  };

  await run("SET memory_limit = '4GB'");
  await run("SET threads = 4");

  console.log("\n💰 Setting up FundsIndia database...\n");

  // ═══════════════════════════════════════════
  // STEP 1: RAW TABLES (all materialized, not views)
  // Materialize everything so the .duckdb file is self-contained.
  // No CSV files needed at runtime — Railway can delete them after setup.
  // ═══════════════════════════════════════════
  console.log("Step 1: Importing raw tables from CSV...");

  for (const [name, file] of [
    ["raw_funds",            "funds.csv"],
    ["raw_investors",        "investors.csv"],
    ["raw_sips",             "sips.csv"],
    ["raw_transactions",     "transactions.csv"],
    ["raw_systematic_plans", "systematic_plans.csv"],
    ["raw_goals",            "goals.csv"],
    ["raw_comms_log",        "comms_log.csv"],
    ["raw_advisory",         "advisory_sessions.csv"],
    ["raw_support",          "support_tickets.csv"],
  ]) {
    await run(`CREATE OR REPLACE TABLE ${name} AS SELECT * FROM read_csv('${CSV_DIR}/${file}', auto_detect=true, ignore_errors=true)`, name);
  }

  // user_events is large — already materializes as TABLE
  console.log("  Materializing user_events (1.1M rows — takes ~30s)...");
  await run(`
    CREATE OR REPLACE TABLE raw_user_events AS
    SELECT * FROM read_csv('${CSV_DIR}/user_events.csv', auto_detect=true, ignore_errors=true)
  `, "raw_user_events");

  // ═══════════════════════════════════════════
  // STEP 2: DENORMALIZED VIEWS
  // ═══════════════════════════════════════════
  console.log("\nStep 2: Denormalized views...");

  await run(`
    CREATE OR REPLACE VIEW transactions_full AS
    SELECT
      t.txn_id, t.investor_id, t.fund_id, t.sip_id, t.goal_id,
      t.txn_date, t.txn_type, t.amount_inr, t.units, t.nav_at_txn,
      t.status, t.channel, t.payment_mode,
      f.fund_name, f.amc_name,
      f.category  AS fund_category,
      f.subcategory AS fund_subcategory,
      f.risk_level, f.trailing_commission_pct,
      f.return_1y, f.return_3y, f.return_5y,
      f.is_fi_select, f.fi_star_rating,
      i.city_tier, i.risk_profile, i.occupation,
      i.acquisition_channel, i.annual_income,
      i.state, i.city, i.gender, i.age,
      i.signup_date, i.account_activated_date
    FROM raw_transactions t
    LEFT JOIN raw_funds       f ON t.fund_id      = f.fund_id
    LEFT JOIN raw_investors   i ON t.investor_id  = i.investor_id
  `, "transactions_full");

  await run(`
    CREATE OR REPLACE VIEW sips_full AS
    SELECT
      s.sip_id, s.investor_id, s.fund_id,
      s.start_date, s.end_date, s.frequency,
      s.amount_inr, s.step_up_pct, s.step_up_frequency,
      s.sip_type, s.status, s.mandate_type,
      s.cancellation_reason,
      s.total_installments_paid, s.total_amount_invested,
      CASE
        WHEN s.amount_inr < 2000  THEN '<2K'
        WHEN s.amount_inr < 5000  THEN '2-5K'
        WHEN s.amount_inr < 15000 THEN '5-15K'
        ELSE '>15K'
      END AS amount_range,
      f.fund_name, f.amc_name,
      f.category  AS fund_category,
      f.subcategory AS fund_subcategory,
      f.risk_level, f.trailing_commission_pct,
      f.is_fi_select,
      i.city_tier, i.risk_profile,
      i.acquisition_channel, i.annual_income,
      i.state, i.city, i.gender, i.age,
      i.signup_date, i.account_activated_date
    FROM raw_sips s
    LEFT JOIN raw_funds       f ON s.fund_id     = f.fund_id
    LEFT JOIN raw_investors   i ON s.investor_id = i.investor_id
  `, "sips_full");

  await run(`
    CREATE OR REPLACE VIEW goals_full AS
    SELECT
      g.goal_id, g.investor_id, g.goal_type,
      g.target_amount_inr, g.target_date,
      g.monthly_sip_needed_inr, g.current_value_inr,
      g.created_date, g.status, g.created_by,
      g.flagged_at_risk_date, g.achieved_date,
      i.city_tier, i.risk_profile,
      i.annual_income, i.age, i.state
    FROM raw_goals g
    LEFT JOIN raw_investors i ON g.investor_id = i.investor_id
  `, "goals_full");

  await run(`
    CREATE OR REPLACE VIEW comms_full AS
    SELECT
      c.comm_id, c.investor_id, c.channel, c.campaign_type,
      c.sent_at, c.delivered, c.opened, c.clicked,
      c.converted, c.action_taken,
      i.city_tier, i.risk_profile,
      i.acquisition_channel, i.is_active
    FROM raw_comms_log c
    LEFT JOIN raw_investors i ON c.investor_id = i.investor_id
  `, "comms_full");

  await run(`
    CREATE OR REPLACE VIEW advisory_full AS
    SELECT
      a.session_id, a.investor_id, a.session_date,
      a.advisor_type, a.session_type, a.duration_min,
      a.recommendation_type, a.outcome,
      a.portfolio_value_at_time, a.triggered_by,
      i.city_tier, i.risk_profile, i.occupation
    FROM raw_advisory a
    LEFT JOIN raw_investors i ON a.investor_id = i.investor_id
  `, "advisory_full");

  await run(`
    CREATE OR REPLACE VIEW support_full AS
    SELECT
      s.ticket_id, s.investor_id, s.created_at, s.resolved_at,
      s.category, s.channel, s.priority, s.status,
      s.resolution_hours, s.nps_score,
      i.city_tier, i.is_active, i.kyc_status
    FROM raw_support s
    LEFT JOIN raw_investors i ON s.investor_id = i.investor_id
  `, "support_full");

  console.log("  Applying expanded FundsIndia event views...");
  for (const sql of getFundsIndiaViewSQL()) {
    const viewName = sql.match(/CREATE\s+OR\s+REPLACE\s+VIEW\s+(\w+)/i)?.[1];
    await run(sql, viewName ?? "expanded_view");
  }

  // ═══════════════════════════════════════════
  // STEP 3: SUMMARY TABLES
  // ═══════════════════════════════════════════
  console.log("\nStep 3: Summary tables...");

  await run(`
    CREATE OR REPLACE TABLE monthly_platform_kpis AS
    SELECT
      CAST(strftime(s.start_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*)                                           AS new_sips,
      COUNT(*) FILTER (WHERE s.status = 'cancelled')     AS cancelled_sips,
      SUM(s.amount_inr)                                  AS new_sip_monthly_inr,
      AVG(s.amount_inr)                                  AS avg_sip_amount
    FROM raw_sips s
    WHERE s.start_date >= '2024-06-01'
    GROUP BY 1
    ORDER BY 1
  `, "monthly_platform_kpis");

  await run(`
    CREATE OR REPLACE TABLE monthly_txn_summary AS
    SELECT
      CAST(strftime(txn_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      txn_type,
      COUNT(*)                                              AS txn_count,
      SUM(amount_inr) FILTER (WHERE status = 'success')    AS total_amount,
      COUNT(*) FILTER (WHERE status = 'failed')             AS failed_count,
      AVG(amount_inr) FILTER (WHERE status = 'success')     AS avg_amount
    FROM raw_transactions
    GROUP BY 1, 2
    ORDER BY 1, 2
  `, "monthly_txn_summary");

  await run(`
    CREATE OR REPLACE TABLE fund_platform_stats AS
    SELECT
      f.fund_id, f.fund_name, f.amc_name, f.category, f.subcategory,
      f.trailing_commission_pct, f.is_fi_select, f.fi_star_rating,
      COUNT(DISTINCT s.investor_id)                    AS investor_count,
      COUNT(DISTINCT s.sip_id) FILTER
        (WHERE s.status = 'active')                    AS active_sip_count,
      SUM(s.amount_inr) FILTER
        (WHERE s.status = 'active')                    AS monthly_sip_run_rate,
      SUM(t.amount_inr) FILTER
        (WHERE t.status = 'success' AND t.txn_type != 'redemption') AS total_invested,
      COUNT(DISTINCT t.txn_id)                         AS total_transactions
    FROM raw_funds f
    LEFT JOIN raw_sips         s ON f.fund_id = s.fund_id
    LEFT JOIN raw_transactions t ON f.fund_id = t.fund_id
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
    ORDER BY total_invested DESC NULLS LAST
  `, "fund_platform_stats");

  await run(`
    CREATE OR REPLACE TABLE amc_performance AS
    SELECT
      f.amc_name,
      COUNT(DISTINCT s.sip_id) FILTER (WHERE s.status = 'active') AS active_sips,
      SUM(s.amount_inr) FILTER (WHERE s.status = 'active')        AS monthly_sip_inr,
      SUM(t.amount_inr) FILTER
        (WHERE t.status = 'success' AND t.txn_type != 'redemption') AS total_invested,
      AVG(f.trailing_commission_pct)                               AS avg_commission_pct,
      SUM(t.amount_inr) FILTER
        (WHERE t.status = 'success' AND t.txn_type != 'redemption')
        * AVG(f.trailing_commission_pct) / 100 / 12               AS est_monthly_commission
    FROM raw_funds f
    LEFT JOIN raw_sips         s ON f.fund_id = s.fund_id
    LEFT JOIN raw_transactions t ON f.fund_id = t.fund_id
    GROUP BY 1
    ORDER BY total_invested DESC NULLS LAST
  `, "amc_performance");

  await run(`
    CREATE OR REPLACE TABLE sip_cohort_retention AS
    SELECT
      CASE
        WHEN EXTRACT(MONTH FROM start_date::DATE) BETWEEN 4 AND 6  THEN
          'FY' || CAST((EXTRACT(YEAR FROM start_date::DATE) + 1) % 100 AS VARCHAR) || '-Q1'
        WHEN EXTRACT(MONTH FROM start_date::DATE) BETWEEN 7 AND 9  THEN
          'FY' || CAST((EXTRACT(YEAR FROM start_date::DATE) + 1) % 100 AS VARCHAR) || '-Q2'
        WHEN EXTRACT(MONTH FROM start_date::DATE) BETWEEN 10 AND 12 THEN
          'FY' || CAST((EXTRACT(YEAR FROM start_date::DATE) + 1) % 100 AS VARCHAR) || '-Q3'
        ELSE 'FY' || CAST(EXTRACT(YEAR FROM start_date::DATE) % 100 AS VARCHAR) || '-Q4'
      END AS start_quarter,
      COUNT(*)                                    AS total_sips,
      COUNT(*) FILTER (WHERE status = 'active')   AS active_sips,
      AVG(amount_inr)                             AS avg_sip_amount,
      COUNT(*) FILTER
        (WHERE status = 'active' AND total_installments_paid >= 3)  AS retained_3m,
      COUNT(*) FILTER
        (WHERE status = 'active' AND total_installments_paid >= 6)  AS retained_6m,
      COUNT(*) FILTER
        (WHERE status = 'active' AND total_installments_paid >= 12) AS retained_12m,
      CAST(COUNT(*) FILTER (WHERE status = 'active') AS DOUBLE)
        / NULLIF(COUNT(*), 0) * 100              AS pct_active,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_sips,
      COUNT(*) FILTER (WHERE sip_type = 'power_sip') AS step_up_sips
    FROM raw_sips
    GROUP BY 1
    ORDER BY 1
  `, "sip_cohort_retention");

  await run(`
    CREATE OR REPLACE TABLE campaign_performance AS
    SELECT
      campaign_type,
      channel,
      CAST(strftime(sent_at::TIMESTAMP, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*)                                           AS sends,
      COUNT(*) FILTER (WHERE delivered = true)           AS delivered,
      COUNT(*) FILTER (WHERE opened = true)              AS opened,
      COUNT(*) FILTER (WHERE clicked = true)             AS clicked,
      COUNT(*) FILTER (WHERE converted = true)           AS converted,
      CAST(COUNT(*) FILTER (WHERE opened = true)    AS DOUBLE)
        / NULLIF(COUNT(*) FILTER (WHERE delivered = true), 0) * 100 AS open_rate,
      CAST(COUNT(*) FILTER (WHERE clicked = true)   AS DOUBLE)
        / NULLIF(COUNT(*) FILTER (WHERE opened = true), 0) * 100    AS click_rate,
      CAST(COUNT(*) FILTER (WHERE converted = true) AS DOUBLE)
        / NULLIF(COUNT(*) FILTER (WHERE delivered = true), 0) * 100 AS conv_rate
    FROM raw_comms_log
    GROUP BY 1, 2, 3
    ORDER BY 3, 1
  `, "campaign_performance");

  await run(`
    CREATE OR REPLACE TABLE investor_funnel AS
    SELECT
      acquisition_channel,
      city_tier,
      CAST(strftime(signup_date::DATE, '%Y-%m') || '-01' AS DATE) AS cohort_month,
      COUNT(*)                                                  AS signups,
      COUNT(*) FILTER (WHERE pan_confirmed_date IS NOT NULL)    AS pan_confirmed,
      COUNT(*) FILTER (WHERE kyc_submitted_date IS NOT NULL)    AS kyc_submitted,
      COUNT(*) FILTER (WHERE kyc_status = 'verified')           AS kyc_verified,
      COUNT(*) FILTER (WHERE bank_verified_date IS NOT NULL)    AS bank_verified,
      COUNT(*) FILTER (WHERE account_activated_date IS NOT NULL)AS account_activated,
      COUNT(*) FILTER (WHERE first_investment_date IS NOT NULL) AS first_invested,
      COUNT(*) FILTER (WHERE demat_opened_date IS NOT NULL)     AS demat_opened,
      CAST(COUNT(*) FILTER (WHERE first_investment_date IS NOT NULL) AS DOUBLE)
        / NULLIF(COUNT(*), 0) * 100                            AS pct_invested
    FROM raw_investors
    WHERE signup_date >= '2024-06-01'
    GROUP BY 1, 2, 3
    ORDER BY 3, 1
  `, "investor_funnel");

  await run(`
    CREATE OR REPLACE TABLE city_tier_kpis AS
    SELECT
      i.city_tier,
      CAST(strftime(s.start_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(DISTINCT i.investor_id)          AS investors_with_sips,
      COUNT(DISTINCT s.sip_id)               AS total_sips,
      COUNT(DISTINCT s.sip_id) FILTER
        (WHERE s.status = 'active')           AS active_sips,
      AVG(s.amount_inr)                      AS avg_sip_amount,
      SUM(s.amount_inr) FILTER
        (WHERE s.status = 'active')           AS active_sip_book_inr
    FROM raw_sips s
    JOIN raw_investors i ON s.investor_id = i.investor_id
    GROUP BY 1, 2
    ORDER BY 2, 1
  `, "city_tier_kpis");

  await run(`
    CREATE OR REPLACE TABLE goal_achievement AS
    SELECT
      goal_type,
      created_by,
      COUNT(*)                                        AS total_goals,
      COUNT(*) FILTER (WHERE status = 'on_track')     AS on_track,
      COUNT(*) FILTER (WHERE status = 'at_risk')      AS at_risk,
      COUNT(*) FILTER (WHERE status = 'off_track')    AS off_track,
      COUNT(*) FILTER (WHERE status = 'achieved')     AS achieved,
      CAST(COUNT(*) FILTER (WHERE status = 'on_track') AS DOUBLE)
        / NULLIF(COUNT(*), 0) * 100                  AS pct_on_track,
      AVG(target_amount_inr)                         AS avg_target,
      AVG(current_value_inr)                         AS avg_current_value
    FROM raw_goals
    GROUP BY 1, 2
    ORDER BY total_goals DESC
  `, "goal_achievement");

  await run(`
    CREATE OR REPLACE TABLE support_metrics AS
    SELECT
      CAST(strftime(created_at::TIMESTAMP, '%Y-%m') || '-01' AS DATE) AS month,
      category,
      COUNT(*)                                              AS tickets,
      AVG(resolution_hours)                                AS avg_resolution_hours,
      COUNT(*) FILTER (WHERE status = 'resolved')          AS resolved,
      COUNT(*) FILTER (WHERE status = 'escalated')         AS escalated,
      AVG(nps_score) FILTER (WHERE nps_score IS NOT NULL)  AS avg_nps
    FROM raw_support
    GROUP BY 1, 2
    ORDER BY 1, 2
  `, "support_metrics");

  // ═══════════════════════════════════════════
  // STEP 4: VERIFY
  // ═══════════════════════════════════════════
  console.log("\nStep 4: Verifying...");

  const counts = await Promise.all([
    query("SELECT COUNT(*) FROM raw_investors"),
    query("SELECT COUNT(*) FROM raw_sips"),
    query("SELECT COUNT(*) FROM raw_transactions"),
    query("SELECT COUNT(*) FROM raw_user_events"),
    query("SELECT COUNT(*) FROM raw_funds"),
    query("SELECT COUNT(*) FROM monthly_platform_kpis"),
    query("SELECT COUNT(*) FROM campaign_performance"),
  ]);

  console.log(`  investors:          ${Number(counts[0]).toLocaleString()}`);
  console.log(`  sips:               ${Number(counts[1]).toLocaleString()}`);
  console.log(`  transactions:       ${Number(counts[2]).toLocaleString()}`);
  console.log(`  user_events:        ${Number(counts[3]).toLocaleString()}`);
  console.log(`  funds:              ${Number(counts[4]).toLocaleString()}`);
  console.log(`  monthly_kpis rows:  ${Number(counts[5]).toLocaleString()}`);
  console.log(`  campaign rows:      ${Number(counts[6]).toLocaleString()}`);

  await run("CHECKPOINT");

  console.log(`\n✅ Database ready: ${DB_PATH}`);
  console.log("   expanded views + 9 summary tables created.\n");
}

main().catch(e => { console.error("Setup failed:", e); process.exit(1); });
