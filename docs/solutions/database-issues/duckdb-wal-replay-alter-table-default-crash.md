---
title: "DuckDB WAL Replay Failure on Railway Restart Due to ALTER TABLE DEFAULT Clause"
date: 2026-03-16
category: database-issues
subcategory: wal-replay-corruption
severity: critical
status: solved
symptoms:
  - "POST /api/segments/generate-all returning 422 after every Railway deploy"
  - "Error: Failure while replaying WAL file: Calling DatabaseManager::GetDefaultDatabase with no default database set"
  - "Metrics timeSeriesSql failing with INTERNAL Error on WAL replay"
  - "Stack trace shows BindDefaultValues and DuckTableEntry::AddColumn during replay"
  - "Requests complete in 7-9 seconds with all candidates failing — DuckDB never reached query execution"
  - "Chat/analytics queries work after process warms up but break on fresh restart"
technologies:
  - "DuckDB @duckdb/node-api v1.4.4-r.1"
  - "Next.js 16"
  - "Railway (persistent volume at /app/data)"
  - "Node.js"
components:
  - "src/lib/db.ts"
  - "ensureDatasetReady()"
tags:
  - duckdb
  - wal
  - wal-replay
  - railway
  - deployment
  - alter-table
  - migration
  - checkpoint
  - default-clause
  - persistent-volume
  - production
  - database-init
related:
  - docs/solutions/database-issues/duckdb-connection-leak-server-crash-System-20260219.md
  - docs/solutions/database-issues/duckdb-node-api-v1-usage-patterns.md
  - docs/solutions/best-practices/railway-ephemeral-filesystem-dynamic-datasets-Deployment-20260223.md
---

## Problem Summary

After every Railway deployment, all DuckDB operations failed on the first request following a process restart. The symptom was 422/500 errors across multiple features (segment generation, metrics time series). The app worked once the process had warmed up past the initialization path, which masked the bug during development.

---

## Root Cause Analysis

This was a two-part failure involving a DuckDB WAL replay crash triggered by a schema migration pattern in `src/lib/db.ts`.

### The Crash

Every fresh process start invokes `ensureDatasetReady()`, which ran:

```typescript
await conn.run(
  `ALTER TABLE sentinel_segments ADD COLUMN IF NOT EXISTS description VARCHAR DEFAULT ''`
);
```

The `DEFAULT ''` clause in an `ALTER TABLE` statement causes DuckDB to write a WAL entry that records the default value binding. When the process restarts, DuckDB replays the WAL before the database is fully initialized — specifically, before the default database context is established. The WAL replay calls into `BindDefaultValues`, which calls `DatabaseManager::GetDefaultDatabase`, and that fails because no default database has been set at replay time.

This is a bug in `@duckdb/node-api` v1.4.4-r.1. The crash stack:

```
Failure while replaying WAL file "/app/data/quickhelp.duckdb.wal":
Calling DatabaseManager::GetDefaultDatabase with no default database set
_ZN6duckdb6Binder17BindDefaultValuesERKNS_10ColumnListE...
_ZN6duckdb14DuckTableEntry9AddColumnERNS_13ClientContextERNS_13AddColumnInfoE
```

### The Accumulation Problem

A second contributing factor: no `CHECKPOINT` was called after setup completed. A CHECKPOINT flushes WAL entries to the main database file and clears the WAL. Without it, every deployment cycle appended more WAL entries. On each restart, the growing WAL was replayed — increasing both crash probability and startup latency.

The combination: every deployment wrote a poisoned WAL entry, and that entry was never flushed, so it survived to crash the next restart.

---

## Investigation Path

The key diagnostic clue was **request duration: 7–9 seconds**, then a 422.

- Gemini calls alone take ~5–7s for a large prompt
- If DuckDB was actually executing queries per candidate, the total would be 15–30s minimum (12 candidates × 2 queries, sequential)
- 7–9s = Gemini time + **near-instant failures** → DuckDB never touched; all failing at `validateSQL` or before

This pointed to DuckDB instance initialization failure, not query-level errors. Railway app logs (stdout `console.warn`) then revealed the WAL replay error directly:

```
[metrics] timeSeriesSql failed for m-commission-rate: INTERNAL Error:
Failure while replaying WAL file "/app/data/quickhelp.duckdb.wal": ...
```

The stack trace named `AddColumn` and `BindDefaultValues`, which narrowed the search to `ALTER TABLE ... ADD COLUMN ... DEFAULT` statements at startup — exactly the migration guard in `ensureDatasetReady()`.

---

## Solution

Two changes to `src/lib/db.ts`:

### Change 1 — Remove DEFAULT clause from ALTER TABLE

**Before (triggers WAL replay bug):**
```typescript
await conn.run(
  `ALTER TABLE sentinel_segments ADD COLUMN IF NOT EXISTS description VARCHAR DEFAULT ''`
);
```

**After (safe):**
```typescript
// New tables already get DEFAULT '' from CREATE TABLE above.
// Existing rows receive NULL for the new column — coerced to '' in application code.
await conn.run(
  `ALTER TABLE sentinel_segments ADD COLUMN IF NOT EXISTS description VARCHAR`
);
```

Removing `DEFAULT ''` means DuckDB no longer encodes a default value binding in the WAL entry. The WAL entry written is structurally simpler and does not invoke `BindDefaultValues` during replay.

### Change 2 — Add CHECKPOINT after setup

At the end of `ensureDatasetReady()`, immediately before `readyCache.add(datasetId)`:

