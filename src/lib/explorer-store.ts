import type { ExplorerConfig } from "./explorer-types";
import { createDefaultConfig } from "./explorer-types";

/**
 * Module-level in-memory store for the active explorer config.
 * Survives React navigation (sidebar clicks) but lost on page refresh.
 * Singleton — shared across all components that import this module.
 */

const STORAGE_KEY = "baby-sentinel-explorer";

function loadConfig(): ExplorerConfig {
  if (typeof window === "undefined") return createDefaultConfig();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return createDefaultConfig();
}

function persistConfig(config: ExplorerConfig) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

let _activeConfig: ExplorerConfig = loadConfig();
let _listeners: Array<() => void> = [];

export function getExplorerConfig(): ExplorerConfig {
  return _activeConfig;
}

export function setExplorerConfig(config: ExplorerConfig): void {
  _activeConfig = config;
  persistConfig(config);
  _listeners.forEach((fn) => fn());
}

export function clearExplorerConfig(): void {
  _activeConfig = createDefaultConfig();
  persistConfig(_activeConfig);
  _listeners.forEach((fn) => fn());
}

export function subscribeExplorerConfig(listener: () => void): () => void {
  _listeners.push(listener);
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}

/**
 * Convert a Metric to an initial ExplorerConfig by matching metric fields
 * to dataset event definitions.
 */
export function metricToExplorerConfig(
  metric: { table: string; column: string; aggregation: string; timeGrain?: string },
  datasetEvents: Array<{ id: string; table: string; valueColumn?: string }>,
): ExplorerConfig {
  // Try to match metric to an event by table + value column
  const matchedEvent = datasetEvents.find(
    (e) => e.table === metric.table && e.valueColumn === metric.column,
  ) ?? datasetEvents[0];

  // Map metric aggregation to explorer measure type
  let measureType: ExplorerConfig["events"][0]["measureType"] = "event_totals";
  switch (metric.aggregation) {
    case "sum":
      measureType = "sum";
      break;
    case "count":
      measureType = "event_totals";
      break;
    case "unique_count":
      measureType = "uniques";
      break;
    case "ratio":
    case "derived_ratio":
      measureType = "average";
      break;
  }

  return {
    events: matchedEvent
      ? [{ eventId: matchedEvent.id, measureType }]
      : [],
    dateRange: { preset: "30d" },
    granularity: (metric.timeGrain as ExplorerConfig["granularity"]) ?? "daily",
    chartType: "line",
  };
}
