# Fix: Server Crash on Sidebar Navigation

**Date:** 2026-02-18
**Branch:** `v1-sv`
**Status:** Draft — pending approval

---

## Problem Statement

The Next.js dev server crashes after a few sidebar navigation clicks. Four parallel review agents (architecture, performance, pattern-recognition, security) have independently confirmed the root cause and identified additional contributing factors.

## Root Cause — Confirmed

### DuckDB Connection Leak (`src/lib/db.ts:17-70`)

Every call to `getConnection()` creates a **new** `DuckDBConnection` via `inst.connect()`, but **no caller ever closes it**. Zero calls to `closeSync()` or `disconnectSync()` exist anywhere in the codebase.

**Evidence:**
- `DuckDBConnection` exposes `closeSync()` and `disconnectSync()` methods (confirmed from `node_modules/@duckdb/node-api/lib/DuckDBConnection.d.ts`)
- 4 call sites: `db.ts:17` (definition), `db.ts:74` (isDBReady), `sql-executor.ts:35` (executeSQLInternal), `sql-executor.ts:79` (executeSQL)
- grep for `closeSync|disconnectSync` in `src/` returns zero matches

**Crash mechanism:**
1. User navigates → `SidebarProvider.useEffect` fires `refreshSegments()` → `GET /api/segments` → `getConnection()` → leaked connection
2. Page component mounts → its own fetch (e.g., `SegmentsLandingPage.fetchSegments()`) → another `getConnection()` → leaked connection
3. After ~5-10 navigations, DuckDB runs out of native resources (file descriptors, memory) → crash
4. Deep analysis mode amplifies this: up to 17 parallel `executeSQL()` calls = 17 leaked connections per request

### Async Init Race Condition (`src/lib/db.ts:7-8`)

The `initialized` boolean guard is not async-safe. Two simultaneous requests on cold start both see `initialized === false`, both enter the init block, both run `CREATE TABLE IF NOT EXISTS` and seed `INSERT` concurrently. The `getInstance()` function has the same race — two callers can both see `instance === null` and create separate DuckDB instances.

### Double Segment Fetch

When navigating to `/segments`:
- `SidebarProvider.useEffect` → `refreshSegments()` → `GET /api/segments` (opens connection)
- `SegmentsLandingPage.useEffect` → `fetchSegments()` → `GET /api/segments` (opens second connection)

Both fire nearly simultaneously.

---

## Additional Findings (from review agents)

### Security (from security-sentinel)

| # | Finding | Severity | File |
|---|---------|----------|------|
| S1 | SQL injection via string interpolation | CRITICAL | `api/segments/route.ts:43-48` |
| S2 | Bypassable SQL validation (missing `COPY`, `ATTACH`, semicolons) | HIGH | `sql-executor.ts:11-29` |
| S3 | Second-order injection via stored segment SQL | HIGH | `api/segments/[id]/route.ts:18-21` |
| S4 | `executeSQLInternal` takes user input despite bypass comment | HIGH | `sql-executor.ts:32` |
| S5 | No query timeout | MEDIUM | `sql-executor.ts:80-83` |
| S6 | Error messages leak DB internals | LOW | All API routes |

### Pattern Consistency (from pattern-recognition)

- `playbook-store.ts` missing `ensureInitialized()` (only store without it)
- `canvas-store` uses `removeCanvasItem` vs `delete*` in all other stores
- `savedPlaybooks` map variable doesn't follow `*Map` naming convention

---

## Implementation Plan

### Step 1: Fix DuckDB Connection — Singleton Pattern
**Priority:** P0 — Server crash fix
**Files:** `src/lib/db.ts`
**Effort:** Small

Replace the per-call `getConnection()` with a singleton connection guarded by a promise-based lock. This eliminates both the connection leak AND the race condition in one change.

