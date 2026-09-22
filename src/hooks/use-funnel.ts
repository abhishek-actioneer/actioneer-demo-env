"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  createDefaultFunnelConfig,
  type FunnelConfig,
  type FunnelResult,
  type FunnelStep,
  type ConversionWindow,
  type FunnelOrder,
} from "@/lib/funnel-types";
import type { DateRangePreset } from "@/lib/explorer-types";

export function useFunnel() {
  const [config, setConfig] = useState<FunnelConfig>(createDefaultFunnelConfig);
  const [result, setResult] = useState<FunnelResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const executeQuery = useCallback(async (cfg: FunnelConfig) => {
    if (cfg.steps.length < 2) {
      setResult(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch<FunnelResult>("/api/explorer/funnel", {
        method: "POST",
        body: { config: cfg },
      });

      if (res.error) {
        setError(res.error);
        setResult(null);
      } else {
        setResult(res);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Funnel query failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(
    (updater: (prev: FunnelConfig) => FunnelConfig) => {
      setConfig((prev) => {
        const next = updater(prev);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => executeQuery(next), 300);
        return next;
      });
    },
    [executeQuery],
  );

  const addStep = useCallback(
    (eventId: string) => {
      updateConfig((c) => ({
        ...c,
        steps: [...c.steps, { eventId }],
      }));
    },
    [updateConfig],
  );

  const removeStep = useCallback(
    (index: number) => {
      updateConfig((c) => ({
        ...c,
        steps: c.steps.filter((_, i) => i !== index),
      }));
    },
    [updateConfig],
  );

  const updateStep = useCallback(
    (index: number, patch: Partial<FunnelStep>) => {
      updateConfig((c) => ({
        ...c,
        steps: c.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
      }));
    },
    [updateConfig],
  );

  const setConversionWindow = useCallback(
    (conversionWindow: ConversionWindow) => {
      updateConfig((c) => ({ ...c, conversionWindow }));
    },
    [updateConfig],
  );

  const setOrder = useCallback(
    (order: FunnelOrder) => {
      updateConfig((c) => ({ ...c, order }));
    },
    [updateConfig],
  );

  const setBreakdown = useCallback(
    (breakdown: string | undefined) => {
      updateConfig((c) => ({ ...c, breakdown }));
    },
    [updateConfig],
  );

  const setDatePreset = useCallback(
    (preset: DateRangePreset) => {
      updateConfig((c) => ({ ...c, dateRange: { preset } }));
    },
    [updateConfig],
  );

  const reset = useCallback(() => {
    setConfig(createDefaultFunnelConfig());
    setResult(null);
    setError(null);
  }, []);

  return {
    config,
    result,
    loading,
    error,
    addStep,
    removeStep,
    updateStep,
    setConversionWindow,
    setOrder,
    setBreakdown,
    setDatePreset,
    updateConfig,
    reset,
  };
}
