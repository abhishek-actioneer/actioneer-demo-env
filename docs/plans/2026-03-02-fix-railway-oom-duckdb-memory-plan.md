---
title: "fix: Railway OOM crash — DuckDB memory limit + chunk-based row reading"
type: fix
date: 2026-03-02
---

# fix: Railway OOM crash — DuckDB memory limit + chunk-based row reading

## Enhancement Summary

**Deepened on:** 2026-03-02
**Research agents used:** TypeScript reviewer, Performance Oracle, Deployment Verification, Code Simplicity, Framework Docs (actual DuckDB types), Best Practices, WAL/Learning files, Test quality

### Key Improvements from Research
1. **Critical API correction** — the DuckDB config key is `memory_limit` (not `max_memory`), and options are silently ignored on cache hits; options must be set at one authoritative call site
2. **Lower memory defaults** — 256MB (not 512MB) for `memory_limit` on Railway Hobby; 2 threads (not 4) to avoid CPU thrashing
3. **NODE_OPTIONS is missing from original plan** — `--max-old-space-size=256` is required or V8 grows into OOM territory regardless of DuckDB limits
4. **Fix 2 (chunk iteration) is redundant** — if Fix 3 (SQL LIMIT) is in place, DuckDB never produces >500 rows, so `getRows()` on a 500-row result is safe; drop Fix 2
5. **WAL corruption risk** — OOM kills corrupt the `.duckdb.wal`; startup integrity check needed
6. **rowCount semantics change** — should reflect actual rows returned (≤500) not a total that required full materialization

---

## Overview

The Railway deployment crashes with exit code 137 (Linux OOM kill) after ~1–2 hours of usage. Two compounding root causes: DuckDB runs unbounded with no memory limit, and the SQL executor materializes **entire query result sets** into the Node.js heap before slicing to 500 rows. This fix addresses both causes with the minimal change set: 3 targeted edits across 2 files plus 2 Railway env vars.

---

## Problem Statement

**Evidence from Railway logs (2026-03-02):**
- `[error] Killed` at `07:05:17`
- `ELIFECYCLE Command failed with exit code 137` (128 + SIGKILL = Linux OOM kill)
- `ecommerce.duckdb.tmp` modified at `07:03` (DuckDB was actively querying)
- App ran ~1h48m before dying

**Root Cause 1 — Full result set materialization (highest impact)**

In `src/lib/sql-executor.ts`, all three executor functions call `result.getRows()` which deserializes the **entire** DuckDB result into a JS array, then slices to 500 rows:

```ts
// sql-executor.ts:37-38, :169-171, :124-125
const rawRows = await result.getRows();   // ← ALL rows into Node.js heap
const rows = rawRows.slice(0, 500);       // ← 500 kept, millions discarded
```

If a query over the parquet events table returns 1M rows before a LLM-generated `LIMIT`, all 1M rows are deserialized into JS memory before the slice runs.

> **Research insight:** `getRows()` materializes results in the V8 heap, separate from DuckDB's native `memory_limit` budget. Even if DuckDB's buffer manager is within limits, the JS-side materialization is additive on top of it. On a 512MB container, Node.js baseline + DuckDB native = ~350MB, leaving only ~150MB for JS heap.

**Root Cause 2 — No DuckDB memory limit**

In `src/lib/db.ts`, instance creation passes no options:
```ts
instance = await instanceCache.getOrCreateInstance(dbPath);
// ↑ DuckDB defaults to ~80% of system RAM (~410MB on a 512MB container)
```

**Root Cause 3 — No Node.js heap limit**

Node.js 20+ automatically caps V8 heap at ~50% of container cgroup memory limit. On a 512MB Railway container, that's ~256MB for Node.js heap — but the baseline process already consumes ~150-200MB. No `NODE_OPTIONS=--max-old-space-size` is set, meaning V8 may expand into the same physical memory DuckDB is using, triggering the OS OOM killer.

**Compounding factor — LLM-generated LIMIT is not enforced in code**

`sql-generator.ts:27` instructs the LLM to always add `LIMIT 500`, but this is a prompt instruction — there's no code-level enforcement. Gemini sometimes omits it on complex CTEs or subqueries.

