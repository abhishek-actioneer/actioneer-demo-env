"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { setActiveDatasetId, apiFetch } from "./api-client";
import { notifyDatasetSwitch } from "@/lib/dataset-switch";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { DATASET_META, type DatasetMeta } from "@/lib/datasets/meta";

const STORAGE_KEY = "sentinel-dataset-id";

export type { DatasetMeta };

interface DatasetContextValue {
  datasetId: string;
  dataset: DatasetMeta;
  allDatasets: DatasetMeta[];
  /** True once the dataset list has loaded and datasetId is validated. Gate API calls on this. */
  ready: boolean;
  switchDataset: (id: string) => void;
  refreshDatasets: () => Promise<void>;
}

// Fallback metadata for the default dataset. Used only during first paint
// before /api/datasets resolves. Derived from DATASET_META so label/reportMeta
// stay in sync with the dataset config when DEFAULT_DATASET changes.
const DEFAULT_META: DatasetMeta = DATASET_META[DEFAULT_DATASET] ?? {
  id: DEFAULT_DATASET,
  label: DEFAULT_DATASET,
  reportMeta: {
    totalEvents: "",
    totalUsers: "",
    dateRangeLabel: "",
    dbName: `${DEFAULT_DATASET}.duckdb`,
  },
};

const DatasetContext = createContext<DatasetContextValue>({
  datasetId: DEFAULT_DATASET,
  dataset: DEFAULT_META,
  allDatasets: [],
  ready: false,
  switchDataset: () => {},
  refreshDatasets: async () => {},
});

export function DatasetProvider({ children, onSwitch }: { children: ReactNode; onSwitch?: () => void }) {
  const [datasetId, setDatasetId] = useState<string>(DEFAULT_DATASET);
  const [resolved, setResolved] = useState(false);

  // On mount, restore persisted dataset from localStorage (avoids SSR hydration mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && /^[a-z0-9_-]+$/.test(stored) && stored.length <= 64 && stored !== DEFAULT_DATASET) {
        setDatasetId(stored);
        setActiveDatasetId(stored);
        setResolved(true);
        return;
      }
    } catch { /* localStorage unavailable */ }
    setActiveDatasetId(DEFAULT_DATASET);
    setResolved(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [allDatasets, setAllDatasets] = useState<DatasetMeta[]>([]);
  const [ready, setReady] = useState(false);

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await apiFetch<DatasetMeta[]>("/api/datasets", { skipModel: true });
      const datasets = data.map((d: DatasetMeta) => ({
        id: d.id,
        label: d.label,
        isDynamic: d.isDynamic,
        companyName: d.companyName,
        currency: d.currency,
        entityName: d.entityName,
        systemContext: d.systemContext,
        domainHints: d.domainHints,
        suggestedPrompts: d.suggestedPrompts,
        welcomeSubtitle: d.welcomeSubtitle,
        reportMeta: d.reportMeta,
        events: d.events,
      }));
      setAllDatasets(datasets);

      // Validate current dataset — if it was removed, reset to first available
      setDatasetId((current) => {
        if (datasets.some((d) => d.id === current)) return current;
        const fallback = datasets[0]?.id || DEFAULT_DATASET;
        setActiveDatasetId(fallback);
        try { localStorage.setItem(STORAGE_KEY, fallback); } catch {}
        return fallback;
      });
    } catch {
      setAllDatasets([DEFAULT_META]);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  // If the stored dataset ID is no longer valid, auto-correct to first available
  useEffect(() => {
    if (allDatasets.length > 0 && !allDatasets.find((d) => d.id === datasetId)) {
      const fallback = allDatasets[0]?.id || DEFAULT_DATASET;
      setDatasetId(fallback);
      setActiveDatasetId(fallback);
      try {
        localStorage.setItem(STORAGE_KEY, fallback);
      } catch {
        // ignore
      }
    }
  }, [allDatasets, datasetId]);

  const switchDataset = useCallback((id: string) => {
    notifyDatasetSwitch();
    setDatasetId(id);
    setActiveDatasetId(id);
    localStorage.setItem(STORAGE_KEY, id);
    onSwitch?.();
  }, [onSwitch]);

  const refreshDatasets = useCallback(async () => {
    await fetchDatasets();
  }, [fetchDatasets]);

  // Find current dataset in list, or fall back to the static DATASET_META registry
  // so the real label (e.g. "Consumer Services") shows on first paint instead of
  // flashing the raw id (e.g. "quickhelp") until /api/datasets resolves.
  const dataset = allDatasets.find((d) => d.id === datasetId) || DATASET_META[datasetId] || (
    datasetId === DEFAULT_DATASET ? DEFAULT_META : {
      id: datasetId,
      label: datasetId.replace(/-/g, " "),
      reportMeta: { totalEvents: "loading...", totalUsers: "loading...", dateRangeLabel: "", dbName: `${datasetId}.duckdb` },
    }
  );

  // Don't render children until localStorage dataset is resolved — prevents flicker
  if (!resolved) return null;

  return (
    <DatasetContext.Provider value={{ datasetId, dataset, allDatasets, ready, switchDataset, refreshDatasets }}>
      {children}
    </DatasetContext.Provider>
  );
}

export function useDataset() {
  return useContext(DatasetContext);
}
