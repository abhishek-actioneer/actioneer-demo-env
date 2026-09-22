/**
 * Sets up the Vastu HFC DuckDB database from generated CSVs.
 *
 * Creates:
 *   - Raw views from CSV files
 *   - Denormalized views (loans_full, collections_full, funding_full)
 *   - 20 summary/materialized tables for fast querying
 *
 * Prerequisites: Run generate-vastu-hfc.ts first to produce CSVs in data/csv/vastu-hfc/
 *
 * Usage: npx tsx scripts/setup-vastu-hfc.ts
 */

import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";

const CSV_DIR = resolve(__dirname, "../data/csv/vastu-hfc");
const DB_PATH = resolve(__dirname, "../data/vastu-hfc.duckdb");

// Check prerequisites
const requiredFiles = [
  "branches.csv", "employees.csv", "borrowers.csv", "co_lending_partners.csv",
  "loans.csv", "emi_payments.csv", "disbursements.csv", "borrowings.csv",
  "collections_actions.csv", "assignments.csv", "provisions.csv", "npa_movement.csv",
];

for (const f of requiredFiles) {
  if (!existsSync(resolve(CSV_DIR, f))) {
    console.error(`❌ Missing ${f}. Run generate-vastu-hfc.ts first.`);
    process.exit(1);
  }
}

