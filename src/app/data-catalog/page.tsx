"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  ChevronRight,
  ChevronDown,
  Database,
  Settings,
  ChevronsUpDown,
  Check,
} from "lucide-react";
import { useScrollRestore } from "@/lib/use-scroll-restore";
import { formatRowCount } from "@/lib/catalog-data";
import type {
  CatalogTab,
  CatalogTable,
  CatalogColumn,
  FlatColumn,
} from "@/lib/catalog-types";
import { COLUMN_TYPE_COLORS } from "@/lib/catalog-types";
import { markStepComplete } from "@/lib/onboarding-store";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { FeatureGate } from "@/components/feature-gate";

// ── Tab config ──
const TABS: { id: CatalogTab; label: string }[] = [
  { id: "tables", label: "Tables" },
  { id: "columns", label: "Columns" },
];

/** Top 3 non-ID column names as a quick preview */
function columnPreview(columns: CatalogColumn[]): string {
  return columns
    .filter((c) => c.typeCategory !== "identifier")
    .slice(0, 3)
    .map((c) => c.name)
    .join(", ") || columns.slice(0, 3).map((c) => c.name).join(", ");
}

// ── Main Page ──
export default function DataCatalogPage() {
  const router = useRouter();
  const { datasetId } = useDataset();
  const scrollRef = useScrollRestore<HTMLElement>();
  const [activeTab, setActiveTab] = useState<CatalogTab>("tables");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [columnTableFilter, setColumnTableFilter] = useState<string>("all");

  const [allTables, setAllTables] = useState<CatalogTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [countsReady, setCountsReady] = useState(false);

  useEffect(() => { markStepComplete("explore-data"); }, []);

  const fetchCatalog = useCallback(async (dsId: string) => {
    setLoading(true);
    setCountsReady(false);
    try {
      // Phase 1: structure only — fast, paints the catalog immediately.
      const data = await apiFetch<{ tables: CatalogTable[] }>(
        "/api/data-catalog?counts=skip",
        { datasetId: dsId },
      );
      setAllTables(data.tables || []);
      setLoading(false);

      // Phase 2: row counts — the slow COUNT(*) scans, loaded non-blocking and
      // merged in when ready. A failure here leaves the structure visible.
      try {
        const countData = await apiFetch<{ counts: Record<string, number> }>(
          "/api/data-catalog?counts=only",
          { datasetId: dsId },
        );
        const counts = countData.counts || {};
        setAllTables((prev) => prev.map((t) => ({ ...t, rowCount: counts[t.name] ?? t.rowCount })));
        setCountsReady(true);
      } catch {
        // counts unavailable — leave structure visible without row totals
      }
    } catch {
      setAllTables([]);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (datasetId) fetchCatalog(datasetId);
  }, [fetchCatalog, datasetId]);

  const allColumns = useMemo<FlatColumn[]>(
    () => allTables.flatMap((t) => t.columns.map((c) => ({ ...c, tableName: t.name }))),
    [allTables]
  );

  const totalRows = useMemo(
    () => allTables.reduce((sum, t) => sum + t.rowCount, 0),
    [allTables]
  );

  // Push data catalog context into chat
  const { setEntity } = useChatPanel();
  useEffect(() => {
    if (allTables.length > 0) {
      setEntity({
        id: "data-catalog-list",
        name: "Data Catalog",
        type: "data-catalog-list",
        summary: `${allTables.length} tables, ${allColumns.length} columns`,
        contextPayload: {
          tables: allTables.map((t) => ({
            name: t.name,
            rowCount: t.rowCount,
            columnCount: t.columns.length,
            columns: t.columns.map((c) => ({ name: c.name, type: c.type })),
          })),
        },
      });
    }
  }, [allTables, allColumns.length, setEntity]);

  // ── Filtered tables ──
  const filteredTables = useMemo(() => {
    if (!searchQuery) return allTables;
    const q = searchQuery.toLowerCase();
    return allTables.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [allTables, searchQuery]);

  // ── Filtered columns ──
  const filteredColumns = useMemo(() => {
    let list = allColumns;
    if (columnTableFilter !== "all") {
      list = list.filter((c) => c.tableName === columnTableFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || c.tableName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allColumns, columnTableFilter, searchQuery]);

  return (
    <FeatureGate feature="catalog">
    <div className="flex flex-col h-full min-w-0">
      <main ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          {/* Header row: title + search + action */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-semibold">Data Catalog</h1>
              {!loading && allTables.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {allTables.length} tables · {allColumns.length} columns
                  {countsReady && <> · {formatRowCount(totalRows)} rows</>}
                </p>
              )}
            </div>
            <button
              onClick={() => router.push("/connectors")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors shrink-0"
            >
              <Settings className="w-3.5 h-3.5" />
              Connectors
            </button>
          </div>

          {/* Search + tabs in one row */}
          <div className="flex items-center gap-3 mb-5">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={activeTab === "columns" ? "Search columns" : "Search tables"}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div className="flex items-center gap-1">
              {TABS.map((tab) => {
                const count = tab.id === "tables" ? allTables.length : allColumns.length;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      activeTab === tab.id
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {tab.label}
                    <span className="ml-1 opacity-60 tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <LoadingSkeleton />
          ) : activeTab === "tables" ? (
            <TableList
              tables={filteredTables}
              expandedTable={expandedTable}
              onToggle={(name) => setExpandedTable(expandedTable === name ? null : name)}
              onColumnClick={(name) => { setColumnTableFilter(name); setActiveTab("columns"); }}
              countsReady={countsReady}
            />
          ) : (
            <ColumnList
              columns={filteredColumns}
              tableNames={allTables.map((t) => t.name)}
              tableFilter={columnTableFilter}
              onTableFilterChange={setColumnTableFilter}
            />
          )}
        </div>
      </main>
    </div>
    </FeatureGate>
  );
}

/* ─────────────────────────────────────────────
   Loading skeleton
   ───────────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <div className="space-y-px">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5 px-3 rounded-md">
          <div className="h-3 w-3 bg-muted rounded animate-pulse" />
          <div className="flex-1 space-y-1">
            <div className="h-3.5 w-44 bg-muted rounded animate-pulse" />
            <div className="h-2.5 w-56 bg-muted/50 rounded animate-pulse" />
          </div>
          <div className="h-3 w-12 bg-muted rounded animate-pulse" />
          <div className="h-3 w-8 bg-muted rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Tables list — flat, tight rows
   ───────────────────────────────────────────── */

function TableList({
  tables,
  expandedTable,
  onToggle,
  onColumnClick,
  countsReady,
}: {
  tables: CatalogTable[];
  expandedTable: string | null;
  onToggle: (name: string) => void;
  onColumnClick: (name: string) => void;
  countsReady: boolean;
}) {
  if (tables.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No tables match your search
      </div>
    );
  }

  return (
    <div className="space-y-px">
      {tables.map((table) => {
        const isExpanded = expandedTable === table.name;
        return (
          <div key={table.name}>
            {/* Table row */}
            <button
              onClick={() => onToggle(table.name)}
              className={`w-full flex items-center gap-3 py-2.5 px-3 rounded-md text-left transition-colors hover:bg-muted/50 ${
                isExpanded ? "bg-muted/40" : ""
              }`}
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium font-mono">{table.name}</span>
                <p className="text-[9.9px] text-muted-foreground/50 truncate mt-px">
                  {columnPreview(table.columns)}
                </p>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground shrink-0 w-16 text-right">
                {countsReady ? formatRowCount(table.rowCount) : "—"}
              </span>
              <span
                onClick={(e) => { e.stopPropagation(); onColumnClick(table.name); }}
                className="text-xs tabular-nums text-muted-foreground shrink-0 w-10 text-right hover:text-foreground hover:underline cursor-pointer"
              >
                {table.columns.length}
              </span>
            </button>

            {/* Expanded columns */}
            {isExpanded && (
              <div className="ml-8 mr-3 mb-2 mt-1">
                <ColumnDetailGrid columns={table.columns} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Expanded column detail — compact grid
   ───────────────────────────────────────────── */

function ColumnDetailGrid({ columns }: { columns: CatalogColumn[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 py-2">
      {columns.map((col) => (
        <span
          key={col.name}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/40 border border-border/50"
        >
          <span className="text-xs font-mono text-foreground/80">{col.name}</span>
          <span className={`text-[8.1px] font-medium px-1 py-px rounded ${COLUMN_TYPE_COLORS[col.typeCategory]}`}>
            {col.type}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Columns list — flat with dropdown filter
   ───────────────────────────────────────────── */

function ColumnList({
  columns,
  tableNames,
  tableFilter,
  onTableFilterChange,
}: {
  columns: FlatColumn[];
  tableNames: string[];
  tableFilter: string;
  onTableFilterChange: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Table filter */}
      <div className="relative inline-block mb-4">
        <button
          onClick={() => setOpen((p) => !p)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors"
        >
          <Database className="w-3 h-3 text-muted-foreground" />
          <span className="font-mono">{tableFilter === "all" ? "All tables" : tableFilter}</span>
          <ChevronsUpDown className="w-3 h-3 text-muted-foreground" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-20 w-64 max-h-72 overflow-y-auto border border-border rounded-lg bg-background shadow-lg">
              <DropdownItem
                label="All tables"
                selected={tableFilter === "all"}
                onClick={() => { onTableFilterChange("all"); setOpen(false); }}
              />
              {tableNames.map((name) => (
                <DropdownItem
                  key={name}
                  label={name}
                  mono
                  selected={tableFilter === name}
                  onClick={() => { onTableFilterChange(name); setOpen(false); }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Column rows */}
      {columns.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No columns match your search
        </div>
      ) : (
        <div className="space-y-px">
          {columns.map((col) => (
            <div
              key={`${col.tableName}-${col.name}`}
              className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/30 transition-colors"
            >
              <span className="text-sm font-mono font-medium flex-1 min-w-0 truncate">{col.name}</span>
              <span className="text-[9.9px] text-muted-foreground/50 font-mono shrink-0">{col.tableName}</span>
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0 ${COLUMN_TYPE_COLORS[col.typeCategory]}`}>
                {col.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function DropdownItem({ label, mono, selected, onClick }: {
  label: string; mono?: boolean; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors"
    >
      <span className={`truncate ${mono ? "font-mono" : ""}`}>{label}</span>
      {selected && <Check className="w-3 h-3 text-foreground shrink-0" />}
    </button>
  );
}
