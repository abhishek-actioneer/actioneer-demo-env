// Read-only DuckDB query helper for authoring/validating seed content.
// Usage: node scripts/q.mjs <datasetId> "<SQL>"
//   datasetId maps to data/<datasetId>.duckdb
// Opens READ_ONLY so it is safe to run while nothing holds a write lock.
import { DuckDBInstance } from "@duckdb/node-api";
import { resolve } from "path";

const [, , datasetId, sql] = process.argv;
if (!datasetId || !sql) {
  console.error('Usage: node scripts/q.mjs <datasetId> "<SQL>"');
  process.exit(1);
}

const dbPath = resolve(process.cwd(), `data/${datasetId}.duckdb`);

const instance = await DuckDBInstance.create(dbPath, { access_mode: "READ_ONLY" });
const conn = await instance.connect();
try {
  const reader = await conn.runAndReadAll(sql);
  const rows = reader.getRowObjects();
  // BigInt-safe JSON
  console.log(
    JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2),
  );
} finally {
  conn.closeSync();
}
