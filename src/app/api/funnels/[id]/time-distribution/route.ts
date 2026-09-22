import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { getFunnel } from "@/lib/server/funnel-repo";
import { executeSQLInternal } from "@/lib/sql-executor";
import { compileFunnelTimeDistributionSQL, parseTimeDistributionRows } from "@/lib/funnel-time-sql";
import { safeStringify } from "@/lib/safe-stringify";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const funnel = getFunnel(userId, id);
  if (!funnel) return Response.json({ error: "Funnel not found" }, { status: 404 });

  const datasetId = funnel.datasetId || req.headers.get("x-dataset-id");
  if (!datasetId) return Response.json({ error: "Missing dataset" }, { status: 400 });
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const dataset = getDataset(datasetId);
  const sql = compileFunnelTimeDistributionSQL(funnel.config, dataset);
  if (!sql) return Response.json({ error: "Cannot compile time distribution query" }, { status: 400 });

  const result = await executeSQLInternal(sql, datasetId);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 422 });
  }

  const distribution = parseTimeDistributionRows(result.rows as Record<string, unknown>[]);

  return new Response(safeStringify(distribution), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
