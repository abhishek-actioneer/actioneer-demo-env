"use client";

import { useRouter } from "next/navigation";
import {
  Trash2,
  Table2,
  Plus,
  ChevronRight,
  Copy,
  Check,
  SquarePen,
  X,
  Search,
  History,
  RefreshCw,
  Database,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MetricSqlSection } from "./metric-sql-section";
import { ApprovalModal } from "./approval-modal";
import { deleteMetric, updateMetric, getAllMetrics, addChangelogEntry } from "@/lib/metric-store";
import { isCriticalMetric, getDownstreamIds } from "@/lib/approval-store";
import { hasPendingUpdate, getPendingUpdate, approvePendingUpdate, rejectPendingUpdate, subscribe as subscribePendingUpdates } from "@/lib/metric-update-store";
import { MetricUpdateApprovalModal } from "./metric-update-approval-modal";
import { SqlDiff } from "./sql-diff";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";
import type { Metric, MetricRelationship } from "@/lib/metric-types";
import { METRIC_TYPE_ICONS, METRIC_TYPE_LABELS } from "@/lib/metric-types";

function getAvailableTables(_datasetId: string) {
  // Tables are dataset-specific; return empty for now (table selection modal will show current table)
  return [] as { name: string; dataset: string }[];
}


export function MetricDetailPanel({
  metric,
  onMetricUpdated,
  editEnabled = true,
}: {
  metric: Metric;
  onMetricUpdated?: () => void;
  editEnabled?: boolean;
}) {
  const router = useRouter();
  const { datasetId } = useDataset();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Partial<Metric> | null>(null);
  const [pendingChangedFields, setPendingChangedFields] = useState<string[]>([]);

  // Data freshness
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshData = async () => {
    setRefreshing(true);
    await new Promise((r) => setTimeout(r, 800));
    setLastRefresh(new Date());
    setRefreshing(false);
  };

  // Pending metric update from chat
  const [pendingUpdateTick, setPendingUpdateTick] = useState(0);
  const [showUpdateApproval, setShowUpdateApproval] = useState(false);

  useEffect(() => {
    return subscribePendingUpdates(() => setPendingUpdateTick((t) => t + 1));
  }, []);

  const pendingUpdate = getPendingUpdate(metric.id);
  const hasPending = !!pendingUpdate && pendingUpdate.status === "pending";

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const handleMetricUpdate = (changes: Partial<Metric>) => {
    const criticalFields = ["sql", "formula"] as const;
    const changedCriticalFields = criticalFields.filter(
      (f) => f in changes && changes[f] !== metric[f]
    );

    if (isCriticalMetric(metric.id) && changedCriticalFields.length > 0) {
      setPendingChanges(changes);
      setPendingChangedFields(changedCriticalFields);
      setShowApproval(true);
    } else {
      updateMetric(datasetId, metric.id, changes);
      onMetricUpdated?.();
    }
  };

  const handleApprovalConfirm = () => {
    if (pendingChanges) {
      updateMetric(datasetId, metric.id, pendingChanges);
      onMetricUpdated?.();
    }
    setShowApproval(false);
    setPendingChanges(null);
    setPendingChangedFields([]);
  };

  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [freshnessOpen, setFreshnessOpen] = useState(false);

  const { setEntity } = useChatPanel();

  const drives = metric.relationships.filter((r) => r.direction === "drives");
  const drivenBy = metric.relationships.filter((r) => r.direction === "driven_by");
  const suggestedRelated = (metric.version === 0 && hasPending && !drives.length && !drivenBy.length)
    ? getAllMetrics(datasetId).filter((m) => m.id !== metric.id).slice(0, 3).map((m) => m.name)
    : [];

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-background">
      {/* Pending Update Changelog — shown above Table when pending */}
      {hasPending && pendingUpdate && (
        <div className="px-5 py-4 border-b border-border bg-muted">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Changelog</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">Pending</span>
          </div>
          <div className="space-y-2 mb-3">
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-foreground mt-1.5 shrink-0" />
              <div>
                <p className="text-xs"><span className="font-semibold text-foreground">v{metric.version + 1}</span>: Metric definition update pending approval.</p>
                <p className="text-[9.9px] text-muted-foreground">{new Date(pendingUpdate.createdAt).toLocaleDateString()}</p>
                <p className="text-[9.9px] text-muted-foreground mt-0.5">{pendingUpdate.description}</p>
                {pendingUpdate.triggeredBy && (
                  <p className="text-[9.9px] text-muted-foreground/70 mt-0.5">by {pendingUpdate.triggeredBy}</p>
                )}
              </div>
            </div>
            {metric.version > 0 && (
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
                <div>
                  <p className="text-xs"><span className="font-medium">v{metric.version}</span>: Current version</p>
                  <p className="text-[9.9px] text-muted-foreground">{new Date(metric.updatedAt).toLocaleDateString()}</p>
                  <p className="text-[9.9px] text-muted-foreground/70 mt-0.5">by admin</p>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowUpdateApproval(true)}
              className="px-3 py-1.5 text-xs font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => {
                rejectPendingUpdate(metric.id);
                onMetricUpdated?.();
              }}
              className="px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Formula + Table — always visible */}
      <div className="px-5 py-4 border-b border-border space-y-3">
        <div>
          <p className="text-[9.9px] text-muted-foreground mb-1.5">Formula</p>
          <div className="bg-muted rounded-lg px-3 py-2">
            <p className="text-xs font-mono text-foreground/80 leading-relaxed">
              {metric.formula || (hasPending && pendingUpdate ? pendingUpdate.newFormula : "—")}
            </p>
          </div>
        </div>
        {metric.table && (
          <div className="flex items-center justify-between">
            <span className="text-[9.9px] text-muted-foreground">Source table</span>
            <span className="text-[9.9px] font-mono text-foreground/80">{metric.table}</span>
          </div>
        )}
      </div>

      {/* SQL Query */}
      <div className="px-5 py-4 border-b border-border">
        <button onClick={() => setSqlOpen((o) => !o)} className="flex items-center gap-2 w-full text-left">
          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none ${sqlOpen ? "rotate-90" : ""}`} />
          <h3 className="text-sm font-semibold">SQL Query</h3>
        </button>
        <CollapsibleContent open={sqlOpen}>
          <div className="mt-3 pl-[22px]">
            {hasPending && pendingUpdate ? (
              <>
                <p className="text-[9.9px] text-muted-foreground font-medium mb-2">Proposed Changes</p>
                <SqlDiff oldSql={metric.sql} newSql={pendingUpdate.newSql} />
              </>
            ) : (
              <SqlSectionWithHeader
                sql={metric.sql}
                editEnabled={editEnabled}
                onSave={(newSql) => {
                  updateMetric(datasetId, metric.id, { sql: newSql });
                  onMetricUpdated?.();
                }}
                hideTitle
              />
            )}
          </div>
        </CollapsibleContent>
      </div>

      {/* Related Metrics */}
      <div className="px-5 py-4 border-b border-border">
        <button onClick={() => setRelatedOpen((o) => !o)} className="flex items-center gap-2 w-full text-left">
          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none ${relatedOpen ? "rotate-90" : ""}`} />
          <h3 className="text-sm font-semibold">Related Metrics</h3>
          {(drives.length + drivenBy.length) > 0 && (
            <span className="ml-auto text-[9.9px] text-muted-foreground">{drives.length + drivenBy.length}</span>
          )}
        </button>
        <CollapsibleContent open={relatedOpen}>
          <div className="mt-3 pl-[22px] space-y-2.5">
            {drives.length > 0 && (
              <RelRow label="Drives" relationships={drives} />
            )}
            {drivenBy.length > 0 && (
              <RelRow label="Driven by" relationships={drivenBy} />
            )}
            {!drives.length && !drivenBy.length && suggestedRelated.length === 0 && (
              <p className="text-xs text-muted-foreground">No related metrics.</p>
            )}
            {suggestedRelated.length > 0 && (
              <div>
                <p className="text-[9.9px] text-muted-foreground font-medium mb-1.5">Actioneer suggests linking:</p>
                <div className="bg-muted/50 border border-border rounded-md px-2.5 py-2 flex flex-wrap gap-1.5">
                  {suggestedRelated.map((name) => (
                    <span key={name} className="text-[9.9px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {hasPending && pendingUpdate && pendingUpdate.affectedMetrics.length > 0 && (
              <div className="pt-1">
                <p className="text-[9.9px] text-muted-foreground font-medium mb-1.5">Will be recalculated:</p>
                <div className="flex flex-wrap gap-1.5">
                  {pendingUpdate.affectedMetrics.map((m) => (
                    <span key={m.id} className="text-[9.9px] px-2.5 py-1 rounded-full border border-border text-muted-foreground bg-muted">
                      {m.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>

      {/* Data freshness — collapsed by default */}
      <div className="px-5 py-4 border-b border-border">
        <button
          onClick={() => setFreshnessOpen((o) => !o)}
          className="flex items-center gap-2 w-full text-left"
        >
          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none ${freshnessOpen ? "rotate-90" : ""}`} />
          <h3 className="text-sm font-semibold">Data freshness</h3>
        </button>
        <CollapsibleContent open={freshnessOpen}>
          <div className="mt-3 space-y-2 pl-[22px]">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Max date in data</span>
              <span className="text-xs font-medium">21 March 2026</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Last refresh</span>
              <span className="text-xs font-medium">
                {lastRefresh
                  ? lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ", " + lastRefresh.toLocaleDateString()
                  : "10:17 AM, 23 March 2026"}
              </span>
            </div>
            <button
              onClick={handleRefreshData}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors mt-1 disabled:opacity-60"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh data"}
            </button>
          </div>
        </CollapsibleContent>
      </div>

      {/* Owner / Source — collapsed */}
      <div className="px-5 py-4 border-b border-border">
        <button
          onClick={() => setDescriptionOpen((o) => !o)}
          className="flex items-center gap-2 w-full text-left"
        >
          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none ${descriptionOpen ? "rotate-90" : ""}`} />
          <h3 className="text-sm font-semibold">Owner &amp; Source</h3>
        </button>
        <CollapsibleContent open={descriptionOpen}>
          <div className="mt-3 space-y-2.5 pl-[22px]">
            <CalcRow icon={SquarePen} label="Owner" badge={metric.owner || "None"} />
            <CalcRow icon={Database} label="Source" badge={(metric as unknown as Record<string, unknown>).source as string || "Semantic Query"} />
          </div>
        </CollapsibleContent>
      </div>

      {/* Changelog — hidden when pending (shown above Table instead) */}
      {!hasPending && (
        <div className="px-5 py-4 border-b border-border">
          <button
            onClick={() => setChangelogOpen((o) => !o)}
            className="flex items-center gap-2 w-full text-left"
          >
            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none ${changelogOpen ? "rotate-90" : ""}`} />
            <h3 className="text-sm font-semibold">Changelog</h3>
            {(metric.changelog?.length ?? 0) > 0 && (
              <span className="ml-auto text-[9.9px] text-muted-foreground">{metric.changelog!.length}</span>
            )}
          </button>
          <CollapsibleContent open={changelogOpen}>
            <div className="mt-3 pl-[22px] space-y-2">
              {metric.changelog && metric.changelog.length > 0 ? (
                metric.changelog.map((entry, i) => (
                  <div key={`${entry.version}-${i}`} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
                    <div>
                      <p className="text-xs">
                        <span className="font-medium">v{entry.version}</span>: {entry.summary}
                      </p>
                      {entry.description && (
                        <p className="text-[9.9px] text-muted-foreground mt-0.5">{entry.description}</p>
                      )}
                      <p className="text-[9.9px] text-muted-foreground">
                        {new Date(entry.date).toLocaleDateString()}
                      </p>
                      <p className="text-[9.9px] text-muted-foreground/70 mt-0.5">by {entry.author}</p>
                    </div>
                  </div>
                ))
              ) : (
                // Fallback for metrics without changelog array (pre-existing)
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-xs"><span className="font-medium">v{metric.version || 1}</span>: Created</p>
                    <p className="text-[9.9px] text-muted-foreground">{new Date(metric.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </div>
      )}


      {/* Delete */}
      <div className={`px-5 py-5 ${!editEnabled ? "pointer-events-none opacity-60" : ""}`}>
        <p className="text-xs text-muted-foreground mb-2.5">
          Delete the metric and its slices? Scouts & agents using this metric will also lose access to this data point.
        </p>
        <button
          onClick={handleDelete}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
        >
          Delete Metric
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Table select modal */}
      {tableModalOpen && (
        <TableSelectModal
          currentTable={metric.table}
          onSelect={(table) => {
            updateMetric(datasetId, metric.id, { table });
            onMetricUpdated?.();
            setTableModalOpen(false);
          }}
          onClose={() => setTableModalOpen(false)}
        />
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={`Delete "${metric.name}"`}
        description="This will permanently delete the metric and its slices. Scouts and agents using this metric will lose access to this data point."
        onConfirm={() => {
          deleteMetric(datasetId, metric.id);
          router.push("/metrics");
        }}
      />

      {showApproval && (
        <ApprovalModal
          metricName={metric.name}
          changedFields={pendingChangedFields}
          affectedMetrics={getDownstreamIds(metric.id).map((id) => ({ id, name: id }))}
          onApprove={handleApprovalConfirm}
          onCancel={() => {
            setShowApproval(false);
            setPendingChanges(null);
            setPendingChangedFields([]);
          }}
        />
      )}

      {showUpdateApproval && pendingUpdate && (
        <MetricUpdateApprovalModal
          metricName={metric.name}
          affectedMetrics={pendingUpdate.affectedMetrics}
          onApproveAll={async () => {
            approvePendingUpdate(metric.id);
            const now = new Date().toISOString();
            const newVersion = metric.version + 1;
            const isNewMetric = metric.version === 0;

            if (isNewMetric) {
              // Persist new metric to disk via API
              try {
                const definition = {
                  id: metric.id,
                  name: metric.name,
                  description: metric.description,
                  type: metric.type || "diagnostic",
                  category: metric.category || "Uncategorized",
                  valueFormat: metric.valueFormat || "number",
                  aggregation: metric.aggregation || "count",
                  valueSql: pendingUpdate.newSql,
                  timeSeriesSql: pendingUpdate.newSql,
                  table: metric.table,
                  column: metric.column || "",
                  timeColumn: metric.timeColumn || "date",
                  formula: pendingUpdate.newFormula,
                  relationships: [],
                };
                const res = await apiFetch<{ success: boolean; metric?: Metric; error?: string }>("/api/metrics", {
                  method: "POST",
                  body: { definition },
                });
                if (res.success && res.metric) {
                  updateMetric(datasetId, metric.id, {
                    ...res.metric,
                    version: newVersion,
                  });
                } else {
                  // Fallback: update locally with mock data
                  const mockTs = Array.from({ length: 7 }, (_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() - (6 - i));
                    return { date: d.toISOString().split("T")[0], value: Math.floor(Math.random() * 4000) + 1000 };
                  });
                  updateMetric(datasetId, metric.id, {
                    sql: pendingUpdate.newSql,
                    formula: pendingUpdate.newFormula,
                    version: newVersion,
                    updatedAt: now,
                    timeSeries: mockTs,
                    value: mockTs[mockTs.length - 1].value,
                  });
                }
              } catch (err) {
                console.error("[metric-approve] Failed to persist:", err);
                toast.error("Failed to save metric to server");
                // Still update locally
                updateMetric(datasetId, metric.id, {
                  sql: pendingUpdate.newSql,
                  formula: pendingUpdate.newFormula,
                  version: newVersion,
                  updatedAt: now,
                });
              }
            } else {
              updateMetric(datasetId, metric.id, {
                sql: pendingUpdate.newSql,
                formula: pendingUpdate.newFormula,
                version: newVersion,
                updatedAt: now,
              });
            }

            addChangelogEntry(datasetId, metric.id, {
              version: newVersion,
              summary: isNewMetric ? "Created · SQL & formula computed" : "SQL definition updated",
              description: pendingUpdate.description,
              author: pendingUpdate.triggeredBy || "admin",
              date: now,
              oldSql: pendingUpdate.oldSql,
              newSql: pendingUpdate.newSql,
            });
            setShowUpdateApproval(false);
            onMetricUpdated?.();
          }}
          onApproveCurrent={() => {
            approvePendingUpdate(metric.id);
            const now = new Date().toISOString();
            const newVersion = metric.version + 1;
            updateMetric(datasetId, metric.id, {
              sql: pendingUpdate.newSql,
              formula: pendingUpdate.newFormula,
              version: newVersion,
              updatedAt: now,
            });
            addChangelogEntry(datasetId, metric.id, {
              version: newVersion,
              summary: "SQL definition updated",
              description: pendingUpdate.description,
              author: pendingUpdate.triggeredBy || "admin",
              date: now,
              oldSql: pendingUpdate.oldSql,
              newSql: pendingUpdate.newSql,
            });
            setShowUpdateApproval(false);
            onMetricUpdated?.();
          }}
          onCancel={() => setShowUpdateApproval(false)}
          isNewMetric={metric.version === 0}
        />
      )}
    </div>
  );
}

/* ── Table select modal ── */
function TableSelectModal({
  currentTable,
  onSelect,
  onClose,
}: {
  currentTable: string;
  onSelect: (table: string) => void;
  onClose: () => void;
}) {
  const { datasetId } = useDataset();
  const [search, setSearch] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);

  const availableTables = getAvailableTables(datasetId);
  const filtered = availableTables.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="bg-background rounded-xl border border-border shadow-xl w-[480px] max-h-[624px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div />
          <span className="text-sm font-semibold">Table</span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* Table list */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {filtered.map((t) => (
            <button
              key={t.name}
              onClick={() => onSelect(t.name)}
              className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg transition-colors ${
                t.name === currentTable ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              <Table2 className="w-4 h-4 text-muted-foreground/50 shrink-0" />
              <div className="text-left">
                <p className="text-xs font-medium text-foreground">{t.name}</p>
                <p className="text-[9.9px] text-muted-foreground">{t.dataset}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">No tables found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Calculation row: icon + label + right-aligned pill ── */
function CalcRow({
  icon: Icon,
  label,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-xs text-foreground">{label}</span>
      </div>
      {badge && (
        <span className="text-[9.9px] px-2 py-0.5 rounded-full border border-border text-foreground font-mono">
          {badge}
        </span>
      )}
    </div>
  );
}

/* ── SQL section with copy/edit icons in the header ── */
function SqlSectionWithHeader({ sql, editEnabled = true, onSave, hideTitle }: { sql: string; editEnabled?: boolean; onSave?: (newSql: string) => void; hideTitle?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sql);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    onSave?.(draft.trim());
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(sql);
    setEditing(false);
  };

  return (
    <>
      {!hideTitle && (
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-sm font-semibold">SQL Query</h3>
        </div>
      )}
      <div className="relative group/sql">
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/sql:opacity-100 transition-opacity z-10">
          {editing ? (
            <>
              <button onClick={handleSave} className="p-1 rounded bg-background/80 text-foreground hover:text-foreground transition-colors" title="Save SQL">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleCancel} className="p-1 rounded bg-background/80 text-muted-foreground hover:text-foreground transition-colors" title="Cancel">
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleCopy}
                className="p-1 rounded bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
                title="Copy SQL"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => editEnabled && setEditing(true)}
                className={`p-1 rounded bg-background/80 transition-colors ${!editEnabled ? "pointer-events-none opacity-60 text-muted-foreground" : "text-muted-foreground hover:text-foreground"}`}
                title="Edit SQL"
              >
                <SquarePen className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full bg-muted rounded-lg px-3 py-2.5 text-xs font-mono text-foreground/80 leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-border"
            rows={Math.max(4, draft.split("\n").length + 1)}
            autoFocus
          />
        ) : (
          <MetricSqlSection sql={sql} />
        )}
      </div>
    </>
  );
}

/* ── Smooth collapsible wrapper using CSS grid (no height animation) ── */
function CollapsibleContent({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/* ── Relationship row: pills inline + "+" button (no label) ── */
function RelRow({
  label: _label,
  relationships,
}: {
  label: string;
  relationships: MetricRelationship[];
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {relationships.map((r) => (
        <button
          key={r.metricId}
          onClick={() => router.push(`/metrics/${r.metricId}`)}
          className="inline-flex items-center px-2.5 py-1 text-[9.9px] font-medium rounded-full border border-border text-foreground bg-background hover:bg-muted transition-colors"
        >
          {r.metricName}
        </button>
      ))}
      <button className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}
