import { resolve, join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { auth } from "@clerk/nextjs/server";
import type { MetricDefinition } from "@/lib/metric-types";
import type { Metric, MetricStatus } from "@/lib/metric-types";
import { executeSQLInternal } from "@/lib/sql-executor";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";

const DATASETS_DIR = resolve(process.cwd(), "data/datasets");

// ── Persist cache on globalThis so it survives hot reloads ──
interface CacheEntry {
  metrics: Metric[];
  timestamp: number;
}

const cacheKey = "__metrics_cache__" as const;
type GlobalWithMetrics = typeof globalThis & {
  [cacheKey]?: Map<string, CacheEntry>;
};
const g = globalThis as GlobalWithMetrics;
if (!g[cacheKey]) g[cacheKey] = new Map();
// Clear stale cache from previous code versions (sql field changed from valueSql to timeSeriesSql)
const CACHE_VERSION = 2;
const versionKey = "__metrics_cache_version__";
if ((g as Record<string, unknown>)[versionKey] !== CACHE_VERSION) {
  g[cacheKey] = new Map();
  (g as Record<string, unknown>)[versionKey] = CACHE_VERSION;
}
const cache = g[cacheKey];

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface MetricsFile {
  definitions: MetricDefinition[];
  rootMetricId: string | null;
}

function loadMetricDefinitions(datasetId: string): MetricsFile | null {
  const metricsPath = join(DATASETS_DIR, datasetId, "metrics.json");
  if (!existsSync(metricsPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(metricsPath, "utf-8"));
    // Handle both formats: plain array (legacy) or { rootMetricId, metrics }
    if (Array.isArray(raw)) {
      return { definitions: raw, rootMetricId: null };
    }
    if (raw && Array.isArray(raw.metrics)) {
      return { definitions: raw.metrics, rootMetricId: raw.rootMetricId || null };
    }
    return null;
  } catch {
    return null;
  }
}

async function computeMetric(
  def: MetricDefinition,
  datasetId: string,
): Promise<Metric> {
  const now = new Date().toISOString().slice(0, 10);

  // Run value SQL
  let value = 0;
  let status: MetricStatus = "healthy";
  const valueResult = await executeSQLInternal(def.valueSql, datasetId);
  if (valueResult.error) {
    console.warn(`[metrics] valueSql failed for ${def.id}: ${valueResult.error}`);
    status = "unavailable";
  } else if (valueResult.rows.length > 0) {
    const raw = valueResult.rows[0].value;
    value = typeof raw === "number" ? raw : Number(raw) || 0;
  }

  // Run time series SQL
  let timeSeries: { date: string; value: number }[] = [];
  let changePercent: number | undefined;
  const tsResult = await executeSQLInternal(def.timeSeriesSql, datasetId);
  if (tsResult.error) {
    console.warn(`[metrics] timeSeriesSql failed for ${def.id}: ${tsResult.error}`);
    if (status === "healthy") status = "partial";
  } else {
    timeSeries = tsResult.rows.map((row) => ({
      date: String(row.date),
      value: typeof row.value === "number" ? row.value : Number(row.value) || 0,
    }));

    // Compute change percent from time series
    if (timeSeries.length >= 2) {
      const first = timeSeries[0].value;
      const last = timeSeries[timeSeries.length - 1].value;
      if (first !== 0) {
        changePercent = ((last - first) / Math.abs(first)) * 100;
      }
    }
  }

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    type: def.type,
    category: def.category,
    status,
    value: value ?? 0,
    valueFormat: def.valueFormat,
    changePercent: changePercent ?? undefined,
    aggregation: def.aggregation,
    table: def.table,
    column: def.column,
    timeColumn: def.timeColumn,
    formula: def.formula,
    sql: def.timeSeriesSql,
    dimensions: def.dimensions || [],
    timeGrain: def.timeGrain || "daily",
    granularity: "Dataset-level",
    relationships: def.relationships || [],
    owner: "Auto-generated",
    ownerInitials: "AG",
    createdAt: now,
    updatedAt: now,
    version: 1,
    errors: status === "unavailable" ? 1 : 0,
    timeSeries,
  };
}

/** Ensure bidirectional relationships: if A drives B, B should have driven_by A */
function mirrorRelationships(metrics: Metric[]) {
  const byId = new Map(metrics.map((m) => [m.id, m]));
  for (const m of metrics) {
    for (const rel of m.relationships) {
      const target = byId.get(rel.metricId);
      if (!target) continue;
      const reverseDir = rel.direction === "drives" ? "driven_by" as const : "drives" as const;
      const alreadyHas = target.relationships.some(
        (r) => r.metricId === m.id && r.direction === reverseDir
      );
      if (!alreadyHas) {
        target.relationships.push({
          metricId: m.id,
          metricName: m.name,
          direction: reverseDir,
          type: rel.type,
        });
      }
    }
  }
}

