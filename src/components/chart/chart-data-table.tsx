"use client";

import { useState, useMemo } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { formatValue } from "./chart-core";

export interface ChartDataTableProps {
  data: Record<string, unknown>[];
  pageSize?: number;
  currency?: string;
  format?: Record<string, "number" | "currency" | "percent">;
}

function isNumeric(val: unknown): val is number {
  return typeof val === "number" && !isNaN(val);
}

// Compute min/max per numeric column for heatmap intensity
function computeColumnRanges(
  data: Record<string, unknown>[],
  numericCols: Set<string>,
): Map<string, { min: number; max: number }> {
  const ranges = new Map<string, { min: number; max: number }>();
  for (const col of numericCols) {
    let min = Infinity;
    let max = -Infinity;
    for (const row of data) {
      const v = row[col];
      if (typeof v === "number" && !isNaN(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min !== Infinity && max !== -Infinity && max !== min) {
      ranges.set(col, { min, max });
    }
  }
  return ranges;
}

// Returns a 0–1 intensity for heatmap coloring
function heatIntensity(value: number, min: number, max: number): number {
  return (value - min) / (max - min);
}

export function ChartDataTable({ data, pageSize = 20, currency, format }: ChartDataTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const columns = useMemo(() => {
    if (!data.length) return [];
    return Object.keys(data[0]);
  }, [data]);

  const numericCols = useMemo(() => {
    const set = new Set<string>();
    for (const col of columns) {
      const sample = data.find((r) => r[col] != null);
      if (sample && isNumeric(sample[col])) set.add(col);
    }
    return set;
  }, [columns, data]);

  const columnRanges = useMemo(
    () => computeColumnRanges(data, numericCols),
    [data, numericCols],
  );

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const sa = String(av);
      const sb = String(bv);
      return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }, [data, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (col: string) => {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir(numericCols.has(col) ? "desc" : "asc");
    }
    setPage(0);
  };

  const formatCell = (col: string, val: unknown): string => {
    if (val == null) return "—";
    if (typeof val === "number") {
      const fmt = format?.[col];
      if (fmt) return formatValue(val, fmt, currency);
      return val.toLocaleString();
    }
    return String(val);
  };

  // Heatmap cell background: green tint scaled by column-relative intensity
  const getCellStyle = (col: string, val: unknown): React.CSSProperties | undefined => {
    if (typeof val !== "number" || isNaN(val)) return undefined;
    const range = columnRanges.get(col);
    if (!range) return undefined;
    const t = heatIntensity(val, range.min, range.max);
    // Scale opacity from 0 (min) to 0.18 (max) — subtle but visible
    const opacity = t * 0.18;
    return { backgroundColor: `rgba(34, 197, 94, ${opacity})` }; // green-500
  };

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
        No data
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full antialiased">
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-xs" role="grid">
          <thead className="sticky top-0 z-[1]">
            <tr className="bg-card border-b border-border">
              {columns.map((col) => (
                <th
                  key={col}
                  role="columnheader"
                  aria-sort={sortKey === col ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  className={`px-3 py-2 font-medium text-muted-foreground whitespace-nowrap cursor-pointer select-none transition-[color] duration-150 ease-out motion-reduce:transition-none ${
                    numericCols.has(col) ? "text-right" : "text-left"
                  }`}
                  onClick={() => handleSort(col)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSort(col); } }}
                >
                  <span className="inline-flex items-center gap-1">
                    {col}
                    {sortKey === col && (
                      sortDir === "asc"
                        ? <ArrowUp className="w-3 h-3" aria-hidden="true" />
                        : <ArrowDown className="w-3 h-3" aria-hidden="true" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, ri) => (
              <tr
                key={ri}
                className="border-b border-border/40 last:border-0"
              >
                {columns.map((col) => (
                  <td
                    key={col}
                    className={`px-3 py-1.5 truncate max-w-[200px] ${
                      numericCols.has(col) ? "text-right tabular-nums" : ""
                    }`}
                    style={getCellStyle(col, row[col])}
                  >
                    {formatCell(col, row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end px-3 py-1.5 border-t border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              className="px-2 py-1 min-h-[28px] text-[9px] text-muted-foreground rounded transition-[color,background-color] duration-150 ease-out motion-reduce:transition-none disabled:opacity-30 cursor-pointer hover:text-foreground hover:bg-muted/50 active:scale-[0.97]"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </button>
            <span className="text-[9px] text-muted-foreground tabular-nums px-1">
              {page + 1}/{totalPages}
            </span>
            <button
              type="button"
              aria-label="Next page"
              className="px-2 py-1 min-h-[28px] text-[9px] text-muted-foreground rounded transition-[color,background-color] duration-150 ease-out motion-reduce:transition-none disabled:opacity-30 cursor-pointer hover:text-foreground hover:bg-muted/50 active:scale-[0.97]"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
