"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, ChevronLeft, ChevronRight, Search, Phone } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { Segment } from "@/lib/types";

const PAGE_SIZE = 50;

interface UsersData {
  columns: string[];
  rows: Record<string, unknown>[];
  totalCount: number;
  page: number;
  error?: string;
}

interface UsersTabProps {
  segment: Segment;
  onCallUser?: (row: Record<string, unknown>) => void;
}

export function UsersTab({ segment, onCallUser }: UsersTabProps) {
  const [data, setData] = useState<UsersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await apiFetch<UsersData>(`/api/segments/${segment.id}/users`, {
        method: "POST",
        body: {
          sql: segment.sql,
          page: p,
          pageSize: PAGE_SIZE,
          search: searchQuery || undefined,
          sortCol: sortCol || undefined,
          sortDir,
        },
      });
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [segment.id, segment.sql, searchQuery, sortCol, sortDir]);

  useEffect(() => {
    fetchPage(page);
  }, [fetchPage, page]);

  // Reset page on search/sort change
  useEffect(() => {
    setPage(0);
  }, [searchQuery, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const totalPages = data ? Math.ceil(data.totalCount / PAGE_SIZE) : 0;

  return (
    <div className="p-6 space-y-4">
      {/* Search + count */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search users..."
            className="w-full bg-transparent border rounded-md pl-8 pr-3 py-1.5 text-sm focus:ring-1 focus:ring-border focus:outline-none"
          />
        </div>
        {data && (
          <span className="text-xs text-muted-foreground">
            {data.totalCount.toLocaleString()} users total
          </span>
        )}
      </div>

      {/* Table */}
      {loading && !data && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {data && data.columns.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">#</th>
                  {data.columns.map((col) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      className="px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap"
                    >
                      {col}
                      {sortCol === col && (
                        <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>
                      )}
                    </th>
                  ))}
                  {onCallUser && <th className="w-8 px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i} className="group border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {page * PAGE_SIZE + i + 1}
                    </td>
                    {data.columns.map((col) => (
                      <td key={col} className="px-3 py-2 tabular-nums whitespace-nowrap">
                        {formatCell(row[col])}
                      </td>
                    ))}
                    {onCallUser && (
                      <td className="px-2 py-2">
                        <button
                          onClick={() => onCallUser(row)}
                          className="p-1 rounded hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Phone className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/30">
              <span className="text-[9.9px] text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {data && data.rows.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-8">
          No users found
        </div>
      )}

      {loading && data && (
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function formatCell(val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "number") {
    return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}
