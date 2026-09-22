"use client";

import { Search, Plus, RefreshCw, Sparkles } from "lucide-react";

interface MetricTreeToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  categories: string[];
  onNewMetric: () => void;
  onRefresh: () => void;
  onRegenerate: () => void;
  regenerating?: boolean;
}

export function MetricTreeToolbar({
  searchQuery,
  onSearchChange,
  activeCategory,
  onCategoryChange,
  categories,
  onNewMetric,
  onRefresh,
  onRegenerate,
  regenerating,
}: MetricTreeToolbarProps) {
  const allCategories = ["All", ...categories];

  return (
    <div className="bg-background">
      {/* Row 1 — title + actions */}
      <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-border">
        <h1 className="text-xl font-semibold text-foreground">Metric Tree</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50"
            title="Regenerate metrics from schema"
          >
            <Sparkles className={`w-3.5 h-3.5 ${regenerating ? "animate-pulse" : ""}`} />
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
          <button
            onClick={onNewMetric}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 active:scale-[0.98] transition-[background-color,transform]"
          >
            <Plus className="w-3.5 h-3.5" />
            New Metric
          </button>
        </div>
      </div>

      {/* Row 2 — search + category filters */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search Metrics"
            className="w-48 pl-8 pr-3 py-1.5 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring/20"
          />
        </div>
        <div className="flex items-center gap-1">
          {allCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryChange(cat)}
              className={`px-2.5 py-1 text-[9.9px] font-medium rounded-full border transition-colors ${
                activeCategory === cat
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-foreground border-border hover:bg-muted"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