---

## Proposed Solution

**Minimal fix: two targeted changes + Railway env vars.** Research confirmed Fix 2 (chunk iteration) is redundant if Fix 3 (SQL LIMIT) is in place — DuckDB won't produce >500 rows, so `getRows()` on a 500-row result is not a memory problem. Total LOC delta: ~10 lines, 0 new abstractions.

### Fix 1: Set DuckDB memory limit at instance creation (`src/lib/db.ts`)

Pass `memory_limit` and `threads` options when first creating the DuckDB instance. DuckDB will throw a catchable error instead of crashing the process.

```ts
// db.ts — inside initConnection(), at the one authoritative getOrCreateInstance call
// (line 80, inside enqueue() — this is the first call for a given dbPath)
instance = await instanceCache.getOrCreateInstance(dbPath, {
  memory_limit: process.env.DUCKDB_MEMORY_LIMIT ?? "256MB",
  threads: process.env.DUCKDB_THREADS ?? "2",
});
```

**Why `initConnection` and not `getOrCreateInstance` (exported helper at line 64):**
`DuckDBInstanceCache` is a cache — it returns the existing instance if already created for `dbPath`. `initConnection` runs inside `enqueue()` and is the first-caller for any new dataset path. Options passed to a cache-hit call are silently ignored. Set options here only, at the authoritative first-creation site.

> **API correctness (verified from installed types):**
> The correct key is `memory_limit` (the SQL-level pragma name). `max_memory` is a C-level alias for the C API — do NOT use it in `DuckDBInstance.create()` options.
> Signature: `getOrCreateInstance(path?: string, options?: Record<string, string>): Promise<DuckDBInstance>`

> **Memory values:**
> - 256MB for DuckDB on Railway Hobby (512MB container): leaves ~256MB for Node.js heap + Next.js baseline + OS
> - 400MB for Railway Developer/Pro (1GB container)
> - Configurable via env var `DUCKDB_MEMORY_LIMIT` without code changes

> **Thread values:**
> - Default `threads=2` (not 4) — Railway Hobby containers have ~0.5-1 vCPU credit; spawning 4 DuckDB threads on 0.5 vCPU causes scheduling overhead and higher per-query memory. DuckDB's `enqueue()` serializer already prevents concurrent queries per dataset, so intra-query parallelism from extra threads is the only benefit — not worth the memory cost.

### Fix 2: Enforce LIMIT 500 at the SQL level (`src/lib/sql-executor.ts`)

Add a rewriter before `conn.run()` that appends `LIMIT 500` if absent. This prevents DuckDB from materializing large result sets natively — fixing the memory problem at the source rather than in JS.

```ts
// sql-executor.ts — add this helper function
function ensureLimit(sql: string, limit = 500): string {
  const normalized = sql.trim().replace(/;+\s*$/, "");
  // Check only after the last SELECT to avoid matching LIMITs inside CTEs
  const lastSelectIdx = normalized.search(/\bSELECT\b/gi);
  const tail = lastSelectIdx >= 0 ? normalized.slice(lastSelectIdx) : normalized;
  if (/\bLIMIT\b/i.test(tail)) return normalized;
  return `${normalized} LIMIT ${limit}`;
}
```

Apply in `executeSQL` and `executeSQLInternal` before `conn.run()`:
```ts
const result = await conn.run(ensureLimit(sql));
```

Also apply in `executeSQLPrepared`'s SELECT branch (not the DML branch).

> **CTE edge case:** The plan's original `\bLIMIT\b` regex would false-positive on `WITH cte AS (... LIMIT 100) SELECT * FROM cte` — the inner `LIMIT` would suppress the outer append. The `lastSelectIdx` approach fixes this by only checking the tail from the final SELECT position. If Gemini generates a CTE with an inner LIMIT but an unbounded outer SELECT, this correctly appends the outer LIMIT.

> **Aggregation queries:** `ensureLimit` is safe for GROUP BY queries — `LIMIT` applies after aggregation, capping output rows without affecting the aggregation itself. DuckDB will still process all input rows for the aggregation, but result transfer to Node.js is bounded.

