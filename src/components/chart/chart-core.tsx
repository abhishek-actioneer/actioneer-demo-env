"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import type { ChartSpec, ChartAnnotation } from "@/lib/chart-types";
import {
  getSeriesColor,
  getSeriesDash,
} from "@/lib/chart-colors";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";

// ── Y-Axis Formatting ──
// Simple: abbreviate with M/K, drop decimals when the number is whole.

export function formatAxisTick(val: number, fmt?: "number" | "currency" | "percent", sym = "$"): string {
  const abs = Math.abs(val);

  if (fmt === "percent") {
    return val.toFixed(1) + "%";
  }

  if (abs >= 1_000_000_000) {
    const n = val / 1_000_000_000;
    const s = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
    return fmt === "currency" ? `${sym}${s}B` : `${s}B`;
  }
  if (abs >= 1_000_000) {
    const n = val / 1_000_000;
    const s = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
    return fmt === "currency" ? `${sym}${s}M` : `${s}M`;
  }
  if (abs >= 1_000) {
    const n = val / 1_000;
    const s = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
    return fmt === "currency" ? `${sym}${s}K` : `${s}K`;
  }
  if (!Number.isInteger(val)) {
    const s = val.toFixed(abs < 1 ? 2 : 1);
    return fmt === "currency" ? `${sym}${s}` : s;
  }
  return fmt === "currency" ? `${sym}${val}` : String(val);
}

