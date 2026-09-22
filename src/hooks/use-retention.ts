"use client";

import { useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  createDefaultRetentionConfig,
  type RetentionConfig,
  type RetentionResult,
  type RetentionGranularity,
  type RetentionMode,
} from "@/lib/retention-types";
import type { DateRangePreset } from "@/lib/explorer-types";

export function useRetention() {
  const [config, setConfig] = useState<RetentionConfig>(createDefaultRetentionConfig);
  const [result, setResult] = useState<RetentionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const executeQuery = useCallback(async (cfg: RetentionConfig) => {
    if (!cfg.startEventId || !cfg.returnEventIds.length) {
      setResult(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<RetentionResult>("/api/explorer/retention", {
        method: "POST",
        body: { config: cfg },
      });
      if (res.error) { setError(res.error); setResult(null); }
      else { setResult(res); setError(null); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retention query failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(
    (updater: (prev: RetentionConfig) => RetentionConfig) => {
      setConfig((prev) => {
        const next = updater(prev);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => executeQuery(next), 300);
        return next;
      });
    },
    [executeQuery],
  );

  const setStartEvent = useCallback(
    (eventId: string) => updateConfig((c) => ({ ...c, startEventId: eventId })),
    [updateConfig],
  );

  const addReturnEvent = useCallback(
    (eventId: string) => updateConfig((c) => ({
      ...c,
      returnEventIds: [...c.returnEventIds.slice(0, 1), eventId], // max 2
    })),
    [updateConfig],
  );

  const setReturnEvent = useCallback(
    (index: number, eventId: string) => updateConfig((c) => ({
      ...c,
      returnEventIds: c.returnEventIds.map((id, i) => i === index ? eventId : id),
    })),
    [updateConfig],
  );

  const removeReturnEvent = useCallback(
    (index: number) => updateConfig((c) => ({
      ...c,
      returnEventIds: c.returnEventIds.filter((_, i) => i !== index),
    })),
    [updateConfig],
  );

  const setMode = useCallback(
    (mode: RetentionMode) => updateConfig((c) => ({ ...c, mode })),
    [updateConfig],
  );

  const setGranularity = useCallback(
    (granularity: RetentionGranularity) => updateConfig((c) => ({ ...c, granularity })),
    [updateConfig],
  );

  const setDatePreset = useCallback(
    (preset: DateRangePreset) => updateConfig((c) => ({ ...c, dateRange: { preset } })),
    [updateConfig],
  );

  const setBreakdown = useCallback(
    (breakdown: string | undefined) => updateConfig((c) => ({ ...c, breakdown })),
    [updateConfig],
  );

  const reset = useCallback(() => {
    setConfig(createDefaultRetentionConfig());
    setResult(null);
    setError(null);
  }, []);

  return {
    config, result, loading, error,
    setStartEvent, addReturnEvent, setReturnEvent, removeReturnEvent,
    setMode, setGranularity, setDatePreset, setBreakdown,
    updateConfig, reset,
  };
}
