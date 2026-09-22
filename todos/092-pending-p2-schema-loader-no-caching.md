---
status: pending
priority: p2
issue_id: "092"
tags: [code-review, performance, schema-loader, pr-41]
dependencies: []
---

# `loadSchemaMap()` reads from disk synchronously on every API request — no caching

## Problem Statement

`src/lib/datasets/schema-loader.ts` calls `existsSync()` + `readFileSync()` on every invocation:

```ts
if (existsSync(schemaMapPath)) {
  return JSON.parse(readFileSync(schemaMapPath, "utf-8")) as SchemaMap;
}
```

Both calls are **synchronous**, blocking the Node.js event loop until the filesystem operation completes. The three routes that call `loadSchemaMap` (`segments/generate-all`, `knowledge/generate`, `metrics/generate`) each pay this cost on every request. On a networked filesystem (Railway) this can be 20–100ms per call and blocks all other async work.

The schema file is written once during dataset enrichment and never mutated during normal operation — it is a perfect candidate for module-level caching.

## Findings

Source: Performance Oracle agent review.

- `src/lib/datasets/schema-loader.ts` lines 16–18: synchronous `existsSync` + `readFileSync`
- Called by 3 hot API routes — every generation request pays this cost
- No cache invalidation needed: file is only written during enrichment, not during generation

## Proposed Solutions

**Option A (Recommended): Add a module-level Map cache**
```ts
const cache = new Map<string, SchemaMap>();

export function loadSchemaMap(datasetId: string): SchemaMap | null {
  if (cache.has(datasetId)) return cache.get(datasetId)!;
  // ... existing logic ...
  if (existsSync(schemaMapPath)) {
    const result = JSON.parse(readFileSync(schemaMapPath, "utf-8")) as SchemaMap;
    cache.set(datasetId, result);
    return result;
  }
  // ...
}
```
- Effort: Trivial | Risk: None (schema files don't change during generation)

**Option B: Switch to `fs.promises.readFile` (async)**
- Non-blocking, but still reads on every request
- Effort: Small | Risk: Low (requires callers to await)

**Option C: Cache + invalidation on enrichment**
- Export `invalidateSchemaCache(datasetId)` and call it from the enrich route
- Effort: Small | Risk: None

## Recommended Action

Option C — cache + invalidation export so the enrichment route can bust the cache when a new schema is written.

## Technical Details

- **Affected file:** `src/lib/datasets/schema-loader.ts`
- The enrichment route that writes `schema-map.json` should call `invalidateSchemaCache(datasetId)` after writing

## Acceptance Criteria

- [ ] Second call to `loadSchemaMap(datasetId)` within the same server process returns cached result without disk read
- [ ] Enrichment route invalidates cache after writing new schema-map.json
- [ ] No synchronous filesystem call on hot generation endpoints

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (performance-oracle agent) | Schema files are write-once per enrichment — safe to cache indefinitely |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
