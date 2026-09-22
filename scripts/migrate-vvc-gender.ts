/**
 * Migration: add gender detection columns to voice_verification_calls.
 *
 * Run ONLY when the dev server is stopped (DuckDB needs exclusive lock).
 *   pkill -f "next dev" && npx tsx scripts/migrate-vvc-gender.ts
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { join } from "path";

const DB_PATH = join(process.cwd(), "data/datasets/hdfc-creditfraud/hdfc-creditfraud.duckdb");

async function run() {
  console.log("Connecting to", DB_PATH);
  const inst = await DuckDBInstance.create(DB_PATH);
  const conn = await inst.connect();

  const migrations = [
    "ALTER TABLE voice_verification_calls ADD COLUMN IF NOT EXISTS detected_gender VARCHAR",
    "ALTER TABLE voice_verification_calls ADD COLUMN IF NOT EXISTS gender_confidence DOUBLE",
    "ALTER TABLE voice_verification_calls ADD COLUMN IF NOT EXISTS gender_mismatch BOOLEAN",
    "ALTER TABLE voice_verification_calls ADD COLUMN IF NOT EXISTS gender_signals VARCHAR",
  ];

  for (const sql of migrations) {
    try {
      await conn.run(sql);
      console.log("OK:", sql.replace("ALTER TABLE voice_verification_calls ADD COLUMN IF NOT EXISTS ", ""));
    } catch (err) {
      console.error("FAILED:", sql, "\n", err);
    }
  }

  // Verify schema
  const result = await conn.run("DESCRIBE voice_verification_calls");
  const cols = Array.from(result.columnNames()).map(String);
  const rows = await result.getRows();
  console.log("\nFinal schema:");
  rows.forEach(r => {
    const name = String(r[cols.indexOf("column_name")] ?? r[0]);
    const type = String(r[cols.indexOf("column_type")] ?? r[1]);
    const isNew = ["detected_gender", "gender_confidence", "gender_mismatch", "gender_signals"].includes(name);
    console.log(` ${isNew ? "+" : " "} ${name}: ${type}`);
  });

  await conn.close();
  await inst.close();
  console.log("\nDone.");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
