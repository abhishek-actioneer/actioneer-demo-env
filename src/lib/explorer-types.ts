import type { ChartSpec } from "./chart-types";

// ── Event Definitions (curated per dataset) ──

export interface EventProperty {
  column: string;
  displayName: string;
  type: "string" | "number" | "date";
  cardinalityHint?: "low" | "medium" | "high";
}

export interface EventDefinition {
  /** Unique event ID (e.g. "purchase", "page_view") */
  id: string;
  /** Display name (e.g. "Purchase", "Page Viewed") */
  displayName: string;
  /** UI grouping category (e.g. "Loan Lifecycle", "Collections") */
  category?: string;
  /** Source table */
  table: string;
  /** Column to filter on (e.g. "event_type") */
  filterColumn?: string;
  /** Value to match (e.g. "purchase") */
  filterValue?: string;
  /** Raw SQL predicate appended to WHERE clause (e.g. "entity = 'hfc'") */
  filterSQL?: string;
  /** Column to COUNT — defaults to "*" */
  countColumn?: string;
  /** Numeric column for Sum/Average measures (e.g. "price") */
  valueColumn?: string;
  /** Date/time column override (defaults to dataset.dateField) */
  dateColumn?: string;
  /**
   * Whether this event can participate in funnels and retentions.
   * Set to false for events whose `dateColumn` is not a real per-event
   * timestamp — e.g. status flags on parent rows (every row "happens" at
   * the same parent timestamp), or daily-rollup booleans where multiple
   * "events" share the same day. These events still work fine for trends
   * and segments. Defaults to true.
   */
  funnelEligible?: boolean;
  /** Available properties for filtering and breakdown */
  properties: EventProperty[];
}

// ── Measurement Types ──

export type MeasureType = "uniques" | "event_totals" | "sum" | "average" | "active_pct" | "frequency";

export const MEASURE_TYPE_LABELS: Record<MeasureType, string> = {
  uniques: "Uniques",
  event_totals: "Event Totals",
  active_pct: "Active %",
  average: "Average",
  frequency: "Frequency",
  sum: "Sum",
};

// ── Explorer Config (the query definition) ──

export interface PropertyFilter {
  property: string;
  operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "not_in";
  value: string | number | string[];
}

export interface EventSelection {
  eventId: string;
  measureType: MeasureType;
  filters?: PropertyFilter[];
}

export type DateRangePreset = "7d" | "30d" | "60d" | "90d" | "1y";

export interface ExplorerConfig {
  events: EventSelection[];
  dateRange: { preset: DateRangePreset } | { start: string; end: string };
  granularity: "hourly" | "daily" | "weekly" | "monthly";
  breakdown?: string;
  segmentIds?: string[];
  chartType: "line" | "bar" | "area" | "stacked-bar" | "stacked-area" | "pie" | "kpi";
  /** Advanced computation applied client-side to query results */
  computation?: "none" | "rolling-avg" | "cumulative";
  /** Rolling average window size (in data points) */
  rollingWindow?: number;
  /** Period-over-period comparison */
  compare?: "none" | "previous_period" | "previous_year";
  /** When true, each segment becomes a separate series (comparison mode).
   *  When false/undefined, all segments filter with AND. */
  segmentCompare?: boolean;
}

// ── Explorer Result (API response) ──

export interface ExplorerResult {
  config: ExplorerConfig;
  sql: string;
  chartSpec: ChartSpec;
  data: Record<string, unknown>[];
  breakdownData?: Record<string, unknown>[];
  /** Sorted date strings from the query results (for breakdown table columns) */
  dates?: string[];
  executionTimeMs: number;
  error?: string;
}

// ── Default config factory ──

export function createDefaultConfig(): ExplorerConfig {
  return {
    events: [],
    dateRange: { preset: "30d" },
    granularity: "daily",
    chartType: "line",
  };
}

// ── Granularity auto-selection ──

export function autoGranularity(dateRange: ExplorerConfig["dateRange"]): ExplorerConfig["granularity"] {
  if ("preset" in dateRange) {
    switch (dateRange.preset) {
      case "7d": return "daily";
      case "30d": return "daily";
      case "60d": return "weekly";
      case "90d": return "weekly";
      case "1y": return "monthly";
    }
  }
  // Custom range: estimate days
  const start = new Date(dateRange.start);
  const end = new Date(dateRange.end);
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 14) return "daily";
  if (days <= 90) return "weekly";
  return "monthly";
}
