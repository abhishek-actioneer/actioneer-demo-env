"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Users,
  Loader2,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Clock,
  Copy,
  Check,
  MoreVertical,
  Archive,
  Trash2,
  RefreshCw,
  Waypoints,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { BRAND_ICONS } from "@/components/segments/brand-icons";
import { BehavioralProfileSection } from "@/components/segments/behavioral-profile-section";
import { apiFetch } from "@/lib/api-client";
import { deltaColorClass } from "@/lib/delta-colors";
import { useSidebarContext } from "@/components/sidebar-context";
import { useDataset } from "@/lib/dataset-context";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import type { SegmentDisplay, Integration } from "@/lib/types";
import { isBehavioralSegment } from "@/lib/types";

interface SegmentDetailPanelProps {
  segment: SegmentDisplay;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: () => void;
}

type PushState = Record<string, "idle" | "pushing" | "synced" | "error">;

const MOCK_PREVIEW_USERS = [
  { user_id: "usr_8f2a1b", event_type: "purchase", event_date: "2026-02-17", brand: "samsung", price: 249.99 },
  { user_id: "usr_3c7d4e", event_type: "purchase", event_date: "2026-02-16", brand: "apple", price: 1099.00 },
  { user_id: "usr_9e1f6a", event_type: "purchase", event_date: "2026-02-16", brand: "xiaomi", price: 189.50 },
  { user_id: "usr_2b5c8d", event_type: "purchase", event_date: "2026-02-15", brand: "apple", price: 799.00 },
  { user_id: "usr_7a4e3f", event_type: "purchase", event_date: "2026-02-15", brand: "huawei", price: 349.99 },
  { user_id: "usr_1d6b9c", event_type: "cart", event_date: "2026-02-14", brand: "samsung", price: 599.00 },
  { user_id: "usr_5f8a2e", event_type: "purchase", event_date: "2026-02-14", brand: "apple", price: 449.99 },
  { user_id: "usr_4c3d7b", event_type: "view", event_date: "2026-02-13", brand: "xiaomi", price: 129.99 },
];

