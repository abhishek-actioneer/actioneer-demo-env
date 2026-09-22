import { auth } from "@clerk/nextjs/server";
import { executeSQLInternal } from "@/lib/sql-executor";
import { DEFAULT_DATASET, getDataset } from "@/lib/datasets";
import {
  listSegments,
  upsertSegment,
} from "@/lib/server/segment-repo";
import type { Segment } from "@/lib/types";
import { z } from "zod/v4";
import { describeSegmentConfig, isSegmentBuilderConfig } from "@/lib/segment-description";
import { ensureWorkspaceSeeded } from "@/lib/server/ensure-seeded";

const CreateSegmentSchema = z.object({
  name: z.string().min(1).max(200),
  sql: z.string().min(1),
  description: z.string().optional(),
  config: z.unknown().optional(),
  sourceConversationId: z.string().optional(),
  datasetId: z.string().optional(),
});

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const datasetId =
    url.searchParams.get("datasetId") ||
    req.headers.get("x-dataset-id") ||
    DEFAULT_DATASET;
  await ensureWorkspaceSeeded(userId, datasetId);
  const segments = listSegments(userId, datasetId);
  return Response.json(segments);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateSegmentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { name, sql, description, config, sourceConversationId, datasetId: bodyDatasetId } =
    parsed.data;
  const datasetId =
    bodyDatasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  const dataset = getDataset(datasetId);
  const segmentConfig = isSegmentBuilderConfig(config) ? config : undefined;
  const segmentDescription = segmentConfig
    ? describeSegmentConfig(segmentConfig, dataset.events ?? []).description
    : description?.trim();

  // Validate the SQL by executing it against DuckDB (parquet data)
  const cleanSql = sql.trim().replace(/;+\s*$/, "");
  const validationResult = await executeSQLInternal(
    `SELECT * FROM (${cleanSql}) __validate LIMIT 1`,
    datasetId
  );
  if (validationResult.error) {
    return Response.json(
      { error: `Invalid SQL: ${validationResult.error}` },
      { status: 400 }
    );
  }

  const id = Math.random().toString(36).slice(2, 10);
  const countSql = `SELECT COUNT(*) as cnt FROM (${cleanSql}) __count`;
  const countResult = await executeSQLInternal(countSql, datasetId);
  if (countResult.error) {
    return Response.json(
      { error: `Failed to count segment users: ${countResult.error}` },
      { status: 400 }
    );
  }
  const userCount = Number(countResult.rows[0]?.cnt ?? 0);

  // Store metadata in SQLite
  upsertSegment(userId, {
    id,
    name,
    sql: cleanSql,
    description: segmentDescription,
    config: segmentConfig,
    userCount,
    sourceConversationId,
    datasetId,
  });

  const segment: Segment = {
    id,
    name,
    sql: cleanSql,
    description: segmentDescription,
    config: segmentConfig,
    userCount,
    createdAt: new Date().toISOString(),
    sourceConversationId,
    pushStatus: {},
  };

  return Response.json(segment, { status: 201 });
}
