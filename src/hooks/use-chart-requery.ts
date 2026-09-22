"use client";

import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import type { ChartSpec } from "@/lib/chart-types";

interface RequeryResult {
  sql: string;
  data: Record<string, string | number>[];
  columns: string[];
  rowCount: number;
  executionTimeMs: number;
  chartSpec: ChartSpec | null;
}

interface UseChartRequeryReturn {
  requery: (params: {
    sql: string;
    newGrain?: "daily" | "weekly" | "monthly";
    newDateRange?: { start: string; end: string };
    title?: string;
  }) => Promise<RequeryResult | null>;
  loading: boolean;
  error: string | null;
}

export function useChartRequery(): UseChartRequeryReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requery = useCallback(
    async (params: {
      sql: string;
      newGrain?: "daily" | "weekly" | "monthly";
      newDateRange?: { start: string; end: string };
      title?: string;
    }): Promise<RequeryResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch<RequeryResult>("/api/chart-requery", {
          method: "POST",
          body: params,
        });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Requery failed";
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { requery, loading, error };
}
