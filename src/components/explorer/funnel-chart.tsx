"use client";

import { useState, useMemo } from "react";
import { Loader2, Code } from "lucide-react";
import type { FunnelResult, FunnelConfig, FunnelSegmentResult, FunnelBreakdownRow, FunnelStepResult } from "@/lib/funnel-types";
import type { DateRangePreset } from "@/lib/explorer-types";
import type { ChartSpec } from "@/lib/chart-types";
import { computeSignificance } from "@/lib/funnel-significance";
import { ChartCore } from "@/components/chart/chart-core";
import { getSeriesColor } from "@/lib/chart-colors";
import { SqlHighlighted } from "@/lib/sql-highlight";

interface FunnelChartProps {
  config: FunnelConfig;
  result: FunnelResult | null;
  loading: boolean;
  error: string | null;
  onDatePresetChange: (preset: DateRangePreset) => void;
}

export function FunnelChart({
  config,
  result,
  loading,
  error,
  onDatePresetChange,
}: FunnelChartProps) {
  const [showSql, setShowSql] = useState(false);
  const hasSteps = config.steps.length >= 2;
  const activePreset = "preset" in config.dateRange ? config.dateRange.preset : null;

  return (
    <div className="flex flex-col gap-4 flex-1 min-w-0">
      {/* Date range presets */}
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
        {result?.sql && !loading && (
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
      {!hasSteps && (
        <div className="min-h-[300px] flex items-center justify-center text-center text-muted-foreground">
          <div>
            <p className="text-sm">Add at least 2 steps to build a funnel</p>
            <p className="text-xs mt-1">Pick events from the panel on the left</p>
          </div>
        </div>
      )}

      {hasSteps && loading && (
        <div className="min-h-[300px] flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Running funnel query...</span>
        </div>
      )}

      {hasSteps && error && !loading && (
        <div className="min-h-[300px] flex items-center justify-center text-center max-w-md px-4 mx-auto">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {hasSteps && !loading && !error && showSql && result?.sql && (
        <div className="min-h-[300px] max-h-[500px] overflow-auto rounded-lg border bg-muted/40 p-4 text-[9.9px] font-mono leading-relaxed">
          <SqlHighlighted sql={result.sql} />
        </div>
      )}

      {hasSteps && result && !loading && !error && !showSql && result.steps.length > 0 && (
        <>
          {result.segmentResults && result.segmentResults.length > 1 ? (
            <SegmentComparisonBars segments={result.segmentResults} />
          ) : result.breakdownRows && result.breakdownRows.length > 0 ? (
            <BreakdownSmallMultiples steps={result.steps} breakdownRows={result.breakdownRows} breakdownProperty={result.config.breakdown ?? "Breakdown"} />
          ) : (
            <>
              <DefaultFunnelChart steps={result.steps} />
              <StepBreakdownTable result={result} />
            </>
          )}
        </>
      )}

      {/* Breakdown / segment-compare specific tables */}
      {result && !loading && !error && !showSql && result.steps.length > 0 && (
        result.segmentResults && result.segmentResults.length > 1 ? (
          <SegmentComparisonTable segments={result.segmentResults} />
        ) : result.breakdownRows && result.breakdownRows.length > 0 ? (
          <BreakdownTable steps={result.steps} breakdownRows={result.breakdownRows} breakdownProperty={result.config.breakdown ?? "Breakdown"} />
        ) : null
      )}

      {result && !loading && (
        <p className="text-[9.9px] text-muted-foreground">
          Query executed in {result.executionTimeMs}ms
        </p>
      )}
    </div>
  );
}

// ── Default funnel chart ──
// Routes through ChartCore with type="funnel" — vertical bars on a fixed
// 0–100% Y axis with hatched lost caps and worst-step accent. The single
// source of visual truth for funnels lives in chart-core.tsx.

function DefaultFunnelChart({ steps }: { steps: FunnelStepResult[] }) {
  const spec: ChartSpec = useMemo(() => ({
    type: "funnel",
    title: "Funnel",
    data: steps.map((s) => ({
      step: s.label,
      conversion: s.conversionRate,
      users: s.userCount,
      medianTimeSeconds: s.medianTimeSeconds ?? 0,
    })),
    xKey: "step",
    yKeys: ["conversion"],
    format: { conversion: "percent" },
  }), [steps]);

  return <ChartCore spec={spec} height={320} />;
}

// ── Step Breakdown Table (Amplitude-style) ──
// Horizontal layout: one row per "segment" (just All Users by default),
// columns alternate Step → Avg Time → Step → Avg Time → ...
// Each step cell shows count + % of step 0; each time cell shows median.

function StepBreakdownTable({ result }: { result: FunnelResult }) {
  const { steps, overallConversionRate, totalEntered, config } = result;
  const unit =
    config.countingMethod === "totals" ? "entries" :
    config.countingMethod === "sessions" ? "sessions" :
    "users";

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Breakdown</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {totalEntered.toLocaleString()} {unit} entered
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="bg-muted/20">
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground sticky left-0 bg-muted/20 border-b border-border min-w-[140px]">
                Segment
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground border-b border-border min-w-[100px]">
                Conversion
              </th>
              {steps.map((step) => (
                <th
                  key={step.stepIndex}
                  className="px-4 py-3 text-right text-xs font-medium text-muted-foreground border-b border-border min-w-[160px]"
                >
                  <span className="truncate inline-block max-w-[200px] align-middle" title={step.label}>
                    {step.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="hover:bg-muted/15 transition-colors">
              <td className="px-4 py-3 font-medium sticky left-0 bg-background text-foreground border-b border-border/40">
                All {unit}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-base font-semibold text-foreground border-b border-border/40">
                {overallConversionRate.toFixed(1)}%
              </td>
              {steps.map((step) => (
                <td
                  key={step.stepIndex}
                  className="px-4 py-3 text-right tabular-nums text-foreground border-b border-border/40"
                >
                  {step.userCount.toLocaleString()}{" "}
                  <span className="text-muted-foreground">
                    ({step.conversionRate.toFixed(1)}%)
                  </span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Segment Comparison ──

const SEGMENT_COLORS = ["#22c55e", "#3E63DD", "#E54D2E", "#8E4EC6", "#F76B15"];

function SegmentComparisonBars({ segments }: { segments: FunnelSegmentResult[] }) {
  // Use the first segment's steps as the reference for step labels
  const stepLabels = segments[0]?.steps.map((s) => s.label) ?? [];
  const maxCount = Math.max(...segments.map((s) => s.steps[0]?.userCount ?? 0), 1);

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        {segments.map((seg, si) => (
          <span key={seg.segmentId} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: SEGMENT_COLORS[si % SEGMENT_COLORS.length] }}
            />
            {seg.segmentName} ({seg.overallConversionRate}%)
          </span>
        ))}
      </div>

      {/* Bars per step */}
      {stepLabels.map((label, stepIdx) => (
        <div key={stepIdx} className="space-y-1">
          <p className="text-xs font-medium">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[9px] font-bold mr-1.5">
              {stepIdx + 1}
            </span>
            {label}
          </p>
          <div className="space-y-1">
            {segments.map((seg, si) => {
              const step = seg.steps[stepIdx];
              if (!step) return null;
              const widthPct = Math.max((step.userCount / maxCount) * 100, 1);
              const color = SEGMENT_COLORS[si % SEGMENT_COLORS.length];
              return (
                <div key={seg.segmentId} className="flex items-center gap-2">
                  <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                    <div
                      className="h-full rounded transition-all duration-500"
                      style={{ width: `${widthPct}%`, backgroundColor: color, opacity: 0.75 }}
                    />
                  </div>
                  <span className="text-[9.9px] text-muted-foreground tabular-nums w-24 text-right">
                    {step.userCount.toLocaleString()} ({step.conversionRate}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Breakdown Overlay Chart ──
// Single grouped-bar chart with all breakdown series on one Y axis. Each step
// becomes a cluster of bars, one per breakdown value. Direct visual comparison
// — taller bar at any step = higher conversion for that segment.

function BreakdownSmallMultiples({
  steps,
  breakdownRows,
  breakdownProperty,
}: {
  steps: FunnelResult["steps"];
  breakdownRows: FunnelBreakdownRow[];
  breakdownProperty: string;
}) {
  // Get unique breakdown values sorted by step 0 count descending
  const step0Map = new Map<string, number>();
  for (const r of breakdownRows) {
    if (r.stepIndex === 0) step0Map.set(r.breakdown, r.userCount);
  }
  const values = [...step0Map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([v]) => v);

  // Lookup: "stepIndex-breakdown" -> userCount
  const lookup = new Map<string, number>();
  for (const r of breakdownRows) {
    lookup.set(`${r.stepIndex}-${r.breakdown}`, r.userCount);
  }

  // Build single grouped-bar spec where each breakdown value is its own yKey.
  // Row shape: { step: "Step 1", "standard": 100, "premium": 100, ... }
  const spec: ChartSpec = useMemo(() => {
    const data = steps.map((step, i) => {
      const row: Record<string, string | number> = { step: step.label };
      for (const v of values) {
        const count = lookup.get(`${i}-${v}`) ?? 0;
        const step0Count = lookup.get(`0-${v}`) ?? 0;
        row[v] = step0Count > 0 ? Math.round((count / step0Count) * 1000) / 10 : 0;
      }
      return row;
    });
    const format: Record<string, "percent"> = {};
    for (const v of values) format[v] = "percent";
    return {
      type: "grouped-bar",
      title: `Funnel by ${breakdownProperty}`,
      data,
      xKey: "step",
      yKeys: values,
      yLabels: values,
      yAxisLabel: "Conversion %",
      format,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, values, breakdownProperty]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-medium text-foreground">Breakdown by</span>
        <span className="text-muted-foreground">{breakdownProperty}</span>
        <span className="text-muted-foreground/60 ml-auto">
          showing top {values.length} {values.length === 1 ? "value" : "values"} by entry size
        </span>
      </div>
      <ChartCore spec={spec} height={340} />
    </div>
  );
}

// ── Significance indicator for breakdown cells ──

function SignificanceIndicator({
  valueConversion,
  valueSampleSize,
  overallConversion,
  overallSampleSize,
}: {
  valueConversion: number;
  valueSampleSize: number;
  overallConversion: number;
  overallSampleSize: number;
}) {
  const sig = computeSignificance(
    valueConversion / 100,
    valueSampleSize,
    overallConversion / 100,
    overallSampleSize,
  );

  if (sig.insufficientData) {
    return (
      <span className="text-muted-foreground ml-0.5 text-[9px]" title={`Insufficient data (n=${valueSampleSize})`}>
        ~
      </span>
    );
  }

  if (!sig.isSignificant) return null;

  const isAbove = valueConversion > overallConversion;
  const confPct = (sig.confidence * 100).toFixed(1);
  const pStr = sig.pValue < 0.001 ? "<0.001" : sig.pValue.toFixed(3);
  const title = `${valueConversion}% (p=${pStr}, ${confPct}% confidence)`;

  return (
    <span className="text-foreground ml-0.5 text-[9px]" title={title}>
      {isAbove ? "↑" : "↓"}
    </span>
  );
}

// ── Breakdown Table (rows = breakdown values, columns = steps) ──

function BreakdownTable({
  steps,
  breakdownRows,
  breakdownProperty,
}: {
  steps: FunnelStepResult[];
  breakdownRows: FunnelBreakdownRow[];
  breakdownProperty: string;
}) {
  // Get unique breakdown values sorted by step 0 count descending
  const step0Map = new Map<string, number>();
  for (const r of breakdownRows) {
    if (r.stepIndex === 0) step0Map.set(r.breakdown, r.userCount);
  }
  const values = [...step0Map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([v]) => v);

  // Index for fast lookup
  const lookup = new Map<string, FunnelBreakdownRow>();
  for (const r of breakdownRows) {
    lookup.set(`${r.stepIndex}-${r.breakdown}`, r);
  }

  // Overall funnel conversion rate (last step)
  const overallFunnelConversion = steps[steps.length - 1]?.conversionRate ?? 0;
  const overallFunnelSampleSize = steps[0]?.userCount ?? 0;

  return (
    <div className="border rounded-md overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">{breakdownProperty}</th>
            {steps.map((step, i) => (
              <th key={i} className="px-3 py-2 text-right font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-muted text-[8.1px] font-bold"
                  >
                    {i + 1}
                  </span>
                  {step.label}
                </span>
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Conversion</th>
          </tr>
        </thead>
        <tbody>
          {values.map((v, vi) => {
            const step0Row = lookup.get(`0-${v}`);
            const step0Count = step0Row?.userCount ?? 0;
            const lastStep = lookup.get(`${steps.length - 1}-${v}`);
            const overallConversion = lastStep?.conversionRate ?? 0;
            return (
              <tr key={v} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: getSeriesColor(vi) }}
                      aria-hidden="true"
                    />
                    {v}
                  </span>
                </td>
                {steps.map((step, stepIdx) => {
                  const row = lookup.get(`${stepIdx}-${v}`);
                  if (!row) {
                    return (
                      <td key={stepIdx} className="px-3 py-2 text-right tabular-nums">
                        0
                      </td>
                    );
                  }
                  return (
                    <td key={stepIdx} className="px-3 py-2 text-right tabular-nums">
                      {row.userCount.toLocaleString()} ({row.conversionRate}%)
                      <SignificanceIndicator
                        valueConversion={row.conversionRate}
                        valueSampleSize={step0Count}
                        overallConversion={step.conversionRate}
                        overallSampleSize={overallFunnelSampleSize}
                      />
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {overallConversion}%
                  <SignificanceIndicator
                    valueConversion={overallConversion}
                    valueSampleSize={step0Count}
                    overallConversion={overallFunnelConversion}
                    overallSampleSize={overallFunnelSampleSize}
                  />
                </td>
              </tr>
            );
          })}
          {/* Totals row */}
          <tr className="border-t bg-muted/30 font-medium">
            <td className="px-3 py-2">All</td>
            {steps.map((step) => (
              <td key={step.stepIndex} className="px-3 py-2 text-right tabular-nums">
                {step.userCount.toLocaleString()} ({step.conversionRate}%)
              </td>
            ))}
            <td className="px-3 py-2 text-right tabular-nums">
              {overallFunnelConversion}%
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SegmentComparisonTable({ segments }: { segments: FunnelSegmentResult[] }) {
  const stepLabels = segments[0]?.steps.map((s) => s.label) ?? [];

  return (
    <div className="border rounded-md overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Step</th>
            {segments.map((seg, si) => (
              <th key={seg.segmentId} className="px-3 py-2 text-right font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: SEGMENT_COLORS[si % SEGMENT_COLORS.length] }}
                  />
                  {seg.segmentName}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stepLabels.map((label, stepIdx) => (
            <tr key={stepIdx} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
              <td className="px-3 py-2 font-medium">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[9px] font-bold mr-1.5">
                  {stepIdx + 1}
                </span>
                {label}
              </td>
              {segments.map((seg) => {
                const step = seg.steps[stepIdx];
                return (
                  <td key={seg.segmentId} className="px-3 py-2 text-right tabular-nums">
                    {step ? `${step.userCount.toLocaleString()} (${step.conversionRate}%)` : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
          {/* Overall conversion row */}
          <tr className="border-t bg-muted/30 font-medium">
            <td className="px-3 py-2">Overall Conversion</td>
            {segments.map((seg) => (
              <td key={seg.segmentId} className="px-3 py-2 text-right tabular-nums">
                {seg.overallConversionRate}%
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
