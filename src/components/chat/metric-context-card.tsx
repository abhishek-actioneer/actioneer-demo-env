"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ChartCore } from "@/components/chart/chart-core";
import { GrainPicker } from "@/components/chart/chart-controls";
import { ChartDateRangePicker } from "@/components/chart/chart-date-range-picker";
import { useChartRequery } from "@/hooks/use-chart-requery";
import { useDataset } from "@/lib/dataset-context";
import { getMetric } from "@/lib/metric-store";
import { formatValue } from "@/lib/format-utils";
import { deltaColorClass } from "@/lib/delta-colors";
import type { MetricContextData } from "@/lib/types";
import type { ChartSpec } from "@/lib/chart-types";

interface MetricContextCardProps {
  data: MetricContextData;
  compact?: boolean;
}

const GRAIN_MAP = { daily: "day", weekly: "week", monthly: "month" } as const;

/** Wrap a metric's daily SQL with DATE_TRUNC to re-aggregate at a different grain */
function buildGrainSql(baseSql: string, grain: "daily" | "weekly" | "monthly", agg: string): string {
  const unit = GRAIN_MAP[grain];
  if (/DATE_TRUNC/i.test(baseSql)) {
    return baseSql.replace(/DATE_TRUNC\s*\(\s*'(day|week|month)'/gi, `DATE_TRUNC('${unit}'`);
  }
  const aggFn = agg === "sum" ? "SUM" : agg === "unique_count" ? "SUM" : "AVG";
  return `SELECT DATE_TRUNC('${unit}', date)::DATE AS date, ROUND(${aggFn}(value)::NUMERIC, 2) AS value\nFROM (${baseSql.replace(/;\s*$/, "")}) sub\nGROUP BY 1\nORDER BY 1`;
}

export function MetricContextCard({ data, compact = false }: MetricContextCardProps) {
  const { datasetId, dataset } = useDataset();
  const { requery } = useChartRequery();
  const currency = dataset.currency || "₹";

  // Look up metric SQL from store for requery support
  const metricSql = useMemo(() => {
    const metric = getMetric(datasetId, data.metricId);
    return metric?.sql ?? null;
  }, [datasetId, data.metricId]);

  const originalSqlRef = useRef(metricSql);
  const activeDateRangeRef = useRef<{ start: string; end: string } | null>(null);
  const activeGrainRef = useRef<"daily" | "weekly" | "monthly">(
    data.timeGrain === "weekly" ? "weekly" : data.timeGrain === "monthly" ? "monthly" : "daily"
  );

  const formatHint: "currency" | "percent" | "number" =
    data.valueFormat === "currency" ? "currency" : data.valueFormat === "percent" ? "percent" : "number";

  // Build initial ChartSpec from timeSeries
  const initialSpec: ChartSpec = useMemo(() => ({
    type: "area" as const,
    title: "",
    data: data.timeSeries.map((pt) => ({ date: pt.date, value: pt.value })),
    xKey: "date",
    yKeys: ["value"],
    yLabels: [data.name],
    sql: metricSql ?? undefined,
    format: { value: formatHint },
    currency,
    grain: activeGrainRef.current,
  }), [data.timeSeries, data.name, metricSql, formatHint, currency]);

  const [spec, setSpec] = useState(initialSpec);
  const [activeGrain, setActiveGrain] = useState(activeGrainRef.current);
  const [localDateRange, setLocalDateRange] = useState<{ start: string; end: string } | undefined>();

  // Hero value: sum for additive metrics, latest for ratios
  const isAdditive = ["sum", "count", "unique_count"].includes(data.aggregation);
  const displayValue = useMemo(() => {
    const values = spec.data.map((d) => Number(d.value)).filter((v) => !isNaN(v));
    if (!values.length) return data.value;
    return isAdditive
      ? values.reduce((s, v) => s + v, 0)
      : values[values.length - 1];
  }, [spec.data, data.value, isAdditive]);

  // Change %: compare current period aggregate to previous period of same length
  const displayChange = useMemo(() => {
    const all = data.timeSeries;
    const visible = spec.data.map((d) => Number(d.value)).filter((v) => !isNaN(v));
    if (visible.length < 2) return data.changePercent ?? null;

    const periodLen = visible.length;
    const allValues = all.map((d) => d.value);
    const endIdx = allValues.length - periodLen;

    if (endIdx >= periodLen) {
      const prevSlice = allValues.slice(endIdx - periodLen, endIdx);
      const curAgg = isAdditive ? visible.reduce((s, v) => s + v, 0) : visible[visible.length - 1];
      const prevAgg = isAdditive ? prevSlice.reduce((s, v) => s + v, 0) : prevSlice[prevSlice.length - 1];
      if (prevAgg === 0) return null;
      return Math.round(((curAgg - prevAgg) / prevAgg) * 10000) / 100;
    }

    const first = visible[0];
    if (first === 0) return null;
    return Math.round(((visible[visible.length - 1] - first) / first) * 10000) / 100;
  }, [spec.data, data.timeSeries, data.changePercent, isAdditive]);

  // Date range label
  const dateRangeLabel = useMemo(() => {
    const dates = spec.data.filter((d) => d.date != null).map((d) => String(d.date));
    if (dates.length < 1) return null;
    const fmt = (s: string) => {
      const d = new Date(s + "T00:00:00");
      return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    };
    const first = fmt(dates[0]);
    const last = fmt(dates[dates.length - 1]);
    return first === last ? first : `${first} – ${last}`;
  }, [spec.data]);

  const hasSql = !!metricSql;

  // Grain change handler
  const handleGrainChange = useCallback(async (grain: "daily" | "weekly" | "monthly") => {
    const baseSql = originalSqlRef.current;
    if (!baseSql) return;
    activeGrainRef.current = grain;
    setActiveGrain(grain);
    const grainSql = buildGrainSql(baseSql, grain, data.aggregation);
    const dateRange = activeDateRangeRef.current;
    const result = await requery({
      sql: grainSql,
      newGrain: grain,
      ...(dateRange ? { newDateRange: dateRange } : {}),
      title: data.name,
    });
    if (result?.data) {
      setSpec((prev) => ({ ...prev, data: result.data, sql: result.sql, grain }));
    }
  }, [requery, data.name, data.aggregation]);

  // Time range change handler
  const handleTimeRangeChange = useCallback(async (range: { start: string; end: string } | string) => {
    const baseSql = originalSqlRef.current;
    if (!baseSql) return;
    const grain = activeGrainRef.current;
    if (typeof range === "string") {
      activeDateRangeRef.current = null;
      setLocalDateRange(undefined);
      const grainSql = buildGrainSql(baseSql, grain, data.aggregation);
      const result = await requery({ sql: grainSql, newGrain: grain, title: data.name });
      if (result?.data) {
        setSpec((prev) => ({ ...prev, data: result.data, sql: result.sql, dateRange: undefined }));
      }
      return;
    }
    activeDateRangeRef.current = range;
    setLocalDateRange(range);
    const grainSql = buildGrainSql(baseSql, grain, data.aggregation);
    const result = await requery({ sql: grainSql, newGrain: grain, newDateRange: range, title: data.name });
    if (result?.data) {
      setSpec((prev) => ({ ...prev, data: result.data, sql: result.sql, dateRange: range }));
    }
  }, [requery, data.name, data.aggregation]);

  const chartHeight = compact ? 160 : 220;

  return (
    <div className="w-full rounded-xl border border-border bg-card overflow-hidden">
      {/* Header: name + hero value + change */}
      <div className={`px-5 ${compact ? "pt-3 pb-2" : "pt-4 pb-3"}`}>
        <p className="text-sm text-muted-foreground mb-1">{data.name}</p>
        <div className="flex items-baseline gap-2.5">
          <span className={`${compact ? "text-xl" : "text-2xl"} font-semibold tracking-tight tabular-nums leading-none`}>
            {formatValue(displayValue, data.valueFormat, currency)}
          </span>
          {displayChange != null && (
            <span
              className={`text-xs font-medium tabular-nums ${deltaColorClass(displayChange)}`}
            >
              {displayChange >= 0 ? "↗" : "↘"}{" "}
              {displayChange >= 0 ? "+" : ""}
              {displayChange.toFixed(1)}%
            </span>
          )}
          {dateRangeLabel && (
            <span className="text-[9.9px] text-muted-foreground ml-auto">
              {dateRangeLabel}
            </span>
          )}
        </div>
      </div>

      {/* Controls row */}
      {hasSql && (
        <div className="px-5 pb-2 flex items-center gap-1.5">
          <ChartDateRangePicker
            value={localDateRange}
            onChange={handleTimeRangeChange}
          />
          <GrainPicker active={activeGrain} onChange={handleGrainChange} />
        </div>
      )}

      {/* Chart */}
      <div style={{ height: chartHeight }}>
        <ChartCore spec={spec} height={chartHeight} />
      </div>

      {/* Footer CTA */}
      {!compact && (
        <div className="border-t border-border px-5 py-2.5 flex justify-center">
          <Link
            href={`/metrics/${data.metricId}`}
            target="_blank"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
          >
            Deep dive on {data.name}
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      )}
    </div>
  );
}
