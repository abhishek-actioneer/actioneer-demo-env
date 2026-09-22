import { DuckDBInstance, DuckDBInstanceCache } from "@duckdb/node-api";

// Reuse the same globalThis-pinned instance cache to prevent GC double-free
const g = globalThis as { __duckdb_instance_cache__?: DuckDBInstanceCache; __duckdb_instances__?: Map<string, DuckDBInstance> };
if (!g.__duckdb_instance_cache__) g.__duckdb_instance_cache__ = new DuckDBInstanceCache();
if (!g.__duckdb_instances__) g.__duckdb_instances__ = new Map();
const instanceCache = g.__duckdb_instance_cache__;
const instancePins = g.__duckdb_instances__;

export interface ColumnProfile {
  name: string;
  type: string;
  nullCount: number;
  totalCount: number;
  distinctCount: number;
  /** Up to 25 distinct values for low-cardinality columns */
  sampleValues: string[];
}

export interface TableProfile {
  tableName: string;
  rowCount: number;
  columns: ColumnProfile[];
  sampleRows: Record<string, unknown>[];
}

/** Quote a column name — always, since bare names can collide with SQL keywords (e.g. "table") */
function q(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

/**
 * Profile a single table: row count, per-column stats, sample rows, value enumerations.
 * Opens its own DuckDB connection so it can be used during upload (before the
 * main connection pool has this dataset registered).
 */
export async function profileTable(
  dbPath: string,
  tableName: string,
  viewSQL?: string[],
): Promise<TableProfile> {
  let instance = instancePins.get(dbPath);
  if (!instance) {
    instance = await instanceCache.getOrCreateInstance(dbPath);
    instancePins.set(dbPath, instance);
  }
  const conn = await instance.connect();

  // Optionally create views (needed for dynamic CSV datasets)
  if (viewSQL) {
    for (const sql of viewSQL) {
      await conn.run(sql);
    }
  }

  // Row count
  const countRes = await conn.run(`SELECT COUNT(*) FROM ${tableName}`);
  const countRows = await countRes.getRows();
  const rowCount = Number(countRows[0][0]);

  // Column metadata via DESCRIBE
  const descRes = await conn.run(`DESCRIBE ${tableName}`);
  const descRows = await descRes.getRows();
  const colDefs: { name: string; type: string }[] = [];
  for (const row of descRows) {
    colDefs.push({ name: String(row[0]), type: String(row[1]) });
  }

  // Sample rows (first 10)
  const sampleRes = await conn.run(`SELECT * FROM ${tableName} LIMIT 10`);
  const sampleResultRows = await sampleRes.getRows();
  const colNames = colDefs.map((c) => c.name);
  const sampleRows: Record<string, unknown>[] = sampleResultRows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < colNames.length; i++) {
      obj[colNames[i]] = row[i] === null ? null : String(row[i]);
    }
    return obj;
  });

  // Per-column stats: null count, distinct count
  // Batch into chunks of 10 columns to keep queries manageable
  const columns: ColumnProfile[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < colDefs.length; i += BATCH_SIZE) {
    const batch = colDefs.slice(i, i + BATCH_SIZE);
    const selectParts = batch.flatMap((col) => [
      `COUNT(*) - COUNT(${q(col.name)}) AS null_${i + batch.indexOf(col)}`,
      `COUNT(DISTINCT ${q(col.name)}) AS dist_${i + batch.indexOf(col)}`,
    ]);

    const statsRes = await conn.run(
      `SELECT ${selectParts.join(", ")} FROM ${tableName}`
    );
    const statsRows = await statsRes.getRows();
    const statsRow = statsRows[0];

    for (let j = 0; j < batch.length; j++) {
      const nullCount = Number(statsRow[j * 2]);
      const distinctCount = Number(statsRow[j * 2 + 1]);

      // Enumerate values for low-cardinality columns (< 30 distinct)
      let sampleValues: string[] = [];
      if (distinctCount > 0 && distinctCount <= 30) {
        try {
          const enumRes = await conn.run(
            `SELECT DISTINCT ${q(batch[j].name)}::VARCHAR AS v FROM ${tableName} WHERE ${q(batch[j].name)} IS NOT NULL ORDER BY v LIMIT 30`
          );
          const enumRows = await enumRes.getRows();
          sampleValues = enumRows.map((r) => String(r[0]));
        } catch {
          // Not critical — some types can't cast to VARCHAR cleanly
        }
      }

      columns.push({
        name: batch[j].name,
        type: batch[j].type,
        nullCount,
        totalCount: rowCount,
        distinctCount,
        sampleValues,
      });
    }
  }

  conn.closeSync();
  return { tableName, rowCount, columns, sampleRows };
}
