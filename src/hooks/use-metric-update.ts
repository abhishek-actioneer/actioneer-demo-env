"use client";

import { useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { addPendingUpdate } from "@/lib/metric-update-store";
import { getDownstreamIds } from "@/lib/approval-store";
import type { Metric } from "@/lib/metric-types";

export interface MetricUpdateResult {
  success: boolean;
  newSql: string;
  newFormula: string;
  newDescription?: string;
  explanation: string;
  affectedMetrics: string[];
  valueSql?: string;
  timeSeriesSql?: string;
}

export function useMetricUpdate() {
  const requestMetricUpdate = useCallback(
    async (metric: Metric, userRequest: string, signal?: AbortSignal): Promise<MetricUpdateResult | null> => {
      try {
        const raw = await apiFetch<MetricUpdateResult & { valueSql?: string; timeSeriesSql?: string }>("/api/metric-update", {
          method: "POST",
          body: {
            metricName: metric.name,
            currentSql: metric.sql,
            currentFormula: metric.formula,
            table: metric.table,
            column: metric.column,
            timeColumn: metric.timeColumn,
            description: metric.description,
            relationships: metric.relationships.map((r) => ({
              metricId: r.metricId,
              metricName: r.metricName,
              direction: r.direction,
            })),
            userRequest,
          },
          signal,
        });
        // Map timeSeriesSql → newSql for backward compat
        return {
          ...raw,
          newSql: raw.timeSeriesSql || raw.newSql,
        };
      } catch {
        return null;
      }
    },
    []
  );

  const publishUpdate = useCallback(
    (metric: Metric, result: MetricUpdateResult, userRequest: string) => {
      const downstreamIds = getDownstreamIds(metric.id);
      const affectedMetrics = metric.relationships
        .filter((r) => r.direction === "drives")
        .map((r) => ({ id: r.metricId, name: r.metricName }));

      // Include downstream IDs from the approval store that aren't already in relationships
      const existingIds = new Set(affectedMetrics.map((m) => m.id));
      for (const id of downstreamIds) {
        if (!existingIds.has(id)) {
          affectedMetrics.push({ id, name: id });
        }
      }

      addPendingUpdate({
        id: `update-${Date.now()}`,
        metricId: metric.id,
        metricName: metric.name,
        oldSql: metric.sql,
        newSql: result.newSql,
        oldFormula: metric.formula,
        newFormula: result.newFormula,
        affectedMetrics,
        description: userRequest,
        triggeredBy: undefined,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    },
    []
  );

  return { requestMetricUpdate, publishUpdate };
}
