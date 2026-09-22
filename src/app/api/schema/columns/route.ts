import { auth } from "@clerk/nextjs/server";
import { executeSQLInternal } from "@/lib/sql-executor";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { z } from "zod/v4";

const QuerySchema = z.object({
  table: z.string().min(1),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = QuerySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "table is required" }, { status: 400 });

  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const { table } = parsed.data;
  const result = await executeSQLInternal(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' AND table_name = '${table}' ORDER BY ordinal_position`,
    datasetId,
  );

  if (result.error) {
    return Response.json({ columns: [], error: result.error });
  }

  const columns = result.rows.map((r) => ({
    name: r.column_name as string,
    type: r.data_type as string,
  }));

  return Response.json({ columns });
}
