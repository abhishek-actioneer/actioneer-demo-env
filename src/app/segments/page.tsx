"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, UsersRound, Sparkles, Loader2, Save, Code, FileUp } from "lucide-react";
import { CsvAudienceUploadDialog } from "@/components/segments/csv-audience-upload-dialog";
import { BehavioralSegmentCard } from "@/components/segments/behavioral-segment-card";
import { SegmentConfigPanel } from "@/components/explorer/segment-config-panel";
import { useSegmentBuilder, type SegmentPreviewPoint } from "@/hooks/use-segment-builder";
import { OCCURRENCE_OP_LABELS, type SegmentBuilderConfig } from "@/lib/segment-builder-types";
import type { EventDefinition, EventProperty, PropertyFilter } from "@/lib/explorer-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DataTableFrame,
  DataTableScroll,
  DataTableToolbar,
  dataTableClassNames,
} from "@/components/ui/data-table";
import type { Segment, SegmentDisplay } from "@/lib/types";
import { isBehavioralSegment } from "@/lib/types";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { isUploadedAudienceSql } from "@/lib/segment-csv-upload";
import { useSidebarContext } from "@/components/sidebar-context";
import { FeatureGate } from "@/components/feature-gate";
import { SqlHighlighted } from "@/lib/sql-highlight";
import { UnifiedChart } from "@/components/chart/unified-chart";
import type { ChartSpec } from "@/lib/chart-types";
import { cn } from "@/lib/utils";

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateLabel(dateStr: string, totalPoints: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const mon = SHORT_MONTHS[d.getMonth()];
  if (totalPoints > 20) return `${mon} '${String(d.getFullYear()).slice(2)}`;
  return `${mon} ${d.getDate()}`;
}

function formatDateRangeText(range: SegmentBuilderConfig["dateRange"]): string {
  if ("start" in range) return `from ${range.start} to ${range.end}`;
  if (range.preset === "all") return "across all time";
  const labels: Record<string, string> = {
    "7d": "in the last 7 days",
    "30d": "in the last 30 days",
    "60d": "in the last 60 days",
    "90d": "in the last 90 days",
    "1y": "in the last year",
  };
  return labels[range.preset] ?? "in the selected time window";
}

function usesBucketedTrend(range: SegmentBuilderConfig["dateRange"]): boolean {
  return "preset" in range && range.preset !== "all";
}

function formatFilterText(filter: PropertyFilter, properties: EventProperty[]): string {
  const property = properties.find((candidate) => candidate.column === filter.property);
  const operatorLabels: Record<PropertyFilter["operator"], string> = {
    eq: "=",
    neq: "!=",
    gt: ">",
    lt: "<",
    gte: ">=",
    lte: "<=",
    contains: "contains",
    in: "is one of",
    not_in: "is not one of",
  };
  const rawValue = Array.isArray(filter.value)
    ? filter.value.join(", ")
    : filter.value === "" || filter.value == null
      ? "..."
      : String(filter.value);
  return `${property?.displayName ?? filter.property} ${operatorLabels[filter.operator]} ${rawValue}`;
}

function formatRuleSummary(
  rule: SegmentBuilderConfig["rules"][number],
  events: EventDefinition[],
): { title: string; detail: string; sentence: string } {
  if (rule.kind === "attribute") {
    const detail = `${rule.filter.operator} ${String(rule.filter.value)}`;
    return {
      title: rule.filter.property,
      detail,
      sentence: `has ${rule.filter.property} ${detail}`,
    };
  }

  const def = events.find((event) => event.id === rule.eventId);
  const eventName = def?.displayName ?? rule.eventId;
  const properties = def?.properties ?? [];
  const occurrence = rule.action === "did"
    ? rule.occurrence
      ? `${OCCURRENCE_OP_LABELS[rule.occurrence.op]} ${rule.occurrence.value} ${rule.occurrence.value === 1 ? "time" : "times"}`
      : "at least once"
    : "";
  const filters = (rule.filters ?? []).map((filter) => formatFilterText(filter, properties));
  const action = rule.action === "did" ? "Did" : "Did not do";
  const sentenceBase = rule.action === "did"
    ? `did ${eventName} ${occurrence}`
    : `did not do ${eventName}`;
  const filterSentence = filters.length > 0 ? ` where ${filters.join(" and ")}` : "";

  return {
    title: `${action} ${eventName}`,
    detail: [occurrence, ...filters].filter(Boolean).join(" - "),
    sentence: `${sentenceBase}${filterSentence}`,
  };
}

