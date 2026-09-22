"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronDown, ChevronRight, ExternalLink, Pencil } from "lucide-react";
import type { Metric } from "@/lib/metric-types";
import { formatValue } from "@/lib/format-utils";
import { deltaColorClass } from "@/lib/delta-colors";
import { METRIC_STATUS_COLORS, METRIC_STATUS_ICONS } from "@/lib/metric-types";
import { MetricTypeIcon } from "@/components/metric/metric-type-icon";
import { MetricTreeIcon } from "@/components/nav-icons";

interface MetricTreeContextPanelProps {
  metrics: Metric[];
  selectedMetricId: string | null;
  rootMetric: Metric | null;
  onDeselect: () => void;
  onEditMetric?: (id: string) => void;
}

export function MetricTreeContextPanel({
  metrics,
  selectedMetricId,
  rootMetric,
  onDeselect,
  onEditMetric,
}: MetricTreeContextPanelProps) {
  const selected = selectedMetricId
    ? metrics.find((m) => m.id === selectedMetricId)
    : null;

  if (selected) {
    return (
      <SelectedMetricView
        metric={selected}
        allMetrics={metrics}
        onDeselect={onDeselect}
        onEditMetric={onEditMetric}
      />
    );
  }

  return <TreeSummaryView metrics={metrics} rootMetric={rootMetric} />;
}

// ── Tree Summary (no selection) ──

function TreeSummaryView({
  metrics,
  rootMetric,
}: {
  metrics: Metric[];
  rootMetric: Metric | null;
}) {
  const topGrowers = [...metrics]
    .filter((m) => m.changePercent !== undefined && m.changePercent > 0)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
    .slice(0, 3);

  const needsAttention = metrics.filter(
    (m) => (m.errors ?? 0) > 0 || m.status !== "healthy"
  );

  const categories = new Set(metrics.map((m) => m.category));

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-widest mb-1">
          Focus Metric
        </p>
        {rootMetric ? (
          <div>
            <p className="text-sm font-semibold">{rootMetric.name}</p>
            <p className="text-lg font-semibold mt-0.5">
              {formatValue(rootMetric.value, rootMetric.valueFormat)}
              {rootMetric.changePercent != null && (
                <span
                  className={`text-xs font-medium ml-1.5 ${deltaColorClass(rootMetric.changePercent)}`}
                >
                  {rootMetric.changePercent >= 0 ? "+" : ""}
                  {rootMetric.changePercent.toFixed(1)}%
                </span>
              )}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center py-6">
            <MetricTreeIcon className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No root metric selected yet.</p>
          </div>
        )}
      </div>

      {topGrowers.length > 0 && (
        <Section title="What's Driving Growth">
          {topGrowers.map((m) => (
            <SummaryRow
              key={m.id}
              name={m.name}
              value={formatValue(m.value, m.valueFormat)}
              change={m.changePercent}
            />
          ))}
        </Section>
      )}

      {needsAttention.length > 0 && (
        <Section title="Needs Attention">
          {needsAttention.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-1">
              <span className={`text-xs ${METRIC_STATUS_COLORS[m.status]}`}>
                {METRIC_STATUS_ICONS[m.status]}
              </span>
              <span className="text-xs truncate flex-1">{m.name}</span>
              {(m.errors ?? 0) > 0 && (
                <span className="text-[9px] text-muted-foreground font-medium">{m.errors} err</span>
              )}
            </div>
          ))}
        </Section>
      )}

      <Section title="Impact Analysis">
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Total Metrics" value={String(metrics.length)} />
          <MiniStat label="Categories" value={String(categories.size)} />
          <MiniStat label="Healthy" value={String(metrics.filter((m) => m.status === "healthy").length)} />
          <MiniStat label="With Errors" value={String(metrics.filter((m) => (m.errors ?? 0) > 0).length)} />
        </div>
      </Section>
    </div>
  );
}

// ── Selected Metric View ──

