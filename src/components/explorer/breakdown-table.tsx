"use client";

import { useState, useMemo } from "react";
import { ChevronDown, Search, Download } from "lucide-react";

// Series colors matching chart palette
const SERIES_COLORS = [
  "#22c55e", // green (accent — first series)
  "#3E63DD", // blue
  "#E54D2E", // red-orange
  "#8E4EC6", // purple
  "#F76B15", // orange
  "#0090FF", // bright blue
  "#E5484D", // red
  "#849A1A", // olive
  "#30A46C", // teal
  "#D4A017", // gold
];

export { SERIES_COLORS };

interface BreakdownMatrixRow {
  name: string;
  values: Record<string, number>; // date -> value
  total: number;
  average: number;
}

interface BreakdownTableProps {
  /** Raw query data with period + breakdown + value columns */
  rawData: Record<string, unknown>[];
  breakdownLabel?: string;
  /** Dates in order */
  dates: string[];
  /** Callback when series visibility changes */
  onVisibilityChange?: (visibleSeries: Set<string>) => void;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatCell(value: number | undefined): string {
  if (value == null || value === 0) return "0";
  if (Math.abs(value) >= 1_000_000)
    return (value / 1_000_000).toFixed(1) + "M";
  if (Math.abs(value) >= 1_000)
    return (value / 1_000).toFixed(1) + "K";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

type SortKey = "name" | "average" | string; // string for date columns

export function BreakdownTable({
  rawData,
  breakdownLabel,
  dates,
  onVisibilityChange,
}: BreakdownTableProps) {
  const [topN, setTopN] = useState(5);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleSeries, setVisibleSeries] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("average");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Build matrix from raw data
  const matrix = useMemo(() => {
    const byBreakdown = new Map<string, Record<string, number>>();
    for (const row of rawData) {
      const name = String(row.breakdown ?? "Other");
      const period = String(row.period);
      const value = Number(row.value) || 0;
      if (!byBreakdown.has(name)) byBreakdown.set(name, {});
      byBreakdown.get(name)![period] = value;
    }

    const rows: BreakdownMatrixRow[] = [];
    for (const [name, values] of byBreakdown) {
      const numericValues = Object.values(values);
      const total = numericValues.reduce((s, v) => s + v, 0);
      const average = numericValues.length > 0 ? total / numericValues.length : 0;
      rows.push({ name, values, total, average });
    }

    // Sort by total descending
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [rawData]);

  // Initialize visibility with top N
  if (!initialized && matrix.length > 0) {
    const initial = new Set(matrix.slice(0, topN).map((r) => r.name));
    setVisibleSeries(initial);
    setInitialized(true);
    onVisibilityChange?.(initial);
  }

  // Filter + sort + slice
  const filteredRows = useMemo(() => {
    let rows = [...matrix];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    }
    // Apply sort
    rows.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      if (sortKey === "name") {
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        return sortDir === "asc"
          ? (aVal as string).localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal as string);
      } else if (sortKey === "average") {
        aVal = a.average;
        bVal = b.average;
      } else {
        // Date column
        aVal = a.values[sortKey] ?? 0;
        bVal = b.values[sortKey] ?? 0;
      }
      return sortDir === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
    return rows.slice(0, topN);
  }, [matrix, searchQuery, topN, sortKey, sortDir]);

  const toggleVisibility = (name: string) => {
    setVisibleSeries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      onVisibilityChange?.(next);
      return next;
    });
  };

  const toggleAll = () => {
    const allVisible = filteredRows.every((r) => visibleSeries.has(r.name));
    const next = new Set(visibleSeries);
    if (allVisible) {
      filteredRows.forEach((r) => next.delete(r.name));
    } else {
      filteredRows.forEach((r) => next.add(r.name));
    }
    setVisibleSeries(next);
    onVisibilityChange?.(next);
  };

  const handleExportCSV = () => {
    const header = [
      breakdownLabel ?? "Breakdown",
      "Row Average",
      ...dates.map(formatDate),
    ];
    const csvRows = [header.join(",")];
    for (const row of filteredRows) {
      const cells = [
        `"${row.name}"`,
        row.average.toFixed(2),
        ...dates.map((d) => String(row.values[d] ?? 0)),
      ];
      csvRows.push(cells.join(","));
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `breakdown-${breakdownLabel ?? "data"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  if (!rawData.length || !dates.length) return null;

  const allChecked = filteredRows.every((r) => visibleSeries.has(r.name));

  return (
    <div className="space-y-2">
      {/* Controls bar */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground font-medium">Breakdown by:</span>
        <div className="relative">
          <select
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="appearance-none bg-muted rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer pr-6 border-0 focus:ring-1 focus:ring-border"
          >
            <option value={5}>Top 5 (Default)</option>
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none text-muted-foreground" />
        </div>

        <div className="relative flex-1 max-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full bg-transparent border rounded-md pl-7 pr-2 py-1 text-xs focus:ring-1 focus:ring-border focus:outline-none"
          />
        </div>

        <button
          onClick={handleExportCSV}
          className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Download className="h-3 w-3" />
          Export CSV
        </button>
      </div>

      {/* Matrix table */}
      <div className="border rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                {/* Checkbox column */}
                <th className="px-2 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="rounded border-border"
                  />
                </th>
                {/* Breakdown name column */}
                <th
                  onClick={() => handleSort("name")}
                  className="px-3 py-2 text-left font-medium text-muted-foreground sticky left-0 bg-muted/50 min-w-[140px] cursor-pointer hover:text-foreground transition-colors select-none"
                >
                  {breakdownLabel ?? "Breakdown"}{sortIndicator("name")}
                </th>
                {/* Row Average column */}
                <th
                  onClick={() => handleSort("average")}
                  className="px-3 py-2 text-right font-medium text-muted-foreground min-w-[90px] cursor-pointer hover:text-foreground transition-colors select-none"
                >
                  Row Average{sortIndicator("average")}
                </th>
                {/* Date columns */}
                {dates.map((d) => (
                  <th
                    key={d}
                    onClick={() => handleSort(d)}
                    className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap min-w-[80px] cursor-pointer hover:text-foreground transition-colors select-none"
                  >
                    {formatDate(d)}{sortIndicator(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, i) => {
                const color = SERIES_COLORS[i % SERIES_COLORS.length];
                const checked = visibleSeries.has(row.name);
                return (
                  <tr
                    key={row.name}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    {/* Checkbox */}
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleVisibility(row.name)}
                        className="rounded border-border"
                      />
                    </td>
                    {/* Breakdown name with colored dot */}
                    <td className="px-3 py-2 sticky left-0 bg-background">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-medium truncate max-w-[120px]">
                          {row.name}
                        </span>
                      </span>
                    </td>
                    {/* Row Average */}
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                      {formatCell(row.average)}
                    </td>
                    {/* Date values */}
                    {dates.map((d) => (
                      <td
                        key={d}
                        className="px-3 py-2 text-right tabular-nums"
                      >
                        {formatCell(row.values[d])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {matrix.length > topN && (
          <div className="px-3 py-2 text-[9.9px] text-muted-foreground text-center border-t">
            Showing {Math.min(topN, filteredRows.length)} of {matrix.length} values
          </div>
        )}
      </div>
    </div>
  );
}