```typescript
// Flush WAL to disk so there is nothing to replay on next restart.
// Without this, ALTER TABLE / INSERT statements written during setup remain
// in the WAL and trigger a DuckDB replay bug on process restart.
await conn.run("CHECKPOINT");
readyCache.add(datasetId);
```

This ensures the WAL is cleared after every setup run. On subsequent process restarts, there is nothing to replay.

---

## One-Time Recovery

The existing WAL file on the Railway volume already contains the poisoned entry. Even with the fixed code deployed, DuckDB will attempt to replay the bad WAL on first boot and crash again.

**Delete the WAL file on the Railway volume before or immediately after deploying:**

```bash
rm -f /app/data/quickhelp.duckdb.wal
```

Via Railway CLI shell, a one-off deploy command, or a startup script that runs before Next.js starts. After deletion, DuckDB starts clean, runs the fixed `ensureDatasetReady()`, and immediately checkpoints.

---

## Why It Won't Recur

1. **The trigger is gone.** `DEFAULT ''` was the specific instruction that caused `BindDefaultValues` to be encoded in the WAL. Without it, the `ADD COLUMN IF NOT EXISTS` statement writes a replay-safe WAL entry.

2. **The WAL is cleared on every setup.** `CHECKPOINT` at the end of `ensureDatasetReady()` flushes all pending WAL entries immediately after setup. On every subsequent restart, the WAL is either absent or empty — nothing to replay.

3. **The migration is idempotent.** `IF NOT EXISTS` means `ADD COLUMN` only executes once (when the column is absent). After the first successful run, the statement no-ops on all future startups — no WAL entry written at all.

---

## Prevention Rules

**Rule 1 — Never use `DEFAULT` in `ALTER TABLE ... ADD COLUMN`.**
DuckDB WAL replay does not have a full binding context. Any `DEFAULT <expr>` in `ALTER TABLE ADD COLUMN` crashes on restart. Add the column without a default, then backfill if needed:
```sql
ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar VARCHAR;
UPDATE foo SET bar = '' WHERE bar IS NULL;
```

**Rule 2 — Always `CHECKPOINT` after any DDL in `ensureDatasetReady()`.**
DuckDB does not flush the WAL on connection close or process exit. An explicit `CHECKPOINT` after all `CREATE`/`ALTER`/`INSERT` setup statements is mandatory for Railway (where processes are restarted frequently).

**Rule 3 — Prefer `CREATE TABLE IF NOT EXISTS` with the full schema over incremental `ALTER TABLE`.**
In a codebase that owns its schema entirely, define all columns in the initial `CREATE TABLE` statement. Only use `ALTER TABLE` when a column must be added to an already-populated persistent table, and follow Rule 1 when you do.

**Rule 4 — Pin `@duckdb/node-api` to an exact version.**
WAL format and replay behavior can change across patch releases. Use `"@duckdb/node-api": "1.4.4-r.1"` (no `^` or `~`) and verify the changelog before upgrading against an existing WAL on the volume.

---

## Migration Safety Checklist

For every new statement added to `ensureDatasetReady()`:

- [ ] **Idempotent?** Use `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- [ ] **No `DEFAULT` in `ALTER TABLE`?** If needed, add column first, then `UPDATE` to backfill
- [ ] **Writes to WAL?** All DDL and DML does. Confirm `CHECKPOINT` remains as the final statement
- [ ] **Tested against an existing DB file?** Kill the process mid-operation to leave a dirty WAL, then restart — confirm clean startup
- [ ] **Tested with the exact pinned DuckDB version?** Don't test against a different local version

---

## Detection

**Log patterns to alert on in Railway:**
- `BindDefaultValues`
- `WAL replay`
- `GetDefaultDatabase`
- `Catalog Error` (in stack traces)

**Startup duration threshold:**
`ensureDatasetReady()` on a clean database completes in under 200ms. If a deploy shows the function taking longer than 500ms, it may be replaying a large WAL. Add explicit timing:
```typescript
const t0 = Date.now();
// ... setup ...
await conn.run("CHECKPOINT");
console.log(`[db] ensureDatasetReady took ${Date.now() - t0}ms for ${datasetId}`);
```

**WAL presence check at startup:**
```typescript
import { existsSync } from "fs";
const walPath = dbPath.replace(/\.duckdb$/, ".duckdb.wal");
if (existsSync(walPath)) {
  console.warn(`[db] WAL file present at startup — previous process may have exited dirty: ${walPath}`);
}
```

---

## Related DuckDB WAL Gotchas

- **`conn.close()` does not checkpoint.** WAL accumulates until auto-checkpoint (1000 entries default) or explicit `CHECKPOINT`.
- **`READ_ONLY` mode does not bypass the WAL lock.** See [`duckdb-node-api-v1-usage-patterns.md`](./duckdb-node-api-v1-usage-patterns.md) — use `:memory:` + `read_parquet(...)` for scripts running alongside the dev server.
- **Auto-checkpoint is entry-count based, not size-based.** One large bulk `INSERT` can produce a huge WAL file below the 1000-entry threshold.
- **No concurrent multi-process writes.** If Railway runs two instances simultaneously during a rolling deploy, the second crashes with a lock error. Use "replace old instance" deployment mode, not rolling deploys.
- **`ALTER TABLE RENAME COLUMN` has also had WAL replay issues in some DuckDB versions.** Treat all structural DDL as suspect — always follow with `CHECKPOINT`.
- **WAL format is not cross-version compatible.** Always checkpoint (or verify a clean WAL) before upgrading `@duckdb/node-api` on a persistent volume.
- **Schema-on-read views (`CREATE VIEW ... read_parquet(...)`) do not write to the WAL.** Only operations on persistent tables generate WAL entries.
