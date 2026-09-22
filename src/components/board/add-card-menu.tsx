"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { BarChart3, Hash, Table2, Lightbulb, MessageSquareText, ArrowLeft, TrendingUp, PieChart, AreaChart } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useDataset } from "@/lib/dataset-context";
import type { Metric } from "@/lib/metric-types";
import type { EventDefinition } from "@/lib/explorer-types";
import type { BoardCard } from "@/lib/board-types";

export type CardTypeOption = "metric" | "chart" | "table" | "insight" | "commentary";

export interface CardCreationPayload {
  type: CardTypeOption;
  /** For metric: the metric ID. For chart/table: the NL question. For insight: undefined. */
  value?: string;
  metricName?: string;
  sourceCardId?: string;
}

interface AddCardMenuProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  onSelect: (payload: CardCreationPayload) => void;
  availableCards?: BoardCard[];
}

const CATEGORIES = [
  {
    id: "chart" as const,
    icon: BarChart3,
    label: "Charts",
    description: "Generate a visualization",
  },
  {
    id: "metric" as const,
    icon: Hash,
    label: "Metrics",
    description: "Pick from your dataset",
  },
  {
    id: "table" as const,
    icon: Table2,
    label: "Tables",
    description: "Generate a data table",
  },
  {
    id: "other" as const,
    icon: Lightbulb,
    label: "Other",
    description: "Notes & insights",
  },
];

const CHART_SUBTYPES = [
  { icon: TrendingUp, label: "Line chart", hint: "e.g. Revenue trend by month" },
  { icon: BarChart3, label: "Bar chart", hint: "e.g. Top 10 categories by sales" },
  { icon: AreaChart, label: "Area chart", hint: "e.g. Cumulative signups over time" },
  { icon: PieChart, label: "Pie chart", hint: "e.g. Revenue split by region" },
];

const OTHER_OPTIONS = [
  { type: "insight" as const, icon: Lightbulb, label: "AI Insight", desc: "Attach to a board card and analyze it" },
  { type: "commentary" as const, icon: MessageSquareText, label: "Text Note", desc: "Add a manual annotation" },
];

function isInsightSourceCard(card: BoardCard): boolean {
  return card.type !== "commentary" && card.type !== "follow-up" && card.type !== "sticky";
}

