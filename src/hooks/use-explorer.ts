"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  getExplorerConfig,
  setExplorerConfig,
  clearExplorerConfig,
} from "@/lib/explorer-store";
import { onDatasetSwitch } from "@/lib/dataset-switch";
import {
  createDefaultConfig,
  autoGranularity,
  type ExplorerConfig,
  type ExplorerResult,
  type EventSelection,
  type DateRangePreset,
} from "@/lib/explorer-types";

export function useExplorer(initialConfig?: ExplorerConfig, segmentSQLs?: string[]) {
  const [config, setConfig] = useState<ExplorerConfig>(
    () => initialConfig ?? getExplorerConfig(),
  );
  const [result, setResult] = useState<ExplorerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync to store on config change
  useEffect(() => {
    setExplorerConfig(config);
  }, [config]);

  const executeQuery = useCallback(
    async (cfg: ExplorerConfig) => {
      if (!cfg.events.length) {
        setResult(null);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await apiFetch<ExplorerResult>("/api/explorer", {
          method: "POST",
          body: { config: cfg, segmentSQLs: segmentSQLs ?? [] },
        });

        if (res.error) {
          setError(res.error);
          setResult(null);
        } else {
          setResult(res);
          setError(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Query failed");
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [segmentSQLs],
  );

  // Debounced query execution on config change
  const updateConfig = useCallback(
    (updater: (prev: ExplorerConfig) => ExplorerConfig) => {
      setConfig((prev) => {
        const next = updater(prev);
        // Debounce API call
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => executeQuery(next), 300);
        return next;
      });
    },
    [executeQuery],
  );

  // Convenience updaters
  const setEvents = useCallback(
    (events: EventSelection[]) => {
      updateConfig((c) => ({ ...c, events }));
    },
    [updateConfig],
  );

  const addEvent = useCallback(
    (event: EventSelection) => {
      updateConfig((c) => ({
        ...c,
        events: [...c.events.slice(0, 4), event], // max 5
      }));
    },
    [updateConfig],
  );

  const removeEvent = useCallback(
    (index: number) => {
      updateConfig((c) => ({
        ...c,
        events: c.events.filter((_, i) => i !== index),
      }));
    },
    [updateConfig],
  );

  const updateEvent = useCallback(
    (index: number, patch: Partial<EventSelection>) => {
      updateConfig((c) => ({
        ...c,
        events: c.events.map((e, i) =>
          i === index ? { ...e, ...patch } : e,
        ),
      }));
    },
    [updateConfig],
  );

  const setDateRange = useCallback(
    (dateRange: ExplorerConfig["dateRange"]) => {
      updateConfig((c) => ({
        ...c,
        dateRange,
        granularity: autoGranularity(dateRange),
      }));
    },
    [updateConfig],
  );

  const setDatePreset = useCallback(
    (preset: DateRangePreset) => {
      setDateRange({ preset });
    },
    [setDateRange],
  );

  const setGranularity = useCallback(
    (granularity: ExplorerConfig["granularity"]) => {
      updateConfig((c) => ({ ...c, granularity }));
    },
    [updateConfig],
  );

  const setBreakdown = useCallback(
    (breakdown: string | undefined) => {
      updateConfig((c) => ({ ...c, breakdown }));
    },
    [updateConfig],
  );

  const setChartType = useCallback(
    (chartType: ExplorerConfig["chartType"]) => {
      updateConfig((c) => ({ ...c, chartType }));
    },
    [updateConfig],
  );

  const setComputation = useCallback(
    (computation: NonNullable<ExplorerConfig["computation"]>) => {
      updateConfig((c) => ({ ...c, computation }));
    },
    [updateConfig],
  );

  const setCompare = useCallback(
    (compare: NonNullable<ExplorerConfig["compare"]>) => {
      updateConfig((c) => ({ ...c, compare }));
    },
    [updateConfig],
  );

  const setSegmentIds = useCallback(
    (segmentIds: string[]) => {
      updateConfig((c) => ({ ...c, segmentIds }));
    },
    [updateConfig],
  );

  const reset = useCallback(() => {
    const def = createDefaultConfig();
    setConfig(def);
    setResult(null);
    setError(null);
  }, []);

  // Clear explorer on dataset switch
  useEffect(() => {
    return onDatasetSwitch(() => {
      clearExplorerConfig();
      reset();
    });
  }, [reset]);

  // Run initial query if config has events
  useEffect(() => {
    if (config.events.length) {
      executeQuery(config);
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    config,
    result,
    loading,
    error,
    updateConfig,
    setEvents,
    addEvent,
    removeEvent,
    updateEvent,
    setDateRange,
    setDatePreset,
    setGranularity,
    setBreakdown,
    setChartType,
    setSegmentIds,
    setComputation,
    setCompare,
    reset,
    executeQuery: () => executeQuery(config),
  };
}
