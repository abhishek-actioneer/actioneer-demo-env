"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { X, RefreshCw, Trash2 } from "lucide-react";
import { getBoardCard, saveBoardCard } from "@/lib/board-store";
import type { BoardCard } from "@/lib/board-types";
import type { ChartSpec } from "@/lib/chart-types";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const CHART_TYPES: ChartSpec["type"][] = ["bar", "line", "area", "pie", "scatter"];

const REFRESH_CADENCE_OPTIONS: BoardCard["refreshCadence"][] = [
  "manual",
  "hourly",
  "daily",
];

interface CanvasConfigPanelProps {
  itemId: string;
  boardId: string;
  onClose: () => void;
  onRemove: (itemId: string) => void;
  onItemUpdated: () => void;
}

export function CanvasConfigPanel({
  itemId,
  boardId,
  onClose,
  onRemove,
  onItemUpdated,
}: CanvasConfigPanelProps) {
  const [item, setItem] = useState<BoardCard | undefined>(() =>
    getBoardCard(boardId, itemId)
  );
  const [title, setTitle] = useState(item?.title ?? "");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const loaded = getBoardCard(boardId, itemId);
    setItem(loaded);
    setTitle(loaded?.title ?? "");
  }, [itemId, boardId]);

  const updateItem = useCallback(
    (updates: Partial<BoardCard>) => {
      if (!item) return;
      const updated = { ...item, ...updates };
      saveBoardCard(updated);
      setItem(updated);
      onItemUpdated();
    },
    [item, onItemUpdated]
  );

  const dataPreview = item?.data?.slice(0, 5) ?? item?.chartSpec?.data?.slice(0, 5);
  const dataKeys = useMemo(
    () => (dataPreview?.[0] ? Object.keys(dataPreview[0]) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item]
  );

  const handleTitleBlur = useCallback(() => {
    if (!item || title === item.title) return;
    updateItem({ title });
  }, [item, title, updateItem]);

  const handleChartTypeChange = useCallback(
    (type: ChartSpec["type"]) => {
      const base = item?.chartSpec ?? { type, title: item?.title ?? "Chart", data: [] };
      if (type === "scatter" && dataKeys.length >= 2 && !base.xKey) {
        const [defaultX, defaultY] = dataKeys;
        updateItem({ chartSpec: { ...base, type, xKey: defaultX, yKeys: [defaultY] } });
        return;
      }
      updateItem({ chartSpec: { ...base, type } });
    },
    [item, updateItem, dataKeys]
  );

  const handleAxisChange = useCallback(
    (field: "xKey" | "yKeys" | "nameKey", value: string) => {
      const base = item?.chartSpec ?? { type: "line" as ChartSpec["type"], title: item?.title ?? "Chart", data: [] };
      const updated: ChartSpec =
        field === "yKeys"
          ? { ...base, yKeys: [value] }
          : { ...base, [field]: value || undefined };
      updateItem({ chartSpec: updated });
    },
    [item, updateItem]
  );

  const handleRefresh = useCallback(() => {
    if (!item) return;
    setIsRefreshing(true);
    setTimeout(() => {
      updateItem({ lastRefreshed: new Date().toISOString() });
      setIsRefreshing(false);
    }, 500);
  }, [item, updateItem]);

  const handleConfirmRemove = useCallback(() => {
    setConfirmDelete(false);
    onRemove(itemId);
  }, [itemId, onRemove]);

  if (!item) {
    return (
      <div className="w-[340px] border-l bg-background h-full flex items-center justify-center text-sm text-muted-foreground">
        Item not found
      </div>
    );
  }

  const PANEL_TITLE: Record<string, string> = {
    chart: "Chart Settings",
    table: "Table Settings",
    metric: "Metric",
    sql: "SQL Query",
    text: "Text Card",
    sticky: "Sticky Note",
    "follow-up": "Insight",
    report: "Report",
    parameter: "Parameter",
    segment: "Segment",
  };

  return (
    <>
      <div className="w-[340px] border-l bg-background h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold">
            {PANEL_TITLE[item.type] ?? "Settings"}
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Title (all types) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="w-full px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Refresh cadence (all types) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Refresh
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {REFRESH_CADENCE_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => updateItem({ refreshCadence: c })}
                  className={`px-2 py-1.5 text-xs rounded-md border transition-colors capitalize ${
                    item.refreshCadence === c
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-foreground border-border hover:bg-muted"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* ── Chart-specific ── */}
          {item.type === "chart" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Chart Type
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {CHART_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => handleChartTypeChange(t)}
                    className={`px-2 py-1.5 text-xs rounded-md border transition-colors capitalize ${
                      item.chartSpec?.type === t
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Axis config (all chart types with data) ── */}
          {item.type === "chart" && dataKeys.length > 0 && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">X-axis</label>
                <select
                  value={item.chartSpec?.xKey ?? ""}
                  onChange={(e) => handleAxisChange("xKey", e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select</option>
                  {dataKeys.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              {item.chartSpec?.type !== "pie" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Y-axis</label>
                  <select
                    value={item.chartSpec?.yKeys?.[0] ?? ""}
                    onChange={(e) => handleAxisChange("yKeys", e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Select</option>
                    {dataKeys.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
              )}
              {item.chartSpec?.type === "scatter" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Group by (color)</label>
                  <select
                    value={item.chartSpec.nameKey ?? ""}
                    onChange={(e) => handleAxisChange("nameKey", e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">(none)</option>
                    {dataKeys.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* ── Report-specific ── */}
          {item.type === "report" && item.reportMarkdown && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Report Content
              </label>
              <div className="border rounded-md bg-muted/20 p-3 overflow-y-auto max-h-[400px]">
                <div className="prose prose-sm prose-muted max-w-none text-xs leading-relaxed whitespace-pre-wrap">
                  {item.reportMarkdown}
                </div>
              </div>
            </div>
          )}

          {/* ── Metric-specific ── */}
          {item.type === "metric" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Metric ID
              </label>
              <p className="text-xs text-muted-foreground font-mono">
                {item.metricId ?? "—"}
              </p>
            </div>
          )}

          {/* ── Text / Sticky markdown content ── */}
          {(item.type === "text" || item.type === "sticky") &&
            item.markdownContent !== undefined && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Content
                </label>
                <textarea
                  value={item.markdownContent ?? ""}
                  onChange={(e) =>
                    updateItem({ markdownContent: e.target.value })
                  }
                  rows={6}
                  className="w-full px-3 py-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono resize-y"
                />
              </div>
            )}

          {/* ── Parameter-specific ── */}
          {item.type === "parameter" && item.parameterConfig && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Input Type
                </label>
                <p className="text-xs capitalize">
                  {item.parameterConfig.inputType}
                </p>
              </div>
              {item.parameterConfig.defaultValue && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Default Value
                  </label>
                  <p className="text-xs font-mono">
                    {item.parameterConfig.defaultValue}
                  </p>
                </div>
              )}
              {item.parameterConfig.options &&
                item.parameterConfig.options.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Options
                    </label>
                    <ul className="text-xs space-y-0.5">
                      {item.parameterConfig.options.map((opt, i) => (
                        <li key={i} className="font-mono text-muted-foreground">
                          {opt}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          )}

          {/* ── Segment-specific ── */}
          {item.type === "segment" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Segment ID
              </label>
              <p className="text-xs text-muted-foreground font-mono">
                {item.segmentId ?? "—"}
              </p>
            </div>
          )}

          {/* ── Insight / follow-up content ── */}
          {item.type === "follow-up" && item.markdownContent && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Insight
              </label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {item.markdownContent}
              </p>
            </div>
          )}

          {/* ── SQL (shown for chart, sql, table, segment types) ── */}
          {item.sql && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                SQL Query
              </label>
              <pre className="text-[9.9px] bg-muted/50 rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground leading-relaxed">
                {item.sql}
              </pre>
            </div>
          )}

          {/* ── Data Preview (chart, table, sql types) ── */}
          {dataPreview && dataPreview.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Data Preview ({dataPreview.length} of{" "}
                {(item.data ?? item.chartSpec?.data)?.length ?? 0} rows)
              </label>
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-[9.9px]">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {dataKeys.map((key) => (
                        <th
                          key={key}
                          className="px-2 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap"
                        >
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataPreview.map((row, i) => (
                      <tr
                        key={i}
                        className={
                          i < dataPreview.length - 1 ? "border-b" : ""
                        }
                      >
                        {dataKeys.map((key) => (
                          <td
                            key={key}
                            className="px-2 py-1 whitespace-nowrap"
                          >
                            {String(
                              (row as Record<string, unknown>)[key] ?? ""
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Last Refreshed */}
          {item.lastRefreshed && (
            <p className="text-[9.9px] text-muted-foreground">
              Last refreshed:{" "}
              {new Date(item.lastRefreshed).toLocaleString()}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-4 py-3 border-t flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ml-auto"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Remove from canvas?"
        description={`"${item.title}" will be removed from your canvas. This action cannot be undone.`}
        confirmLabel="Remove"
        onConfirm={handleConfirmRemove}
      />
    </>
  );
}
