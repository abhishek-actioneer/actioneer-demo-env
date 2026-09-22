"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import type { ExplorerConfig, DateRangePreset } from "@/lib/explorer-types";

interface ExplorerControlsBarProps {
  chartType: ExplorerConfig["chartType"];
  granularity: ExplorerConfig["granularity"];
  dateRange: ExplorerConfig["dateRange"];
  computation?: ExplorerConfig["computation"];
  compare?: ExplorerConfig["compare"];
  onChartTypeChange: (type: ExplorerConfig["chartType"]) => void;
  onGranularityChange: (g: ExplorerConfig["granularity"]) => void;
  onDatePresetChange: (preset: DateRangePreset) => void;
  onCustomDateRange?: (start: string, end: string) => void;
  onComputationChange?: (c: NonNullable<ExplorerConfig["computation"]>) => void;
  onCompareChange?: (c: NonNullable<ExplorerConfig["compare"]>) => void;
  /** Disable compare when breakdown is active */
  compareDisabled?: boolean;
}

const DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "60d", label: "60d" },
  { value: "90d", label: "90d" },
  { value: "1y", label: "1y" },
];

const CHART_TYPES: { value: ExplorerConfig["chartType"]; label: string }[] = [
  { value: "line", label: "Line chart" },
  { value: "bar", label: "Bar chart" },
  { value: "area", label: "Area chart" },
  { value: "stacked-bar", label: "Stacked bar" },
  { value: "stacked-area", label: "Stacked area" },
  { value: "pie", label: "Pie chart" },
  { value: "kpi", label: "KPI" },
];

const GRANULARITIES: {
  value: ExplorerConfig["granularity"];
  label: string;
}[] = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const COMPUTATIONS: { value: NonNullable<ExplorerConfig["computation"]>; label: string }[] = [
  { value: "none", label: "None" },
  { value: "rolling-avg", label: "Rolling Avg" },
  { value: "cumulative", label: "Cumulative" },
];

export function ExplorerControlsBar({
  chartType,
  granularity,
  dateRange,
  computation,
  compare,
  onChartTypeChange,
  onGranularityChange,
  onDatePresetChange,
  onCustomDateRange,
  onComputationChange,
  onCompareChange,
  compareDisabled,
}: ExplorerControlsBarProps) {
  const activePreset = "preset" in dateRange ? dateRange.preset : null;
  const isCustom = "start" in dateRange;
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState(
    isCustom ? dateRange.start : "",
  );
  const [customEnd, setCustomEnd] = useState(
    isCustom ? dateRange.end : "",
  );

  const handleCustomApply = () => {
    if (customStart && customEnd && onCustomDateRange) {
      onCustomDateRange(customStart, customEnd);
      setShowCustom(false);
    }
  };

  return (
    <div className="flex items-center gap-3 text-sm flex-wrap">
      {/* Chart type */}
      <select
        value={chartType}
        onChange={(e) =>
          onChartTypeChange(e.target.value as ExplorerConfig["chartType"])
        }
        className="appearance-none bg-muted rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer border-0 focus:ring-1 focus:ring-border"
      >
        {CHART_TYPES.map((ct) => (
          <option key={ct.value} value={ct.value}>
            {ct.label}
          </option>
        ))}
      </select>

      {/* Granularity */}
      <select
        value={granularity}
        onChange={(e) =>
          onGranularityChange(
            e.target.value as ExplorerConfig["granularity"],
          )
        }
        className="appearance-none bg-muted rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer border-0 focus:ring-1 focus:ring-border"
      >
        {GRANULARITIES.map((g) => (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ))}
      </select>

      {/* Date range presets + custom */}
      <div className="flex items-center rounded-md border overflow-hidden">
        {DATE_PRESETS.map((dp) => (
          <button
            key={dp.value}
            onClick={() => {
              onDatePresetChange(dp.value);
              setShowCustom(false);
            }}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              activePreset === dp.value
                ? "bg-foreground text-background"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            {dp.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(!showCustom)}
          className={`px-2 py-1 transition-colors ${
            isCustom
              ? "bg-foreground text-background"
              : "hover:bg-muted text-muted-foreground"
          }`}
          title="Custom date range"
        >
          <Calendar className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Custom date inputs */}
      {showCustom && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="bg-muted rounded-md px-2 py-1 text-xs border-0 focus:ring-1 focus:ring-border"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="bg-muted rounded-md px-2 py-1 text-xs border-0 focus:ring-1 focus:ring-border"
          />
          <button
            onClick={handleCustomApply}
            disabled={!customStart || !customEnd}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-foreground text-background disabled:opacity-30"
          >
            Apply
          </button>
        </div>
      )}

      {/* Show active custom range as label */}
      {isCustom && !showCustom && (
        <span className="text-xs text-muted-foreground">
          {dateRange.start} — {dateRange.end}
        </span>
      )}

      {/* Computation selector */}
      {onComputationChange && (
        <select
          value={computation ?? "none"}
          onChange={(e) =>
            onComputationChange(e.target.value as NonNullable<ExplorerConfig["computation"]>)
          }
          className="appearance-none bg-muted rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer border-0 focus:ring-1 focus:ring-border"
        >
          {COMPUTATIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      )}

      {/* Compare selector */}
      {onCompareChange && (
        <select
          value={compareDisabled ? "none" : (compare ?? "none")}
          disabled={compareDisabled}
          onChange={(e) =>
            onCompareChange(e.target.value as NonNullable<ExplorerConfig["compare"]>)
          }
          className="appearance-none bg-muted rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer border-0 focus:ring-1 focus:ring-border disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <option value="none">Compare</option>
          <option value="previous_period">vs Previous Period</option>
          <option value="previous_year">vs Previous Year</option>
        </select>
      )}
    </div>
  );
}
