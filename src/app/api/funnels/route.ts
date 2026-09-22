import { auth } from "@clerk/nextjs/server";
import { DEFAULT_DATASET } from "@/lib/datasets";
import { listFunnels, upsertFunnel } from "@/lib/server/funnel-repo";
import { ensureWorkspaceSeeded } from "@/lib/server/ensure-seeded";
import { computeFunnelHeadlineConversion } from "@/lib/server/seed-metric-helpers";
import { getDataset } from "@/lib/datasets";
import type { FunnelConfig } from "@/lib/funnel-types";
import { z } from "zod/v4";

const CreateFunnelSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  config: z.object({
    steps: z.array(z.object({
      eventId: z.string(),
      label: z.string().optional(),
      filters: z.array(z.any()).optional(),
    })).min(2),
    conversionWindow: z.enum(["1h", "1d", "7d", "30d", "90d"]),
    order: z.enum(["this_order", "any_order", "exact_order"]),
    dateRange: z.any(),
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
  const funnels = listFunnels(userId, datasetId);
  return Response.json(funnels);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateFunnelSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { name, description, config, source, datasetId: bodyDatasetId } = parsed.data;
  const datasetId = bodyDatasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;

  // Execute funnel SQL to get overall conversion snapshot
  const overallConversion = await computeFunnelHeadlineConversion(
    config as FunnelConfig,
    getDataset(datasetId),
    datasetId,
  );

  const id = Math.random().toString(36).slice(2, 10);
  upsertFunnel(userId, {
    id,
    name,
    description,
    config: config as FunnelConfig,
    source: source || "manual",
    overallConversion,
    datasetId,
  });

  return Response.json({
    id,
    name,
    description: description || "",
    config,
    source: source || "manual",
    overallConversion,
    datasetId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { status: 201 });
}
