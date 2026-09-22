import type { ExplorerConfig } from "./explorer-types";
import { apiFetch } from "./api-client";

export interface SavedChart {
  id: string;
  name: string;
  datasetId: string;
  config: ExplorerConfig;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "sentinel-saved-charts";
let serverSynced = false;
let chartCache: SavedChart[] | null = null;

function loadAll(): SavedChart[] {
  if (chartCache) return chartCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    chartCache = raw ? JSON.parse(raw) : [];
    return chartCache!;
  } catch {
    chartCache = [];
    return [];
  }
}

function persistAll(charts: SavedChart[]): void {
  chartCache = charts;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(charts));
  } catch {
    // quota exceeded — silently fail
  }
}

// Background server hydration — runs once per session
function ensureServerSync(datasetId: string) {
  if (serverSynced || typeof window === "undefined") return;
  serverSynced = true;

  apiFetch<{ id: string; name: string; datasetId: string; config: string; createdAt: string }[]>(
    `/api/saved-charts?datasetId=${datasetId}`,
    { skipModel: true },
  ).then((serverCharts) => {
    if (serverCharts.length > 0) {
      const parsed: SavedChart[] = serverCharts.map((c) => ({
        id: c.id,
        name: c.name,
        datasetId: c.datasetId,
        config: typeof c.config === "string" ? JSON.parse(c.config) : c.config,
        createdAt: c.createdAt,
        updatedAt: c.createdAt,
      }));
      // Merge: server charts take priority, keep local-only charts
      const serverIds = new Set(parsed.map((c) => c.id));
      const localOnly = loadAll().filter((c) => !serverIds.has(c.id));
      persistAll([...parsed, ...localOnly]);
    } else if (loadAll().length > 0) {
      // Server empty — push local to server
      for (const chart of loadAll()) {
        serverUpsertChart(chart);
      }
    }
  }).catch(() => {});
}

function serverUpsertChart(chart: SavedChart) {
  apiFetch("/api/saved-charts", {
    method: "POST",
    body: {
      id: chart.id,
      name: chart.name,
      datasetId: chart.datasetId,
      config: JSON.stringify(chart.config),
      createdAt: chart.createdAt,
    },
    skipModel: true,
  }).catch(() => {});
}

function serverDeleteChart(id: string) {
  apiFetch(`/api/saved-charts?id=${id}`, { method: "DELETE", skipModel: true }).catch(() => {});
}

export function getSavedCharts(datasetId: string): SavedChart[] {
  ensureServerSync(datasetId);
  return loadAll()
    .filter((c) => c.datasetId === datasetId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getSavedChart(id: string): SavedChart | undefined {
  return loadAll().find((c) => c.id === id);
}

export function saveChart(chart: SavedChart): void {
  const all = loadAll();
  const idx = all.findIndex((c) => c.id === chart.id);
  if (idx >= 0) {
    all[idx] = chart;
  } else {
    all.push(chart);
  }
  persistAll(all);
  serverUpsertChart(chart);
}

export function deleteSavedChart(id: string): void {
  persistAll(loadAll().filter((c) => c.id !== id));
  serverDeleteChart(id);
}