```typescript
// Before (broken):
let instance: DuckDBInstance | null = null;
let initialized = false;

async function getInstance() { ... }
export async function getConnection() {
  const inst = await getInstance();
  const conn = await inst.connect(); // NEW connection every call, never closed
  if (!initialized) { ... }
  return conn;
}

// After (fixed):
let connectionPromise: Promise<DuckDBConnection> | null = null;

export async function getConnection(): Promise<DuckDBConnection> {
  if (!connectionPromise) {
    connectionPromise = initConnection();
  }
  return connectionPromise;
}

async function initConnection(): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();
  // Run all DDL here (CREATE VIEW, CREATE TABLE, seed data)
  await conn.run(`CREATE OR REPLACE VIEW events AS ...`);
  await conn.run(`CREATE TABLE IF NOT EXISTS segments ...`);
  await conn.run(`CREATE TABLE IF NOT EXISTS integrations ...`);
  // Seed integrations if empty
  const countResult = await conn.run("SELECT COUNT(*) as cnt FROM integrations");
  const countRows = await countResult.getRows();
  if (Number(countRows[0][0]) === 0) {
    await conn.run(`INSERT INTO integrations ...`);
  }
  return conn;
}
```

Key design decisions:
- **Promise-based lock** — if two requests hit simultaneously, the second awaits the same promise (no race)
- **Single connection** — DuckDB is designed for single-writer; one connection is sufficient and correct
- **No close needed** — the singleton lives for the process lifetime (same as the current `instance` variable)

**Acceptance criteria:**
- [x] `getConnection()` returns the same connection instance on every call
- [x] Concurrent calls during init await the same promise (no duplicate `CREATE TABLE`)
- [x] Server survives 50+ rapid sidebar navigations without crashing
- [x] `isDBReady()` reuses the singleton connection

---

### Step 2: Update `isDBReady` to Use Singleton
**Priority:** P0
**Files:** `src/lib/db.ts`
**Effort:** Small

Currently `isDBReady()` calls `getConnection()` which (after Step 1) will reuse the singleton. Verify it still works correctly — it should now be a simple SQL ping on the shared connection.

**Acceptance criteria:**
- [x] `GET /api/health` returns `{ dbReady: true }` without creating a new connection

---

### Step 3: Deduplicate Segments Fetch
**Priority:** P1 — Reduces unnecessary server load
**Files:** `src/app/segments/page.tsx`, `src/components/sidebar-context.tsx`
**Effort:** Small

The segments page should consume the sidebar context's `segments` data instead of fetching its own. The `SidebarProvider` already fetches and stores segments — the page should read from context and call `refreshSegments()` only if it needs a force-refresh.

Two options:
- **Option A (minimal):** In `segments/page.tsx`, replace the local `fetchSegments` with `useSidebarContext().segments` + `refreshSegments()`. The sidebar already has the data.
- **Option B (keep page fetch, remove sidebar fetch):** If the page needs richer data than the sidebar, keep the page fetch but remove the sidebar's `refreshSegments()` auto-call on mount and have the page push updates to the sidebar context instead.

Recommend **Option A** since the sidebar already does the work.

**Acceptance criteria:**
- [ ] Navigating to `/segments` produces exactly 1 `GET /api/segments` call (not 2)
- [ ] Sidebar segments panel still shows fresh data

---

### Step 4: Harden SQL Validation
**Priority:** P1 — Security
**Files:** `src/lib/sql-executor.ts`
**Effort:** Small

Update `validateSQL()`:
1. Block semicolons entirely (`if (sql.includes(';'))`)
2. Add missing dangerous keywords: `COPY`, `ATTACH`, `INSTALL`, `LOAD`, `CALL`, `EXPORT`, `PRAGMA`, `SET`, `EXECUTE`
3. Fix regex to match keyword at end-of-string: `new RegExp(\`\\b${kw}(\\s|$|;)\`, "i")`

