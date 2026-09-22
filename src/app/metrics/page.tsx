"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Database, Sparkles, Loader2, BarChart3 } from "lucide-react";
import { useScrollRestore } from "@/lib/use-scroll-restore";
import { CreateMetricModal } from "@/components/metric/create-metric-modal";
import { formatValue } from "@/lib/format-utils";
import { deltaColorClass } from "@/lib/delta-colors";
import { useDataset } from "@/lib/dataset-context";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { apiFetch } from "@/lib/api-client";
import type { Metric } from "@/lib/metric-types";
import { saveMetrics, getAllMetrics } from "@/lib/metric-store";
import { hasPendingUpdate, getAllPendingUpdates, subscribe as subscribePendingUpdates } from "@/lib/metric-update-store";
import { FeatureGate } from "@/components/feature-gate";

export default function MetricsPage() {
  const router = useRouter();
  const { datasetId } = useDataset();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [showCreate, setShowCreate] = useState(false);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [pendingCount, setPendingCount] = useState(() => getAllPendingUpdates().length);
  const [hasDefinitions, setHasDefinitions] = useState(true);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const scrollRef = useScrollRestore<HTMLElement>();

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ metrics: Metric[]; hasDefinitions?: boolean }>(
        `/api/metrics?datasetId=${encodeURIComponent(datasetId)}`
      );
      const fetched = data.metrics || [];
      saveMetrics(datasetId, fetched);
      // Merge server metrics with any client-created metrics not yet on the server
      setMetrics(getAllMetrics(datasetId));
      setHasDefinitions(data.hasDefinitions !== false);
    } catch {
      setMetrics([]);
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    const unsub = subscribePendingUpdates(() => {
      setPendingCount(getAllPendingUpdates().length);
      // Refresh metrics list to pick up any newly saved client-side metrics
      setMetrics(getAllMetrics(datasetId));
    });
    return unsub;
  }, [datasetId]);

  const { setEntity } = useChatPanel();
  useEffect(() => {
    if (metrics.length > 0) {
      setEntity({
        id: "metrics-list",
        name: "Metrics",
        type: "metrics-list",
        summary: `${metrics.length} metrics`,
        contextPayload: {
          metrics: metrics.map((m) => ({
            name: m.name, value: m.value, valueFormat: m.valueFormat,
            changePercent: m.changePercent, type: m.type, category: m.category,
            description: m.description, sql: m.sql, table: m.table,
            column: m.column, aggregation: m.aggregation, formula: m.formula,
          })),
        },
      });
    }
  }, [metrics, setEntity]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      await apiFetch("/api/metrics/generate", { method: "POST", body: { datasetId } });
      await fetchMetrics();
    } catch {
      setGenError("Generation failed. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const categories = useMemo(() => {
    const cats = new Set(metrics.map((m) => m.category));
    return ["All", ...Array.from(cats).sort()];
  }, [metrics]);

  const filtered = useMemo(() => {
    let list = metrics;
    if (activeCategory !== "All") {
      list = list.filter((m) => m.category === activeCategory);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)
      );
    }
    // Sort: pending-update metrics first, then KPIs, then others
    list = [...list].sort((a, b) => {
      const aPending = hasPendingUpdate(a.id) ? 0 : 1;
      const bPending = hasPendingUpdate(b.id) ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      const aKpi = a.type === "kpi" ? 0 : 1;
      const bKpi = b.type === "kpi" ? 0 : 1;
      return aKpi - bKpi;
    });
    return list;
  // pendingCount triggers re-sort when approvals change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, activeCategory, searchQuery, pendingCount]);

  return (
    <FeatureGate feature="metrics">
    <div className="flex flex-col h-full min-w-0">
      <main ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="w-full min-h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-8 pt-8 pb-6">
            <h1 className="text-xl font-semibold text-foreground">Metrics</h1>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => router.push("/data-catalog")}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
              >
                <Database className="w-3.5 h-3.5" />
                Data Catalog
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 active:scale-[0.98] transition-[background-color,transform]"
              >
                <Plus className="w-4 h-4" />
                New Metric
              </button>
            </div>
          </div>

          <div className="max-w-5xl mx-auto px-6 pb-8 w-full flex-1 flex flex-col">
          {/* No definitions state */}
          {!loading && !hasDefinitions && metrics.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 mb-6">
              <BarChart3 className="size-10 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium mb-1">No metrics yet</p>
                <p className="text-xs text-muted-foreground max-w-md">
                  Generate metrics from your dataset schema to create relevant KPIs, indicators, and diagnostics.
                </p>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 active:scale-[0.98] transition-[background-color,transform] disabled:opacity-50"
              >
                {generating ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Generating metrics &amp; tree...</>
                ) : (
                  <><Sparkles className="w-4 h-4" />Generate Metrics &amp; Tree</>
                )}
              </button>
              {genError && <p className="text-xs text-muted-foreground">{genError}</p>}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="bg-muted/50 border-b border-border py-2.5 px-4">
                <div className="h-3 w-24 bg-muted rounded animate-pulse" />
              </div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-3 px-4 border-b border-border last:border-0">
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-48 bg-muted rounded animate-pulse" />
                    <div className="h-2.5 w-72 bg-muted/60 rounded animate-pulse" />
                  </div>
                  <div className="h-3 w-12 bg-muted rounded animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {/* Content */}
          {!loading && metrics.length > 0 && (
            <>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Metrics..."
                  className="w-full max-w-sm pl-10 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mb-6">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      activeCategory === cat
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Metric Name
                      </th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Last 7d average
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((m, idx) => {
                      const isPending = hasPendingUpdate(m.id);
                      return (
                      <tr
                        key={m.id}
                        onClick={() => router.push(`/metrics/${m.id}${m.version === 0 ? "?creating=true" : ""}`)}
                        onMouseEnter={() => router.prefetch(`/metrics/${m.id}${m.version === 0 ? "?creating=true" : ""}`)}
                        className={`cursor-pointer transition-colors ${
                          idx < filtered.length - 1 ? "border-b border-border" : ""
                        } ${isPending ? "bg-muted hover:bg-muted/70" : "hover:bg-muted/30"}`}
                      >
                        {/* Name */}
                        <td className="py-3 px-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">{m.name}</p>
                              {isPending && (
                                <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground bg-muted">
                                  Pending review
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{m.description}</p>
                          </div>
                        </td>
                        {/* Last 7d average */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium">
                              {formatValue(m.value, m.valueFormat)}
                            </span>
                            {m.changePercent != null && (
                              <span
                                title={`${m.name} ${m.changePercent >= 0 ? "grew" : "declined"} by ${Math.abs(m.changePercent).toFixed(1)}% over the last 7 days rolling`}
                                className={`text-[9px] font-medium cursor-default ${deltaColorClass(m.changePercent)}`}
                              >
                                {m.changePercent >= 0 ? "+" : ""}
                                {m.changePercent.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                          No metrics found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          </div>
        </div>
      </main>

      {showCreate && (
        <CreateMetricModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            fetchMetrics();
            router.push(`/metrics/${id}?creating=true`);
          }}
        />
      )}
    </div>
    </FeatureGate>
  );
}
