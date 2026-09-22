---
title: "feat: Upload DuckDB File for Multi-Table Datasets"
type: feat
date: 2026-03-02
deepened: 2026-03-02
---

# feat: Upload DuckDB File for Multi-Table Datasets

## Enhancement Summary

**Deepened on:** 2026-03-02
**Research agents used:** security-sentinel, performance-oracle, kieran-typescript-reviewer, architecture-strategist, deployment-verification-agent, julik-frontend-races-reviewer, data-integrity-guardian, best-practices-researcher (Next.js large files), framework-docs-researcher (@duckdb/node-api), code-simplicity-reviewer, pattern-recognition-specialist, learnings-researcher

### Key Improvements Discovered

1. **`await file.arrayBuffer()` is a hard OOM blocker** — a 500MB file doubles in heap before writing to disk. Must switch to `busboy` streaming on the `nodejs` runtime. This is a P0 ship blocker.
2. **Uploaded DuckDB files must be opened read-only with an isolated instance** — DuckDB files can contain macros, UDFs, and autoload extension instructions that execute on open. Never use the shared `DuckDBInstanceCache` for user-supplied files.
3. **`enrichDataset()` must receive ALL tables, not just primary** — the plan originally passed only the primary table to the enricher, which would break cross-table JOINs (contradicting the core success metric).
4. **sourceType should be a required field with a migration shim**, not optional — optional creates permanent `!raw.sourceType || raw.sourceType === "csv"` branches everywhere.
5. **Atomic config.json writes** (temp file + `renameSync`) prevent partial-write corruption that silently drops datasets on restart.
6. **Frontend timers not cleared in `finally`** — the progress setTimeout chain fires on dead/unmounted components; needs `canceled` flag + finally cleanup.

### New Constraints Discovered

- Railway has no body size cap at the proxy level, but has a hard **5-minute HTTP timeout** — a 500MB upload at 1 Mbps takes 67+ minutes and will never finish without presigned S3 URLs or chunked upload.
- `DuckDBInstanceCache.getOrCreateInstance()` ignores options — cached instances don't respect `access_mode: READ_ONLY`. Use `DuckDBInstance.create()` directly for ephemeral inspection connections.
- The tech debt plan (`2026-03-02-refactor-technical-debt-cleanup-plan.md`) already plans to separate `segments`/`integrations` from user data (Phase 3). The DuckDB upload writes these into the user's file — use `sentinel_` prefix as interim mitigation to avoid schema collisions.

---

## Overview

Users can currently upload CSV files to create datasets. This feature extends the upload flow to also accept `.duckdb` files, enabling multi-table datasets where the user supplies the database directly. Since a DuckDB file already contains fully-materialized tables (no view construction needed), the upload path branches at the file type check and follows a different — simpler — code path than CSV.

## Problem Statement / Motivation

The CSV upload creates a DuckDB-backed dataset with one view per CSV file. This is great for flat tabular data. But real analytics often require multiple related tables (orders + customers + products). Rather than requiring users to upload multiple CSVs and wait for view construction, they can upload a `.duckdb` file that already contains all their data. This is especially useful for users exporting from tools that natively produce DuckDB files.

## Proposed Solution

Extend the existing upload route (`/api/datasets/upload`) to accept `.duckdb` files alongside `.csv` files. When a `.duckdb` file is detected:

1. Stream the file to disk using `busboy` (never buffer in RAM)
2. Validate the DuckDB magic bytes (`DUCK` = 0x44 55 43 4B)
3. Open the file read-only with an **isolated** `DuckDBInstance` (bypassing the shared cache)
4. Enumerate all base tables via `SHOW TABLES`; validate names against `/^[a-zA-Z_][a-zA-Z0-9_]*$/`
5. Detect the primary table (largest by row count, via batched UNION ALL query)
6. Run `detectSpecialColumns()` on the primary table columns
7. Run LLM enrichment with all table schemas (same pipeline as CSV, `viewSQL: undefined`)
8. Register the dataset with `sourceType: "duckdb"` so server restarts skip CSV view reconstruction
9. Close and discard the inspection instance; production queries use a separate read-write instance via `getOrCreateInstance()`

