"use client";

import { useState, useMemo } from "react";
import { Loader2, Code } from "lucide-react";
import { UnifiedChart } from "@/components/chart/unified-chart";
import { ChartCore } from "@/components/chart/chart-core";
import { getSeriesColor } from "@/lib/chart-colors";
import { SqlHighlighted } from "@/lib/sql-highlight";
import type { RetentionResult, RetentionConfig, RetentionBreakdownSeries } from "@/lib/retention-types";
import type { DateRangePreset } from "@/lib/explorer-types";
import type { ChartSpec } from "@/lib/chart-types";

interface RetentionChartProps {
  config: RetentionConfig;
  result: RetentionResult | null;
  loading: boolean;
  error: string | null;
  onDatePresetChange: (preset: DateRangePreset) => void;
}

export function RetentionChart({
  config,
  result,
  loading,
  error,
  onDatePresetChange,
}: RetentionChartProps) {
  const hasEvents = !!config.startEventId && config.returnEventIds.length > 0;
  const activePreset = "preset" in config.dateRange ? config.dateRange.preset : null;
  const [showSql, setShowSql] = useState(false);

  // Build retention curve chart spec from overall retention
  const chartSpec: ChartSpec | null = result && Object.keys(result.overall).length > 0
    ? {
        type: "line",
        title: "Overall Retention",
        data: result.dayBuckets
          .filter((b) => b in result.overall)
          .map((b) => ({ day: `D${b}`, retention: result.overall[b] })),
        xKey: "day",
        yKeys: ["retention"],
        yLabels: ["Retention %"],
        yAxisLabel: "Retention %",
      }
    : null;

  return (
    <div className="flex flex-col gap-4 flex-1 min-w-0">
      {/* Toolbar: date presets + SQL toggle */}
      <div className="flex items-center gap-3 text-sm">
        <div className="flex items-center rounded-md border overflow-hidden">
          {(["7d", "30d", "60d", "90d", "1y"] as DateRangePreset[]).map((dp) => (
            <button
              key={dp}
              onClick={() => onDatePresetChange(dp)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                activePreset === dp
                  ? "bg-foreground text-background"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              {dp}
            </button>
          ))}
        </div>
        {result?.sql && (
          <button
            onClick={() => setShowSql((v) => !v)}
            aria-pressed={showSql}
            className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
              showSql
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-muted text-foreground hover:bg-muted/70 ring-1 ring-border"
            }`}
          >
            <Code className="h-3.5 w-3.5" />
            {showSql ? "Hide SQL" : "View SQL"}
          </button>
        )}
      </div>

      {/* Chart / SQL pane — no outer container; let the chart breathe */}
      {!hasEvents && (
        <div className="min-h-[300px] flex items-center justify-center text-center text-muted-foreground">
          <div>
            <p className="text-sm">Select a starting event and return event</p>
            <p className="text-xs mt-1">Configure events in the panel on the left</p>
          </div>
        </div>
      )}

      {hasEvents && loading && (
        <div className="min-h-[300px] flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Computing retention...</span>
        </div>
      )}

      {hasEvents && error && !loading && (
        <div className="min-h-[300px] flex items-center justify-center text-center max-w-md px-4 mx-auto">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {hasEvents && !loading && !error && showSql && result?.sql && (
        <div className="min-h-[300px] max-h-[500px] overflow-auto rounded-lg border bg-muted/40 p-4 text-[9.9px] font-mono leading-relaxed">
          <SqlHighlighted sql={result.sql} />
        </div>
      )}

      {hasEvents && chartSpec && !loading && !error && !showSql && !result?.breakdownSeries?.length && (
        <UnifiedChart spec={chartSpec} variant="normal" />
      )}

      {/* Breakdown small multiples — replaces the line chart when a breakdown is set */}
      {hasEvents && !loading && !error && !showSql && result?.breakdownSeries && result.breakdownSeries.length > 0 && (
        <RetentionBreakdownSmallMultiples
          series={result.breakdownSeries}
          dayBuckets={result.dayBuckets}
          breakdownProperty={config.breakdown ?? "Breakdown"}
        />
      )}

      {/* Cohort triangle table — only for the unbroken view */}
      {result && !loading && !error && result.cohorts.length > 0 && !result.breakdownSeries?.length && (
        <CohortTriangle result={result} />
      )}

      {result && !loading && (
        <p className="text-[9.9px] text-muted-foreground">
          Query executed in {result.executionTimeMs}ms
        </p>
      )}
    </div>
  );
}

// ── Cohort Triangle Table ──

function CohortTriangle({ result }: { result: RetentionResult }) {
  const { cohorts, dayBuckets, overall } = result;
  const [hoverCol, setHoverCol] = useState<number | null>(null);

  // Monochrome heatmap: foreground at varying opacity scaled to retention.
  // 0% → transparent, 100% → ~30% foreground. Reserves saturated colors for
  // accents elsewhere in the app and matches the project's monochrome rule.
  function cellBg(pct: number): string {
    const opacity = Math.max(0, Math.min(0.32, (pct / 100) * 0.32));
    return `color-mix(in srgb, var(--color-foreground) ${opacity * 100}%, transparent)`;
  }

  function formatDate(d: string): string {
    try {
      return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return d;
    }
  }

  // Aggregate row: weighted average across cohorts. The retention `overall`
  // map is already weighted, so we use it directly. Total users = sum of
  // cohort sizes. Per-bucket retained user count = round(pct * total / 100)
  // — this is what the user wants to see alongside the percentage.
  const totalUsers = cohorts.reduce((s, c) => s + c.cohortSize, 0);

  // Hover crosshair: highlight whichever column the cursor is in.
  // Column 0 = Cohort label, 1 = Users, 2..N = D{bucket} columns.
  function colHighlightClass(idx: number): string {
    return hoverCol === idx ? "bg-muted/30" : "";
  }

  return (
    <div className="border rounded-md overflow-hidden" onMouseLeave={() => setHoverCol(null)}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr className="bg-muted/40">
              <th
                className="px-3 py-2 text-left font-medium text-muted-foreground sticky left-0 bg-muted/40 min-w-[100px] border-b border-border"
                onMouseEnter={() => setHoverCol(0)}
              >
                Cohort
              </th>
              <th
                className={`px-3 py-2 text-right font-medium text-muted-foreground min-w-[64px] border-b border-border ${colHighlightClass(1)}`}
                onMouseEnter={() => setHoverCol(1)}
              >
                Users
              </th>
              {dayBuckets.map((b, i) => (
                <th
                  key={b}
                  className={`px-3 py-2 text-right font-medium text-muted-foreground min-w-[72px] border-b border-border ${colHighlightClass(i + 2)}`}
                  onMouseEnter={() => setHoverCol(i + 2)}
                >
                  D{b}
                </th>
              ))}
            </tr>

            {/* All-cohorts aggregate row — pinned at the top as the benchmark */}
            <tr className="bg-muted/20 font-semibold">
              <td
                className="px-3 py-2 sticky left-0 bg-muted/20 border-b border-border text-foreground"
                onMouseEnter={() => setHoverCol(0)}
              >
                All cohorts
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums text-foreground border-b border-border ${colHighlightClass(1)}`}
                onMouseEnter={() => setHoverCol(1)}
              >
                {totalUsers.toLocaleString()}
              </td>
              {dayBuckets.map((b, i) => {
                const pct = overall[b];
                const retained = pct != null ? Math.round((pct * totalUsers) / 100) : null;
                return (
                  <td
                    key={b}
                    className={`px-3 py-2 text-right tabular-nums border-b border-border ${colHighlightClass(i + 2)}`}
                    style={{ backgroundColor: pct != null ? cellBg(pct) : undefined }}
                    onMouseEnter={() => setHoverCol(i + 2)}
                  >
                    {pct != null ? (
                      <div className="flex flex-col items-end leading-tight">
                        <span>{pct}%</span>
                        {retained != null && (
                          <span className="text-[9px] text-muted-foreground">{retained.toLocaleString()}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {cohorts.map((c) => (
              <tr key={c.cohortDate} className="group hover:bg-muted/10 transition-colors">
                <td
                  className="px-3 py-2 font-medium sticky left-0 bg-background group-hover:bg-muted/20 border-b border-border/40"
                  onMouseEnter={() => setHoverCol(0)}
                >
                  {formatDate(c.cohortDate)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums text-muted-foreground border-b border-border/40 ${colHighlightClass(1)}`}
                  onMouseEnter={() => setHoverCol(1)}
                >
                  {c.cohortSize.toLocaleString()}
                </td>
                {dayBuckets.map((b, i) => {
                  const retained = c.retainedByBucket[b];
                  if (retained == null) {
                    return (
                      <td
                        key={b}
                        className={`px-3 py-2 text-right text-muted-foreground/30 border-b border-border/40 ${colHighlightClass(i + 2)}`}
                        onMouseEnter={() => setHoverCol(i + 2)}
                      >
                        —
                      </td>
                    );
                  }
                  const pct = c.cohortSize > 0 ? Math.round((retained / c.cohortSize) * 10000) / 100 : 0;
                  return (
                    <td
                      key={b}
                      className={`px-3 py-2 text-right tabular-nums border-b border-border/40 ${colHighlightClass(i + 2)}`}
                      style={{ backgroundColor: cellBg(pct) }}
                      onMouseEnter={() => setHoverCol(i + 2)}
                    >
                      <div className="flex flex-col items-end leading-tight">
                        <span>{pct}%</span>
                        <span className="text-[9px] text-muted-foreground">{retained.toLocaleString()}</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Retention Breakdown Overlay Chart ──
// Single line chart with one series per breakdown value, all on the same
// 0–100% Y axis. Direct visual comparison — taller line = better retention.
// Top 8 values by total cohort size.

function RetentionBreakdownSmallMultiples({
  series,
  dayBuckets,
  breakdownProperty,
}: {
  series: RetentionBreakdownSeries[];
  dayBuckets: number[];
  breakdownProperty: string;
}) {
  const top = series.slice(0, 8);

  // Build a single chart spec where each breakdown value is its own yKey.
  // Row shape: { day: "D0", "standard": 100, "premium": 100, ... }
  const spec: ChartSpec = useMemo(() => {
    const yKeys = top.map((s) => s.value);
    const data = dayBuckets.map((b) => {
      const row: Record<string, string | number> = { day: `D${b}` };
      for (const s of top) {
        row[s.value] = s.overall[b] ?? 0;
      }
      return row;
    });
    const format: Record<string, "percent"> = {};
    for (const k of yKeys) format[k] = "percent";
    return {
      type: "line",
      title: `Retention by ${breakdownProperty}`,
      data,
      xKey: "day",
      yKeys,
      yLabels: yKeys,
      yAxisLabel: "Retention %",
      format,
    };
  }, [top, dayBuckets, breakdownProperty]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-medium text-foreground">Breakdown by</span>
        <span className="text-muted-foreground">{breakdownProperty}</span>
        <span className="text-muted-foreground/60 ml-auto">
          showing top {top.length} {top.length === 1 ? "value" : "values"} by cohort size
        </span>
      </div>
      <ChartCore spec={spec} height={340} />

      {/* Compact summary table — D7 / cohort size per series */}
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">{breakdownProperty}</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Cohort size</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">D1</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">D7</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">D30</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">D90</th>
            </tr>
          </thead>
          <tbody>
            {top.map((s, i) => (
              <tr key={s.value} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2 font-medium text-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: getSeriesColor(i) }}
                      aria-hidden="true"
                    />
                    {s.value}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {s.totalCohortSize.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.overall[1] != null ? `${s.overall[1]}%` : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.overall[7] != null ? `${s.overall[7]}%` : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.overall[30] != null ? `${s.overall[30]}%` : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.overall[90] != null ? `${s.overall[90]}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
