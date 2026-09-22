"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Search,
  RefreshCw,
  Plus,
  ChevronDown,
  ChevronRight,
  Loader2,
  LayoutList,
  Network,
  Check,
  Sparkles,
  Trash2,
  X,
  Table2,
} from "lucide-react";
import {
  L2_DATASETS,
  getDataTypeBadge,
  type TableType,
  type ColType,
  type MemberType,
  type TableStatus,
  type ColumnDef,
  type TableDef,
  type DatasetDetail,
} from "@/lib/connector-dataset-tables";


const ALL_DATASETS = Object.entries(L2_DATASETS).map(([id, d]) => ({
  id,
  datasetName: d.datasetName,
  connectorName: d.connectorName,
}));

// Grouped by connector for the dropdown headings
const ALL_DATASETS_GROUPED = Object.entries(
  ALL_DATASETS.reduce<Record<string, typeof ALL_DATASETS>>((acc, ds) => {
    if (!acc[ds.connectorName]) acc[ds.connectorName] = [];
    acc[ds.connectorName].push(ds);
    return acc;
  }, {})
);

/* ─────────────────────────────────────────────
   Badge helpers
   ───────────────────────────────────────────── */

function TableTypeBadge({ type }: { type: TableType }) {
  if (type === "cube") {
    return (
      <span className="inline-flex items-center w-fit px-1.5 leading-4 rounded-[4px] text-[9.9px] font-medium bg-foreground text-background">
        Cube
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 leading-4 rounded-[4px] text-[9.9px] font-medium bg-muted text-muted-foreground">
      View
    </span>
  );
}

function StatusBadge({ status }: { status: TableStatus }) {
  if (status === "clean") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[9.9px] font-medium bg-foreground text-background">
        Clean
      </span>
    );
  }
  if (status === "syncing") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9.9px] font-medium bg-muted text-muted-foreground">
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        Syncing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[9.9px] font-medium bg-muted text-muted-foreground">
      Warning
    </span>
  );
}