On the frontend: change `accept` to `.csv,.duckdb`, strip `.duckdb` from label derivation, fix timer cleanup in `finally`.

## Technical Considerations

### Architecture Impacts

**`sourceType` as a required field with migration shim**

Make `sourceType` required in `DatasetConfig` (not optional) to avoid permanent `!raw.sourceType || raw.sourceType === "csv"` branches:

```typescript
// src/lib/datasets/types.ts
export type DatasetSourceType = "csv" | "duckdb";

// In DatasetConfig:
sourceType: DatasetSourceType;  // required
```

In `dynamic-registry.ts`, add a migration shim immediately after JSON.parse so old `config.json` files without the field are treated as CSV:

```typescript
const raw = JSON.parse(readFileSync(configPath, "utf-8")) as DatasetConfig;
raw.sourceType = raw.sourceType ?? "csv";  // migration: all existing datasets are CSV
```

The guard in `ensureLoaded()` then becomes simply:
```typescript
if (raw.sourceType === "csv") {
  // reconstruct viewSQL from sourceFiles
}
// DuckDB: no viewSQL needed, tables already exist in the file
```

**Two-phase DuckDB connection strategy**

- **Phase 1 (inspection)**: `DuckDBInstance.create(uploadedPath, { access_mode: "READ_ONLY", autoinstall_known_extensions: "false", autoload_known_extensions: "false" })` — isolated instance, never added to `globalThis.__duckdb_instances__`, closed with `instance.closeSync()` after schema extraction.
- **Phase 2 (production)**: `getOrCreateInstance(dbPath)` from `src/lib/db.ts` — the existing singleton pattern, read-write, registered in `globalThis`. This instance is what all analytics queries use.

This separation ensures malicious DuckDB content (macros, UDFs, autoloaded extensions) cannot poison the shared connection pool.

**`enrichDataset()` must receive ALL tables**

The CSV path correctly passes all tables to the enricher. The DuckDB path must do the same:

```typescript
await enrichDataset({
  dbPath,
  datasetDir,
  tables: tableNames.map(name => ({ tableName: name, viewSQL: undefined })),
  label,
});
```

Passing only the primary table would produce a schema context that hides secondary tables from SQL generation — directly breaking cross-table JOINs.

**`detectSpecialColumns()` on the primary table**

Call `detectSpecialColumns(primary.columns)` after schema enumeration, exactly as the CSV path does. This populates `dateField`, `userIdField`, and `dateRange` on the dataset config — critical for cohort/retention agents and `reportMeta.totalUsers`.

**`sourceFiles` semantics**

Store `sourceFiles: [basename]` for audit/display only. The `sourceType === "csv"` guard in `dynamic-registry.ts` ensures it is never fed into the `read_csv()` reconstruction path for DuckDB datasets.

**`sentinel_` prefix for system tables (interim mitigation)**

The tech debt plan (Phase 3) will separate `segments`/`integrations` from analytics data. Until then, rename the injected tables to `sentinel_segments` and `sentinel_integrations` in `db.ts:initConnection()` to avoid collisions with user tables. This requires updating all queries that reference `segments`/`integrations` across the codebase.

> Alternative: check for name collisions in `initConnection()` and log a warning if the user's file already contains `segments` or `integrations`. Either approach unblocks the feature; the rename is cleaner.

**Atomic `config.json` writes**

Replace `writeFileSync(configPath, JSON.stringify(...))` with a temp-file-then-rename pattern to prevent partial writes from silently dropping datasets on restart:

```typescript
// src/lib/datasets/dynamic-registry.ts — saveDynamicDataset()
const tmpPath = configPath + ".tmp";
writeFileSync(tmpPath, JSON.stringify(serializable, null, 2));
renameSync(tmpPath, configPath);  // atomic on POSIX — crash-safe
```

