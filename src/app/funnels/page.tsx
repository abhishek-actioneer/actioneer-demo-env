"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Loader2, Save, Sparkles } from "lucide-react";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { FeatureGate } from "@/components/feature-gate";
import { FunnelsIcon } from "@/components/nav-icons";
import { useSidebarContext } from "@/components/sidebar-context";
import { FunnelConfigPanel } from "@/components/explorer/funnel-config-panel";
import { FunnelChart } from "@/components/explorer/funnel-chart";
import { useFunnel } from "@/hooks/use-funnel";
import type { SavedFunnel } from "@/lib/funnel-types";
import { CONVERSION_WINDOW_LABELS } from "@/lib/funnel-types";

function formatConversion(rate: number | null): string {
  if (rate === null || rate === undefined) return "--";
  return `${rate}%`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── List view ──

function FunnelListView({
  funnels,
  loading,
  hasEvents,
  onNew,
  onRefresh,
}: {
  funnels: SavedFunnel[];
  loading: boolean;
  hasEvents: boolean;
  onNew: () => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const { datasetId, dataset } = useDataset();
  const [searchQuery, setSearchQuery] = useState("");
  const [generating, setGenerating] = useState(false);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      await apiFetch("/api/funnels/generate-starters", {
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


  const filtered = funnels.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-8 pb-6">
        <h1 className="text-xl font-semibold text-foreground">Funnels</h1>
        <button
          onClick={onNew}
          disabled={!hasEvents}
          className="flex items-center gap-2 px-3.5 py-2 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          New Funnel
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-6 pb-8 w-full">
      {/* Events guard */}
      {!hasEvents && !loading && (
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
          <FunnelsIcon className="size-10 text-muted-foreground/50 mb-4" />
          <p className="text-sm text-muted-foreground max-w-sm">
            No events detected for this dataset. Events are required to build funnels.
          </p>
        </div>
      )}

      {/* Search */}
      {funnels.length > 0 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search Funnels..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !generating && funnels.length === 0 && hasEvents && (
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
          <FunnelsIcon className="size-10 text-muted-foreground/50 mb-4" />
          <h2 className="text-base font-medium text-foreground mb-1">No funnels yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">
            Create your first funnel to track how users move through key flows.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 active:scale-[0.98] transition-[background-color,transform] disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            Generate Starter Funnels
          </button>
        </div>
      )}

      {/* Generating state */}
      {generating && (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Generating starter funnels...
        </div>
      )}

      {/* Funnel table */}
      {!loading && filtered.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Steps</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Conversion</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Window</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((funnel) => (
                <tr
                  key={funnel.id}
                  onClick={() => router.push(`/funnels/${funnel.id}`)}
                  className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{funnel.name}</div>
                    {funnel.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">
                        {funnel.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {funnel.config.steps.length} steps
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">
                      {formatConversion(funnel.overallConversion)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {CONVERSION_WINDOW_LABELS[funnel.config.conversionWindow]}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(funnel.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* No search results */}
      {!loading && funnels.length > 0 && filtered.length === 0 && searchQuery && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No funnels matching &ldquo;{searchQuery}&rdquo;
        </p>
      )}
      </div>
    </div>
  );
}

// ── Builder view (inline, same layout as explorer funnel tab) ──

function FunnelBuilderView({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const { dataset } = useDataset();
  const eventCatalog = useMemo(() => dataset?.events ?? [], [dataset]);
  const funnel = useFunnel();

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && funnel.config.steps.length >= 2 && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch<{ id: string }>("/api/funnels", {
        method: "POST",
        body: { name: name.trim(), config: funnel.config },
      });
      onCreated(res.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save funnel");
    } finally {
      setSaving(false);
    }
  }, [canSave, name, funnel.config, onCreated]);

  const overallConversion = funnel.result?.overallConversionRate ?? null;
  const stepCount = funnel.config.steps.length;

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* ── Header (matches FunnelWorkspace layout) ── */}
      <div className="px-8 pt-6 pb-4 border-b shrink-0">
        <div className="flex items-start justify-between gap-4 mb-1">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled funnel"
              className="text-2xl font-semibold text-foreground bg-transparent border-0 outline-none w-full placeholder:text-muted-foreground/40 focus:placeholder:text-muted-foreground/20"
              autoFocus
            />
            <p className="text-sm text-muted-foreground mt-0.5">
              Pick the events that make up your funnel to build it.
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
              {overallConversion != null ? `${overallConversion.toFixed(1)}%` : "--"}
            </span>
            <span className="text-xs text-muted-foreground ml-1.5">overall conversion</span>
          </div>
          <div>
            <span className="text-2xl font-bold tabular-nums">{stepCount}</span>
            <span className="text-xs text-muted-foreground ml-1.5">steps</span>
          </div>
        </div>
      </div>

      {/* ── Body: chart on left, config panel on right ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 p-6 overflow-y-auto">
          <FunnelChart
            config={funnel.config}
            result={funnel.result}
            loading={funnel.loading}
            error={funnel.error}
            onDatePresetChange={funnel.setDatePreset}
          />
        </div>
        <FunnelConfigPanel
          steps={funnel.config.steps}
          catalog={eventCatalog}
          conversionWindow={funnel.config.conversionWindow}
          order={funnel.config.order}
          breakdown={funnel.config.breakdown}
          onAddStep={funnel.addStep}
          onRemoveStep={funnel.removeStep}
          onUpdateStep={funnel.updateStep}
          onConversionWindowChange={funnel.setConversionWindow}
          onOrderChange={funnel.setOrder}
          onBreakdownChange={funnel.setBreakdown}
          countingMethod={funnel.config.countingMethod}
          onCountingMethodChange={(m) => funnel.updateConfig((c) => ({ ...c, countingMethod: m }))}
        />
      </div>
    </div>
  );
}

// ── Page ──

export default function FunnelsPage() {
  const router = useRouter();
  const { datasetId, dataset } = useDataset();
  const { refreshFunnels: refreshSidebarFunnels } = useSidebarContext();
  const [funnels, setFunnels] = useState<SavedFunnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "builder">("list");

  const fetchFunnels = useCallback(async () => {
    try {
      const data = await apiFetch<SavedFunnel[]>("/api/funnels");
      setFunnels(data);
    } finally {
      setLoading(false);
    }
  }, [datasetId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchFunnels();
  }, [fetchFunnels]);

  const hasEvents = !!(dataset?.events && dataset.events.length > 0);

  const handleCreated = useCallback((id: string) => {
    fetchFunnels();
    refreshSidebarFunnels();
    router.push(`/funnels/${id}`);
  }, [fetchFunnels, refreshSidebarFunnels, router]);

  return (
    <FeatureGate feature="funnels">
      <div className="flex flex-col h-full min-w-0">
        {mode === "list" ? (
          <FunnelListView
            funnels={funnels}
            loading={loading}
            hasEvents={hasEvents}
            onNew={() => setMode("builder")}
            onRefresh={() => { fetchFunnels(); refreshSidebarFunnels(); }}
          />
        ) : (
          <FunnelBuilderView
            onBack={() => setMode("list")}
            onCreated={handleCreated}
          />
        )}
      </div>
    </FeatureGate>
  );
}
