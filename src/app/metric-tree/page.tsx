"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { getMetric, updateMetric, saveMetrics } from "@/lib/metric-store";
import { useDataset } from "@/lib/dataset-context";
import type { Metric } from "@/lib/metric-types";
import { apiFetch } from "@/lib/api-client";
import { Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { MetricTreeCanvas } from "@/components/metric-tree/metric-tree-canvas";
import { MetricTreeContextPanel } from "@/components/metric-tree/metric-tree-context-panel";
import { MetricTreeToolbar } from "@/components/metric-tree/metric-tree-toolbar";
import { CreateMetricModal } from "@/components/metric/create-metric-modal";
import { MetricEditModal } from "@/components/metric/metric-edit-modal";
import { FeatureGate } from "@/components/feature-gate";
import { MetricTreeIcon } from "@/components/nav-icons";

export default function MetricTreePage() {
  const { datasetId } = useDataset();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editMetricId, setEditMetricId] = useState<string | null>(null);
  const [allMetrics, setAllMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [inferring, setInferring] = useState(false);
  const [hasDefinitions, setHasDefinitions] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [rootMetricId, setRootMetricId] = useState<string | null>(null);
  const inferringRef = useRef(false);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ metrics: Metric[]; hasDefinitions?: boolean; needsRelationships?: boolean; dbError?: string; rootMetricId?: string }>(
        `/api/metrics?datasetId=${encodeURIComponent(datasetId)}`
      );
      const fetched = data.metrics || [];
      setAllMetrics(fetched);
      setHasDefinitions(data.hasDefinitions !== false);
      setDbError(data.dbError ?? null);
      setRootMetricId(data.rootMetricId ?? null);
      saveMetrics(datasetId, fetched);

      // Lazy backfill: if metrics exist but have no relationships, trigger inference
      if (data.needsRelationships && !inferringRef.current) {
        inferringRef.current = true;
        setInferring(true);
        apiFetch("/api/metrics/infer-relationships", {
          method: "POST",
          body: { datasetId },
        })
          .then(async () => {
            // Re-fetch to get the enriched metrics
            const refreshed = await apiFetch<{ metrics: Metric[] }>(
              `/api/metrics?datasetId=${encodeURIComponent(datasetId)}`
            );
            setAllMetrics(refreshed.metrics || []);
            saveMetrics(datasetId, refreshed.metrics || []);
          })
          .catch(() => {
            // Inference failed — tree stays flat, no crash
          })
          .finally(() => {
            inferringRef.current = false;
            setInferring(false);
          });
      }
    } catch {
      setAllMetrics([]);
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Reset filter state on dataset switch
  useEffect(() => {
    setActiveCategory("All");
    setSearchQuery("");
    setSelectedMetricId(null);
  }, [datasetId]);

  // Derive unique categories from data
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const m of allMetrics) {
      if (m.category) cats.add(m.category);
    }
    return [...cats].sort();
  }, [allMetrics]);

  const filteredMetrics = useMemo(() => {
    let list = allMetrics;
    if (activeCategory !== "All") {
      list = list.filter((m) => m.category === activeCategory);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allMetrics, activeCategory, searchQuery]);

  // Root metric: LLM-provided root, or fallback to metric with most incoming edges
  const rootMetric = useMemo(() => {
    if (allMetrics.length === 0) return null;

    // Use LLM-provided root if available and valid
    if (rootMetricId) {
      const found = allMetrics.find((m) => m.id === rootMetricId);
      if (found) return found;
    }

    // Fallback: the metric that the most other metrics "drive" into
    // (i.e. the most popular target of drives relationships = likely the root)
    const incomingCount = new Map<string, number>();
    for (const m of allMetrics) {
      for (const r of m.relationships) {
        if (r.direction === "drives") {
          incomingCount.set(r.metricId, (incomingCount.get(r.metricId) ?? 0) + 1);
        }
      }
    }

    if (incomingCount.size > 0) {
      let bestId = "";
      let bestCount = -1;
      for (const [id, count] of incomingCount) {
        if (count > bestCount) {
          bestCount = count;
          bestId = id;
        }
      }
      const found = allMetrics.find((m) => m.id === bestId);
      if (found) return found;
    }

    return allMetrics[0];
  }, [allMetrics, rootMetricId]);

  const handleRefresh = useCallback(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      await apiFetch("/api/metrics/generate", {
        method: "POST",
        body: { datasetId },
      });
      await fetchMetrics();
    } finally {
      setRegenerating(false);
    }
  }, [datasetId, fetchMetrics]);

  const editingMetric = editMetricId ? getMetric(datasetId, editMetricId) : undefined;

  return (
    <FeatureGate feature="metric-tree">
    <div className="flex flex-col h-full min-w-0">
      <MetricTreeToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        categories={categories}
        onNewMetric={() => setShowCreate(true)}
        onRefresh={handleRefresh}
        onRegenerate={handleRegenerate}
        regenerating={regenerating}
      />

      {/* Inferring banner */}
      {inferring && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-border bg-muted/30">
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Analyzing metric relationships…</span>
        </div>
      )}

      {/* DB error banner — systemic failure affecting all metrics */}
      {dbError && !loading && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-border bg-muted/30">
          <AlertTriangle className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground flex-1">{dbError}</span>
          <button
            onClick={handleRefresh}
            className="text-xs font-medium text-foreground hover:underline shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Canvas */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin mr-2" />
            <span className="text-sm">Loading metrics…</span>
          </div>
        ) : allMetrics.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center max-w-xs">
              <MetricTreeIcon className="size-10 text-muted-foreground/40 mx-auto mb-3" />
              <h3 className="text-sm font-semibold mb-1">
                {hasDefinitions ? "No metrics found" : "No metrics yet"}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                {hasDefinitions
                  ? "Your metrics file is empty. Try regenerating."
                  : "Generate metrics from your dataset schema to build the metric tree."}
              </p>
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                <Sparkles className={`size-3.5 ${regenerating ? "animate-pulse" : ""}`} />
                {regenerating ? "Generating…" : "Generate Metrics"}
              </button>
            </div>
          </div>
        ) : (
          <MetricTreeCanvas
            metrics={filteredMetrics}
            selectedMetricId={selectedMetricId}
            onSelectMetric={setSelectedMetricId}
            rootMetricId={rootMetricId}
          />
        )}

        {/* Context Panel */}
        <div className="w-[320px] shrink-0 border-l border-border bg-background overflow-hidden">
          <MetricTreeContextPanel
            metrics={allMetrics}
            selectedMetricId={selectedMetricId}
            rootMetric={rootMetric}
            onDeselect={() => setSelectedMetricId(null)}
            onEditMetric={(id) => setEditMetricId(id)}
          />
        </div>
      </div>

      {showCreate && (
        <CreateMetricModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchMetrics();
          }}
        />
      )}

      {editingMetric && (
        <MetricEditModal
          metric={editingMetric}
          onClose={() => setEditMetricId(null)}
          onSave={(updates) => {
            updateMetric(datasetId, editingMetric.id, updates);
            setEditMetricId(null);
            fetchMetrics();
          }}
        />
      )}
    </div>
    </FeatureGate>
  );
}
