import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Metric, MetricStatus } from "@/lib/metric-types";
import { formatValue } from "@/lib/format-utils";
import { deltaColorClass } from "@/lib/delta-colors";
import { NODE_W } from "./metric-tree-layout";


function StatusIndicator({ status }: { status: MetricStatus }) {
  // healthy: solid filled dot
  if (status === "healthy") {
    return <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-muted-foreground/50" />;
  }
  // partial: hollow ring
  if (status === "partial") {
    return <span className="w-1.5 h-1.5 rounded-full shrink-0 border border-muted-foreground/50" />;
  }
  // enrichment_needed: hollow ring, dimmer
  if (status === "enrichment_needed") {
    return <span className="w-1.5 h-1.5 rounded-full shrink-0 border border-muted-foreground/30" />;
  }
  // unavailable: faded dot
  return <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-muted-foreground/20" />;
}

function MetricTreeNodeInner({ data }: NodeProps) {
  const { metric, selected } = data as { metric: Metric; selected: boolean };
  const hasErrors = (metric.errors ?? 0) > 0;
  const isUnhealthy = metric.status !== "healthy";

  // Mini sparkline from timeSeries
  const sparkline = metric.timeSeries && metric.timeSeries.length > 1
    ? buildSparklinePath(metric.timeSeries.map((p) => p.value))
    : null;

  return (
    <div
      className={`rounded-lg border bg-card transition-colors ${
        selected
          ? "border-foreground ring-1 ring-foreground/20"
          : hasErrors || isUnhealthy
            ? "border-muted-foreground/30"
            : "border-border"
      }`}
      style={{ width: NODE_W }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0" />

      <div className="px-3 pt-2.5 pb-2">
        {/* Top row: status + name */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <StatusIndicator status={metric.status} />
          <span className="text-xs font-semibold truncate flex-1">{metric.name}</span>
        </div>

        {/* Value row */}
        <div className="flex items-end justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-semibold leading-none">
              {formatValue(metric.value, metric.valueFormat)}
            </span>
            {metric.changePercent != null && (
              <span
                className={`text-[9px] font-medium ${deltaColorClass(metric.changePercent)}`}
              >
                {metric.changePercent >= 0 ? "+" : ""}
                {metric.changePercent.toFixed(1)}%
              </span>
            )}
          </div>

          {/* Mini sparkline */}
          {sparkline && (
            <svg width="48" height="20" viewBox="0 0 48 20" className="shrink-0 text-muted-foreground/40">
              <polyline
                points={sparkline}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        {/* Category + errors */}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[9px] text-muted-foreground">{metric.category}</span>
          {hasErrors && (
            <span className="text-[9px] text-muted-foreground font-medium">
              {metric.errors} err
            </span>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0" />
    </div>
  );
}

export const MetricTreeNode = memo(MetricTreeNodeInner);

function buildSparklinePath(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 48;
  const h = 20;
  const pad = 2;

  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = pad + (1 - (v - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
