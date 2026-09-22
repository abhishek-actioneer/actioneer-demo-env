---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, db, memory]
dependencies: []
---

# Exported getOrCreateInstance() bypasses memory_limit — upload and profiler unprotected

## Problem Statement

`db.ts` exports a `getOrCreateInstance()` helper (lines 61-68) that calls `instanceCache.getOrCreateInstance(dbPath)` with **no options**. Two callers use this directly:

- `src/lib/datasets/data-profiler.ts:44`
- `src/app/api/datasets/upload/route.ts:107`

These are the most memory-intensive paths (CSV ingestion, schema profiling) and they bypass the `memory_limit=256MB` protection this PR introduces. Additionally, if either of these runs before `initConnection()` for a given `dbPath`, they pre-populate the `instances` Map — causing `initConnection()` to skip the `getOrCreateInstance()` call with options at line 78 (finding the uncapped instance already cached).

## Proposed Solutions

**Option A: Delete the exported helper, update callers to use withConnection()**
- Effort: Medium | Risk: Low

**Option B: Add memory options to the exported helper**
```ts
export async function getOrCreateInstance(dbPath: string): Promise<DuckDBInstance> {
  let instance = instances.get(dbPath);
  if (!instance) {
    instance = await instanceCache.getOrCreateInstance(dbPath, {
      memory_limit: process.env.DUCKDB_MEMORY_LIMIT ?? "256MB",
      threads: process.env.DUCKDB_THREADS ?? "2",
    });
    instances.set(dbPath, instance);
  }
  return instance;
}
```
And remove the duplicate `if (!instance)` block inside `initConnection()` — just call the exported helper.
- Effort: Small | Risk: Low

## Recommended Action

Option B — add options to the exported helper and deduplicate `initConnection`. This makes the memory cap universal regardless of which path initializes the instance first.

## Technical Details

- Affected files: `src/lib/db.ts`, `src/lib/datasets/data-profiler.ts`, `src/app/api/datasets/upload/route.ts`

## Acceptance Criteria

- [ ] All DuckDB instance creation paths pass `memory_limit` and `threads` options
- [ ] `initConnection()` no longer has a duplicate instance-creation block

## Work Log

- 2026-03-02: Found by architecture-strategist, performance-oracle, pattern-recognition-specialist, security-sentinel on PR #29
