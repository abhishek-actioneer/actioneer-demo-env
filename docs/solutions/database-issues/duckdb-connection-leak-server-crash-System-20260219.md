---
module: System
date: 2026-02-19
problem_type: database_issue
component: database
symptoms:
  - "Next.js dev server crashes after ~5-10 sidebar navigation clicks"
  - "WebSocket HMR connection failures: ws://localhost:3000/_next/webpack-hmr"
  - "Exit code 138 (SIGBUS) — DuckDB native segfault on SELECT from segments table"
  - "No JavaScript error output — hard native crash kills process silently"
root_cause: memory_leak
resolution_type: code_fix
severity: critical
tags: [duckdb, connection-leak, singleton, server-crash, native-segfault, wal-corruption]
---

# Troubleshooting: DuckDB Connection Leak Crashes Next.js Dev Server

## Problem
Every call to `getConnection()` in `src/lib/db.ts` created a new `DuckDBConnection` via `inst.connect()`, but no caller ever closed it. After ~5-10 sidebar navigations, DuckDB ran out of native resources and the process crashed with SIGBUS (exit 138). The repeated crashes also corrupted the `.duckdb` file and WAL, causing persistent segfaults even after restarting.

## Environment
- Module: System-wide (all API routes using DuckDB)
- Stack: Next.js 16.1.6 / DuckDB `@duckdb/node-api`
- Affected Component: `src/lib/db.ts` (connection management), all API routes via `sql-executor.ts`
- Date: 2026-02-19

## Symptoms
- Next.js dev server dies silently after a few sidebar clicks (no JS error, just process exit)
- Browser console floods with `WebSocket connection to 'ws://localhost:3000/_next/webpack-hmr' failed`
- `curl` to `/api/segments` returns empty reply (connection reset) then server is dead
- Standalone Node script exits with code 138 (SIGBUS) when querying segments table
- Deep analysis mode (17 parallel `executeSQL()` calls) amplified the leak — 17 leaked connections per request

## What Didn't Work

**Direct solution:** The connection leak was identified via code review (4 review agents confirmed). Two fixes were needed:

1. **Code fix** — singleton connection pattern (addressed the leak)
2. **Data fix** — the old `.duckdb` and `.duckdb.wal` files were corrupted from previous crashes and had to be deleted

The code fix alone was insufficient because the corrupted database file caused SIGBUS regardless of connection management.

## Solution

**Code change** (`src/lib/db.ts`):
```typescript
// Before (broken):
let instance: DuckDBInstance | null = null;
let initialized = false;

async function getInstance(): Promise<DuckDBInstance> {
  if (!instance) {
    instance = await DuckDBInstance.create(DB_PATH);
  }
  return instance;
}

export async function getConnection(): Promise<DuckDBConnection> {
  const inst = await getInstance();
  const conn = await inst.connect(); // NEW connection every call, never closed
  if (!initialized) { /* DDL here */ }
  return conn;
}

// After (fixed):
let connectionPromise: Promise<DuckDBConnection> | null = null;

async function initConnection(): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();
  // All DDL runs here once: CREATE VIEW, CREATE TABLE, seed data
  return conn;
}

export async function getConnection(): Promise<DuckDBConnection> {
  if (!connectionPromise) {
    connectionPromise = initConnection();
  }
  return connectionPromise;
}
```

**Data fix:**
```bash
rm -f data/ecommerce.duckdb data/ecommerce.duckdb.wal
# initConnection() recreates the DB on next server start
```

## Why This Works

1. **Root cause — connection leak:** `inst.connect()` allocates native DuckDB resources (file descriptors, memory-mapped regions). Without `closeSync()`/`disconnectSync()`, these accumulate until the OS kills the process (SIGBUS = memory access violation on exhausted resources).

2. **Promise-based singleton:** Storing the connection as a `Promise<DuckDBConnection>` ensures:
   - First caller creates the connection and runs DDL
   - All concurrent callers await the same promise (no race condition)
   - Only one connection exists for the process lifetime (DuckDB is single-writer, one connection is correct)

3. **Corrupted DB:** Repeated unclean shutdowns (SIGBUS kills mid-write) left the WAL in an inconsistent state. DuckDB's WAL recovery couldn't handle the corruption, causing segfaults on any table read. Deleting the files and letting `initConnection()` recreate them was the only fix.

## Prevention

- **Never call `instance.connect()` in a per-request code path** — DuckDB connections are heavyweight native resources. Use a singleton or connection pool.
- **If DuckDB starts segfaulting after crashes**, delete the `.duckdb` and `.duckdb.wal` files. The WAL can become irrecoverably corrupted from unclean shutdowns.
- **Use promise-based lazy init** for any singleton that involves async setup — a boolean `initialized` flag is not async-safe (two concurrent callers both see `false`).
- **grep for `closeSync|disconnectSync`** after adding DuckDB connections — if zero matches exist, there's a leak.

## Related Issues

No related issues documented yet.