**Remove `reloadDynamicDatasets()` from the upload route**

`saveDynamicDataset()` already calls `cache.set(config.id, config)`. The subsequent `reloadDynamicDatasets()` call clears the cache and rebuilds from disk — redundant work that adds synchronous I/O to the critical path. Remove the `reloadDynamicDatasets()` call from the upload route entirely.

### Security Considerations

**DuckDB magic byte validation** — check before opening:

```typescript
const DUCKDB_MAGIC = Buffer.from([0x44, 0x55, 0x43, 0x4B]); // "DUCK"
const header = buffer.subarray(0, 4);
if (!header.equals(DUCKDB_MAGIC)) {
  return Response.json({ error: "File is not a valid DuckDB database" }, { status: 400 });
}
```

**Read-only isolated inspection** — critical. Do NOT use `DuckDBInstanceCache.getOrCreateInstance()` for the uploaded file during inspection:

```typescript
// src/app/api/datasets/upload/route.ts — handleDuckDBUpload()
const inspectInstance = await DuckDBInstance.create(uploadedPath, {
  access_mode: "READ_ONLY",
  autoinstall_known_extensions: "false",
  autoload_known_extensions: "false",
  threads: "1",
});
let conn: DuckDBConnection | undefined;
try {
  conn = await inspectInstance.connect();
  // ... enumerate tables, describe, count ...
} finally {
  conn?.closeSync();
  inspectInstance.closeSync();  // discard — never add to globalThis
}
```

**Path traversal** — use `path.basename()` on every uploaded filename before any `path.join()`. This is an existing bug on the CSV path and must be fixed simultaneously:

```typescript
const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9.\-_]/g, "_");
const destPath = path.join(datasetDir, safeName);
// Confinement check
if (!destPath.startsWith(datasetDir + "/")) {
  return Response.json({ error: "Invalid filename" }, { status: 400 });
}
```

**Table name validation** — validate names from `SHOW TABLES` before using them in any SQL:

```typescript
const SAFE_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const safeTables = allTables.filter(name => {
  const ok = SAFE_TABLE_NAME.test(name);
  if (!ok) console.warn(`[upload] skipping table "${name}" — unsafe name`);
  return ok;
});
if (safeTables.length === 0) {
  return Response.json({ error: "No tables with valid names found in the DuckDB file" }, { status: 400 });
}
```

**Always double-quote identifiers** in DESCRIBE and other generated SQL:

```typescript
const quoted = `"${tableName.replace(/"/g, '""')}"`;
await conn.runAndReadAll(`DESCRIBE ${quoted}`);
```

### Performance Implications

**Streaming upload with busboy (P0 — blocks ship)**

`await file.arrayBuffer()` allocates the entire file in the Node.js heap. For a 500MB file on a Railway container with 256MB DuckDB memory + 80MB baseline, peak RSS exceeds the container limit before the Buffer write even completes.

Replace with busboy streaming:

```typescript
// src/app/api/datasets/upload/route.ts
export const runtime = "nodejs";         // required for Node.js streams
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// In POST handler — use busboy instead of req.formData()
import busboy from "busboy";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const bb = busboy({
  headers: Object.fromEntries(req.headers),
  limits: { fileSize: 500 * 1024 * 1024, files: 1, fields: 10 },
});
// pipe to fs.createWriteStream — memory usage stays ~64KB per chunk regardless of file size
const nodeStream = Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]);
nodeStream.pipe(bb);
```

**Railway 5-minute hard timeout**

Railway's proxy has a fixed 5-minute HTTP timeout that cannot be overridden. At 1 Mbps, a 500MB file takes ~67 minutes. For files larger than ~200MB, the practical approach is presigned S3 upload:

1. Client requests a presigned PUT URL from `/api/upload-url`
2. Client uploads directly to S3, bypassing Railway's proxy entirely
3. Client notifies `/api/upload-complete` with the S3 key
4. Server downloads from S3 to `data/datasets/<id>/` and proceeds with enrichment

For the initial MVP, cap at **150MB** (uploads complete within ~2 minutes on 10 Mbps). Document the ceiling clearly in the UI.

**Batch COUNT queries** with a single UNION ALL instead of N serial queries:

```typescript
// Instead of N serial queries:
const unionSQL = tableNames
  .map(t => `SELECT '${t}' AS tbl, COUNT(*) AS cnt FROM "${t}"`)
  .join(" UNION ALL ");
