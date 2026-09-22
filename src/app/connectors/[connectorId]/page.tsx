"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  Plus,
  AlertCircle,
  Loader2,
  ChevronRight,
  Activity,
  BarChart3,
  Database,
  Check,
  X,
  Info,
  Table2,
  Zap,
} from "lucide-react";

function AgentsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      fill="currentColor"
      className={className}
    >
      <path d="M62.79 98.1a2.81 2.81 0 0 1-3 2.81A46.77 46.77 0 0 1 16 54.21V42.94A18.94 18.94 0 0 1 34.94 24h58.13A18.94 18.94 0 0 1 112 42.93v11.28a102.22 102.22 0 0 1-.68 11.71 2.8 2.8 0 0 1-3.24 2.43l-4.34-.73a2.79 2.79 0 0 1-2.33-3.06 92.85 92.85 0 0 0 .59-10.35V42.94A8.94 8.94 0 0 0 93.06 34H34.93A8.93 8.93 0 0 0 26 42.93v11.28a36.68 36.68 0 0 0 19.94 32.71 36.1 36.1 0 0 0 14.21 4 2.81 2.81 0 0 1 2.64 2.79z" />
      <path d="M69 29H59V14.8a2.8 2.8 0 0 1 2.8-2.8h4.4a2.8 2.8 0 0 1 2.8 2.8z" />
      <circle cx="48" cy="56" r="8" />
      <circle cx="80" cy="56" r="8" />
      <path d="m110.94 103.87-5.66-5.67a16 16 0 1 0-7.08 7.08l5.67 5.66a2.81 2.81 0 0 0 4 0l3.11-3.11a2.81 2.81 0 0 0-.04-3.96zm-15.7-8.63a6 6 0 1 1 0-8.48 6 6 0 0 1 0 8.48z" />
    </svg>
  );
}
function ColumnIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" className={className}>
      <path d="M50 8H14c-3.309 0-6 2.691-6 6v36c0 3.309 2.691 6 6 6h36c3.309 0 6-2.691 6-6V14c0-3.309-2.691-6-6-6zm-12 4v40H26V12zM12 50V14c0-1.103.897-2 2-2h8v40h-8c-1.103 0-2-.897-2-2zm40 0c0 1.103-.897 2-2 2h-8V12h8c1.103 0 2 .897 2 2z" />
    </svg>
  );
}

import { Switch } from "@/components/ui/switch";
import { SchedulerModal } from "@/components/connectors/scheduler-modal";
import { ConnectorModal } from "@/components/connectors/connector-modal";
import {
  findConnection,
  getSubLabel,
  type SubStatus,
  type SubConnection,
} from "@/lib/active-connections";
import { CONNECTOR_CATEGORIES } from "@/lib/connector-categories";
import { ConnectorLogo } from "@/components/connectors/connector-logo";
import { L2_DATASETS, getDataTypeBadge, type TableDef } from "@/lib/connector-dataset-tables";
import { MOCK_ISSUES, getIssuesForDataset, getIssuesForTable, getIssuesForConnector, type ConnectorIssue } from "@/lib/connector-issues";
import { IssueModal, IssuePill } from "@/components/connectors/issue-modal";
import { CreateAgentModal, type NewAgent } from "@/components/connectors/create-agent-modal";
import { motion } from "motion/react";

/* ─────────────────────────────────────────────
   Relative-time → compact form
   ("4 min ago" → "4m ago", "1 hour ago" → "1h ago")
   ───────────────────────────────────────────── */

function compactRelativeTime(value: string): string {
  return value
    .replace(/(\d+)\s*min(?:ute)?s?\s+ago/i, "$1m ago")
    .replace(/(\d+)\s*hours?\s+ago/i, "$1h ago")
    .replace(/(\d+)\s*days?\s+ago/i, "$1d ago");
}

/* ─────────────────────────────────────────────
   Sub-status pill
   ───────────────────────────────────────────── */

function SubStatusPill({ status }: { status: SubStatus }) {
  if (status === "synced")
    return (
      <span className="text-[9.9px] font-medium px-2 py-0.5 rounded-full bg-foreground text-background">
        Synced
      </span>
    );
  if (status === "syncing")
    return (
      <span
        className="flex items-center gap-1 w-fit text-[9.9px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
      >
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        Syncing
      </span>
    );
  if (status === "error")
    return (
      <span className="text-[9.9px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
        Error
      </span>
    );
  return (
    <span className="text-[9.9px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
      Paused
    </span>
  );
}

/* ─────────────────────────────────────────────
   Datasets tab — accordion (dataset → tables → columns)
   ───────────────────────────────────────────── */

const COL = "w-[80px] shrink-0";

