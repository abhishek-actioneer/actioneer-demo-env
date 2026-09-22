import { auth } from "@clerk/nextjs/server";
import { DEFAULT_DATASET } from "@/lib/datasets";
import { getFunnel, upsertFunnel, deleteFunnel } from "@/lib/server/funnel-repo";
import { computeFunnelHeadlineConversion } from "@/lib/server/seed-metric-helpers";
import { getDataset } from "@/lib/datasets";
import type { FunnelConfig } from "@/lib/funnel-types";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const funnel = getFunnel(userId, id);
  if (!funnel) {
    return Response.json({ error: "Funnel not found" }, { status: 404 });
  }

  // Re-execute for fresh conversion rate
  const datasetId = funnel.datasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  let overallConversion = funnel.overallConversion;
  const fresh = await computeFunnelHeadlineConversion(funnel.config, getDataset(datasetId), datasetId);
  if (fresh !== null) {
    overallConversion = fresh;
    // Update cached conversion if changed
    if (overallConversion !== funnel.overallConversion) {
      upsertFunnel(userId, { ...funnel, overallConversion, datasetId });
    }
  }

  return Response.json({ ...funnel, overallConversion });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  const body = await req.json();
  const { name, description, config } = body as {
    name?: string;
    description?: string;
    config?: FunnelConfig;
  };

  const existing = getFunnel(userId, id);

  // Re-execute if config changed
  let overallConversion = existing?.overallConversion ?? null;
  const finalConfig = config ?? existing?.config;
  if (config && finalConfig) {
    const fresh = await computeFunnelHeadlineConversion(finalConfig, getDataset(datasetId), datasetId);
    if (fresh !== null) overallConversion = fresh;
  }

  const merged = {
    id,
    name: name ?? existing?.name ?? "Untitled Funnel",
    description: description ?? existing?.description,
    config: finalConfig ?? { steps: [], conversionWindow: "30d" as const, order: "this_order" as const, dateRange: { preset: "30d" as const } },
    source: existing?.source ?? ("manual" as const),
    overallConversion,
    datasetId,
  };

  upsertFunnel(userId, merged);
  return Response.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  deleteFunnel(userId, id);
  return Response.json({ success: true });
}
