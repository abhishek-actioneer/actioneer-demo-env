---
status: pending
priority: p1
issue_id: "012"
tags: [code-review, security, duckdb, oom]
dependencies: []
---

# Memory limit bypass: data-profiler.ts and upload/route.ts call instanceCache directly

## Problem Statement

The OOM fix in PR #29 sets `memory_limit=256MB` and `threads=1` inside
`db.ts`'s `getOrCreateInstance()` wrapper. However, two files bypass this
wrapper entirely and call `instanceCache.getOrCreateInstance(dbPath)` directly
with **no options**, meaning DuckDB instances created for uploaded datasets
run without any memory cap.

`DuckDBInstanceCache` is a native cache keyed on `dbPath`. The first caller to
create an instance for a given path wins — including options. If either
bypassing caller runs first (which is always the case for user-uploaded
datasets, since upload is the first access path for a new DB file),
`db.ts`'s wrapper subsequently finds the instance already in the cache and
returns it without re-applying options. The `memory_limit` is silently ignored
for all uploaded datasets.

**Files that bypass the wrapper:**

```typescript
// src/lib/datasets/data-profiler.ts:44
instance = await instanceCache.getOrCreateInstance(dbPath);  // no options

// src/app/api/datasets/upload/route.ts:107
instance = await instanceCache.getOrCreateInstance(dbPath);  // no options
```

## Findings

- `src/lib/datasets/data-profiler.ts:44` — direct `instanceCache.getOrCreateInstance(dbPath)` call, no memory_limit
- `src/app/api/datasets/upload/route.ts:107` — same pattern
- `src/lib/db.ts:61-70` — the canonical wrapper that applies env-var-based limits; has **zero external callers** (confirmed by grep)
- For the primary ecommerce dataset, the risk is mitigated because `initConnection` runs at startup before any user request. For uploaded datasets, the upload route IS the first access, so the unguarded instance wins the cache race.

## Proposed Solutions

**Option A (Recommended): Replace direct calls with the exported wrapper**

```typescript
// In data-profiler.ts and upload/route.ts — import and use:
import { getOrCreateInstance } from "@/lib/db";

// Replace:
instance = await instanceCache.getOrCreateInstance(dbPath);
// With:
instance = await getOrCreateInstance(dbPath);
```

Both files already import `globalThis`-pinned references. After the change,
they share the same `instances` Map and the wrapper's options are always
applied at first creation.

- Effort: Small | Risk: Low

**Option B: Pass options inline at both call sites**

```typescript
instance = await instanceCache.getOrCreateInstance(dbPath, {
  memory_limit: process.env.DUCKDB_MEMORY_LIMIT ?? "256MB",
  threads: process.env.DUCKDB_THREADS ?? "1",
});
```

Duplicates the config literals in three places. If env var names change, all
three must be updated. Less preferable than Option A.

- Effort: Small | Risk: Medium (drift risk)

## Technical Details

- `src/lib/datasets/data-profiler.ts:7,44`
- `src/app/api/datasets/upload/route.ts:19,107`
- `src/lib/db.ts:61-70` (the correct wrapper)

## Acceptance Criteria

- [ ] Neither `data-profiler.ts` nor `upload/route.ts` calls `instanceCache.getOrCreateInstance` directly
- [ ] Both use `getOrCreateInstance` from `@/lib/db` (or equivalent that applies memory_limit/threads)
- [ ] A DuckDB instance created via upload respects `DUCKDB_MEMORY_LIMIT=256MB`
- [ ] Existing tests pass

## Work Log

- 2026-03-02: Found by architecture-strategist and simplicity-reviewer agents on PR #29