const reader = await conn.runAndReadAll(unionSQL);
const rows = reader.getRowObjects() as Array<{ tbl: string; cnt: bigint }>;
rows.sort((a, b) => (b.cnt > a.cnt ? 1 : -1));
const primaryTable = rows[0].tbl;
```

**Cap enrichment tables at 20** (not 10) — just slice the sorted list:

```typescript
const tablesToEnrich = rows.slice(0, 20).map(r => r.tbl);
// No row-count sort complexity — already sorted from the COUNT step above
```

**Make `generateMetricDefinitions` non-blocking** — it uses `gemini-pro` and writes to `metrics.json` independently. Fire without `await` to remove 15-30s from the critical path.

### Constraints / Non-Goals

- Only a single `.duckdb` file per upload operation. If multiple `.duckdb` files are selected, take the first.
- Mixed CSV+DuckDB in one operation: server rejects with a 400. No client-side guard needed (YAGNI for a demo).
- No user-selectable primary table — row count heuristic only.
- Label collision: return a 400 with "A dataset with this name already exists" (not a 409 — no concurrent conflict semantics apply in a single-user demo).
- File size: hard cap at **150MB** for initial MVP. Document presigned S3 path for larger files if needed later.

## Acceptance Criteria

- [x] `.duckdb` files can be uploaded via the workspace dropdown (file input accepts `.csv,.duckdb`)
- [x] The sidebar file input strips `.duckdb` extension from the auto-derived label
- [x] After upload, the dataset appears in the workspace switcher with the correct label
- [x] **All tables** in the DuckDB file are included in the schema context used for SQL generation
- [x] A question requiring a JOIN across tables in the uploaded file returns a correct answer
- [x] The primary table is auto-detected by row count; `dateField`/`userIdField` are detected if present
- [x] After a server restart, a DuckDB-sourced dataset loads without attempting CSV view reconstruction
- [x] Uploading a `.duckdb` file with zero valid-named base tables returns a 400 with a message
- [x] Uploading a file that fails the magic byte check returns a 400
- [x] Uploading a file with the same label as an existing dataset returns a 400
- [x] Deleting a DuckDB-sourced dataset removes the dataset directory (same as CSV)
- [x] Path traversal via malicious filenames is blocked (basename sanitization)
- [x] `config.json` is written atomically (temp file + rename) — no partial-write corruption
- [x] Upload progress timers are cleared in the `finally` block, even on network errors or component unmount
- [x] Files above 150MB are rejected with a clear message before upload begins

## Files to Change

### Backend

**`package.json`**
- Add `busboy` dependency

**`src/lib/datasets/types.ts`**
- Change `sourceType?: "csv" | "duckdb"` → `sourceType: DatasetSourceType` (required)
- Export `type DatasetSourceType = "csv" | "duckdb"`
- Export `type SerializableDatasetConfig = Omit<DatasetConfig, "viewSQL">`

**`src/lib/datasets/dynamic-registry.ts`**
- Add migration shim: `raw.sourceType = raw.sourceType ?? "csv"` after JSON.parse
- Replace viewSQL reconstruction guard: `if (raw.sourceType === "csv") { ... }`
- Replace `writeFileSync(configPath, ...)` with temp-file + `renameSync` in `saveDynamicDataset()`
- All CSV datasets do NOT need explicit `sourceType: "csv"` set — the migration shim handles it

**`src/app/api/datasets/upload/route.ts`**
- Add `export const runtime = "nodejs"`, `export const maxDuration = 120`, `export const dynamic = "force-dynamic"`
- Replace `req.formData()` with `busboy` streaming for the entire handler
- Use `path.basename(file.name)` for all save paths (path traversal fix for CSV path too)
- Change file filter to accept both `.csv` and `.duckdb`
- Reject label collisions with 400 before creating directories
- Add new `handleDuckDBUpload(options: DuckDBUploadOptions): Promise<SerializableDatasetConfig>` function:
  1. Stream file to `data/datasets/<id>/<id>.duckdb` via busboy WriteStream
  2. Validate magic bytes from first 4 bytes of file
  3. Open isolated read-only `DuckDBInstance.create(path, { access_mode: "READ_ONLY", ... })`
  4. `SHOW TABLES` → validate names → batch COUNT via UNION ALL → sort → pick primary (top 20 for enrichment)
  5. `DESCRIBE "<table>"` for each (double-quoted) → `detectSpecialColumns(primary.columns)`
  6. Close inspection instance (`conn.closeSync()` + `instance.closeSync()`)
  7. Call `enrichDataset({ dbPath, datasetDir, tables: all.map(t => ({ tableName: t, viewSQL: undefined })), label })`
  8. Call `saveDynamicDataset({ ..., sourceType: "duckdb", sourceFiles: [basename], isDynamic: true })`
  9. **Do NOT call `reloadDynamicDatasets()`** — `saveDynamicDataset` already updates the cache
  10. Open production instance via `getOrCreateInstance(dbPath)` from `db.ts` (the singleton, read-write)
  11. Return `SerializableDatasetConfig`
- Cleanup in catch: `rmSync(datasetDir, { recursive: true, force: true })` to prevent orphaned directories
- Remove `reloadDynamicDatasets()` call from the CSV path too (redundant)

**`src/lib/db.ts`**
- Rename `segments` → `sentinel_segments` and `integrations` → `sentinel_integrations` in `initConnection()` DDL
- Update all references to these table names in queries throughout `db.ts`

**`next.config.ts`**
- No changes needed for App Router body parser — handled via `busboy` + `runtime = "nodejs"` in the route

### Frontend

**`src/components/sidebar/panels.tsx`**
- Change `accept=".csv"` to `accept=".csv,.duckdb"`
- Change label regex from `/\.csv$/i` to `/\.(csv|duckdb)$/i`
- Change button label from "Upload CSV" to "Upload CSV or DuckDB"
- Add `if (uploadStatus) return;` guard at top of `onChange` handler (prevents concurrent uploads)
- Fix timer cleanup: move `let timers: ReturnType<typeof setTimeout>[] = []; let canceled = false;` before the try block; add `canceled = true; timers.forEach(clearTimeout)` in `finally` (not just in the success branch)
- Add client-side 150MB size check with a toast before the upload begins

## Success Metrics

A user can upload a `.duckdb` file containing 3+ tables, ask a question that requires a JOIN across those tables, and receive a correct answer — without any manual schema configuration.

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| Railway ephemeral filesystem | Railway Volume already at `/app/data` (covers `data/datasets/`). No new volume config needed per the railway-nixpacks solution doc. |
| Large file (>150MB) upload timeout | Hard cap at 150MB for MVP. Document presigned S3 path as the upgrade. |
| DuckDB macros/UDFs executing on open | Open user-supplied files in isolated read-only instance, never the shared cache. |
| DuckDB .tmp directory surviving OOM kill | Startup script already cleans stale `.tmp` dirs per fix-railway-oom-kill plan. Applies to uploaded DBs too. |
| Schema collision: `segments`/`integrations` in user's file | Rename to `sentinel_` prefix in `db.ts` as interim fix before Phase 3 of tech debt plan. |
| Partial config.json write on crash | Atomic write (temp + rename) eliminates this. |
| Orphaned directories on mid-upload crash | `rmSync(datasetDir)` in upload route's catch block. |
| Stale DuckDB connection on re-upload of same label | 400 on label collision prevents this; existing connection pool is not affected. |

## Implementation Ordering

To avoid compile errors and logic gaps, implement in this sequence:

1. `types.ts` — add `sourceType` (required), `DatasetSourceType`, `SerializableDatasetConfig`
2. `dynamic-registry.ts` — migration shim, `sourceType === "csv"` guard, atomic config write
3. `db.ts` — rename `segments`/`integrations` → `sentinel_*`; update all references
4. `upload/route.ts` — add `busboy`, `handleDuckDBUpload`, path traversal fixes, remove `reloadDynamicDatasets()`
5. `sidebar/panels.tsx` — accept attr, label regex, timer fix, size check

## Deployment Checklist

### Before merging

- [x] Add `export const maxDuration = 120` to `upload/route.ts`
- [x] Add `export const runtime = "nodejs"` to `upload/route.ts`
- [x] `busboy` in `package.json` dependencies
- [x] All `segments`/`integrations` references updated to `sentinel_*`

### Railway (do before code deploy)

- [ ] Confirm Railway Volume is already mounted at `/app/data` (covers `data/datasets/`)
- [ ] Confirm `DUCKDB_MEMORY_LIMIT` is set (recommend `512MB`)
- [ ] Confirm `DUCKDB_THREADS=1` (do NOT increase)

### Post-deploy verification

```bash
# Confirm uploads directory is writable
ls -la /app/data/datasets

