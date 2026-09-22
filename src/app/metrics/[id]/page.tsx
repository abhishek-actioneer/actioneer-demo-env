"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { MetricDetailPanel } from "@/components/metric/metric-detail-panel";
import { UnifiedChart } from "@/components/chart/unified-chart";
import { MetricCalendar } from "@/components/chart/metric-calendar";
import { useChartRequery } from "@/hooks/use-chart-requery";
import type { ChartSpec } from "@/lib/chart-types";
import { useDataset } from "@/lib/dataset-context";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { apiFetch } from "@/lib/api-client";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";
import { getMetric, getAllMetrics, saveMetric } from "@/lib/metric-store";
import { hasPendingUpdate, getPendingUpdate, subscribe as subscribePendingUpdates } from "@/lib/metric-update-store";
import { METRIC_TYPE_LABELS, type Metric } from "@/lib/metric-types";
import { formatValue } from "@/lib/format-utils";
import { deltaColorClass } from "@/lib/delta-colors";

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

function MetricUnifiedChart({ metric, isPending, pendingSql }: { metric: Metric; isPending: boolean; pendingSql?: string }) {
  const { dataset } = useDataset();
  const { requery } = useChartRequery();

  // Use pending SQL for controls when metric is v0 and hasn't been approved yet
  const effectiveSql = metric.sql || pendingSql || "";

  const tsData = (() => {
    if (isPending && !metric.timeSeries?.length) {
      // Use a date within the dataset range for mock data, not today
      // Subtract 30 days from today to avoid generating dates outside dataset range
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 30);
      const base = metric.value || 1000;
      return Array.from({ length: 14 }, (_, i) => {
        const d = new Date(endDate);
        d.setDate(d.getDate() - (13 - i));
        return { date: d.toISOString().split("T")[0], value: Math.round(base * (0.7 + (((i * 7 + 3) % 10) / 10) * 0.6)) };
      });
    }
    return metric.timeSeries ?? [];
  })();

  const formatHint: "currency" | "percent" | "number" =
    metric.valueFormat === "currency" ? "currency" : metric.valueFormat === "percent" ? "percent" : "number";

  const datasetCurrency = dataset.currency || "₹";

  const initialSpec: ChartSpec = {
    type: "area",
    title: "",
    data: tsData.map((pt) => ({ date: pt.date, value: pt.value })),
    xKey: "date",
    yKeys: ["value"],
    yLabels: ["Value"],
    sql: effectiveSql,
    format: { value: formatHint },
    currency: datasetCurrency,
  };

  const [spec, setSpec] = useState(initialSpec);
  const originalSqlRef = useRef(effectiveSql);
  const activeDateRangeRef = useRef<{ start: string; end: string } | null>(null);
  const activeGrainRef = useRef<"daily" | "weekly" | "monthly">("daily");
  const [userGrain, setUserGrain] = useState<"daily" | "weekly" | "monthly" | null>(null);

  const handleGrainChange = useCallback(async (grain: "daily" | "weekly" | "monthly") => {
    const baseSql = originalSqlRef.current;
    if (!baseSql) return;
    activeGrainRef.current = grain;
    const grainSql = buildGrainSql(baseSql, grain, metric.aggregation);
    const dateRange = activeDateRangeRef.current;
    const result = await requery({
      sql: grainSql,
      newGrain: grain,
      ...(dateRange ? { newDateRange: dateRange } : {}),
      title: metric.name,
    });
    if (result?.data) {
      // Update grain + data together so calendar switches in one frame
      setUserGrain(grain);
      setSpec((prev) => ({
        ...prev,
        data: result.data,
        sql: result.sql,
        grain,
      }));
    }
  }, [requery, metric.name, metric.aggregation]);

  const handleTimeRangeChange = useCallback(async (range: { start: string; end: string } | string) => {
    const baseSql = originalSqlRef.current;
    if (!baseSql) return;
    const grain = activeGrainRef.current;
    if (typeof range === "string") {
      activeDateRangeRef.current = null;
      const grainSql = buildGrainSql(baseSql, grain, metric.aggregation);
      const result = await requery({ sql: grainSql, newGrain: grain, title: metric.name });
      if (result?.data) {
        setSpec((prev) => ({ ...prev, data: result.data, sql: result.sql, dateRange: undefined }));
      }
      return;
    }
    const dateRange = range as { start: string; end: string };
    activeDateRangeRef.current = dateRange;
    const grainSql = buildGrainSql(baseSql, grain, metric.aggregation);
    const result = await requery({ sql: grainSql, newGrain: grain, newDateRange: dateRange, title: metric.name });
    if (result?.data) {
      setSpec((prev) => ({ ...prev, data: result.data, sql: result.sql, dateRange }));
    }
  }, [requery, metric.name, metric.aggregation]);

  const hasSql = !!effectiveSql;

  const calendarData = useMemo(() =>
    spec.data
      .filter((d) => d.date != null && d.value != null)
      .map((d) => ({ date: String(d.date), value: Number(d.value) })),
    [spec.data],
  );

  const currency = datasetCurrency;

  // Hero value: latest data point from the time series (most recent day/week/month)
  const displayValue = useMemo(() => {
    const values = spec.data.map((d) => Number(d.value)).filter((v) => !isNaN(v));
    if (values.length > 0) return values[values.length - 1];
    return metric.value;
  }, [spec.data, metric.value]);

  // Change % from first to last visible data point
  const displayChange = useMemo(() => {
    const values = spec.data.map((d) => Number(d.value)).filter((v) => !isNaN(v));
    if (values.length < 2) return metric.changePercent ?? null;
    const first = values[0];
    if (first === 0) return null;
    return Math.round(((values[values.length - 1] - first) / first) * 10000) / 100;
  }, [spec.data, metric.changePercent]);

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

  return (
    <>
      <div className="rounded-xl border border-border">
        {/* Hero value — Perplexity-style, inside the chart card */}
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-baseline gap-2.5">
            <span className="text-2xl font-semibold tracking-tight tabular-nums leading-none">
              {formatValue(displayValue, metric.valueFormat, currency)}
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
          </div>
          {dateRangeLabel && (
            <p className="text-[9.9px] text-muted-foreground mt-1.5">
              {dateRangeLabel}
            </p>
          )}
        </div>
        {/* Chart */}
        <div className="h-[380px] flex items-center [&>*]:w-full">
          <UnifiedChart
            spec={spec}
            className="h-full !border-0 !rounded-none !bg-transparent"
            height={300}
            onGrainChange={hasSql ? handleGrainChange : undefined}
            onTimeRangeChange={hasSql ? handleTimeRangeChange : undefined}
          />
        </div>
      </div>
      {calendarData.length > 0 && (
        <div className="rounded-xl border border-border p-4">
          <MetricCalendar
            data={calendarData}
            format={formatHint}
            currency={metric.valueFormat === "currency" ? currency : undefined}
            grain={userGrain ?? undefined}
            metricName={metric.name}
          />
        </div>
      )}
    </>
  );
}

