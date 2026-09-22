import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { getRetention } from "@/lib/server/retention-repo";
import { executeSQLInternal } from "@/lib/sql-executor";
import {
  compileRetentionTrendSQL,
  parseRetentionTrendRows,
} from "@/lib/retention-trend-sql";
import { safeStringify } from "@/lib/safe-stringify";
import type { RetentionConfig } from "@/lib/retention-types";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const body = await req.json();
  const bucket: number = body.bucket ?? 7;

  // Config can come from body or from saved retention
  let config: RetentionConfig | null = body.config ?? null;
  let datasetId: string | null = body.datasetId ?? req.headers.get("x-dataset-id");

  if (!config) {
    const retention = getRetention(userId, id);
    if (!retention) return Response.json({ error: "Retention not found" }, { status: 404 });
    config = retention.config;
    datasetId = retention.datasetId || datasetId;
  }

  if (!config) return Response.json({ error: "No config provided" }, { status: 400 });
  if (!datasetId) return Response.json({ error: "Missing dataset" }, { status: 400 });
  if (!getDatasetForUser(datasetId, userId))
    return Response.json({ error: "Not found" }, { status: 404 });

  const dataset = getDataset(datasetId);
  const sql = compileRetentionTrendSQL(config, dataset, bucket);
  if (!sql) return Response.json({ error: "Cannot compile retention trend query" }, { status: 400 });

  const startTime = performance.now();
  const result = await executeSQLInternal(sql, datasetId);

  if (result.error) {
    return Response.json({ error: result.error }, { status: 422 });
  }

  const executionTimeMs = Math.round(performance.now() - startTime);
  const trendResult = parseRetentionTrendRows(
    result.rows as Record<string, unknown>[],
    bucket,
    executionTimeMs,
  );

  return new Response(safeStringify(trendResult), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