# Smoke test: upload a small .duckdb file
curl -X POST https://<domain>/api/datasets/upload \
  -H "Cookie: session=<cookie>" \
  -F "label=Test DB" \
  -F "file=@test.duckdb"
# Expected: 200 with id, label, primaryTable

# Verify persistence: redeploy, then re-check
curl -H "Cookie: session=<cookie>" https://<domain>/api/datasets
# Uploaded dataset must still appear
```

### Rollback procedure

1. Deploy previous commit — upload UI/API reverts, but `.duckdb` files remain on Railway Volume
2. Dynamic registry on restart will read `config.json` files — previously uploaded datasets remain accessible if they have valid `config.json`
3. If full purge needed: `rm -rf /app/data/datasets/*` in Railway shell (irreversible)

## References & Research

### Internal References
- CSV upload route: `src/app/api/datasets/upload/route.ts`
- Dynamic registry (rehydration): `src/lib/datasets/dynamic-registry.ts:24`
- DuckDB connection singleton: `src/lib/db.ts:61-71`
- Dataset types: `src/lib/datasets/types.ts`
- Sidebar upload UI: `src/components/sidebar/panels.tsx:562-632`
- Enrichment pipeline: `src/lib/schema-enricher.ts`
- Column detection: `src/lib/datasets/utils.ts` → `detectSpecialColumns()`

### Institutional Learnings
- Railway ephemeral filesystem + volume layout: `docs/solutions/best-practices/railway-ephemeral-filesystem-dynamic-datasets-Deployment-20260223.md`
- DuckDB connection leak crash pattern: `docs/solutions/database-issues/duckdb-connection-leak-server-crash-System-20260219.md`
- Railway nixpacks + DuckDB ABI: `docs/solutions/build-errors/railway-nixpacks-pnpm-healthcheck-configuration-Deployment-20260224.md`
- OOM kill + DuckDB .tmp directory: `docs/plans/2026-03-02-fix-railway-oom-kill.md`
- Phase 3 separation of operational tables: `docs/plans/2026-03-02-refactor-technical-debt-cleanup-plan.md`

### External References
- busboy streaming in Next.js App Router: https://dev.to/grimshinigami/how-to-handle-large-filefiles-streams-in-nextjs-13-using-busboymulter-25gb
- Next.js Route Segment Config (maxDuration, runtime): https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
- Railway 5-minute timeout constraint: https://station.railway.com/questions/any-workarounds-for-the-5-min-request-ti-b055adde
- @duckdb/node-api — read-only mode, WAL behavior, closeSync: local node_modules + DuckDB configuration docs