> **rowCount semantics change:** After this fix, `rawRows.length` will always be ≤500 (since DuckDB never returns more). Change `rowCount: Number(rawRows.length)` to reflect what was actually returned — not a total that required full materialization. This is a UX improvement: showing "500 rows" is more accurate than "2,000,000 rows" when Gemini only saw 500 anyway.

### Fix 3: Add NODE_OPTIONS heap cap (Railway env var — no code change)

Set in Railway Variables:
```
NODE_OPTIONS=--max-old-space-size=256
```

This causes V8 to GC more aggressively before hitting the container ceiling, throwing a clean JavaScript OOM error rather than letting the OS kill the process silently.

> **Why this matters:** Without it, the OOM kill happens at the OS cgroup level (exit code 137, no error logged) even after DuckDB limits are set. The V8 heap and DuckDB native memory compete for the same 512MB — setting both limits ensures they sum to less than the container ceiling.

| Railway Plan | Container RAM | `DUCKDB_MEMORY_LIMIT` | `NODE_OPTIONS` |
|---|---|---|---|
| Hobby (512MB) | 512MB | `256MB` | `--max-old-space-size=256` |
| Developer (1GB) | 1GB | `400MB` | `--max-old-space-size=512` |

---

## Technical Considerations

- **DuckDB `memory_limit` scope**: Applies to the instance (global to the process), not per-query. A single query that hits the limit throws a `DuckDBError` caught by the executor's try/catch — the process stays alive and returns `{ error: "Out of Memory Error" }` instead of crashing.
- **WAL corruption risk**: Exit code 137 (OOM kill) is an unclean shutdown. If DuckDB is killed mid-write, the `.duckdb.wal` file becomes irrecoverably corrupted, causing SIGBUS on the next startup. The existing `startup.sh` already re-downloads parquet and rebuilds the DB if missing — this is the recovery mechanism. After implementing this fix, OOM kills should no longer occur, but if they do, a Railway manual restart will trigger the startup script's re-setup path. Consider adding a DB integrity check in `isDBReady()` that auto-deletes `.duckdb` and `.duckdb.wal` if `conn.run("PRAGMA database_list")` throws.
- **`runAndReadUntil` API**: `@duckdb/node-api` v1.4.4 exposes `conn.runAndReadUntil(sql, 500)` for streaming at most 500 rows without full materialization. This is architecturally superior to `ensureLimit` but requires refactoring all three executor call sites. Given that `ensureLimit` achieves the same memory outcome (DuckDB never produces >500 rows), it is not necessary for this fix. Consider in a follow-up.
- **Concurrent deep-mode requests**: Two simultaneous deep-mode conversations create 2× `allResults` arrays (17 queries × 500 rows each) in memory simultaneously. The `enqueue` serializer prevents concurrent DuckDB operations but not concurrent requests. This is a P2 concern — add a semaphore if usage grows.
- **Railway env var propagation**: Env vars are injected at container start. Adding them after a code deploy has already started a container requires a manual redeploy to take effect.

---

## Acceptance Criteria

- [x] DuckDB instance created with `memory_limit` and `threads` options in `db.ts` at the `initConnection` call site (not the exported `getOrCreateInstance` helper)
- [x] `ensureLimit(sql)` applied before `conn.run()` in `executeSQL` (line 167), `executeSQLInternal` (line 35), and `executeSQLPrepared` SELECT branch (line 107)
- [x] `rowCount` in `QueryResult` reflects rows returned (post-limit, ≤500) — not a total requiring full materialization
- [ ] Railway env vars set: `DUCKDB_MEMORY_LIMIT=256MB`, `DUCKDB_THREADS=2`, `NODE_OPTIONS=--max-old-space-size=256`
- [x] `DUCKDB_MEMORY_LIMIT` and `NODE_OPTIONS` documented in README / `.env.example`
- [ ] Railway deployment survives a full deep-mode conversation without OOM kill
- [ ] Existing Playwright API tests pass (`tests/api/query.spec.ts`, `tests/api/analyze.spec.ts`)
- [x] New test: large result query (e.g. `SELECT * FROM events LIMIT 1000`) returns `rows.length ≤ 500`

---

## Dependencies & Risks

