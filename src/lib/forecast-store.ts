// src/lib/forecast-store.ts
import type { ForecastModel } from "./forecast-types";
import { DEFAULT_MODEL, BASE_SEED_DATA } from "./forecast-data";
import { apiFetch } from "./api-client";

const modelMap = new Map<string, ForecastModel>();
const seedData = new Map<string, Record<string, number>>();
let initialized = false;
let serverSynced = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const STORAGE_KEY = "baby-sentinel-forecast-seeds";
const STORAGE_VERSION = 1;

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  modelMap.set(DEFAULT_MODEL.id, structuredClone(DEFAULT_MODEL));
  for (const [rowId, data] of Object.entries(BASE_SEED_DATA)) {
    seedData.set(rowId, { ...data });
  }

  // Restore from localStorage
  if (typeof window !== "undefined") {
    try {
      const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");
      if (storedVersion === String(STORAGE_VERSION)) {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const items: { rowId: string; data: Record<string, number> }[] = JSON.parse(stored);
          for (const item of items) {
            seedData.set(item.rowId, item.data);
          }
        }
      }
    } catch { /* corrupted — use defaults */ }

    // Background server hydration
    if (!serverSynced) {
      serverSynced = true;
      hydrateFromServer();
    }
  }
}

async function hydrateFromServer() {
  try {
    const seeds = await apiFetch<{ id: string; datasetId: string; modelData: string; seedData: string }[]>(
      "/api/forecast/seeds?datasetId=default",
      { skipModel: true },
    );
    if (seeds.length > 0) {
      // Server has data — restore
      for (const seed of seeds) {
        try {
          const data = typeof seed.seedData === "string" ? JSON.parse(seed.seedData) : seed.seedData;
          if (data && typeof data === "object") {
            for (const [rowId, values] of Object.entries(data)) {
              seedData.set(rowId, values as Record<string, number>);
            }
          }
        } catch { /* skip malformed */ }
      }
      writeLocalStorage();
    } else if (seedData.size > 0) {
      // Server empty — push local
      syncToServer();
    }
  } catch {
    // Server unavailable
  }
}

function syncToServer() {
  const allSeeds: Record<string, Record<string, number>> = {};
  for (const [rowId, data] of seedData) {
    allSeeds[rowId] = data;
  }
  apiFetch("/api/forecast/seeds", {
    method: "PUT",
    body: {
      id: "default",
      datasetId: "default",
      seedData: JSON.stringify(allSeeds),
      modelData: JSON.stringify({}),
    },
    skipModel: true,
  }).catch(() => {});
}

function writeLocalStorage() {
  if (typeof window === "undefined") return;
  try {
    const items = Array.from(seedData.entries()).map(([rowId, data]) => ({ rowId, data }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
  } catch { /* silent */ }
}

function persistDebounced() {
  if (typeof window === "undefined") return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    writeLocalStorage();
    syncToServer();
  }, 1000);
}

export function getDefaultModel(): ForecastModel {
  ensureInitialized();
  const model = modelMap.get("default");
  if (!model) throw new Error("Default forecast model not found after initialization");
  return model;
}

export function saveModel(model: ForecastModel): void {
  ensureInitialized();
  modelMap.set(model.id, model);
}

export function getSeedData(rowId: string): Record<string, number> | undefined {
  ensureInitialized();
  return seedData.get(rowId);
}

export function getAllSeedData(): Map<string, Record<string, number>> {
  ensureInitialized();
  return seedData;
}

export function setSeedValue(rowId: string, timeKey: string, value: number): void {
  ensureInitialized();
  let row = seedData.get(rowId);
  if (!row) { row = {}; seedData.set(rowId, row); }
  row[timeKey] = value;
  persistDebounced();
}

/** Bulk-set seed data for a row (replaces existing data for that row). */
export function setSeedData(rowId: string, data: Record<string, number>): void {
  ensureInitialized();
  const existing = seedData.get(rowId);
  if (existing) {
    Object.assign(existing, data);
  } else {
    seedData.set(rowId, { ...data });
  }
  persistDebounced();
}

/** Check if a row has any seed data populated. */
export function hasSeedData(rowId: string): boolean {
  ensureInitialized();
  const data = seedData.get(rowId);
  return !!data && Object.keys(data).length > 0;
}
