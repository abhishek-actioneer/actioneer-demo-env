---
status: pending
priority: p2
issue_id: "016"
tags: [code-review, correctness, duckdb, db]
dependencies: []
---

# getOrCreateInstance stores resolved value instead of Promise — async race window

## Problem Statement

`getOrCreateInstance` in `db.ts` stores the resolved `DuckDBInstance` value in
the `instances` map, not the `Promise<DuckDBInstance>`. The `await` on line 64
is a cooperative yield point. If two async callers race to call
`getOrCreateInstance` for the same `dbPath` before either has stored the result,
both pass the `if (!instance)` guard and both call
`instanceCache.getOrCreateInstance`:

```typescript
// db.ts:61-70 — CURRENT (has race)
export async function getOrCreateInstance(dbPath: string): Promise<DuckDBInstance> {
  let instance = instances.get(dbPath);
  if (!instance) {
    // ← YIELD POINT: event loop resumes second caller here before instances.set()
    instance = await instanceCache.getOrCreateInstance(dbPath, { ... });
    instances.set(dbPath, instance);  // second caller overwrites first
  }
  return instance;
}
```

The result: two native DuckDB instance objects for the same file path. One is
orphaned in the map (overwritten by the second `instances.set`). The orphaned
instance leaks native resources and its memory limit is lost.

**Comparison with the correct pattern already in the same file:**

```typescript
// db.ts:140-148 — getConnection does this correctly
if (!connPromise) {
  connPromise = initConnection(dsId).catch((err) => {
    connections.delete(dsId);
    throw err;
  });
  connections.set(dsId, connPromise);  // stores Promise BEFORE awaiting
}
return connPromise;
```

`getConnection` stores the Promise before the first `await`, closing the race.
`getOrCreateInstance` does not follow the same pattern, creating an inconsistency
in the same file.

## Findings

- `src/lib/db.ts:61-70` — stores resolved value, not Promise
- `src/lib/db.ts:140-148` — correct pattern (promise-caching) used right above in the same file
- Race is most likely during cold-start when deep-mode fires 6 subagents concurrently — all 6 may call `getOrCreateInstance` for the same `dbPath` before the first one completes

## Proposed Solutions

**Option A (Recommended): Mirror the `getConnection` pattern — store Promise**

```typescript
export async function getOrCreateInstance(dbPath: string): Promise<DuckDBInstance> {
  let instancePromise = instances.get(dbPath);
  if (!instancePromise) {
    instancePromise = instanceCache.getOrCreateInstance(dbPath, {
      memory_limit: process.env.DUCKDB_MEMORY_LIMIT ?? "256MB",
      threads: process.env.DUCKDB_THREADS ?? "1",
    }).catch((err) => {
      instances.delete(dbPath);
      throw err;
    }) as Promise<DuckDBInstance>;
    instances.set(dbPath, instancePromise);  // stored before await
  }
  return instancePromise;
}
```

Note: this requires changing `instances`'s type from
`Map<string, DuckDBInstance>` to `Map<string, Promise<DuckDBInstance>>`.
The `DuckDBGlobal` interface must also be updated.

- Effort: Small | Risk: Low

**Option B: Wrap in a synchronous mutex using a flag**

Use a plain object `{ promise: Promise<DuckDBInstance> | null }` per path.
More complex than Option A for no benefit.

## Technical Details

- `src/lib/db.ts:17-70` (interface + getOrCreateInstance)
- `DuckDBGlobal.__duckdb_instances__` type change required

## Acceptance Criteria

- [ ] Concurrent calls to `getOrCreateInstance` for the same `dbPath` return the same instance
- [ ] No duplicate `instanceCache.getOrCreateInstance` calls for the same path
- [ ] On error, the failed promise is removed from the map (retry is possible)
- [ ] `instances` type updated to `Map<string, Promise<DuckDBInstance>>`

## Work Log

- 2026-03-02: Found by performance-oracle and pattern-recognition-specialist agents on PR #29