/** Recompute metrics in the background and update cache */
function recomputeInBackground(datasetId: string, definitions: MetricDefinition[]) {
  Promise.all(definitions.map((def) => computeMetric(def, datasetId)))
    .then((metrics) => {
      mirrorRelationships(metrics);
      cache.set(datasetId, { metrics, timestamp: Date.now() });
    })
    .catch((err) => {
      console.warn(`[metrics] background recompute failed for ${datasetId}:`, err);
    });
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const datasetId = searchParams.get("datasetId") || DEFAULT_DATASET;

  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const cached = cache.get(datasetId);
  const isFresh = cached && Date.now() - cached.timestamp < CACHE_TTL_MS;

  // Fresh cache → return immediately, but still check if relationships need inference
  if (isFresh) {
    const loaded = loadMetricDefinitions(datasetId);
    const needsRelationships = loaded ? loaded.definitions.length >= 3 &&
      loaded.definitions.every((d) => !d.relationships || d.relationships.length === 0) : false;
    return Response.json({
      metrics: cached.metrics,
      hasDefinitions: !!loaded,
      needsRelationships,
      rootMetricId: loaded?.rootMetricId ?? null,
    });
  }

  // Try to load metric definitions from disk
  const loaded = loadMetricDefinitions(datasetId);

  if (!loaded) {
    return Response.json({ metrics: [], hasDefinitions: false, needsRelationships: false });
  }

  const { definitions, rootMetricId } = loaded;

  // Check if relationships need to be inferred (all metrics have empty relationships)
  const needsRelationships = definitions.length >= 3 &&
    definitions.every((d) => !d.relationships || d.relationships.length === 0);

  // Stale cache exists → return stale data immediately, recompute in background
  if (cached) {
    recomputeInBackground(datasetId, definitions);
    return Response.json({ metrics: cached.metrics, hasDefinitions: true, needsRelationships, rootMetricId });
  }

  // No cache at all → compute now (first request only)
  const metrics = await Promise.all(
    definitions.map((def) => computeMetric(def, datasetId)),
  );
  mirrorRelationships(metrics);
  cache.set(datasetId, { metrics, timestamp: Date.now() });

  // Detect systemic failures (e.g. WAL crash, DB unavailable) —
  // if ALL metrics errored with the same underlying cause, surface it once
  const errorCount = metrics.filter((m) => m.status === "unavailable").length;
  const dbError = errorCount === metrics.length && metrics.length > 0
    ? "All metric queries failed — the database may need recovery. Try refreshing."
    : undefined;

  return Response.json({ metrics, hasDefinitions: true, needsRelationships, rootMetricId, dbError });
}

/** POST — persist a new MetricDefinition to metrics.json */
export async function POST(req: Request) {
  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;

  let body: { definition: MetricDefinition };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { definition } = body;
  if (!definition?.id || !definition?.valueSql) {
    return Response.json({ error: "Missing required fields: id, valueSql" }, { status: 400 });
  }

  console.log("[api/metrics POST] Persisting metric:", { id: definition.id, name: definition.name, table: definition.table });

  try {
    const datasetDir = join(DATASETS_DIR, datasetId);
    if (!existsSync(datasetDir)) mkdirSync(datasetDir, { recursive: true });
    const metricsPath = join(datasetDir, "metrics.json");

    // Load existing metrics
    let existing: { rootMetricId?: string | null; metrics: MetricDefinition[] } = { metrics: [] };
    if (existsSync(metricsPath)) {
      const raw = JSON.parse(readFileSync(metricsPath, "utf-8"));
      if (Array.isArray(raw)) {
        existing = { metrics: raw };
      } else if (raw && Array.isArray(raw.metrics)) {
        existing = raw;
      }
    }

    // Replace if same ID exists, otherwise append
    const idx = existing.metrics.findIndex((m) => m.id === definition.id);
    if (idx >= 0) {
      existing.metrics[idx] = definition;
    } else {
      existing.metrics.push(definition);
    }

    writeFileSync(metricsPath, JSON.stringify(existing, null, 2));
    console.log("[api/metrics POST] Written to disk. Total metrics:", existing.metrics.length);

    // Invalidate cache
    cache.delete(datasetId);

    // Compute the metric immediately so we can return a value
    const computed = await computeMetric(definition, datasetId);
    console.log("[api/metrics POST] Computed value:", computed.value, "status:", computed.status);

    return Response.json({ success: true, metric: computed });
  } catch (error) {
    console.error("[api/metrics POST] Error:", error);
    return Response.json(
      { error: `Failed to persist metric: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    );
  }
}
