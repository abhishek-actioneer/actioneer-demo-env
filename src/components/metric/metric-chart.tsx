"use client";

import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { MetricValueFormat } from "@/lib/metric-types";

const PERIODS = ["24h", "7d", "30d", "Custom"] as const;
type Period = (typeof PERIODS)[number];

const PERIOD_DAYS: Record<Period, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  Custom: Infinity,
};

const PERIOD_LABELS: Record<Period, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  Custom: "Custom",
};

function formatValue(value: number, format: MetricValueFormat): string {
  if (value == null || isNaN(value)) return "—";
  switch (format) {
    case "currency":
      return value >= 1000000
        ? `$${(value / 1000000).toFixed(1)}M`
        : value >= 1000
        ? `$${(value / 1000).toFixed(1)}K`
        : `$${value.toFixed(2)}`;
    case "percent":
      return `${value.toFixed(2)}%`;
    case "integer":
      return value >= 1000000
        ? `${(value / 1000000).toFixed(1)}M`
        : value >= 1000
        ? `${(value / 1000).toFixed(1)}K`
        : value.toLocaleString();
    default:
      return value.toLocaleString();
  }
}

/** Pick a color based on trend direction */
function getTrendColor(data: { value: number }[]): string {
  if (data.length < 2) return "var(--color-muted-foreground)";
  const first = data[0].value;
  const last = data[data.length - 1].value;
  if (first === 0 && last === 0) return "var(--color-muted-foreground)";
  const change = first !== 0 ? (last - first) / Math.abs(first) : 0;
  if (change > 0.02) return "#10b981";
  if (change < -0.02) return "#ef4444";
  return "var(--color-muted-foreground)";
}

/** Compute a reasonable tick interval so labels don't overlap */
function getTickInterval(dataLength: number): number {
  if (dataLength <= 8) return 0;
  if (dataLength <= 15) return 1;
  if (dataLength <= 30) return Math.floor(dataLength / 8) - 1;
  return Math.floor(dataLength / 7) - 1;
}

/** Parse a date string robustly (handles YYYY-MM-DD, ISO, etc.) */
function parseDate(d: string): Date {
  const parsed = new Date(d);
  if (!isNaN(parsed.getTime())) return parsed;
  // Fallback: return epoch so it sorts to beginning
  return new Date(0);
}

/** Determine the best default period based on data's actual date span */
function getDefaultPeriod(data: { date: string }[]): Period {
  if (data.length < 2) return "Custom";
  const first = parseDate(data[0].date).getTime();
  const last = parseDate(data[data.length - 1].date).getTime();
  const spanDays = (last - first) / (1000 * 60 * 60 * 24);
  if (spanDays <= 1) return "24h";
  if (spanDays <= 7) return "7d";
  if (spanDays <= 30) return "30d";
  return "Custom";
}

/** Filter data by actual date range from the end */
function filterByPeriod(
  data: { date: string; value: number }[],
  period: Period,
): { date: string; value: number }[] {
  if (!data.length) return [];
  if ((period as string) === "All") return data;

  const days = PERIOD_DAYS[period];
  const lastDate = parseDate(data[data.length - 1].date);
  const cutoff = new Date(lastDate.getTime() - days * 24 * 60 * 60 * 1000);

  return data.filter((d) => parseDate(d.date) >= cutoff);
}

/** Which periods have enough data to be meaningful (>= 2 points) */
function getAvailablePeriods(data: { date: string }[]): Set<Period> {
  const available = new Set<Period>();
  // Custom is always available
  available.add("Custom");
  if (data.length < 2) return available;

  const lastDate = parseDate(data[data.length - 1].date);

  for (const p of PERIODS) {
    if (p === "Custom") continue;
    const days = PERIOD_DAYS[p];
    const cutoff = new Date(lastDate.getTime() - days * 24 * 60 * 60 * 1000);
    const count = data.filter((d) => parseDate(d.date) >= cutoff).length;
    if (count >= 2) available.add(p);
  }

  return available;
}

