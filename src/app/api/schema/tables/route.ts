import { auth } from "@clerk/nextjs/server";
import { executeSQL, executeSQLInternal } from "@/lib/sql-executor";
import { getDataset, getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
    if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
    const result = await executeSQL(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name`,
      datasetId
    );

    if (result.error) {
      return Response.json({ tables: [], error: result.error });
    }

    const tableNames = result.rows.map((r) => r.table_name as string);

    // Verify each table is actually queryable
    const verified: string[] = [];
    for (const name of tableNames) {
      const check = await executeSQL(`SELECT 1 FROM "${name}" LIMIT 1`, datasetId);
      if (!check.error) {
        verified.push(name);
      }
    }

    return Response.json({ tables: verified });
  } catch (err) {
    return Response.json({
      tables: [],
      error: err instanceof Error ? err.message : "Schema check failed",
    });
  }
}

/**
 * POST: Validate SQL queries via EXPLAIN before creating a playbook.
 * Body: { queries: string[] }
 * Returns: { valid: boolean, errors: { index: number, error: string }[] }
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const queries = (body.queries as string[]) || [];
    const errors: { index: number; error: string }[] = [];

    const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
    if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
    const dataset = getDataset(datasetId);
    const dateStart = dataset.dateRange?.start ?? "2025-01-01";
    const dateEnd = dataset.dateRange?.end ?? "2025-12-31";

    for (let i = 0; i < queries.length; i++) {
      const sql = queries[i];
      if (!sql || !sql.trim()) continue;
      // Strip {{param}} placeholders with dataset-aware dummy values
      const sanitized = sql
        .replace(/\{\{date_start\}\}/g, dateStart)
        .replace(/\{\{date_end\}\}/g, dateEnd)
        .replace(/\{\{\w+\}\}/g, "1");
      const result = await executeSQLInternal(`EXPLAIN ${sanitized}`);
      if (result.error) {
        errors.push({ index: i, error: result.error });
      }
    }

    return Response.json({ valid: errors.length === 0, errors });
  } catch (err) {
    return Response.json({
      valid: false,
      errors: [{ index: -1, error: err instanceof Error ? err.message : "Validation failed" }],
    });
  }
}
