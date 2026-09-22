/**
 * Cache invalidation hooks called by runTick after raw inserts and summary refresh.
 *
 * Invalidates the same in-memory caches that other parts of the app populate.
 * Each cache lives on globalThis under a documented symbol — we write to it
 * directly here to avoid a circular import between the metrics route and the
 * tick handler.
 */

interface CacheGlobal {
  __metrics_cache__?: Map<string, unknown>;
  __explorer_cache__?: Map<string, unknown>;
  __entity_catalog_cache__?: Map<string, unknown>;
}

const g = globalThis as CacheGlobal;

export type CacheKind = "metrics" | "explorer" | "entity-catalog";

export function invalidateCache(kind: CacheKind, datasetId: string): boolean {
  switch (kind) {
    case "metrics":
      return g.__metrics_cache__?.delete(datasetId) ?? false;
    case "explorer":
      return g.__explorer_cache__?.delete(datasetId) ?? false;
    case "entity-catalog":
      return g.__entity_catalog_cache__?.delete(datasetId) ?? false;
  }
}

export function invalidateCaches(kinds: CacheKind[], datasetId: string): Record<CacheKind, boolean> {
  const result = { metrics: false, explorer: false, "entity-catalog": false } as Record<CacheKind, boolean>;
  for (const k of kinds) result[k] = invalidateCache(k, datasetId);
  return result;
}
