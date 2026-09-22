"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import type { ChartSpec, ChartAnnotation } from "@/lib/chart-types";
import { ChartCore } from "./chart-core";
import { ChartShell } from "./chart-shell";
import { ChartLegend } from "./chart-legend";
import { ChartDrawer } from "./chart-drawer";
import { ChartAnnotationsEditor } from "./chart-annotations";
import { GrainPicker, ChartTypeSwitcher, StackedToggle } from "./chart-controls";
import { Download } from "lucide-react";
import { downloadCSV } from "@/lib/csv-export";
import { ChartDateRangePicker } from "./chart-date-range-picker";
import { DataActionsTabs, DataActionsDropdown, type DataView } from "./chart-data-actions";
import { ExpandedModal } from "./expanded-modal";

// ── Props ──

export interface UnifiedChartProps {
  spec: ChartSpec;
  variant?: "compact" | "normal" | "expanded";

  // Full result set for table view (spec.data may be sliced for chart rendering)
  fullData?: Record<string, unknown>[];

  // Control callbacks — when absent, the corresponding control is hidden
  onGrainChange?: (grain: "daily" | "weekly" | "monthly") => void;
  onTimeRangeChange?: (range: { start: string; end: string } | string) => void;
  onTypeChange?: (type: ChartSpec["type"], stacked?: boolean) => void;

  // Mutation callbacks
  onTitleChange?: (title: string) => void;
  onAnnotationAdd?: (annotation: ChartAnnotation) => void;
  onAnnotationRemove?: (id: string) => void;
  onUpdateSpec?: (updates: Partial<ChartSpec>) => void;

  // Canvas integration (three-zone pointer events)
  canvasMode?: boolean;
  isSelected?: boolean;
  isEditing?: boolean;

  // Display
  height?: number;
  className?: string;

  // Data point interaction
  onDataPointClick?: (click: {
    column: string;
    value: string;
    measure: number | null;
    measureKey: string | null;
    screenX: number;
    screenY: number;
  }) => void;
}

