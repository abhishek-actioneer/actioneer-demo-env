"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { apiFetch } from "@/lib/api-client";
import { getSeriesColor, getSeriesDash } from "@/lib/chart-colors";
import { deltaColorClass } from "@/lib/delta-colors";
import type { FunnelConfig } from "@/lib/funnel-types";
import type { FunnelTrendResult, TrendGranularity, TrendComparison } from "@/lib/funnel-trend-sql";

interface TrendTabProps {
  funnelId: string;
  config: FunnelConfig;
  eventCatalog: Array<{ id: string; displayName: string }>;
}

const GRANULARITY_OPTIONS: { value: TrendGranularity; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

const COMPARISON_OPTIONS: { value: TrendComparison; label: string }[] = [
  { value: "none", label: "None" },
  { value: "previous_period", label: "Previous Period" },
  { value: "previous_year", label: "Previous Year" },
];

type ViewMode = "overall" | "per-step";

function formatDelta(current: number, comparison: number): string {
  const delta = current - comparison;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}pp`;
}

export function TrendTab({ funnelId, config, eventCatalog }: TrendTabProps) {
  const [granularity, setGranularity] = useState<TrendGranularity>("day");
  const [comparison, setComparison] = useState<TrendComparison>("none");
  const [viewMode, setViewMode] = useState<ViewMode>("overall");
  const [data, setData] = useState<FunnelTrendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepLabels = useMemo(() => {
    return config.steps.map((step) => {
      const def = eventCatalog.find((e) => e.id === step.eventId);
      return step.label || def?.displayName || step.eventId;
    });
  }, [config.steps, eventCatalog]);

  const fetchTrend = useCallback(async () => {
    if (config.steps.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<FunnelTrendResult>(
        `/api/funnels/${funnelId}/trend`,
        {
          method: "POST",
          body: { granularity, comparison, config },
        }
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trend data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [funnelId, granularity, comparison, config]);

  useEffect(() => {
    fetchTrend();
  }, [fetchTrend]);

  // Compute overall conversion delta between current and comparison
  const overallDelta = useMemo(() => {
    if (!data?.periods.length || !data?.comparisonPeriods?.length) return null;

    // Average overall conversion for current periods
    const currentRates = data.periods.map((p) => {
      const last = p.steps[p.steps.length - 1];
      return last?.conversionRate ?? 0;
    });
    const currentAvg = currentRates.reduce((a, b) => a + b, 0) / currentRates.length;

    // Average overall conversion for comparison periods
    const compRates = data.comparisonPeriods.map((p) => {
      const last = p.steps[p.steps.length - 1];
      return last?.conversionRate ?? 0;
    });
    const compAvg = compRates.reduce((a, b) => a + b, 0) / compRates.length;

    return { current: currentAvg, comparison: compAvg };
  }, [data]);

  // Transform data for recharts
  const chartData = useMemo(() => {
    if (!data?.periods.length) return [];

    return data.periods.map((p, idx) => {
      const row: Record<string, unknown> = { period: p.period };

      if (viewMode === "overall") {
        const lastStep = p.steps[p.steps.length - 1];
        row.conversionRate = lastStep?.conversionRate ?? 0;

        // Add comparison data if available
        if (data.comparisonPeriods && idx < data.comparisonPeriods.length) {
          const compP = data.comparisonPeriods[idx];
          const compLast = compP.steps[compP.steps.length - 1];
          row.compConversionRate = compLast?.conversionRate ?? 0;
        }
      } else {
        for (const s of p.steps) {
          row[`step${s.stepIndex}`] = s.conversionRate;
          row[`step${s.stepIndex}_count`] = s.count;
        }
        // Add comparison per-step data
        if (data.comparisonPeriods && idx < data.comparisonPeriods.length) {
          const compP = data.comparisonPeriods[idx];
          for (const s of compP.steps) {
            row[`comp_step${s.stepIndex}`] = s.conversionRate;
          }
        }
      }

      return row;
    });
  }, [data, viewMode]);

  const hasComparison = !!data?.comparisonPeriods?.length;

  const formatPeriod = useCallback(
    (val: string) => {
      if (!val) return "";
      const d = new Date(val + "T00:00:00");
      if (granularity === "month") {
        return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      }
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    },
    [granularity]
  );

  if (config.steps.length < 2) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Add at least 2 steps to see conversion trends
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex items-center gap-4 text-sm flex-wrap">
        {/* Granularity picker */}
        <div className="flex items-center rounded-md border overflow-hidden">
          {GRANULARITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setGranularity(opt.value)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                granularity === opt.value
                  ? "bg-foreground text-background"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* View mode toggle */}
        <div className="flex items-center rounded-md border overflow-hidden">
          <button
            onClick={() => setViewMode("overall")}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === "overall"
                ? "bg-foreground text-background"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            Overall
          </button>
          <button
            onClick={() => setViewMode("per-step")}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === "per-step"
                ? "bg-foreground text-background"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            Per Step
          </button>
        </div>

        {/* Comparison picker */}
        <div className="flex items-center rounded-md border overflow-hidden">
          {COMPARISON_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setComparison(opt.value)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                comparison === opt.value
                  ? "bg-foreground text-background"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Delta badge + metadata */}
        <div className="flex items-center gap-3 ml-auto">
          {overallDelta && !loading && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded border ${deltaColorClass(overallDelta.current - overallDelta.comparison)}`}
            >
              {formatDelta(overallDelta.current, overallDelta.comparison)} vs prev
            </span>
          )}
          {data && !loading && (
            <span className="text-xs text-muted-foreground">
              {data.periods.length} periods · {data.executionTimeMs}ms
            </span>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="relative rounded-lg border bg-background min-h-[350px] flex items-center justify-center">
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading trend data...</span>
          </div>
        )}

        {error && !loading && (
          <div className="text-center max-w-md px-4">
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {!loading && !error && chartData.length === 0 && (
          <p className="text-sm text-muted-foreground">No trend data available</p>
        )}

        {!loading && !error && chartData.length > 0 && (
          <div className="w-full h-[350px] px-4 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  strokeOpacity={0.3}
                  vertical={false}
                />
                <XAxis
                  dataKey="period"
                  tickFormatter={formatPeriod}
                  tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  padding={{ left: 4, right: 4 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 8.1, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                  tickCount={5}
                  domain={[0, "auto"]}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-md border border-border bg-popover px-3 py-2 shadow-sm antialiased">
                        <p className="text-[9.9px] font-medium text-foreground mb-1">{formatPeriod(String(label ?? ""))}</p>
                        {payload.map((entry, i) => {
                          const isComp = String(entry.dataKey).startsWith("comp");
                          const stepIdx = viewMode === "per-step"
                            ? parseInt(String(entry.dataKey).replace(/^comp_/, "").replace("step", ""))
                            : null;
                          const labelText = viewMode === "per-step"
                            ? `${isComp ? "(prev) " : ""}${stepLabels[stepIdx ?? 0] ?? `Step ${(stepIdx ?? 0) + 1}`}`
                            : isComp
                              ? "Previous"
                              : "Current";
                          return (
                            <p key={i} className="text-[9.9px] text-muted-foreground tabular-nums">
                              <span
                                className="inline-block w-2 h-2 rounded-full mr-1.5"
                                style={{ backgroundColor: entry.color }}
                              />
                              {labelText}: {Number(entry.value).toFixed(1)}%
                            </p>
                          );
                        })}
                      </div>
                    );
                  }}
                />

                {hasComparison && (
                  <Legend content={() => null} />
                )}

                {viewMode === "overall" ? (
                  <>
                    <Line
                      type="monotone"
                      dataKey="conversionRate"
                      name="Current"
                      stroke={getSeriesColor(0)}
                      strokeWidth={2}
                      dot={chartData.length > 60 ? false : { r: 2.5, fill: getSeriesColor(0) }}
                      activeDot={{ r: 4, fill: getSeriesColor(0) }}
                    />
                    {hasComparison && (
                      <Line
                        type="monotone"
                        dataKey="compConversionRate"
                        name="Previous"
                        stroke={getSeriesColor(0)}
                        strokeWidth={1.5}
                        strokeDasharray="6 3"
                        strokeOpacity={0.4}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                    )}
                  </>
                ) : (
                  <>
                    {config.steps.map((_, i) => (
                      <Line
                        key={i}
                        type="monotone"
                        dataKey={`step${i}`}
                        name={stepLabels[i]}
                        stroke={getSeriesColor(i)}
                        strokeWidth={i === 0 ? 2 : 1.5}
                        strokeDasharray={getSeriesDash(i)}
                        dot={chartData.length > 60 ? false : { r: 2, fill: getSeriesColor(i) }}
                        activeDot={{ r: 3 }}
                      />
                    ))}
                    {hasComparison &&
                      config.steps.map((_, i) => (
                        <Line
                          key={`comp-${i}`}
                          type="monotone"
                          dataKey={`comp_step${i}`}
                          name={`(prev) ${stepLabels[i]}`}
                          stroke={getSeriesColor(i)}
                          strokeWidth={1}
                          strokeDasharray="6 3"
                          strokeOpacity={0.35}
                          dot={false}
                          activeDot={{ r: 2 }}
                        />
                      ))}
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Legend */}
      {!loading && chartData.length > 0 && (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground px-1">
          {viewMode === "overall" ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: getSeriesColor(0) }} />
                Current
              </span>
              {hasComparison && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-0.5 w-4 rounded opacity-40"
                    style={{
                      backgroundColor: getSeriesColor(0),
                      backgroundImage: `repeating-linear-gradient(90deg, ${getSeriesColor(0)} 0 3px, transparent 3px 6px)`,
                    }}
                  />
                  {data?.comparisonLabel ?? "Previous"}
                </span>
              )}
            </>
          ) : (
            <>
              {config.steps.map((_, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: getSeriesColor(i) }}
                  />
                  {stepLabels[i]}
                </span>
              ))}
              {hasComparison && (
                <span className="inline-flex items-center gap-1.5 border-l pl-4 ml-1">
                  <span
                    className="inline-block h-0.5 w-4 rounded opacity-40"
                    style={{
                      backgroundImage: `repeating-linear-gradient(90deg, ${getSeriesColor(0)} 0 3px, transparent 3px 6px)`,
                    }}
                  />
                  Dashed = {data?.comparisonLabel ?? "Previous"}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
