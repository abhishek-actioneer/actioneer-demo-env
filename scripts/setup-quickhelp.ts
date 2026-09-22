/**
 * Setup script for Quick Help dataset v2.
 * Creates quickhelp.duckdb with denormalized views + summary tables.
 *
 * View and summary table definitions are imported from the dataset config
 * (src/lib/datasets/quickhelp.ts) — single source of truth.
 *
 * Prereq: CSV files must exist in data/csv/ (run generate-quickhelp-v2.ts first)
 *
 * Usage: npx tsx scripts/setup-quickhelp.ts
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { resolve } from "path";
import { existsSync, unlinkSync } from "fs";
import { quickhelpDataset } from "../src/lib/datasets/quickhelp";

const DB_PATH = resolve(__dirname, "../data/quickhelp.duckdb");
const WAL_PATH = DB_PATH + ".wal";
const DATA_DIR = resolve(__dirname, "../data");
const CSV_DIR = resolve(DATA_DIR, "csv");

async function main() {
  // Verify CSV files exist
  const required = [
    "bookings.csv", "customers.csv", "campaigns_v2.csv", "partner_shifts.csv",
    "journeys.csv", "comms_sends.csv",
    "ad_campaigns.csv", "ad_sets.csv", "ad_creatives.csv", "ad_daily_metrics.csv",
    "install_attribution.csv",
    "booking_unit_economics.csv", "partner_payouts.csv",
    "funnel_events.csv", "daily_sessions.csv", "referrals.csv", "survey_responses.csv",
  ];
  for (const f of required) {
    if (!existsSync(resolve(CSV_DIR, f))) {
      console.error(`Missing ${f}! Run 'npx tsx scripts/generate-quickhelp-v2.ts' first.`);
      process.exit(1);
    }
  }

  // Delete old DB to avoid stale tables
  if (existsSync(DB_PATH)) { unlinkSync(DB_PATH); console.log("Removed old quickhelp.duckdb"); }
  if (existsSync(WAL_PATH)) { unlinkSync(WAL_PATH); console.log("Removed old WAL file"); }

  console.log("Creating DuckDB database at:", DB_PATH);
  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();

  // ═══════════════════════════════════════
  // VIEWS — from dataset config (single source of truth)
  // ═══════════════════════════════════════

  const viewStatements = quickhelpDataset.viewSQL!(DATA_DIR);
  console.log(`\n1. Creating ${viewStatements.length} views...`);
  for (const sql of viewStatements) {
    await conn.run(sql);
  }
  console.log(`  → ${viewStatements.length} views created`);

  // Verify primary table
  const bookingCount = await conn.run("SELECT COUNT(*) FROM bookings");
  const bookingRows = await bookingCount.getRows();
  console.log(`  → bookings: ${bookingRows[0][0]?.toLocaleString()} rows`);

  // ═══════════════════════════════════════
  // SUMMARY TABLES — from dataset config (single source of truth)
  // ═══════════════════════════════════════

  const summaryStatements = quickhelpDataset.summaryTableSQL!;
  console.log(`\n2. Creating ${summaryStatements.length} summary tables...`);
  let tableIdx = 0;
  for (const sql of summaryStatements) {
    tableIdx++;
    const match = sql.match(/CREATE\s+OR\s+REPLACE\s+TABLE\s+(\w+)/i);
    const tableName = match ? match[1] : `table_${tableIdx}`;
    process.stdout.write(`  ${tableIdx}. ${tableName}...`);
    await conn.run(sql);
    const countResult = await conn.run(`SELECT COUNT(*) FROM ${tableName}`);
    const countRows = await countResult.getRows();
    console.log(` ${countRows[0][0]?.toLocaleString()} rows`);
  }

  // ═══════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════

  console.log("\n── Dataset Summary ──");
  const summary = await conn.run(`
    SELECT
      COUNT(*) AS total_bookings,
      COUNT(DISTINCT customer_id) AS unique_customers,
      SUM(CASE WHEN payment_status = 'success' THEN booking_value ELSE 0 END)::DECIMAL(12,2) AS total_revenue,
      AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END) * 100 AS overall_on_time_pct,
      MIN(booking_date) AS earliest,
      MAX(booking_date) AS latest
    FROM bookings
  `);
  const summaryRows = await summary.getRows();
  console.log("  Bookings:", summaryRows[0][0]?.toLocaleString());
  console.log("  Customers:", summaryRows[0][1]?.toLocaleString());
  console.log("  Revenue: ₹" + summaryRows[0][2]);
  console.log("  On-time %:", Number(summaryRows[0][3]).toFixed(1) + "%");
  console.log("  Date range:", summaryRows[0][4], "to", summaryRows[0][5]);

  console.log("\nSetup complete! Database ready at:", DB_PATH);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
