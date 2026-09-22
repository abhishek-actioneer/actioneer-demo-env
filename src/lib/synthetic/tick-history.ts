/**
 * In-memory ring buffer of recent tick results, keyed by datasetId.
 * Used by the admin tick-history panel for at-a-glance ops visibility.
 *
 * Storage on globalThis so it survives Next.js HMR. Lost on server restart —
 * acceptable, as the synthetic_clock + last_deltas in DuckDB is the durable
 * record.
 */

import type { TickResult } from "./types";

const SYMBOL = Symbol.for("baby-sentinel.synthetic.tick-history");
const MAX_PER_DATASET = 30;

interface HistoryGlobal {
  [k: symbol]: Map<string, TickResult[]> | undefined;
}

const g = globalThis as HistoryGlobal;
if (!g[SYMBOL]) g[SYMBOL] = new Map();
const history = g[SYMBOL] as Map<string, TickResult[]>;

export function recordTickResult(result: TickResult): void {
  const buf = history.get(result.datasetId) ?? [];
  buf.unshift(result);
  if (buf.length > MAX_PER_DATASET) buf.length = MAX_PER_DATASET;
  history.set(result.datasetId, buf);
}

export function getTickHistory(datasetId: string): TickResult[] {
  return history.get(datasetId) ?? [];
}
