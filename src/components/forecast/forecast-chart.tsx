"use client";

import { useMemo } from "react";
import React from "react";
import { UnifiedChart } from "@/components/chart/unified-chart";
import type { ChartSpec } from "@/lib/chart-types";
import type { ForecastModel, ResolvedTable } from "@/lib/forecast-types";

interface ForecastChartProps {
  model: ForecastModel;
  resolved: ResolvedTable;
}

export const ForecastChart = React.memo(function ForecastChart({ model, resolved }: ForecastChartProps) {
  const visibleRows = model.rows.filter((r) => r.showOnChart);
  const dividerIdx = resolved.columns.findIndex((c) => c.isForecast);

  const chartSpec = useMemo((): ChartSpec | null => {
    if (visibleRows.length === 0) return null;

    // Build data: each column becomes a data point with hist + fc values per metric
    const data: Record<string, string | number>[] = resolved.columns.map((col, i) => {
      const point: Record<string, string | number> = { label: col.label };
      visibleRows.forEach((row) => {
        const val = resolved.rows[row.id]?.[col.key]?.value ?? null;
        if (!col.isForecast) {
          if (val != null) point[`${row.id}_hist`] = val;
        } else {
          if (val != null) point[`${row.id}_fc`] = val;
          // Bridge point: connect hist to fc at divider
          if (i === dividerIdx) {
            const prevCol = resolved.columns[i - 1];
            const prevVal = resolved.rows[row.id]?.[prevCol?.key]?.value ?? null;
            if (prevVal != null) point[`${row.id}_hist`] = prevVal;
          }
        }
      });
      return point;
    });

    const histKeys = visibleRows.map((r) => `${r.id}_hist`);
    const fcKeys = visibleRows.map((r) => `${r.id}_fc`);
    const histLabels = visibleRows.map((r) => r.label);
    const fcLabels = visibleRows.map((r) => `${r.label} (forecast)`);

    // Build format map from row formats
    const format: Record<string, "number" | "currency" | "percent"> = {};
    visibleRows.forEach((row) => {
      const fmt = row.format === "currency" ? "currency" : row.format === "percent" ? "percent" : "number";
      format[`${row.id}_hist`] = fmt;
      format[`${row.id}_fc`] = fmt;
    });

    const forecastStartLabel = dividerIdx >= 0 ? resolved.columns[dividerIdx].label : undefined;

    return {
      type: "line",
      title: "",
      data,
      xKey: "label",
      yKeys: [...histKeys, ...fcKeys],
      yLabels: [...histLabels, ...fcLabels],
      forecastKeys: fcKeys,
      forecastStartX: forecastStartLabel,
      format,
      currency: "$",
    };
  }, [resolved, visibleRows, dividerIdx]);

  if (visibleRows.length === 0) {
    return (
      <div className="my-4 border border-border rounded-lg p-4 bg-card">
        <p className="text-xs text-muted-foreground text-center py-4">
          No metrics selected for chart. Toggle the chart icon on a row to add it.
        </p>
      </div>
    );
  }

  if (!chartSpec) return null;

  return (
    <div className="my-4 border border-border rounded-lg p-4 bg-card mb-8">
      <UnifiedChart spec={chartSpec} variant="compact" height={260} />
    </div>
  );
});
