// ── Metric Type (semantic role) ──
export type MetricType = "kpi" | "indicator" | "diagnostic" | "index";

// ── Metric Category (dynamic — assigned by LLM per dataset) ──
export type MetricCategory = string;

// ── Health Status ──
export type MetricStatus = "healthy" | "partial" | "enrichment_needed" | "unavailable";

// ── Aggregation type for create wizard ──
export type CreateMetricAggregation = "sum" | "count" | "ratio" | "derived_ratio" | "unique_count";

// ── Value format for display ──
export type MetricValueFormat = "number" | "currency" | "percent" | "integer";

// ── Time grain ──
export type TimeGrain = "hourly" | "daily" | "weekly" | "monthly";

// ── Changelog entry ──
export interface MetricChangelogEntry {
  version: number;
  summary: string;       // e.g. "SQL definition updated", "Created"
  description?: string;  // User's change request (from chat)
  author: string;        // Email or name
  date: string;          // ISO date
  oldSql?: string;
  newSql?: string;
}

// ── Relationship between metrics ──
export interface MetricRelationship {
  metricId: string;
  metricName: string;
  direction: "drives" | "driven_by";
  type: "component" | "influence";
}

// ── Core Metric interface ──
export interface Metric {
  id: string;
  name: string;
  description: string;
  type: MetricType;
  category: MetricCategory;
  status: MetricStatus;

  // Current value
  value: number;
  valueFormat: MetricValueFormat;
  changePercent?: number;

  // Calculation definition
  aggregation: CreateMetricAggregation;
  table: string;
  column: string;
  timeColumn: string;
  formula: string;
  sql: string;

  // Scope
  dimensions: string[];
  timeGrain: TimeGrain;
  granularity: string;
  slices?: string[];

  // Relationships
  relationships: MetricRelationship[];

  // Metadata
  owner: string;
  ownerInitials: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  errors?: number;

  // Mock time-series for chart (16 data points for Nov 1-16)
  timeSeries?: { date: string; value: number }[];

  // Version history
  changelog?: MetricChangelogEntry[];
}

// ── Summary for catalog table ──
export interface MetricSummary {
  id: string;
  name: string;
  description: string;
  type: MetricType;
  category: MetricCategory;
  status: MetricStatus;
  value: number;
  valueFormat: MetricValueFormat;
  changePercent?: number;
  errors: number;
  owner: string;
  ownerInitials: string;
}

// ── MetricDefinition: LLM-generated metric recipe (stored as metrics.json per dataset) ──
export interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  type: MetricType;
  category: string;
  valueFormat: MetricValueFormat;
  aggregation: CreateMetricAggregation;
  valueSql: string;
  timeSeriesSql: string;
  table: string;
  column: string;
  timeColumn: string;
  formula: string;
  timeGrain?: TimeGrain;
  dimensions?: string[];
  relationships?: MetricRelationship[];
}

// ── Constants ──
export const METRIC_TYPE_LABELS: Record<MetricType, string> = {
  kpi: "KPI",
  indicator: "Indicator",
  diagnostic: "Diagnostic",
  index: "Index",
};

export const METRIC_TYPE_ICONS: Record<MetricType, string> = {
  kpi: "\u25B3",         // △
  indicator: "\u25CB",   // ○
  diagnostic: "\u25C7",  // ◇
  index: "\u25CF",       // ●
};

export const METRIC_TYPE_COLORS: Record<MetricType, string> = {
  kpi: "text-foreground bg-muted",
  indicator: "text-foreground bg-muted",
  diagnostic: "text-foreground bg-muted",
  index: "text-foreground bg-muted",
};

export const METRIC_STATUS_ICONS: Record<MetricStatus, string> = {
  healthy: "\u25CF",
  partial: "\u25D0",
  enrichment_needed: "\u26A0",
  unavailable: "\u2715",
};

export const METRIC_STATUS_COLORS: Record<MetricStatus, string> = {
  healthy: "text-emerald-500",
  partial: "text-amber-500",
  enrichment_needed: "text-orange-500",
  unavailable: "text-red-500",
};


export const AGGREGATION_OPTIONS: {
  type: CreateMetricAggregation;
  label: string;
  description: string;
}[] = [
  { type: "sum", label: "Sum", description: "Total of a numeric column" },
  { type: "count", label: "Count", description: "Number of rows matching a condition" },
  { type: "ratio", label: "Ratio", description: "One metric divided by another" },
  { type: "derived_ratio", label: "Derived Ratio", description: "Ratio computed from two columns in same table" },
  { type: "unique_count", label: "Unique Count", description: "Count of distinct values in a column" },
];