export function UnifiedChart({
  spec,
  variant = "normal",
  fullData,
  onGrainChange,
  onTimeRangeChange,
  onTypeChange,
  onTitleChange,
  onAnnotationAdd,
  onAnnotationRemove,
  onUpdateSpec,
  canvasMode,
  isSelected,
  isEditing,
  height,
  className,
  onDataPointClick,
}: UnifiedChartProps) {
  // ── Local state ──
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [dataView, setDataView] = useState<DataView>("chart");
  const [localType, setLocalType] = useState<ChartSpec["type"]>(spec.type);
  const [localStacked, setLocalStacked] = useState(spec.stacked ?? false);
  const [localAnnotations, setLocalAnnotations] = useState<ChartAnnotation[]>(spec.annotations ?? []);
  const [localDateRange, setLocalDateRange] = useState<{ start: string; end: string } | undefined>(spec.dateRange);
  const [activeGrain, setActiveGrain] = useState<"daily" | "weekly" | "monthly">(spec.grain ?? "daily");

  // Sync grain and dateRange from spec when parent updates after requery
  useEffect(() => {
    if (spec.grain) setActiveGrain(spec.grain);
  }, [spec.grain]);

  useEffect(() => {
    setLocalDateRange(spec.dateRange);
  }, [spec.dateRange]);

  // No date constraints on calendar — users should be able to pick any range.
  // The query will simply return empty data if the range has no results.
  // Previously spec.dateRange was used as bounds, which locked users to the
  // already-selected range after the first date change.

  // Build effective spec with local overrides
  const effectiveSpec = useMemo((): ChartSpec => ({
    ...spec,
    type: localType,
    stacked: localStacked,
    annotations: localAnnotations,
  }), [spec, localType, localStacked, localAnnotations]);

  // ── Handlers ──
  const handleToggleSeries = useCallback((key: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleTypeChange = useCallback((type: ChartSpec["type"]) => {
    setLocalType(type);
    onTypeChange?.(type, localStacked);
    onUpdateSpec?.({ type });
  }, [localStacked, onTypeChange, onUpdateSpec]);

  const handleStackedChange = useCallback((stacked: boolean) => {
    setLocalStacked(stacked);
    onTypeChange?.(localType, stacked);
    onUpdateSpec?.({ stacked });
  }, [localType, onTypeChange, onUpdateSpec]);

  const handleTimeChange = useCallback((range: { start: string; end: string } | string) => {
    if (typeof range === "object") setLocalDateRange(range);
    else setLocalDateRange(undefined);
    onTimeRangeChange?.(range);
  }, [onTimeRangeChange]);

  const handleGrainChange = useCallback((grain: "daily" | "weekly" | "monthly") => {
    setActiveGrain(grain);
    onGrainChange?.(grain);
  }, [onGrainChange]);

  const handleAnnotationAdd = useCallback((ann: ChartAnnotation) => {
    setLocalAnnotations((prev) => [...prev, ann]);
    onAnnotationAdd?.(ann);
  }, [onAnnotationAdd]);

  const handleAnnotationRemove = useCallback((id: string) => {
    setLocalAnnotations((prev) => prev.filter((a) => a.id !== id));
    onAnnotationRemove?.(id);
  }, [onAnnotationRemove]);

  // ── Series info for legend ──
  const seriesInfo = useMemo(() => {
    if (spec.type === "pie") {
      // Pie: build from unique nameKey values in data
      const nk = spec.nameKey || "name";
      const seen = new Set<string>();
      return spec.data
        .map((row) => String(row[nk] ?? ""))
        .filter((name) => { if (seen.has(name)) return false; seen.add(name); return true; })
        .map((name) => ({ key: name, label: name }));
    }
    if (spec.type === "scatter" && spec.nameKey) {
      // Scatter: build from unique groupKey values
      const seen = new Set<string>();
      return spec.data
        .map((row) => String(row[spec.nameKey!] ?? ""))
        .filter((name) => { if (seen.has(name)) return false; seen.add(name); return true; })
        .map((name) => ({ key: name, label: name }));
    }
    const yKeys = spec.yKeys || ["value"];
    const yLabels = spec.yLabels;
    return yKeys.map((k, i) => ({
      key: k,
      label: yLabels?.[i] ?? k,
    }));
  }, [spec.type, spec.yKeys, spec.yLabels, spec.nameKey, spec.data]);

  // Determine data shapes for type switcher
  const hasPieData = !!(spec.nameKey || spec.valueKey);
  const hasScatterData = (spec.yKeys?.length ?? 0) >= 1 && !!spec.xKey;
  const canStack = localType === "bar" || localType === "area";

  // Axis break: show ╱╱ when Y-axis doesn't start at 0
  const showAxisBreak = useMemo(() => {
    if (localType === "bar" || localType === "pie") return false;
    const numericKeys = spec.yKeys || (spec.valueKey ? [spec.valueKey] : ["value"]);
    const vals = spec.data.flatMap((d) => numericKeys.map((k) => Number(d[k]) || 0)).filter((v) => v > 0);
    if (vals.length < 2) return false;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return max > 0 && min > 0 && (min / max) > 0.6;
  }, [spec.data, spec.yKeys, spec.valueKey, localType]);

  // ── Compute chart height ──
  // Adaptive based on data shape. Canvas gets taller default (fills card).
  const chartHeight = useMemo(() => {
    if (height) return height;

    const dataLen = spec.data.length;
    const type = localType;

    // Canvas cards: card is ~476px. Subtract title(~36) + controls(~32) + legend(~28) + padding
    if (canvasMode) return 280;

    const base = variant === "compact" ? 200 : 280;

    // Pie: doesn't need much height
    if (type === "pie") return variant === "compact" ? 180 : 240;

    // Bar with few categories: scale down
    if (type === "bar" && dataLen <= 3) return Math.min(base, 180);
    if (type === "bar" && dataLen <= 6) return Math.min(base, 220);

    // Time-series with many points: can use more height
    if ((type === "line" || type === "area") && dataLen > 30) {
      return variant === "compact" ? 220 : 300;
    }

    return base;
  }, [height, spec.data.length, localType, variant, canvasMode]);

  // ── Canvas pointer event wrapper ──
  const wrapPointerEvents = canvasMode
    ? {
        pointerEvents: (isSelected || isEditing ? "auto" : "none") as React.CSSProperties["pointerEvents"],
      }
    : {};

  // ── Controls row (shown in normal + expanded) ──
  // Grouped by concern: [time controls] · [visualization controls]
  // Separator dot between groups for visual parsing
  const hasTimeControls = !!onTimeRangeChange || !!onGrainChange;

  const controlsRow = (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Time controls group */}
      {hasTimeControls && (
        <div className="flex items-center gap-1.5">
          {onTimeRangeChange && (
            <ChartDateRangePicker
              value={localDateRange}
              onChange={handleTimeChange}
            />
          )}
          {onGrainChange && (
            <GrainPicker active={activeGrain} onChange={handleGrainChange} />
          )}
        </div>
      )}

      {/* Separator */}
      {hasTimeControls && (
        <div className="w-px h-4 bg-border shrink-0" aria-hidden="true" />
      )}

      {/* Visualization controls group */}
      <div className="flex items-center gap-1.5">
        <ChartTypeSwitcher
          active={localType}
          onChange={handleTypeChange}
          hasPieData={hasPieData}
          hasScatterData={hasScatterData}
        />
        {canStack && seriesInfo.length > 1 && (
          <StackedToggle active={localStacked} onChange={handleStackedChange} />
        )}
      </div>
    </div>
  );

  // ── Data view handling ──
  const showingData = dataView !== "chart";
  const hasSql = !!effectiveSpec.sql;

  const handleDataViewChange = useCallback((view: DataView) => {
    setDataView(view);
  }, []);

  // ── Top-right actions (data tabs or dropdown) ──
  // Using dropdown style — consistent with chart type switcher
  const dataActions = (v: "compact" | "normal" | "expanded") => {
    if (v === "compact") return null;
    return (
      <DataActionsDropdown
        active={dataView}
        onChange={handleDataViewChange}
        hasSql={hasSql}
      />
    );
  };

  // Alternative: tab buttons (uncomment to try)
  // const dataActions = (v: "compact" | "normal" | "expanded") => {
  //   if (v === "compact") return null;
  //   return (
  //     <DataActionsTabs
  //       active={dataView}
  //       onChange={handleDataViewChange}
  //       hasSql={hasSql}
  //     />
  //   );
  // };

  // ── Render chart content (shared between inline and modal) ──
  const renderChart = (v: "compact" | "normal" | "expanded", h: number) => (
    <ChartShell
      title={effectiveSpec.title}
      onTitleChange={onTitleChange}
      variant={v}
      controls={v !== "compact" && !showingData ? controlsRow : undefined}
      actions={dataActions(v)}
    >
      <div className="flex flex-col h-full relative">
        {/* Chart + legend layer */}
        <div
          className="flex flex-col h-full transition-opacity duration-150 ease-out motion-reduce:transition-none"
          style={{
            opacity: showingData && v !== "expanded" ? 0 : 1,
            pointerEvents: showingData && v !== "expanded" ? "none" : "auto",
          }}
        >
          <div className={`relative ${v === "expanded" ? "flex-1 min-h-0" : ""}`} style={v !== "expanded" ? { height: h } : undefined}>
            <ChartCore
              spec={effectiveSpec}
              height={v === "expanded" ? "100%" as `${number}%` : h}
              hiddenSeries={hiddenSeries}
              onDataPointClick={onDataPointClick}
            />
            {/* Axis break mark — positioned at bottom-left of chart area */}
            {showAxisBreak && (
              <div
                className="absolute pointer-events-none"
                style={{ left: 52, bottom: 28 }}
                aria-hidden="true"
              >
                <svg width="10" height="14" viewBox="0 0 10 14">
                  <line x1="1" y1="7" x2="9" y2="1" stroke="var(--color-muted-foreground)" strokeWidth="1.5" strokeOpacity="0.5" strokeLinecap="round" />
                  <line x1="1" y1="13" x2="9" y2="7" stroke="var(--color-muted-foreground)" strokeWidth="1.5" strokeOpacity="0.5" strokeLinecap="round" />
                </svg>
              </div>
            )}
          </div>
          <div className="px-5 py-3 shrink-0">
            <ChartLegend
              series={seriesInfo}
              hiddenSeries={hiddenSeries}
              onToggle={handleToggleSeries}
            />
          </div>
        </div>

        {/* Data overlay — replaces chart in-place, card height unchanged */}
        {showingData && v !== "expanded" && (
          <div className="absolute inset-0 bg-card flex flex-col animate-in fade-in-0 duration-150">
            {dataView === "export" ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <p className="text-xs text-muted-foreground tabular-nums">
                  Download chart data as CSV ({(fullData ?? effectiveSpec.data).length} rows)
                </p>
                <button
                  type="button"
                  className="flex items-center gap-2 px-4 py-2 min-h-[36px] text-xs font-medium bg-foreground text-background rounded-md transition-opacity duration-150 ease-out motion-reduce:transition-none cursor-pointer active:scale-[0.97] hover:opacity-90"
                  onClick={() => {
                    const rows = fullData ?? effectiveSpec.data;
                    const filename = `${(effectiveSpec.title || "chart").replace(/[^a-zA-Z0-9]/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
                    downloadCSV(rows, filename);
                  }}
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  Download CSV
                </button>
              </div>
            ) : (
              <ChartDrawer
                key={dataView}
                spec={effectiveSpec}
                fullData={fullData}
                pageSize={20}
                height="100%"
                initialTab={dataView === "sql" ? "sql" : "data"}
                hideTabBar
              />
            )}
          </div>
        )}

        {/* Expanded: drawer + annotations always below chart */}
        {v === "expanded" && (
          <>
            <ChartDrawer
              spec={effectiveSpec}
              fullData={fullData}
              pageSize={50}
            />
            <div className="px-4 py-2 border-t border-border shrink-0">
              <ChartAnnotationsEditor
                annotations={localAnnotations}
                onAdd={handleAnnotationAdd}
                onRemove={handleAnnotationRemove}
                readOnly={false}
              />
            </div>
          </>
        )}
      </div>
    </ChartShell>
  );

  return (
    <>
      <div
        className={`overflow-hidden antialiased ${canvasMode ? "" : "bg-card border border-border/50 rounded-md"} ${className ?? ""}`}
        style={wrapPointerEvents}
      >
        {renderChart(variant, chartHeight)}
      </div>

      {/* Expanded modal */}
      <ExpandedModal
        open={expandedOpen}
        onOpenChange={setExpandedOpen}
        title={effectiveSpec.title}
      >
        {renderChart("expanded", 400)}
      </ExpandedModal>
    </>
  );
}
