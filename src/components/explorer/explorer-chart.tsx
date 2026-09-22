"use client";

import { useState, useMemo, useCallback } from "react";
import { UnifiedChart } from "@/components/chart/unified-chart";
import { BreakdownTable } from "./breakdown-table";
import { BoardPickerPopover } from "@/components/canvas/board-picker-popover";
import type { ExplorerConfig, ExplorerResult } from "@/lib/explorer-types";
import { autoGranularity } from "@/lib/explorer-types";
import type { ChartSpec } from "@/lib/chart-types";
import { Loader2, PinIcon, Check } from "lucide-react";
import { saveBoardCard, getBoardSections } from "@/lib/board-store";
import { useDataset } from "@/lib/dataset-context";
import { invalidateCatalog } from "@/lib/catalog-invalidation";
import type { BoardCard } from "@/lib/board-types";

interface ExplorerChartProps {
  config: ExplorerConfig;
  result: ExplorerResult | null;
  loading: boolean;
  error: string | null;
  onChartTypeChange: (type: ExplorerConfig["chartType"]) => void;
  onGranularityChange: (g: ExplorerConfig["granularity"]) => void;
  onDatePresetChange: (preset: "7d" | "30d" | "60d" | "90d" | "1y") => void;
  onCustomDateRange?: (start: string, end: string) => void;
}

// Map explorer chart types to ChartSpec types
function toChartSpecType(explorerType: ExplorerConfig["chartType"]): ChartSpec["type"] {
  switch (explorerType) {
    case "stacked-bar": return "bar";
    case "stacked-area": return "area";
    case "kpi": return "bar"; // KPI handled separately
    default: return explorerType as ChartSpec["type"];
  }
}

function fromChartSpecType(specType: ChartSpec["type"], wasStacked?: boolean): ExplorerConfig["chartType"] {
  if (specType === "bar" && wasStacked) return "stacked-bar";
  if (specType === "area" && wasStacked) return "stacked-area";
  return specType as ExplorerConfig["chartType"];
}

// Map explorer granularity to grain
function toGrain(g: ExplorerConfig["granularity"]): "daily" | "weekly" | "monthly" {
  if (g === "hourly") return "daily";
  return g;
}

