// Metric update store — tracks pending definition changes from chat

export interface PendingMetricUpdate {
  id: string;
  metricId: string;
  metricName: string;
  oldSql: string;
  newSql: string;
  oldFormula: string;
  newFormula: string;
  affectedMetrics: { id: string; name: string }[];
  description: string; // What the user asked to change
  triggeredBy?: string; // Email of the user who triggered the change
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt?: string;
}

const STORAGE_KEY = "baby-sentinel-metric-updates";

const pendingUpdates = new Map<string, PendingMetricUpdate>();
const listeners = new Set<() => void>();

// Restore from localStorage on module load
if (typeof window !== "undefined") {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const items: PendingMetricUpdate[] = JSON.parse(stored);
      items.forEach((u) => pendingUpdates.set(u.metricId, u));
    }
  } catch { /* ignore */ }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(pendingUpdates.values())));
  } catch { /* ignore */ }
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function addPendingUpdate(update: PendingMetricUpdate) {
  pendingUpdates.set(update.metricId, update);
  persist();
  notify();
}

export function getPendingUpdate(metricId: string): PendingMetricUpdate | undefined {
  return pendingUpdates.get(metricId);
}

export function hasPendingUpdate(metricId: string): boolean {
  const update = pendingUpdates.get(metricId);
  return !!update && update.status === "pending";
}

export function approvePendingUpdate(metricId: string) {
  const update = pendingUpdates.get(metricId);
  if (update) {
    update.status = "approved";
    update.resolvedAt = new Date().toISOString();
    persist();
    notify();
  }
}

export function rejectPendingUpdate(metricId: string) {
  const update = pendingUpdates.get(metricId);
  if (update) {
    update.status = "rejected";
    update.resolvedAt = new Date().toISOString();
    persist();
    notify();
  }
}

export function clearPendingUpdate(metricId: string) {
  pendingUpdates.delete(metricId);
  persist();
  notify();
}

export function getAllPendingUpdates(): PendingMetricUpdate[] {
  return Array.from(pendingUpdates.values()).filter((u) => u.status === "pending");
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
