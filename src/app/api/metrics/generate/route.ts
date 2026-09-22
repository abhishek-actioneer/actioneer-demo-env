import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { auth } from "@clerk/nextjs/server";
import { generateMetricDefinitions, inferMetricRelationships } from "@/lib/datasets/metric-generator";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { DATASETS_DIR, loadSchemaMap } from "@/lib/datasets/schema-loader";
import {
  FUNDSINDIA_DATASET_ID,
  FUNDSINDIA_METRICS,
  seedFundsIndiaSampleWorkspace,
} from "@/lib/server/fundsindia-sample-workspace";
import { z } from "zod/v4";

const BodySchema = z.object({ datasetId: z.string().min(1) });

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "datasetId is required" }, { status: 400 });
  }
  const { datasetId } = parsed.data;

  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    if (datasetId === FUNDSINDIA_DATASET_ID) {
      await seedFundsIndiaSampleWorkspace(userId);
      return Response.json({ success: true, count: FUNDSINDIA_METRICS.length, metrics: FUNDSINDIA_METRICS });
    }

    // If a pre-seeded metrics.json already exists (e.g. static datasets like Healthians, QuickHelp),
    // use it instead of LLM-generating new ones. This avoids overwriting handcrafted metrics
    // during onboarding sync.
    const preSeedPath = join(DATASETS_DIR, datasetId, "metrics.json");
    if (existsSync(preSeedPath)) {
      try {
        const raw = readFileSync(preSeedPath, "utf-8");
        const parsed = JSON.parse(raw) as { metrics?: unknown[] };
        if (Array.isArray(parsed.metrics) && parsed.metrics.length > 0) {
          return Response.json({ success: true, count: parsed.metrics.length, preSeeded: true });
        }
      } catch {
        // fall through to LLM generation if file is malformed
      }
    }

    const ds = getDataset(datasetId);
    const schemaMap = loadSchemaMap(datasetId);
    if (!schemaMap) {
      return Response.json(
        { error: "No schema data available. Enrich the dataset first." },
        { status: 404 },
      );
    }

    const rawMetrics = await generateMetricDefinitions(schemaMap, ds.label);

    if (rawMetrics.length === 0) {
      return Response.json(
        { error: "LLM returned no valid metric definitions" },
        { status: 500 },
      );
    }

    // Second pass: infer relationships + dynamic categories + root metric
    const { metrics, rootMetricId } = await inferMetricRelationships(rawMetrics, ds.label);

    // Save to disk — store rootMetricId alongside metrics
    const datasetDir = join(DATASETS_DIR, datasetId);
    if (!existsSync(datasetDir)) mkdirSync(datasetDir, { recursive: true });
    const metricsPath = join(datasetDir, "metrics.json");
    writeFileSync(metricsPath, JSON.stringify({ rootMetricId, metrics }, null, 2));

    // Invalidate the metrics cache so the next GET recomputes from the fresh file
    const g = globalThis as Record<string, unknown>;
    if (g.__metrics_cache__ instanceof Map) g.__metrics_cache__.delete(datasetId);

    return Response.json({ success: true, count: metrics.length, metrics });
  } catch (err) {
    console.error(`[metrics/generate] Error for ${datasetId}:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}
