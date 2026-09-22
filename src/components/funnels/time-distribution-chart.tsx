"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Clock } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { TimeDistributionResult } from "@/lib/funnel-time-sql";

interface TimeDistributionChartProps {
  funnelId: string;
  stepLabels: string[];
  stepCount: number;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

export function TimeDistributionChart({
  funnelId,
  stepLabels,
  stepCount,
}: TimeDistributionChartProps) {
  const [data, setData] = useState<TimeDistributionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPair, setSelectedPair] = useState<string>("overall");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<TimeDistributionResult>(
        `/api/funnels/${funnelId}/time-distribution`,
        { method: "POST" }
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load time distribution");
    } finally {
      setLoading(false);
    }
  }, [funnelId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="border rounded-lg p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading time distribution...</span>
        </div>
      </div>
    );
  }

  if (error || !data || data.stepPairs.length === 0) {
    return null;
  }

  // Build step pair options
  const pairOptions: { key: string; label: string; fromStep: number; toStep: number }[] = [];

  for (const pair of data.stepPairs) {
    const isOverall = pair.fromStep === 0 && pair.toStep === stepCount - 1;
    if (isOverall) continue; // We'll add overall separately
    const fromLabel = stepLabels[pair.fromStep] || `Step ${pair.fromStep + 1}`;
    const toLabel = stepLabels[pair.toStep] || `Step ${pair.toStep + 1}`;
    pairOptions.push({
      key: `${pair.fromStep}-${pair.toStep}`,
      label: `${fromLabel} \u2192 ${toLabel}`,
      fromStep: pair.fromStep,
      toStep: pair.toStep,
    });
  }

  // Find the overall pair
  const overallPair = data.stepPairs.find(
    (p) => p.fromStep === 0 && p.toStep === stepCount - 1
  );
  if (overallPair) {
    pairOptions.unshift({
      key: "overall",
      label: "Overall",
      fromStep: 0,
      toStep: stepCount - 1,
    });
  }

  // Get selected pair data
  const activePair =
    selectedPair === "overall"
      ? overallPair
      : data.stepPairs.find(
          (p) => `${p.fromStep}-${p.toStep}` === selectedPair
        );

  if (!activePair) return null;

  const maxBucketCount = Math.max(...activePair.buckets.map((b) => b.count), 1);

  return (
    <div className="border rounded-lg">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Time to Convert</h3>
        </div>
        {pairOptions.length > 1 && (
          <select
            value={selectedPair}
            onChange={(e) => setSelectedPair(e.target.value)}
            className="text-xs border rounded-md px-2 py-1 bg-background text-foreground"
          >
            {pairOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Summary stats */}
      <div className="px-4 py-3 border-b bg-muted/30">
        <p className="text-xs text-foreground">
          Median: <span className="font-semibold">{formatDuration(activePair.median)}</span>
          <span className="text-muted-foreground mx-1.5">&middot;</span>
          P90: <span className="font-semibold">{formatDuration(activePair.p90)}</span>
          <span className="text-muted-foreground mx-1.5">&middot;</span>
          <span className="text-muted-foreground">
            {activePair.convertedCount.toLocaleString()} converted
          </span>
        </p>
      </div>

      {/* Histogram */}
      <div className="p-4 space-y-2">
        {activePair.buckets.map((bucket) => {
          const widthPct = Math.max((bucket.count / maxBucketCount) * 100, 0);
          return (
            <div key={bucket.label} className="flex items-center gap-3">
              <span className="text-[9.9px] text-muted-foreground w-20 text-right tabular-nums flex-shrink-0">
                {bucket.label}
              </span>
              <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                {bucket.count > 0 && (
                  <div
                    className="h-full rounded bg-foreground/60 transition-all duration-500"
                    style={{ width: `${widthPct}%` }}
                  />
                )}
              </div>
              <span className="text-[9.9px] text-muted-foreground tabular-nums w-16 text-right flex-shrink-0">
                {bucket.count > 0
                  ? `${bucket.count.toLocaleString()} (${bucket.percentage}%)`
                  : "0"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Percentile markers */}
      <div className="px-4 py-3 border-t grid grid-cols-4 gap-4">
        {([
          ["P25", activePair.p25],
          ["Median", activePair.median],
          ["P75", activePair.p75],
          ["P90", activePair.p90],
        ] as const).map(([label, value]) => (
          <div key={label} className="text-center">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="text-sm font-semibold tabular-nums">{formatDuration(value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
