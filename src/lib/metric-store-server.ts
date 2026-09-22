import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";
import type { MetricDefinition } from "./metric-types";

const DATASETS_DIR = resolve(process.cwd(), "data/datasets");

/** Load metric definitions from disk for a dataset (server-side only) */
export function getMetricDefinitions(datasetId: string): MetricDefinition[] | null {
  const metricsPath = join(DATASETS_DIR, datasetId, "metrics.json");
  if (!existsSync(metricsPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(metricsPath, "utf-8"));
    // Handle both formats: plain array (legacy) or { rootMetricId, metrics }
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.metrics)) return raw.metrics;
    return null;
  } catch {
    return null;
  }
}

/** Get metric summaries for a specific dataset (for classify route) */
export function getMetricSummariesForDataset(datasetId: string): { id: string; name: string }[] {
  const definitions = getMetricDefinitions(datasetId);
  if (definitions) {
    return definitions.map((d) => ({ id: d.id, name: d.name }));
  }
  return [];
}
