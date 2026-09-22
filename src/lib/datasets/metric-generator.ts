import { generateJson } from "../llm";
import type { MetricDefinition, MetricRelationship } from "../metric-types";
import type { SchemaMap } from "./types";
import { buildMetricGenerationPrompt } from "@/lib/prompts/metrics";
import { buildRelationshipInferencePrompt } from "@/lib/prompts/metric-relationships";

export async function generateMetricDefinitions(
  schemaMap: SchemaMap,
  label: string,
): Promise<MetricDefinition[]> {
  const prompt = buildMetricGenerationPrompt(schemaMap, label);

  let metrics: MetricDefinition[];
  try {
    const parsed = await generateJson<unknown>(prompt, {
      label: "metric-generator",
      timeoutMs: 180_000,
      // Wide multi-table schemas yield 20K+ token metric arrays — truncation breaks JSON parsing
      maxOutputTokens: 32_768,
    });
    // jsonMode forces a top-level object, so the model may wrap the array (e.g. {"metrics": [...]})
    metrics = Array.isArray(parsed)
      ? parsed
      : ((parsed && typeof parsed === "object"
          ? (Object.values(parsed).find(Array.isArray) as MetricDefinition[] | undefined)
          : undefined) ?? []);
  } catch (err) {
    console.warn("[metric-generator] Failed to parse metric definitions, returning empty:", err instanceof Error ? err.message : err);
    return [];
  }

  // Validate and sanitize each metric
  const validated = metrics
    .filter((m) => m.id && m.name && m.valueSql && m.timeSeriesSql)
    .map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description || "",
      type: (["kpi", "indicator", "diagnostic"].includes(m.type) ? m.type : "indicator") as MetricDefinition["type"],
      category: m.category || "General",
      valueFormat: (["number", "currency", "percent", "integer"].includes(m.valueFormat) ? m.valueFormat : "number") as MetricDefinition["valueFormat"],
      aggregation: m.aggregation || "count",
      valueSql: m.valueSql,
      timeSeriesSql: m.timeSeriesSql,
      table: m.table || "",
      column: m.column || "",
      timeColumn: m.timeColumn || "",
      formula: m.formula || "",
      timeGrain: m.timeGrain,
      dimensions: Array.isArray(m.dimensions) ? m.dimensions : [],
      relationships: Array.isArray(m.relationships) ? m.relationships : [],
    }));

  // Strip relationships that reference non-existent metric IDs
  const validIds = new Set(validated.map((m) => m.id));
  return validated.map((m) => ({
    ...m,
    relationships: m.relationships
      .filter((r) => r != null && validIds.has(r.metricId))
      .map((r) => ({
        metricId: r.metricId,
        metricName: r.metricName || "",
        direction: (["drives", "driven_by"].includes(r.direction) ? r.direction : "drives") as "drives" | "driven_by",
        type: (["component", "influence"].includes(r.type) ? r.type : "influence") as "component" | "influence",
      })),
  }));
}

// ── Relationship inference (second pass) ──

interface InferenceResult {
  metricId: string;
  category?: string;
  relationships?: MetricRelationship[];
}

export interface InferenceOutput {
  metrics: MetricDefinition[];
  rootMetricId: string | null;
}

/**
 * Takes existing MetricDefinitions and calls the LLM to infer
 * causal/compositional relationships, dynamic categories, and root metric.
 * Returns enriched definitions + the LLM-chosen root. On failure, returns originals.
 */
export async function inferMetricRelationships(
  metrics: MetricDefinition[],
  datasetLabel: string,
): Promise<InferenceOutput> {
  // Skip inference if too few metrics for meaningful relationships
  if (metrics.length < 3) return { metrics, rootMetricId: null };

  const prompt = buildRelationshipInferencePrompt(metrics, datasetLabel);

  let results: InferenceResult[];
  let rootMetricId: string | null = null;
  try {
    console.log(`[metric-generator] Inferring relationships for ${metrics.length} metrics (${datasetLabel})...`);
    const parsed = await generateJson<unknown>(prompt, {
      label: "Relationship inference",
      timeoutMs: 120_000,
      maxOutputTokens: 16_384,
    });
    console.log("[metric-generator] Relationship inference response received");

    // Handle both formats: { rootMetricId, metrics: [...] } or plain array
    if (Array.isArray(parsed)) {
      results = parsed;
    } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { metrics?: unknown[] }).metrics)) {
      const parsedObject = parsed as { metrics: InferenceResult[]; rootMetricId?: string };
      results = parsedObject.metrics;
      rootMetricId = parsedObject.rootMetricId || null;
    } else {
      results = [];
    }

    console.log(`[metric-generator] Parsed ${results.length} results, rootMetricId: ${rootMetricId}`);
    const totalRels = results.reduce((acc, r) => acc + (r.relationships?.length || 0), 0);
    console.log(`[metric-generator] Total relationships in LLM response: ${totalRels}`);
  } catch (err) {
    console.warn("[metric-generator] Relationship inference failed, returning originals:", err);
    return { metrics, rootMetricId: null };
  }

  // Build lookup: metricId → inference result
  const resultMap = new Map<string, InferenceResult>();
  for (const r of results) {
    if (r.metricId) resultMap.set(r.metricId, r);
  }

  // Build valid ID set and name lookup for validation
  const validIds = new Set(metrics.map((m) => m.id));
  const nameById = new Map(metrics.map((m) => [m.id, m.name]));

  // Validate rootMetricId references a real metric
  if (rootMetricId && !validIds.has(rootMetricId)) {
    console.warn(`[metric-generator] LLM returned invalid rootMetricId: ${rootMetricId}`);
    rootMetricId = null;
  }

  const enriched = metrics.map((m) => {
    const inferred = resultMap.get(m.id);
    if (!inferred) return m;

    // Validate and sanitize relationships
    const relationships: MetricRelationship[] = (inferred.relationships || [])
      .filter((r) => r != null && validIds.has(r.metricId))
      .slice(0, 3) // enforce max 3 outgoing
      .map((r) => ({
        metricId: r.metricId,
        metricName: r.metricName || nameById.get(r.metricId) || "",
        direction: "drives" as const,
        type: (["component", "influence"].includes(r.type) ? r.type : "influence") as "component" | "influence",
      }));

    return {
      ...m,
      category: inferred.category || m.category,
      relationships,
    };
  });

  return { metrics: enriched, rootMetricId };
}