function DatasetsTab({
  subs,
  subLabel,
}: {
  subs: SubConnection[];
  subLabel: string;
}) {
  const [expandedDatasets, setExpandedDatasets] = useState<Set<string>>(new Set());
  const [expandedTables,   setExpandedTables]   = useState<Set<string>>(new Set());
  const [activeIssues,     setActiveIssues]     = useState<ConnectorIssue[] | null>(null);
  const [versionOverrides,   setVersionOverrides]   = useState<Record<string, string>>({});
  const [versionDropdown,    setVersionDropdown]    = useState<string | null>(null);
  const [versionDropdownPos, setVersionDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  function toggleDataset(id: string) {
    setExpandedDatasets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleTable(id: string) {
    setExpandedTables(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <>
    {activeIssues && (
      <IssueModal issues={activeIssues} onClose={() => setActiveIssues(null)} />
    )}
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--connector-border)", background: "var(--connector-surface)" }}
    >
      {/* Dataset header */}
      <div
        className="flex items-center gap-[10px] px-4 py-3"
        style={{ background: "var(--sidebar)", borderBottom: "1px solid var(--connector-border)" }}
      >
        <span className={`flex-1 text-[9.9px] font-medium text-muted-foreground capitalize`}>{subLabel}</span>
        <span className={`${COL} text-[9.9px] font-medium text-muted-foreground`}>Version</span>
        <span className={`${COL} text-[9.9px] font-medium text-muted-foreground`}>Status</span>
        <span className={`${COL} text-[9.9px] font-medium text-muted-foreground`}>Tables</span>
        <span className={`${COL} text-[9.9px] font-medium text-muted-foreground`}>Last Sync</span>
        <span className={`${COL} text-[9.9px] font-medium text-muted-foreground`}>Added</span>
        <div className="w-4 shrink-0" />
      </div>

      {/* Dataset rows */}
      {subs.map((sub, idx) => {
        const isExpanded = expandedDatasets.has(sub.id);
        const tables = L2_DATASETS[sub.id]?.tables ?? [];
        const datasetIssues = getIssuesForDataset(sub.id);

        return (
          <div
            key={sub.id}
            className={`animate-fade-in-up ${idx < subs.length - 1 ? "border-b" : ""}`}
            style={{ borderColor: "var(--connector-border)", animationDelay: `${idx * 30}ms`, animationFillMode: "backwards" }}
          >
            {/* Dataset row — click to expand */}
            <button
              type="button"
              onClick={() => toggleDataset(sub.id)}
              className="flex items-center gap-[10px] w-full px-4 py-[10px] text-left transition-colors hover:bg-muted/20"
            >
              <div className="flex items-start gap-[10px] flex-1 min-w-0">
                <Database className="w-4 h-4 text-muted-foreground/50 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.6px] font-medium text-foreground truncate">{sub.name}</span>
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{
                        background:
                          sub.status === "synced"    ? "var(--foreground)"
                          : sub.status === "syncing" ? "var(--muted-foreground)"
                          : sub.status === "error"   ? "var(--foreground)"
                          : "var(--muted-foreground)",
                      }}
                    />
                    {datasetIssues.length > 0 && (
                      <IssuePill
                        issues={datasetIssues}
                        onClick={e => { e.stopPropagation(); setActiveIssues(datasetIssues); }}
                      />
                    )}
                  </div>
                  {sub.description && (
                    <span className="text-[10.8px] text-muted-foreground truncate">{sub.description}</span>
                  )}
                </div>
              </div>
              <div className={COL}>
                {sub.version ? (() => {
                  const selectedVersion = versionOverrides[sub.id] ?? sub.version;
                  const latestInGroup = [...subs].map(s => s.version).filter(Boolean).sort().at(-1);
                  const isDropdownOpen = versionDropdown === sub.id;
                  return (
                    <>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={e => {
                          e.stopPropagation();
                          if (!isDropdownOpen) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setVersionDropdownPos({ top: rect.bottom + 4, left: rect.left });
                          }
                          setVersionDropdown(isDropdownOpen ? null : sub.id);
                        }}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setVersionDropdown(isDropdownOpen ? null : sub.id); }}}
                        className="text-[10.8px] text-muted-foreground tabular-nums hover:underline underline-offset-2 decoration-muted-foreground/40 transition-colors cursor-pointer"
                      >
                        {selectedVersion}
                        {selectedVersion === latestInGroup && (
                          <span className="ml-1 text-[9.9px] text-muted-foreground/50">(Latest)</span>
                        )}
                      </span>
                      {isDropdownOpen && (
                        <>
                          {/* backdrop */}
                          <div className="fixed inset-0 z-40" onClick={() => setVersionDropdown(null)} />
                          <div
                            className="fixed z-50 rounded-lg py-1 shadow-md min-w-[110px]"
                            style={{ top: versionDropdownPos.top, left: versionDropdownPos.left, background: "var(--background)", border: "1px solid var(--border)" }}
                            onClick={e => e.stopPropagation()}
                          >
                            {["v1", "v2", "v3", "v4", "v5"].map(v => {
                              const isActive = v === "v5";
                              const isSelected = selectedVersion === v;
                              return (
                                <span
                                  key={v}
                                  role="button"
                                  tabIndex={0}
                                  onClick={e => { e.stopPropagation(); setVersionOverrides(prev => ({ ...prev, [sub.id]: v })); setVersionDropdown(null); }}
                                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setVersionOverrides(prev => ({ ...prev, [sub.id]: v })); setVersionDropdown(null); }}}
                                  className={`w-full text-left px-3 py-1.5 text-[10.8px] flex items-center justify-between gap-2 transition-colors hover:bg-muted/60 cursor-pointer ${isSelected ? "text-foreground font-medium" : "text-muted-foreground"}`}
                                >
                                  <span>{isActive ? `${v} (active)` : v}</span>
                                  {isSelected && <Check className="w-3 h-3 shrink-0" />}
                                </span>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </>
                  );
                })() : <span className="text-[10.8px] text-muted-foreground/40">—</span>}
              </div>
              <div className={COL}><SubStatusPill status={sub.status} /></div>
              <span className={`${COL} text-[10.8px] text-muted-foreground tabular-nums`}>{sub.tableCount ?? "—"}</span>
              <span className={`${COL} text-[10.8px] text-muted-foreground`}>{sub.lastSynced ? compactRelativeTime(sub.lastSynced) : "—"}</span>
              <span className={`${COL} text-[9.9px] text-muted-foreground/60`}>{sub.createdAt ? `${sub.createdAt} ago` : "—"}</span>
              <ChevronRight
                className="w-4 h-4 shrink-0 text-muted-foreground/30 transition-transform duration-200 ease-out"
                style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
              />
            </button>

            {/* ── Tables accordion ── */}
            <div
              className="grid"
              style={{
                gridTemplateRows: isExpanded ? "1fr" : "0fr",
                transition: "grid-template-rows 240ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="border-t" style={{ borderColor: "var(--connector-border)", background: "var(--connector-surface)" }}>
                  {/* Table list header */}
                  <div
                    className="flex items-center gap-[10px] pl-[40px] pr-4 py-2"
                    style={{ background: "var(--sidebar)", borderBottom: "1px solid var(--connector-border)" }}
                  >
                    <span className="flex-1 text-[9.9px] font-medium text-muted-foreground">Table</span>
                    <div className={COL} />{/* empty — aligns with dataset Version */}
                    <div className={COL} />{/* empty — aligns with dataset Status */}
                    <span className={`${COL} text-[9.9px] font-medium text-muted-foreground`}>Type</span>
                    <span className={`${COL} text-[9.9px] font-medium text-muted-foreground`}>Columns</span>
                    <span className={`${COL} text-[9.9px] font-medium text-muted-foreground`}>Rows</span>
                    <div className="w-4 shrink-0" />
                  </div>

                  {tables.length === 0 && (
                    <div className="pl-10 pr-4 py-3 text-[10.8px] text-muted-foreground">No tables found.</div>
                  )}

                  {tables.map((table, ti) => (
                    <TableAccordionRow
                      key={table.id}
                      table={table}
                      expanded={expandedTables.has(table.id)}
                      onToggle={() => toggleTable(table.id)}
                      last={ti === tables.length - 1}
                      datasetId={sub.id}
                      onViewIssues={setActiveIssues}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
    </>
  );
}

function TableAccordionRow({
  table,
  expanded,
  onToggle,
  last,
  datasetId,
  onViewIssues,
}: {
  table: TableDef;
  expanded: boolean;
  onToggle: () => void;
  last: boolean;
  datasetId: string;
  onViewIssues: (issues: ConnectorIssue[]) => void;
}) {
  const tableIssues = getIssuesForTable(datasetId, table.name);

  return (
    <div className={last ? "" : "border-b"} style={{ borderColor: "var(--connector-border)" }}>
      {/* Table row */}
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-[10px] w-full pl-[40px] pr-4 py-[10px] text-left hover:bg-muted/20 transition-colors group"
      >
        <div className="flex items-start gap-[10px] flex-1 min-w-0">
          <Table2 className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[11.7px] font-medium text-foreground">{table.name}</span>
              {tableIssues.length > 0 && (
                <IssuePill
                  issues={tableIssues}
                  onClick={e => { e.stopPropagation(); onViewIssues(tableIssues); }}
                />
              )}
            </div>
            <span className="text-[10.8px] text-muted-foreground truncate">{table.description}</span>
          </div>
        </div>
        <div className={COL} />{/* empty — aligns with dataset Status */}
        <div className={COL}>
          {table.type === "cube" ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[9.9px] font-medium bg-foreground text-background">Cube</span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[9.9px] font-medium bg-muted text-muted-foreground">View</span>
          )}
        </div>
        <span className={`${COL} text-[10.8px] text-muted-foreground tabular-nums`}>{table.columnCount}</span>
        <span className={`${COL} text-[10.8px] text-muted-foreground tabular-nums`}>{table.rowCount}</span>
        <ChevronRight
          className="w-4 h-4 shrink-0 text-muted-foreground/30 transition-transform duration-150 ease-out group-hover:text-muted-foreground/60"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>

      {/* ── Columns accordion ── */}
      <div
        className="grid"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t" style={{ borderColor: "var(--connector-border)" }}>
            {/* Column header */}
            <div
              className="flex items-center gap-[10px] pl-[64px] pr-4 py-1"
              style={{ background: "var(--sidebar)", borderBottom: "1px solid var(--connector-border)" }}
            >
              <span className="flex-1 text-[9.9px] font-medium text-muted-foreground">Column</span>
              <div className={COL} />{/* empty */}
              <div className={COL} />{/* empty */}
              <span className={`${COL} text-[9.9px] font-medium text-muted-foreground`}>Type</span>
              <span className={`${COL} text-[9.9px] font-medium text-muted-foreground`}>Member</span>
              <div className="w-4 shrink-0" />
            </div>
            {/* Column rows */}
            {table.columns.map((col, ci) => {
              const badge = getDataTypeBadge(col);
              return (
                <div
                  key={col.name}
                  className={`flex items-center gap-[10px] pl-[64px] pr-4 py-2 hover:bg-muted/10 transition-colors ${
                    ci < table.columns.length - 1 ? "border-b" : ""
                  }`}
                  style={{ borderColor: "var(--connector-border)" }}
                >
                  <div className="flex items-start gap-[10px] flex-1 min-w-0">
                    <ColumnIcon className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-[10.8px] text-foreground block">{col.name}</span>
                      {col.description && (
                        <span className="text-[10.8px] text-muted-foreground block truncate">{col.description}</span>
                      )}
                    </div>
                  </div>
                  <div className={COL} />{/* empty */}
                  <div className={COL} />{/* empty */}
                  <div className={COL}>
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[9.9px] font-medium"
                      style={{ background: badge.bg, color: badge.color }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <span className={`${COL} text-[10.8px] text-muted-foreground capitalize`}>{col.member}</span>
                  <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground/20" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Health tab (mock)
   ───────────────────────────────────────────── */

const RUN_HISTORY = [
  { id:  1, runType: "sync",  label: "Sync Completed",    status: "success", day: "today",     time: "12:19 PM", duration: "1m 12s", credits: 340,  issues: { errors: 0, warnings: 0 } },
  { id:  2, runType: "agent", label: "Anomaly Detection", status: "success", day: "today",     time: "11:53 AM", duration: "42s",    credits: 1240, issues: { errors: 0, warnings: 0 } },
  { id:  3, runType: "sync",  label: "Sync Completed",    status: "success", day: "today",     time: "11:23 AM", duration: "1m 08s", credits: 318,  issues: { errors: 0, warnings: 0 } },
  { id:  4, runType: "agent", label: "Anomaly Detection", status: "warning", day: "today",     time: "10:53 AM", duration: "47s",    credits: 1380, issues: { errors: 0, warnings: 2 } },
  { id:  5, runType: "agent", label: "Data Freshness",    status: "success", day: "today",     time: "10:23 AM", duration: "18s",    credits: 520,  issues: { errors: 0, warnings: 0 } },
  { id:  6, runType: "agent", label: "Anomaly Detection", status: "error",   day: "today",     time: "09:53 AM", duration: "60s",    credits: 90,   issues: { errors: 1, warnings: 0 } },
  { id:  7, runType: "sync",  label: "Sync Completed",    status: "success", day: "today",     time: "09:23 AM", duration: "1m 22s", credits: 361,  issues: { errors: 0, warnings: 0 } },
  { id:  8, runType: "agent", label: "Data Sync",         status: "success", day: "today",     time: "06:23 AM", duration: "9s",     credits: 180,  issues: { errors: 0, warnings: 0 } },
  { id:  9, runType: "sync",  label: "Sync Completed",    status: "warning", day: "today",     time: "06:18 AM", duration: "2m 05s", credits: 590,  issues: { errors: 0, warnings: 1 } },
  { id: 10, runType: "agent", label: "Schema Monitoring", status: "success", day: "today",     time: "04:23 AM", duration: "12s",    credits: 290,  issues: { errors: 0, warnings: 0 } },
  { id: 11, runType: "agent", label: "Data Freshness",    status: "success", day: "today",     time: "04:18 AM", duration: "21s",    credits: 540,  issues: { errors: 0, warnings: 0 } },
  { id: 12, runType: "sync",  label: "Sync Completed",    status: "success", day: "today",     time: "03:23 AM", duration: "1m 15s", credits: 327,  issues: { errors: 0, warnings: 0 } },
  { id: 13, runType: "sync",  label: "Sync Completed",    status: "success", day: "today",     time: "12:18 AM", duration: "1m 10s", credits: 312,  issues: { errors: 0, warnings: 0 } },
  { id: 14, runType: "sync",  label: "Sync Completed",    status: "success", day: "yesterday", time: "12:05 PM", duration: "1m 18s", credits: 349,  issues: { errors: 0, warnings: 0 } },
];

const DAY_LABELS: Record<string, string> = {
  today:     "Today: Thursday, 9 April 2026",
  yesterday: "Yesterday: Wednesday, 8 April 2026",
};

function CreditsTag({ credits }: { credits: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9.9px] text-muted-foreground tabular-nums shrink-0">
      <Zap className="w-3 h-3 shrink-0" />
      {credits.toLocaleString()}
    </span>
  );
}

function HealthTab() {
  return (
    <div>
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--connector-border)", background: "var(--connector-surface)" }}
      >
        {/* Header */}
        <div
          className="grid grid-cols-[1fr_72px_130px_80px_90px_100px] gap-4 px-4 py-2.5"
          style={{ background: "var(--sidebar)", borderBottom: "1px solid var(--connector-border)" }}
        >
          {["Event", "Type", "Issues", "Duration", "Credits", "Time"].map(h => (
            <span key={h} className="text-[9.9px] font-medium text-muted-foreground">{h}</span>
          ))}
        </div>
        {/* Rows grouped by day */}
        <div className="divide-y" style={{ borderColor: "var(--connector-border)" }}>
          {RUN_HISTORY.reduce<React.ReactNode[]>((acc, ev, i) => {
            const prevDay = i > 0 ? RUN_HISTORY[i - 1].day : null;
            if (ev.day !== prevDay) {
              acc.push(
                <div
                  key={`day-${ev.day}`}
                  className="px-4 py-2 border-b"
                  style={{ borderColor: "var(--connector-border)", background: "var(--connector-surface)" }}
                >
                  <span className="text-[9.9px] font-semibold text-muted-foreground/60 tracking-wide">
                    {DAY_LABELS[ev.day] ?? ev.day}
                  </span>
                </div>
              );
            }
            acc.push(
              <div key={ev.id} className="grid grid-cols-[1fr_72px_130px_80px_90px_100px] gap-4 items-center px-4 py-3">
                {/* Event label + status icon */}
                <div className="flex items-center gap-2 min-w-0">
                  {ev.status === "success" ? (
                    <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                  ) : ev.status === "warning" ? (
                    <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <X className="w-3.5 h-3.5 text-foreground shrink-0" />
                  )}
                  <span className="text-[11.7px] text-foreground truncate">{ev.label}</span>
                </div>
                {/* Type badge */}
                <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[9.9px] font-medium w-fit bg-muted text-muted-foreground capitalize">
                  {ev.runType}
                </span>
                {/* Issues badge */}
                {ev.issues.errors > 0 ? (
                  <span className="inline-flex items-center gap-1.5 pl-1.5 pr-0.5 py-0.5 rounded-full text-[9.9px] font-medium bg-muted text-muted-foreground w-fit">
                    Error
                    <span className="inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[9px] font-semibold bg-muted-foreground/20">
                      {ev.issues.errors}
                    </span>
                  </span>
                ) : ev.issues.warnings > 0 ? (
                  <span className="inline-flex items-center gap-1.5 pl-1.5 pr-0.5 py-0.5 rounded-full text-[9.9px] font-medium bg-muted text-muted-foreground w-fit">
                    Warning
                    <span className="inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[9px] font-semibold bg-muted-foreground/20">
                      {ev.issues.warnings}
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full text-[9.9px] font-medium bg-foreground text-background w-fit">
                    None
                  </span>
                )}
                {/* Duration */}
                <span className="text-[10.8px] text-muted-foreground tabular-nums">{ev.duration}</span>
                {/* Credits */}
                <CreditsTag credits={ev.credits} />
                {/* Timestamp */}
                <span className="text-[10.8px] text-muted-foreground tabular-nums">{ev.time}</span>
              </div>
            );
            return acc;
          }, [])}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Monitors tab (mock)
   ───────────────────────────────────────────── */

const MOCK_MONITORS = [
  { id: 1, name: "Null rate: user_id",       target: "analytics_prod · ga4_events",     metric: "Null %",        threshold: "< 0.1%",   value: "0.03%",  status: "passing" },
  { id: 2, name: "Row count drift",           target: "analytics_prod · ga4_events",     metric: "Δ rows (24h)",  threshold: "< ±20%",   value: "+4.1%",  status: "passing" },
  { id: 3, name: "Revenue not null",          target: "analytics_prod · revenue_events", metric: "Null %",        threshold: "< 0.01%",  value: "0.00%",  status: "passing" },
  { id: 4, name: "Freshness: daily load",     target: "marketing_attribution",           metric: "Hours since sync", threshold: "< 2h",  value: "0.5h",   status: "passing" },
  { id: 5, name: "Schema drift",              target: "user_events_raw",                 metric: "Column changes", threshold: "= 0",     value: "0",      status: "passing" },
];

function MonitorsTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">5 monitors · all passing</span>
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11.7px] font-medium border border-border rounded-lg bg-background hover:bg-muted/50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Monitor
        </button>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--connector-border)" }}
      >
        <div
          className="grid grid-cols-[2fr_2fr_1fr_1fr_80px] gap-4 px-4 py-2.5"
          style={{ background: "var(--connector-surface)", borderBottom: "1px solid var(--connector-border)" }}
        >
          {["Monitor", "Target", "Metric", "Threshold", "Status"].map((h) => (
            <span key={h} className="text-[9.9px] text-muted-foreground font-medium">{h}</span>
          ))}
        </div>
        {MOCK_MONITORS.map((m, i) => (
          <div
            key={m.id}
            className={`grid grid-cols-[2fr_2fr_1fr_1fr_80px] gap-4 px-4 py-3 items-center ${
              i < MOCK_MONITORS.length - 1 ? "border-b" : ""
            } hover:bg-muted/20 transition-colors`}
            style={{ borderColor: "var(--connector-border)" }}
          >
            <span className="text-sm font-medium text-foreground">{m.name}</span>
            <span className="text-xs text-muted-foreground truncate">{m.target}</span>
            <span className="text-xs text-muted-foreground">{m.metric}</span>
            <span className="text-xs font-mono text-muted-foreground">{m.threshold}</span>
            <span className="flex items-center gap-1.5 text-[9.9px] font-medium text-foreground">
              <Check className="w-3 h-3" />
              {m.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Agents tab (mock)
   ───────────────────────────────────────────── */

const DEFAULT_AGENTS = [
  {
    id: 1,
    name: "Anomaly Detection",
    agentName: "Data Quality Agent",
    description: "Detects null rate spikes, row count drops, type mismatches, and duplicate records on every sync.",
    schedule: "Every hour",
    lastRun: "30m ago",
    nextRun: "30m",
    credits: 1240,
    status: "active",
  },
  {
    id: 2,
    name: "Schema Monitoring",
    agentName: "Schema Anomaly Agent",
    description: "Watches for column additions, removals, and type changes across all connected datasets.",
    schedule: "Every day 2:00 AM",
    lastRun: "8h ago",
    nextRun: "16h",
    credits: 290,
    status: "active",
  },
  {
    id: 3,
    name: "Data Freshness",
    agentName: "Freshness Agent",
    description: "Alerts when a table hasn't updated within its expected sync cadence.",
    schedule: "Every 6 hours",
    lastRun: "2h ago",
    nextRun: "4h",
    credits: 520,
    status: "active",
  },
  {
    id: 4,
    name: "Data Sync",
    agentName: "Data Sync Agent",
    description: "Monitors connector sync failures, retries, and partial loads. Restarts failed syncs automatically.",
    schedule: "Every day 4:00 AM",
    lastRun: "6h ago",
    nextRun: "18h",
    credits: 180,
    status: "active",
  },
];

const AG_COLS = "grid-cols-[2fr_140px_80px_80px_120px_130px_44px]";

/* ── Edit pencil icon ── */
function PencilIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5Z" />
      <path d="M10 4l2 2" />
    </svg>
  );
}

/* ── Edit agent modal ── */
type AgentDraft = { id: number; name: string; description: string };

function EditAgentModal({
  agent,
  onClose,
  onSave,
}: {
  agent: AgentDraft;
  onClose: () => void;
  onSave: (draft: AgentDraft) => void;
}) {
  const [name, setName]           = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [improving, setImproving] = useState(false);

  function handleImprove() {
    setImproving(true);
    // Simulate AI improvement delay
    setTimeout(() => {
      setDescription(d => d.trimEnd() + (d.endsWith(".") ? " It runs continuously and escalates critical findings immediately." : ". It runs continuously and escalates critical findings immediately."));
      setImproving(false);
    }, 1200);
  }

  return (
    <div
      className="fixed inset-0 bg-background/60 backdrop-blur-[2px] flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <motion.div
        className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-[600px] h-[480px] overflow-hidden flex flex-col"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <span className="text-[11.7px] font-medium text-foreground">Edit Agent</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10.8px] font-medium text-muted-foreground">Name</label>
              <span className={`text-[9.9px] tabular-nums ${name.length > 180 ? "text-foreground" : "text-muted-foreground/50"}`}>
                {name.length} / 200
              </span>
            </div>
            <input
              type="text"
              value={name}
              maxLength={200}
              onChange={e => setName(e.target.value)}
              className="w-full text-[11.7px] bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-[10.8px] font-medium text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={5}
              className="w-full text-[11.7px] bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none leading-relaxed"
            />
            {/* Improve with AI */}
            <button
              type="button"
              onClick={handleImprove}
              disabled={improving}
              className="flex items-center gap-1.5 text-[10.8px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {improving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                  <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z"/>
                  <path d="M13 1l.75 2.25L16 4l-2.25.75L13 7l-.75-2.25L10 4l2.25-.75z" opacity=".5"/>
                </svg>
              )}
              {improving ? "Improving…" : "Improve with AI"}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[11.7px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { onSave({ id: agent.id, name: name.trim() || agent.name, description }); onClose(); }}
            className="px-4 py-2 text-[11.7px] font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
          >
            Save
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function AgentsTab() {
  const [schedules, setSchedules] = useState<Record<number, string>>(
    () => Object.fromEntries(DEFAULT_AGENTS.map(a => [a.id, a.schedule]))
  );
  const [enabled, setEnabled] = useState<Record<number, boolean>>(
    () => Object.fromEntries(DEFAULT_AGENTS.map(a => [a.id, true]))
  );
  const [agentOverrides, setAgentOverrides] = useState<Record<number, { name: string; description: string }>>({});
  const [schedulerOpen,    setSchedulerOpen]    = useState<{ id: number; name: string } | null>(null);
  const [activeIssues,     setActiveIssues]     = useState<ConnectorIssue[] | null>(null);
  const [editingAgent,     setEditingAgent]     = useState<AgentDraft | null>(null);
  const [createAgentOpen,  setCreateAgentOpen]  = useState(false);
  const [customAgents,     setCustomAgents]     = useState<(NewAgent & { id: number })[]>([]);

  const allAgents = [
    ...DEFAULT_AGENTS,
    ...customAgents.map(a => ({
      id: a.id,
      name: a.name,
      agentName: a.name,
      description: a.description,
      schedule: a.schedule,
      lastRun: "—",
      nextRun: "—",
      status: "active" as const,
    })),
  ];

  return (
    <>
    {activeIssues && (
      <IssueModal issues={activeIssues} onClose={() => setActiveIssues(null)} />
    )}
    {editingAgent && (
      <EditAgentModal
        agent={editingAgent}
        onClose={() => setEditingAgent(null)}
        onSave={draft => setAgentOverrides(prev => ({ ...prev, [draft.id]: { name: draft.name, description: draft.description } }))}
      />
    )}
    {createAgentOpen && (
      <CreateAgentModal
        onClose={() => setCreateAgentOpen(false)}
        onCreate={agent => {
          const newId = Date.now();
          setCustomAgents(prev => [...prev, { ...agent, id: newId }]);
          setEnabled(prev => ({ ...prev, [newId]: true }));
          setSchedules(prev => ({ ...prev, [newId]: agent.schedule }));
        }}
      />
    )}
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {allAgents.length} agents · {Object.values(enabled).filter(Boolean).length} active
        </span>
        <button
          type="button"
          onClick={() => setCreateAgentOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11.7px] font-medium border border-border rounded-lg bg-background hover:bg-muted/50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Agent
        </button>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--connector-border)", background: "var(--connector-surface)" }}
      >
        {/* Header */}
        <div
          className={`grid ${AG_COLS} gap-4 px-4 py-2.5`}
          style={{ background: "var(--sidebar)", borderBottom: "1px solid var(--connector-border)" }}
        >
          {["Agent", "Schedule", "Last Run", "Next Run", "Credits", "Issues", ""].map((h) => (
            <span key={h} className="text-[9.9px] font-medium text-muted-foreground">{h}</span>
          ))}
        </div>

        {/* Rows */}
        {allAgents.map((a, idx) => (
          <div
            key={a.id}
            className={`grid ${AG_COLS} gap-4 items-center px-4 py-3 animate-fade-in-up ${
              idx < allAgents.length - 1 ? "border-b" : ""
            }`}
            style={{
              borderColor: "var(--connector-border)",
              animationDelay: `${idx * 30}ms`,
              animationFillMode: "backwards",
            }}
          >
            {/* Name + description */}
            <div className="flex items-start gap-2.5 min-w-0 group/agent">
              <AgentsIcon className="w-4 h-4 text-muted-foreground/50 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => setEditingAgent({ id: a.id, name: agentOverrides[a.id]?.name ?? a.name, description: agentOverrides[a.id]?.description ?? a.description })}
                  className="flex items-center gap-1.5 text-left group/name"
                >
                  <span className="text-sm font-medium text-foreground">{agentOverrides[a.id]?.name ?? a.name}</span>
                  <PencilIcon className="w-3 h-3 text-muted-foreground/40 opacity-0 group-hover/agent:opacity-100 transition-opacity shrink-0" />
                </button>
                <span className="text-xs font-normal text-muted-foreground leading-tight block mt-0.5">{agentOverrides[a.id]?.description ?? a.description}</span>
              </div>
            </div>

            {/* Schedule trigger */}
            <button
              type="button"
              onClick={() => setSchedulerOpen({ id: a.id, name: a.name })}
              className="text-[10.8px] text-muted-foreground text-left hover:underline underline-offset-2 decoration-muted-foreground/40 transition-colors hover:text-foreground"
            >
              {schedules[a.id]}
            </button>

            {/* Last run */}
            <span className="text-[10.8px] text-muted-foreground tabular-nums">{a.lastRun}</span>

            {/* Next run */}
            <span className="text-[10.8px] text-muted-foreground tabular-nums">in {a.nextRun}</span>

            {/* Credits */}
            {"credits" in a && a.credits != null
              ? <CreditsTag credits={a.credits as number} />
              : <span className="text-[10.8px] text-muted-foreground/40">—</span>
            }

            {/* Issues badge */}
            {(() => {
              const issues = MOCK_ISSUES.filter(i => i.agentName === a.agentName);
              const errors   = issues.filter(i => i.severity === "error").length;
              const warnings = issues.filter(i => i.severity === "warning").length;
              if (errors > 0)
                return (
                  <span
                    className="inline-flex items-center gap-1.5 pl-1.5 pr-0.5 py-0.5 rounded-full text-[9.9px] font-medium bg-muted text-muted-foreground w-fit cursor-pointer"
                    onClick={() => setActiveIssues(issues.filter(i => i.severity === "error"))}
                  >
                    Error
                    <span className="inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[9px] font-semibold bg-muted-foreground/20">
                      {errors}
                    </span>
                  </span>
                );
              if (warnings > 0)
                return (
                  <span
                    className="inline-flex items-center gap-1.5 pl-1.5 pr-0.5 py-0.5 rounded-full text-[9.9px] font-medium bg-muted text-muted-foreground w-fit cursor-pointer"
                    onClick={() => setActiveIssues(issues.filter(i => i.severity === "warning"))}
                  >
                    Warning
                    <span className="inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[9px] font-semibold bg-muted-foreground/20">
                      {warnings}
                    </span>
                  </span>
                );
              return (
                <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full text-[9.9px] font-medium bg-foreground text-background w-fit">
                  None
                </span>
              );
            })()}

            {/* Toggle */}
            <Switch
              size="sm"
              checked={enabled[a.id]}
              onCheckedChange={v => setEnabled(prev => ({ ...prev, [a.id]: v }))}
            />
          </div>
        ))}
      </div>

      {schedulerOpen && (
        <SchedulerModal
          open={!!schedulerOpen}
          onOpenChange={open => { if (!open) setSchedulerOpen(null); }}
          agentName={schedulerOpen.name}
          currentSchedule={schedules[schedulerOpen.id]}
          onSave={v => setSchedules(prev => ({ ...prev, [schedulerOpen.id]: v }))}
        />
      )}
    </div>
    </>
  );
}

/* ─────────────────────────────────────────────
   Coverage tab (mock)
   ───────────────────────────────────────────── */

const COVERAGE_AREAS = [
  { name: "Acquisition",      score: 94, tables: 8 },
  { name: "Engagement",       score: 82, tables: 12 },
  { name: "Retention",        score: 71, tables: 6 },
  { name: "Revenue",          score: 88, tables: 9 },
  { name: "Product Funnel",   score: 63, tables: 5 },
  { name: "Marketing Mix",    score: 77, tables: 7 },
];

function CoverageTab() {
  const overall = Math.round(
    COVERAGE_AREAS.reduce((s, a) => s + a.score, 0) / COVERAGE_AREAS.length
  );

  return (
    <div className="space-y-6">
      {/* Per-area breakdown */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--connector-border)", background: "var(--connector-surface)" }}
      >
        <div
          className="grid grid-cols-[2fr_1fr_80px] gap-4 px-4 py-2.5"
          style={{ background: "var(--sidebar)", borderBottom: "1px solid var(--connector-border)" }}
        >
          {["Feature Area", "Tables", "Coverage"].map((h) => (
            <span key={h} className="text-[9.9px] text-muted-foreground font-medium">{h}</span>
          ))}
        </div>
        {COVERAGE_AREAS.map((area, i) => (
          <div
            key={area.name}
            className={`grid grid-cols-[2fr_1fr_80px] gap-4 px-4 py-3 items-center ${
              i < COVERAGE_AREAS.length - 1 ? "border-b" : ""
            }`}
            style={{ borderColor: "var(--connector-border)" }}
          >
            <span className="text-sm text-foreground">{area.name}</span>
            <span className="text-xs text-muted-foreground">{area.tables} Tables</span>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${area.score}%`,
                    background:
                      area.score >= 80
                        ? "var(--foreground)"
                        : area.score >= 60
                        ? "var(--muted-foreground)"
                        : "var(--muted-foreground)",
                  }}
                />
              </div>
              <span className="text-[9.9px] text-muted-foreground tabular-nums w-8 text-right">
                {area.score}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Page
   ───────────────────────────────────────────── */

const TABS = [
  { id: "datasets", label: "Datasets", icon: Database   },
  { id: "agents",   label: "Agents",   icon: AgentsIcon },
  { id: "coverage", label: "Coverage", icon: BarChart3  },
  { id: "history",  label: "History",  icon: Activity   },
] as const;

type Tab = typeof TABS[number]["id"];

export default function ConnectorDetailPage() {
  const { connectorId } = useParams<{ connectorId: string }>();
  const router          = useRouter();
  const connection      = findConnection(connectorId as string);

  const [activeTab,    setActiveTab]    = useState<Tab>("datasets");
  const [refreshing,   setRefreshing]   = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  function handleRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  }

  if (!connection) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Connector not found.</p>
        <button
          type="button"
          onClick={() => router.push("/connectors")}
          className="text-sm text-foreground underline underline-offset-2"
        >
          Back to Connectors
        </button>
      </div>
    );
  }

  const subLabel      = getSubLabel(connection.categoryId);
  const syncingCount  = connection.subConnections.filter((s) => s.status === "syncing").length;
  const errorCount    = connection.subConnections.filter((s) => s.status === "error").length;

  // Dynamic dataset label for tab
  const datasetTabLabel =
    subLabel === "dataset" ? "Datasets"
    : subLabel === "app"   ? "Apps"
    : subLabel === "account" ? "Accounts"
    : "Connections";

  const tabs = TABS.map((t) =>
    t.id === "datasets" ? { ...t, label: datasetTabLabel } : t
  );

  return (
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 w-full">

          {/* ── Page header ── */}
          <div
            className="mb-6 animate-fade-in-up"
            style={{ animationDelay: "0ms", animationFillMode: "backwards" }}
          >
            {/* Back + action row */}
            <div className="flex items-center gap-3 mb-5">
              <button
                type="button"
                onClick={() => router.push("/connectors")}
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Connectors
              </button>

              <div className="ml-auto flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium border border-border rounded-md bg-background hover:bg-muted/50 transition-colors disabled:opacity-50"
                  style={{ transition: "transform 0.2s ease" }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                  onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
                  onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
                  onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setAddModalOpen(true)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 transition-colors"
                  style={{ transition: "transform 0.2s ease" }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                  onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
                  onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
                  onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add {subLabel.charAt(0).toUpperCase() + subLabel.slice(1)}
                </button>
              </div>
            </div>

            {/* Connector identity */}
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "var(--connector-icon-bg)", border: "1px solid var(--connector-border)" }}
              >
                <ConnectorLogo name={connection.name} size={32} />
              </div>
              <div>
                <h1 className="text-xl font-semibold">{connection.name}</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm text-muted-foreground">{connection.connectionName}</span>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="text-sm text-muted-foreground">
                    {connection.subConnections.length} {subLabel}
                    {connection.subConnections.length !== 1 ? "s" : ""}
                  </span>
                  {connection.refreshedAt && (
                    <>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="text-xs text-muted-foreground">Refreshed {connection.refreshedAt}</span>
                    </>
                  )}
                  {errorCount > 0 && (
                    <span className="flex items-center gap-1 text-[9.9px] font-medium text-foreground">
                      <AlertCircle className="w-3 h-3" />
                      {errorCount} error{errorCount > 1 ? "s" : ""}
                    </span>
                  )}
                  {syncingCount > 0 && errorCount === 0 && (
                    <span className="flex items-center gap-1 text-[9.9px] font-medium text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {syncingCount} syncing
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div
            className="flex items-center gap-1 mb-6 border-b border-border animate-fade-in-up"
            style={{ animationDelay: "40ms", animationFillMode: "backwards" }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
                {tab.id === "datasets" && getIssuesForConnector(connection.name).length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
                )}
              </button>
            ))}
          </div>

          {/* ── Tab description ── */}
          {{
            datasets: `All ${subLabel}s connected under ${connection.connectionName}. Click any ${subLabel} to explore its tables and schema.`,
            agents:   "Monitors and scheduled jobs that watch this connector's data quality and run automated sweeps.",
            coverage: "How much of the recommended event schema is actually instrumented across your feature areas.",
            history:  "Sync history, uptime, and error events for this connector over the last 7 days.",
          }[activeTab] && (
            <p
              className="text-sm text-muted-foreground mb-5 animate-fade-in-up"
              style={{ animationDelay: "50ms", animationFillMode: "backwards" }}
            >
              {{
                datasets: `All ${subLabel}s connected under ${connection.connectionName}. Click any ${subLabel} to explore its tables and schema.`,
                agents:   "Monitors and scheduled jobs that watch this connector's data quality and run automated sweeps.",
                coverage: "How much of the recommended event schema is actually instrumented across your feature areas.",
                history:  "Sync history, uptime, and error events for this connector over the last 7 days.",
              }[activeTab]}
            </p>
          )}

          {/* ── Tab content ── */}
          <div
            key={activeTab}
            className="animate-fade-in-up"
            style={{
              animationDelay: "60ms",
              animationFillMode: "backwards",
              opacity: refreshing ? 0.4 : 1,
              transition: "opacity 0.3s ease",
            }}
          >
            {activeTab === "datasets" && (
              <DatasetsTab
                subs={connection.subConnections}
                subLabel={subLabel}
              />
            )}
            {activeTab === "agents"   && <AgentsTab />}
            {activeTab === "coverage" && <CoverageTab />}
            {activeTab === "history"  && <HealthTab />}
          </div>

        </div>
      </main>

      {addModalOpen && (() => {
        const category = CONNECTOR_CATEGORIES.find((c) => c.id === connection.categoryId);
        if (!category) return null;
        return (
          <ConnectorModal
            name={connection.name}
            category={category}
            onClose={() => setAddModalOpen(false)}
            onContinue={() => setAddModalOpen(false)}
          />
        );
      })()}
    </div>
  );
}
