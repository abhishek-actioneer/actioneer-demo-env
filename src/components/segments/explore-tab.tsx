"use client";

import { useMemo } from "react";
import { useExplorer } from "@/hooks/use-explorer";
import { ExplorerConfigPanel } from "@/components/explorer/explorer-config-panel";
import { ExplorerChart } from "@/components/explorer/explorer-chart";
import { useDataset } from "@/lib/dataset-context";
import type { SegmentDisplay } from "@/lib/types";

interface ExploreTabProps {
  segment: SegmentDisplay;
}

export function ExploreTab({ segment }: ExploreTabProps) {
  const { dataset } = useDataset();
  const eventCatalog = useMemo(() => dataset?.events ?? [], [dataset]);

  const {
    config,
    result,
    loading,
    error,
    addEvent,
    removeEvent,
    updateEvent,
    setBreakdown,
    setChartType,
    setGranularity,
    setDatePreset,
    setDateRange,
    setComputation,
    setCompare,
  } = useExplorer();

  // TODO: inject segment.sql into all queries via segmentSQLs param
  // For now, the explorer runs without segment filter — will wire in next pass

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden h-full">
      {/* Config panel — no Segment By section since the segment IS the filter */}
      <ExplorerConfigPanel
        events={config.events}
        catalog={eventCatalog}
        breakdown={config.breakdown}
        segmentIds={[]}
        segments={[]}
        onAddEvent={addEvent}
        onRemoveEvent={removeEvent}
        onUpdateEvent={updateEvent}
        onBreakdownChange={setBreakdown}
        onSegmentIdsChange={() => {}}
      />

      {/* Chart area */}
      <div className="flex-1 min-w-0 p-6 overflow-y-auto">
        <div className="mb-3">
          <p className="text-xs text-muted-foreground">
            Exploring events for <span className="font-medium text-foreground">{segment.name}</span> ({segment.userCount.toLocaleString()} users)
          </p>
        </div>
        <ExplorerChart
          config={config}
          result={result}
          loading={loading}
          error={error}
          onChartTypeChange={setChartType}
          onGranularityChange={setGranularity}
          onDatePresetChange={setDatePreset}
          onCustomDateRange={(start, end) => setDateRange({ start, end })}
        />
      </div>
    </div>
  );
}
