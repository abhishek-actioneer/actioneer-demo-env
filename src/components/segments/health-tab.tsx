"use client";

import { useState, useEffect } from "react";
import { Loader2, UsersRound } from "lucide-react";
import { UnifiedChart } from "@/components/chart/unified-chart";
import { apiFetch } from "@/lib/api-client";
import type { SegmentDisplay } from "@/lib/types";
import type { ChartSpec } from "@/lib/chart-types";

interface HealthData {
  userCount: number;
  growthPct: number;
  sizeOverTime: { period: string; count: number }[];
  vsAllUsers: { metric: string; segment: number; allUsers: number; diff: string }[];
  vsPreviousPeriod: { metric: string; now: number; d30: number; d60: number; d90: number }[];
  error?: string;
}

interface HealthTabProps {
  segment: SegmentDisplay;
}

function usesBucketedTrend(segment: SegmentDisplay): boolean {
  const range = segment.config?.dateRange;
  return Boolean(range && "preset" in range && range.preset !== "all");
}

export function HealthTab({ segment }: HealthTabProps) {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<HealthData>(`/api/segments/${segment.id}/overview`, {
      method: "POST",
      body: { sql: segment.sql, config: segment.config },
    })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [segment.config, segment.id, segment.sql]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <UsersRound className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">
          Unable to compute health metrics for this segment.
        </p>
      </div>
    );
  }

  // Build size-over-time chart spec
  const sizeChartSpec: ChartSpec | null = data.sizeOverTime.length > 0 ? {
    type: "area",
    title: usesBucketedTrend(segment) ? "Weekly Segment Activity" : "Segment Size Over Time",
    data: data.sizeOverTime.map((d) => ({
      period: d.period,
      users: d.count,
    })),
    xKey: "period",
    yKeys: ["users"],
    yLabels: ["Users in segment"],
  } : null;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Segment Size"
          value={data.userCount.toLocaleString()}
          sub="users"
        />
        <KpiCard
          label="Growth"
          value={`${data.growthPct > 0 ? "+" : ""}${data.growthPct}%`}
          sub="vs 30 days ago"
          positive={data.growthPct > 0}
        />
        {data.vsAllUsers.slice(0, 2).map((m) => (
          <KpiCard
            key={m.metric}
            label={m.metric}
            value={m.segment.toLocaleString()}
            sub={`${m.diff} vs all users`}
          />
        ))}
      </div>

      {/* Size over time chart */}
      {sizeChartSpec && (
        <div className="rounded-lg border bg-background p-4">
          <UnifiedChart spec={sizeChartSpec} variant="compact" />
        </div>
      )}

      {/* vs All Users table */}
      {data.vsAllUsers.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">vs All Users</h3>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Metric</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">This Segment</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">All Users</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Difference</th>
                </tr>
              </thead>
              <tbody>
                {data.vsAllUsers.map((row) => (
                  <tr key={row.metric} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{row.metric}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.segment.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.allUsers.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.diff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* vs Previous Periods */}
      {data.vsPreviousPeriod.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Trend Over Time</h3>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Metric</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Now</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">30d ago</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">60d ago</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">90d ago</th>
                </tr>
              </thead>
              <tbody>
                {data.vsPreviousPeriod.map((row) => (
                  <tr key={row.metric} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{row.metric}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.now.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.d30.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.d60.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.d90.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${positive === true ? "text-foreground" : positive === false ? "text-foreground" : ""}`}>
        {value}
      </p>
      <p className="text-[9.9px] text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}
