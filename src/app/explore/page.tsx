"use client";

import { useExplorer } from "@/hooks/use-explorer";
import { useFunnel } from "@/hooks/use-funnel";
import { useRetention } from "@/hooks/use-retention";
import { ExplorerConfigPanel } from "@/components/explorer/explorer-config-panel";
import { ExplorerChart } from "@/components/explorer/explorer-chart";
import { FunnelConfigPanel } from "@/components/explorer/funnel-config-panel";
import { FunnelChart } from "@/components/explorer/funnel-chart";
import { RetentionConfigPanel } from "@/components/explorer/retention-config-panel";
import { RetentionChart } from "@/components/explorer/retention-chart";
import { useDataset } from "@/lib/dataset-context";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { Activity, TrendingUp, GitMerge, RotateCcw, Save, ChevronDown, Trash2 } from "lucide-react";
import { searchParamsToConfig, configToSearchParams } from "@/lib/explorer-url";
import { getSavedCharts, saveChart, deleteSavedChart, type SavedChart } from "@/lib/saved-chart-store";
import { setExplorerConfig } from "@/lib/explorer-store";
import { FeatureGate } from "@/components/feature-gate";

type ExploreTab = "trends" | "funnel" | "retention";

interface SegmentInfo {
  id: string;
  name: string;
}

