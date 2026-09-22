"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Send, Trash2, Code, Loader2, ChevronLeft, ChevronRight, Search, Filter, X, Check, Settings, MoreHorizontal, PhoneCall, UsersRound } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CleverTapConnectDialog } from "@/components/segments/clevertap-connect-dialog";
import { UnifiedChart } from "@/components/chart/unified-chart";
import { ExplorerConfigPanel } from "@/components/explorer/explorer-config-panel";
import { ExplorerChart } from "@/components/explorer/explorer-chart";
import { PinButton } from "@/components/canvas/pin-button";
import { useExplorer } from "@/hooks/use-explorer";
import { useDataset } from "@/lib/dataset-context";
import type { SegmentDisplay } from "@/lib/types";
import type { ChartSpec } from "@/lib/chart-types";
import type { DecisionValue } from "@/lib/lifecycle-campaign-types";

// ── Types ──

interface HealthData {
  userCount: number;
  growthPct: number;
  sizeOverTime: { period: string; count: number }[];
  vsAllUsers: { metric: string; segment: number; allUsers: number; diff: string }[];
  vsPreviousPeriod: { metric: string; now: number; d30: number; d60: number; d90: number }[];
}

interface PropertyBreakdown {
  property: string;
  displayName: string;
  values: { name: string; count: number }[];
}

interface OverlapSegment {
  name: string;
  overlapCount: number;
  overlapPct: number;
}

interface UsersPage {
  columns: string[];
  rows: Record<string, unknown>[];
  totalCount: number;
  page: number;
}

interface ColumnFilter {
  column: string;
  operator: "in" | "not_in" | "gt" | "lt" | "gte" | "lte" | "between";
  values: (string | number)[];
}

type WorkspaceTab = "overview" | "composition" | "users" | "activity";

function usesBucketedTrend(segment: SegmentDisplay): boolean {
  const range = segment.config?.dateRange;
  return Boolean(range && "preset" in range && range.preset !== "all");
}

interface ActivityEntry {
  id: string;
  segmentId: string;
  type: "push" | "campaign";
  status: "success" | "error";
  destination?: "clevertap" | "firebase" | "bigquery";
  channel?: "email" | "sms" | "push" | "webpush" | "whatsapp";
  subject?: string;
  userCount?: number;
  campaignId?: number;
  dashboardUrl?: string;
  error?: string;
  createdAt: string;
}

type LifecycleState = "sent" | "running" | "completed" | "error" | "unknown";