function SelectedMetricView({
  metric,
  allMetrics,
  onDeselect,
  onEditMetric,
}: {
  metric: Metric;
  allMetrics: Metric[];
  onDeselect: () => void;
  onEditMetric?: (id: string) => void;
}) {
  const router = useRouter();
  const [sqlExpanded, setSqlExpanded] = useState(false);

  const byId = new Map(allMetrics.map((m) => [m.id, m]));
  const drivers = metric.relationships
    .filter((r) => r.direction === "driven_by")
    .map((r) => ({ rel: r, metric: byId.get(r.metricId) }))
    .filter((x) => x.metric);

  const impacts = metric.relationships
    .filter((r) => r.direction === "drives")
    .map((r) => ({ rel: r, metric: byId.get(r.metricId) }))
    .filter((x) => x.metric);

  const watchItems = [...drivers, ...impacts]
    .map((x) => x.metric!)
    .filter((m) => (m.errors ?? 0) > 0 || m.status !== "healthy");

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-4 pt-3 pb-3 border-b border-border">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <MetricTypeIcon type={metric.type} size="xs" />
              <span className={`text-xs ${METRIC_STATUS_COLORS[metric.status]}`}>
                {METRIC_STATUS_ICONS[metric.status]}
              </span>
            </div>
            <p className="text-sm font-semibold">{metric.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {metric.description}
            </p>
          </div>
          <button
            onClick={onDeselect}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Value */}
        <p className="text-lg font-semibold mt-2">
          {formatValue(metric.value, metric.valueFormat)}
          {metric.changePercent != null && (
            <span
              className={`text-xs font-medium ml-1.5 ${deltaColorClass(metric.changePercent)}`}
            >
              {metric.changePercent >= 0 ? "+" : ""}
              {metric.changePercent.toFixed(1)}%
            </span>
          )}
        </p>
      </div>

      {/* Drivers */}
      {drivers.length > 0 && (
        <Section title="What's Driving This">
          {drivers.map(({ rel, metric: dm }) => (
            <SummaryRow
              key={rel.metricId}
              name={dm!.name}
              value={formatValue(dm!.value, dm!.valueFormat)}
              change={dm!.changePercent}
              badge={rel.type}
            />
          ))}
        </Section>
      )}

      {/* Watch items */}
      {watchItems.length > 0 && (
        <Section title="Watch Items">
          {watchItems.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-1">
              <span className={`text-xs ${METRIC_STATUS_COLORS[m.status]}`}>
                {METRIC_STATUS_ICONS[m.status]}
              </span>
              <span className="text-xs truncate flex-1">{m.name}</span>
              {(m.errors ?? 0) > 0 && (
                <span className="text-[9px] text-muted-foreground font-medium">{m.errors} err</span>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* Impacts */}
      {impacts.length > 0 && (
        <Section title="Impact on Other Metrics">
          {impacts.map(({ rel, metric: im }) => (
            <SummaryRow
              key={rel.metricId}
              name={im!.name}
              value={formatValue(im!.value, im!.valueFormat)}
              change={im!.changePercent}
              badge={rel.type}
            />
          ))}
        </Section>
      )}

      {/* Technical Info */}
      <Section title="Technical Info">
        <div className="space-y-1.5">
          <InfoRow label="Source Table" value={metric.table} />
          <InfoRow label="Column" value={metric.column} />
          <InfoRow label="Aggregation" value={metric.aggregation} />
          <InfoRow label="Time Grain" value={metric.timeGrain} />
          {metric.formula && <InfoRow label="Formula" value={metric.formula} />}
        </div>
      </Section>

      {/* SQL */}
      {metric.sql && (
        <div className="px-4 py-2 border-t border-border">
          <button
            onClick={() => setSqlExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {sqlExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            View SQL Query
          </button>
          {sqlExpanded && (
            <pre className="mt-2 text-[9.9px] bg-muted rounded-md p-2 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
              {metric.sql}
            </pre>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="px-4 py-3 border-t border-border mt-auto flex items-center gap-2">
        {onEditMetric && (
          <button
            onClick={() => onEditMetric(metric.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
        )}
        <button
          onClick={() => router.push(`/metrics/${metric.id}`)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          View Detail
        </button>
      </div>
    </div>
  );
}

// ── Shared sub-components ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-t border-border">
      <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-widest mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

function SummaryRow({
  name,
  value,
  change,
  badge,
}: {
  name: string;
  value: string;
  change?: number;
  badge?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs truncate flex-1">{name}</span>
      {badge && (
        <span className="text-[8.1px] font-medium text-muted-foreground border border-border rounded px-1 py-0.5">
          {badge}
        </span>
      )}
      <span className="text-xs font-medium shrink-0">{value}</span>
      {change != null && (
        <span
          className={`text-[9px] font-medium shrink-0 ${deltaColorClass(change)}`}
        >
          {change >= 0 ? "+" : ""}
          {change.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-2.5 py-2">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold mt-0.5">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[9.9px] text-muted-foreground">{label}</span>
      <span className="text-[9.9px] font-medium text-right truncate max-w-[160px]">{value}</span>
    </div>
  );
}
