import { executeSQLInternal } from "@/lib/sql-executor";
import { DEFAULT_DATASET } from "@/lib/datasets";
import { isSentinelSystemTable } from "@/lib/db";
import type { CatalogTable, CatalogColumn, ColumnTypeCategory } from "@/lib/catalog-types";

function classifyColumnType(duckdbType: string): ColumnTypeCategory {
  const t = duckdbType.toUpperCase();
  if (/INT|BIGINT|DOUBLE|FLOAT|DECIMAL|NUMERIC|REAL|HUGEINT|SMALLINT|TINYINT/.test(t)) return "numeric";
  if (/DATE|TIME|TIMESTAMP|INTERVAL/.test(t)) return "temporal";
  if (/VARCHAR|TEXT|CHAR|STRING|BLOB|UUID/.test(t)) return "text";
  return "identifier";
}

function isIdColumn(name: string): boolean {
  const n = name.toLowerCase();
  return n === "id" || n.endsWith("_id") || n.endsWith("id") || n === "uuid";
}

// The dataset catalog (tables + columns + row counts) is effectively static
// during a session. The schema/column discovery is fast, but the per-table
// COUNT(*) scans (millions of rows on CSV-backed tables) are what made the page
// take 4-5s. So the page now loads structure first (instant paint) and fetches
// row counts as a non-blocking follow-up. Both parts are cached per dataset.
const structureCache = new Map<string, { tables: CatalogTable[]; ts: number }>();
const countsCache = new Map<string, { counts: Record<string, number>; ts: number }>();
const CATALOG_TTL_MS = 30 * 60 * 1000;

async function discoverStructure(datasetId: string): Promise<CatalogTable[] | null> {
  const cached = structureCache.get(datasetId);
  if (cached && Date.now() - cached.ts < CATALOG_TTL_MS) return cached.tables;

  const colsResult = await executeSQLInternal(
    `SELECT table_name, column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'main'
     ORDER BY table_name, ordinal_position`,
    datasetId
  );
  if (colsResult.error || colsResult.rows.length === 0) return null;

  const tableMap = new Map<string, CatalogColumn[]>();
  for (const row of colsResult.rows) {
    const tableName = String(row.table_name);
    if (isSentinelSystemTable(tableName)) continue;
    if (!tableMap.has(tableName)) tableMap.set(tableName, []);
    const colName = String(row.column_name);
    tableMap.get(tableName)!.push({
      name: colName,
      type: String(row.data_type),
      typeCategory: isIdColumn(colName) ? "identifier" : classifyColumnType(String(row.data_type)),
      nullable: row.is_nullable === "YES",
    });
  }

  // rowCount starts at 0 — filled in by the counts request.
  const tables: CatalogTable[] = Array.from(tableMap.entries()).map(([name, columns]) => ({
    name,
    rowCount: 0,
    columns,
  }));
  structureCache.set(datasetId, { tables, ts: Date.now() });
  return tables;
}

async function discoverCounts(datasetId: string): Promise<Record<string, number>> {
  const cached = countsCache.get(datasetId);
  if (cached && Date.now() - cached.ts < CATALOG_TTL_MS) return cached.counts;

  const structure = await discoverStructure(datasetId);
  const tableNames = (structure ?? []).map((t) => t.name);
  const counts: Record<string, number> = {};
  if (tableNames.length > 0) {
    // One UNION ALL of per-table COUNT(*) instead of N queued queries.
    const countSql = tableNames
      .map(
        (t) =>
          `SELECT '${t.replace(/'/g, "''")}' AS tbl, COUNT(*) AS cnt FROM "${t.replace(/"/g, '""')}"`,
      )
      .join(" UNION ALL ");
    const countResult = await executeSQLInternal(countSql, datasetId);
    for (const row of countResult.rows) {
      counts[String(row.tbl)] = Number(row.cnt);
    }
  }
  countsCache.set(datasetId, { counts, ts: Date.now() });
  return counts;
}

export async function GET(req: Request) {
  try {
    const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
    // counts=skip → structure only (fast paint); counts=only → row counts only
    // (non-blocking follow-up); default → both (back-compat for any other caller).
    const mode = new URL(req.url).searchParams.get("counts");

    if (mode === "only") {
      return Response.json({ counts: await discoverCounts(datasetId) });
    }

    const tables = await discoverStructure(datasetId);
    if (!tables) return Response.json({ tables: [] });

    if (mode === "skip") {
      return Response.json({ tables });
    }

    // Default: merge counts in so existing callers still get a complete payload.
    const counts = await discoverCounts(datasetId);
    return Response.json({
      tables: tables.map((t) => ({ ...t, rowCount: counts[t.name] ?? 0 })),
    });
  } catch (err) {
    return Response.json(
      { tables: [], error: err instanceof Error ? err.message : "Failed to discover schema" },
      { status: 500 },
    );
  }
}