interface CampaignRow {
  id: string;
  source?: "legacy" | "lifecycle";
  targetId?: number;
  name: string;
  channel?: string;
  subject?: string;
  status?: string;
  lifecycle: LifecycleState;
  completedAt?: string;
  lastUpdated?: string;
  createdAt: string;
  detailUrl?: string;
  dashboardUrl?: string;
  offerName?: string;
  enrolled?: number;
  attempted?: number;
  conversionRate?: number | null;
  decision?: DecisionValue;
  sent?: number;
  clicked?: number;
  ctr?: number;
  statsOk?: boolean;
  statsError?: string;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = (Date.now() - then) / 1000;
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${Math.floor(diffSec)}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Main Component ──

interface SegmentWorkspaceProps {
  segment: SegmentDisplay;
  onDelete: (id: string) => void;
  onUpdate: () => void;
  /** When true, renders in unsaved-preview mode: no CleverTap fetches, no push/delete/campaign actions, header action buttons replaced. */
  previewMode?: boolean;
  /** Preview-mode header actions. Only used when previewMode is true. */
  previewActions?: React.ReactNode;
  /** When provided (preview mode), makes the title editable. */
  onNameChange?: (name: string) => void;
  /** Rendered above tab content in preview mode. */
  previewHeaderSlot?: React.ReactNode;
}

const PAGE_SIZE = 50;

export function SegmentWorkspace({ segment, onDelete, onUpdate, previewMode, previewActions, onNameChange, previewHeaderSlot }: SegmentWorkspaceProps) {
  const router = useRouter();
  const { datasetId, dataset, ready: datasetReady } = useDataset();
  const [activeTab] = useState<WorkspaceTab>("users");
  const [showSql, setShowSql] = useState(false);
  const [pushingTo, setPushingTo] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<{ ok: boolean; message: string; integrationId: string } | null>(null);
  const [creatingVoiceDraft, setCreatingVoiceDraft] = useState(false);
  const [voiceDraftError, setVoiceDraftError] = useState<string | null>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [pendingPush, setPendingPush] = useState<{ integrationId: string; label: string } | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [statsAvailable, setStatsAvailable] = useState<boolean>(false);
  const [statsReason, setStatsReason] = useState<string | undefined>();

  const refreshActivity = useCallback(() => {
    setActivityLoading(true);
    apiFetch<{ activity: ActivityEntry[] }>(`/api/segments/${segment.id}/activity`, { skipModel: true })
      .then((res) => setActivity(res.activity))
      .catch(() => setActivity([]))
      .finally(() => setActivityLoading(false));
  }, [segment.id]);

  const refreshCampaigns = useCallback((fresh = false, silent = false) => {
    if (!silent) setCampaignsLoading(true);
    const qs = fresh ? "?fresh=1" : "";
    apiFetch<{ campaigns: CampaignRow[]; statsAvailable: boolean; reason?: string }>(
      `/api/segments/${segment.id}/campaigns${qs}`,
      { skipModel: true },
    )
      .then((res) => {
        setCampaigns(res.campaigns.filter((campaign) => campaign.source !== "lifecycle"));
        setStatsAvailable(res.statsAvailable);
        setStatsReason(res.reason);
      })
      .catch(() => {
        if (!silent) {
          setCampaigns([]);
          setStatsAvailable(false);
        }
      })
      .finally(() => {
        if (!silent) setCampaignsLoading(false);
      });
  }, [segment.id]);

  useEffect(() => {
    if (previewMode || activeTab !== "activity") {
      setActivityLoading(false);
      setCampaignsLoading(false);
      return;
    }
    refreshActivity();
    refreshCampaigns();
  }, [activeTab, previewMode, refreshActivity, refreshCampaigns]);

  // Refresh when chat-driven campaign fires succeed for this segment.
  useEffect(() => {
    const onFired = (e: Event) => {
      const detail = (e as CustomEvent<{ segmentId?: string }>).detail;
      if (detail?.segmentId === segment.id) {
        refreshActivity();
        refreshCampaigns(true);
      }
    };
    window.addEventListener("segment:campaign-fired", onFired);
    return () => window.removeEventListener("segment:campaign-fired", onFired);
  }, [segment.id, refreshActivity, refreshCampaigns]);

  // Refresh when tab becomes visible again (common case: user sent from CleverTap
  // dashboard in another tab, comes back here to see stats). Silent.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        refreshCampaigns(true, true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refreshCampaigns]);

  const lastSync = useMemo(
    () => activity.find((a) => a.type === "push" && a.status === "success" && a.destination === "clevertap"),
    [activity],
  );
  const campaignCount = useMemo(
    () => activity.filter((a) => a.type === "campaign" && a.status === "success").length,
    [activity],
  );

  const openVoiceCampaignSetup = useCallback(async () => {
    if (creatingVoiceDraft) return;
    const description = segment.description?.trim();
    const objective = description
      ? `Create an outbound voice campaign for ${segment.name}. ${description}`
      : `Create an outbound voice campaign for ${segment.name}.`;

    setCreatingVoiceDraft(true);
    setVoiceDraftError(null);
    try {
      const result = await apiFetch<{ openUrl: string }>("/api/voice-campaigns/draft-from-segment", {
        method: "POST",
        body: {
          datasetId,
          segmentId: segment.id,
          objective,
          campaignName: `${segment.name} voice campaign`,
        },
        datasetId,
        skipModel: true,
      });
      router.push(result.openUrl);
    } catch (err) {
      setVoiceDraftError((err as Error).message || "Failed to create voice campaign draft");
    } finally {
      setCreatingVoiceDraft(false);
    }
  }, [creatingVoiceDraft, datasetId, router, segment.description, segment.id, segment.name]);

  const handlePush = useCallback(async (integrationId: string, label: string) => {
    setPushingTo(integrationId);
    setPushResult(null);
    try {
      const res = await apiFetch<{
        status: string;
        totalSent?: number;
        processed?: number;
        unprocessed?: number;
        errors?: string[];
        segment?: { created: boolean; id: number | null; status: string; error?: string; attributeKey?: string };
      }>(`/api/segments/${segment.id}/push`, {
        method: "POST",
        body: { integrationId },
        skipModel: true,
      });
      if (res.status === "synced") {
        const count = typeof res.processed === "number" ? res.processed : (res.totalSent ?? segment.userCount);
        const segPart = res.segment?.created ? ` · segment created in ${label}` : "";
        setPushResult({ ok: true, message: `Pushed ${count.toLocaleString()} users${segPart}`, integrationId });
      } else {
        const segErr = res.segment?.error ? ` · segment: ${res.segment.error}` : "";
        const detail = res.errors?.[0] ?? `status=${res.status}`;
        setPushResult({ ok: false, message: `${label}: ${detail}${segErr}`, integrationId });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "not_connected" && integrationId === "clevertap") {
        setPendingPush({ integrationId, label });
        setConnectDialogOpen(true);
      } else {
        setPushResult({ ok: false, message: `${label}: ${(err as Error).message || "Push failed"}`, integrationId });
        setTimeout(() => setPushResult(null), 8000);
      }
    } finally {
      setPushingTo(null);
      refreshActivity();
      refreshCampaigns();
    }
  }, [segment.id, segment.userCount, refreshActivity, refreshCampaigns]);

  const handleConnected = useCallback(() => {
    setConnectDialogOpen(false);
    if (pendingPush) {
      const { integrationId, label } = pendingPush;
      setPendingPush(null);
      handlePush(integrationId, label);
    }
  }, [pendingPush, handlePush]);
  // Poll campaign stats every 2 min while Campaigns tab is visible and any
  // campaign is under 24h old. CleverTap recommends 1–5 min polling cadence
  // per campaign (60 req/min rate limit). Silent — data swaps in place.
  useEffect(() => {
    if (activeTab !== "activity") return;
    const hasRecent = campaigns.some(
      (c) => Date.now() - new Date(c.createdAt).getTime() < 24 * 60 * 60 * 1000,
    );
    if (!hasRecent) return;
    const interval = setInterval(() => refreshCampaigns(true, true), 120_000);
    return () => clearInterval(interval);
  }, [activeTab, campaigns, refreshCampaigns]);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [timeframe, setTimeframe] = useState<"30d" | "60d" | "90d" | "1y" | "all">("all");
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);

  // Segment SQL for explorer filtering (strip semicolons, memoize)
  const segmentSQLs = useMemo(
    () => [segment.sql.trim().replace(/;+\s*$/, "")],
    [segment.sql],
  );

  // Explorer hook — scoped to this segment
  const eventCatalog = useMemo(() => dataset?.events ?? [], [dataset]);
  const {
    config: explorerConfig,
    result: explorerResult,
    loading: explorerLoading,
    error: explorerError,
    addEvent,
    removeEvent,
    updateEvent,
    setBreakdown,
    setChartType,
    setGranularity,
    setDatePreset,
    setDateRange,
    setComputation,
    setCompare,
  } = useExplorer(undefined, segmentSQLs);

  // Health
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  // Composition
  const [composition, setComposition] = useState<PropertyBreakdown[]>([]);
  const [compLoading, setCompLoading] = useState(true);

  // Overlap
  const [overlap, setOverlap] = useState<OverlapSegment[]>([]);
  const [overlapLoading, setOverlapLoading] = useState(true);