async function main() {
  // Remove old DB to avoid stale tables
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

  // Configure DuckDB
  await run("SET memory_limit = '4GB'");
  await run("SET threads = 4");

  console.log("\n🏛️  Setting up Vastu HFC database...\n");

  // ═══════════════════════════════════════════════════════
  // STEP 1: RAW VIEWS FROM CSV
  // ═══════════════════════════════════════════════════════

  console.log("Step 1: Creating raw views from CSVs...");

  const csvViews = [
    `CREATE OR REPLACE VIEW raw_branches AS SELECT * FROM read_csv('${CSV_DIR}/branches.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_employees AS SELECT * FROM read_csv('${CSV_DIR}/employees.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_borrowers AS SELECT * FROM read_csv('${CSV_DIR}/borrowers.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_co_lending_partners AS SELECT * FROM read_csv('${CSV_DIR}/co_lending_partners.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_loans AS SELECT * FROM read_csv('${CSV_DIR}/loans.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_emi_payments AS SELECT * FROM read_csv('${CSV_DIR}/emi_payments.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_disbursements AS SELECT * FROM read_csv('${CSV_DIR}/disbursements.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_borrowings AS SELECT * FROM read_csv('${CSV_DIR}/borrowings.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_collections_actions AS SELECT ca.*, l.borrower_id FROM read_csv('${CSV_DIR}/collections_actions.csv', auto_detect=true, ignore_errors=true) ca LEFT JOIN raw_loans l ON ca.loan_id = l.loan_id`,
    `CREATE OR REPLACE VIEW raw_assignments AS SELECT * FROM read_csv('${CSV_DIR}/assignments.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_provisions AS SELECT * FROM read_csv('${CSV_DIR}/provisions.csv', auto_detect=true, ignore_errors=true)`,
    `CREATE OR REPLACE VIEW raw_npa_movement AS SELECT * FROM read_csv('${CSV_DIR}/npa_movement.csv', auto_detect=true, ignore_errors=true)`,
  ];

  for (const sql of csvViews) {
    await run(sql);
  }
  console.log("  ✓ 12 raw views created");

  // ═══════════════════════════════════════════════════════
  // STEP 2: DENORMALIZED VIEWS
  // ═══════════════════════════════════════════════════════

  console.log("Step 2: Creating denormalized views...");

  // loans_full: loans + borrowers + branches + co-lending partners
  await run(`
    CREATE OR REPLACE VIEW loans_full AS
    SELECT
      l.*,
      b.first_name AS borrower_name,
      b.gender AS borrower_gender,
      b.age AS borrower_age,
      b.employment_type,
      b.monthly_income_inr,
      b.income_category,
      b.industry,
      b.bureau_score,
      b.is_ntc,
      b.property_type,
      br.branch_name,
      br.state,
      br.city,
      br.city_tier,
      br.branch_type,
      br.open_date AS branch_open_date,
      c.partner_name AS co_lending_partner_name,
      c.partner_type AS co_lending_partner_type
    FROM raw_loans l
    LEFT JOIN raw_borrowers b ON l.borrower_id = b.borrower_id
    LEFT JOIN raw_branches br ON l.branch_id = br.branch_id
    LEFT JOIN raw_co_lending_partners c ON l.co_lending_partner = c.partner_id
  `);

  // collections_full: EMI payments + loan + borrower + branch context
  await run(`
    CREATE OR REPLACE VIEW collections_full AS
    SELECT
      ep.*,
      l.borrower_id,
      l.entity,
      l.product_type,
      l.interest_rate,
      l.loan_status,
      l.dpd_bucket AS loan_dpd_bucket,
      l.stage AS loan_stage,
      l.sourcing_channel,
      l.co_lending_partner,
      b.employment_type,
      b.income_category,
      b.is_ntc,
      br.state,
      br.city,
      br.city_tier,
      br.branch_name
    FROM raw_emi_payments ep
    JOIN raw_loans l ON ep.loan_id = l.loan_id
    LEFT JOIN raw_borrowers b ON l.borrower_id = b.borrower_id
    LEFT JOIN raw_branches br ON l.branch_id = br.branch_id
  `);

  // funding_full: borrowings (alias for convenience)
  await run(`
    CREATE OR REPLACE VIEW funding_full AS
    SELECT * FROM raw_borrowings
  `);

  // branches_full: branches + employee counts
  await run(`
    CREATE OR REPLACE VIEW branches_full AS
    SELECT
      br.*,
      COALESCE(emp.active_employees, 0) AS active_employees,
      COALESCE(emp.total_ctc_lakh, 0) AS total_annual_ctc_lakh
    FROM raw_branches br
    LEFT JOIN (
      SELECT branch_id,
        COUNT(*) FILTER (WHERE is_active = true) AS active_employees,
        SUM(annual_ctc_lakh) FILTER (WHERE is_active = true) AS total_ctc_lakh
      FROM raw_employees
      GROUP BY branch_id
    ) emp ON br.branch_id = emp.branch_id
  `);

  console.log("  ✓ 4 denormalized views created (loans_full, collections_full, funding_full, branches_full)");

  // ═══════════════════════════════════════════════════════
  // STEP 3: SUMMARY TABLES
  // ═══════════════════════════════════════════════════════

  console.log("Step 3: Creating summary tables...");

  // --- OPERATIONS ---

  await run(`
    CREATE OR REPLACE TABLE monthly_disbursements AS
    SELECT
      CAST(strftime(disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      entity,
      product_type,
      COUNT(*) AS loan_count,
      SUM(disbursed_amount) AS total_amount,
      AVG(disbursed_amount) AS avg_ticket_size,
      AVG(interest_rate) AS avg_rate,
      AVG(ltv_ratio) AS avg_ltv
    FROM raw_loans
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `);
  console.log("  ✓ monthly_disbursements");

  await run(`
    CREATE OR REPLACE TABLE branch_monthly_kpis AS
    SELECT
      br.branch_id,
      br.branch_name,
      br.state,
      br.city,
      br.entity,
      CAST(strftime(l.disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*) AS disbursement_count,
      SUM(l.disbursed_amount) AS disbursement_amount,
      AVG(l.interest_rate) AS avg_rate,
      COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') AS active_loans,
      SUM(l.disbursed_amount) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') AS aum_proxy,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    JOIN raw_branches br ON l.branch_id = br.branch_id
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY 6, 1
  `);
  console.log("  ✓ branch_monthly_kpis");

  await run(`
    CREATE OR REPLACE TABLE state_monthly_kpis AS
    SELECT
      br.state,
      CAST(strftime(l.disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      l.entity,
      COUNT(DISTINCT br.branch_id) AS branches,
      COUNT(*) AS loans_disbursed,
      SUM(l.disbursed_amount) AS disbursement_amount,
      AVG(l.disbursed_amount) AS avg_ticket,
      AVG(l.interest_rate) AS avg_rate,
      AVG(l.ltv_ratio) AS avg_ltv,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    JOIN raw_branches br ON l.branch_id = br.branch_id
    GROUP BY 1, 2, 3
    ORDER BY 2, 1
  `);
  console.log("  ✓ state_monthly_kpis");

  // --- PORTFOLIO ---

  await run(`
    CREATE OR REPLACE TABLE product_performance AS
    SELECT
      entity,
      product_type,
      COUNT(*) AS total_loans,
      COUNT(*) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') AS active_loans,
      SUM(disbursed_amount) AS total_disbursed,
      SUM(disbursed_amount) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') AS aum,
      AVG(disbursed_amount) AS avg_ticket_size,
      AVG(interest_rate) AS avg_yield,
      AVG(ltv_ratio) AS avg_ltv,
      AVG(tenure_months) AS avg_tenure_months,
      COUNT(*) FILTER (WHERE stage = 3) AS stage_3_count,
      CASE WHEN COUNT(*) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') > 0
        THEN CAST(COUNT(*) FILTER (WHERE stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans
    GROUP BY 1, 2
    ORDER BY aum DESC
  `);
  console.log("  ✓ product_performance");

  await run(`
    CREATE OR REPLACE TABLE stage_distribution AS
    SELECT
      entity,
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
  console.log("  ✓ stage_distribution");

  // --- RISK ---

  await run(`
    CREATE OR REPLACE TABLE collection_efficiency AS
    SELECT
      CAST(strftime(due_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*) AS total_emis,
      COUNT(*) FILTER (WHERE amount_paid > 0) AS paid_emis,
      SUM(amount_due) AS total_due,
      SUM(amount_paid) AS total_collected,
      CASE WHEN SUM(amount_due) > 0
        THEN SUM(amount_paid) / SUM(amount_due) * 100
        ELSE 0 END AS collection_efficiency_pct,
      COUNT(*) FILTER (WHERE bounce = true) AS bounced_emis,
      CAST(COUNT(*) FILTER (WHERE bounce = true) AS DOUBLE) / COUNT(*) * 100 AS bounce_rate_pct,
      AVG(dpd_at_payment) AS avg_dpd
    FROM raw_emi_payments
    GROUP BY 1
    ORDER BY 1
  `);
  console.log("  ✓ collection_efficiency");

  await run(`
    CREATE OR REPLACE TABLE co_lending_performance AS
    SELECT
      l.co_lending_partner AS partner_id,
      c.partner_name,
      c.partner_type,
      c.product_focus,
      COUNT(*) AS total_loans,
      COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') AS active_loans,
      SUM(l.disbursed_amount) AS total_disbursed,
      SUM(l.disbursed_amount) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') AS aum,
      AVG(l.interest_rate) AS avg_yield,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    LEFT JOIN raw_co_lending_partners c ON l.co_lending_partner = c.partner_id
    WHERE l.entity = 'finserve' AND l.co_lending_partner != ''
    GROUP BY 1, 2, 3, 4
    ORDER BY aum DESC
  `);
  console.log("  ✓ co_lending_performance");

  // NPA movement (already a CSV, create as table)
  await run(`
    CREATE OR REPLACE TABLE npa_quarterly_movement AS
    SELECT * FROM raw_npa_movement
  `);
  console.log("  ✓ npa_quarterly_movement");

  // Provisions (already a CSV, create as table)
  await run(`
    CREATE OR REPLACE TABLE ecl_provisions AS
    SELECT * FROM raw_provisions
  `);
  console.log("  ✓ ecl_provisions");

  // --- FINANCIAL ---

  await run(`
    CREATE OR REPLACE TABLE funding_position AS
    SELECT
      source_type,
      COUNT(*) AS facility_count,
      SUM(sanctioned_amount_cr) AS total_sanctioned_cr,
      SUM(outstanding_amount_cr) AS total_outstanding_cr,
      AVG(interest_rate) AS weighted_avg_cost,
      MIN(interest_rate) AS min_rate,
      MAX(interest_rate) AS max_rate,
      COUNT(*) FILTER (WHERE is_fixed_rate = true) AS fixed_rate_count,
      COUNT(*) FILTER (WHERE is_fixed_rate = false) AS floating_rate_count
    FROM raw_borrowings
    GROUP BY 1
    ORDER BY total_outstanding_cr DESC
  `);
  console.log("  ✓ funding_position");

  await run(`
    CREATE OR REPLACE TABLE assignment_summary AS
    SELECT * FROM raw_assignments
  `);
  console.log("  ✓ assignment_summary");

  // --- SOURCING & CHANNEL ---

  await run(`
    CREATE OR REPLACE TABLE sourcing_channel_performance AS
    SELECT
      entity,
      sourcing_channel,
      COUNT(*) AS total_loans,
      SUM(disbursed_amount) AS total_disbursed,
      AVG(disbursed_amount) AS avg_ticket,
      AVG(interest_rate) AS avg_rate,
      COUNT(*) FILTER (WHERE stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') > 0
        THEN CAST(COUNT(*) FILTER (WHERE stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE loan_status = 'active' OR loan_status = 'npa') * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans
    GROUP BY 1, 2
    ORDER BY total_disbursed DESC
  `);
  console.log("  ✓ sourcing_channel_performance");

  // --- BORROWER PROFILE ---

  await run(`
    CREATE OR REPLACE TABLE borrower_profile_summary AS
    SELECT
      l.entity,
      b.employment_type,
      b.income_category,
      b.is_ntc,
      COUNT(*) AS loan_count,
      SUM(l.disbursed_amount) AS total_disbursed,
      AVG(l.disbursed_amount) AS avg_ticket,
      AVG(b.bureau_score) FILTER (WHERE b.bureau_score > 0) AS avg_cibil,
      AVG(l.ltv_ratio) AS avg_ltv,
      COUNT(*) FILTER (WHERE l.stage = 3) AS npa_count,
      CASE WHEN COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE l.loan_status = 'active' OR l.loan_status = 'npa') * 100
        ELSE 0 END AS gnpa_pct
    FROM raw_loans l
    JOIN raw_borrowers b ON l.borrower_id = b.borrower_id
    GROUP BY 1, 2, 3, 4
    ORDER BY total_disbursed DESC
  `);
  console.log("  ✓ borrower_profile_summary");

  // --- COMPANY KPIs ---

  await run(`
    CREATE OR REPLACE TABLE monthly_company_kpis AS
    SELECT
      CAST(strftime(l.disbursement_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      -- AUM proxy
      COUNT(*) AS total_loans_originated,
      SUM(l.disbursed_amount) AS total_disbursed,
      AVG(l.disbursed_amount) AS avg_ticket_size,
      -- Active book
      COUNT(*) FILTER (WHERE l.loan_status IN ('active', 'npa')) AS active_loans,
      SUM(l.disbursed_amount) FILTER (WHERE l.loan_status IN ('active', 'npa')) AS active_aum,
      -- Entity split
      SUM(l.disbursed_amount) FILTER (WHERE l.entity = 'hfc' AND l.loan_status IN ('active', 'npa')) AS hfc_aum,
      SUM(l.disbursed_amount) FILTER (WHERE l.entity = 'finserve' AND l.loan_status IN ('active', 'npa')) AS finserve_aum,
      -- Asset quality
      COUNT(*) FILTER (WHERE l.stage = 3) AS stage_3_count,
      CASE WHEN COUNT(*) FILTER (WHERE l.loan_status IN ('active', 'npa')) > 0
        THEN CAST(COUNT(*) FILTER (WHERE l.stage = 3) AS DOUBLE) / COUNT(*) FILTER (WHERE l.loan_status IN ('active', 'npa')) * 100
        ELSE 0 END AS gnpa_pct,
      -- Product mix
      CAST(COUNT(*) FILTER (WHERE l.product_type LIKE 'home%') AS DOUBLE) / NULLIF(COUNT(*), 0) * 100 AS home_loan_pct,
      -- Yield
      AVG(l.interest_rate) AS avg_yield,
      AVG(l.ltv_ratio) AS avg_ltv,
      -- Sourcing
      CAST(COUNT(*) FILTER (WHERE l.sourcing_channel = 'dsa') AS DOUBLE) / NULLIF(COUNT(*), 0) * 100 AS dsa_sourced_pct
    FROM raw_loans l
    GROUP BY 1
    ORDER BY 1
  `);
  console.log("  ✓ monthly_company_kpis");

  await run(`
    CREATE OR REPLACE TABLE quarterly_company_kpis AS
    SELECT
      CASE
        WHEN EXTRACT(MONTH FROM month) BETWEEN 4 AND 6 THEN 'Q1'
        WHEN EXTRACT(MONTH FROM month) BETWEEN 7 AND 9 THEN 'Q2'
        WHEN EXTRACT(MONTH FROM month) BETWEEN 10 AND 12 THEN 'Q3'
        ELSE 'Q4'
      END AS fy_quarter,
      CASE
        WHEN EXTRACT(MONTH FROM month) >= 4 THEN 'FY' || CAST((EXTRACT(YEAR FROM month) + 1) % 100 AS VARCHAR)
        ELSE 'FY' || CAST(EXTRACT(YEAR FROM month) % 100 AS VARCHAR)
      END AS fy,
      SUM(total_loans_originated) AS loans_originated,
      SUM(total_disbursed) AS total_disbursed,
      AVG(avg_yield) AS avg_yield,
      AVG(gnpa_pct) AS avg_gnpa_pct,
      AVG(home_loan_pct) AS avg_home_loan_pct,
      AVG(dsa_sourced_pct) AS avg_dsa_pct
    FROM monthly_company_kpis
    GROUP BY 1, 2
    ORDER BY fy, fy_quarter
  `);
  console.log("  ✓ quarterly_company_kpis");

  // --- COLLECTIONS SUMMARY (from EMI payments) ---

  await run(`
    CREATE OR REPLACE TABLE monthly_collections AS
    SELECT
      CAST(strftime(ep.due_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      l.entity,
      COUNT(*) AS total_emis,
      SUM(ep.amount_due) AS total_due,
      SUM(ep.amount_paid) AS total_collected,
      COUNT(*) FILTER (WHERE ep.bounce = true) AS bounced,
      CAST(COUNT(*) FILTER (WHERE ep.bounce = true) AS DOUBLE) / COUNT(*) * 100 AS bounce_rate,
      CASE WHEN SUM(ep.amount_due) > 0 THEN SUM(ep.amount_paid) / SUM(ep.amount_due) * 100 ELSE 0 END AS collection_efficiency,
      AVG(ep.dpd_at_payment) AS avg_dpd
    FROM raw_emi_payments ep
    JOIN raw_loans l ON ep.loan_id = l.loan_id
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  console.log("  ✓ monthly_collections");

  // --- EMPLOYEE SUMMARY ---

  await run(`
    CREATE OR REPLACE TABLE employee_summary AS
    SELECT
      br.entity,
      br.state,
      e.function_type,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE e.is_active = true) AS active,
      AVG(e.age) AS avg_age,
      AVG(e.annual_ctc_lakh) AS avg_ctc_lakh,
      CAST(COUNT(*) FILTER (WHERE e.gender = 'female') AS DOUBLE) / COUNT(*) * 100 AS female_pct
    FROM raw_employees e
    JOIN raw_branches br ON e.branch_id = br.branch_id
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `);
  console.log("  ✓ employee_summary");

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

  const loanCount = await query("SELECT COUNT(*) FROM raw_loans");
  const borrowerCount = await query("SELECT COUNT(*) FROM raw_borrowers");
  const emiCount = await query("SELECT COUNT(*) FROM raw_emi_payments");
  const branchCount = await query("SELECT COUNT(*) FROM raw_branches");
  const empCount = await query("SELECT COUNT(*) FROM raw_employees");

  console.log(`  Loans: ${Number(loanCount).toLocaleString()}`);
  console.log(`  Borrowers: ${Number(borrowerCount).toLocaleString()}`);
  console.log(`  EMI Payments: ${Number(emiCount).toLocaleString()}`);
  console.log(`  Branches: ${Number(branchCount).toLocaleString()}`);
  console.log(`  Employees: ${Number(empCount).toLocaleString()}`);

  // Checkpoint WAL to prevent replay bugs
  await run("CHECKPOINT");

  console.log(`\n✅ Database ready at: ${DB_PATH}`);
  console.log("   20 summary tables + 4 denormalized views created.\n");

  // conn does not need explicit close in @duckdb/node-api
}

main().catch(e => {
  console.error("Setup failed:", e);
  process.exit(1);
});
