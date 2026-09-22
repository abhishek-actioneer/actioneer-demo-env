import { auth } from "@clerk/nextjs/server";
import { executeSQLInternal } from "@/lib/sql-executor";
import { getDataset, DEFAULT_DATASET } from "@/lib/datasets";
import {
  getSegment,
  upsertSegment,
  deleteSegment,
} from "@/lib/server/segment-repo";
import type { Segment } from "@/lib/types";
import type { SegmentBuilderConfig } from "@/lib/segment-builder-types";
import { describeSegmentConfig, isSegmentBuilderConfig } from "@/lib/segment-description";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;

  const segment = getSegment(userId, id);
  if (!segment) {
    return Response.json({ error: "Segment not found" }, { status: 404 });
  }

  const sql = segment.sql;

  // Re-execute SQL against DuckDB for fresh user count + enriched preview
  const ds = getDataset(datasetId);
  const userIdField = ds.userIdField;
  const primaryTable = ds.entityTable ?? ds.primaryTable;

  const rawPreviewSql = `SELECT * FROM (${sql}) __preview LIMIT 10`;
  const enrichedPreviewSql = userIdField
    ? `SELECT ${primaryTable}.* FROM ${primaryTable} INNER JOIN (${sql}) __seg USING (${userIdField}) LIMIT 10`
    : null;

  const [countResult, previewResult] = await Promise.all([
    executeSQLInternal(
      `SELECT COUNT(*) as cnt FROM (${sql}) __cnt`,
      datasetId
    ),
    enrichedPreviewSql
      ? executeSQLInternal(enrichedPreviewSql, datasetId).then(async (res) => {
          if (res.error || res.rows.length === 0) {
            return executeSQLInternal(rawPreviewSql, datasetId);
          }
          return res;
        })
      : executeSQLInternal(rawPreviewSql, datasetId),
  ]);
  if (previewResult.error) {
    console.error("[segment preview] error:", previewResult.error);
  }

  // Update user count in SQLite if we got a fresh one
  const freshCount = countResult.error
    ? segment.userCount
    : Number(
        (countResult.rows[0] as Record<string, unknown>)?.cnt ??
          segment.userCount
      );

  if (freshCount !== segment.userCount) {
    upsertSegment(userId, { ...segment, userCount: freshCount, datasetId });
  }

  const result: Segment & { preview?: Record<string, unknown>[] } = {
    ...segment,
    userCount: freshCount,
    preview: previewResult.error ? [] : (previewResult.rows as Record<string, unknown>[]),
  };

  return Response.json(result);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  const dataset = getDataset(datasetId);
  const body = await req.json();
  const { name, sql, description, config } = body as {
    name?: string;
    sql?: string;
    description?: string;
    config?: SegmentBuilderConfig;
  };

  const existing = getSegment(userId, id);
  const segmentConfig = isSegmentBuilderConfig(config) ? config : undefined;
  const generatedDescription = segmentConfig
    ? describeSegmentConfig(segmentConfig, dataset.events ?? []).description
    : undefined;

  // Create-on-miss (per server write path rules)
  const merged = {
    id,
    name: name ?? existing?.name ?? "Untitled Segment",
    sql: sql ?? existing?.sql ?? "",
    description: description ?? generatedDescription ?? existing?.description,
    config: segmentConfig ?? existing?.config,
    userCount: existing?.userCount,
    pushStatus: existing?.pushStatus,
    datasetId,
  };

  upsertSegment(userId, merged);
  return Response.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  deleteSegment(userId, id);
  return Response.json({ success: true });
}
