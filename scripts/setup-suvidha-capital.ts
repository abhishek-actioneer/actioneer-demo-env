/**
 * Sets up the Suvidha Capital DuckDB database from source CSVs.
 *
 * Creates:
 *   - Raw views from CSV files
 *   - Denormalized views (loans_full, applications_full, collections_full,
 *     collections_actions_full, crosssell_full, dealers_full)
 *   - 16 summary/materialized tables for fast querying
 *
 * Prerequisites: CSVs must already exist in data/csv/suvidha-capital/
 * (dealer-network consumer/vehicle-finance NBFC data — TVS brand references
 * scrubbed to "Raahi Motors" before import).
 *
 * Usage: npx tsx scripts/setup-suvidha-capital.ts
 */

import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";

const CSV_DIR = resolve(__dirname, "../data/csv/suvidha-capital");
const DB_PATH = process.env.SUVIDHA_DB_PATH ?? resolve(__dirname, "../data/suvidha-capital.duckdb");

const requiredFiles = [
  "borrowers.csv", "dealers.csv", "collection_agents.csv", "loans.csv",
  "loan_applications.csv", "emi_payments.csv", "collections_actions.csv",
  "crosssell_offers.csv", "calendar_events.csv",
];

for (const f of requiredFiles) {
  if (!existsSync(resolve(CSV_DIR, f))) {
    console.error(`❌ Missing ${f} in ${CSV_DIR}`);
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

  const run = async (sql: string) => {
    try {
      await conn.run(sql);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`SQL Error: ${msg}`);
      console.error(`SQL: ${sql.slice(0, 200)}...`);
      throw e;
    }
  };

  await run("SET memory_limit = '4GB'");
  await run("SET threads = 4");

  console.log("\n🏍️  Setting up Suvidha Capital database...\n");

  // ═══════════════════════════════════════════════════════
  // STEP 1: RAW VIEWS FROM CSV
  // ═══════════════════════════════════════════════════════

  console.log("Step 1: Creating raw views from CSVs...");

  const csvViews = [
    `CREATE OR REPLACE VIEW raw_borrowers AS SELECT * FROM read_csv('${CSV_DIR}/borrowers.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_dealers AS SELECT * FROM read_csv('${CSV_DIR}/dealers.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_collection_agents AS SELECT * FROM read_csv('${CSV_DIR}/collection_agents.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_loans AS SELECT * FROM read_csv('${CSV_DIR}/loans.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_loan_applications AS SELECT * FROM read_csv('${CSV_DIR}/loan_applications.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_emi_payments AS SELECT * FROM read_csv('${CSV_DIR}/emi_payments.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_collections_actions AS SELECT * FROM read_csv('${CSV_DIR}/collections_actions.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_crosssell_offers AS SELECT * FROM read_csv('${CSV_DIR}/crosssell_offers.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_calendar_events AS SELECT * FROM read_csv('${CSV_DIR}/calendar_events.csv', auto_detect=true, ignore_errors=true)`,
  ];

  for (const sql of csvViews) {
    await run(sql);
  }
  console.log("  ✓ 9 raw views created");

  // ═══════════════════════════════════════════════════════
  // STEP 2: DENORMALIZED VIEWS
  // ═══════════════════════════════════════════════════════

  console.log("Step 2: Creating denormalized views...");

  // loans_full: loans + borrowers + dealers
  await run(`
    CREATE OR REPLACE TABLE loans_full AS
    SELECT
      l.*,
      b.borrower_name,
      b.gender AS borrower_gender,
      b.age AS borrower_age,
      b.employment_type,
      b.occupation,
      b.monthly_income_inr,
      b.income_category,
      b.state AS borrower_state,
      b.city AS borrower_city,
      b.city_tier AS borrower_city_tier,
      b.bureau_score,
      b.is_ntc,
      b.is_repeat_borrower,
      d.dealer_name,
      d.dealer_type,
      d.state,
      d.city,
      d.city_tier
    FROM raw_loans l
    LEFT JOIN raw_borrowers b ON l.borrower_id = b.borrower_id
    LEFT JOIN raw_dealers d ON l.dealer_id = d.dealer_id
  `);

  // applications_full: loan applications + borrowers + dealers
  await run(`
    CREATE OR REPLACE TABLE applications_full AS
    SELECT
      a.*,
      b.employment_type,
      b.occupation,
      b.income_category,
      b.bureau_score,
      b.is_ntc,
      d.dealer_name,
      d.dealer_type,
      d.state,
      d.city,
      d.city_tier
    FROM raw_loan_applications a
    LEFT JOIN raw_borrowers b ON a.borrower_id = b.borrower_id
    LEFT JOIN raw_dealers d ON a.dealer_id = d.dealer_id
  `);

  // collections_full: EMI payments + loan + borrower + dealer context
  await run(`
    CREATE OR REPLACE TABLE collections_full AS
    SELECT
      ep.*,
      l.borrower_id,
      l.dealer_id,
      l.product_type,
      l.interest_rate,
      l.loan_status,
      l.dpd_bucket AS loan_dpd_bucket,
      l.stage AS loan_stage,
      l.sourcing_channel,
      b.employment_type,
      b.income_category,
      b.is_ntc,
      d.state,
      d.city,
      d.city_tier,
      d.dealer_name
    FROM raw_emi_payments ep
    JOIN raw_loans l ON ep.loan_id = l.loan_id
    LEFT JOIN raw_borrowers b ON l.borrower_id = b.borrower_id
    LEFT JOIN raw_dealers d ON l.dealer_id = d.dealer_id
  `);

  // collections_actions_full: recovery actions + loan + agent context
  await run(`
    CREATE OR REPLACE TABLE collections_actions_full AS
    SELECT
      ca.*,
      l.borrower_id,
      l.product_type,
      l.loan_status,
      ag.agent_name,
      ag.region,
      ag.function_type
    FROM raw_collections_actions ca
    JOIN raw_loans l ON ca.loan_id = l.loan_id
    LEFT JOIN raw_collection_agents ag ON ca.agent_id = ag.agent_id
  `);

  // crosssell_full: pre-approved offers + borrower context
  await run(`
    CREATE OR REPLACE TABLE crosssell_full AS
    SELECT
      co.*,
      b.employment_type,
      b.income_category,
      b.state,
      b.city,
      b.city_tier,
      b.bureau_score,
      b.is_ntc
    FROM raw_crosssell_offers co
    LEFT JOIN raw_borrowers b ON co.borrower_id = b.borrower_id
  `);

  // dealers_full: dealer master + aggregated loan-book stats
  await run(`
    CREATE OR REPLACE TABLE dealers_full AS
    SELECT
      d.*,
      COALESCE(stats.loan_count, 0) AS loan_count,
      COALESCE(stats.total_disbursed, 0) AS total_disbursed,
      COALESCE(stats.npa_count, 0) AS npa_count
    FROM raw_dealers d
    LEFT JOIN (
      SELECT
        dealer_id,
        COUNT(*) AS loan_count,
        SUM(disbursed_amount) AS total_disbursed,
        COUNT(*) FILTER (WHERE stage = 3) AS npa_count
      FROM raw_loans
      GROUP BY dealer_id
    ) stats ON d.dealer_id = stats.dealer_id
  `);

  console.log("  ✓ 6 denormalized tables materialized");

  // ═══════════════════════════════════════════════════════
  // STEP 2b: BORROWER-LEVEL ENTITY TABLE (materialized)
  //
  // Per-borrower rollup of loan + repayment behavior. This is the clean
  // user-grained table for SEGMENTS and VOICE CAMPAIGN targeting (loans_full
  // is loan-grained and double-counts multi-loan borrowers). Materialized as a
  // TABLE because it aggregates 1.8M EMI rows and is queried repeatedly.
  // ═══════════════════════════════════════════════════════

  console.log("Step 2b: Creating borrowers_full entity table...");

  await run(`
    CREATE OR REPLACE TABLE borrowers_full AS
    WITH loan_agg AS (
      SELECT
        borrower_id,
        COUNT(*) AS loan_count,
        COUNT(*) FILTER (WHERE loan_status IN ('active', 'npa')) AS active_loans,
        SUM(disbursed_amount) AS total_disbursed,
        SUM(disbursed_amount) FILTER (WHERE loan_status IN ('active', 'npa')) AS active_exposure,
        SUM(overdue_amount) AS total_overdue,
        MAX(current_dpd) AS max_current_dpd,
        MAX(stage) AS worst_stage,
        BOOL_OR(stage = 3) AS has_npa,
        BOOL_OR(repossessed) AS ever_repossessed,
        BOOL_OR(is_crosssell) AS has_crosssell_loan,
        MAX(CASE dpd_bucket
          WHEN 'current' THEN 0 WHEN 'sma_0' THEN 1 WHEN 'sma_1' THEN 2 WHEN 'sma_2' THEN 3
          WHEN 'npa_90' THEN 4 WHEN 'npa_180' THEN 5 WHEN 'npa_360_plus' THEN 6 ELSE 0 END) AS worst_dpd_rank,
        MAX(disbursement_date) AS latest_disbursement_date,
        ANY_VALUE(product_type) AS a_product_type
      FROM raw_loans
      GROUP BY borrower_id
    ),
    emi_agg AS (
      SELECT
        l.borrower_id,
        COUNT(*) AS total_emis,
        COUNT(*) FILTER (WHERE ep.bounce = true) AS bounced_emis,
        COUNT(*) FILTER (WHERE ep.amount_paid > 0) AS paid_emis,
        COUNT(*) FILTER (WHERE ep.amount_paid > 0 AND ep.dpd_at_payment = 0) AS ontime_emis
      FROM raw_emi_payments ep
      JOIN raw_loans l ON ep.loan_id = l.loan_id
      GROUP BY l.borrower_id
    )
    SELECT
      b.*,
      COALESCE(la.loan_count, 0) AS loan_count_actual,
      COALESCE(la.active_loans, 0) AS active_loans,
      COALESCE(la.total_disbursed, 0) AS total_disbursed,
      COALESCE(la.active_exposure, 0) AS active_exposure,
      COALESCE(la.total_overdue, 0) AS total_overdue,
      COALESCE(la.max_current_dpd, 0) AS max_current_dpd,
      COALESCE(la.worst_stage, 0) AS worst_stage,
      COALESCE(la.has_npa, false) AS has_npa,
      COALESCE(la.ever_repossessed, false) AS ever_repossessed,
      COALESCE(la.has_crosssell_loan, false) AS has_crosssell_loan,
      CASE la.worst_dpd_rank
        WHEN 0 THEN 'current' WHEN 1 THEN 'sma_0' WHEN 2 THEN 'sma_1' WHEN 3 THEN 'sma_2'
        WHEN 4 THEN 'npa_90' WHEN 5 THEN 'npa_180' WHEN 6 THEN 'npa_360_plus' END AS worst_dpd_bucket,
      la.latest_disbursement_date,
      la.a_product_type AS primary_product_type,
      COALESCE(ea.total_emis, 0) AS total_emis,
      COALESCE(ea.bounced_emis, 0) AS bounced_emis,
      COALESCE(ea.paid_emis, 0) AS paid_emis,
      COALESCE(ea.ontime_emis, 0) AS ontime_emis,
      CASE WHEN ea.paid_emis > 0 THEN ea.ontime_emis::DOUBLE / ea.paid_emis * 100 ELSE NULL END AS ontime_rate_pct,
      CASE WHEN ea.total_emis > 0 THEN ea.bounced_emis::DOUBLE / ea.total_emis * 100 ELSE NULL END AS bounce_rate_pct
    FROM raw_borrowers b
    LEFT JOIN loan_agg la ON b.borrower_id = la.borrower_id
    LEFT JOIN emi_agg ea ON b.borrower_id = ea.borrower_id
  `);
  console.log("  ✓ borrowers_full (165K borrower-level rows)");

  // ═══════════════════════════════════════════════════════
  // STEP 3: SUMMARY TABLES
  // ═══════════════════════════════════════════════════════

  console.log("Step 3: Creating summary tables...");

  // --- ORIGINATIONS ---

  await run(`
    CREATE OR REPLACE TABLE monthly_originations AS
    SELECT
      CAST(strftime(disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      product_type,
      sourcing_channel,
      COUNT(*) AS loan_count,
      SUM(sanctioned_amount) AS total_sanctioned,
      SUM(disbursed_amount) AS total_disbursed,
      AVG(disbursed_amount) AS avg_ticket_size,
      AVG(interest_rate) AS avg_rate,
      AVG(ltv_ratio) AS avg_ltv
    FROM raw_loans
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `);
  console.log("  ✓ monthly_originations");

  await run(`
    CREATE OR REPLACE TABLE application_funnel_monthly AS
    SELECT
      CAST(strftime(apply_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      product_type,
      COUNT(*) AS applications,
      COUNT(*) FILTER (WHERE status = 'disbursed') AS disbursed,
      COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
      COUNT(*) FILTER (WHERE status = 'withdrawn') AS withdrawn,
      COUNT(*) FILTER (WHERE status = 'pending_docs') AS pending_docs,
      CAST(COUNT(*) FILTER (WHERE status = 'disbursed') AS DOUBLE) / COUNT(*) * 100 AS approval_rate_pct
    FROM raw_loan_applications
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  console.log("  ✓ application_funnel_monthly");

  await run(`
    CREATE OR REPLACE TABLE rejection_reason_summary AS
    SELECT
      product_type,
      rejection_reason,
      COUNT(*) AS rejection_count
    FROM raw_loan_applications
    WHERE status = 'rejected' AND rejection_reason != ''
    GROUP BY 1, 2
    ORDER BY rejection_count DESC
  `);
  console.log("  ✓ rejection_reason_summary");

  // --- PORTFOLIO ---

  await run(`
    CREATE OR REPLACE TABLE product_performance AS
    SELECT
      product_type,
      COUNT(*) AS total_loans,
      COUNT(*) FILTER (WHERE loan_status IN ('active', 'npa')) AS active_loans,
      SUM(disbursed_amount) AS total_disbursed,
      SUM(disbursed_amount) FILTER (WHERE loan_status IN ('active', 'npa')) AS aum,
      AVG(disbursed_amount) AS avg_ticket_size,
      AVG(interest_rate) AS avg_yield,
      AVG(ltv_ratio) AS avg_ltv,
      AVG(tenure_months) AS avg_tenure_months,
      COUNT(*) FILTER (WHERE stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE loan_status IN ('active', 'npa')) > 0
        THEN CAST(COUNT(*) FILTER (WHERE stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE loan_status IN ('active', 'npa')) * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans
    GROUP BY 1
    ORDER BY aum DESC
  `);
  console.log("  ✓ product_performance");

  await run(`
    CREATE OR REPLACE TABLE stage_dpd_distribution AS
    SELECT
      product_type,
      CAST(strftime(disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS cohort_month,
      COUNT(*) AS total_loans,
      COUNT(*) FILTER (WHERE stage = 1) AS stage_1,
      COUNT(*) FILTER (WHERE stage = 2) AS stage_2,
      COUNT(*) FILTER (WHERE stage = 3) AS stage_3,
      CAST(COUNT(*) FILTER (WHERE stage = 1) AS DOUBLE) / COUNT(*) * 100 AS stage_1_pct,
      CAST(COUNT(*) FILTER (WHERE stage = 2) AS DOUBLE) / COUNT(*) * 100 AS stage_2_pct,
      CAST(COUNT(*) FILTER (WHERE stage = 3) AS DOUBLE) / COUNT(*) * 100 AS stage_3_pct
    FROM raw_loans
    WHERE loan_status IN ('active', 'npa')
    GROUP BY 1, 2
    ORDER BY 2, 1
  `);
  console.log("  ✓ stage_dpd_distribution");

  // --- COLLECTIONS ---

  await run(`
    CREATE OR REPLACE TABLE monthly_collections AS
    SELECT
      CAST(strftime(ep.due_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      l.product_type,
      COUNT(*) AS total_emis,
      SUM(ep.amount_due) AS total_due,
      SUM(ep.amount_paid) AS total_collected,
      COUNT(*) FILTER (WHERE ep.bounce = true) AS bounced,
      CAST(COUNT(*) FILTER (WHERE ep.bounce = true) AS DOUBLE) / COUNT(*) * 100 AS bounce_rate_pct,
      CASE WHEN SUM(ep.amount_due) > 0 THEN SUM(ep.amount_paid) / SUM(ep.amount_due) * 100 ELSE 0 END AS collection_efficiency_pct,
      AVG(ep.dpd_at_payment) AS avg_dpd
    FROM raw_emi_payments ep
    JOIN raw_loans l ON ep.loan_id = l.loan_id
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  console.log("  ✓ monthly_collections");

  await run(`
    CREATE OR REPLACE TABLE collection_action_effectiveness AS
    SELECT
      action_type,
      result,
      COUNT(*) AS action_count
    FROM raw_collections_actions
    GROUP BY 1, 2
    ORDER BY action_count DESC
  `);
  console.log("  ✓ collection_action_effectiveness");

  await run(`
    CREATE OR REPLACE TABLE collection_agent_leaderboard AS
    SELECT
      ag.agent_id,
      ag.agent_name,
      ag.region,
      ag.function_type,
      COUNT(*) AS total_actions,
      COUNT(*) FILTER (WHERE ca.result = 'resolved') AS resolved_count,
      COUNT(*) FILTER (WHERE ca.result = 'promise_to_pay') AS promise_to_pay_count,
      CAST(COUNT(*) FILTER (WHERE ca.result = 'resolved') AS DOUBLE) / COUNT(*) * 100 AS resolution_rate_pct
    FROM raw_collections_actions ca
    JOIN raw_collection_agents ag ON ca.agent_id = ag.agent_id
    GROUP BY 1, 2, 3, 4
    ORDER BY total_actions DESC
  `);
  console.log("  ✓ collection_agent_leaderboard");

  // --- CROSS-SELL ---

  await run(`
    CREATE OR REPLACE TABLE crosssell_funnel_monthly AS
    SELECT
      CAST(strftime(offer_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      channel,
      COUNT(*) AS offers_sent,
      COUNT(*) FILTER (WHERE status IN ('viewed', 'accepted', 'disbursed')) AS viewed,
      COUNT(*) FILTER (WHERE status IN ('accepted', 'disbursed')) AS accepted,
      COUNT(*) FILTER (WHERE status = 'disbursed') AS disbursed,
      SUM(pre_approved_amount) FILTER (WHERE status = 'disbursed') AS total_disbursed_amount,
      CAST(COUNT(*) FILTER (WHERE status IN ('accepted', 'disbursed')) AS DOUBLE) / COUNT(*) * 100 AS acceptance_rate_pct,
      CAST(COUNT(*) FILTER (WHERE status = 'disbursed') AS DOUBLE) / COUNT(*) * 100 AS conversion_rate_pct
    FROM raw_crosssell_offers
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  console.log("  ✓ crosssell_funnel_monthly");

  // --- BORROWER PROFILE ---

  await run(`
    CREATE OR REPLACE TABLE borrower_profile_summary AS
    SELECT
      b.employment_type,
      b.income_category,
      b.is_ntc,
      COUNT(*) AS loan_count,
      SUM(l.disbursed_amount) AS total_disbursed,
      AVG(l.disbursed_amount) AS avg_ticket,
      AVG(b.bureau_score) FILTER (WHERE b.bureau_score > 0) AS avg_bureau_score,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE l.loan_status IN ('active', 'npa')) > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE l.loan_status IN ('active', 'npa')) * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    JOIN raw_borrowers b ON l.borrower_id = b.borrower_id
    GROUP BY 1, 2, 3
    ORDER BY total_disbursed DESC
  `);
  console.log("  ✓ borrower_profile_summary");

  await run(`
    CREATE OR REPLACE TABLE occupation_performance AS
    SELECT
      b.occupation,
      COUNT(*) AS loan_count,
      SUM(l.disbursed_amount) AS total_disbursed,
      AVG(l.disbursed_amount) AS avg_ticket,
      AVG(b.bureau_score) FILTER (WHERE b.bureau_score > 0) AS avg_bureau_score,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE l.loan_status IN ('active', 'npa')) > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE l.loan_status IN ('active', 'npa')) * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    JOIN raw_borrowers b ON l.borrower_id = b.borrower_id
    GROUP BY 1
    ORDER BY total_disbursed DESC
  `);
  console.log("  ✓ occupation_performance");

  // --- GEOGRAPHIC & DEALER NETWORK ---

  await run(`
    CREATE OR REPLACE TABLE state_city_tier_kpis AS
    SELECT
      d.state,
      d.city_tier,
      CAST(strftime(l.disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*) AS loans_disbursed,
      SUM(l.disbursed_amount) AS total_disbursed,
      AVG(l.disbursed_amount) AS avg_ticket,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    JOIN raw_dealers d ON l.dealer_id = d.dealer_id
    GROUP BY 1, 2, 3
    ORDER BY 3, 1
  `);
  console.log("  ✓ state_city_tier_kpis");

  await run(`
    CREATE OR REPLACE TABLE dealer_leaderboard AS
    SELECT
      d.dealer_id,
      d.dealer_name,
      d.dealer_type,
      d.state,
      d.city,
      d.city_tier,
      COUNT(*) AS loan_count,
      SUM(l.disbursed_amount) AS total_disbursed,
      AVG(l.disbursed_amount) AS avg_ticket,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    JOIN raw_dealers d ON l.dealer_id = d.dealer_id
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY total_disbursed DESC
  `);
  console.log("  ✓ dealer_leaderboard");

  await run(`
    CREATE OR REPLACE TABLE sourcing_channel_performance AS
    SELECT
      sourcing_channel,
      product_type,
      COUNT(*) AS total_loans,
      SUM(disbursed_amount) AS total_disbursed,
      AVG(disbursed_amount) AS avg_ticket,
      AVG(interest_rate) AS avg_rate,
      COUNT(*) FILTER (WHERE stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE loan_status IN ('active', 'npa')) > 0
        THEN CAST(COUNT(*) FILTER (WHERE stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE loan_status IN ('active', 'npa')) * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans
    GROUP BY 1, 2
    ORDER BY total_disbursed DESC
  `);
  console.log("  ✓ sourcing_channel_performance");

  // --- COMPANY KPIs ---

  await run(`
    CREATE OR REPLACE TABLE monthly_company_kpis AS
    SELECT
      CAST(strftime(disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*) AS total_loans_originated,
      SUM(disbursed_amount) AS total_disbursed,
      AVG(disbursed_amount) AS avg_ticket_size,
      COUNT(*) FILTER (WHERE loan_status IN ('active', 'npa')) AS active_loans,
      SUM(disbursed_amount) FILTER (WHERE loan_status IN ('active', 'npa')) AS active_aum,
      COUNT(*) FILTER (WHERE stage = 3) AS stage_3_count,
      CASE WHEN COUNT(*) FILTER (WHERE loan_status IN ('active', 'npa')) > 0
        THEN CAST(COUNT(*) FILTER (WHERE stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE loan_status IN ('active', 'npa')) * 100
        ELSE 0 END AS gnpa_pct,
      CAST(COUNT(*) FILTER (WHERE product_type LIKE '%two_wheeler%') AS DOUBLE) / NULLIF(COUNT(*), 0) * 100 AS two_wheeler_pct,
      CAST(COUNT(*) FILTER (WHERE is_crosssell = true) AS DOUBLE) / NULLIF(COUNT(*), 0) * 100 AS crosssell_pct,
      AVG(interest_rate) AS avg_yield,
      AVG(ltv_ratio) AS avg_ltv,
      CAST(COUNT(*) FILTER (WHERE sourcing_channel = 'dsa') AS DOUBLE) / NULLIF(COUNT(*), 0) * 100 AS dsa_sourced_pct
    FROM raw_loans
    GROUP BY 1
    ORDER BY 1
  `);
  console.log("  ✓ monthly_company_kpis");

  // --- REFERENCE ---

  await run(`CREATE OR REPLACE TABLE calendar_seasonality AS SELECT * FROM raw_calendar_events`);
  console.log("  ✓ calendar_seasonality");

  // ═══════════════════════════════════════════════════════
  // STEP 4: VERIFY
  // ═══════════════════════════════════════════════════════

  console.log("\nStep 4: Verifying...");

  const query = async (sql: string): Promise<string> => {
    const reader = await conn.runAndReadAll(sql);
    const rows = reader.getRows();
    if (rows.length > 0) return String(rows[0][0]);
    return "0";
  };

  const borrowerCount = await query("SELECT COUNT(*) FROM raw_borrowers");
  const dealerCount = await query("SELECT COUNT(*) FROM raw_dealers");
  const loanCount = await query("SELECT COUNT(*) FROM raw_loans");
  const applicationCount = await query("SELECT COUNT(*) FROM raw_loan_applications");
  const emiCount = await query("SELECT COUNT(*) FROM raw_emi_payments");
  const actionCount = await query("SELECT COUNT(*) FROM raw_collections_actions");
  const offerCount = await query("SELECT COUNT(*) FROM raw_crosssell_offers");
  const tvsCheck = await query(
    "SELECT COUNT(*) FROM raw_dealers WHERE dealer_name ILIKE '%tvs%' OR dealer_type ILIKE '%tvs%'"
  );
  const tvsAssetCheck = await query("SELECT COUNT(*) FROM raw_loans WHERE asset_description ILIKE '%tvs%'");

  console.log(`  Borrowers: ${Number(borrowerCount).toLocaleString()}`);
  console.log(`  Dealers: ${Number(dealerCount).toLocaleString()}`);
  console.log(`  Loans: ${Number(loanCount).toLocaleString()}`);
  console.log(`  Applications: ${Number(applicationCount).toLocaleString()}`);
  console.log(`  EMI Payments: ${Number(emiCount).toLocaleString()}`);
  console.log(`  Collection Actions: ${Number(actionCount).toLocaleString()}`);
  console.log(`  Cross-sell Offers: ${Number(offerCount).toLocaleString()}`);

  if (Number(tvsCheck) > 0 || Number(tvsAssetCheck) > 0) {
    console.error(`❌ Found ${tvsCheck} dealer rows and ${tvsAssetCheck} loan rows still referencing "tvs" — scrub incomplete!`);
    process.exit(1);
  }
  console.log("  ✓ Brand scrub verified — no 'tvs' references remain");

  // ═══════════════════════════════════════════════════════
  // STEP 5: DROP CSV-BACKED RAW VIEWS
  //
  // The raw_* views read directly from local CSV files. Every downstream
  // relation (loans_full, borrowers_full, summary tables) is now a
  // materialized TABLE, so these views are no longer needed — and if left in
  // place they break on any environment without the CSVs (e.g. the Railway
  // volume, which only receives the .duckdb file). Dropping them makes the
  // database fully self-contained.
  // ═══════════════════════════════════════════════════════

  console.log("\nStep 5: Dropping CSV-backed raw views (making DB self-contained)...");
  const rawViews = [
    "raw_borrowers", "raw_dealers", "raw_collection_agents", "raw_loans",
    "raw_loan_applications", "raw_emi_payments", "raw_collections_actions",
    "raw_crosssell_offers", "raw_calendar_events",
  ];
  for (const v of rawViews) {
    await run(`DROP VIEW IF EXISTS ${v}`);
  }
  console.log(`  ✓ Dropped ${rawViews.length} raw views`);

  await run("CHECKPOINT");

  console.log(`\n✅ Database ready at: ${DB_PATH}`);
  console.log("   6 denormalized tables + borrowers_full + 16 summary tables (all materialized, no CSV dependency).\n");
}

main().catch(e => {
  console.error("Setup failed:", e);
  process.exit(1);
});
