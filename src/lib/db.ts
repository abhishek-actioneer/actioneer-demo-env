import { DuckDBInstance, DuckDBInstanceCache, DuckDBConnection } from "@duckdb/node-api";
import { getDataset, DEFAULT_DATASET } from "./datasets";
import { getDataDir, resolveRepoDataPath } from "./data-dir";

const DATA_DIR = getDataDir();

// ── DuckDB native object lifecycle ──
//
// Strategy: pin DuckDB *instances* on globalThis (expensive to create, safe to
// reuse), but create *connections* fresh per operation and close them
// deterministically in a finally block. This avoids the class of GC-induced
// double-free crashes ("pointer being freed was not allocated") that occur when
// a long-lived cached connection's child objects (DuckDBResult, PreparedStatement)
// are collected by GC during Next.js HMR module re-evaluation.
//
// Per-dataset queues serialize all operations so concurrent requests to the same
// dataset never overlap on the native layer.
interface DuckDBGlobal {
  __duckdb_instance_cache__?: DuckDBInstanceCache;
  __duckdb_instances__?: Map<string, DuckDBInstance>;
  __duckdb_queues__?: Map<string, { promise: Promise<unknown> }>;
  __duckdb_ready__?: Set<string>;
}

const g = globalThis as DuckDBGlobal;
if (!g.__duckdb_instance_cache__) g.__duckdb_instance_cache__ = new DuckDBInstanceCache();
if (!g.__duckdb_instances__) g.__duckdb_instances__ = new Map();
if (!g.__duckdb_queues__) g.__duckdb_queues__ = new Map();
if (!g.__duckdb_ready__) g.__duckdb_ready__ = new Set();

const instanceCache = g.__duckdb_instance_cache__;
const instances = g.__duckdb_instances__;
const queues = g.__duckdb_queues__;
const readyCache = g.__duckdb_ready__;

/**
 * Serialize a native DuckDB operation within a dataset's queue.
 * Operations for the same dataset run serially (prevents malloc crashes on shared connections).
 * Operations across different datasets run concurrently (restores parallel deep-mode queries).
 */
function enqueue<T>(dsId: string, fn: () => Promise<T>): Promise<T> {
  let q = queues.get(dsId);
  if (!q) {
    q = { promise: Promise.resolve() };
    queues.set(dsId, q);
  }
  const qRef = q;
  const next = qRef.promise.then(
    () => fn(),
    () => fn(),
  );
  qRef.promise = next.catch(() => {});
  return next;
}