export default function ExplorePage() {
  const { datasetId, dataset } = useDataset();
  const { setEntity } = useChatPanel();
  const [segments, setSegments] = useState<SegmentInfo[]>([]);
  const [chartName, setChartName] = useState("");
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [activeChartId, setActiveChartId] = useState<string | null>(null);
  const savedRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initializedFromUrl = useRef(false);

  // Tab state
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<ExploreTab>(
    tabParam === "funnel" ? "funnel" : "trends",
  );

  const eventCatalog = useMemo(() => dataset?.events ?? [], [dataset]);

  // Parse initial config from URL on mount
  const initialConfig = useMemo(() => {
    if (initializedFromUrl.current) return undefined;
    const fromUrl = searchParamsToConfig(searchParams);
    if (fromUrl) {
      initializedFromUrl.current = true;
      return fromUrl;
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trends hook
  const trends = useExplorer(initialConfig);

  // Funnel hook
  const funnel = useFunnel();

  // Retention hook
  const retention = useRetention();

  // Saved charts
  const refreshSavedCharts = useCallback(() => setSavedCharts(getSavedCharts(datasetId)), [datasetId]);
  useEffect(() => { refreshSavedCharts(); }, [refreshSavedCharts]);

  const handleSaveChart = () => {
    const name = chartName.trim() || `Chart ${new Date().toLocaleDateString()}`;
    const id = activeChartId ?? crypto.randomUUID();
    saveChart({
      id,
      name,
      datasetId,
      config: trends.config,
      createdAt: activeChartId ? (savedCharts.find((c) => c.id === id)?.createdAt ?? new Date().toISOString()) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setActiveChartId(id);
    setChartName(name);
    refreshSavedCharts();
  };

  const handleLoadChart = (chart: SavedChart) => {
    setExplorerConfig(chart.config);
    trends.updateConfig(() => chart.config);
    setChartName(chart.name);
    setActiveChartId(chart.id);
    setShowSaved(false);
    setActiveTab("trends");
  };

  const handleDeleteChart = (id: string) => {
    deleteSavedChart(id);
    if (activeChartId === id) setActiveChartId(null);
    refreshSavedCharts();
  };

  // Close saved dropdown on outside click
  useEffect(() => {
    if (!showSaved) return;
    const handler = (e: MouseEvent) => {
      if (savedRef.current && !savedRef.current.contains(e.target as Node)) setShowSaved(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSaved]);

  // Sync trends config to URL
  const urlSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (activeTab !== "trends") return;
    if (urlSyncRef.current) clearTimeout(urlSyncRef.current);
    urlSyncRef.current = setTimeout(() => {
      const params = configToSearchParams(trends.config);
      params.set("tab", "trends");
      router.replace(`/explore?${params.toString()}`, { scroll: false });
    }, 500);
    return () => { if (urlSyncRef.current) clearTimeout(urlSyncRef.current); };
  }, [trends.config, router, activeTab]);

  // Sync tab to URL
  const handleTabChange = (tab: ExploreTab) => {
    setActiveTab(tab);
    if (tab === "funnel") {
      router.replace("/explore?tab=funnel", { scroll: false });
    }
  };

  // Load segments
  useEffect(() => {
    apiFetch<SegmentInfo[]>("/api/segments", { skipModel: true })
      .then(setSegments)
      .catch(() => {});
  }, []);

  // Entity context
  useEffect(() => {
    setEntity({
      id: "explorer",
      type: "explore",
      name: "Analytics Explorer",
      summary: "Visual analytics query builder",
    });
    return () => setEntity(undefined);
  }, [setEntity]);

  return (
    <FeatureGate feature="explorer">
    <div className="flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b">
        <Activity className="h-5 w-5 text-muted-foreground" />
        <input
          type="text"
          value={chartName}
          onChange={(e) => setChartName(e.target.value)}
          placeholder="Untitled Chart"
          className="text-lg font-semibold bg-transparent border-0 outline-none focus:ring-0 placeholder:text-muted-foreground/40 min-w-0 flex-1"
        />
        <div className="relative" ref={savedRef}>
          <button
            onClick={() => { refreshSavedCharts(); setShowSaved(!showSaved); }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border hover:bg-muted transition-colors"
          >
            Saved
            <ChevronDown className="h-3 w-3" />
          </button>
          {showSaved && (
            <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto">
              {savedCharts.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground text-center">No saved charts</p>
              ) : (
                savedCharts.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted transition-colors group/saved">
                    <button onClick={() => handleLoadChart(c)} className="flex-1 text-left text-sm truncate">
                      {c.name}
                    </button>
                    <button
                      onClick={() => handleDeleteChart(c.id)}
                      className="opacity-0 group-hover/saved:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button
          onClick={handleSaveChart}
          disabled={
            (activeTab === "trends" && !trends.config.events.length) ||
            (activeTab === "funnel" && funnel.config.steps.length < 2) ||
            (activeTab === "retention" && (!retention.config.startEventId || !retention.config.returnEventIds.length))
          }
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-30"
        >
          <Save className="h-3 w-3" />
          Save
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0 px-6 border-b">
        <TabButton active={activeTab === "trends"} onClick={() => handleTabChange("trends")}>
          <TrendingUp className="h-3.5 w-3.5" />
          Trends
        </TabButton>
        <TabButton active={activeTab === "funnel"} onClick={() => handleTabChange("funnel")}>
          <GitMerge className="h-3.5 w-3.5" />
          Funnel
        </TabButton>
        <TabButton active={activeTab === "retention"} onClick={() => handleTabChange("retention")}>
          <RotateCcw className="h-3.5 w-3.5" />
          Retention
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {activeTab === "trends" ? (
          <>
            <ExplorerConfigPanel
              events={trends.config.events}
              catalog={eventCatalog}
              breakdown={trends.config.breakdown}
              segmentIds={trends.config.segmentIds ?? []}
              segments={segments}
              onAddEvent={trends.addEvent}
              onRemoveEvent={trends.removeEvent}
              onUpdateEvent={trends.updateEvent}
              onBreakdownChange={trends.setBreakdown}
              onSegmentIdsChange={trends.setSegmentIds}
              segmentCompare={trends.config.segmentCompare}
              onSegmentCompareChange={(compare) =>
                trends.updateConfig((c) => ({ ...c, segmentCompare: compare }))
              }
            />
            <div className="flex-1 min-w-0 p-6 overflow-y-auto">
              <ExplorerChart
                config={trends.config}
                result={trends.result}
                loading={trends.loading}
                error={trends.error}
                onChartTypeChange={trends.setChartType}
                onGranularityChange={trends.setGranularity}
                onDatePresetChange={trends.setDatePreset}
                onCustomDateRange={(start, end) => trends.setDateRange({ start, end })}
              />
            </div>
          </>
        ) : activeTab === "funnel" ? (
          <>
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
              segmentIds={funnel.config.segmentIds ?? []}
              segments={segments}
              onSegmentIdsChange={(ids) => funnel.updateConfig((c) => ({ ...c, segmentIds: ids }))}
              segmentCompare={funnel.config.segmentCompare}
              onSegmentCompareChange={(compare) => funnel.updateConfig((c) => ({ ...c, segmentCompare: compare }))}
            />
            <div className="flex-1 min-w-0 p-6 overflow-y-auto">
              <FunnelChart
                config={funnel.config}
                result={funnel.result}
                loading={funnel.loading}
                error={funnel.error}
                onDatePresetChange={funnel.setDatePreset}
              />
            </div>
          </>
        ) : activeTab === "retention" ? (
          <>
            <RetentionConfigPanel
              config={retention.config}
              catalog={eventCatalog}
              segments={segments}
              onStartEventChange={retention.setStartEvent}
              onAddReturnEvent={retention.addReturnEvent}
              onSetReturnEvent={retention.setReturnEvent}
              onRemoveReturnEvent={retention.removeReturnEvent}
              onModeChange={retention.setMode}
              onGranularityChange={retention.setGranularity}
              onBreakdownChange={retention.setBreakdown}
              onStartFiltersChange={(f) => retention.updateConfig((c) => ({ ...c, startFilters: f }))}
              onReturnFiltersChange={(f) => retention.updateConfig((c) => ({ ...c, returnFilters: f }))}
              onSegmentIdsChange={(ids) => retention.updateConfig((c) => ({ ...c, segmentIds: ids }))}
              onSegmentCompareChange={(compare) => retention.updateConfig((c) => ({ ...c, segmentCompare: compare }))}
            />
            <div className="flex-1 min-w-0 p-6 overflow-y-auto">
              <RetentionChart
                config={retention.config}
                result={retention.result}
                loading={retention.loading}
                error={retention.error}
                onDatePresetChange={retention.setDatePreset}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
    </FeatureGate>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
      )}
    </button>
  );
}
