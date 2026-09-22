/**
 * Synthetic clock — single source of truth for "what time does this dataset think it is."
 *
 * Stored in a per-dataset `synthetic_clock` table inside each dataset's .duckdb file.
 * One row per dataset. Read by:
 *   - LLM prompt builders (substitute {{DATASET_NOW}})
 *   - UI freshness pill (last tick, current now)
 *   - Synthesis row generators (timestamp window for new rows)
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import { withConnection } from "../db";
import { getDataset } from "../datasets";
import type { SyntheticClockState } from "./types";

/** Idempotent: creates the synthetic_clock table and seeds it from dataset.dateRange.end if empty. */
export async function ensureClock(datasetId: string, conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS synthetic_clock (
      baseline_now TIMESTAMP NOT NULL,
      current_now  TIMESTAMP NOT NULL,
      last_tick_attempted_at TIMESTAMP,
      last_tick_succeeded_at TIMESTAMP,
      tick_count INTEGER NOT NULL,
      status VARCHAR NOT NULL,
      last_deltas VARCHAR
    )
  `);
  // Migrate older deployments that lack last_deltas
  await conn.run(`ALTER TABLE synthetic_clock ADD COLUMN IF NOT EXISTS last_deltas VARCHAR`);

  const r = await conn.run("SELECT COUNT(*) FROM synthetic_clock");
  const rows = await r.getRows();
  if (Number(rows[0][0]) > 0) return;

  const ds = getDataset(datasetId);
  const seedEnd = ds.dateRange?.end ?? "2026-02-28";
  // Seed end is a date — anchor to end-of-day so the first tick generates rows
  // for the day after seed end (no overlap with seed).
  await conn.run(
    `INSERT INTO synthetic_clock VALUES ('${seedEnd} 23:59:59', '${seedEnd} 23:59:59', NULL, NULL, 0, 'ok', NULL)`
  );
}

export async function readClock(datasetId: string): Promise<SyntheticClockState> {
  return withConnection(datasetId, async (conn) => {
    await ensureClock(datasetId, conn);
    const r = await conn.run(`
      SELECT baseline_now, current_now, last_tick_attempted_at, last_tick_succeeded_at,
             tick_count, status, last_deltas
      FROM synthetic_clock
    `);
    const rows = await r.getRows();
    const row = rows[0];
    let deltas: Record<string, number> | null = null;
    if (row[6] != null) {
      try {
        deltas = JSON.parse(String(row[6]));
      } catch {
        deltas = null;
      }
    }
    return {
      baselineNow: toDate(row[0]),
      currentNow: toDate(row[1]),
      lastTickAttemptedAt: row[2] == null ? null : toDate(row[2]),
      lastTickSucceededAt: row[3] == null ? null : toDate(row[3]),
      tickCount: Number(row[4]),
      status: String(row[5]) as SyntheticClockState["status"],
      lastDeltas: deltas,
    };
  });
}

/** Returns current synthetic-now as ISO string for prompt/UI substitution. */
export async function getDatasetNow(datasetId: string): Promise<Date> {
  const state = await readClock(datasetId);
  return state.currentNow;
}

/** Format a date as "YYYY-MM-DD". Used for {{DATASET_NOW}} substitution in prompts. */
export function formatDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format a date as "Mon YYYY" for human-friendly date range labels. */
export function formatMonthYear(d: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Advance the synthetic clock forward by N hours. Caller must hold the connection. */
export async function advanceClock(
  conn: DuckDBConnection,
  hours: number,
  attemptedAt: Date,
  succeededAt: Date | null,
  deltas?: Record<string, number>,
): Promise<void> {
  const succeededFrag = succeededAt
    ? `'${succeededAt.toISOString().slice(0, 19).replace("T", " ")}'`
    : "NULL";
  const deltasFrag = deltas ? `'${JSON.stringify(deltas).replace(/'/g, "''")}'` : "NULL";
  await conn.run(`
    UPDATE synthetic_clock
    SET current_now = current_now + INTERVAL ${hours} HOUR,
        last_tick_attempted_at = '${attemptedAt.toISOString().slice(0, 19).replace("T", " ")}',
        last_tick_succeeded_at = ${succeededFrag},
        tick_count = tick_count + ${succeededAt ? 1 : 0},
        status = 'ok',
        last_deltas = ${deltasFrag}
  `);
}

/** Mark a tick attempt as failed without advancing the clock. */
export async function recordTickFailure(
  conn: DuckDBConnection,
  attemptedAt: Date,
): Promise<void> {
  await conn.run(`
    UPDATE synthetic_clock
    SET last_tick_attempted_at = '${attemptedAt.toISOString().slice(0, 19).replace("T", " ")}',
        status = 'error'
  `);
}

/** Reset to baseline. Caller is responsible for TRUNCATE-ing __live tables. */
export async function resetClock(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    UPDATE synthetic_clock
    SET current_now = baseline_now,
        last_tick_attempted_at = NULL,
        last_tick_succeeded_at = NULL,
        tick_count = 0,
        status = 'ok'
  `);
}

function toDate(v: unknown): Date {
  // DuckDB returns timestamps as either Date or {micros: bigint}-shaped object depending on driver version.
  if (v instanceof Date) return v;
  if (typeof v === "string") return new Date(v.replace(" ", "T") + "Z");
  if (typeof v === "object" && v !== null && "micros" in (v as object)) {
    const micros = (v as { micros: bigint }).micros;
    return new Date(Number(micros / BigInt(1000)));
  }
  return new Date(String(v));
}
