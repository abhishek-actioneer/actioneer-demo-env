import { executeSQL } from "./sql-executor";
import { getDataset } from "./datasets";
import { getDataDir } from "./data-dir";

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
}

export interface SchemaInfo {
  tables: TableInfo[];
  tableNames: string[];
}

const DATA_DIR = getDataDir();

const PUBLIC_INTERNAL_TABLES = new Set([
  "dataset_now",
  "sentinel_segments",
  "sentinel_integrations",
]);

function extractCreatedRelationNames(sqlStatements: string[]): Set<string> {
  const names = new Set<string>();
  const relationRegex =
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:VIEW|TABLE)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-z_][a-z0-9_]*)["`]?/gi;

  for (const sql of sqlStatements) {
    let match: RegExpExecArray | null;
    while ((match = relationRegex.exec(sql)) !== null) {
      names.add(match[1].toLowerCase());
    }
  }
  return names;
}

function expectedStaticDatasetRelations(datasetId?: string): Set<string> | null {
  if (!datasetId) return null;

  const dataset = getDataset(datasetId);
  if (dataset.isDynamic) return null;

  const names = new Set(PUBLIC_INTERNAL_TABLES);
  for (const name of extractCreatedRelationNames(dataset.viewSQL?.(DATA_DIR) ?? [])) {
    names.add(name);
  }
  for (const name of extractCreatedRelationNames(dataset.summaryTableSQL ?? [])) {
    names.add(name);
  }
  return names.size > PUBLIC_INTERNAL_TABLES.size ? names : null;
}

export async function discoverSchema(datasetId?: string): Promise<SchemaInfo> {
  // 1. Get all tables and views in the main schema
  const tablesResult = await executeSQL(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name`,
    datasetId
  );

  if (tablesResult.error || tablesResult.rows.length === 0) {
    return { tables: [], tableNames: [] };
  }

  const expectedRelations = expectedStaticDatasetRelations(datasetId);
  const tableNames = tablesResult.rows
    .map((r) => r.table_name as string)
    .filter((name) => {
      const lower = name.toLowerCase();
      if (lower.startsWith("__pb_validate_") || lower.startsWith("__pb_run_")) return false;
      if (!expectedRelations) return true;
      return expectedRelations.has(lower);
    });

  // 2. Get columns + row counts in parallel
  const tables: TableInfo[] = await Promise.all(
    tableNames.map(async (tableName) => {
      const [colsResult, countResult] = await Promise.all([
        executeSQL(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' AND table_name = '${tableName}' ORDER BY ordinal_position`,
          datasetId
        ),
        executeSQL(`SELECT COUNT(*) AS cnt FROM "${tableName}"`, datasetId),
      ]);

      const columns: ColumnInfo[] = colsResult.rows.map((r) => ({
        name: r.column_name as string,
        type: r.data_type as string,
      }));

      const rowCount =
        countResult.rows.length > 0
          ? Number(countResult.rows[0].cnt)
          : 0;

      return { name: tableName, columns, rowCount };
    })
  );

  return { tables, tableNames };
}

export function formatSchemaForLLM(schema: SchemaInfo): string {
  if (schema.tables.length === 0) {
    return "No tables found in the database.";
  }

  return schema.tables
    .map((table) => {
      const rowStr =
        table.rowCount >= 1_000_000
          ? `${(table.rowCount / 1_000_000).toFixed(1)}M rows`
          : table.rowCount >= 1_000
            ? `${(table.rowCount / 1_000).toFixed(1)}K rows`
            : `${table.rowCount} rows`;

      const cols = table.columns
        .map((c) => `  - ${c.name} ${c.type}`)
        .join("\n");

      return `Table: ${table.name} (${rowStr})\n${cols}`;
    })
    .join("\n\n");
}