export function MetricChart({
  data,
  valueFormat,
  height,
  fillHeight,
  pendingTimeSeries,
  isPendingApproval,
}: {
  data: { date: string; value: number }[];
  valueFormat: MetricValueFormat;
  height?: number;
  fillHeight?: boolean;
  pendingTimeSeries?: { date: string; value: number }[];
  isPendingApproval?: boolean;
}) {
  const hasPending = !!(pendingTimeSeries && pendingTimeSeries.length > 0);

  const defaultPeriod = useMemo(() => getDefaultPeriod(data || []), [data]);
  const [period, setPeriod] = useState<Period | null>(null);
  const activePeriod = period ?? defaultPeriod;
  const [aggregation, setAggregation] = useState<"Day" | "Week" | "Month">("Day");

  // Custom date range
  const dataFirst = data?.length ? data[0].date : "";
  const dataLast = data?.length ? data[data.length - 1].date : "";
  const [customStart, setCustomStart] = useState(dataFirst);
  const [customEnd, setCustomEnd] = useState(dataLast);

  const availablePeriods = useMemo(() => getAvailablePeriods(data || []), [data]);

  const filtered = useMemo(() => {
    const d = data || [];
    if (activePeriod === "Custom") {
      if (!customStart && !customEnd) return d;
      return d.filter((pt) => {
        const t = parseDate(pt.date).getTime();
        const s = customStart ? parseDate(customStart).getTime() : -Infinity;
        const e = customEnd ? parseDate(customEnd).getTime() + 86400000 : Infinity;
        return t >= s && t <= e;
      });
    }
    return filterByPeriod(d, activePeriod);
  }, [data, activePeriod, customStart, customEnd]);

  // When pending: merge old + new into combined points keyed by date
  const combinedData = useMemo(() => {
    if (!hasPending) return filtered;
    const pendingMap = new Map((pendingTimeSeries ?? []).map((p) => [p.date, p.value]));
    return filtered.map((pt) => ({
      date: pt.date,
      oldValue: pt.value,
      newValue: pendingMap.get(pt.date) ?? pt.value,
    }));
  }, [filtered, pendingTimeSeries, hasPending]);

  // Pending approval → amber; dual mode (proposed overlay) uses hardcoded green/red; otherwise green
  const color = useMemo(() => {
    if (isPendingApproval && !hasPending) return "#f59e0b"; // amber while awaiting approval
    return "#10b981"; // green steady state
  }, [isPendingApproval, hasPending]);
  const tickInterval = useMemo(() => getTickInterval(filtered.length), [filtered.length]);

  if (!filtered.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height: fillHeight ? "100%" : height ?? 240 }}
      >
        No chart data available.
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${fillHeight ? "h-full" : ""}`}>
      {/* Chart area */}
      <div className={`rounded-xl overflow-hidden ${fillHeight ? "flex-1 min-h-0" : ""}`} style={!fillHeight ? { height: height ?? 240 } : undefined}>
        <ResponsiveContainer width="100%" height="100%">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <AreaChart data={combinedData as any} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="metricGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.15} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
              {hasPending && (
                <linearGradient id="metricGradientOld" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              )}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9.9, fill: "var(--color-muted-foreground)" }}
              tickFormatter={(d: string) => {
                const date = parseDate(d);
                const spansYears = filtered.length >= 2 &&
                  parseDate(filtered[0].date).getFullYear() !== parseDate(filtered[filtered.length - 1].date).getFullYear();
                return date.toLocaleDateString("en-US", spansYears
                  ? { month: "short", year: "2-digit" }
                  : { month: "short", day: "numeric" });
              }}
              interval={tickInterval}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 9.9, fill: "var(--color-muted-foreground)", dx: 4 }}
              tickFormatter={(v: number) => formatValue(v, valueFormat)}
              axisLine={false}
              tickLine={false}
              mirror
              width={1}
              orientation="left"
            />
            <Tooltip
              contentStyle={{
                fontSize: 10.8,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-background)",
              }}
              formatter={(v, name) => [
                formatValue(Number(v), valueFormat),
                hasPending ? (name === "newValue" ? "Proposed" : "Current") : "Value",
              ]}
              labelFormatter={(label) => {
                const date = parseDate(String(label));
                return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              }}
            />
            {hasPending ? (
              <>
                <Area
                  type="monotone"
                  dataKey="oldValue"
                  stroke="#ef4444"
                  strokeWidth={2}
                  fill="url(#metricGradientOld)"
                  strokeDasharray="4 3"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="newValue"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#metricGradient)"
                  dot={false}
                />
              </>
            ) : (
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill="url(#metricGradient)"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Period selector + aggregation — bottom */}
      <div className="flex flex-wrap items-start justify-between gap-2 pt-3 mt-auto border-t border-border">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9.9px] font-medium text-muted-foreground">Date Range</span>
          <div className="flex items-center gap-0.5">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                disabled={p !== "Custom" && !availablePeriods.has(p)}
                className={`px-2.5 py-1 text-[9.9px] font-medium rounded-md border transition-colors ${
                  activePeriod === p
                    ? "border-foreground text-foreground bg-foreground/10"
                    : availablePeriods.has(p)
                    ? "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                    : "border-border/40 text-muted-foreground/40 cursor-not-allowed"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          {activePeriod === "Custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="text-[9.9px] px-2 py-1 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring/20"
              />
              <span className="text-[9.9px] text-muted-foreground">—</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="text-[9.9px] px-2 py-1 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring/20"
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9.9px] font-medium text-muted-foreground">Aggregation</span>
          <div className="flex items-center gap-0.5">
            {(["Day", "Week", "Month"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setAggregation(g)}
                className={`px-2.5 py-1 text-[9.9px] font-medium rounded-md border transition-colors ${
                  aggregation === g
                    ? "border-foreground text-foreground bg-foreground/10"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
