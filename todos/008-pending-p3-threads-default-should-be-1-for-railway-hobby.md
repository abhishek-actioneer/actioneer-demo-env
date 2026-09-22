---
status: complete
priority: p3
issue_id: "008"
tags: [code-review, performance, db]
dependencies: []
---

# DUCKDB_THREADS default of 2 is wrong for Railway Hobby 0.5vCPU; should be 1

## Problem Statement

Railway Hobby containers have ~0.5 shared vCPU. Setting `threads=2` means DuckDB spawns 2 worker threads that time-slice on a single core, adding context-switching overhead with no throughput benefit over 1 thread. The plan document itself says "Railway Hobby containers have ~0.5-1 vCPU credit" but then recommends 2 threads — inconsistent.

Also: `threads` is passed as the string `"2"` but the DuckDB node-api may expect a number. Verify in `@duckdb/node-api` type definitions.

## Proposed Solutions

**Option A: Change default to "1"**
```ts
threads: process.env.DUCKDB_THREADS ?? "1",
```
Update `.env.example` and Railway vars recommendation accordingly.

**Option B: Keep "2", add comment explaining rationale**
- The `enqueue` serializer prevents concurrent queries per dataset, so 2 threads only benefits intra-query parallelism in large single queries. For the query sizes this app generates, 1 is fine.

## Recommended Action

Option A — change default to `"1"`. Lower CPU contention, simpler mental model.

## Technical Details

- Affected files: `src/lib/db.ts:82`, `.env.example`

## Acceptance Criteria

- [ ] Default `threads` is `"1"` (or confirmed correct for Railway Hobby)
- [ ] `.env.example` updated to match

## Work Log

- 2026-03-02: Found by performance-oracle on PR #29
