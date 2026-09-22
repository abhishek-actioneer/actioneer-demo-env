"use client";

import { useState } from "react";
import { Check, ChevronRight, Shield, Square, CheckSquare } from "lucide-react";

export interface PolicyTableSelectData {
  tables: string[];
  recommendedTables: string[];
  selectedTables?: string[];
  description: string;
  status: "pending" | "confirmed";
}

interface PolicyTableSelectCardProps {
  data: PolicyTableSelectData;
  msgId: string;
  onSelect: (msgId: string, tableNames: string[]) => void;
}

export function PolicyTableSelectCard({ data, msgId, onSelect }: PolicyTableSelectCardProps) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(data.recommendedTables.length > 0 ? data.recommendedTables : []),
  );
  const [showAll, setShowAll] = useState(false);

  const toggle = (table: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  };

  if (data.status === "confirmed") {
    return (
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0">
            <Check className="w-3 h-3 text-foreground" />
          </div>
          <span className="text-sm text-muted-foreground">
            Policy tables:{" "}
            {(data.selectedTables ?? []).map((t, i) => (
              <span key={t}>
                {i > 0 && ", "}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono border border-border">{t}</code>
              </span>
            ))}
          </span>
        </div>
      </div>
    );
  }

  const isLoading = data.tables.length === 0;
  const otherTables = data.tables.filter((t) => !data.recommendedTables.includes(t));

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden w-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Create a data access policy</p>
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Select the tables to include in this policy. We&apos;ve recommended the most relevant ones based on your request.
        </p>
      </div>

      <div className="p-4 space-y-1.5">
        {isLoading && (
          <p className="text-xs text-muted-foreground animate-pulse py-2">Loading tables…</p>
        )}

        {/* Recommended tables */}
        {data.recommendedTables.length > 0 && (
          <>
            <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider px-1 pb-0.5">Recommended</p>
            {data.recommendedTables.map((table) => (
              <TableCheckbox
                key={table}
                table={table}
                checked={selected.has(table)}
                onToggle={() => toggle(table)}
              />
            ))}
          </>
        )}

        {/* Other tables — collapsed */}
        {otherTables.length > 0 && (
          <div className="pt-1">
            <button
              onClick={() => setShowAll((v) => !v)}
              className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider px-1 pb-1 hover:text-foreground transition-colors duration-150"
            >
              <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${showAll ? "rotate-90" : ""}`} />
              All tables ({otherTables.length})
            </button>
            {showAll && otherTables.map((table) => (
              <TableCheckbox
                key={table}
                table={table}
                checked={selected.has(table)}
                onToggle={() => toggle(table)}
              />
            ))}
          </div>
        )}

        {/* Flat list if no recommendations */}
        {data.recommendedTables.length === 0 && data.tables.length > 0 && data.tables.map((table) => (
          <TableCheckbox
            key={table}
            table={table}
            checked={selected.has(table)}
            onToggle={() => toggle(table)}
          />
        ))}
      </div>

      {!isLoading && (
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selected.size} table{selected.size !== 1 ? "s" : ""} selected
          </span>
          <button
            onClick={() => { if (selected.size > 0) onSelect(msgId, Array.from(selected)); }}
            disabled={selected.size === 0}
            className="text-sm px-3.5 py-1.5 rounded-lg bg-foreground text-background hover:bg-foreground/90 active:scale-[0.97] transition-all duration-150 flex items-center gap-1.5 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-3.5 h-3.5" />
            Continue
          </button>
        </div>
      )}
    </div>
  );
}

function TableCheckbox({ table, checked, onToggle }: {
  table: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const Icon = checked ? CheckSquare : Square;
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md border text-left transition-all duration-150 active:scale-[0.98] ${
        checked
          ? "border-border bg-muted/50"
          : "border-border/60 hover:bg-muted/20 hover:border-border"
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${checked ? "text-foreground" : "text-muted-foreground/50"}`} />
      <code className="text-xs font-mono text-foreground">{table}</code>
    </button>
  );
}
