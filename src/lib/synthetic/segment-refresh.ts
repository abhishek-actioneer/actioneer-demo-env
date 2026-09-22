/**
 * Re-run every saved segment's SQL after a tick and update its `user_count`.
 *
 * Why: without this, the count displayed on segment cards stays frozen at
 * save-time even though the underlying data drifts. The whole point of live
 * data is that segments move — this is the wire that makes that visible.
 *
 * Strategy:
 *   - Read all segments for the dataset across ALL users (segments are stored
 *     per-user in SQLite; for sample datasets we recompute everyone's counts).
 *   - Run each segment's SQL with a small wrapper: `SELECT COUNT(*) FROM (...)`
 *     so we get just the count without materializing the user list.
 *   - Catch and log per-segment errors — one bad segment shouldn't block the
 *     tick. The tick has already committed at this point; this is best-effort.
 *   - Update count via a direct UPDATE statement (bypasses upsert to avoid
 *     overwriting other fields).
 */

import { getDb } from "@/lib/meta-db";
import { executeSQLInternal } from "@/lib/sql-executor";

interface SegmentRefreshResult {
  refreshed: number;
  failed: { id: string; error: string }[];
  durationMs: number;
}

export async function refreshAllSegmentCounts(datasetId: string): Promise<SegmentRefreshResult> {
  const start = Date.now();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, sql FROM segments WHERE dataset_id = ? OR dataset_id IS NULL`,
    )
    .all(datasetId) as { id: string; sql: string }[];

  const failed: { id: string; error: string }[] = [];
  const updateStmt = db.prepare(
    `UPDATE segments SET user_count = ?, updated_at = ? WHERE id = ?`,
  );

  for (const row of rows) {
    try {
      const wrapped = `SELECT COUNT(*) AS n FROM (${row.sql.trim().replace(/;+\s*$/, "")}) sub`;
      const result = await executeSQLInternal(wrapped, datasetId);
      if (result.error) throw new Error(result.error);
      const firstRow = result.rows?.[0] as Record<string, unknown> | undefined;
      const cell = firstRow?.n ?? firstRow?.["count(*)"] ?? Object.values(firstRow ?? {})[0] ?? 0;
      const count = Number(cell);
      if (!Number.isFinite(count)) throw new Error(`non-numeric count: ${String(cell)}`);
      updateStmt.run(count, new Date().toISOString(), row.id);
    } catch (err) {
      failed.push({
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    refreshed: rows.length - failed.length,
    failed,
    durationMs: Date.now() - start,
  };
}