export default function MetricDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const isCreating = searchParams.get("creating") === "true";
  const metricId = params.id as string;
  const { datasetId } = useDataset();
  const [metric, setMetric] = useState<Metric | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const editEnabled = true;

  useBreadcrumbTitle(metric?.name ?? "");

  const fetchMetric = useCallback(async () => {
    setLoading(true);
    try {
      // Newly created metrics live in the client-side store (not yet in the server API)
      if (isCreating) {
        const stored = getMetric(datasetId, metricId);
        if (stored) {
          setMetric(stored);
          setLoading(false);
          return;
        }
      }
      const data = await apiFetch<{ metrics: Metric[] }>(
        `/api/metrics?datasetId=${encodeURIComponent(datasetId)}`
      );
      const found = data.metrics?.find((m) => m.id === metricId);
      if (found) {
        // Prefer client store if it has a newer version (e.g. locally approved/updated)
        const stored = getMetric(datasetId, metricId);
        const best = stored && stored.version > found.version ? stored : found;
        setMetric(best);
        // Ensure metric is in client store so publish handler can find it
        saveMetric(datasetId, best);
      } else {
        // Fallback: check client store (e.g. newly created metric navigated without ?creating=true)
        const stored = getMetric(datasetId, metricId);
        setMetric(stored || null);
      }
    } catch {
      setMetric(null);
    } finally {
      setLoading(false);
    }
  }, [datasetId, metricId, isCreating]);

  useEffect(() => {
    fetchMetric();
  }, [fetchMetric, refreshKey]);

  const handleMetricUpdated = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Track pending update state reactively
  useEffect(() => {
    setIsPending(hasPendingUpdate(metricId));
    const unsub = subscribePendingUpdates(() => {
      setIsPending(hasPendingUpdate(metricId));
    });
    return unsub;
  }, [metricId]);

  // Push entity context + detail panel into the unified right panel
  const { setEntity, setDetailContent, triggerMetricTableSelect } = useChatPanel();

  // When navigated here with ?creating=true, open chat and show table clarification step.
  // Run once when metric first loads (metric?.id stable after first non-null value).
  useEffect(() => {
    if (!isCreating || !metric) return;
    const suggestedRelated = getAllMetrics(datasetId)
      .filter((m) => m.id !== metricId)
      .slice(0, 3)
      .map((m) => m.name);
    triggerMetricTableSelect({
      metricId: metric.id,
      metricName: metric.name,
      description: metric.description,
      suggestedRelatedMetrics: suggestedRelated,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreating, metric?.id]);
  useEffect(() => {
    if (metric) {
      setEntity({
        id: metric.id,
        name: metric.name,
        type: "metric",
        summary: metric.description,
        contextPayload: {
          id: metric.id,
          name: metric.name,
          description: metric.description,
          formula: metric.formula,
          sql: metric.sql,
          table: metric.table,
          column: metric.column,
          timeColumn: metric.timeColumn,
          aggregation: metric.aggregation,
          granularity: metric.granularity,
          dimensions: metric.dimensions,
          category: metric.category,
          value: metric.value,
          valueFormat: metric.valueFormat,
          changePercent: metric.changePercent,
          timeSeries: metric.timeSeries,
          relationships: metric.relationships,
        },
      });
      setDetailContent(
        <MetricDetailPanel
          metric={metric}
          onMetricUpdated={handleMetricUpdated}
          editEnabled={editEnabled}
        />
      );
    }
    return () => setDetailContent(null);
  }, [metric, setEntity, setDetailContent, handleMetricUpdated]);

  // Stable mock time-series for new metrics with no real data yet (isPending, no timeSeries).
  // Keyed on metric.id + metric.value so values don't re-randomise on every render.
  const mockTimeSeries = useMemo(() => {
    if (!metric || !isPending || metric.timeSeries?.length) return null;
    const base = metric.value || 1000;
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      // Deterministic-ish spread using index so values are stable between renders
      const factor = 0.7 + ((i * 0.043) % 0.6);
      return { date: d.toISOString().split("T")[0], value: Math.round(base * factor) };
    });
  }, [metric?.id, metric?.value, isPending]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!metric) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">Metric not found</p>
          <p className="text-sm text-muted-foreground">
            This metric doesn&apos;t exist or has been deleted.
          </p>
          <button
            onClick={() => router.push("/metrics")}
            className="mt-1 px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Back to Metrics
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-w-0 overflow-y-auto">
      <div className="flex flex-col px-6 py-6 gap-6" key={refreshKey}>
        {isCreating && metric.version === 0 && !isPending ? (
          <div className="h-[450px] flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/20">
            <div className="relative flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-muted-foreground animate-pulse" />
              </div>
              <div className="absolute inset-0 rounded-full border border-border animate-ping opacity-20" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Metric is being computed by Actioneer</p>
              <p className="text-xs text-muted-foreground">Building SQL and formula from your description…</p>
            </div>
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        ) : (
          <MetricUnifiedChart metric={metric} isPending={isPending} pendingSql={getPendingUpdate(metricId)?.newSql} />
        )}
      </div>
    </div>
  );
}
