---
title: "DuckDB @duckdb/node-api v1: correct usage patterns for standalone scripts"
problem_type: database-issues
tags:
  - duckdb
  - node-api
  - cjs-esm
  - file-lock
  - bigint-serialization
  - parquet
  - standalone-scripts
component: src/lib/db.ts
symptoms:
  - "Cannot find module 'duckdb' — wrong package name used"
  - "Named export 'Database' not found — ESM named import on CJS module"
  - "Cannot read properties of undefined (reading 'create') — wrong export destructured"
  - "result.readAll(...) is not a function or its return value is not async iterable — wrong result API"
  - "chunk.columnName is not a function — wrong chunk API"
  - "Cannot read properties of undefined (reading 'length') — getRowObjects() fails"
  - "Do not know how to serialize a BigInt — COUNT results are BigInt"
  - "Could not set lock on file 'data/ecommerce.duckdb' — dev server holds exclusive write lock"
date: 2026-03-11
related:
  - docs/solutions/database-issues/duckdb-connection-leak-server-crash-System-20260219.md
---

# DuckDB `@duckdb/node-api` v1: Correct Usage Patterns for Standalone Scripts

## Root Cause

Two compounding problems:

1. **API shape confusion.** `@duckdb/node-api` (v1.4.4-r.1) is a completely different package from the legacy `duckdb` npm package. The exports, result iteration, and column access APIs are entirely different. None of the legacy `duckdb` patterns transfer.

2. **Exclusive write lock.** DuckDB takes an exclusive write lock on its `.duckdb` file — including the WAL — even for read-only connections when another process (e.g., the Next.js dev server) holds the file open. `access_mode: 'READ_ONLY'` does **not** bypass this; DuckDB still needs to coordinate WAL state across processes, and it can't if the WAL is already locked.

## What Didn't Work

| Attempt | Error | Why |
|---|---|---|
| `require('duckdb')` | MODULE_NOT_FOUND | Wrong package; installed package is `@duckdb/node-api` |
| `import { Database } from '@duckdb/node-api'` | Named export not found | The package is CJS; named ESM destructuring returns `undefined` |
| `const { Database } = require('@duckdb/node-api')` | `undefined.create(...)` | The export is `DuckDBInstance`, not `Database` |
| `result.readAll()` | Not a function | `conn.run()` result only has `chunkCount` + `getChunk(i)`; use `conn.stream()` instead |
| `chunk.columnName(i)` | Not a function | Column metadata lives on the **reader** (from `conn.stream()`), not on chunks |
| `chunk.getRowObjects()` | Cannot read 'length' | Method doesn't exist on chunks in this version |
| `JSON.stringify(result)` | Cannot serialize BigInt | COUNT/SUM results are BigInt; must coerce before serializing |
| `DuckDBInstance.create('data/ecommerce.duckdb', { access_mode: 'READ_ONLY' })` | Lock conflict | Dev server holds exclusive WAL lock; READ_ONLY does not bypass it |

## Working Solution

Use `:memory:` to sidestep the file lock entirely, then load from the source parquet files directly via `read_parquet()`.

