"use client";

import { useState, useMemo } from "react";
import { UnifiedChart } from "@/components/chart/unified-chart";
import type { ChartSpec } from "@/lib/chart-types";
import type { RevenueDataPoint } from "@/lib/store-types";

const PERIODS = ["7D", "30D", "All"] as const;
type Period = (typeof PERIODS)[number];

interface StoreRevenueChartProps {
  data: RevenueDataPoint[];
}

export function StoreRevenueChart({ data }: StoreRevenueChartProps) {
  const [period, setPeriod] = useState<Period>("30D");

  const filtered = useMemo(() => {
    if (!data?.length) return [];
    const days = period === "7D" ? 7 : period === "30D" ? 30 : data.length;
    return data.slice(-Math.min(days, data.length));
  }, [data, period]);

  const chartSpec = useMemo((): ChartSpec | null => {
    if (!filtered.length) return null;
    return {
      type: "area",
      title: "Revenue",
      data: filtered.map((d) => ({ date: d.date, revenue: d.revenue })),
      xKey: "date",
      yKeys: ["revenue"],
      yLabels: ["Revenue"],
      format: { revenue: "currency" },
      currency: "$",
    };
  }, [filtered]);

  if (!chartSpec) {
    return (
      <div className="border border-border rounded-lg p-4">
        <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">
          No chart data available
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Revenue</h3>
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                period === p
                  ? "border border-border text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <UnifiedChart spec={chartSpec} variant="compact" height={240} />
    </div>
  );
}
