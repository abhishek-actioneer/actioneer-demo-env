/**
 * Sets up the ABSLI Life Insurance DuckDB database from CSV files.
 *
 * Creates:
 *   - 11 raw materialized tables from CSV
 *   - 6 denormalized views (policies_full, premium_full, leads_full, etc.)
 *   - 9 pre-aggregated summary tables for fast analytics
 *   - bancassurance_leads + bancassurance_summary (untapped cross-sell pool)
 *
 * Usage: npx tsx scripts/setup-absli-life.ts
 */

import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { buildBancassurance } from "./absli-bancassurance-sql";

const CSV_DIR = resolve(__dirname, "../data/csv/absli-life");
const DB_PATH = resolve(__dirname, "../data/absli-life.duckdb");

const REQUIRED = [
  "policies.csv", "policyholders.csv", "agents.csv", "products.csv",
  "premium_payments.csv", "leads.csv", "claims.csv", "policy_events.csv",
  "fund_transactions.csv", "fund_nav_history.csv", "funds.csv",
];

for (const f of REQUIRED) {
  if (!existsSync(resolve(CSV_DIR, f))) {
    console.error(`Missing ${f} in ${CSV_DIR}`);
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
      if (label) console.log(`  ok  ${label}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`SQL Error on ${label ?? "?"}: ${msg}`);
      console.error(sql.slice(0, 400));
      throw e;
    }
  };

  const count = async (table: string): Promise<number> => {
    const r = await conn.runAndReadAll(`SELECT COUNT(*) FROM ${table}`);
    return Number(r.getRows()[0]?.[0] ?? 0);
  };

  await run("SET memory_limit = '6GB'");
  await run("SET threads = 4");

  console.log("\nSetting up ABSLI Life Insurance database...\n");

  // ─── Step 1: Materialize raw tables ─────────────────────────────────────
  console.log("Step 1: Importing raw tables from CSV...");

  for (const [name, file] of [
    ["raw_policies",         "policies.csv"],
    ["raw_policyholders",    "policyholders.csv"],
    ["raw_agents",           "agents.csv"],
    ["raw_products",         "products.csv"],
    ["raw_premium_payments", "premium_payments.csv"],
    ["raw_leads",            "leads.csv"],
    ["raw_claims",           "claims.csv"],
    ["raw_policy_events",    "policy_events.csv"],
    ["raw_fund_transactions","fund_transactions.csv"],
    ["raw_fund_nav_history", "fund_nav_history.csv"],
    ["raw_funds",            "funds.csv"],
  ] as [string, string][]) {
    await run(`CREATE TABLE ${name} AS SELECT * FROM read_csv('${CSV_DIR}/${file}', auto_detect=true)`);
    console.log(`  ok  ${name} (${(await count(name)).toLocaleString()} rows)`);
  }

  // ─── Step 2: Denormalized views ──────────────────────────────────────────
  console.log("\nStep 2: Creating denormalized views...");

  await run(`
    CREATE OR REPLACE VIEW policies_full AS
    SELECT
      p.*,
      ph.full_name, ph.email, ph.mobile, ph.gender, ph.age, ph.age_band,
      ph.city, ph.state, ph.pincode, ph.occupation, ph.annual_income_band,
      ph.smoker_flag, ph.nri_flag, ph.nri_country, ph.kyc_status,
      ph.total_policies, ph.inforce_policies, ph.total_annual_premium,
      ph.customer_segment, ph.first_policy_date,
      a.agent_name, a.agent_tier, a.branch_city, a.branch_state, a.status AS agent_status,
      pr.product_name, pr.par_flag, pr.launch_year, pr.first_year_commission_rate
    FROM raw_policies p
    LEFT JOIN raw_policyholders ph USING (policyholder_id)
    LEFT JOIN raw_agents a USING (agent_id)
    LEFT JOIN raw_products pr USING (product_id)
  `, "policies_full (250K policies + policyholders + agents + products)");

  await run(`
    CREATE OR REPLACE VIEW premium_full AS
    SELECT
      pp.*,
      p.product_category, p.channel, p.partner_name, p.annual_premium
    FROM raw_premium_payments pp
    LEFT JOIN raw_policies p USING (policy_id)
  `, "premium_full (908K payments + policy info)");

  await run(`
    CREATE OR REPLACE VIEW leads_full AS
    SELECT
      l.*,
      a.agent_name, a.agent_tier, a.branch_city, a.branch_state
    FROM raw_leads l
    LEFT JOIN raw_agents a USING (agent_id)
  `, "leads_full (521K leads + agent info)");

  await run(`
    CREATE OR REPLACE VIEW claims_full AS
    SELECT
      c.*,
      p.product_category, p.channel, p.issue_date, p.annual_premium
    FROM raw_claims c
    LEFT JOIN raw_policies p USING (policy_id)
  `, "claims_full (2.8K claims + policy info)");

  await run(`
    CREATE OR REPLACE VIEW policy_events_full AS
    SELECT
      e.*,
      p.product_category, p.channel, p.status AS policy_status,
      p.annual_premium, p.issue_date
    FROM raw_policy_events e
    LEFT JOIN raw_policies p USING (policy_id)
  `, "policy_events_full (156K events + policy info)");

  await run(`
    CREATE OR REPLACE VIEW fund_transactions_full AS
    SELECT
      ft.*,
      f.fund_name, f.fund_type, f.risk_profile, f.benchmark
    FROM raw_fund_transactions ft
    LEFT JOIN raw_funds f USING (fund_id)
  `, "fund_transactions_full (81K ULIP transactions + fund metadata)");

  // ─── Step 3: Summary tables ──────────────────────────────────────────────
  console.log("\nStep 3: Creating summary tables...");

  await run(`
    CREATE TABLE monthly_new_business AS
    SELECT
      DATE_TRUNC('month', TRY_CAST(issue_date AS TIMESTAMP))::DATE AS month,
      channel,
      product_category,
      COUNT(*) AS policies,
      SUM(first_year_premium) AS fyp,
      SUM(annualized_premium_equivalent) AS ape,
      SUM(first_year_commission) AS commission
    FROM raw_policies
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `, "monthly_new_business");

  await run(`
    CREATE TABLE lead_funnel_monthly AS
    SELECT
      DATE_TRUNC('month', TRY_CAST(created_date AS TIMESTAMP))::DATE AS month,
      channel,
      product_interest,
      COUNT(*) AS leads,
      COUNT(CASE WHEN status = 'Contacted' THEN 1 END) AS contacted,
      COUNT(CASE WHEN status IN ('Contacted','Converted') THEN 1 END) AS reached,
      COUNT(CASE WHEN converted_flag THEN 1 END) AS converted,
      ROUND(COUNT(CASE WHEN converted_flag THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS conversion_rate_pct
    FROM raw_leads
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `, "lead_funnel_monthly");

  await run(`
    CREATE TABLE persistency_summary AS
    SELECT
      EXTRACT(YEAR FROM TRY_CAST(issue_date AS TIMESTAMP))::INTEGER AS cohort_year,
      channel,
      product_category,
      COUNT(*) AS policies,
      COUNT(CASE WHEN persistency_13m_flag THEN 1 END) AS persistent_13m,
      ROUND(COUNT(CASE WHEN persistency_13m_flag THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS persistency_rate_pct
    FROM raw_policies
    WHERE EXTRACT(YEAR FROM TRY_CAST(issue_date AS TIMESTAMP)) >= 2015
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `, "persistency_summary");

  await run(`
    CREATE TABLE lapse_analysis AS
    SELECT
      EXTRACT(YEAR FROM TRY_CAST(p.issue_date AS TIMESTAMP))::INTEGER AS cohort_year,
      p.policy_year,
      p.channel,
      p.product_category,
      COUNT(*) AS total_policies,
      COUNT(CASE WHEN p.status = 'Lapsed' THEN 1 END) AS lapses,
      ROUND(COUNT(CASE WHEN p.status = 'Lapsed' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS lapse_rate_pct
    FROM raw_policies p
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3, 4
  `, "lapse_analysis");

  await run(`
    CREATE TABLE premium_collection_monthly AS
    SELECT
      DATE_TRUNC('month', TRY_CAST(due_date AS TIMESTAMP))::DATE AS month,
      pp.channel,
      COUNT(*) AS due_count,
      COUNT(CASE WHEN pp.status = 'Paid' THEN 1 END) AS paid_count,
      COUNT(CASE WHEN pp.status = 'Missed' THEN 1 END) AS missed_count,
      COUNT(CASE WHEN pp.status = 'Overdue' THEN 1 END) AS overdue_count,
      ROUND(COUNT(CASE WHEN pp.status = 'Paid' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS collection_rate_pct,
      ROUND(COUNT(CASE WHEN pp.grace_flag THEN 1 END) * 100.0 / NULLIF(COUNT(CASE WHEN pp.status = 'Paid' THEN 1 END), 0), 2) AS grace_usage_pct,
      SUM(CASE WHEN pp.status = 'Paid' THEN pp.amount ELSE 0 END) AS amount_collected
    FROM premium_full pp
    GROUP BY 1, 2
    ORDER BY 1, 2
  `, "premium_collection_monthly");

  await run(`
    CREATE TABLE claims_summary AS
    SELECT
      cf.claim_type,
      cf.decision,
      cf.channel,
      cf.product_category,
      COUNT(*) AS claim_count,
      SUM(cf.claim_amount) AS total_claim_amount,
      AVG(CASE
        WHEN cf.decision_date IS NOT NULL AND cf.intimation_date IS NOT NULL
        THEN DATEDIFF('day', TRY_CAST(cf.intimation_date AS TIMESTAMP), TRY_CAST(cf.decision_date AS TIMESTAMP))
      END) AS avg_turnaround_days,
      ROUND(COUNT(CASE WHEN cf.decision = 'Settled' THEN 1 END) * 100.0
        / NULLIF(COUNT(CASE WHEN cf.decision IN ('Settled','Repudiated') THEN 1 END), 0), 2) AS settlement_ratio_pct
    FROM claims_full cf
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3, 4
  `, "claims_summary");

  await run(`
    CREATE TABLE channel_performance AS
    SELECT
      channel,
      COUNT(*) AS policies,
      SUM(first_year_premium) AS fyp,
      SUM(annualized_premium_equivalent) AS ape,
      ROUND(COUNT(CASE WHEN persistency_13m_flag THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS persistency_rate_pct,
      ROUND(COUNT(CASE WHEN status = 'Lapsed' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS lapse_rate_pct,
      ROUND(COUNT(CASE WHEN status = 'In-Force' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS inforce_rate_pct
    FROM raw_policies
    GROUP BY 1
    ORDER BY ape DESC
  `, "channel_performance");

  await run(`
    CREATE TABLE agent_leaderboard AS
    SELECT
      p.agent_id,
      a.agent_name,
      a.agent_tier,
      p.channel,
      a.branch_city,
      a.branch_state,
      COUNT(*) AS policies,
      SUM(p.first_year_premium) AS fyp,
      SUM(p.annualized_premium_equivalent) AS ape,
      ROUND(COUNT(CASE WHEN p.persistency_13m_flag THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS persistency_rate_pct,
      ROUND(COUNT(CASE WHEN p.status = 'Lapsed' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS lapse_rate_pct
    FROM raw_policies p
    LEFT JOIN raw_agents a USING (agent_id)
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY ape DESC
  `, "agent_leaderboard");

  await run(`
    CREATE TABLE product_performance AS
    SELECT
      product_category,
      COUNT(*) AS policies,
      SUM(first_year_premium) AS total_fyp,
      SUM(annualized_premium_equivalent) AS total_ape,
      AVG(sum_assured) AS avg_sum_assured,
      AVG(annual_premium) AS avg_annual_premium,
      ROUND(COUNT(CASE WHEN persistency_13m_flag THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS persistency_rate_pct,
      ROUND(COUNT(CASE WHEN status = 'Lapsed' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS lapse_rate_pct,
      ROUND(COUNT(CASE WHEN status = 'In-Force' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS inforce_rate_pct
    FROM raw_policies
    GROUP BY 1
    ORDER BY total_ape DESC
  `, "product_performance");

  // ─── Step 4: Bancassurance cross-sell pool ───────────────────────────────
  console.log("\nStep 4: Building bancassurance cross-sell pool...");
  await buildBancassurance(run);

  // ─── Checkpoint: flush WAL into the main .duckdb file ───────────────────
  console.log("\nCheckpointing...");
  await run("CHECKPOINT", "WAL flushed to main file");

  // ─── Verify ──────────────────────────────────────────────────────────────
  console.log("\nVerification:");
  const tables = [
    "raw_policies", "raw_policyholders", "raw_premium_payments", "raw_leads",
    "raw_claims", "raw_policy_events", "raw_fund_transactions",
    "monthly_new_business", "lead_funnel_monthly", "persistency_summary",
    "lapse_analysis", "premium_collection_monthly", "claims_summary",
    "channel_performance", "agent_leaderboard", "product_performance",
    "bancassurance_leads", "bancassurance_summary",
  ];
  for (const t of tables) {
    const n = await count(t);
    console.log(`  ${t}: ${n.toLocaleString()}`);
  }

  await instance.close();
  console.log("\nDone! Database saved to data/absli-life.duckdb");
}

main().catch((e) => { console.error(e); process.exit(1); });
