"use client";

import { useState, useEffect } from "react";
import { Loader2, UsersRound } from "lucide-react";
import { UnifiedChart } from "@/components/chart/unified-chart";
import { apiFetch } from "@/lib/api-client";
import type { SegmentDisplay } from "@/lib/types";
import type { ChartSpec } from "@/lib/chart-types";

interface PropertyBreakdown {
  property: string;
  displayName: string;
  values: { name: string; count: number }[];
}

interface CompositionData {
  breakdowns: PropertyBreakdown[];
  error?: string;
}

interface CompositionTabProps {
  segment: SegmentDisplay;
}

export function CompositionTab({ segment }: CompositionTabProps) {
  const [data, setData] = useState<CompositionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<CompositionData>(`/api/segments/${segment.id}/composition`, {
      method: "POST",
      body: { sql: segment.sql },
    })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [segment.id, segment.sql]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || !data.breakdowns.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <UsersRound className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">
          No property breakdowns available for this segment.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {data.breakdowns.map((bd) => {
          const chartSpec: ChartSpec = {
            type: "bar",
            title: bd.displayName,
            data: bd.values.slice(0, 10).map((v) => ({
              name: v.name || "(empty)",
              count: v.count,
            })),
            xKey: "name",
            yKeys: ["count"],
            yLabels: ["Users"],
          };

          return (
            <div key={bd.property} className="rounded-lg border p-4">
              <h3 className="text-sm font-medium mb-3">{bd.displayName}</h3>
              <UnifiedChart spec={chartSpec} variant="compact" />
              {/* Top values list */}
              <div className="mt-3 space-y-1">
                {bd.values.slice(0, 5).map((v) => (
                  <div key={v.name} className="flex items-center justify-between text-xs">
                    <span className="truncate max-w-[150px]">{v.name || "(empty)"}</span>
                    <span className="text-muted-foreground tabular-nums">{v.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
