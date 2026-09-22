---
title: "fix: sql-executor DML prepared statements + buildResult dedup"
type: fix
date: 2026-03-02
todos: ["009", "010"]
---

# fix: sql-executor DML prepared statements + buildResult dedup

## Overview

Two targeted fixes to `src/lib/sql-executor.ts`:

1. **P1 (todo-009):** Replace the manual string-interpolation DML branch in `executeSQLPrepared` with native DuckDB prepared statements — the same `conn.prepare()` + `stmt.bind*()` path already used for SELECT. Removes the false "safe against injection" guarantee.
2. **P2 (todo-010):** Extract the triplicated `rawRows.map()` + `QueryResult` assembly block into a private `buildResult` helper, eliminating 22 lines of copy-paste.

No behavior change for callers. All existing tests should pass unchanged.

## Problem Statement

### P1 — DML branch uses manual escaping, documented as injection-safe

`executeSQLPrepared` (lines 80–165) has two paths:

- **SELECT path (lines 123–154):** uses `conn.prepare()` + `stmt.bind*()` — correct, safe.
- **DML path (lines 93–121):** abandons prepared statements, does `String.replace($N, escaped)` manually.

Two bugs in the DML path:
- `String.replace(string)` (non-regex) replaces only the **first** occurrence of each `$N` placeholder. A template like `UPDATE t SET a = $1, b = $1 WHERE id = $2` would leave the second `$1` as a literal string DuckDB sees as a positional parameter with no binding.
- Only `'` → `''` escaping is applied — the JSDoc comment on line 80 says "safe against injection" which is not true for this path.

All current DML call sites use hardcoded SQL templates so no injection is possible today. But the false documented guarantee will mislead future developers.

### P2 — Row-mapping block copy-pasted three times

This 11-line block is byte-for-byte identical in `executeSQLInternal` (54–67), `executeSQLPrepared` SELECT path (141–154), and `executeSQL` (187–200):

```typescript
const rows = rawRows.slice(0, MAX_RESULT_ROWS).map((row) => {
  const obj: Record<string, unknown> = {};
  colNames.forEach((col, i) => {
    const val = row[i];
    obj[col] = typeof val === "bigint" ? Number(val) : val;
  });
  return obj;
});
return {
  columns: colNames,
  rows,
  rowCount: rows.length,
  executionTimeMs: Math.round(performance.now() - start),
};
```

If the bigint conversion or field-mapping logic ever needs to change, three identical edits are required.

## Proposed Solution

### Fix 1 — Remove the DML branch, extend prepare() path to cover DML

`conn.prepare()` in `@duckdb/node-api` accepts any SQL statement. Confirmed via `DuckDBPreparedStatement.d.ts`: INSERT=2, UPDATE=3, DELETE=5 are valid `statementType` values. The `stmt.run()` method works for DML and returns a `DuckDBMaterializedResult` whose `columnNames()` and `getRows()` return empty arrays — which is correct (`rowCount: 0` for DML is fine and matches current behavior).

The only adjustment: DML statements must skip `ensureLimit()`. The current SELECT path applies `ensureLimit(sql)` before `conn.prepare()` — we need to gate that on whether the statement is SELECT/WITH.

**Approach:** keep the `isDML` detection but use it only to skip `ensureLimit`, not to switch to a different execution path.

```typescript
export async function executeSQLPrepared(
  sql: string,
  params: unknown[],
  datasetId?: string,
): Promise<QueryResult> {
  const start = performance.now();
  try {
    return await withConnection(datasetId, async (conn) => {
      const trimmed = sql.trim().toUpperCase();
      const isDML =
        trimmed.startsWith("UPDATE") ||
        trimmed.startsWith("DELETE") ||
        trimmed.startsWith("INSERT");

      // Apply LIMIT cap for SELECT queries only
      const safeSql = isDML ? sql : ensureLimit(sql);

      const stmt = await conn.prepare(safeSql);
      for (let i = 0; i < params.length; i++) {
        const val = params[i];
        if (val === null || val === undefined) {
          stmt.bindNull(i + 1);
        } else if (typeof val === "number") {
          if (Number.isInteger(val)) {
            stmt.bindInteger(i + 1, val);
          } else {
            stmt.bindDouble(i + 1, val);
          }
        } else {
          stmt.bindVarchar(i + 1, String(val));
        }
      }
      const result = await stmt.run();
      const colNames = result.columnNames();
      const rawRows = await result.getRows();
      return buildResult(colNames, rawRows, start);
    });
  } catch (err) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      executionTimeMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

JSDoc update: remove "safe against injection" — replace with "Parameterized SQL executor. Uses native DuckDB prepared statements for both SELECT and DML."

### Fix 2 — Extract `buildResult` private helper

```typescript
// src/lib/sql-executor.ts — add before executeSQLInternal

