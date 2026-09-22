/**
 * Reset a dataset's synthetic state to baseline.
 *
 * - TRUNCATEs every <table>__live table referenced by the plan.
 * - Resets synthetic_clock.current_now to baseline_now and clears tick history.
 * - Refreshes summary tables so they reflect the seed-only world again.
 * - Does NOT delete user-created entities (segments/funnels/scouts) — those
 *   reference SQL, so their counts will simply snap back to seed values.
 */

import { withConnection } from "../db";
import { resetClock } from "./clock";
import { ensureSyntheticInfrastructure, refreshSummaryTables } from "./infrastructure";
import { setNowCache } from "./now-cache";
import { getSyntheticPlan } from "./plans";
import { getDataset } from "../datasets";
import { invalidateCaches } from "./invalidate";

export interface ResetResult {
  datasetId: string;
  tablesTruncated: { table: string; rowsBefore: number }[];
  summaryRefreshMs: number;
  ok: true;
}

export async function resetSyntheticState(datasetId: string): Promise<ResetResult> {
  const plan = getSyntheticPlan(datasetId);
  if (!plan) throw new Error(`No synthetic plan for ${datasetId}`);

  const result = await withConnection(datasetId, async (conn) => {
    // Reset assumes infrastructure exists; tick path is the canonical setup.
    // If reset is the very first call (no prior tick), ensureClock + infra
    // bootstrap here.
    const { ensureClock } = await import("./clock");
    await ensureClock(datasetId, conn);
    await ensureSyntheticInfrastructure(datasetId, conn);

    // Discover ALL __live tables (including derived ones not in plan.tables).
    const r = await conn.run(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'main'
        AND table_type = 'BASE TABLE'
        AND table_name LIKE '%\\_\\_live' ESCAPE '\\'
    `);
    const liveTables = (await r.getRows()).map((row) => String(row[0]));
    const tablesTruncated: { table: string; rowsBefore: number }[] = [];

    for (const table of liveTables) {
      const cr = await conn.run(`SELECT COUNT(*) FROM ${table}`);
      const rowsBefore = Number((await cr.getRows())[0][0]);
      await conn.run(`DELETE FROM ${table}`);
      tablesTruncated.push({ table, rowsBefore });
    }
    void plan;

    await resetClock(conn);

    const summaryStart = Date.now();
    await refreshSummaryTables(datasetId, conn);
    const summaryRefreshMs = Date.now() - summaryStart;

    await conn.run("CHECKPOINT");

    return { tablesTruncated, summaryRefreshMs };
  });

  // Reset prompt cache and invalidate consumer caches.
  const ds = getDataset(datasetId);
  const seedEnd = ds.dateRange?.end ?? "2026-02-28";
  setNowCache(datasetId, new Date(`${seedEnd}T23:59:59Z`));
  invalidateCaches(["metrics", "explorer", "entity-catalog"], datasetId);

  return { datasetId, ...result, ok: true };
}
