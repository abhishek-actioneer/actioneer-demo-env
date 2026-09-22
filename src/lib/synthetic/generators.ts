/**
 * Column-level row generators. Each generator produces one cell value given
 * an RNG, the current row index, and the tick window. Pure functions so that
 * (seed, plan) → identical row sequence.
 */

import type { ColumnGenerator } from "./types";
import type { Rng } from "./rng";

export interface GenContext {
  rng: Rng;
  /** Synthetic timestamp for this row, sampled within tick window. */
  rowTimestamp: Date;
  /** Row index within the current tick. */
  rowIndex: number;
  /** id-space starting integer for sequential ids. */
  idStart: number;
}

export function generateValue(gen: ColumnGenerator, ctx: GenContext): unknown {
  switch (gen.kind) {
    case "constant":
      return gen.value;
    case "sequentialId":
      return `${gen.prefix ?? ""}${gen.startAt + ctx.rowIndex}`;
    case "tickWindow":
      if (gen.granularity === "date") return formatDate(ctx.rowTimestamp);
      if (gen.granularity === "time") return formatTime(ctx.rowTimestamp);
      return formatTimestamp(ctx.rowTimestamp);
    case "weightedChoice":
      return ctx.rng.weighted(gen.choices);
    case "uniformInt":
      return ctx.rng.int(gen.min, gen.max);
    case "uniformFloat":
      return ctx.rng.float(gen.min, gen.max, gen.precision ?? 2);
    case "boolean":
      return ctx.rng.bool(gen.trueProbability);
    case "computed":
      // Reserved for v2 — small expression evaluator (e.g. "channel === 'facebook'").
      throw new Error("computed generator not yet implemented");
  }
}

/** Sample N timestamps uniformly within [windowStart, windowEnd). */
export function sampleTimestamps(
  rng: Rng,
  count: number,
  windowStart: Date,
  windowEnd: Date,
): Date[] {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const span = endMs - startMs;
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    out.push(new Date(startMs + Math.floor(rng.next() * span)));
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatTimestamp(d: Date): string {
  return `${formatDate(d)} ${formatTime(d)}`;
}

/** Build the SQL literal for a value. Returns NULL for null/undefined. */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  // String — escape single quotes
  return `'${String(v).replace(/'/g, "''")}'`;
}