export function AddCardMenu({ anchorRef, open, onClose, onSelect, availableCards = [] }: AddCardMenuProps) {
  const { datasetId, dataset } = useDataset();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("chart");
  const [nlValue, setNlValue] = useState("");
  const [metricSearch, setMetricSearch] = useState("");
  const [selectedInsightSourceId, setSelectedInsightSourceId] = useState("");
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when menu opens
  useEffect(() => {
    if (open) {
      setActiveCategory("chart");
      setNlValue("");
      setMetricSearch("");
      setSelectedInsightSourceId("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || activeCategory !== "other") return;
    const eligible = availableCards.filter(isInsightSourceCard);
    if (eligible.length === 1) {
      setSelectedInsightSourceId(eligible[0].id);
    }
  }, [open, activeCategory, availableCards]);

  // Position menu relative to anchor
  useEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const menuWidth = 480;
    const menuHeight = 320;
    const left = Math.max(8, Math.min(
      rect.left + rect.width / 2 - menuWidth / 2,
      window.innerWidth - menuWidth - 8
    ));
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight
      ? rect.top - menuHeight - 6
      : rect.bottom + 6;
    setPos({ top: Math.max(8, top), left });
  }, [open, anchorRef]);

  // Fetch metrics when metric or table category is active
  useEffect(() => {
    if ((activeCategory !== "metric" && activeCategory !== "table") || !open) return;
    if (metrics.length > 0) return; // already loaded
    setMetricsLoading(true);
    apiFetch<{ metrics: Metric[] }>(`/api/metrics?datasetId=${datasetId}`)
      .then((data) => setMetrics(data.metrics ?? []))
      .catch(() => setMetrics([]))
      .finally(() => setMetricsLoading(false));
  }, [activeCategory, open, datasetId, metrics.length]);

  // Focus input when switching to chart/table category
  useEffect(() => {
    if (open && (activeCategory === "chart" || activeCategory === "table")) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [activeCategory, open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleNlSubmit = useCallback((type: CardTypeOption) => {
    const q = nlValue.trim();
    if (!q) return;
    onSelect({ type, value: q });
    onClose();
  }, [nlValue, onSelect, onClose]);

  const handleMetricSelect = useCallback((metricId: string, metricName: string) => {
    onSelect({ type: "metric", value: metricId, metricName });
    onClose();
  }, [onSelect, onClose]);

  const handleTableMetricSelect = useCallback((metricId: string, metricName: string) => {
    onSelect({ type: "table", value: metricId, metricName });
    onClose();
  }, [onSelect, onClose]);

  const insightSourceCards = availableCards.filter(isInsightSourceCard);

  if (!open || !pos) return null;

  const filteredMetrics = metricSearch.trim()
    ? metrics.filter((m) => m.name.toLowerCase().includes(metricSearch.toLowerCase()))
    : metrics;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 rounded-lg border border-border bg-background shadow-xl overflow-hidden"
      style={{ top: pos.top, left: pos.left, width: 480 }}
    >
      <div className="flex" style={{ height: 300 }}>
        {/* Left column — categories */}
        <div className="w-[160px] border-r border-border bg-muted/30 py-2 shrink-0">
          <div className="px-3 py-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
            Add card
          </div>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onMouseEnter={() => setActiveCategory(cat.id)}
              onClick={() => setActiveCategory(cat.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                activeCategory === cat.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <cat.icon size={14} className="shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium">{cat.label}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Right column — content based on active category */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* ── Charts ── */}
          {activeCategory === "chart" && (() => {
            const events: EventDefinition[] = dataset.events ?? [];
            const chartSearch = nlValue.toLowerCase();
            const filteredEvents = chartSearch
              ? events.filter((e) => e.displayName.toLowerCase().includes(chartSearch) || e.table.toLowerCase().includes(chartSearch))
              : events;

            return (
              <>
                <div className="px-4 pt-3 pb-2">
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search events or describe a chart..."
                    value={nlValue}
                    onChange={(e) => setNlValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && nlValue.trim()) handleNlSubmit("chart"); }}
                    className="w-full text-sm bg-muted/50 rounded-md px-3 py-2 outline-none placeholder:text-muted-foreground/50 border border-border focus:border-foreground/20 transition-colors"
                  />
                </div>
                {/* Generate button when custom text entered */}
                {nlValue.trim() && filteredEvents.length === 0 && (
                  <div className="px-4 pb-2">
                    <button
                      type="button"
                      onClick={() => handleNlSubmit("chart")}
                      className="w-full text-xs font-medium py-2 rounded-md bg-foreground text-background hover:opacity-90 transition-opacity"
                    >
                      Generate chart
                    </button>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto px-3 pb-2">
                  {/* Events from dataset */}
                  {filteredEvents.length > 0 && (
                    <>
                      <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground px-1 mb-1 mt-1">
                        Events
                      </div>
                      {filteredEvents.map((ev) => (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => {
                            onSelect({ type: "chart", value: `Show ${ev.displayName} trend over time as a line chart` });
                            onClose();
                          }}
                          className="w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left hover:bg-muted/50 transition-colors"
                        >
                          <TrendingUp size={12} className="shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-foreground">{ev.displayName}</div>
                            <div className="text-[9px] text-muted-foreground truncate">{ev.table}{ev.filterColumn ? ` · ${ev.filterColumn}=${ev.filterValue}` : ""}</div>
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                  {/* Custom generate when events also match */}
                  {nlValue.trim() && filteredEvents.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleNlSubmit("chart")}
                      className="w-full mt-2 text-xs font-medium py-2 rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors"
                    >
                      Generate &quot;{nlValue.trim().slice(0, 40)}&quot; as chart
                    </button>
                  )}
                  {/* No events fallback */}
                  {events.length === 0 && !nlValue.trim() && (
                    <div className="text-xs text-muted-foreground text-center py-4">
                      Type a description to generate a chart from your data.
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          {/* ── Metrics ── */}
          {activeCategory === "metric" && (
            <>
              <div className="px-4 pt-3 pb-2">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search metrics..."
                  value={metricSearch}
                  onChange={(e) => setMetricSearch(e.target.value)}
                  className="w-full text-sm bg-muted/50 rounded-md px-3 py-2 outline-none placeholder:text-muted-foreground/50 border border-border focus:border-foreground/20 transition-colors"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-3 pb-2">
                {metricsLoading ? (
                  <div className="text-xs text-muted-foreground text-center py-6">Loading metrics...</div>
                ) : filteredMetrics.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-6">No metrics found</div>
                ) : (
                  filteredMetrics.slice(0, 30).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-muted/50 transition-colors truncate text-foreground"
                      onClick={() => handleMetricSelect(m.id, m.name)}
                    >
                      <span className="font-medium">{m.name}</span>
                      {m.description && (
                        <span className="text-muted-foreground ml-1.5 text-[9px]">{m.description}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {/* ── Tables ── */}
          {activeCategory === "table" && (() => {
            const tableSearch = nlValue.toLowerCase();
            const tableFilteredMetrics = tableSearch
              ? metrics.filter((m) => m.name.toLowerCase().includes(tableSearch))
              : metrics;

            return (
              <>
                <div className="px-4 pt-3 pb-2">
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search metrics or describe a table..."
                    value={nlValue}
                    onChange={(e) => setNlValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && nlValue.trim()) handleNlSubmit("table"); }}
                    className="w-full text-sm bg-muted/50 rounded-md px-3 py-2 outline-none placeholder:text-muted-foreground/50 border border-border focus:border-foreground/20 transition-colors"
                  />
                </div>
                {/* Generate button when custom text with no matching metrics */}
                {nlValue.trim() && tableFilteredMetrics.length === 0 && (
                  <div className="px-4 pb-2">
                    <button
                      type="button"
                      onClick={() => handleNlSubmit("table")}
                      className="w-full text-xs font-medium py-2 rounded-md bg-foreground text-background hover:opacity-90 transition-opacity"
                    >
                      Generate table
                    </button>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto px-3 pb-2">
                  {metricsLoading ? (
                    <div className="text-xs text-muted-foreground text-center py-6">Loading metrics...</div>
                  ) : tableFilteredMetrics.length > 0 ? (
                    <>
                      <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground px-1 mb-1 mt-1">
                        Metrics
                      </div>
                      {tableFilteredMetrics.slice(0, 30).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left hover:bg-muted/50 transition-colors"
                          onClick={() => handleTableMetricSelect(m.id, m.name)}
                        >
                          <Table2 size={12} className="shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-foreground">{m.name}</div>
                            {m.description && (
                              <div className="text-[9px] text-muted-foreground truncate">{m.description}</div>
                            )}
                          </div>
                        </button>
                      ))}
                    </>
                  ) : !nlValue.trim() ? (
                    <div className="text-xs text-muted-foreground text-center py-6">No metrics found</div>
                  ) : null}
                  {/* Custom generate when metrics also match */}
                  {nlValue.trim() && tableFilteredMetrics.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleNlSubmit("table")}
                      className="w-full mt-2 text-xs font-medium py-2 rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors"
                    >
                      Generate &quot;{nlValue.trim().slice(0, 40)}&quot; as table
                    </button>
                  )}
                </div>
              </>
            );
          })()}

          {/* ── Other (Insight + Text) ── */}
          {activeCategory === "other" && (
            <div className="px-3 pt-3 space-y-1">
              {OTHER_OPTIONS.map((opt) => (
                opt.type === "insight" ? (
                  <div
                    key={opt.type}
                    className="rounded-md border border-border bg-muted/20 p-3"
                  >
                    <div className="flex items-start gap-3">
                      <opt.icon size={16} className="shrink-0 text-muted-foreground mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-foreground">{opt.label}</div>
                        <div className="text-[9px] text-muted-foreground">{opt.desc}</div>
                      </div>
                    </div>
                    {insightSourceCards.length === 0 ? (
                      <p className="mt-3 text-[9.9px] text-muted-foreground">
                        Add a chart, table, metric, or text card first.
                      </p>
                    ) : (
                      <>
                        <div className="mt-3 space-y-1.5">
                          <label className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                            Source Card
                          </label>
                          <select
                            value={selectedInsightSourceId}
                            onChange={(e) => setSelectedInsightSourceId(e.target.value)}
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none transition-colors focus:border-foreground/20"
                          >
                            <option value="">Select a card...</option>
                            {insightSourceCards.map((card) => (
                              <option key={card.id} value={card.id}>
                                {card.title || "Untitled"} · {card.type}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="mt-2 text-[9px] text-muted-foreground">
                          The insight will be attached directly below the selected card.
                        </p>
                        <button
                          type="button"
                          disabled={!selectedInsightSourceId}
                          onClick={() => {
                            if (!selectedInsightSourceId) return;
                            onSelect({ type: "insight", sourceCardId: selectedInsightSourceId });
                            onClose();
                          }}
                          className="mt-3 w-full rounded-md bg-foreground py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Create insight
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => { onSelect({ type: opt.type }); onClose(); }}
                    className="w-full flex items-center gap-3 px-2 py-3 rounded-md text-left hover:bg-muted/50 transition-colors"
                  >
                    <opt.icon size={16} className="shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">{opt.label}</div>
                      <div className="text-[9px] text-muted-foreground">{opt.desc}</div>
                    </div>
                  </button>
                )
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