export function ExplorerChart({
  config,
  result,
  loading,
  error,
  onChartTypeChange,
  onGranularityChange,
  onDatePresetChange,
  onCustomDateRange,
}: ExplorerChartProps) {
  const { datasetId } = useDataset();
  const [saved, setSaved] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [breakdownVisible, setBreakdownVisible] = useState<Set<string> | null>(null);
  const hasEvents = config.events.length > 0;

  // Build effective chart spec with stacked flag, grain, and dateRange for UnifiedChart controls
  const effectiveSpec = useMemo((): ChartSpec | null => {
    if (!result?.chartSpec) return null;
    const spec = { ...result.chartSpec };
    const isStacked = config.chartType === "stacked-bar" || config.chartType === "stacked-area";
    spec.stacked = isStacked;
    spec.grain = toGrain(config.granularity);
    // Pass dateRange so UnifiedChart's date picker shows the current range
    if ("start" in config.dateRange) {
      spec.dateRange = { start: config.dateRange.start, end: config.dateRange.end };
    }
    // Pass SQL so the Data dropdown can show SQL view
    if (result.sql) spec.sql = result.sql;
    return spec;
  }, [result?.chartSpec, result?.sql, config.chartType, config.granularity, config.dateRange]);

  // Handle type change from UnifiedChart
  const handleTypeChange = useCallback((type: ChartSpec["type"], stacked?: boolean) => {
    onChartTypeChange(fromChartSpecType(type, stacked));
  }, [onChartTypeChange]);

  // Handle grain change from UnifiedChart
  const handleGrainChange = useCallback((grain: "daily" | "weekly" | "monthly") => {
    onGranularityChange(grain);
  }, [onGranularityChange]);

  // Handle time range change from UnifiedChart's date picker
  const handleTimeRangeChange = useCallback((range: { start: string; end: string } | string) => {
    if (typeof range === "string") {
      // "All time" → use 1y preset
      onDatePresetChange("1y");
      return;
    }
    if (onCustomDateRange) {
      onCustomDateRange(range.start, range.end);
      // Auto-set granularity based on span
      const newGrain = autoGranularity({ start: range.start, end: range.end });
      onGranularityChange(newGrain);
    }
  }, [onDatePresetChange, onCustomDateRange, onGranularityChange]);

  const handleSaveToBoard = (boardId: string) => {
    if (!result?.chartSpec) return;
    const sections = getBoardSections(boardId);
    const sectionId = sections[0]?.id;
    const card: BoardCard = {
      id: crypto.randomUUID(),
      boardId,
      type: "chart",
      title: result.chartSpec.title || "Explorer Chart",
      position: { x: 0, y: 0 },
      size: { width: 500, height: 350 },
      author: "user",
      chartSpec: result.chartSpec,
      sql: result.sql,
      data: result.data,
      explorerConfig: config,
      refreshCadence: "manual",
      pinnedAt: new Date().toISOString(),
      comments: [],
      sectionId,
      orderInSection: 0,
    };
    saveBoardCard(card, { sync: true });
    invalidateCatalog();
    setSaved(true);
    setBoardPickerOpen(false);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4 flex-1 min-w-0">
      {/* Chart area */}
      {!hasEvents && (
        <div className="flex items-center justify-center min-h-[400px] text-center text-muted-foreground">
          <div>
            <p className="text-sm">Select an event to start exploring</p>
            <p className="text-xs mt-1">Pick events from the panel on the left</p>
          </div>
        </div>
      )}

      {hasEvents && loading && (
        <div className="flex items-center justify-center min-h-[400px] gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Running query...</span>
        </div>
      )}

      {hasEvents && error && !loading && (
        <div className="flex items-center justify-center min-h-[400px] text-center max-w-md mx-auto px-4">
          <div>
            <p className="text-sm text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground mt-1">Try adjusting your config</p>
          </div>
        </div>
      )}

      {hasEvents && effectiveSpec && !loading && !error && (
        <>
          {config.chartType === "kpi" && result ? (
            <div className="min-h-[400px] flex items-center justify-center">
              <KpiDisplay result={result} />
            </div>
          ) : effectiveSpec.data.length > 0 ? (
            <UnifiedChart
              spec={effectiveSpec}
              variant="normal"
              onTypeChange={handleTypeChange}
              onGrainChange={handleGrainChange}
              onTimeRangeChange={handleTimeRangeChange}
            />
          ) : (
            <div className="flex items-center justify-center min-h-[400px] text-muted-foreground text-sm">
              No data for this configuration
            </div>
          )}
        </>
      )}

      {/* Breakdown table */}
      {result?.breakdownData && result.breakdownData.length > 0 && result.dates && (
        <BreakdownTable
          rawData={result.breakdownData}
          dates={result.dates}
          breakdownLabel={config.breakdown}
          onVisibilityChange={(visible) => setBreakdownVisible(visible)}
        />
      )}

      {/* Save to Board + Execution time */}
      {result && !loading && !error && (
        <div className="flex items-center justify-between">
          <p className="text-[9.9px] text-muted-foreground">
            Query executed in {result.executionTimeMs}ms
          </p>
          <BoardPickerPopover
            open={boardPickerOpen}
            onOpenChange={setBoardPickerOpen}
            onSelect={handleSaveToBoard}
          >
            <button
              disabled={saved}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
            >
              {saved ? (
                <>
                  <Check className="h-3 w-3" />
                  Saved
                </>
              ) : (
                <>
                  <PinIcon className="h-3 w-3" />
                  Save to Board
                </>
              )}
            </button>
          </BoardPickerPopover>
        </div>
      )}
      {result && !loading && error && (
        <p className="text-[9.9px] text-muted-foreground">
          Query executed in {result.executionTimeMs}ms
        </p>
      )}
    </div>
  );
}

// ── KPI Display ──

function KpiDisplay({ result }: { result: ExplorerResult }) {
  const total = result.data.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
  const label = result.chartSpec.title || "Total";

  function formatKpi(val: number): string {
    if (Math.abs(val) >= 1_000_000)
      return (val / 1_000_000).toFixed(1) + "M";
    if (Math.abs(val) >= 1_000)
      return (val / 1_000).toFixed(1) + "K";
    return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-5xl font-bold tabular-nums">{formatKpi(total)}</p>
      <p className="text-xs text-muted-foreground">
        {result.data.length} data points
      </p>
    </div>
  );
}
