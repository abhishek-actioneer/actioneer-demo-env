"use client";

import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { setExplorerConfig } from "@/lib/explorer-store";
import type { ExplorerConfig, DateRangePreset } from "@/lib/explorer-types";

const DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "60d", label: "60d" },
  { value: "90d", label: "90d" },
];

interface CardExplorerFooterProps {
  config: ExplorerConfig;
  onConfigChange: (config: ExplorerConfig) => void;
  availableBreakdowns?: string[];
}

export function CardExplorerFooter({
  config,
  onConfigChange,
  availableBreakdowns = [],
}: CardExplorerFooterProps) {
  const router = useRouter();
  const activePreset = "preset" in config.dateRange ? config.dateRange.preset : null;

  const handlePresetChange = (preset: DateRangePreset) => {
    onConfigChange({ ...config, dateRange: { preset } });
  };

  const handleBreakdownChange = (breakdown: string) => {
    onConfigChange({
      ...config,
      breakdown: breakdown || undefined,
    });
  };

  const handleEditInExplorer = () => {
    setExplorerConfig(config);
    router.push("/explore");
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-t bg-muted/30 text-xs">
      {/* Date range presets */}
      <div className="flex items-center rounded overflow-hidden border">
        {DATE_PRESETS.map((dp) => (
          <button
            key={dp.value}
            onClick={() => handlePresetChange(dp.value)}
            className={`px-2 py-0.5 transition-colors ${
              activePreset === dp.value
                ? "bg-foreground text-background"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            {dp.label}
          </button>
        ))}
      </div>

      {/* Breakdown selector */}
      {availableBreakdowns.length > 0 && (
        <>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">By:</span>
          <select
            value={config.breakdown ?? ""}
            onChange={(e) => handleBreakdownChange(e.target.value)}
            className="appearance-none bg-transparent border-0 text-xs font-medium cursor-pointer focus:ring-0 py-0 pr-4"
          >
            <option value="">None</option>
            {availableBreakdowns.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </>
      )}

      {/* Edit in explorer link */}
      <button
        onClick={handleEditInExplorer}
        className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        title="Edit in explorer"
      >
        <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  );
}