function buildResult(
  colNames: string[],
  rawRows: unknown[][],
  start: number,
): QueryResult {
  const rows = rawRows.slice(0, MAX_RESULT_ROWS).map((row) => {
    const obj: Record<string, unknown> = {};
    colNames.forEach((col, i) => {
      const val = row[i];
      obj[col] = typeof val === "bigint" ? Number(val) : val;
    });
    return obj;
  });
  return {
    columns: colNames,
    rows,
    rowCount: rows.length,
    executionTimeMs: Math.round(performance.now() - start),
  };
}
```

Each of the three functions' success paths then collapses to:

```typescript
const colNames = result.columnNames();
const rawRows = await result.getRows();
return buildResult(colNames, rawRows, start);
```

## Affected Files

| File | Change |
|------|--------|
| `src/lib/sql-executor.ts` | Remove DML branch (lines 93–121), add `buildResult` helper, update JSDoc |

No other files change. All callers are unaffected.

## Known Callers — DML Templates Inventory

All current DML callers confirmed to use hardcoded SQL templates with `$N` params only:

| File | Statement | Params |
|------|-----------|--------|
| `src/app/api/segments/route.ts:57` | `INSERT INTO segments (...) VALUES ($1,$2,$3,$4,$5)` | `[id, name, sql, userCount, sourceConversationId]` |
| `src/app/api/segments/[id]/route.ts:59` | `UPDATE segments SET ... WHERE id = $N` (dynamic sets) | `[...fieldValues, id]` |
| `src/app/api/segments/[id]/route.ts:75` | `DELETE FROM segments WHERE id = $1` | `[id]` |
| `src/app/api/segments/[id]/push/route.ts:33` | `UPDATE segments SET push_status = $1 WHERE id = $2` | `[newStatusJson, id]` |
| `src/app/api/integrations/route.ts:30` | `UPDATE integrations SET connected = ${connected}... WHERE id = $1` | `[id]` ← mixed interpolation |

**Note on `integrations/route.ts`:** The `connected` boolean and `lastSynced` timestamp are directly interpolated into the SQL template string (not via `$N` params). With the new path these are baked into the SQL string before `conn.prepare()`, so DuckDB sees a fully-resolved template — the binding only handles `id`. This is safe because `connected` is a JS boolean (`true`/`false`) and `lastSynced` is constructed server-side from `Date.now()`. No change needed for this caller, but worth noting in the commit message.

## Acceptance Criteria

- [x] `executeSQLPrepared` has no manual string interpolation / `String.replace` escaping
- [x] The same `conn.prepare()` + `stmt.bind*()` path handles INSERT, UPDATE, DELETE
- [x] DML statements skip `ensureLimit()` (not prepended with `LIMIT 500`)
- [x] DML results return `rowCount: 0, rows: [], columns: []` (unchanged from current behavior)
- [x] JSDoc on `executeSQLPrepared` no longer claims "safe against injection" as a blanket guarantee — replace with accurate description
- [x] `buildResult` private helper extracted and used by all three executor functions
- [x] No duplicated `rawRows.slice().map()` blocks remain
- [x] All existing Playwright tests pass: `valid SELECT`, `non-SELECT 400`, `DDL 400`, `invalid SQL 400`, `missing sql 400`, `query without LIMIT capped at 500`
- [x] `pnpm lint` — 0 errors

## References

- `src/lib/sql-executor.ts` — full file (lines 1–212)
- `todos/009-pending-p1-executesqlprepared-dml-branch-false-injection-safety.md`
- `todos/010-pending-p2-sqlexecutor-row-mapping-helper-not-extracted.md`
- `@duckdb/node-api` type: `DuckDBPreparedStatement.d.ts` — `statementType` getter confirms INSERT/UPDATE/DELETE are valid prepared statement types
- `@duckdb/node-api` type: `DuckDBConnection.d.ts:41` — `prepare(sql: string): Promise<DuckDBPreparedStatement>` accepts any SQL
