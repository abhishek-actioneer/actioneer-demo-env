// Critical metric approval store — KPI metrics are critical, others are downstream

// KPI metric IDs (critical — can be approved individually)
export const CRITICAL_METRIC_IDS = [
  "m-dau",
  "m-pageviews",
  "m-revenue",
  "m-aov",
  "m-conversion",
  "m-arpu",
];

// Non-KPI metrics are downstream — locked until critical metrics are approved
// Map critical metrics to their downstream dependents
const DOWNSTREAM_MAP: Record<string, string[]> = {
  "m-dau": ["m-sessions", "m-new-users"],
  "m-pageviews": ["m-add-to-cart", "m-cart-removals"],
  "m-revenue": ["m-rev-per-session", "m-brand-revenue", "m-category-revenue", "m-purchases", "m-arppu", "m-avg-purchase-price"],
  "m-aov": [],
  "m-conversion": ["m-paying-users"],
  "m-arpu": ["m-arppu"],
};

// All downstream metric IDs (union of all DOWNSTREAM_MAP values)
const ALL_DOWNSTREAM_IDS = new Set(Object.values(DOWNSTREAM_MAP).flat());
// Also add metrics not explicitly in a map but not KPI (catch-all for non-KPI metrics)
const NON_KPI_IDS = [
  "m-sessions", "m-new-users", "m-add-to-cart", "m-cart-removals",
  "m-cart-abandon", "m-purchases", "m-rev-per-session", "m-brand-revenue",
  "m-category-revenue", "m-paying-users", "m-arppu", "m-avg-purchase-price",
];
NON_KPI_IDS.forEach((id) => ALL_DOWNSTREAM_IDS.add(id));

type MetricApprovalStatus = "approved" | "locked" | "computing" | "none";

const STORAGE_KEY = "baby-sentinel-approvals";

const approvedMetrics = new Set<string>();
const computingMetrics = new Set<string>();
const listeners = new Set<() => void>();

// Restore from localStorage on module load
if (typeof window !== "undefined") {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const ids: string[] = JSON.parse(stored);
      ids.forEach((id) => approvedMetrics.add(id));
    }
  } catch { /* ignore */ }
}

function persistApprovals() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(approvedMetrics)));
  } catch { /* ignore */ }
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function isCriticalMetric(metricId: string): boolean {
  return CRITICAL_METRIC_IDS.includes(metricId);
}

/** Check by metric type — KPI metrics are critical */
export function isCriticalByType(metricType: string): boolean {
  return metricType === "kpi";
}

export function isDownstreamMetric(metricId: string): boolean {
  return ALL_DOWNSTREAM_IDS.has(metricId);
}

export function getMetricApprovalStatus(metricId: string): MetricApprovalStatus {
  if (computingMetrics.has(metricId)) return "computing";
  if (approvedMetrics.has(metricId)) return "approved";
  if (isDownstreamMetric(metricId)) return "locked";
  if (isCriticalMetric(metricId)) return "none"; // Critical but not yet approved
  return "none";
}

export function getDownstreamIds(metricId: string): string[] {
  return DOWNSTREAM_MAP[metricId] || [];
}

export function approveMetric(metricId: string) {
  approvedMetrics.add(metricId);
  persistApprovals();
  // Start computing downstream metrics
  const downstream = getDownstreamIds(metricId);
  downstream.forEach((id) => computingMetrics.add(id));
  notify();
  // Simulate computation completing after 2.5 seconds
  if (downstream.length > 0) {
    setTimeout(() => {
      downstream.forEach((id) => {
        computingMetrics.delete(id);
        approvedMetrics.add(id);
      });
      persistApprovals();
      notify();
    }, 2500);
  }
}

export function approveAllCritical() {
  CRITICAL_METRIC_IDS.forEach((id) => approveMetric(id));
}

export function getApprovedCount(): number {
  return CRITICAL_METRIC_IDS.filter((id) => approvedMetrics.has(id)).length;
}

export function isMetricApproved(metricId: string): boolean {
  return approvedMetrics.has(metricId);
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
