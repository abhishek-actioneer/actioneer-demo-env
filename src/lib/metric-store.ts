import type { Metric, MetricSummary, MetricCategory, MetricChangelogEntry } from "./metric-types";
import { invalidateCatalog } from "./catalog-invalidation";

const stores = new Map<string, Map<string, Metric>>();
const initialized = new Set<string>();

function ensureInitialized(datasetId: string) {
  if (initialized.has(datasetId)) return;
  initialized.add(datasetId);
  stores.set(datasetId, new Map<string, Metric>());
}

function getStore(datasetId: string): Map<string, Metric> {
  ensureInitialized(datasetId);
  return stores.get(datasetId)!;
}

export function getAllMetrics(datasetId: string): Metric[] {
  return Array.from(getStore(datasetId).values());
}

export function getMetric(datasetId: string, id: string): Metric | undefined {
  return getStore(datasetId).get(id);
}

export function saveMetric(datasetId: string, metric: Metric): boolean {
  try {
    getStore(datasetId).set(metric.id, metric);
    invalidateCatalog();
    return true;
  } catch {
    return false;
  }
}

export function saveMetrics(datasetId: string, metrics: Metric[]): void {
  ensureInitialized(datasetId);
  const map = new Map<string, Metric>();
  for (const m of metrics) {
    map.set(m.id, m);
  }
  // Also keep any client-only metrics (version 0, not yet on server)
  const existing = stores.get(datasetId)!;
  for (const [id, m] of existing) {
    if (m.version === 0 && !map.has(id)) {
      map.set(id, m);
    }
  }
  stores.set(datasetId, map);
  invalidateCatalog();
}

export function updateMetric(
  datasetId: string,
  id: string,
  updates: Partial<Omit<Metric, "id">>
): boolean {
  try {
    const store = getStore(datasetId);
    const existing = store.get(id);
    if (existing) {
      store.set(id, { ...existing, ...updates });
      invalidateCatalog();
    }
    return true;
  } catch {
    return false;
  }
}

export function deleteMetric(datasetId: string, id: string): boolean {
  try {
    getStore(datasetId).delete(id);
    invalidateCatalog();
    return true;
  } catch {
    return false;
  }
}

export function getMetricsByCategory(datasetId: string, category: MetricCategory): Metric[] {
  return Array.from(getStore(datasetId).values()).filter((m) => m.category === category);
}

export function addChangelogEntry(datasetId: string, metricId: string, entry: MetricChangelogEntry): void {
  const store = getStore(datasetId);
  const metric = store.get(metricId);
  if (!metric) return;
  const changelog = metric.changelog ? [...metric.changelog] : [];
  changelog.unshift(entry); // newest first
  store.set(metricId, { ...metric, changelog });
}

export function getMetricSummaries(datasetId: string): MetricSummary[] {
  return Array.from(getStore(datasetId).values()).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    type: m.type,
    category: m.category,
    status: m.status,
    value: m.value,
    valueFormat: m.valueFormat,
    changePercent: m.changePercent,
    errors: m.errors ?? 0,
    owner: m.owner,
    ownerInitials: m.ownerInitials,
  }));
}