function buildSegmentSummary(config: SegmentBuilderConfig, events: EventDefinition[]): string | null {
  if (config.rules.length === 0) return null;
  const summaries = config.rules.map((rule) => formatRuleSummary(rule, events).sentence);
  const joiner = config.combinator === "AND" ? " and " : " or ";
  return `Users who ${summaries.join(joiner)} ${formatDateRangeText(config.dateRange)}.`;
}

function toSegmentDisplay(segment: Segment): SegmentDisplay {
  return {
    ...segment,
    description: segment.description || "Segment created from chat analysis",
    type: isUploadedAudienceSql(segment.sql) ? "static" : "dynamic",
    destinations: Object.entries(segment.pushStatus)
      .filter(([, status]) => status === "synced" || status === "pushing")
      .map(([id]) => id),
    trend: null,
    refreshStatus: "active",
    refreshLabel: "Live query",
    creator: "You",
    statusColor: "green",
    archived: false,
    refreshFrequency: "daily",
    similarSegments: [],
    totalUsers: segment.userCount,
  };
}


export default function SegmentsLandingPage() {
  const router = useRouter();
  const { datasetId, dataset } = useDataset();
  const { refreshSegments } = useSidebarContext();
  const [mode, setMode] = useState<"list" | "builder">("list");
  const [realSegments, setRealSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");
  const [generating, setGenerating] = useState(false);
  // Generation result/error state is tracked for control flow; the on-page banner
  // was removed (success/skip counts are no longer surfaced at the top).
  const [, setGenerateResult] = useState<{ generated: number; failed: number } | null>(null);
  const [, setGenError] = useState<string | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  const fetchSegments = useCallback(async () => {
    try {
      const data = await apiFetch<Segment[]>("/api/segments");
      setRealSegments(data);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- datasetId triggers re-fetch on dataset switch; apiFetch injects it automatically
  }, [datasetId]);

  useEffect(() => {
    fetchSegments();
  }, [fetchSegments]);

  // Auto-generate segments for sample datasets on first visit when none exist.
  // Uploaded datasets generate during upload; sample datasets need this trigger.
  // Disabled (2026-06-19): workspaces start empty so the team builds their own;
  // users trigger generation manually via the "Generate Starter Segments" button.
  const AUTO_GENERATE_STARTER_SEGMENTS = false;
  const autoGenTriggered = useRef(false);
  useEffect(() => {
    if (!AUTO_GENERATE_STARTER_SEGMENTS) return;
    if (loading || generating || autoGenTriggered.current) return;
    if (realSegments.length > 0) return;
    if (!dataset || !datasetId) return;
    // Only auto-generate for sample (non-dynamic) datasets
    if (dataset.isDynamic) return;
    autoGenTriggered.current = true;
    setGenerating(true);
    apiFetch<{ generated: number; failed: number }>("/api/segments/generate-all", {
      method: "POST",
      body: { datasetId },
    })
      .then((data) => {
        setGenerateResult(data);
        fetchSegments();
      })
      .catch((err) => setGenError(err instanceof Error ? err.message : "Generation failed"))
      .finally(() => setGenerating(false));
  }, [AUTO_GENERATE_STARTER_SEGMENTS, loading, generating, realSegments.length, dataset, datasetId, fetchSegments]);

  // Convert API segments to display format for UI
  const allSegments: SegmentDisplay[] = useMemo(() => realSegments.map(toSegmentDisplay), [realSegments]);

  // Behavioral segments for gallery (never in table)
  const behavioralSegments = useMemo(
    () => allSegments.filter((s) => isBehavioralSegment(s) && !s.archived),
    [allSegments]
  );

  const filtered = useMemo(() => {
    let list = allSegments.filter(
      (s) =>
        !isBehavioralSegment(s) &&
        (activeTab === "archived" ? s.archived : !s.archived)
    );
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allSegments, activeTab, searchQuery]);

  const archivedCount = useMemo(
    () => allSegments.filter((s) => s.archived).length,
    [allSegments]
  );

  // Push segments catalog context into chat
  const { setEntity } = useChatPanel();
  useEffect(() => {
    if (allSegments.length > 0) {
      setEntity({
        id: "segments-list",
        name: "Segments",
        type: "segments-list",
        summary: `${allSegments.length} segments`,
        contextPayload: {
          segments: allSegments.map((s) => ({
            name: s.name,
            userCount: s.userCount,
            sql: s.sql,
            type: s.type,
            description: s.description,
            refreshStatus: s.refreshStatus,
          })),
        },
      });
    }
  }, [allSegments, setEntity]);

  const handleGenerateAll = async () => {
    setGenerating(true);
    setGenerateResult(null);
    setGenError(null);
    try {
      const data = await apiFetch<{ generated: number; failed: number }>("/api/segments/generate-all", {
        method: "POST",
        body: { datasetId },
      });
      setGenerateResult({ generated: data.generated, failed: data.failed });
      await fetchSegments();
    } catch {
      setGenError("Generation failed. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  if (mode === "builder") {
    return (
      <FeatureGate feature="segments">
        <SegmentBuilderView
          onBack={() => setMode("list")}
          onCreated={(id) => {
            fetchSegments();
            router.push(`/segments/${id}`);
          }}
          compareSegments={allSegments
            .filter((segment) => !isBehavioralSegment(segment) && !segment.archived)
            .map((segment) => ({ id: segment.id, name: segment.name, sql: segment.sql, config: segment.config }))}
        />
      </FeatureGate>
    );
  }

  return (
    <FeatureGate feature="segments">
      <div className="flex h-full min-w-0 flex-col overflow-y-auto">
        <div className="w-full px-5 py-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">Audiences</h1>
              <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
                Build, import, and manage reusable audiences for campaigns and analysis.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-[2px]"
                onClick={() => setUploadDialogOpen(true)}
              >
                <FileUp className="size-3.5" />
                Upload CSV
              </Button>
              <Button
                type="button"
                size="sm"
                className="rounded-[2px]"
                onClick={() => setMode("builder")}
              >
                <Plus className="size-3.5" />
                New Segment
              </Button>
            </div>
          </div>

          <CsvAudienceUploadDialog
            open={uploadDialogOpen}
            onOpenChange={setUploadDialogOpen}
            datasetId={datasetId}
            onUploaded={(segment) => {
              void fetchSegments();
              void refreshSegments();
              router.push(`/segments/${segment.id}`);
            }}
          />

          {behavioralSegments.length > 0 && (
            <div className="mb-5">
              <h2 className="mb-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Behavioral segments
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {behavioralSegments.map((segment) => (
                  <BehavioralSegmentCard key={segment.id} segment={segment} />
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading segments...
            </div>
          )}

          {!loading && allSegments.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
              <UsersRound className="mb-4 size-10 text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">No segments yet</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Build a segment from event rules, upload a CSV, or generate starter segments from the dataset schema.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 rounded-[2px]"
                onClick={handleGenerateAll}
                disabled={generating}
              >
                {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {generating ? "Generating segments" : "Generate starter segments"}
              </Button>
            </div>
          )}

          {!loading && allSegments.length > 0 && (
            <DataTableFrame>
              <div
                className="flex min-h-12 items-center gap-2 border-b border-border bg-white px-3 py-2"
                role="tablist"
                aria-label="Segment status"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "active"}
                  onClick={() => setActiveTab("active")}
                  className={cn(
                    "inline-flex h-8 items-center gap-2 border border-border px-3 text-[9.9px] font-semibold uppercase tracking-[0.08em] transition-colors",
                    activeTab === "active"
                      ? "bg-neutral-100 text-foreground"
                      : "bg-white text-muted-foreground hover:bg-neutral-50 hover:text-foreground",
                  )}
                >
                  Active
                  <span className="tabular-nums text-muted-foreground">
                    {allSegments.filter((segment) => !segment.archived && !isBehavioralSegment(segment)).length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "archived"}
                  onClick={() => setActiveTab("archived")}
                  className={cn(
                    "inline-flex h-8 items-center gap-2 border border-border px-3 text-[9.9px] font-semibold uppercase tracking-[0.08em] transition-colors",
                    activeTab === "archived"
                      ? "bg-neutral-100 text-foreground"
                      : "bg-white text-muted-foreground hover:bg-neutral-50 hover:text-foreground",
                  )}
                >
                  Archived
                  <span className="tabular-nums text-muted-foreground">{archivedCount}</span>
                </button>
              </div>

              <DataTableToolbar>
                <label className="relative w-full max-w-xs">
                  <span className="sr-only">Search segments</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search segments"
                    className="h-8 rounded-[2px] bg-white pl-8 text-sm"
                  />
                </label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {filtered.length} segment{filtered.length === 1 ? "" : "s"}
                </span>
              </DataTableToolbar>

              <DataTableScroll>
                <table className={cn(dataTableClassNames.table, "min-w-[760px]")}>
                  <thead className={dataTableClassNames.head}>
                    <tr className={dataTableClassNames.headerRow}>
                      <th className={dataTableClassNames.headerCell}>Segment</th>
                      <th className={dataTableClassNames.headerCell}>Type</th>
                      <th className={cn(dataTableClassNames.headerCell, "text-right")}>Users</th>
                      <th className={dataTableClassNames.headerCell}>Creator</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-16 text-center">
                          <UsersRound className="mx-auto mb-3 size-10 text-muted-foreground" />
                          <p className="text-sm font-medium text-foreground">No segments found</p>
                          <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search or status filter.</p>
                        </td>
                      </tr>
                    ) : filtered.map((segment) => (
                      <tr
                        key={segment.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${segment.name}`}
                        onClick={() => router.push(`/segments/${segment.id}`)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            router.push(`/segments/${segment.id}`);
                          }
                        }}
                        className={cn(
                          dataTableClassNames.row,
                          "cursor-pointer outline-none focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        )}
                      >
                        <td className={dataTableClassNames.cell}>
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">{segment.name}</p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{segment.description}</p>
                            </div>
                          </div>
                        </td>
                        <td className={dataTableClassNames.cell}>
                          <Badge variant="secondary" className="rounded-[2px] px-2 py-0.5 text-[9px] font-medium">
                            {segment.type === "dynamic" ? "Dynamic" : "Static"}
                          </Badge>
                        </td>
                        <td className={cn(dataTableClassNames.numericCell, "font-medium")}>{formatCount(segment.userCount)}</td>
                        <td className={dataTableClassNames.cell}>
                          <div className="flex items-center gap-2">
                            <div className="flex size-6 items-center justify-center rounded-full bg-neutral-100 text-[9px] font-medium">
                              {segment.creator.split(" ").map((word) => word[0]).join("")}
                            </div>
                            <span className="text-xs text-muted-foreground">{segment.creator}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataTableScroll>
            </DataTableFrame>
          )}
        </div>
      </div>
    </FeatureGate>
  );
}

// ── Inline builder view ──

function SegmentBuilderView({
  onBack,
  onCreated,
  compareSegments,
}: {
  onBack: () => void;
  onCreated: (id: string) => void;
  compareSegments: { id: string; name: string; sql: string; config?: SegmentBuilderConfig }[];
}) {
  const { dataset } = useDataset();
  const eventCatalog = useMemo(() => dataset?.events ?? [], [dataset]);

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [breakdown, setBreakdown] = useState<string | undefined>();
  const [segmentIds, setSegmentIds] = useState<string[]>([]);
  const [compareSeries, setCompareSeries] = useState<Array<{
    id: string;
    name: string;
    points: SegmentPreviewPoint[];
  }>>([]);
  const builder = useSegmentBuilder(undefined, breakdown);

  const ruleSummaries = useMemo(
    () =>
      builder.config.rules.map((rule) => ({
        id: rule.id,
        ...formatRuleSummary(rule, eventCatalog),
      })),
    [builder.config.rules, eventCatalog],
  );
  const ruleNarrative = useMemo(
    () => buildSegmentSummary(builder.config, eventCatalog),
    [builder.config, eventCatalog],
  );
  const graphRows = useMemo(() => {
    const counts = new Map(builder.ruleCounts.map((rule) => [rule.ruleId, rule]));
    return ruleSummaries.map((rule) => ({
      ...rule,
      count: counts.get(rule.id)?.count ?? null,
      error: counts.get(rule.id)?.error,
    }));
  }, [builder.ruleCounts, ruleSummaries]);
  useEffect(() => {
    let cancelled = false;
    if (breakdown || segmentIds.length === 0) {
      setCompareSeries([]);
      return;
    }

    const selected = compareSegments.filter((segment) => segmentIds.includes(segment.id));
    Promise.all(
      selected.map(async (segment) => {
        const overview = await apiFetch<{ sizeOverTime: SegmentPreviewPoint[] }>(
          "/api/segments/__compare__/overview",
          {
            method: "POST",
            body: { sql: segment.sql, config: segment.config, dateRange: builder.config.dateRange },
            skipModel: true,
          },
        );
        return { id: segment.id, name: segment.name, points: overview.sizeOverTime ?? [] };
      }),
    )
      .then((series) => {
        if (!cancelled) setCompareSeries(series);
      })
      .catch(() => {
        if (!cancelled) setCompareSeries([]);
      });

    return () => {
      cancelled = true;
    };
  }, [breakdown, builder.config.dateRange, compareSegments, segmentIds]);
  const sizeChart = useMemo<ChartSpec | null>(() => {
    if (builder.sizeOverTime.length === 0) return null;

    const trendTitle = usesBucketedTrend(builder.config.dateRange)
      ? "Weekly Segment Activity"
      : "Segment Size Over Time";
    const hasBreakdown = builder.sizeOverTime.some((point) => point.breakdown);
    if (breakdown && hasBreakdown) {
      const totals = new Map<string, number>();
      for (const point of builder.sizeOverTime) {
        const key = point.breakdown ?? "(empty)";
        totals.set(key, (totals.get(key) ?? 0) + point.count);
      }
      const yKeys = Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([key]) => key);
      const periods = Array.from(new Set(builder.sizeOverTime.map((point) => point.period))).sort();
      const data = periods.map((period) => {
        const row: Record<string, string | number> = {
          period: formatDateLabel(period, periods.length),
        };
        for (const key of yKeys) row[key] = 0;
        for (const point of builder.sizeOverTime) {
          if (point.period === period && point.breakdown && yKeys.includes(point.breakdown)) {
            row[point.breakdown] = point.count;
          }
        }
        return row;
      });
      const label = eventCatalog
        .flatMap((event) => event.properties)
        .find((property) => property.column === breakdown)?.displayName ?? breakdown;
      return {
        type: "area",
        title: `${trendTitle} by ${label}`,
        data,
        xKey: "period",
        yKeys,
        yLabels: yKeys,
        yAxisLabel: "Users",
      };
    }

    if (compareSeries.length > 0) {
      const series = [
        { id: "__draft__", name: name.trim() || "Draft segment", points: builder.sizeOverTime },
        ...compareSeries,
      ];
      const periods = Array.from(new Set(series.flatMap((item) => item.points.map((point) => point.period)))).sort();
      const usedNames = new Set<string>();
      const yKeys = series.map((item) => {
        let key = item.name;
        let suffix = 2;
        while (usedNames.has(key)) {
          key = `${item.name} ${suffix}`;
          suffix += 1;
        }
        usedNames.add(key);
        return key;
      });
      const data = periods.map((period) => {
        const row: Record<string, string | number> = {
          period: formatDateLabel(period, periods.length),
        };
        series.forEach((item, index) => {
          row[yKeys[index]] = item.points.find((point) => point.period === period)?.count ?? 0;
        });
        return row;
      });
      return {
        type: "line",
        title: trendTitle,
        data,
        xKey: "period",
        yKeys,
        yLabels: yKeys,
        yAxisLabel: "Users",
      };
    }

    return {
      type: "area",
      title: trendTitle,
      data: builder.sizeOverTime.map((point) => ({
        period: formatDateLabel(point.period, builder.sizeOverTime.length),
        users: point.count,
      })),
      xKey: "period",
      yKeys: ["users"],
      yLabels: ["Users"],
      yAxisLabel: "Users",
    };
  }, [breakdown, builder.config.dateRange, builder.sizeOverTime, compareSeries, eventCatalog, name]);

  const canSave =
    name.trim().length > 0 &&
    !!builder.sql &&
    builder.count != null &&
    builder.count > 0 &&
    !builder.loading &&
    !saving;

  const handleSave = useCallback(async () => {
    if (!canSave || !builder.sql) return;
    setSaving(true);
    setSaveError(null);
    try {
      const created = await apiFetch<Segment>("/api/segments", {
        method: "POST",
        body: { name: name.trim(), sql: builder.sql, config: builder.config },
      });
      onCreated(created.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save segment");
    } finally {
      setSaving(false);
    }
  }, [canSave, builder.config, builder.sql, name, onCreated]);

  const hasRules = builder.config.rules.length > 0;
  const ruleCount = builder.config.rules.length;
  const hasPositiveRule = builder.config.rules.some(
    (rule) => rule.kind === "attribute" || (rule.kind === "event" && rule.action === "did"),
  );

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="px-8 pt-6 pb-4 border-b shrink-0">
        <div className="flex items-start justify-between gap-4 mb-1">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled segment"
              className="text-2xl font-semibold text-foreground bg-transparent border-0 outline-none w-full placeholder:text-muted-foreground/40 focus:placeholder:text-muted-foreground/20"
              autoFocus
            />
            <p className="text-sm text-muted-foreground mt-0.5">
              Build a new segment by picking events from the panel on the right.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-muted transition-colors text-muted-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        </div>

        {saveError && <p className="text-xs text-muted-foreground mt-2">{saveError}</p>}

        <div className="flex items-center gap-6 mt-3">
          <div>
            <span className="text-2xl font-bold tabular-nums">
              {builder.loading ? "--" : builder.count != null ? builder.count.toLocaleString() : "--"}
            </span>
            <span className="text-xs text-muted-foreground ml-1.5">users in segment</span>
          </div>
          <div>
            <span className="text-2xl font-bold tabular-nums">{ruleCount}</span>
            <span className="text-xs text-muted-foreground ml-1.5">rules</span>
          </div>
        </div>
        {ruleNarrative && (
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {ruleNarrative}
          </p>
        )}
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 p-6 overflow-y-auto">
          <div className="flex flex-col gap-4 flex-1 min-w-0">
            {builder.sql && !builder.loading && (
              <div className="flex items-center gap-3 text-sm">
                <button
                  onClick={() => setShowSql((value) => !value)}
                  aria-pressed={showSql}
                  className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    showSql
                      ? "bg-foreground text-background hover:bg-foreground/90"
                      : "bg-muted text-foreground hover:bg-muted/70 ring-1 ring-border"
                  }`}
                >
                  <Code className="h-3.5 w-3.5" />
                  {showSql ? "Hide SQL" : "View SQL"}
                </button>
              </div>
            )}

            {!hasRules && (
              <div className="min-h-[300px] flex items-center justify-center text-center text-muted-foreground">
                <div>
                  <p className="text-sm">Add a rule to define your audience</p>
                  <p className="text-xs mt-1">Pick events from the panel on the right.</p>
                </div>
              </div>
            )}

            {hasRules && !hasPositiveRule && (
              <div className="min-h-[300px] flex items-center justify-center text-center text-muted-foreground">
                <div>
                  <p className="text-sm">Add a positive event rule to preview this segment</p>
                  <p className="text-xs mt-1">Negative rules can refine an audience after it has a base population.</p>
                </div>
              </div>
            )}

            {hasRules && hasPositiveRule && builder.loading && (
              <div className="min-h-[300px] flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Running segment query...</span>
              </div>
            )}

            {hasRules && hasPositiveRule && builder.error && !builder.loading && (
              <div className="min-h-[300px] flex items-center justify-center text-center max-w-md px-4 mx-auto">
                <p className="text-sm text-muted-foreground">{builder.error}</p>
              </div>
            )}

            {hasRules && hasPositiveRule && !builder.loading && !builder.error && showSql && builder.sql && (
              <div className="min-h-[300px] max-h-[500px] overflow-auto rounded-lg border bg-muted/40 p-4 text-[9.9px] font-mono leading-relaxed">
                <SqlHighlighted sql={builder.sql} />
              </div>
            )}

            {hasRules && hasPositiveRule && !builder.loading && !builder.error && !showSql && builder.sql && (
              <div className="space-y-4">
                {sizeChart ? (
                  <UnifiedChart spec={sizeChart} variant="normal" height={360} />
                ) : (
                  <div className="h-48 flex items-center justify-center border rounded-lg text-sm text-muted-foreground">
                    No size-over-time data available
                  </div>
                )}

                {(builder.vsAllUsers.length > 0 || builder.vsPreviousPeriod.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {builder.vsAllUsers.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-foreground mb-2">vs All Users</h3>
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full bg-white text-xs">
                            <thead>
                              <tr className="border-b bg-neutral-50">
                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Metric</th>
                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Segment</th>
                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">All</th>
                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Diff</th>
                              </tr>
                            </thead>
                            <tbody>
                              {builder.vsAllUsers.map((row) => (
                                <tr key={row.metric} className="border-b bg-white last:border-0 hover:bg-neutral-50/80">
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

                    {builder.vsPreviousPeriod.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-foreground mb-2">Trend Over Time</h3>
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full bg-white text-xs">
                            <thead>
                              <tr className="border-b bg-neutral-50">
                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Metric</th>
                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Now</th>
                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">30d</th>
                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">60d</th>
                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">90d</th>
                              </tr>
                            </thead>
                            <tbody>
                              {builder.vsPreviousPeriod.map((row) => (
                                <tr key={row.metric} className="border-b bg-white last:border-0 hover:bg-neutral-50/80">
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
                )}

                <div className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between border-b bg-neutral-50 px-4 py-3">
                    <h3 className="text-sm font-semibold text-foreground">Rule Breakdown</h3>
                    <span className="text-xs text-muted-foreground">
                      {builder.config.combinator === "AND" ? "All rules" : "Any rule"}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-separate border-spacing-0 bg-white text-sm">
                      <thead>
                        <tr className="bg-neutral-50">
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground border-b border-border">
                            Rule
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground border-b border-border">
                            Criteria
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground border-b border-border">
                            Users
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {graphRows.map((rule, index) => (
                          <tr key={rule.id} className="bg-white transition-colors hover:bg-neutral-50/80">
                            <td className="px-4 py-3 font-medium text-foreground border-b border-border/40">
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9.9px] font-bold text-muted-foreground tabular-nums mr-2">
                                {index + 1}
                              </span>
                              {rule.title}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground border-b border-border/40">
                              {rule.detail || "No additional criteria"}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-foreground border-b border-border/40">
                              {rule.count == null ? "--" : rule.count.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {builder.warnings.length > 0 && !builder.loading && (
              <div className="rounded-md border bg-muted/30 px-4 py-3">
                <p className="text-xs font-medium text-foreground mb-1">Warnings</p>
                <ul className="space-y-1">
                  {builder.warnings.map((warning) => (
                    <li key={warning} className="text-xs text-muted-foreground">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <SegmentConfigPanel
          config={builder.config}
          catalog={eventCatalog}
          onAddRule={builder.addRule}
          onUpdateRule={builder.updateRule}
          onRemoveRule={builder.removeRule}
          onCombinatorChange={builder.setCombinator}
          onDateRangeChange={builder.setDateRange}
          breakdown={breakdown}
          onBreakdownChange={(nextBreakdown) => {
            setBreakdown(nextBreakdown);
            if (nextBreakdown) setSegmentIds([]);
          }}
          segmentIds={segmentIds}
          segments={compareSegments}
          onSegmentIdsChange={(ids) => {
            setSegmentIds(ids);
            if (ids.length > 0) setBreakdown(undefined);
          }}
        />
      </div>
    </div>
  );
}
