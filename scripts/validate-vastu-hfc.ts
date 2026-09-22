/**
 * Validates the Vastu HFC DuckDB against calibration targets.
 *
 * Checks: AUM, GNPA, active loans, product mix, employment mix, LTV, CIBIL,
 * funding mix, geographic concentration, branch count, employee count.
 *
 * Usage: npx tsx scripts/validate-vastu-hfc.ts
 */

import { existsSync } from "fs";
import { resolve } from "path";

const DB_PATH = resolve(__dirname, "../data/vastu-hfc.duckdb");

if (!existsSync(DB_PATH)) {
  console.error("❌ Database not found. Run setup-vastu-hfc.ts first.");
  process.exit(1);
}

interface Check {
  name: string;
  sql: string;
  target: number;
  tolerance: number; // fraction (0.05 = 5%)
  unit: string;
}

const CHECKS: Check[] = [
  // AUM
  {
    name: "HFC AUM (₹ Cr)",
    sql: `SELECT SUM(disbursed_amount) / 10000000.0 FROM raw_loans WHERE entity = 'hfc' AND loan_status IN ('active', 'npa')`,
    target: 9102, tolerance: 0.10, unit: "Cr",
  },
  {
    name: "Finserve AUM (₹ Cr)",
    sql: `SELECT SUM(disbursed_amount) / 10000000.0 FROM raw_loans WHERE entity = 'finserve' AND loan_status IN ('active', 'npa')`,
    target: 2435, tolerance: 0.15, unit: "Cr",
  },
  // Active loans
  {
    name: "HFC Active Loans",
    sql: `SELECT COUNT(*) FROM raw_loans WHERE entity = 'hfc' AND loan_status IN ('active', 'npa')`,
    target: 79249, tolerance: 0.10, unit: "",
  },
  {
    name: "Finserve Active Loans",
    sql: `SELECT COUNT(*) FROM raw_loans WHERE entity = 'finserve' AND loan_status IN ('active', 'npa')`,
    target: 64869, tolerance: 0.15, unit: "",
  },
  // GNPA
  {
    name: "HFC GNPA %",
    sql: `SELECT CAST(COUNT(*) FILTER (WHERE stage = 3) AS DOUBLE) / COUNT(*) * 100 FROM raw_loans WHERE entity = 'hfc' AND loan_status IN ('active', 'npa')`,
    target: 1.31, tolerance: 0.50, unit: "%",
  },
  {
    name: "Finserve GNPA %",
    sql: `SELECT CAST(COUNT(*) FILTER (WHERE stage = 3) AS DOUBLE) / COUNT(*) * 100 FROM raw_loans WHERE entity = 'finserve' AND loan_status IN ('active', 'npa')`,
    target: 2.23, tolerance: 0.30, unit: "%",
  },
  // Product mix
  {
    name: "Home Loan % of HFC AUM",
    sql: `SELECT SUM(CASE WHEN product_type IN ('home_purchase','home_construction','home_improvement','micro_housing') THEN disbursed_amount ELSE 0 END) * 100.0 / SUM(disbursed_amount) FROM raw_loans WHERE entity = 'hfc'`,
    target: 77, tolerance: 0.10, unit: "%",
  },
  // Employment
  {
    name: "Self-Employed % of Borrowers",
    sql: `SELECT CAST(COUNT(*) FILTER (WHERE employment_type LIKE 'self_employed%') AS DOUBLE) / COUNT(*) * 100 FROM raw_borrowers`,
    target: 81, tolerance: 0.05, unit: "%",
  },
  // LTV
  {
    name: "Median LTV (HFC)",
    sql: `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ltv_ratio) FROM raw_loans WHERE entity = 'hfc'`,
    target: 0.45, tolerance: 0.15, unit: "",
  },
  // CIBIL
  {
    name: "Median CIBIL (credit-tested)",
    sql: `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY bureau_score) FROM raw_borrowers WHERE bureau_score > 0`,
    target: 742, tolerance: 0.03, unit: "",
  },
  // Branches
  {
    name: "Total Branches",
    sql: `SELECT COUNT(*) FROM raw_branches`,
    target: 226, tolerance: 0.20, unit: "",
  },
  // Employees
  {
    name: "Total Employees",
    sql: `SELECT COUNT(*) FROM raw_employees`,
    target: 5523, tolerance: 0.20, unit: "",
  },
  // Geographic concentration
  {
    name: "Max State AUM Share %",
    sql: `SELECT MAX(state_share) FROM (SELECT state, SUM(disbursed_amount) * 100.0 / (SELECT SUM(disbursed_amount) FROM loans_full WHERE loan_status IN ('active','npa')) AS state_share FROM loans_full WHERE loan_status IN ('active','npa') GROUP BY state)`,
    target: 15, tolerance: 0.30, unit: "% (should be ≤15%)",
  },
  // Funding mix
  {
    name: "Bank Funding %",
    sql: `SELECT SUM(outstanding_amount_cr) FILTER (WHERE source_type = 'bank') * 100.0 / SUM(outstanding_amount_cr) FROM raw_borrowings`,
    target: 50, tolerance: 0.20, unit: "%",
  },
  {
    name: "NHB Funding %",
    sql: `SELECT SUM(outstanding_amount_cr) FILTER (WHERE source_type = 'nhb') * 100.0 / SUM(outstanding_amount_cr) FROM raw_borrowings`,
    target: 31, tolerance: 0.20, unit: "%",
  },
];

async function main() {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();

  console.log("\n🔍 Validating Vastu HFC dataset against calibration targets...\n");

  let passed = 0;
  let failed = 0;
  let warned = 0;

  for (const check of CHECKS) {
    try {
      const reader = await conn.runAndReadAll(check.sql);
      const rows = reader.getRows();
      const actual = Number(rows[0]?.[0] ?? 0);

      const diff = Math.abs(actual - check.target) / Math.abs(check.target || 1);
      const pct = (diff * 100).toFixed(1);

      if (diff <= check.tolerance) {
        console.log(`  ✅ ${check.name}: ${actual.toFixed(2)} ${check.unit} (target: ${check.target}, diff: ${pct}%)`);
        passed++;
      } else if (diff <= check.tolerance * 1.5) {
        console.log(`  ⚠️  ${check.name}: ${actual.toFixed(2)} ${check.unit} (target: ${check.target}, diff: ${pct}% — within soft tolerance)`);
        warned++;
      } else {
        console.log(`  ❌ ${check.name}: ${actual.toFixed(2)} ${check.unit} (target: ${check.target}, diff: ${pct}% — EXCEEDS tolerance of ${(check.tolerance * 100).toFixed(0)}%)`);
        failed++;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ❌ ${check.name}: SQL ERROR — ${msg}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${warned} warnings, ${failed} failed out of ${CHECKS.length} checks\n`);

  if (failed > 0) {
    console.log("⚠️  Some calibration targets were not met. Consider adjusting generator parameters.\n");
  } else {
    console.log("✅ All calibration targets within tolerance. Dataset is ready for demo.\n");
  }
}

main().catch(e => {
  console.error("Validation failed:", e);
  process.exit(1);
});
