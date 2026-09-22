import { auth } from "@clerk/nextjs/server";
import { executeSQLInternal } from "@/lib/sql-executor";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";
import { z } from "zod/v4";

const CountSchema = z.object({
  sql: z.string().min(1),
});

/** Count users matching a segment SQL — no row cap, uses executeSQLInternal. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = CountSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "sql is required" }, { status: 400 });
  }
  const { sql } = parsed.data;
  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const cleanSql = sql.trim().replace(/;+\s*$/, "");

  const result = await executeSQLInternal(
    `SELECT COUNT(*) as cnt FROM (${cleanSql}) __count`,
    datasetId,
  );
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  const count = Number(result.rows[0]?.cnt ?? 0);
  return Response.json({ count });
}
