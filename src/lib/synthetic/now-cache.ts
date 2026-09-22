/**
 * Synchronous "now" cache for prompt substitution.
 *
 * getSystemContext / getSchemaContext are called synchronously from many places
 * (LLM prompt builders, route handlers). Reading the synthetic clock is async.
 * We cache the latest known "now" per dataset on globalThis, refresh it
 * lazily, and let the tick handler push a fresh value after each tick.
 *
 * Cache miss falls back to the dataset's seed end date — the LLM stays
 * anchored to the seed end-of-data until the first clock read populates the
 * cache. This is the right failure mode (no broken queries, just slightly
 * stale "now").
 */

import { getDataset } from "../datasets";

interface CacheGlobal {
  __synthetic_now_cache__?: Map<string, Date>;
}

const g = globalThis as CacheGlobal;
if (!g.__synthetic_now_cache__) g.__synthetic_now_cache__ = new Map();
const cache = g.__synthetic_now_cache__;

export function setNowCache(datasetId: string, now: Date): void {
  cache.set(datasetId, now);
}

export function getNowCache(datasetId: string): Date {
  const cached = cache.get(datasetId);
  if (cached) return cached;
  // Fallback: dataset seed end-date.
  try {
    const ds = getDataset(datasetId);
    const seedEnd = ds.dateRange?.end ?? "2026-02-28";
    const fallback = new Date(`${seedEnd}T23:59:59Z`);
    cache.set(datasetId, fallback);
    return fallback;
  } catch {
    return new Date();
  }
}

/**
 * Substitute {{DATASET_NOW}} and {{DATASET_NOW_MONTH_YEAR}} placeholders in a string.
 * Returns the original string if no placeholders match.
 */
export function substituteNowPlaceholders(text: string, datasetId: string): string {
  if (!text.includes("{{DATASET_NOW")) return text;
  const now = getNowCache(datasetId);
  const dateOnly = formatDateOnly(now);
  const monthYear = formatMonthYear(now);
  return text
    .replaceAll("{{DATASET_NOW_MONTH_YEAR}}", monthYear)
    .replaceAll("{{DATASET_NOW}}", dateOnly);
}

function formatDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonthYear(d: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