**Acceptance criteria:**
- [ ] `validateSQL("SELECT 1; COPY ...")` returns `{ valid: false }`
- [ ] `validateSQL("SELECT 1; TRUNCATE")` returns `{ valid: false }` (keyword at EOF)
- [ ] `validateSQL("SELECT updated_at FROM events LIMIT 10")` still returns `{ valid: true }` (column name containing "UPDATE" not blocked)

---

### Step 5: Parameterize Segment/Integration SQL
**Priority:** P1 — Security
**Files:** `src/app/api/segments/route.ts`, `src/app/api/segments/[id]/route.ts`, `src/app/api/segments/[id]/push/route.ts`, `src/app/api/integrations/route.ts`
**Effort:** Medium

Replace all string-interpolated SQL with DuckDB prepared statements. The `DuckDBConnection.run()` method already supports parameterized queries:

```typescript
// Before (vulnerable):
await executeSQLInternal(
  `INSERT INTO segments ... VALUES ('${id}', '${escapedName}', ...)`
);

// After (safe):
const conn = await getConnection();
await conn.run(
  "INSERT INTO segments (id, name, sql, user_count, source_conversation_id) VALUES ($1, $2, $3, $4, $5)",
  [id, name, sql, userCount, sourceConversationId ?? null]
);
```

This requires either:
- Exposing `getConnection()` directly to routes (breaking the `sql-executor` abstraction), OR
- Adding a `executeSQLParameterized(sql, params)` function to `sql-executor.ts`

Recommend the latter to maintain the abstraction layer.

**Acceptance criteria:**
- [ ] No template literal SQL with `${}` user input in any API route
- [ ] Segments CRUD still works end-to-end
- [ ] Integration toggle still works

---

### Step 6: Add Query Timeout
**Priority:** P2
**Files:** `src/lib/sql-executor.ts`
**Effort:** Small

Wrap query execution in `Promise.race` with a 30-second timeout:

```typescript
const QUERY_TIMEOUT_MS = 30_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Query timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}
```

**Acceptance criteria:**
- [ ] A query that runs > 30s returns a timeout error instead of blocking forever

---

### Step 7: Sanitize Error Responses
**Priority:** P3
**Files:** All API routes under `src/app/api/`
**Effort:** Small

Log full DuckDB errors server-side, return generic messages to client:

```typescript
console.error("SQL execution failed:", result.error);
return Response.json({ error: "Operation failed" }, { status: 500 });
```

**Acceptance criteria:**
- [ ] No DuckDB internal error messages (table names, file paths) visible in API responses
- [ ] Full errors still logged to server console for debugging

---

## Execution Order

```
Step 1 (P0) ──→ Step 2 (P0) ──→ Step 3 (P1) ──→ Step 4 (P1) ──→ Step 5 (P1) ──→ Step 6 (P2) ──→ Step 7 (P3)
  │                                                    │
  └── Fixes crash ──────────────────────────────────────┘── Fixes security
```

Steps 1-2 are the crash fix. Steps 3-5 should follow immediately. Steps 6-7 are polish.

## Files Touched

| File | Steps | Change Type |
|------|-------|-------------|
| `src/lib/db.ts` | 1, 2 | Rewrite connection management |
| `src/lib/sql-executor.ts` | 4, 5, 6 | Harden validation, add parameterized helper, add timeout |
| `src/app/segments/page.tsx` | 3 | Remove duplicate fetch |
| `src/app/api/segments/route.ts` | 5, 7 | Parameterize SQL, sanitize errors |
| `src/app/api/segments/[id]/route.ts` | 5, 7 | Parameterize SQL, sanitize errors |
| `src/app/api/segments/[id]/push/route.ts` | 5, 7 | Parameterize SQL, sanitize errors |
| `src/app/api/integrations/route.ts` | 5, 7 | Parameterize SQL, sanitize errors |

## Out of Scope (noted for future)

- Auth/authz on API routes (demo app, not deployed publicly)
- Store pattern normalization (playbook-store missing ensureInitialized, naming inconsistencies)
- Canvas page error boundary for tldraw unmount race
- Generic `createClientStore()` factory extraction
