import { auth } from "@clerk/nextjs/server";
import { executeSQL } from "@/lib/sql-executor";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { z } from "zod/v4";

const QuerySchema = z.object({
  sql: z.string().min(1),
  datasetId: z.string().optional(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = QuerySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "sql is required" }, { status: 400 });
  }
  const { sql, datasetId: bodyDatasetId } = parsed.data;
  const datasetId = bodyDatasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const result = await executeSQL(sql, datasetId);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
    executionTimeMs: result.executionTimeMs,
  });
}
