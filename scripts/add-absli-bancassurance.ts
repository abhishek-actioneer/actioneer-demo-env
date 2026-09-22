/**
 * Non-destructive add of the bancassurance cross-sell pool to the existing
 * ABSLI database. The original setup CSVs are no longer on disk, so this opens
 * data/absli-life.duckdb in place, builds bancassurance_leads +
 * bancassurance_summary, checkpoints, and closes.
 *
 * Usage: npx tsx scripts/add-absli-bancassurance.ts
 */

import { existsSync } from "fs";
import { resolveRepoDataPath } from "../src/lib/data-dir";
import { buildBancassurance } from "./absli-bancassurance-sql";

// Resolve the db the same way the app does: honors SENTINEL_DATA_DIR (the
// Railway volume mount in prod), falling back to <cwd>/data locally. This is
// what makes the migration target the real volume file, not the ephemeral repo.
const DB_PATH = resolveRepoDataPath("data/absli-life.duckdb");

async function main() {
  console.log(`Target db: ${DB_PATH}`);
  if (!existsSync(DB_PATH)) {
    console.error(`Database not found at ${DB_PATH}. Check SENTINEL_DATA_DIR points at the volume.`);
    process.exit(1);
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
      throw e;
    }
  };

  const count = async (t: string): Promise<number> => {
    const r = await conn.runAndReadAll(`SELECT COUNT(*) FROM ${t}`);
    return Number(r.getRows()[0]?.[0] ?? 0);
  };

  await run("SET memory_limit = '6GB'");
  await run("SET threads = 4");

  console.log("\nBuilding bancassurance cross-sell pool...\n");
  await buildBancassurance(run);

  console.log("\nCheckpointing...");
  await run("CHECKPOINT", "WAL flushed to main file");

  console.log("\nVerification:");
  for (const t of ["bancassurance_leads", "bancassurance_summary"]) {
    console.log(`  ${t}: ${(await count(t)).toLocaleString()}`);
  }
  // Sanity: prospects must never overlap existing policyholders (no name collision on ids)
  const overlap = await conn.runAndReadAll(
    `SELECT COUNT(*) FROM bancassurance_leads b JOIN raw_policyholders p ON b.bank_lead_id = p.policyholder_id`
  );
  console.log(`  id overlap with policyholders: ${Number(overlap.getRows()[0]?.[0] ?? 0)} (must be 0)`);

  conn.disconnectSync?.();
  instance.closeSync?.();
  console.log("\nDone. bancassurance_leads added to data/absli-life.duckdb");
}

main().catch((e) => { console.error(e); process.exit(1); });
