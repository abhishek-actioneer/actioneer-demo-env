import { auth } from "@clerk/nextjs/server";
import { DEFAULT_DATASET } from "@/lib/datasets";
import { listRetentions, upsertRetention } from "@/lib/server/retention-repo";
import { ensureWorkspaceSeeded } from "@/lib/server/ensure-seeded";
import { computeD7Retention } from "@/lib/server/seed-metric-helpers";
import { getDataset } from "@/lib/datasets";
import type { RetentionConfig } from "@/lib/retention-types";
import { z } from "zod/v4";

const CreateRetentionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  config: z.object({
    startEventId: z.string(),
    returnEventIds: z.array(z.string()).min(1),
    mode: z.enum(["on_or_after", "on", "custom"]),
    granularity: z.enum(["daily", "weekly", "monthly"]),
    dateRange: z.any(),
    startFilters: z.array(z.any()).optional(),
    returnFilters: z.array(z.any()).optional(),
    customBrackets: z.array(z.any()).optional(),
    breakdown: z.string().optional(),
    segmentIds: z.array(z.string()).optional(),
    segmentCompare: z.boolean().optional(),
  }),
  source: z.enum(["manual", "chat", "auto"]).optional(),
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
  const retentions = listRetentions(userId, datasetId);
  return Response.json(retentions);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateRetentionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { name, description, config, source, datasetId: bodyDatasetId } = parsed.data;
  const datasetId = bodyDatasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;

  // Execute retention SQL to get D7 retention snapshot
  const d7Retention = await computeD7Retention(
    config as RetentionConfig,
    getDataset(datasetId),
    datasetId,
  );

  const id = Math.random().toString(36).slice(2, 10);
  upsertRetention(userId, {
    id,
    name,
    description,
    config: config as RetentionConfig,
    source: source || "manual",
    d7Retention,
    datasetId,
  });

  return Response.json({
    id,
    name,
    description: description || "",
    config,
    source: source || "manual",
    d7Retention,
    datasetId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { status: 201 });
}