```javascript
// scripts/query-duckdb.cjs
// SAFE TO RUN ALONGSIDE DEV SERVER: yes (reads parquet, no file lock)

const duckdb = require('@duckdb/node-api');

async function main() {
  // :memory: avoids all file locking — dev server can stay running
  const inst = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await inst.connect();

  try {
    // Load from parquet — these files are not locked by DuckDB's WAL
    await conn.run("CREATE VIEW events AS SELECT * FROM read_parquet('data/parquet/*.parquet')");

    const run = async (sql) => {
      // conn.stream() returns a reader with column metadata
      const reader = await conn.stream(sql);

      // Column names are on the READER, not on chunks
      const names = [];
      for (let i = 0; i < reader.columnCount; i++) {
        names.push(reader.columnName(i));
      }

      // getColumnsJson() returns column-major format: array of column arrays
      // e.g. [ [col0_row0, col0_row1, ...], [col1_row0, col1_row1, ...] ]
      const cols = await reader.getColumnsJson();
      const nRows = cols[0] ? cols[0].length : 0;

      const rows = [];
      for (let r = 0; r < nRows; r++) {
        const row = {};
        for (let c = 0; c < names.length; c++) {
          const v = cols[c][r];
          // BigInt (from COUNT/SUM) must be coerced before JSON.stringify
          row[names[c]] = typeof v === 'bigint' ? Number(v) : v;
        }
        rows.push(row);
      }
      return rows;
    };

    const results = await run('SELECT COUNT(*) as n FROM events');
    console.log(JSON.stringify(results)); // [{"n":109950743}]

    const monthly = await run(`
      SELECT
        strftime(DATE_TRUNC('month', event_time::TIMESTAMP), '%Y-%m') AS month,
        COUNT(DISTINCT user_id) AS unique_users,
        COUNT(CASE WHEN event_type='purchase' THEN 1 END) AS purchases,
        ROUND(SUM(CASE WHEN event_type='purchase' THEN price ELSE 0 END), 0) AS revenue
      FROM events
      GROUP BY 1 ORDER BY 1
    `);
    console.log(JSON.stringify(monthly, null, 2));

  } finally {
    // Always close — releases any held resources
    // Note: DuckDBInstance has no .close() method in v1.4.4-r.1;
    // process exit is sufficient for :memory: instances
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
```

## Key API Facts

| Concern | Correct API |
|---|---|
| Package import | `const duckdb = require('@duckdb/node-api')` (CJS only) |
| Top-level export | `duckdb.DuckDBInstance` (not `Database`, not `DuckDBDatabase`) |
| Create instance | `await DuckDBInstance.create(':memory:')` or `await DuckDBInstance.create('file.duckdb')` |
| Get connection | `await inst.connect()` |
| Run DDL / no result | `await conn.run(sql)` |
| Run SELECT with results | `const reader = await conn.stream(sql)` |
| Column count | `reader.columnCount` |
| Column name | `reader.columnName(i)` — on the **reader**, not on chunks |
| Fetch all data | `await reader.getColumnsJson()` — **column-major**: array of column arrays |
| BigInt handling | `typeof v === 'bigint' ? Number(v) : v` before JSON.stringify |
| File lock bypass | Use `':memory:'` + `read_parquet('data/parquet/*.parquet')` |

## Prevention Strategies

- **Default to `:memory:` for all read scripts.** Add a comment at the top of every script: `// SAFE TO RUN ALONGSIDE DEV SERVER: yes/no`. Only open the file DB when you need the pre-materialized summary tables, and document that `pnpm dev` must be stopped first.

- **`READ_ONLY` mode does not bypass WAL locks.** If you see a lock conflict, `:memory:` + parquet is the only safe path without stopping the server.

- **BigInt is everywhere.** `COUNT(*)`, `SUM(...)`, and `user_id` (BIGINT column) all produce BigInt values. Always pass results through a serializer before `JSON.stringify`.

- **`conn.stream()` over `conn.run()` for result sets.** `stream()` gives you the typed reader with `columnName()` and `getColumnsJson()`. `run()` gives you a chunk-only result with a harder-to-use API.

- **Column metadata lives on the reader, not the chunk.** After `conn.stream(sql)`, read `reader.columnCount` and `reader.columnName(i)` _before_ iterating data. Chunks only hold values.

- **Use `.cjs` extension or `"type": "commonjs"` for scripts.** `@duckdb/node-api` is CJS. If your project has `"type": "module"` in package.json, name scripts `.cjs` to avoid ESM/CJS boundary errors.

## When to Use `:memory:` vs File DB

**Use `:memory:` + `read_parquet()` when:**
- Dev server may be running (default assumption)
- Script is read-only and parquet is the source of truth
- You want CI-portable scripts (no pre-existing `.duckdb` required)

**Use file DB when (dev server must be stopped first):**
- You need pre-materialized summary tables (`daily_metrics`, `brand_metrics`, etc.) that only exist inside `.duckdb` and are expensive to recompute
- Running a one-time setup/migration (`scripts/setup-data.ts`)

## Related

- [DuckDB connection leak & SIGBUS crash](./duckdb-connection-leak-server-crash-System-20260219.md) — companion doc covering the singleton connection pattern inside the Next.js app itself; explains why the dev server holds an exclusive lock