// Generic value formatter (used by table, tooltip — not range-aware, just abbreviation)
export function formatValue(
  val: number,
  fmt?: "number" | "currency" | "percent",
  currency?: string,
): string {
  const sym = currency ?? "$";
  const abs = Math.abs(val);
  if (fmt === "currency") {
    if (abs >= 1_000_000_000)
      return sym + (val / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
    if (abs >= 1_000_000)
      return sym + (val / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (abs >= 1_000)
      return sym + (val / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
    return sym + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (fmt === "percent") {
    return val.toFixed(1) + "%";
  }
  if (abs >= 1_000_000_000)
    return (val / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  if (abs >= 1_000_000)
    return (val / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(val) >= 10_000)
    return (val / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return val.toLocaleString();
}

function formatTooltipValue(
  val: number,
  fmt?: "number" | "currency" | "percent",
  currency?: string,
): string {
  const sym = currency ?? "$";
  if (fmt === "currency")
    return sym + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (fmt === "percent") {
    return val.toFixed(1) + "%";
  }
  return val.toLocaleString();
}

// ── X-Axis Formatting ──

interface XAxisContext {
  spanDays: number;
  spansYears: boolean;
  isMonthly: boolean;
  isDateData: boolean;
}

// Build context from data — returns an object, no module-level mutation
export function buildXAxisContext(data: Record<string, string | number>[], xKey: string): XAxisContext {
  const dates: Date[] = [];
  for (const row of data) {
    const v = row[xKey];
    if (typeof v !== "string" || !/^\d{4}-\d{2}/.test(v)) continue;
    const d = new Date(v);
    if (!isNaN(d.getTime())) dates.push(d);
  }

  if (dates.length < 2) {
    return { spanDays: 0, spansYears: false, isMonthly: false, isDateData: dates.length > 0 };
  }

  const first = dates[0];
  const last = dates[dates.length - 1];
  const spanDays = Math.round((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
  const spansYears = first.getUTCFullYear() !== last.getUTCFullYear();
  const isMonthly = dates.every((d) => d.getUTCDate() === 1);

  return { spanDays, spansYears, isMonthly, isDateData: true };
}

// Compute the ideal interval for XAxis
export function computeXInterval(dataLength: number): number {
  if (dataLength <= 8) return 0;
  return Math.max(1, Math.floor(dataLength / 8) - 1);
}

// Create a date tick formatter bound to a specific context (no shared state)
export function makeDateTickFormatter(ctx: XAxisContext) {
  return (value: unknown): string => {
    if (typeof value !== "string") return String(value ?? "");
    if (!/^\d{4}-\d{2}/.test(value)) return value;
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return value;
      const day = d.getUTCDate();
      const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
      const year = d.getUTCFullYear();

      // Monthly data OR long daily spans: show just month (+ year if multi-year)
      if (ctx.isMonthly || ctx.spanDays > 90) {
        return ctx.spansYears ? `${month} '${String(year).slice(2)}` : month;
      }

      return ctx.spansYears ? `${month} ${day} '${String(year).slice(2)}` : `${month} ${day}`;
    } catch {
      return value;
    }
  };
}

// For non-date categorical labels: truncate long strings
export function formatCategoryTick(value: unknown, maxLen = 10): string {
  const s = String(value ?? "");
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

// ── Helpers ──

function findHighlightIndex(
  data: Record<string, string | number>[],
  key: string,
  highlight?: string,
  nameKey?: string,
): number {
  if (highlight && nameKey) {
    const idx = data.findIndex(
      (d) => String(d[nameKey]).toLowerCase() === highlight.toLowerCase(),
    );
    if (idx !== -1) return idx;
  }
  let maxIdx = 0;
  let maxVal = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = Number(data[i][key]) || 0;
    if (v > maxVal) {
      maxVal = v;
      maxIdx = i;
    }
  }
  return maxIdx;
}

function normalizeData(raw: Record<string, string | number>[]): Record<string, string | number>[] {
  return raw.map((row) => {
    const fixed: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "number") fixed[k] = v;
      else if (typeof v === "string" && v !== "" && !isNaN(Number(v)) && /^-?\d/.test(v))
        fixed[k] = Number(v);
      else fixed[k] = v;
    }
    return fixed;
  });
}

function fixKeyCase(key: string, keyMap: Map<string, string>): string {
  return keyMap.get(key.toLowerCase()) ?? key;
}

function resolveSeriesColor(index: number, monochrome: boolean): string {
  if (!monochrome) return getSeriesColor(index);
  return index === 0 ? "var(--color-foreground)" : "var(--color-muted-foreground)";
}

function resolveSeriesOpacity(index: number, monochrome: boolean): number {
  if (!monochrome) return 1;
  return index === 0 ? 1 : 0.72;
}

// ── Custom Tooltip ──

function ChartTooltip({
  active,
  payload,
  label,
  formatMap,
  currency,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string; dataKey?: string }[];
  label?: string;
  formatMap: Record<string, "number" | "currency" | "percent">;
  currency?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 shadow-sm antialiased">
      <p className="text-[9.9px] font-medium text-foreground mb-1">{label}</p>
      {payload.map((entry, i) => {
        const key = (entry.dataKey as string) || entry.name;
        return (
          <p key={i} className="text-[9.9px] text-muted-foreground tabular-nums">
            <span
              className="inline-block w-2 h-2 rounded-full mr-1.5"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            {entry.name}: {formatTooltipValue(entry.value, formatMap[key], currency)}
          </p>
        );
      })}
    </div>
  );
}

// ── Props ──

export interface ChartCoreProps {
  spec: ChartSpec;
  height?: number | `${number}%`;
  hiddenSeries?: Set<string>;
  annotations?: ChartAnnotation[];
  onDataPointClick?: (click: {
    column: string;
    value: string;
    measure: number | null;
    measureKey: string | null;
    screenX: number;
    screenY: number;
  }) => void;
}

// ── Main Component ──

export function ChartCore({ spec, height = 280, hiddenSeries, annotations, onDataPointClick }: ChartCoreProps) {
  const { resolvedTheme } = useTheme();
  void resolvedTheme; // used implicitly by CSS vars

  // Normalize + fix keys
  const { data, fixedSpec, formatMap } = useMemo(() => {
    const rawData = (spec.data || []).slice(0, 1000);
    const normalized = normalizeData(rawData);
    const dataKeys = normalized.length > 0 ? Object.keys(normalized[0]) : [];
    const km = new Map(dataKeys.map((k) => [k.toLowerCase(), k]));

    const fs = { ...spec, data: normalized };
    if (fs.xKey) fs.xKey = fixKeyCase(fs.xKey, km);
    if (fs.yKeys) fs.yKeys = fs.yKeys.map((k) => fixKeyCase(k, km));
    if (fs.nameKey) fs.nameKey = fixKeyCase(fs.nameKey, km);
    if (fs.valueKey) fs.valueKey = fixKeyCase(fs.valueKey, km);

    const fm: Record<string, "number" | "currency" | "percent"> = {};
    if (fs.format) {
      for (const [k, v] of Object.entries(fs.format)) {
        fm[fixKeyCase(k, km)] = v;
      }
    }

    return { data: normalized, fixedSpec: fs, formatMap: fm };
  }, [spec]);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height: typeof height === "number" ? height : "100%" }}>
        No data available
      </div>
    );
  }

  const labelMap: Record<string, string> = {};
  if (fixedSpec.yKeys && fixedSpec.yLabels) {
    fixedSpec.yKeys.forEach((k, i) => {
      labelMap[k] = fixedSpec.yLabels![i] ?? k;
    });
  }
  const monochrome = fixedSpec.tone === "monochrome";

  // Merge spec annotations + prop annotations
  const allAnnotations = [
    ...(fixedSpec.annotations ?? []),
    ...(annotations ?? []),
  ];

  // ── Funnel ──
  // Vertical bars on a fixed 0–100% Y axis. Each bar's solid portion is the
  // cumulative conversion %; the hatched cap above it is the lost users for
  // that step. The step with the largest step-to-step drop gets a destructive
  // accent on its hatch (Von Restorff). Monochrome otherwise.
  //
  // Expected data row shape:
  //   { [xKey]: stepLabel, [yKeys[0]]: conversionPct, users?: number, medianTimeSeconds?: number }
  if (spec.type === "funnel") {
    const xK = fixedSpec.xKey ?? "step";
    const yK = fixedSpec.yKeys?.[0] ?? "conversion";

    // Find the step with the largest step-to-step drop (skip step 0)
    let worstIdx = -1;
    let worstDrop = 0;
    for (let i = 1; i < data.length; i++) {
      const drop = (Number(data[i - 1][yK]) || 0) - (Number(data[i][yK]) || 0);
      if (drop > worstDrop) {
        worstDrop = drop;
        worstIdx = i;
      }
    }

    const formatDurationShort = (sec: number): string => {
      if (!sec || isNaN(sec)) return "";
      if (sec < 60) return `${Math.round(sec)}s`;
      if (sec < 3600) return `${Math.round(sec / 60)}m`;
      if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
      return `${(sec / 86400).toFixed(1)}d`;
    };

    const totalHeight = typeof height === "number" ? height : 320;

    return (
      <div
        className="flex flex-col w-full select-none"
        style={{ height: typeof height === "number" ? height : "100%" }}
      >
        {/* Plot area */}
        <div
          className="relative flex items-end gap-3 px-10 pt-10 pb-1"
          style={{ height: totalHeight - 56 }}
        >
          {/* Y axis gridlines (0 / 25 / 50 / 75 / 100) */}
          {[0, 25, 50, 75, 100].map((tick) => (
            <div
              key={tick}
              className="absolute left-8 right-4 border-t border-border/40 pointer-events-none"
              style={{ bottom: `calc(0.25rem + (${100 - tick}%))`, top: "auto" }}
            >
              <span className="absolute -left-9 -translate-y-1/2 text-[9px] text-muted-foreground tabular-nums">
                {tick}%
              </span>
            </div>
          ))}

          {data.map((row, i) => {
            const conversion = Math.max(0, Math.min(100, Number(row[yK]) || 0));
            const lost = 100 - conversion;
            const users = Number(row.users ?? 0);
            const isWorst = i === worstIdx;

            return (
              <div
                key={i}
                className="group flex-1 min-w-0 h-full flex flex-col justify-end relative"
                title={`${String(row[xK] ?? "")}: ${conversion.toFixed(2)}% (${users.toLocaleString()})`}
              >
                {/* Labels above bar: conversion % + absolute users */}
                <div className="absolute inset-x-0 -top-9 flex flex-col items-center pointer-events-none">
                  <span className="text-xs font-semibold tabular-nums text-foreground">
                    {conversion.toFixed(1)}%
                  </span>
                  {users > 0 && (
                    <span className="text-[9px] text-muted-foreground tabular-nums">
                      {users.toLocaleString()}
                    </span>
                  )}
                </div>

                {/* Hatched "lost users" cap */}
                {lost > 0 && (
                  <div
                    className="w-full rounded-t-md overflow-hidden"
                    style={{
                      height: `${lost}%`,
                      backgroundImage: `repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 6px)`,
                      color: isWorst && !monochrome ? "var(--color-destructive)" : "var(--color-muted-foreground)",
                      opacity: isWorst ? 0.55 : 0.3,
                    }}
                  />
                )}

                {/* Solid retained-users bar — top corners only round when there is no hatch above */}
                <div
                  className={`w-full bg-foreground transition-all duration-300 group-hover:bg-foreground/90 ${lost > 0 ? "" : "rounded-t-md"}`}
                  style={{ height: `${conversion}%` }}
                />
              </div>
            );
          })}
        </div>

        {/* X axis labels */}
        <div className="flex gap-3 px-10 mt-2">
          {data.map((row, i) => {
            const median = Number(row.medianTimeSeconds ?? 0);
            return (
              <div key={i} className="flex-1 min-w-0 text-center">
                <div
                  className="text-[9.9px] text-foreground truncate"
                  title={String(row[xK] ?? "")}
                >
                  {String(row[xK] ?? "")}
                </div>
                {median > 0 && (
                  <div className="text-[9px] text-muted-foreground tabular-nums mt-0.5">
                    ~{formatDurationShort(median)} median
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Pie ──
  if (spec.type === "pie") {
    const nk = fixedSpec.nameKey || "name";
    const vk = fixedSpec.valueKey || "value";
    const fmt = formatMap[vk];
    const highlightIdx = findHighlightIndex(data, vk, fixedSpec.highlight, nk);

    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey={vk}
            nameKey={nk}
            cx="50%"
            cy="50%"
            innerRadius="45%"
            outerRadius="75%"
            paddingAngle={2}
            label={false}
            labelLine={false}
            onClick={
              onDataPointClick
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ? (entry: any, _idx: number, e: React.MouseEvent<Element>) => {
                    onDataPointClick({
                      column: nk,
                      value: String(entry[nk] ?? entry.name ?? ""),
                      measure: typeof entry[vk] === "number" ? (entry[vk] as number) : null,
                      measureKey: vk,
                      screenX: e.clientX,
                      screenY: e.clientY,
                    });
                  }
                : undefined
            }
            style={onDataPointClick ? { cursor: "pointer" } : undefined}
          >
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={i === highlightIdx ? resolveSeriesColor(0, monochrome) : resolveSeriesColor(i === 0 ? 1 : i, monochrome)}
                opacity={i === highlightIdx ? 1 : 0.8}
                stroke="var(--color-card)"
                strokeWidth={1}
              />
            ))}
          </Pie>
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any) =>
              value != null ? formatTooltipValue(Number(value), fmt, spec.currency) : ""
            }
            contentStyle={{
              fontSize: 9.9,
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: "var(--color-popover)",
              color: "var(--color-foreground)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
            itemStyle={{ color: "var(--color-foreground)", fontSize: 9.9 }}
            labelStyle={{ color: "var(--color-foreground)", fontWeight: 500 }}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  // ── Scatter ──
  if (spec.type === "scatter") {
    const scatterXKey = fixedSpec.xKey;
    const scatterYKey = fixedSpec.yKeys?.[0];
    const groupKey = fixedSpec.nameKey;
    if (!scatterXKey || !scatterYKey) return null;

    const groups: { name: string; data: Record<string, string | number>[] }[] = [];
    if (groupKey) {
      const seen = new Map<string, Record<string, string | number>[]>();
      for (const row of data) {
        const key = String(row[groupKey] ?? "Other");
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key)!.push(row);
      }
      seen.forEach((rows, name) => groups.push({ name, data: rows }));
    } else {
      groups.push({ name: scatterYKey, data });
    }

    const xFmt = spec.format?.[scatterXKey];
    const yFmt = spec.format?.[scatterYKey];

    const scatterYValues = data.map((d) => Number(d[scatterYKey]) || 0);
    const scatterYMax = Math.max(...scatterYValues);
    const needDecimals = scatterYMax < 1;

    return (
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 16, right: 20, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.3} vertical={false} />
          <XAxis
            dataKey={scatterXKey}
            type="number"
            name={fixedSpec.xAxisLabel ?? scatterXKey}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
            tickFormatter={(v) => Number(v) === 0 ? "" : formatValue(Number(v), xFmt, spec.currency)}
            height={28}
            tickCount={7}
          />
          <YAxis
            dataKey={scatterYKey}
            type="number"
            name={fixedSpec.yAxisLabel ?? scatterYKey}
            tickLine={false}
            axisLine={false}
            width={56}
            tickCount={5}
            allowDecimals={needDecimals}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tick={(props: any) => {
              const { x, y, payload, index, visibleTicksCount } = props as { x: number; y: number; payload: { value: number }; index: number; visibleTicksCount: number };
              if ((index === 0 && visibleTicksCount > 2) || payload.value === 0) return <g />;
              return (
                <text x={x} y={y} dy={3} textAnchor="end" fontSize={9} fill="var(--color-muted-foreground)">
                  {formatValue(payload.value, yFmt, spec.currency)}
                </text>
              );
            }}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any, name?: any) => {
              const key = name === (fixedSpec.xAxisLabel ?? scatterXKey) ? scatterXKey : scatterYKey;
              const f = key === scatterXKey ? xFmt : yFmt;
              return value != null ? formatTooltipValue(Number(value), f, spec.currency) : "";
            }}
            contentStyle={{
              fontSize: 9.9,
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: "var(--color-popover)",
              color: "var(--color-foreground)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
            itemStyle={{ color: "var(--color-foreground)", fontSize: 9.9 }}
            labelStyle={{ color: "var(--color-foreground)", fontWeight: 500 }}
            cursor={false}
          />
          {groups.map(({ name, data: gData }, i) => (
            <Scatter
              key={name}
              name={name}
              data={gData}
              fill={resolveSeriesColor(i, monochrome)}
              opacity={resolveSeriesOpacity(i, monochrome)}
              shape="circle"
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  // ── Bar / Line / Area ──
  const xKey = fixedSpec.xKey || "name";
  const xCtx = buildXAxisContext(data, xKey);
  const yKeys = (fixedSpec.yKeys || ["value"]).filter((k) => !hiddenSeries?.has(k));
  const multiSeries = yKeys.length > 1;
  const gradientId = `uc-grad-${(fixedSpec.title ?? "chart").replace(/[^a-zA-Z0-9]/g, "-")}`;

  const highlightIdx =
    !multiSeries && fixedSpec.type === "bar"
      ? findHighlightIndex(data, yKeys[0], fixedSpec.highlight, xKey)
      : -1;

  const emitDataPointClick = (
    entry: unknown,
    yk: string,
    event?: { clientX?: number; clientY?: number; nativeEvent?: { clientX?: number; clientY?: number } },
  ) => {
    if (!onDataPointClick) return;
    const entryRecord = entry && typeof entry === "object"
      ? entry as { payload?: unknown } & Record<string, unknown>
      : {};
    const row = entryRecord.payload && typeof entryRecord.payload === "object"
      ? entryRecord.payload as Record<string, unknown>
      : entryRecord;
    const mouseEvent = event?.nativeEvent ?? event;
    const cx = mouseEvent?.clientX ?? 300;
    const cy = mouseEvent?.clientY ?? 300;
    const rawMeasure = row[yk];

    onDataPointClick({
      column: xKey,
      value: String(row[xKey] ?? ""),
      measure: typeof rawMeasure === "number" ? rawMeasure : null,
      measureKey: yk,
      screenX: typeof cx === "number" && !isNaN(cx) ? cx : 300,
      screenY: typeof cy === "number" && !isNaN(cy) ? cy : 300,
    });
  };

  // Compute Y context for range-aware formatting
  const allYKeys = fixedSpec.yKeys || ["value"];
  const allValues = data.flatMap((d) => allYKeys.map((k) => Number(d[k]) || 0));

  // Set formatting context — bound to this render, not module-level
  const primaryFmt = formatMap[allYKeys[0]];
  const yAxisFmt = primaryFmt;
  const yAxisSym = spec.currency ?? "$";

  const yMax = Math.max(...allValues);

  // Allow decimals when data values are small (< 1)
  const needDecimals = yMax < 1;

  // Disable dots when there are too many data points
  const tooManyPoints = data.length > 60;

  // Compute X-axis interval (max ~7 ticks)
  const xInterval = computeXInterval(data.length);

  // Determine X tick formatter — bound to this chart's context
  const xTickFormatter = xCtx.isDateData
    ? makeDateTickFormatter(xCtx)
    : (v: unknown) => formatCategoryTick(v);

  const renderSeries = () =>
    yKeys.map((yk, i) => {
      const isAccent = i === 0;
      const seriesColor = resolveSeriesColor(i, monochrome);
      const seriesOpacity = resolveSeriesOpacity(i, monochrome);
      const name = labelMap[yk] || yk;

      if (spec.type === "line") {
        const isForecast = fixedSpec.forecastKeys?.includes(yk) ?? false;
        return (
          <Line
            key={yk}
            type="monotone"
            dataKey={yk}
            name={name}
            stroke={seriesColor}
            strokeWidth={isAccent ? 2 : 1.5}
            strokeDasharray={isForecast ? "4 3" : getSeriesDash(i)}
            dot={tooManyPoints ? false : (!isForecast && isAccent ? { r: 2.5, fill: seriesColor } : false)}
            activeDot={tooManyPoints ? { r: 3 } : (isAccent ? { r: 4, fill: seriesColor } : { r: 3 })}
            opacity={seriesOpacity}
            connectNulls={false}
          />
        );
      }

      if (spec.type === "area") {
        return (
          <Area
            key={yk}
            type="monotone"
            dataKey={yk}
            name={name}
            stroke={seriesColor}
            fill={fixedSpec.stacked ? seriesColor : isAccent ? `url(#${gradientId})` : "transparent"}
            fillOpacity={fixedSpec.stacked ? 0.85 : 1}
            strokeWidth={1.5}
            opacity={seriesOpacity}
            stackId={fixedSpec.stacked ? "stack" : undefined}
          />
        );
      }

      // Bar
      if (!multiSeries) {
        return (
          <Bar
            key={yk}
            dataKey={yk}
            name={name}
            radius={[6, 6, 0, 0]}
            stackId={fixedSpec.stacked ? "stack" : undefined}
            onClick={onDataPointClick ? (entry, _index, event) => emitDataPointClick(entry, yk, event) : undefined}
            style={onDataPointClick ? { cursor: "pointer" } : undefined}
          >
            {data.map((_, j) => (
              <Cell
                key={j}
                fill={j === highlightIdx ? "var(--color-foreground)" : "var(--color-muted-foreground)"}
                opacity={j === highlightIdx ? 0.9 : 0.55}
              />
            ))}
          </Bar>
        );
      }

      return (
        <Bar
          key={yk}
          dataKey={yk}
          name={name}
          fill={seriesColor}
          radius={fixedSpec.stacked ? undefined : [6, 6, 0, 0]}
          opacity={seriesOpacity}
          stackId={fixedSpec.stacked ? "stack" : undefined}
          onClick={onDataPointClick ? (entry, _index, event) => emitDataPointClick(entry, yk, event) : undefined}
          style={onDataPointClick ? { cursor: "pointer" } : undefined}
        />
      );
    });

  const ChartComponent = spec.type === "line" ? LineChart : spec.type === "area" ? AreaChart : BarChart;

  const handleChartClick = onDataPointClick && (spec.type === "line" || spec.type === "area")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (state: any, e?: any) => {
        if (!state?.activePayload?.length) return;
        const entry = state.activePayload[0]?.payload;
        const yk = yKeys[0];
        if (!entry) return;
        const mouseEvent = (e?.nativeEvent ?? e) as MouseEvent | undefined;
        const cx = mouseEvent?.clientX ?? state?.chartX ?? 0;
        const cy = mouseEvent?.clientY ?? state?.chartY ?? 0;
        onDataPointClick({
          column: xKey,
          value: String(entry[xKey] ?? ""),
          measure: typeof entry[yk] === "number" ? (entry[yk] as number) : null,
          measureKey: yk,
          screenX: typeof cx === "number" && !isNaN(cx) ? cx : 300,
          screenY: typeof cy === "number" && !isNaN(cy) ? cy : 300,
        });
      }
    : undefined;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ChartComponent
        data={data}
        margin={{ top: 16, right: 20, bottom: 8, left: 0 }}
        onClick={handleChartClick}
        style={handleChartClick ? { cursor: "pointer" } : undefined}
      >
        {spec.type === "area" && (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={resolveSeriesColor(0, monochrome)} stopOpacity={0.15} />
              <stop offset="100%" stopColor={resolveSeriesColor(0, monochrome)} stopOpacity={0} />
            </linearGradient>
          </defs>
        )}
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          strokeOpacity={0.3}
          vertical={false}
        />
        <XAxis
          dataKey={xKey}
          tickFormatter={xTickFormatter}
          tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
          tickLine={false}
          axisLine={false}
          height={fixedSpec.xAxisLabel ? 36 : 28}
          interval={xInterval}
          padding={{ left: 4, right: 4 }}
          {...(fixedSpec.xAxisLabel && {
            label: {
              value: fixedSpec.xAxisLabel,
              position: "insideBottom",
              offset: -2,
              fontSize: 8.1,
              fill: "var(--color-muted-foreground)",
            },
          })}
        />
        <YAxis
          domain={fixedSpec.type === "bar" ? [0, "auto"] : ["auto", "auto"]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tick={(props: any) => {
            const { x, y, payload, index, visibleTicksCount } = props as {
              x: number;
              y: number;
              payload: { value: number };
              index: number;
              visibleTicksCount: number;
            };
            // Hide bottom tick to avoid overlap with x-axis, and never show bare 0
            if ((index === 0 && visibleTicksCount > 2) || payload.value === 0) return <g />;
            const label = formatValue(payload.value, yAxisFmt, yAxisSym);
            return (
              <text x={x} y={y} dy={3} textAnchor="end" fontSize={9} fill="var(--color-muted-foreground)">
                {label}
              </text>
            );
          }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickCount={5}
          allowDecimals={needDecimals}
          {...(fixedSpec.yAxisLabel && {
            label: {
              value: fixedSpec.yAxisLabel,
              angle: -90,
              position: "insideLeft",
              offset: 12,
              fontSize: 8.1,
              fill: "var(--color-muted-foreground)",
            },
          })}
        />
        <Tooltip
          content={<ChartTooltip formatMap={formatMap} currency={spec.currency} />}
          cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
        />
        {renderSeries()}
        {/* Forecast reference line */}
        {fixedSpec.forecastStartX != null && (
          <ReferenceLine
            x={fixedSpec.forecastStartX}
            stroke="var(--color-muted-foreground)"
            strokeDasharray="4 4"
            strokeOpacity={0.4}
          />
        )}
        {/* User annotations */}
        {allAnnotations.map((ann) => (
          <ReferenceLine
            key={ann.id}
            x={ann.x}
            stroke={ann.color ?? "var(--color-muted-foreground)"}
            strokeDasharray={ann.type === "line" ? "6 3" : "2 2"}
            strokeOpacity={0.6}
            label={{
              value: ann.label,
              position: "insideTopRight",
              fontSize: 8.1,
              fill: "var(--color-muted-foreground)",
              offset: 8,
            }}
          />
        ))}
      </ChartComponent>
    </ResponsiveContainer>
  );
}
