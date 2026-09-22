"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Loader2, Save, Sparkles } from "lucide-react";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { FeatureGate } from "@/components/feature-gate";
import { RetentionsIcon } from "@/components/nav-icons";
import { useSidebarContext } from "@/components/sidebar-context";
import { RetentionConfigPanel } from "@/components/explorer/retention-config-panel";
import { RetentionChart } from "@/components/explorer/retention-chart";
import { useRetention } from "@/hooks/use-retention";
import type { SavedRetention } from "@/lib/retention-types";
import { RETENTION_MODE_LABELS } from "@/lib/retention-types";

function formatD7(rate: number | null): string {
  if (rate === null || rate === undefined) return "--";
  return `${rate}%`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── List view ──

function RetentionListView({
  retentions,
  loading,
  hasEvents,
  onNew,
  onRefresh,
}: {
  retentions: SavedRetention[];
  loading: boolean;
  hasEvents: boolean;
  onNew: () => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const { datasetId } = useDataset();
  const [searchQuery, setSearchQuery] = useState("");
  const [generating, setGenerating] = useState(false);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      await apiFetch("/api/retentions/generate-starters", {
        method: "POST",
        body: { datasetId },
      });
      onRefresh();
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  }, [datasetId, onRefresh]);

  const filtered = retentions.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-8 pb-6">
        <h1 className="text-xl font-semibold text-foreground">Retentions</h1>
        <button
          onClick={onNew}
          disabled={!hasEvents}
          className="flex items-center gap-2 px-3.5 py-2 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          New Retention
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-6 pb-8 w-full">
      {/* Events guard */}
      {!hasEvents && !loading && (
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
          <RetentionsIcon className="size-10 text-muted-foreground/50 mb-4" />
          <p className="text-sm text-muted-foreground max-w-sm">
            No events detected for this dataset. Events are required to build retention analyses.
          </p>
        </div>
      )}

      {/* Search */}
      {retentions.length > 0 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search Retentions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {/* Loading */}
      {(loading || generating) && (
        <div className="flex items-center justify-center py-20 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          {generating && (
            <span className="text-sm text-muted-foreground">Generating starter retentions...</span>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !generating && retentions.length === 0 && hasEvents && (
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
          <RetentionsIcon className="size-10 text-muted-foreground/50 mb-4" />
          <h2 className="text-base font-medium text-foreground mb-1">No retention analyses yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">
            Create your first retention analysis to measure how users come back over time.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 active:scale-[0.98] transition-[background-color,transform] disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            Generate Starter Retentions
          </button>
        </div>
      )}

      {/* Retention table */}
      {!loading && filtered.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Mode</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">D7 Retention</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((retention) => (
                <tr
                  key={retention.id}
                  onClick={() => router.push(`/retentions/${retention.id}`)}
                  className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{retention.name}</div>
                    {retention.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">
                        {retention.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {RETENTION_MODE_LABELS[retention.config.mode]}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">
                      {formatD7(retention.d7Retention)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(retention.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* No search results */}
      {!loading && retentions.length > 0 && filtered.length === 0 && searchQuery && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No retentions matching &ldquo;{searchQuery}&rdquo;
        </p>
      )}
      </div>
    </div>
  );
}

// ── Builder view (inline, same layout as explorer retention tab) ──

function RetentionBuilderView({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const { dataset } = useDataset();
  const eventCatalog = useMemo(() => dataset?.events ?? [], [dataset]);
  const retention = useRetention();

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !!retention.config.startEventId && retention.config.returnEventIds.length > 0 && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch<{ id: string }>("/api/retentions", {
        method: "POST",
        body: { name: name.trim(), config: retention.config },
      });
      onCreated(res.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save retention");
    } finally {
      setSaving(false);
    }
  }, [canSave, name, retention.config, onCreated]);

  const d7 = retention.result?.overall?.[7];

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* ── Header (matches RetentionWorkspace layout) ── */}
      <div className="px-8 pt-6 pb-4 border-b shrink-0">
        <div className="flex items-start justify-between gap-4 mb-1">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled retention"
              className="text-2xl font-semibold text-foreground bg-transparent border-0 outline-none w-full placeholder:text-muted-foreground/40 focus:placeholder:text-muted-foreground/20"
              autoFocus
            />
            <p className="text-sm text-muted-foreground mt-0.5">
              Pick a starting event and a return event to build your retention analysis.
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

        {saveError && (
          <p className="text-xs text-muted-foreground mt-2">{saveError}</p>
        )}

        {/* KPI strip */}
        <div className="flex items-center gap-6 mt-3">
          <div>
            <span className="text-2xl font-bold tabular-nums">
              {d7 != null ? `${d7}%` : "--"}
            </span>
            <span className="text-xs text-muted-foreground ml-1.5">D7 retention</span>
          </div>
          <div>
            <span className="text-2xl font-bold tabular-nums capitalize">{retention.config.granularity}</span>
            <span className="text-xs text-muted-foreground ml-1.5">cohorts</span>
          </div>
        </div>
      </div>

      {/* ── Body: chart on left, config panel on right ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 p-6 overflow-y-auto">
          <RetentionChart
            config={retention.config}
            result={retention.result}
            loading={retention.loading}
            error={retention.error}
            onDatePresetChange={retention.setDatePreset}
          />
        </div>
        <RetentionConfigPanel
          config={retention.config}
          catalog={eventCatalog}
          onStartEventChange={retention.setStartEvent}
          onAddReturnEvent={retention.addReturnEvent}
          onSetReturnEvent={retention.setReturnEvent}
          onRemoveReturnEvent={retention.removeReturnEvent}
          onModeChange={retention.setMode}
          onGranularityChange={retention.setGranularity}
          onBreakdownChange={retention.setBreakdown}
          onStartFiltersChange={(filters) => retention.updateConfig((c) => ({ ...c, startFilters: filters }))}
          onReturnFiltersChange={(filters) => retention.updateConfig((c) => ({ ...c, returnFilters: filters }))}
        />
      </div>
    </div>
  );
}

// ── Page ──

export default function RetentionsPage() {
  const router = useRouter();
  const { datasetId, dataset } = useDataset();
  const { refreshRetentions: refreshSidebarRetentions } = useSidebarContext();
  const [retentions, setRetentions] = useState<SavedRetention[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "builder">("list");

  const fetchRetentions = useCallback(async () => {
    try {
      const data = await apiFetch<SavedRetention[]>("/api/retentions");
      setRetentions(data);
    } finally {
      setLoading(false);
    }
  }, [datasetId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchRetentions();
  }, [fetchRetentions]);

  const hasEvents = !!(dataset?.events && dataset.events.length > 0);

  const handleCreated = useCallback((id: string) => {
    fetchRetentions();
    refreshSidebarRetentions();
    router.push(`/retentions/${id}`);
  }, [fetchRetentions, refreshSidebarRetentions, router]);

  return (
    <FeatureGate feature="retentions">
      <div className="flex flex-col h-full min-w-0">
        {mode === "list" ? (
          <RetentionListView
            retentions={retentions}
            loading={loading}
            hasEvents={hasEvents}
            onNew={() => setMode("builder")}
            onRefresh={fetchRetentions}
          />
        ) : (
          <RetentionBuilderView
            onBack={() => setMode("list")}
            onCreated={handleCreated}
          />
        )}
      </div>
    </FeatureGate>
  );
}