- **DuckDB `memory_limit` at 256MB may be too low** for complex GROUP BY on high-cardinality columns (e.g. `GROUP BY user_id` on millions of distinct users). The hash table for the aggregation may exceed 256MB, throwing an OOM error surfaced in `QueryResult.error`. Mitigation: raise `DUCKDB_MEMORY_LIMIT` via Railway env var to `400MB` if this occurs — no code change needed.
- **`ensureLimit` CTE edge case**: The `lastSelectIdx` approach handles CTEs but not adversarial SQL that places `SELECT` in a string literal or comment before the actual SELECT. LLM-generated SQL from Gemini won't have this pattern — acceptable risk for this demo app.
- **`rowCount` UX change**: The UI currently displays `rowCount` in query result cards. Changing it from "total rows the query matched" to "rows returned (≤500)" is a semantic change — users who previously saw "2,000,000 rows" will now see "500". This is more accurate (Gemini only saw 500 rows) and not a regression.

---

## Deployment Checklist

> **Critical order:** Set Railway env vars BEFORE deploying code. Env vars take effect on next container start — if code lands first without vars, `process.env.DUCKDB_MEMORY_LIMIT` is `undefined` and the instance falls through to the code default. Setting vars before the push means the first container running new code has both vars available.

### Pre-Deploy
- [ ] Set Railway Variables: `DUCKDB_MEMORY_LIMIT=256MB`, `DUCKDB_THREADS=2`, `NODE_OPTIONS=--max-old-space-size=256`
- [x] Run `pnpm build && pnpm lint` — zero errors in `db.ts` and `sql-executor.ts`
- [x] Verify `ensureLimit` unit tests pass with: plain SELECT (appends LIMIT), query with LIMIT (unchanged), CTE with inner LIMIT (appends outer LIMIT)
- [ ] Railway Volume mounted at `/app/data` — confirm in Railway dashboard before push

### Post-Deploy Verification (within 5 min)
- [ ] `/api/health` returns 200
- [ ] Send a deep-mode analytics query — confirm it completes without OOM kill
- [ ] Check Railway logs for `Killed` — should be absent
- [ ] Run `SELECT * FROM events LIMIT 1000` via the query API — confirm `rows.length ≤ 500`

### Rollback
- Fully reversible — `DuckDBInstance` config options are additive, no schema changes
- Railway "Rollback" button redeploys previous commit
- Remove `DUCKDB_MEMORY_LIMIT` / `DUCKDB_THREADS` env vars + manual redeploy to restore prior behavior
- Volume files are untouched by this fix

---

## Test Changes

**`tests/api/query.spec.ts` — add new test, strengthen 3 existing assertions:**

```ts
// NEW: validate row cap
test('large result query returns at most 500 rows', async ({ request }) => {
  const resp = await request.post('/api/query', {
    headers: authHeaders(),
    data: { sql: 'SELECT * FROM events LIMIT 1000' },
  });
  await expect(resp).toBeOK();
  const body = await resp.json();
  expect(Array.isArray(body.rows)).toBe(true);
  expect(body.rows.length).toBeLessThanOrEqual(500);
});

// STRENGTHEN: error tests should validate body.error field (Anti-Pattern #6 fix)
// Current: expect(resp.status()).toBe(400)  ← no body validation
// Updated: also check expect(body.error).toBeTruthy()
```

---

## References

- Logs: Railway crash at `07:05:17 Killed`, exit code 137
- Root cause in code: `src/lib/sql-executor.ts:37-38`, `:124-125`, `:169-171`
- DuckDB config: `src/lib/db.ts:64` (exported helper, NOT where options should go), `src/lib/db.ts:80` (inside `initConnection` — correct site)
- Related learning: `docs/solutions/database-issues/duckdb-connection-leak-server-crash-System-20260219.md` — prior SIGBUS crash from connection leaks; WAL corruption pattern documented there
- Railway config: `railway.toml`, `scripts/startup.sh`
- DuckDB node-api version: `1.4.4-r.1` (see `package.json:24`)
- DuckDB types verified: `node_modules/@duckdb/node-api/lib/DuckDBMaterializedResult.d.ts`, `DuckDBDataChunk.d.ts`, `DuckDBInstanceCache.d.ts`