export function SegmentDetailPanel({
  segment,
  onArchive,
  onDelete,
  onUpdate,
}: SegmentDetailPanelProps) {
  const router = useRouter();
  const { datasetId } = useDataset();
  const { chats } = useSidebarContext();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [pushStatus, setPushStatus] = useState<PushState>(segment.pushStatus);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [previewLoading, setPreviewLoading] = useState(!segment.id.startsWith("mock-"));
  const [freshCount, setFreshCount] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLabel, setRefreshLabel] = useState(segment.refreshLabel);
  const [refreshFrequency, setRefreshFrequency] = useState(segment.refreshFrequency);
  const abortRef = useRef<AbortController | null>(null);
  const [prevSegmentId, setPrevSegmentId] = useState(segment.id);

  // Reset state when segment changes (React recommended pattern: adjust state during render)
  if (segment.id !== prevSegmentId) {
    setPrevSegmentId(segment.id);
    setPushStatus(segment.pushStatus);
    setPreview([]);
    setPreviewLoading(!segment.id.startsWith("mock-"));
    setFreshCount(null);
    setRefreshLabel(segment.refreshLabel);
    setRefreshFrequency(segment.refreshFrequency);
    setRefreshing(false);
  }

  // Fetch detail + integrations with AbortController
  const fetchSegmentData = useCallback((segmentId: string) => {
    const abort = new AbortController();
    abortRef.current = abort;

    // Fetch integrations
    apiFetch<Integration[]>("/api/integrations", { signal: abort.signal, skipModel: true })
      .then((data) => {
        if (!abort.signal.aborted && Array.isArray(data)) setIntegrations(data);
      })
      .catch(() => {});

    // Only fetch preview for real segments (not mocks)
    if (!segmentId.startsWith("mock-")) {
      apiFetch<{ userCount: number; preview?: Record<string, unknown>[] }>(`/api/segments/${segmentId}`, {
          signal: abort.signal,
          skipModel: true,
        })
        .then((data) => {
          if (abort.signal.aborted) return;
          setFreshCount(data.userCount);
          setPreview(data.preview ?? []);
          setPreviewLoading(false);
        })
        .catch(() => {
          if (!abort.signal.aborted) setPreviewLoading(false);
        });
    }

    return () => {
      abort.abort();
      abortRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- datasetId triggers re-fetch on dataset switch; apiFetch injects it automatically
  }, [datasetId]);

  useEffect(() => {
    return fetchSegmentData(segment.id);
  }, [segment.id, fetchSegmentData]);

  const handlePush = async (integrationId: string) => {
    if (segment.id.startsWith("mock-")) return;
    setPushStatus((prev) => ({ ...prev, [integrationId]: "pushing" }));

    // Behavioral segments: mock success after 1.5s delay
    if (segment.id.startsWith("behavioral-")) {
      await new Promise((r) => setTimeout(r, 1500));
      setPushStatus((prev) => ({ ...prev, [integrationId]: "synced" }));
      return;
    }

    try {
      await apiFetch(`/api/segments/${segment.id}/push`, {
        method: "POST",
        body: { integrationId },
        skipModel: true,
      });
      setPushStatus((prev) => ({ ...prev, [integrationId]: "synced" }));
      onUpdate();
    } catch {
      setPushStatus((prev) => ({ ...prev, [integrationId]: "error" }));
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(segment.sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = async () => {
    if (segment.id.startsWith("mock-") || refreshing) return;
    setRefreshing(true);
    setPreviewLoading(true);
    try {
      const data = await apiFetch<{ userCount: number; preview?: Record<string, unknown>[] }>(`/api/segments/${segment.id}`, { skipModel: true });
      setFreshCount(data.userCount);
      setPreview(data.preview ?? []);
      setRefreshLabel("Just now");
    } catch {
      // keep existing data on error
    } finally {
      setRefreshing(false);
      setPreviewLoading(false);
    }
  };

  const userCount = freshCount ?? segment.userCount;
  const connectedIntegrations = integrations.filter((i) => i.connected);
  const columns = preview.length > 0 ? Object.keys(preview[0]) : [];
  const date = new Date(segment.createdAt);
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const isBehavioral = isBehavioralSegment(segment);

  const handleAskAboutSegment = () => {
    sessionStorage.setItem("segment-context", JSON.stringify({
      id: segment.id,
      name: segment.name,
      traits: segment.behavioralTraits,
      differentiator: segment.differentiator,
      summary: segment.behavioralSummary,
    }));
    router.push("/?segment=" + segment.id);
  };

  // ── Behavioral segment detail ──
  if (isBehavioral) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6">
          {/* Breadcrumb-style header */}
          <div className="flex items-start justify-between mb-6">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground mb-1">Behavioral Segment · by {segment.creator}</p>
              <h2 className="text-lg font-semibold">{segment.name}</h2>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-8 w-8 p-0" />}>
                <MoreVertical className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onArchive(segment.id)}>
                  <Archive className="w-4 h-4 mr-2" />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(segment.id)}
                  className="text-foreground"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <BehavioralProfileSection
            segment={segment}
            onAskAbout={handleAskAboutSegment}
          />

          {/* Similar Segments */}
          {segment.similarSegments.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium mb-3">Similar Segments</h3>
              <div className="space-y-2">
                {segment.similarSegments.map((sim) => (
                  <button
                    key={sim.id}
                    onClick={() => router.push(`/segments/${sim.id}`)}
                    className="flex items-center justify-between w-full text-left rounded-lg border bg-card px-4 py-2.5 hover:bg-muted/30 transition-colors group"
                  >
                    <span className="text-sm group-hover:text-foreground transition-colors">
                      {sim.name}
                    </span>
                    <Badge variant="secondary" className="text-xs px-2 py-0.5 shrink-0 ml-2">
                      {sim.overlapPercent}% overlap
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Push to integrations */}
          <div className="mt-6">
            <h3 className="text-sm font-medium mb-3">Push to Integrations</h3>
            {connectedIntegrations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Connect integrations in Data Connectors to push segments.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {connectedIntegrations.map((integration) => {
                  const status = pushStatus[integration.id] ?? "idle";
                  const BrandIcon = BRAND_ICONS[integration.id];
                  return (
                    <Button
                      key={integration.id}
                      variant="outline"
                      size="sm"
                      disabled={status === "pushing" || status === "synced"}
                      onClick={() => handlePush(integration.id)}
                      className="gap-1.5"
                    >
                      {status === "pushing" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : status === "synced" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-foreground" />
                      ) : status === "error" ? (
                        <AlertCircle className="w-3.5 h-3.5 text-foreground" />
                      ) : BrandIcon ? (
                        <BrandIcon className="w-3.5 h-3.5" />
                      ) : null}
                      {status === "idle"
                        ? `Push to ${integration.name}`
                        : status === "synced"
                          ? `Synced to ${integration.name}`
                          : status === "pushing"
                            ? `Pushing...`
                            : `Retry ${integration.name}`}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Regular segment detail (existing) ──
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6">
        {/* Header with name + actions */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold">{segment.name}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Created {dateStr} · by {segment.creator} ·{" "}
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                {segment.type}
              </Badge>
            </p>
            {segment.sourceConversationId && (() => {
              const conv = chats.find((c) => c.id === segment.sourceConversationId);
              return (
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  Created from{" "}
                  <button
                    onClick={() => router.push(`/?conv=${segment.sourceConversationId}`)}
                    className="text-foreground hover:text-foreground/80 hover:underline font-medium"
                  >
                    {conv?.title || "a chat conversation"}
                  </button>
                </p>
              );
            })()}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-8 w-8 p-0" />}>
              <MoreVertical className="w-4 h-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onArchive(segment.id)}>
                <Archive className="w-4 h-4 mr-2" />
                Archive
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(segment.id)}
                className="text-foreground"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Users className="w-3.5 h-3.5" />
              Users
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-semibold">{userCount.toLocaleString()}</span>
              {segment.trend !== null && (
                <span
                  className={`flex items-center gap-0.5 text-xs font-medium ${deltaColorClass(segment.trend)}`}
                >
                  {segment.trend > 0 ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  {Math.abs(segment.trend)}%
                </span>
              )}
            </div>
            {segment.totalUsers > 0 && (
              <div className="mt-2">
                <div className="text-[9px] text-muted-foreground mb-1">
                  {((userCount / segment.totalUsers) * 100).toFixed(1)}% of all users
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-foreground rounded-full transition-[width]"
                    style={{ width: `${Math.min((userCount / segment.totalUsers) * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                Refresh
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger render={<button className="p-0.5 rounded hover:bg-muted transition-colors" />}>
                  <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onClick={handleRefresh}
                    disabled={refreshing || segment.id.startsWith("mock-")}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                    Refresh Now
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Clock className="w-3.5 h-3.5 mr-2" />
                      Frequency
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {(["6h", "daily", "weekly", "manual"] as const).map((freq) => (
                        <DropdownMenuItem
                          key={freq}
                          onClick={() => setRefreshFrequency(freq)}
                          className={refreshFrequency === freq ? "bg-muted" : ""}
                        >
                          {{ "6h": "Every 6 hours", daily: "Daily", weekly: "Weekly", manual: "Manual only" }[freq]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  refreshing
                    ? "bg-foreground animate-pulse"
                    : segment.refreshStatus === "active"
                      ? "bg-foreground"
                      : segment.refreshStatus === "stale"
                        ? "bg-muted-foreground"
                        : segment.refreshStatus === "failed"
                          ? "bg-foreground"
                          : "bg-foreground"
                }`}
              />
              <span className="text-sm">{refreshing ? "Refreshing..." : refreshLabel}</span>
            </div>
            <div className="text-[9px] text-muted-foreground mt-1">
              {{ "6h": "Every 6 hours", daily: "Daily", weekly: "Weekly", manual: "Manual" }[refreshFrequency]}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground mb-1">Destinations</div>
            {segment.destinations.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {segment.destinations.map((dest) => (
                  <Badge key={dest} variant="secondary" className="text-[9px] px-1.5 py-0">
                    {dest}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">None</span>
            )}
          </div>

          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Waypoints className="w-3.5 h-3.5" />
              Similar Segments
            </div>
            {segment.similarSegments.length > 0 ? (
              <div className="space-y-1.5">
                {segment.similarSegments.map((sim) => (
                  <button
                    key={sim.id}
                    onClick={() => router.push(`/segments/${sim.id}`)}
                    className="flex items-center justify-between w-full text-left group"
                  >
                    <span className="text-xs truncate group-hover:text-foreground transition-colors">
                      {sim.name}
                    </span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 ml-1.5">
                      {sim.overlapPercent}%
                    </Badge>
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">No similar segments</span>
            )}
          </div>
        </div>

        {/* SQL Query */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">SQL Query</h3>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleCopy}>
              {copied ? (
                <Check className="w-3.5 h-3.5 mr-1 text-foreground" />
              ) : (
                <Copy className="w-3.5 h-3.5 mr-1" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
            {segment.sql}
          </pre>
        </div>

        {/* Push to integrations */}
        <div className="mb-6">
          <h3 className="text-sm font-medium mb-3">Push to Integrations</h3>
          {connectedIntegrations.length === 0 && segment.id.startsWith("mock-") ? (
            <p className="text-sm text-muted-foreground">
              Connect integrations in Data Connectors to push segments.
            </p>
          ) : connectedIntegrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No integrations connected. Go to Data Connectors to connect one.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {connectedIntegrations.map((integration) => {
                const status = pushStatus[integration.id] ?? "idle";
                const BrandIcon = BRAND_ICONS[integration.id];
                return (
                  <Button
                    key={integration.id}
                    variant="outline"
                    size="sm"
                    disabled={status === "pushing" || status === "synced" || segment.id.startsWith("mock-")}
                    onClick={() => handlePush(integration.id)}
                    className="gap-1.5"
                  >
                    {status === "pushing" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : status === "synced" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-foreground" />
                    ) : status === "error" ? (
                      <AlertCircle className="w-3.5 h-3.5 text-foreground" />
                    ) : BrandIcon ? (
                      <BrandIcon className="w-3.5 h-3.5" />
                    ) : null}
                    {status === "idle"
                      ? `Push to ${integration.name}`
                      : status === "synced"
                        ? `Synced to ${integration.name}`
                        : status === "pushing"
                          ? `Pushing...`
                          : `Retry ${integration.name}`}
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        {/* User preview table */}
        <div>
          <h3 className="text-sm font-medium mb-2">
            Sample Users{" "}
            <span className="text-muted-foreground font-normal">
              ({segment.id.startsWith("mock-") ? MOCK_PREVIEW_USERS.length : preview.length} of {userCount.toLocaleString()})
            </span>
          </h3>
          {segment.id.startsWith("mock-") ? (
            (() => {
              const mockCols = Object.keys(MOCK_PREVIEW_USERS[0]);
              return (
                <div className="border rounded-md overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        {mockCols.map((col) => (
                          <th key={col} className="text-left px-3 py-2 font-medium">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {MOCK_PREVIEW_USERS.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          {mockCols.map((col) => (
                            <td key={col} className="px-3 py-1.5 truncate max-w-[200px]">
                              {String(row[col as keyof typeof row] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()
          ) : previewLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading preview...
            </div>
          ) : preview.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm text-muted-foreground">No rows returned.</p>
            </div>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {columns.map((col) => (
                      <th key={col} className="text-left px-3 py-2 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {columns.map((col) => (
                        <td key={col} className="px-3 py-1.5 truncate max-w-[200px]">
                          {String(row[col] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Empty state when no segment is selected */
export function SegmentDetailEmpty() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <UsersRound className="w-10 h-10 text-muted-foreground/40 mb-3" />
      <h3 className="text-sm font-medium text-muted-foreground mb-1">
        Select a Segment
      </h3>
      <p className="text-xs text-muted-foreground/70 max-w-[200px]">
        Choose a segment from the list to view its details, SQL query, and user preview.
      </p>
    </div>
  );
}