/** Get or create a DuckDB instance for an arbitrary DB path, pinned to globalThis. */
export async function getOrCreateInstance(dbPath: string): Promise<DuckDBInstance> {
  let instance = instances.get(dbPath);
  if (!instance) {
    try {
      instance = await instanceCache.getOrCreateInstance(dbPath, {
        memory_limit: process.env.DUCKDB_MEMORY_LIMIT ?? "4GB",
        threads: process.env.DUCKDB_THREADS ?? "4",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // DuckDB WAL replay crash — delete the stale WAL and retry once.
      // This is a known DuckDB bug where ALTER TABLE with DEFAULT values
      // written to the WAL cannot be replayed after a process crash.
      if (msg.includes("WAL") || msg.includes("BindDefaultValues")) {
        const walPath = `${dbPath}.wal`;
        const { existsSync, unlinkSync } = await import("fs");
        if (existsSync(walPath)) {
          console.warn(`[db] WAL replay failed for ${dbPath} — removing stale WAL and retrying`);
          unlinkSync(walPath);
          instance = await instanceCache.getOrCreateInstance(dbPath, {
            memory_limit: process.env.DUCKDB_MEMORY_LIMIT ?? "4GB",
            threads: process.env.DUCKDB_THREADS ?? "4",
          });
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
    instances.set(dbPath, instance);
  }
  return instance;
}

export { enqueue };

/**
 * System table names that initConnection() creates for baby-sentinel internal use.
 * Upload routes must filter these out so they are never treated as user data.
 * Only the sentinel_-prefixed names are blocked. Bare names like "segments" or
 * "integrations" are too common in real-world datasets to block safely.
 */
export const SENTINEL_SYSTEM_TABLES = new Set([
  "sentinel_segments",
  "sentinel_integrations",
]);

/** Returns true if the table name is a baby-sentinel system table (case-insensitive). */
export function isSentinelSystemTable(name: string): boolean {
  return SENTINEL_SYSTEM_TABLES.has(name.toLowerCase());
}

/** Run one-time schema setup (views, system tables, seed data) for a dataset. */
async function ensureDatasetReady(datasetId: string, conn: DuckDBConnection): Promise<void> {
  const ds = getDataset(datasetId);
  const readyKey = ds.setupVersion ? `${datasetId}:${ds.setupVersion}` : datasetId;
  if (readyCache.has(readyKey)) return;

  // Always (re)create views so file paths match the current environment.
  // CREATE OR REPLACE VIEW is idempotent; readyCache ensures once-per-lifetime.
  if (ds.viewSQL) {
    const viewStatements = ds.viewSQL(DATA_DIR);
    for (const sql of viewStatements) {
      await conn.run(sql);
    }
  }

  // Create any missing summary tables (materialized aggregations).
  // These are expensive to build so we only create ones that don't exist yet.
  if (ds.summaryTableSQL && ds.summaryTableSQL.length > 0) {
    const existingResult = await conn.run(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'main' AND table_type = 'BASE TABLE'`
    );
    const existingRows = await existingResult.getRows();
    const existingTables = new Set(existingRows.map((r) => String(r[0])));

    const missing: string[] = [];
    for (const sql of ds.summaryTableSQL) {
      const match = sql.match(/CREATE\s+OR\s+REPLACE\s+TABLE\s+(\w+)/i);
      if (match && !existingTables.has(match[1])) {
        missing.push(sql);
      }
    }

    if (missing.length > 0) {
      console.log(`[db] Creating ${missing.length} missing summary tables for ${datasetId}...`);
      for (const sql of missing) {
        await conn.run(sql);
      }
      console.log(`[db] Summary tables created for ${datasetId}`);
    }
  }

  await conn.run(`
    CREATE TABLE IF NOT EXISTS sentinel_segments (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      sql VARCHAR NOT NULL,
      user_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      source_conversation_id VARCHAR,
      push_status VARCHAR DEFAULT '{}',
      description VARCHAR DEFAULT ''
    )
  `);
  // Migrate existing DBs that lack the description column.
  // No DEFAULT clause — DuckDB has a WAL replay bug with BindDefaultValues
  // that crashes on restart when DEFAULT values are present in ALTER TABLE.
  // New tables already get DEFAULT '' from CREATE TABLE above; existing rows
  // get NULL which is coerced to '' in application code.
  await conn.run(
    `ALTER TABLE sentinel_segments ADD COLUMN IF NOT EXISTS description VARCHAR`
  );

  await conn.run(`
    CREATE TABLE IF NOT EXISTS sentinel_integrations (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      icon VARCHAR DEFAULT '',
      description VARCHAR DEFAULT '',
      connected BOOLEAN DEFAULT false,
      last_synced TIMESTAMP
    )
  `);

  const countResult = await conn.run("SELECT COUNT(*) as cnt FROM sentinel_integrations");
  const countRows = await countResult.getRows();
  const count = Number(countRows[0][0]);
  if (count === 0) {
    await conn.run(`
      INSERT INTO sentinel_integrations (id, name, icon, description, connected, last_synced) VALUES
      ('firebase', 'Firebase', 'flame', 'Push user segments to Firebase Remote Config & Cloud Messaging for targeted push notifications and A/B tests.', true, CURRENT_TIMESTAMP),
      ('clevertap', 'CleverTap', 'bell', 'Sync segments to CleverTap for personalized engagement campaigns, journeys, and real-time user targeting.', true, CURRENT_TIMESTAMP),
      ('bigquery', 'BigQuery', 'database', 'Export segment data to BigQuery for advanced analytics, ML pipelines, and cross-platform data enrichment.', true, CURRENT_TIMESTAMP)
    `);
  }

  // Flush WAL to the main database file so there is nothing to replay on restart.
  // Without this, ALTER TABLE / INSERT statements written during setup remain in
  // the WAL and trigger a DuckDB WAL-replay bug (BindDefaultValues with no default
  // database set) on the next process start.
  await conn.run("CHECKPOINT");

  readyCache.add(readyKey);
}

/**
 * Serialize a DB operation through the per-dataset queue.
 * Creates a fresh connection, runs the operation, and closes it deterministically.
 * This prevents GC-induced double-free crashes from long-lived cached connections.
 */
export async function withConnection<T>(
  datasetId: string | undefined,
  fn: (conn: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const dsId = datasetId || DEFAULT_DATASET;
  const ds = getDataset(dsId);
  const dbPath = resolveRepoDataPath(ds.dbFile);

  return enqueue(dsId, async () => {
    const instance = await getOrCreateInstance(dbPath);
    const conn = await instance.connect();
    try {
      await ensureDatasetReady(dsId, conn);
      return await fn(conn);
    } finally {
      conn.closeSync();
    }
  });
}

/** @deprecated Use withConnection instead. Kept for backward compat with upload route. */
export async function getConnection(datasetId?: string): Promise<DuckDBConnection> {
  const dsId = datasetId || DEFAULT_DATASET;
  const ds = getDataset(dsId);
  const dbPath = resolveRepoDataPath(ds.dbFile);
  const instance = await getOrCreateInstance(dbPath);
  return instance.connect();
}

/** Check if a specific dataset's DB is ready. Tests the primary table. */
export async function isDBReady(datasetId?: string): Promise<boolean> {
  const dsId = datasetId || DEFAULT_DATASET;
  if (readyCache.has(dsId)) return true;
  try {
    await withConnection(dsId, async (conn) => {
      const ds = getDataset(dsId);
      const result = await conn.run(`SELECT 1 FROM ${ds.primaryTable} LIMIT 1`);
      await result.getRows();
    });
    return true;
  } catch {
    return false;
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────

async function gracefulShutdown(signal: string) {
  console.log(`[db] ${signal} received — draining DuckDB queues...`);
  await Promise.allSettled(
    Array.from(queues.values()).map((q) => q.promise)
  );
  for (const [path, instance] of instances) {
    try {
      instance.closeSync();
      console.log(`[db] closed instance: ${path}`);
    } catch { /* ignore */ }
  }
  console.log("[db] DuckDB shutdown complete");
  process.exit(0);
}

process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("SIGINT",  () => gracefulShutdown("SIGINT"));
