"use client";

import { useState, useEffect } from "react";
import { Loader2, UsersRound } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { SegmentDisplay } from "@/lib/types";

interface SegmentFlow {
  segmentName: string;
  userCount: number;
  percentage: number;
}

interface MovementData {
  inflow: SegmentFlow[];
  outflow: SegmentFlow[];
  netChange: number;
  entered: number;
  left: number;
  error?: string;
}

interface MovementTabProps {
  segment: SegmentDisplay;
}

const BAR_COLORS = ["#22c55e", "#3E63DD", "#E54D2E", "#8E4EC6", "#F76B15"];

export function MovementTab({ segment }: MovementTabProps) {
  const [data, setData] = useState<MovementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"30d" | "60d" | "90d">("30d");

  useEffect(() => {
    setLoading(true);
    apiFetch<MovementData>(`/api/segments/${segment.id}/movement`, {
      method: "POST",
      body: { sql: segment.sql, period },
    })
      .then(setData)
      .catch(() => {
        // If API fails (e.g., no sentinel_segments table), show empty state
        setData({ inflow: [], outflow: [], netChange: 0, entered: 0, left: 0 });
      })
      .finally(() => setLoading(false));
  }, [segment.id, segment.sql, period]);

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
          Unable to compute movement data. Movement analysis requires multiple saved segments.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Compare against:</span>
        <div className="flex items-center rounded-md border overflow-hidden">
          {(["30d", "60d", "90d"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                period === p
                  ? "bg-foreground text-background"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Net change summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Entered</p>
          <p className="text-xl font-bold text-foreground tabular-nums">+{data.entered.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Left</p>
          <p className="text-xl font-bold text-foreground tabular-nums">-{data.left.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Net Change</p>
          <p className={`text-xl font-bold tabular-nums ${data.netChange >= 0 ? "text-foreground" : "text-foreground"}`}>
            {data.netChange >= 0 ? "+" : ""}{data.netChange.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Inflow */}
      {data.inflow.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3">
            Where did new users come from? <span className="text-muted-foreground font-normal">(last {period})</span>
          </h3>
          <div className="space-y-2">
            {data.inflow.map((flow, i) => (
              <FlowBar key={flow.segmentName} flow={flow} color={BAR_COLORS[i % BAR_COLORS.length]} maxPct={data.inflow[0]?.percentage ?? 100} />
            ))}
          </div>
        </div>
      )}

      {/* Outflow */}
      {data.outflow.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3">
            Where did users go? <span className="text-muted-foreground font-normal">(last {period})</span>
          </h3>
          <div className="space-y-2">
            {data.outflow.map((flow, i) => (
              <FlowBar key={flow.segmentName} flow={flow} color={BAR_COLORS[i % BAR_COLORS.length]} maxPct={data.outflow[0]?.percentage ?? 100} />
            ))}
          </div>
        </div>
      )}

      {data.inflow.length === 0 && data.outflow.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-8">
          No movement data available. Create more segments to track user flow between them.
        </div>
      )}
    </div>
  );
}

function FlowBar({ flow, color, maxPct }: { flow: SegmentFlow; color: string; maxPct: number }) {
  const widthPct = Math.max((flow.percentage / maxPct) * 100, 3);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{flow.segmentName}</span>
        <span className="text-muted-foreground tabular-nums">
          {flow.userCount.toLocaleString()} users ({flow.percentage}%)
        </span>
      </div>
      <div className="h-5 bg-muted rounded overflow-hidden">
        <div
          className="h-full rounded transition-all duration-500"
          style={{ width: `${widthPct}%`, backgroundColor: color, opacity: 0.7 }}
        />
      </div>
    </div>
  );
}
