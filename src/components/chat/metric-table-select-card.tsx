"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Check, ChevronRight, Search } from "lucide-react";

export interface MetricTableSelectData {
  metricId: string;
  metricName: string;
  description: string;
  tables: string[];
  selectedTable?: string;
  status: "pending" | "confirmed";
  suggestedRelatedMetrics: string[];
}

interface MetricTableSelectCardProps {
  data: MetricTableSelectData;
  msgId: string;
  onSelect: (msgId: string, tableName: string, data: MetricTableSelectData) => void;
  onChangeTable?: (msgId: string) => void;
}

/** Score tables by keyword relevance to metric name + description */
function rankTables(tables: string[], name: string, description: string): { recommended: string[]; rest: string[] } {
  const tokens = `${name} ${description}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const scored = tables.map((table) => {
    const tLower = table.toLowerCase().replace(/_/g, " ");
    let score = 0;
    for (const token of tokens) {
      if (tLower.includes(token)) score += 2;
      else if (token.length >= 4 && tLower.split(" ").some((w) => w.startsWith(token.slice(0, 4)))) score += 1;
    }
    if (table.startsWith("raw_")) score -= 1;
    if (table.endsWith("_metrics")) score -= 0.5;
    return { table, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const recommended = scored.filter((s) => s.score > 0).slice(0, 5).map((s) => s.table);
  const rest = scored.filter((s) => !recommended.includes(s.table)).map((s) => s.table);
  return { recommended, rest };
}

// Row stagger delay for entrance animations
const STAGGER_MS = 35;

export function MetricTableSelectCard({ data, msgId, onSelect, onChangeTable }: MetricTableSelectCardProps) {
  const { recommended, rest } = useMemo(
    () => rankTables(data.tables, data.metricName, data.description),
    [data.tables, data.metricName, data.description],
  );
  const [selected, setSelected] = useState<string>(recommended[0] ?? data.tables[0] ?? "");
  const [showAll, setShowAll] = useState(false);
  const [allTableSearch, setAllTableSearch] = useState("");
  // Track whether tables just loaded (for stagger animation)
  const prevTablesLen = useRef(data.tables.length);
  const [tablesJustLoaded, setTablesJustLoaded] = useState(false);

  // Auto-select first recommended table when tables arrive
  useEffect(() => {
    if (!selected && (recommended[0] || data.tables[0])) {
      setSelected(recommended[0] ?? data.tables[0]);
    }
  }, [recommended, data.tables, selected]);

  // Detect tables arriving (0 → N) and trigger stagger animation
  useEffect(() => {
    if (prevTablesLen.current === 0 && data.tables.length > 0) {
      setTablesJustLoaded(true);
      const timer = setTimeout(() => setTablesJustLoaded(false), 600);
      return () => clearTimeout(timer);
    }
    prevTablesLen.current = data.tables.length;
  }, [data.tables.length]);

  const isLoading = data.tables.length === 0;

  if (data.status === "confirmed") {
    return (
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Check className="w-3 h-3 text-foreground" />
            </div>
            <span className="text-sm flex items-center gap-1.5">
              <span className="text-muted-foreground">Using table</span>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono border border-border">{data.selectedTable ?? ""}</code>
            </span>
          </div>
          {onChangeTable && (
            <button
              onClick={() => onChangeTable(msgId)}
              className="text-[9.9px] text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              Change
            </button>
          )}
        </div>
      </div>
    );
  }

  const handleConfirm = () => {
    if (!selected) return;
    onSelect(msgId, selected, data);
  };

  // Filter "All tables" by search
  const filteredRest = allTableSearch
    ? rest.filter((t) => t.toLowerCase().includes(allTableSearch.toLowerCase()))
    : rest;

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden w-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <p className="text-sm font-semibold">Which table should this metric use?</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Select the source table for <strong>{data.metricName}</strong>.
        </p>
      </div>

      <div className="p-4 space-y-2">
        {/* Loading skeleton */}
        {isLoading && (
          <>
            <p className="text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wider px-1 pb-0.5 animate-pulse">
              Loading tables…
            </p>
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md"
                style={{
                  opacity: 0,
                  animation: `table-skeleton-in 200ms ease-out ${i * STAGGER_MS}ms both`,
                }}
              >
                <span className="w-3.5 h-3.5 rounded-full border border-border/50 shrink-0" />
                <span
                  className="h-3 rounded-sm bg-muted/60 animate-pulse"
                  style={{ width: `${90 + i * 35}px`, animationDelay: `${i * 150}ms` }}
                />
              </div>
            ))}
          </>
        )}

        {/* Recommended tables */}
        {recommended.length > 0 && (
          <>
            <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider px-1 pb-0.5">Recommended</p>
            {recommended.map((table, i) => (
              <TableRadio
                key={table}
                table={table}
                selected={selected === table}
                isBestMatch={i === 0}
                onSelect={() => setSelected(table)}
                style={tablesJustLoaded ? {
                  opacity: 0,
                  animation: `table-row-in 200ms cubic-bezier(0.23, 1, 0.32, 1) ${i * STAGGER_MS}ms both`,
                } : undefined}
              />
            ))}
          </>
        )}

        {/* All other tables — collapsed with search */}
        {rest.length > 0 && (
          <div className="pt-1">
            <button
              onClick={() => setShowAll((v) => !v)}
              className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider px-1 pb-1 hover:text-foreground transition-colors duration-150"
            >
              <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${showAll ? "rotate-90" : ""}`} />
              All tables ({rest.length})
            </button>
            {showAll && (
              <div className="space-y-1.5">
                {/* Search filter */}
                <div className="relative px-1 pb-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={allTableSearch}
                    onChange={(e) => setAllTableSearch(e.target.value)}
                    placeholder="Filter tables…"
                    className="w-full pl-7 pr-2.5 py-1.5 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring/30 font-mono placeholder:text-muted-foreground/50"
                    autoFocus
                  />
                </div>
                {filteredRest.map((table) => (
                  <TableRadio
                    key={table}
                    table={table}
                    selected={selected === table}
                    onSelect={() => setSelected(table)}
                  />
                ))}
                {filteredRest.length === 0 && (
                  <p className="text-xs text-muted-foreground/50 px-3 py-2">No tables match &ldquo;{allTableSearch}&rdquo;</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* If no recommended, show all tables flat */}
        {recommended.length === 0 && data.tables.length > 0 && data.tables.map((table, i) => (
          <TableRadio
            key={table}
            table={table}
            selected={selected === table}
            onSelect={() => setSelected(table)}
            style={tablesJustLoaded ? {
              opacity: 0,
              animation: `table-row-in 200ms cubic-bezier(0.23, 1, 0.32, 1) ${i * STAGGER_MS}ms both`,
            } : undefined}
          />
        ))}

      </div>

      {/* Footer with CTA — hidden during loading */}
      {!isLoading && (
        <div className="px-4 py-3 border-t border-border">
          <button
            onClick={handleConfirm}
            disabled={!selected}
            className="text-sm px-3.5 py-1.5 rounded-lg bg-foreground text-background hover:bg-foreground/90 active:scale-[0.97] transition-all duration-150 flex items-center gap-1.5 font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_1px_3px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.06)]"
          >
            <ChevronRight className="w-3.5 h-3.5" />
            Use This Table
          </button>
        </div>
      )}
    </div>
  );
}

function TableRadio({ table, selected, isBestMatch, onSelect, style }: {
  table: string;
  selected: boolean;
  isBestMatch?: boolean;
  onSelect: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onSelect}
      style={style}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md border text-left transition-all duration-150 active:scale-[0.98] ${
        selected
          ? "border-border bg-muted/50"
          : "border-border/60 hover:bg-muted/20 hover:border-border"
      }`}
    >
      <span
        className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-colors duration-150 ${
          selected ? "border-foreground/60" : "border-border"
        }`}
      >
        {selected && <span className="w-1.5 h-1.5 rounded-full bg-foreground/60" />}
      </span>
      <code className="text-xs font-mono text-foreground">{table}</code>
      {isBestMatch && (
        <span className="ml-auto text-[9px] text-muted-foreground/70 font-medium">Best match</span>
      )}
    </button>
  );
}
