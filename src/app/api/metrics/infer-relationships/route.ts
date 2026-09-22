import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { DATASETS_DIR } from "@/lib/datasets/schema-loader";
import { inferMetricRelationships } from "@/lib/datasets/metric-generator";
import type { MetricDefinition } from "@/lib/metric-types";

const BodySchema = z.object({ datasetId: z.string().min(1) });

// Prevent concurrent inference for the same dataset
const inflight = new Set<string>();

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "datasetId is required" }, { status: 400 });
  }
  const { datasetId } = parsed.data;

  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  // Deduplicate concurrent requests
  if (inflight.has(datasetId)) {
    return Response.json({ status: "already_running" });
  }

  inflight.add(datasetId);
  try {
    const ds = getDataset(datasetId);

    // Load existing metrics.json
    const metricsPath = join(DATASETS_DIR, datasetId, "metrics.json");
    if (!existsSync(metricsPath)) {
      return Response.json(
        { error: "No metrics.json found. Generate metrics first." },
        { status: 404 },
      );
    }

    let definitions: MetricDefinition[];
    let existingRootId: string | null = null;
    try {
      const raw = JSON.parse(readFileSync(metricsPath, "utf-8"));
      // Handle both formats: plain array (legacy) or { rootMetricId, metrics }
      if (Array.isArray(raw)) {
        definitions = raw;
      } else if (raw && Array.isArray(raw.metrics)) {
        definitions = raw.metrics;
        existingRootId = raw.rootMetricId || null;
      } else {
        definitions = [];
      }
    } catch {
      return Response.json(
        { error: "Failed to parse metrics.json" },
        { status: 500 },
      );
    }

    if (definitions.length < 3) {
      return Response.json(
        { error: "Not enough metrics for relationship inference" },
        { status: 400 },
      );
    }

    // Infer relationships + categories + root metric
    const { metrics: enriched, rootMetricId } = await inferMetricRelationships(definitions, ds.label);

    // Write enriched metrics back to disk with root
    writeFileSync(metricsPath, JSON.stringify({
      rootMetricId: rootMetricId || existingRootId,
      metrics: enriched,
    }, null, 2));

    // Invalidate metrics cache
    const g = globalThis as Record<string, unknown>;
    if (g.__metrics_cache__ instanceof Map) g.__metrics_cache__.delete(datasetId);

    const relCount = enriched.reduce(
      (acc, m) => acc + (m.relationships?.length || 0),
      0,
    );

    return Response.json({ success: true, count: enriched.length, relationships: relCount });
  } catch (err) {
    console.error(`[metrics/infer-relationships] Error for ${datasetId}:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Inference failed: ${message}` }, { status: 500 });
  } finally {
    inflight.delete(datasetId);
  }
}