function ColTypeBadge({ col }: { col: ColumnDef }) {
  const { label, bg, color } = getDataTypeBadge(col);
  return (
    <span
      className="inline-flex items-center w-fit px-1.5 py-0.5 rounded-[4px] text-[9.9px] font-medium leading-4"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

/* ─────────────────────────────────────────────
   Column table header + rows
   ───────────────────────────────────────────── */

function ColumnsTable({ columns }: { columns: ColumnDef[] }) {
  return (
    <div className="border-t border-border">
      {/* Column header */}
      <div className="grid grid-cols-[2fr_80px_90px_3fr_48px] gap-x-4 px-8 py-2" style={{ background: "var(--connector-surface)", borderBottom: "1px solid var(--connector-border)" }}>
        <span className="text-[9.9px] font-medium text-muted-foreground">Column</span>
        <span className="text-[9.9px] font-medium text-muted-foreground">Type</span>
        <span className="text-[9.9px] font-medium text-muted-foreground">Member</span>
        <span className="text-[9.9px] font-medium text-muted-foreground">Description</span>
        <span className="text-[9.9px] font-medium text-muted-foreground">Keys</span>
      </div>
      {columns.map((col, i) => (
        <div
          key={col.name}
          className={`grid grid-cols-[2fr_80px_90px_3fr_48px] gap-x-4 px-8 py-2.5 items-center ${
            i < columns.length - 1 ? "border-b border-border/60" : ""
          } hover:bg-muted/20 transition-colors`}
        >
          <span className="font-mono text-[10.8px] truncate" style={{ color: "var(--foreground)" }}>{col.name}</span>
          <ColTypeBadge col={col} />
          <span className="text-[10.8px] capitalize" style={{ color: "var(--muted-foreground)" }}>{col.member}</span>
          <span className="text-[10.8px] truncate" style={{ color: "var(--muted-foreground)" }}>{col.description}</span>
          <div className="flex justify-center">
            {col.isPrimaryKey && (
              <span className="text-[9.9px] font-medium rounded-[4px] px-1.5 py-0 bg-muted text-muted-foreground">PK</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Table row (expandable)
   ───────────────────────────────────────────── */

function TableRow({
  table,
  expanded,
  onToggle,
  animDelay,
}: {
  table: TableDef;
  expanded: boolean;
  onToggle: () => void;
  animDelay: number;
}) {
  return (
    <div
      className="border-b border-border last:border-b-0 animate-fade-in-up"
      style={{ animationDelay: `${animDelay}ms`, animationFillMode: "backwards" }}
    >
      {/* Header row — clickable */}
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-4 w-full px-4 py-3 text-left group"
        style={{ transition: "transform 0.2s ease" }}
        onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
        onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
        onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
        onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
        onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
      >
        {/* Table icon */}
        <Table2 className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />

        {/* Table name + description */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{table.name}</span>
          <span className="text-xs text-muted-foreground truncate">{table.description}</span>
        </div>

        {/* Meta — widths mirror the table header */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-[72px]"><TableTypeBadge type={table.type} /></div>
          <span className="text-[10.8px] tabular-nums w-16" style={{ color: "var(--muted-foreground)" }}>{table.columnCount}</span>
          <span className="text-[10.8px] tabular-nums w-16" style={{ color: "var(--muted-foreground)" }}>{table.rowCount}</span>
          <span className="text-[10.8px] tabular-nums w-20" style={{ color: "var(--muted-foreground)" }}>—</span>
          <div className="w-[80px]"><StatusBadge status={table.status} /></div>
        </div>

        {/* Expand chevron */}
        <ChevronRight
          className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 transition-transform duration-200 ease-out group-hover:text-muted-foreground/70"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>

      {/* Expandable columns — CSS grid trick */}
      <div
        className="grid"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transition: "grid-template-rows 220ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <ColumnsTable columns={table.columns} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Schema table card
   ───────────────────────────────────────────── */


function SchemaTableCard({ table, dataset }: { table: TableDef; dataset: DatasetDetail }) {
  const needsTruncate = table.description.length > 110;

  return (
    <div
      className="w-[278px] shrink-0 flex flex-col gap-3 p-1.5 rounded-xl max-h-[480px] overflow-hidden"
      style={{ background: "var(--schema-card-bg)", boxShadow: "0px 4px 20px 0px rgba(0,0,0,0.10)", zoom: 0.7 }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-[10px]"
        style={{ background: "var(--schema-card-header-bg)" }}
      >
        <span
          className="border px-2 py-1 rounded-md text-[10.8px] shrink-0"
          style={{ borderColor: "var(--connector-tile-border)", color: "var(--muted-foreground)" }}
        >
          {dataset.connectorName}
        </span>
        <span className="text-[12.6px] truncate flex-1" style={{ color: "var(--foreground)" }}>
          {table.name}
        </span>
      </div>

      {/* Info */}
      <div className="px-2 flex flex-col gap-2">
        <span className="text-[10.8px]" style={{ color: "var(--muted-foreground)" }}>Created 5d ago · Refreshed 5m ago</span>

        {/* Description with inline ...more */}
        <div className="relative overflow-hidden" style={{ maxHeight: "32px" }}>
          <p className="text-[11.7px] leading-4" style={{ color: "var(--foreground)" }}>
            {table.description}
          </p>
          {needsTruncate && (
            <div
              className="absolute bottom-0 right-0 pl-6"
              style={{ background: "linear-gradient(to right, transparent, var(--schema-card-gradient) 40%)" }}
            >
              <span className="text-[11.7px] font-medium" style={{ color: "var(--connector-link)" }}>...more</span>
            </div>
          )}
        </div>

        {/* Ask AI button */}
        <button
          type="button"
          className="flex items-center gap-1 border rounded-lg h-8 px-3 w-fit hover:bg-black/[0.03] transition-colors"
          style={{ borderColor: "var(--connector-tile-border)", color: "var(--foreground)" }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
              <path d="M4.76116 8.09995C4.70759 7.89231 4.59937 7.70282 4.44774 7.55119C4.29611 7.39956 4.10662 7.29133 3.89898 7.23777L0.218079 6.28859C0.15528 6.27077 0.100008 6.23294 0.060651 6.18086C0.021294 6.12878 0 6.06528 0 6C0 5.93472 0.021294 5.87122 0.060651 5.81914C0.100008 5.76705 0.15528 5.72923 0.218079 5.71141L3.89898 4.76163C4.10655 4.70812 4.29599 4.59998 4.44761 4.44846C4.59923 4.29694 4.7075 4.10758 4.76116 3.90005L5.71034 0.219144C5.72798 0.156097 5.76576 0.100552 5.81792 0.0609847C5.87009 0.0214174 5.93376 0 5.99923 0C6.0647 0 6.12837 0.0214174 6.18053 0.0609847C6.23269 0.100552 6.27048 0.156097 6.28812 0.219144L7.2367 3.90005C7.29026 4.10769 7.39849 4.29718 7.55012 4.44881C7.70175 4.60044 7.89124 4.70867 8.09887 4.76223L11.7798 5.71081C11.8431 5.72827 11.8989 5.76601 11.9387 5.81825C11.9785 5.87049 12 5.93434 12 6C12 6.06566 11.9785 6.12951 11.9387 6.18175C11.8989 6.23399 11.8431 6.27173 11.7798 6.28919L8.09887 7.23777C7.89124 7.29133 7.70175 7.39956 7.55012 7.55119C7.39849 7.70282 7.29026 7.89231 7.2367 8.09995L6.28752 11.7809C6.26988 11.8439 6.23209 11.8994 6.17993 11.939C6.12777 11.9786 6.0641 12 5.99863 12C5.93316 12 5.86949 11.9786 5.81733 11.939C5.76516 11.8994 5.72738 11.8439 5.70974 11.7809L4.76116 8.09995Z" fill="currentColor"/>
            </svg>
          <span className="text-[12.6px] font-medium">Ask AI About Table</span>
        </button>
      </div>

      {/* Columns */}
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        {/* Table header */}
        <div className="flex items-center justify-between px-2 py-2">
          <span className="text-[10.8px]" style={{ color: "var(--muted-foreground)" }}>Column</span>
          <span className="text-[10.8px]" style={{ color: "var(--muted-foreground)" }}>Data Type</span>
        </div>

        {/* Rows */}
        {table.columns.map((col, i) => {
          const badge = getDataTypeBadge(col);
          return (
            <div key={col.name}>
              {i > 0 && <div className="border-t" style={{ borderColor: "var(--connector-tile-border)" }} />}
              <div className="flex items-center justify-between px-2 py-2">
                <div className="flex items-center gap-1 min-w-0">
                  {col.isPrimaryKey && (
                    <span className="text-[11.7px] leading-none shrink-0">🔑</span>
                  )}
                  <span className="font-mono text-[10.8px] truncate" style={{ color: "var(--foreground)" }}>
                    {col.name}
                  </span>
                  {col.isPrimaryKey && (
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
                  )}
                </div>
                <span
                  className="shrink-0 text-[9.9px] px-1.5 leading-4 rounded-[4px] font-medium"
                  style={{ background: badge.bg, color: badge.color }}
                >
                  {badge.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Page
   ───────────────────────────────────────────── */

export default function DatasetDetailPage() {
  const { connectorId, datasetId } = useParams<{ connectorId: string; datasetId: string }>();
  const router        = useRouter();

  const dataset = L2_DATASETS[datasetId as string];

  const [search,                setSearch]                = useState("");
  const [tableTypeFilter,       setTableTypeFilter]       = useState<"all" | "cube" | "view">("all");
  const [viewMode,              setViewMode]              = useState<"list" | "schema">("list");
  const [refreshing,            setRefreshing]            = useState(false);
  const [datasetDropdownOpen,   setDatasetDropdownOpen]   = useState(false);
  const [tableTypeDropdownOpen, setTableTypeDropdownOpen] = useState(false);

  const datasetDropdownRef   = useRef<HTMLDivElement>(null);
  const tableTypeDropdownRef = useRef<HTMLDivElement>(null);
  const controlsOuterRef     = useRef<HTMLDivElement>(null);
  const [canvasMaxWidth, setCanvasMaxWidth] = useState(2000);

  useEffect(() => {
    const el = controlsOuterRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasMaxWidth(el.offsetWidth));
    ro.observe(el);
    setCanvasMaxWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!datasetDropdownOpen && !tableTypeDropdownOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (datasetDropdownOpen && datasetDropdownRef.current && !datasetDropdownRef.current.contains(e.target as Node)) {
        setDatasetDropdownOpen(false);
      }
      if (tableTypeDropdownOpen && tableTypeDropdownRef.current && !tableTypeDropdownRef.current.contains(e.target as Node)) {
        setTableTypeDropdownOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [datasetDropdownOpen, tableTypeDropdownOpen]);

  const [expandedTables, setExpandedTables]  = useState<Set<string>>(
    () => new Set()
  );

  function handleRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  }

  function toggleTable(id: string) {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filteredTables = useMemo(() => {
    if (!dataset) return [];
    return dataset.tables.filter((t) => {
      const matchesType   = tableTypeFilter === "all" || t.type === tableTypeFilter;
      const matchesSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [dataset, tableTypeFilter, search]);

  if (!dataset) {
    return (
      <div className="flex flex-col h-full min-w-0 items-center justify-center">
        <p className="text-sm text-muted-foreground">Dataset not found.</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="mt-4 text-sm text-foreground underline underline-offset-2"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      <main className={viewMode === "schema" ? "flex-1 flex flex-col overflow-hidden" : "flex-1 overflow-y-auto"}>
        <div ref={controlsOuterRef} className="shrink-0 px-6 pt-8 pb-5 w-full">
        <div
          className="mx-auto w-full"
          style={{
            maxWidth: viewMode === "list" ? "1024px" : `${canvasMaxWidth}px`,
            transition: "max-width 0.42s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >

          {/* ── Page header ── */}
          <div
            className="mb-5 animate-fade-in-up"
            style={{ animationDelay: "0ms", animationFillMode: "backwards" }}
          >
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold">{dataset.datasetName}</h1>
              <div className="w-px h-4 bg-border shrink-0" />
              <button
                type="button"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Trash2 className="shrink-0" style={{ width: 14, height: 14, color: "var(--muted-foreground)" }} />
                <span className="text-[12.6px] font-medium">Delete</span>
              </button>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {dataset.connectorName} · {dataset.tables.length} Tables{dataset.createdAt && ` · created ${dataset.createdAt}`}
            </p>
          </div>

          {/* ── Action bar ── */}
          <div
            className="flex items-center gap-3 mb-5 animate-fade-in-up"
            style={{ animationDelay: "40ms", animationFillMode: "backwards" }}
          >
            <button
              type="button"
              onClick={() => router.push(`/connectors/${connectorId}`)}
              className="flex items-center gap-1.5 px-1 py-[7px] text-sm font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>

            <div
              className="relative flex-1 max-w-sm"
              style={{ transition: "transform 0.2s ease" }}
              onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
              onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
              onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
              onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
            >
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tables &amp; columns"
                spellCheck={false}
                autoComplete="off"
                className="w-full pl-8 pr-9 py-2 text-sm border border-border rounded-lg bg-card placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                  style={{ color: "var(--muted-foreground)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--connector-surface-hover)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-1.5 px-3.5 py-[7px] text-sm font-medium border border-border rounded-lg bg-background hover:bg-muted/50 transition-colors disabled:opacity-50"
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
                onClick={() => router.push("/connectors/add-connectors")}
                className="flex items-center gap-1.5 px-3.5 py-[7px] text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
                style={{ transition: "transform 0.2s ease" }}
                onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
                onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
                onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
              >
                <Plus className="w-3.5 h-3.5" />
                Add Connectors
              </button>
            </div>
          </div>

          {/* ── Filter row ── */}
          <div
            className="flex items-end gap-4 mb-6 animate-fade-in-up"
            style={{ animationDelay: "80ms", animationFillMode: "backwards" }}
          >
            {/* Dataset dropdown */}
            <div className="flex flex-col gap-1.5 relative" ref={datasetDropdownRef}>
              <span className="text-xs text-muted-foreground">Dataset</span>
              <button
                type="button"
                onClick={() => { setDatasetDropdownOpen((v) => !v); setTableTypeDropdownOpen(false); }}
                className="flex items-center gap-2 px-3.5 py-2 border border-border rounded-lg bg-background hover:bg-muted/20 transition-colors"
              style={{ transition: "transform 0.2s ease" }}
              onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
              onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
              onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
              onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
              >
                <span className="text-[11.7px] font-medium">{dataset.datasetName}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${datasetDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {datasetDropdownOpen && (
                  <>
                    <motion.div
                      className="absolute top-full left-0 mt-1.5 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden min-w-[240px]"
                      initial={{ opacity: 0, y: -6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.96 }}
                      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                      style={{ transformOrigin: "top left", pointerEvents: "auto" }}
                    >
                      {ALL_DATASETS_GROUPED.map(([connectorName, datasets], groupIdx) => {
                        const groupOffset = ALL_DATASETS_GROUPED.slice(0, groupIdx).reduce((s, [, d]) => s + d.length, 0);
                        return (
                          <div key={connectorName} className={groupIdx > 0 ? "border-t border-border" : ""}>
                            <div className="px-4 pt-3 pb-1">
                              <span className="text-[9.9px] font-semibold text-muted-foreground">{connectorName}</span>
                            </div>
                            <div className="pb-2" style={{ perspective: "800px" }}>
                              {datasets.map((ds, dsIdx) => {
                                const isActive = ds.id === datasetId;
                                const delay = (groupOffset + dsIdx) * 0.04 + 0.07;
                                return (
                                  <motion.button
                                    key={ds.id}
                                    type="button"
                                    onClick={() => { router.push(`/connectors/${connectorId}/${ds.id}`); setDatasetDropdownOpen(false); }}
                                    className={`flex items-center gap-3 w-full px-4 py-2 text-left transition-colors hover:bg-muted/40 ${isActive ? "bg-muted/30" : ""}`}
                                    initial={{ opacity: 0, rotateX: -90 }}
                                    animate={{ opacity: 1, rotateX: 0 }}
                                    transition={{ delay, duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
                                    style={{ transformOrigin: "top center" }}
                                  >
                                    <Check className={`w-3.5 h-3.5 shrink-0 ${isActive ? "opacity-100 text-foreground" : "opacity-0"}`} />
                                    <span className="text-[11.7px] font-medium truncate">{ds.datasetName}</span>
                                  </motion.button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* Version (cosmetic) */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Version</span>
              <button
                type="button"
                className="flex items-center gap-2 px-3.5 py-2 border border-border rounded-lg bg-background hover:bg-muted/20 transition-colors"
              style={{ transition: "transform 0.2s ease" }}
              onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
              onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
              onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
              onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
              >
                <span className="text-[11.7px] font-medium">{dataset.version} (active)</span>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>

            {/* Table type dropdown */}
            <div className="flex flex-col gap-1.5 relative" ref={tableTypeDropdownRef}>
              <span className="text-xs text-muted-foreground">Table Type</span>
              <button
                type="button"
                onClick={() => { setTableTypeDropdownOpen((v) => !v); setDatasetDropdownOpen(false); }}
                className="flex items-center gap-2 px-3.5 py-2 border border-border rounded-lg bg-background hover:bg-muted/20 transition-colors"
              style={{ transition: "transform 0.2s ease" }}
              onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
              onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
              onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
              onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
              >
                <span className="text-[11.7px] font-medium">
                  {tableTypeFilter === "all" ? "All Tables" : tableTypeFilter === "cube" ? "Cube" : "View"}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${tableTypeDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {tableTypeDropdownOpen && (
                  <>
                    <motion.div
                      className="absolute top-full left-0 mt-1.5 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden min-w-[160px] py-1"
                      initial={{ opacity: 0, y: -6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.96 }}
                      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                      style={{ transformOrigin: "top left", pointerEvents: "auto" }}
                    >
                      <div style={{ perspective: "800px" }}>
                        {(["all", "cube", "view"] as const).map((opt, i) => {
                          const isActive = tableTypeFilter === opt;
                          const label = opt === "all" ? "All Tables" : opt === "cube" ? "Cube" : "View";
                          return (
                            <motion.button
                              key={opt}
                              type="button"
                              onClick={() => { setTableTypeFilter(opt); setTableTypeDropdownOpen(false); }}
                              className={`flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors hover:bg-muted/40 ${isActive ? "bg-muted/30" : ""}`}
                              initial={{ opacity: 0, rotateX: -90 }}
                              animate={{ opacity: 1, rotateX: 0 }}
                              transition={{ delay: i * 0.04 + 0.07, duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
                              style={{ transformOrigin: "top center" }}
                            >
                              <Check className={`w-3.5 h-3.5 shrink-0 ${isActive ? "opacity-100 text-foreground" : "opacity-0"}`} />
                              <span className="text-[11.7px] font-medium">{label}</span>
                            </motion.button>
                          );
                        })}
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* View toggle */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">View</span>
              <div className="flex items-center border border-border rounded-lg p-0.5 bg-background">
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  style={{ transition: "transform 0.2s ease" }}
                  onPointerDown={e => (e.currentTarget.style.transform = "scale(0.95)")}
                  onPointerUp={e => (e.currentTarget.style.transform = "scale(1)")}
                  onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-[11.7px] font-medium transition-colors ${
                    viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <LayoutList className="w-4 h-4" />
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("schema")}
                  style={{ transition: "transform 0.2s ease" }}
                  onPointerDown={e => (e.currentTarget.style.transform = "scale(0.95)")}
                  onPointerUp={e => (e.currentTarget.style.transform = "scale(1)")}
                  onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-[11.7px] font-medium transition-colors ${
                    viewMode === "schema" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Network className="w-4 h-4" />
                  Schema
                </button>
              </div>
            </div>
          </div>

        </div>
        </div>

        {/* ── Animated content ── */}
        <AnimatePresence mode="wait" initial={false}>
          {viewMode === "list" ? (
            <motion.div
              key="list"
              className="max-w-5xl mx-auto pb-8 w-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: refreshing ? 0.4 : 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              {filteredTables.length === 0 ? (
                <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                  <Table2 className="mb-4 size-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No tables match your filters.</p>
                </div>
              ) : (
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="flex items-center gap-4 px-4 py-2.5" style={{ background: "var(--connector-surface)", borderBottom: "1px solid var(--connector-border)" }}>
                    <div className="w-3.5 shrink-0" />
                    <span className="flex-1 text-[9.9px] font-medium text-muted-foreground">Table</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[9.9px] font-medium text-muted-foreground w-[72px]">Data Type</span>
                      <span className="text-[9.9px] font-medium text-muted-foreground w-16">Rows</span>
                      <span className="text-[9.9px] font-medium text-muted-foreground w-16">Columns</span>
                      <span className="text-[9.9px] font-medium text-muted-foreground w-20">Relations</span>
                      <span className="text-[9.9px] font-medium text-muted-foreground w-[80px]">Quality</span>
                    </div>
                    <div className="w-3.5 shrink-0" />
                  </div>
                  {filteredTables.map((table, idx) => (
                    <TableRow
                      key={table.id}
                      table={table}
                      expanded={expandedTables.has(table.id)}
                      onToggle={() => toggleTable(table.id)}
                      animDelay={idx * 30}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="schema"
              className="flex-1 overflow-auto"
              style={{
                backgroundColor: "var(--schema-canvas-bg)",
                backgroundImage: "radial-gradient(circle, var(--schema-canvas-dot) 1px, transparent 1px)",
                backgroundSize: "16px 16px",
              }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: refreshing ? 0.4 : 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            >
              <div className="p-10 flex flex-wrap gap-5 items-start justify-center">
                {filteredTables.map((table) => (
                  <SchemaTableCard key={table.id} table={table} dataset={dataset} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>
    </div>
  );
}