  // Users
  const [users, setUsers] = useState<UsersPage | null>(null);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersPage, setUsersPage] = useState(0);
  const [usersSearch, setUsersSearch] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [columnFilters, setColumnFilters] = useState<ColumnFilter[]>([]);
  const [filterDropdown, setFilterDropdown] = useState<{ column: string; pos: { top: number; left: number } } | null>(null);
  const [distinctValues, setDistinctValues] = useState<Record<string, (string | number)[]>>({});

  // Load health + composition + overlap in parallel — wait for dataset to be validated first
  useEffect(() => {
    if (!datasetReady || activeTab !== "overview") {
      setHealthLoading(false);
      setCompLoading(false);
      setOverlapLoading(false);
      return;
    }
    setHealthLoading(true);
    setCompLoading(true);
    setOverlapLoading(true);

    apiFetch<HealthData>(`/api/segments/${segment.id}/overview`, {
      method: "POST", body: { sql: segment.sql, config: segment.config },
    }).then(setHealth).catch(() => setHealth(null)).finally(() => setHealthLoading(false));

    apiFetch<{ breakdowns: PropertyBreakdown[] }>(`/api/segments/${segment.id}/composition`, {
      method: "POST", body: { sql: segment.sql },
    }).then((d) => setComposition(d.breakdowns ?? [])).catch(() => setComposition([])).finally(() => setCompLoading(false));

    apiFetch<{ overlaps: OverlapSegment[] }>(`/api/segments/${segment.id}/overlap`, {
      method: "POST", body: { sql: segment.sql },
    }).then((d) => setOverlap(d.overlaps ?? [])).catch((err) => { console.error("[overlap]", err); setOverlap([]); }).finally(() => setOverlapLoading(false));
  }, [activeTab, segment.config, segment.id, segment.sql, datasetReady]);

  // Users fetcher — gated on datasetReady to avoid 404s from stale dataset ID
  const fetchUsers = useCallback(async (p: number) => {
    if (!datasetReady) return;
    setUsersLoading(true);
    try {
      const res = await apiFetch<UsersPage>(`/api/segments/${segment.id}/users`, {
        method: "POST",
        body: {
          sql: segment.sql, page: p, pageSize: PAGE_SIZE,
          search: usersSearch || undefined, sortCol: sortCol || undefined, sortDir,
          filters: columnFilters.length ? columnFilters : undefined,
        },
      });
      setUsers(res);
    } catch { setUsers(null); }
    finally { setUsersLoading(false); }
  }, [segment.id, segment.sql, usersSearch, sortCol, sortDir, columnFilters, datasetReady]);

  useEffect(() => { fetchUsers(usersPage); }, [fetchUsers, usersPage]);
  useEffect(() => { setUsersPage(0); }, [usersSearch, sortCol, sortDir, columnFilters]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  const totalUserPages = users ? Math.ceil(users.totalCount / PAGE_SIZE) : 0;

  // Fetch distinct values for a column filter dropdown
  const openFilterDropdown = useCallback(async (column: string, anchorEl: HTMLElement) => {
    const rect = anchorEl.getBoundingClientRect();
    setFilterDropdown({ column, pos: { top: rect.bottom + 4, left: rect.left } });

    if (!distinctValues[column]) {
      try {
        const res = await apiFetch<{ values: (string | number)[] }>(
          `/api/segments/${segment.id}/users/distinct`,
          { method: "POST", body: { sql: segment.sql, column } },
        );
        setDistinctValues((prev) => ({ ...prev, [column]: res.values }));
      } catch {
        setDistinctValues((prev) => ({ ...prev, [column]: [] }));
      }
    }
  }, [segment.id, segment.sql, distinctValues]);

  const addColumnFilter = useCallback((column: string, values: (string | number)[]) => {
    setColumnFilters((prev) => {
      const existing = prev.findIndex((f) => f.column === column);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { column, operator: "in", values };
        return updated;
      }
      return [...prev, { column, operator: "in", values }];
    });
    setFilterDropdown(null);
  }, []);

  const addNumericFilter = useCallback((column: string, operator: "gt" | "lt" | "gte" | "lte" | "between", values: number[]) => {
    setColumnFilters((prev) => {
      const existing = prev.findIndex((f) => f.column === column);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { column, operator, values };
        return updated;
      }
      return [...prev, { column, operator, values }];
    });
    setFilterDropdown(null);
  }, []);

  const removeColumnFilter = useCallback((column: string) => {
    setColumnFilters((prev) => prev.filter((f) => f.column !== column));
  }, []);

  // Size-over-time chart with timeframe filtering
  const filteredSizeData = (() => {
    if (!health?.sizeOverTime?.length) return [];
    if (customRange) {
      return health.sizeOverTime.filter(
        (d) => d.period >= customRange.start && d.period <= customRange.end,
      );
    }
    if (timeframe === "all") return health.sizeOverTime;
    const days = timeframe === "30d" ? 30 : timeframe === "60d" ? 60 : timeframe === "90d" ? 90 : 365;
    const periods = health.sizeOverTime;
    const lastDate = new Date(periods[periods.length - 1].period + "T00:00:00");
    const cutoff = new Date(lastDate);
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return periods.filter((d) => d.period >= cutoffStr);
  })();

  const sizeChart: ChartSpec | null = filteredSizeData.length
    ? {
        type: "area",
        title: usesBucketedTrend(segment) ? "Weekly Segment Activity" : "Segment Size Over Time",
        data: filteredSizeData.map((d) => ({
          period: formatDateLabel(d.period, filteredSizeData.length),
          users: d.count,
        })),
        xKey: "period",
        yKeys: ["users"],
        yLabels: ["Users"],
        yAxisLabel: "Users",
        dateRange: customRange ?? undefined,
      }
    : null;

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* ── Header ── */}
      <div className="px-8 pt-6 pb-4 border-b shrink-0">
        <div className="flex items-start justify-between gap-4 mb-1">
          <div className="flex-1 min-w-0">
            {previewMode && onNameChange ? (
              <input
                type="text"
                value={segment.name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Untitled segment"
                className="text-2xl font-semibold text-foreground bg-transparent border-0 outline-none w-full placeholder:text-muted-foreground/40"
                autoFocus
              />
            ) : (
              <h1 className="text-2xl font-semibold text-foreground">{segment.name}</h1>
            )}
            {segment.description && !previewMode && (
              <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">{segment.description}</p>
            )}
            {previewMode && (
              <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
                Define your audience visually. Pick events and filters from the panel on the right.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {previewMode ? (
              previewActions
            ) : (
              <>
                <PinButton
                  cardType="chart"
                  title={`Segment: ${segment.name}`}
                  chartSpec={sizeChart ? { ...sizeChart, title: `Segment: ${segment.name}` } : undefined}
                  sql={segment.sql}
                  data={sizeChart?.data as Record<string, unknown>[] | undefined}
                  segmentId={segment.id}
                />
                <button
                  onClick={() => setShowSql((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-muted transition-colors cursor-pointer ${showSql ? "bg-muted" : ""}`}
                >
                  <Code className="h-3 w-3" />
                  SQL
                </button>
                <button
                  onClick={openVoiceCampaignSetup}
                  disabled={pushingTo !== null || creatingVoiceDraft}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-60 cursor-pointer"
                >
                  {creatingVoiceDraft ? <Loader2 className="h-3 w-3 animate-spin" /> : <PhoneCall className="h-3 w-3" />}
                  {creatingVoiceDraft ? "Preparing Voice Setup" : "Create Voice Campaign"}
                </button>
              </>
            )}
            {!previewMode && <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    aria-label="More actions"
                    disabled={pushingTo !== null}
                    className="inline-flex items-center justify-center h-[30px] w-[30px] text-xs font-medium rounded-md border hover:bg-muted transition-colors disabled:opacity-60 cursor-pointer"
                  />
                }
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[9.9px] uppercase tracking-wide text-muted-foreground font-normal">
                  Sync destinations
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => handlePush("clevertap", "CleverTap")} disabled={pushingTo !== null}>
                  {pushingTo === "clevertap" ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Send className="h-3 w-3 mr-2 opacity-60" />}
                  Sync to CleverTap
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlePush("firebase", "Firebase")} disabled={pushingTo !== null}>
                  {pushingTo === "firebase" ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Send className="h-3 w-3 mr-2 opacity-60" />}
                  Sync to Firebase
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlePush("bigquery", "BigQuery")} disabled={pushingTo !== null}>
                  {pushingTo === "bigquery" ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Send className="h-3 w-3 mr-2 opacity-60" />}
                  Sync to BigQuery
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuLabel className="text-[9.9px] uppercase tracking-wide text-muted-foreground font-normal">
                  Integrations
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => { setPendingPush(null); setConnectDialogOpen(true); }}>
                  <Settings className="h-3 w-3 mr-2 opacity-60" />
                  Manage CleverTap Connection
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => onDelete(segment.id)}
                  className="text-foreground focus:text-foreground focus:bg-muted"
                >
                  <Trash2 className="h-3 w-3 mr-2" />
                  Delete Segment
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>}
            {!previewMode && <CleverTapConnectDialog
              open={connectDialogOpen}
              onOpenChange={(v) => {
                setConnectDialogOpen(v);
                if (!v) setPendingPush(null);
              }}
              onConnected={handleConnected}
            />}
          </div>
        </div>

        {showSql && segment.sql && (
          <pre className="mt-3 text-xs font-mono bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
            {segment.sql}
          </pre>
        )}

        {pushingTo && (
          <PushProgressPill integrationId={pushingTo} />
        )}
        {!pushingTo && pushResult && (
          <div
            className={`mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border ${
              pushResult.ok ? "border-border text-foreground" : "border-border text-foreground"
            }`}
          >
            {pushResult.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            {pushResult.message}
          </div>
        )}
        {voiceDraftError && (
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-border text-foreground">
            <X className="h-3 w-3" />
            {voiceDraftError}
          </div>
        )}

        {/* KPI + status strip */}
        <div className="flex items-baseline gap-3 mt-3">
          <div>
            <span className="text-2xl font-bold tabular-nums">{segment.userCount.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground ml-1.5">users</span>
          </div>
          {previewMode ? null : lastSync ? (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-foreground/80" />
                Synced {formatRelativeTime(lastSync.createdAt)}
              </span>
            </>
          ) : segment.pushStatus?.clevertap === "error" ? (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
                Last sync failed
              </span>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full border border-muted-foreground/60" />
                Not synced yet
              </span>
            </>
          )}
          {campaignCount > 0 && (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">
                {campaignCount} campaign{campaignCount === 1 ? "" : "s"} sent
              </span>
            </>
          )}
        </div>
      </div>

      {previewMode && previewHeaderSlot && (
        <div className="px-8 pt-4 pb-2 shrink-0">{previewHeaderSlot}</div>
      )}

      {/* ── Tab content ── */}
      {activeTab === "overview" && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: Main content */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            <div className="p-6 space-y-6">

              {/* Chart area — explorer chart when events selected, otherwise segment size chart */}
              {explorerOpen && explorerConfig.events.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground">
                      Exploring events for <span className="font-medium text-foreground">{segment.name}</span> ({segment.userCount.toLocaleString()} users)
                    </p>
                    <button
                      onClick={() => setExplorerOpen(false)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Close Explorer
                    </button>
                  </div>
                  <ExplorerChart
                    config={explorerConfig}
                    result={explorerResult}
                    loading={explorerLoading}
                    error={explorerError}
                    onChartTypeChange={setChartType}
                    onGranularityChange={setGranularity}
                    onDatePresetChange={setDatePreset}
                    onCustomDateRange={(start, end) => setDateRange({ start, end })}
                  />
                </div>
              ) : (
                <div>
                  {healthLoading ? <LoadingBlock /> : health?.sizeOverTime?.length ? (
                    <>
                      {filteredSizeData.length > 0 ? (
                        <UnifiedChart
                          spec={sizeChart!}
                          variant="normal"
                          onTimeRangeChange={(range) => {
                            if (typeof range === "string") {
                              setCustomRange(null);
                              setTimeframe("all");
                            } else {
                              setCustomRange(range);
                              setTimeframe("all");
                            }
                          }}
                        />
                      ) : (
                        <div className="h-48 flex items-center justify-center border rounded-lg text-sm text-muted-foreground">
                          No activity data in this time range.
                        </div>
                      )}
                      <div className="flex items-center justify-end mt-3">
                        {!explorerOpen ? (
                          <button
                            onClick={() => setExplorerOpen(true)}
                            className="px-3 py-1 text-xs font-medium rounded-md border hover:bg-muted transition-colors"
                          >
                            Explore Events
                          </button>
                        ) : (
                          <button
                            onClick={() => setExplorerOpen(false)}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Close Explorer
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">No size-over-time data available.</p>
                      {!explorerOpen ? (
                        <button
                          onClick={() => setExplorerOpen(true)}
                          className="px-3 py-1 text-xs font-medium rounded-md border hover:bg-muted transition-colors"
                        >
                          Explore Events
                        </button>
                      ) : (
                        <button
                          onClick={() => setExplorerOpen(false)}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Close Explorer
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* vs All Users + Trend side by side */}
              {health && (health.vsAllUsers.length > 0 || health.vsPreviousPeriod.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {health.vsAllUsers.length > 0 && (
                    <div>
                      <SectionHeading>vs All Users</SectionHeading>
                      <div className="border rounded-md overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Metric</th>
                              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Segment</th>
                              <th className="px-3 py-2 text-right font-medium text-muted-foreground">All</th>
                              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Diff</th>
                            </tr>
                          </thead>
                          <tbody>
                            {health.vsAllUsers.map((row) => (
                              <tr key={row.metric} className="border-b last:border-0 hover:bg-muted/30">
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

                  {health.vsPreviousPeriod.length > 0 && (
                    <div>
                      <SectionHeading>Trend Over Time</SectionHeading>
                      <div className="border rounded-md overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Metric</th>
                              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Now</th>
                              <th className="px-3 py-2 text-right font-medium text-muted-foreground">30d</th>
                              <th className="px-3 py-2 text-right font-medium text-muted-foreground">60d</th>
                              <th className="px-3 py-2 text-right font-medium text-muted-foreground">90d</th>
                            </tr>
                          </thead>
                          <tbody>
                            {health.vsPreviousPeriod.map((row) => (
                              <tr key={row.metric} className="border-b last:border-0 hover:bg-muted/30">
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

              {/* Segment Overlap */}
              {overlapLoading ? <LoadingBlock /> : overlap.length > 0 ? (
                <div>
                  <SectionHeading>Segment Overlap</SectionHeading>
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Segment</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Shared Users</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">% of This Segment</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground w-48">Overlap</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overlap.map((o) => (
                          <tr key={o.name} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="px-3 py-2 font-medium">{o.name}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{o.overlapCount.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{o.overlapPct}%</td>
                            <td className="px-3 py-2">
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-foreground/30 rounded-full" style={{ width: `${Math.max(o.overlapPct, 2)}%` }} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Right: Explorer config panel (slides in from right) */}
          <div
            className="border-l transition-all duration-300 ease-in-out shrink-0"
            style={{ width: explorerOpen ? 340 : 0, opacity: explorerOpen ? 1 : 0, overflow: explorerOpen ? "visible" : "hidden" }}
          >
            <div className="w-[340px] h-full overflow-y-auto">
              <ExplorerConfigPanel
                events={explorerConfig.events}
                catalog={eventCatalog}
                breakdown={explorerConfig.breakdown}
                segmentIds={[]}
                segments={[]}
                onAddEvent={addEvent}
                onRemoveEvent={removeEvent}
                onUpdateEvent={updateEvent}
                onBreakdownChange={setBreakdown}
                onSegmentIdsChange={() => {}}
                hideSegmentSection
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "composition" && (
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {compLoading ? <LoadingBlock /> : composition.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {composition.map((bd) => {
                const chartSpec: ChartSpec = {
                  type: "bar",
                  title: bd.displayName,
                  data: bd.values.slice(0, 8).map((v) => ({ name: v.name || "(empty)", count: v.count })),
                  xKey: "name",
                  yKeys: ["count"],
                  yLabels: ["Users"],
                  yAxisLabel: "Users",
                };
                return (
                  <div key={bd.property} className="h-[340px]">
                    <UnifiedChart spec={chartSpec} variant="compact" />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <UsersRound className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                No property breakdowns available for this segment.
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === "users" && (
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
          {/* Search + filter + count */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={usersSearch}
                onChange={(e) => setUsersSearch(e.target.value)}
                placeholder="Search users..."
                className="w-full bg-transparent border rounded-md pl-8 pr-3 py-1.5 text-sm focus:ring-1 focus:ring-border focus:outline-none"
              />
            </div>
            <button
              onClick={(e) => setFilterDropdown(
                filterDropdown ? null : { column: "__picker__", pos: { top: e.currentTarget.getBoundingClientRect().bottom + 4, left: e.currentTarget.getBoundingClientRect().left } }
              )}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-muted transition-colors ${columnFilters.length > 0 ? "bg-muted" : ""}`}
            >
              <Filter className="h-3.5 w-3.5" />
              Filter
              {columnFilters.length > 0 && (
                <span className="ml-0.5 bg-foreground text-background rounded-full px-1.5 py-0.5 text-[9px] leading-none">{columnFilters.length}</span>
              )}
            </button>
            {users && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {users.totalCount.toLocaleString()} users
                {columnFilters.length > 0 && " (filtered)"}
              </span>
            )}
          </div>

          {/* Active filter pills */}
          {columnFilters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {columnFilters.map((f) => (
                <span
                  key={f.column}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1 text-xs"
                >
                  <span className="font-medium">{f.column}</span>
                  <span className="text-muted-foreground">
                    {f.operator === "in"
                      ? f.values.length <= 2 ? f.values.join(", ") : `${f.values.length} selected`
                      : `${f.operator} ${f.values.join(" - ")}`}
                  </span>
                  <button onClick={() => removeColumnFilter(f.column)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button
                onClick={() => setColumnFilters([])}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear All
              </button>
            </div>
          )}

          {/* Table */}
          {usersLoading && !users ? <LoadingBlock /> : users && users.columns.length > 0 ? (
            <div className="border rounded-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">#</th>
                      {users.columns.map((col) => (
                        <th
                          key={col}
                          onClick={() => handleSort(col)}
                          className="px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap"
                        >
                          {col}
                          {sortCol === col && <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.rows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{usersPage * PAGE_SIZE + i + 1}</td>
                        {users.columns.map((col) => (
                          <td key={col} className="px-3 py-2 tabular-nums whitespace-nowrap">{formatCell(row[col])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalUserPages > 1 && (
                <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setUsersPage((p) => Math.max(0, p - 1))} disabled={usersPage === 0} className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors">
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-[9.9px] text-muted-foreground tabular-nums">Page {usersPage + 1} of {totalUserPages}</span>
                    <button onClick={() => setUsersPage((p) => Math.min(totalUserPages - 1, p + 1))} disabled={usersPage >= totalUserPages - 1} className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : users && users.rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <UsersRound className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No users found.</p>
            </div>
          ) : null}

          {usersLoading && users && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Filter dropdown (fixed position) */}
          {filterDropdown && (
            <FilterColumnPicker
              columns={users?.columns ?? []}
              activeFilters={columnFilters}
              pos={filterDropdown.pos}
              segmentId={segment.id}
              segmentSql={segment.sql}
              distinctValues={distinctValues}
              onDistinctLoaded={(col, vals) => setDistinctValues((prev) => ({ ...prev, [col]: vals }))}
              onApply={(col, vals) => { addColumnFilter(col, vals); setFilterDropdown(null); }}
              onApplyNumeric={(col, op, vals) => { addNumericFilter(col, op, vals); setFilterDropdown(null); }}
              onRemoveFilter={(col) => { removeColumnFilter(col); }}
              onClose={() => setFilterDropdown(null)}
            />
          )}
        </div>
      )}

      {activeTab === "activity" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-5xl mx-auto p-6 space-y-8">
            <section>
              {campaignsLoading ? (
                <LoadingBlock />
              ) : campaigns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed rounded-md">
                  <UsersRound className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground">No campaigns yet. Draft one from chat.</p>
                </div>
              ) : (
                <CampaignsTable
                  rows={campaigns}
                  statsAvailable={statsAvailable}
                  statsReason={statsReason}
                />
              )}
            </section>

          </div>
        </div>
      )}
    </div>
  );
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const isError = entry.status === "error";
  const label = (() => {
    if (entry.type === "push") {
      const dest = entry.destination ? entry.destination.charAt(0).toUpperCase() + entry.destination.slice(1) : "destination";
      return isError ? `Sync to ${dest} failed` : `Synced to ${dest}`;
    }
    const channel = entry.channel ?? "email";
    const channelLabel = channel.charAt(0).toUpperCase() + channel.slice(1);
    return isError ? `${channelLabel} campaign failed` : `${channelLabel} campaign sent`;
  })();

  return (
    <li className="ml-4">
      <span
        className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${
          isError ? "bg-foreground" : "bg-foreground/80"
        }`}
        aria-hidden
      />
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {entry.subject && (
          <span className="text-xs text-muted-foreground truncate max-w-md">“{entry.subject}”</span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{formatRelativeTime(entry.createdAt)}</span>
        {typeof entry.userCount === "number" && entry.userCount > 0 && (
          <>
            <span>·</span>
            <span>{entry.userCount.toLocaleString()} users</span>
          </>
        )}
        {entry.campaignId != null && (
          <>
            <span>·</span>
            <span className="font-mono">#{entry.campaignId}</span>
          </>
        )}
        {entry.dashboardUrl && (
          <>
            <span>·</span>
            <a
              href={entry.dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:underline cursor-pointer"
            >
              View in CleverTap →
            </a>
          </>
        )}
      </div>
      {isError && entry.error && (
        <p className="mt-1 text-xs text-foreground break-words">{entry.error}</p>
      )}
    </li>
  );
}

function PushProgressPill({ integrationId }: { integrationId: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, []);

  const destLabel =
    integrationId === "clevertap" ? "CleverTap"
    : integrationId === "firebase" ? "Firebase"
    : integrationId === "bigquery" ? "BigQuery"
    : integrationId;

  // Staged messaging based on typical sync timing.
  // Server-side: SQL query → profile upload batches → test-recipient tag.
  const stage =
    elapsed < 2 ? `Resolving segment users…`
    : elapsed < 6 ? `Uploading profiles to ${destLabel}…`
    : elapsed < 12 ? `Tagging segment membership…`
    : `Finalizing. This can take up to a minute for large segments`;

  return (
    <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border text-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{stage}</span>
      <span className="text-muted-foreground tabular-nums">· {elapsed}s</span>
    </div>
  );
}

function CampaignsTable({
  rows,
  statsAvailable,
  statsReason,
}: {
  rows: CampaignRow[];
  statsAvailable: boolean;
  statsReason?: string;
}) {
  const router = useRouter();
  const fmt = (n?: number) => (typeof n === "number" ? n.toLocaleString() : "—");
  const pct = (n?: number | null) => (typeof n === "number" ? `${n}%` : "—");
  const rate = (n?: number | null) => (typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "—");

  return (
    <div className="space-y-2">
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Campaign</th>
              <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Started</th>
              <th className="px-4 py-2.5 text-right font-medium">Audience</th>
              <th className="px-4 py-2.5 text-right font-medium">Evidence</th>
              <th className="px-4 py-2.5 text-right font-medium">Result</th>
              <th className="px-4 py-2.5 text-left font-medium">Status</th>
              <th className="px-4 py-2.5 text-left font-medium">Decision</th>
              <th className="px-4 py-2.5 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const statusMeta: Record<LifecycleState, { label: string; dot: string; pulse: boolean }> = {
                running:   { label: "Running",   dot: "bg-foreground/80",    pulse: true },
                completed: { label: "Completed", dot: "bg-foreground/80",    pulse: false },
                sent:      { label: "Sent",      dot: "bg-muted-foreground", pulse: false },
                error:     { label: "Failed",    dot: "bg-foreground",      pulse: false },
                unknown:   { label: "Unknown",   dot: "bg-muted-foreground", pulse: false },
              };
              const s = statusMeta[r.lifecycle];
              const clickable = Boolean(r.detailUrl || r.dashboardUrl);
              const isLifecycle = r.source === "lifecycle";
              const handleRowClick = () => {
                if (r.detailUrl) {
                  router.push(r.detailUrl);
                  return;
                }
                if (r.dashboardUrl) window.open(r.dashboardUrl, "_blank", "noopener,noreferrer");
              };
              return (
                <tr
                  key={r.id}
                  onClick={clickable ? handleRowClick : undefined}
                  className={`group border-t transition-colors ${clickable ? "cursor-pointer hover:bg-muted/30" : ""}`}
                >
                  <td className="px-4 py-2.5 min-w-0 w-full">
                    <div className="font-medium text-foreground truncate" title={r.subject || r.name}>
                      {r.subject || r.name}
                    </div>
                    <div className="text-muted-foreground text-[9.9px] flex gap-2 mt-0.5 truncate">
                      <span>{isLifecycle ? "Campaign" : "CleverTap send"}</span>
                      {r.channel && <span className="capitalize">{r.channel}</span>}
                      {r.offerName && <span className="truncate">{r.offerName}</span>}
                      {r.targetId != null && <span className="font-mono">#{r.targetId}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{formatRelativeTime(r.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{isLifecycle ? fmt(r.enrolled) : fmt(r.sent)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{isLifecycle ? fmt(r.attempted) : fmt(r.clicked)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{isLifecycle ? rate(r.conversionRate) : pct(r.ctr)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? "animate-pulse" : ""}`} />
                      <span className="text-muted-foreground">{s.label}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {isLifecycle ? <DecisionBadge decision={r.decision} status={r.status} /> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {clickable && isLifecycle ? (
                      <span className="inline-flex items-center gap-1 text-foreground">
                        Open
                        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      </span>
                    ) : clickable ? (
                      <ArrowUpRight
                        className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!statsAvailable && statsReason && statsReason !== "no_campaigns" && (
        <p className="text-[9.9px] text-muted-foreground">
          Live CleverTap stats unavailable ({statsReason === "not_connected" ? "CleverTap not connected" : statsReason}). Showing campaign records only.
        </p>
      )}
    </div>
  );
}

function DecisionBadge({ decision, status }: { decision?: DecisionValue; status?: string }) {
  const label = decision === "ship"
    ? "Ship"
    : decision === "kill"
      ? "Kill"
      : decision === "iterate"
        ? "Iterate"
        : status === "draft"
          ? "Not ready"
          : "Needs decision";
  return (
    <span className="inline-flex items-center rounded border border-border px-2 py-0.5 text-[9.9px] font-medium text-foreground">
      {label}
    </span>
  );
}

// ── Sub-components ──

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
      {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />}
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-medium mb-3">{children}</h2>;
}

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center h-32">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
}

function KpiPill({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className={`font-medium tabular-nums ${positive === true ? "text-foreground" : positive === false ? "text-foreground" : ""}`}>{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateLabel(dateStr: string, totalPoints: number): string {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  const mon = SHORT_MONTHS[d.getMonth()];
  if (totalPoints > 20) return `${mon} '${String(d.getFullYear()).slice(2)}`;
  return `${mon} ${d.getDate()}`;
}

function FilterColumnPicker({
  columns,
  activeFilters,
  pos,
  segmentId,
  segmentSql,
  distinctValues,
  onDistinctLoaded,
  onApply,
  onApplyNumeric,
  onRemoveFilter,
  onClose,
}: {
  columns: string[];
  activeFilters: ColumnFilter[];
  pos: { top: number; left: number };
  segmentId: string;
  segmentSql: string;
  distinctValues: Record<string, (string | number)[]>;
  onDistinctLoaded: (col: string, values: (string | number)[]) => void;
  onApply: (column: string, values: (string | number)[]) => void;
  onApplyNumeric: (column: string, op: "gt" | "lt" | "gte" | "lte" | "between", vals: number[]) => void;
  onRemoveFilter: (column: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [activeCol, setActiveCol] = useState<string | null>(null);
  const [valSearch, setValSearch] = useState("");
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [numMin, setNumMin] = useState("");
  const [numMax, setNumMax] = useState("");

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const skipCols = new Set(["booking_id", "customer_lat", "customer_lng", "partner_id", "campaign_id"]);
  const filterable = columns.filter((c) => !skipCols.has(c));
  const filtered = search
    ? filterable.filter((c) => c.toLowerCase().includes(search.toLowerCase()))
    : filterable;
  const activeSet = new Set(activeFilters.map((f) => f.column));

  // When a column is selected, load its distinct values
  const selectColumn = useCallback(async (col: string) => {
    setActiveCol(col);
    setValSearch("");
    setNumMin("");
    setNumMax("");
    // Pre-populate selected from existing filter
    const existing = activeFilters.find((f) => f.column === col);
    setSelected(new Set(existing?.operator === "in" ? existing.values : []));
    if (existing && existing.operator !== "in") {
      setNumMin(String(existing.values[0] ?? ""));
      setNumMax(existing.operator === "between" ? String(existing.values[1] ?? "") : "");
    }

    if (!distinctValues[col]) {
      try {
        const res = await apiFetch<{ values: (string | number)[] }>(
          `/api/segments/${segmentId}/users/distinct`,
          { method: "POST", body: { sql: segmentSql, column: col } },
        );
        onDistinctLoaded(col, res.values);
      } catch {
        onDistinctLoaded(col, []);
      }
    }
  }, [activeFilters, distinctValues, segmentId, segmentSql, onDistinctLoaded]);

  const colValues = activeCol ? distinctValues[activeCol] : undefined;
  const isNumeric = colValues && colValues.length > 0 && typeof colValues[0] === "number";
  const filteredVals = colValues
    ? (valSearch ? colValues.filter((v) => String(v).toLowerCase().includes(valSearch.toLowerCase())) : colValues)
    : undefined;

  const toggleValue = (v: string | number) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  };

  // Constrain position to viewport
  const left = Math.min(pos.left, window.innerWidth - 520);
  const top = Math.min(pos.top, window.innerHeight - 400);

  return (
    <div
      ref={ref}
      className="fixed z-[100] flex rounded-lg border bg-popover shadow-lg overflow-hidden"
      style={{ top, left, maxHeight: 380 }}
    >
      {/* Left: column list */}
      <div className="w-56 border-r flex flex-col">
        <div className="px-3 py-2.5 border-b">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search columns..."
            className="w-full bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.map((col) => (
            <button
              key={col}
              onClick={() => selectColumn(col)}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center justify-between ${
                activeCol === col ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              <span>{col.replace(/_/g, " ")}</span>
              {activeSet.has(col) && (
                <span className="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right: values for selected column */}
      <div className="w-56 flex flex-col">
        {!activeCol ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4">
            Select a column to filter.
          </div>
        ) : !colValues ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : isNumeric ? (
          <div className="p-3 space-y-3">
            <p className="text-xs font-medium">{activeCol.replace(/_/g, " ")}</p>
            <div className="flex items-center gap-2">
              <input type="number" value={numMin} onChange={(e) => setNumMin(e.target.value)} placeholder="Min"
                className="w-full bg-muted rounded-md px-2.5 py-1.5 text-xs border-0 focus:ring-1 focus:ring-border" />
              <span className="text-xs text-muted-foreground">—</span>
              <input type="number" value={numMax} onChange={(e) => setNumMax(e.target.value)} placeholder="Max"
                className="w-full bg-muted rounded-md px-2.5 py-1.5 text-xs border-0 focus:ring-1 focus:ring-border" />
            </div>
            <div className="flex items-center gap-2">
              {activeSet.has(activeCol) && (
                <button onClick={() => { onRemoveFilter(activeCol); setActiveCol(null); }}
                  className="flex-1 px-3 py-1.5 text-xs rounded-md border hover:bg-muted transition-colors">
                  Clear
                </button>
              )}
              <button
                onClick={() => {
                  if (numMin && numMax) onApplyNumeric(activeCol, "between", [Number(numMin), Number(numMax)]);
                  else if (numMin) onApplyNumeric(activeCol, "gte", [Number(numMin)]);
                  else if (numMax) onApplyNumeric(activeCol, "lte", [Number(numMax)]);
                }}
                disabled={!numMin && !numMax}
                className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-30 transition-colors">
                Apply
              </button>
            </div>
          </div>
        ) : (
          <>
            {colValues.length > 8 && (
              <div className="px-3 py-2 border-b">
                <input type="text" value={valSearch} onChange={(e) => setValSearch(e.target.value)}
                  placeholder="Search values..."
                  className="w-full bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 overflow-y-auto py-1">
              {(filteredVals ?? []).map((v) => (
                <label key={String(v)} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted cursor-pointer">
                  <input type="checkbox" checked={selected.has(v)} onChange={() => toggleValue(v)} className="rounded border-border" />
                  <span className="truncate">{String(v)}</span>
                </label>
              ))}
            </div>
            <div className="px-3 py-2 border-t flex items-center justify-between gap-2">
              {activeSet.has(activeCol) && (
                <button onClick={() => { onRemoveFilter(activeCol); setSelected(new Set()); }}
                  className="text-[9px] text-muted-foreground hover:text-foreground">Clear</button>
              )}
              <button
                onClick={() => { if (filteredVals && selected.size === filteredVals.length) setSelected(new Set()); else setSelected(new Set(filteredVals ?? [])); }}
                className="text-[9px] text-muted-foreground hover:text-foreground">
                {selected.size === (filteredVals?.length ?? 0) ? "None" : "All"}
              </button>
              <button
                onClick={() => onApply(activeCol, Array.from(selected))}
                disabled={selected.size === 0}
                className="px-3 py-1 text-xs font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-30 transition-colors">
                Apply ({selected.size})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ColumnFilterDropdown({
  column,
  pos,
  values,
  currentFilter,
  onApply,
  onApplyNumeric,
  onClear,
  onClose,
}: {
  column: string;
  pos: { top: number; left: number };
  values?: (string | number)[];
  currentFilter?: ColumnFilter;
  onApply: (values: (string | number)[]) => void;
  onApplyNumeric: (op: "gt" | "lt" | "gte" | "lte" | "between", vals: number[]) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string | number>>(
    new Set(currentFilter?.operator === "in" ? currentFilter.values : []),
  );
  const [search, setSearch] = useState("");
  const [numMin, setNumMin] = useState<string>(
    currentFilter && currentFilter.operator !== "in" ? String(currentFilter.values[0] ?? "") : "",
  );
  const [numMax, setNumMax] = useState<string>(
    currentFilter?.operator === "between" ? String(currentFilter.values[1] ?? "") : "",
  );

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const isNumeric = values && values.length > 0 && typeof values[0] === "number";

  const filteredValues = values
    ? (search ? values.filter((v) => String(v).toLowerCase().includes(search.toLowerCase())) : values)
    : undefined;

  const toggleValue = (v: string | number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  return (
    <div
      ref={ref}
      className="fixed z-[100] w-64 rounded-lg border bg-popover shadow-lg overflow-hidden"
      style={{ top: pos.top, left: Math.min(pos.left, window.innerWidth - 280) }}
    >
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <span className="text-xs font-medium">{column}</span>
        {currentFilter && (
          <button onClick={onClear} className="text-[9px] text-muted-foreground hover:text-foreground">
            Clear
          </button>
        )}
      </div>

      {!values ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : isNumeric ? (
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={numMin}
              onChange={(e) => setNumMin(e.target.value)}
              placeholder="Min"
              className="w-full bg-muted rounded-md px-2.5 py-1.5 text-xs border-0 focus:ring-1 focus:ring-border"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="number"
              value={numMax}
              onChange={(e) => setNumMax(e.target.value)}
              placeholder="Max"
              className="w-full bg-muted rounded-md px-2.5 py-1.5 text-xs border-0 focus:ring-1 focus:ring-border"
            />
          </div>
          <button
            onClick={() => {
              if (numMin && numMax) onApplyNumeric("between", [Number(numMin), Number(numMax)]);
              else if (numMin) onApplyNumeric("gte", [Number(numMin)]);
              else if (numMax) onApplyNumeric("lte", [Number(numMax)]);
            }}
            disabled={!numMin && !numMax}
            className="w-full px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-30 transition-colors"
          >
            Apply
          </button>
        </div>
      ) : (
        <>
          {values.length > 8 && (
            <div className="px-3 py-2 border-b">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search values..."
                className="w-full bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <div className="max-h-48 overflow-y-auto py-1">
            {(filteredValues ?? []).map((v) => (
              <label key={String(v)} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(v)}
                  onChange={() => toggleValue(v)}
                  className="rounded border-border"
                />
                <span className="truncate">{String(v)}</span>
              </label>
            ))}
          </div>
          <div className="px-3 py-2 border-t flex items-center justify-between">
            <button
              onClick={() => {
                if (selected.size === filteredValues?.length) setSelected(new Set());
                else setSelected(new Set(filteredValues ?? []));
              }}
              className="text-[9px] text-muted-foreground hover:text-foreground"
            >
              {selected.size === filteredValues?.length ? "Deselect All" : "Select All"}
            </button>
            <button
              onClick={() => onApply(Array.from(selected))}
              disabled={selected.size === 0}
              className="px-3 py-1 text-xs font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-30 transition-colors"
            >
              Apply ({selected.size})
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function formatCell(val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "number") return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}
