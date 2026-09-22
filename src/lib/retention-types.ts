import type { PropertyFilter, DateRangePreset } from "./explorer-types";

// ── Retention Modes ──

export type RetentionMode = "on_or_after" | "on" | "custom";

export const RETENTION_MODE_LABELS: Record<RetentionMode, string> = {
  on_or_after: "Return On or After",
  on: "Return On",
  custom: "Return On (Custom)",
};

// ── Custom Brackets ──

export interface RetentionBracket {
  from: number; // days
  to: number;   // days
}

export const DEFAULT_BRACKETS: RetentionBracket[] = [
  { from: 0, to: 1 },
  { from: 1, to: 3 },
  { from: 3, to: 7 },
  { from: 7, to: 14 },
  { from: 14, to: 30 },
];

// ── Config ──

export type RetentionGranularity = "daily" | "weekly" | "monthly";

export const DAY_BUCKETS = [0, 1, 3, 7, 14, 30, 60, 90] as const;

export interface RetentionConfig {
  startEventId: string;
  returnEventIds: string[]; // up to 2
  startFilters?: PropertyFilter[];
  returnFilters?: PropertyFilter[];
  mode: RetentionMode;
  customBrackets?: RetentionBracket[];
  granularity: RetentionGranularity;
  dateRange: { preset: DateRangePreset } | { start: string; end: string };
  breakdown?: string;
  segmentIds?: string[];
  segmentCompare?: boolean;
}

// ── Result ──

export interface RetentionCohort {
  cohortDate: string;
  cohortSize: number;
  retainedByBucket: Record<number, number>;
}

export interface RetentionSeriesResult {
  returnEventId: string;
  returnEventLabel: string;
  cohorts: RetentionCohort[];
  overall: Record<number, number>;
}

/** One series of cohorts + weighted-overall retention for a single breakdown value */
export interface RetentionBreakdownSeries {
  /** The breakdown property value (e.g. "google", "ios", "premium") */
  value: string;
  /** Total entry-cohort size summed across all cohorts for this breakdown value */
  totalCohortSize: number;
  /** Per-bucket weighted retention % across all cohorts of this breakdown value */
  overall: Record<number, number>;
}

export interface RetentionResult {
  config: RetentionConfig;
  sql: string;
  cohorts: RetentionCohort[];
  overall: Record<number, number>;
  dayBuckets: number[];
  /** Per-return-event results when multiple return events are selected */
  seriesResults?: RetentionSeriesResult[];
  /** Per-breakdown-value series when config.breakdown is set */
  breakdownSeries?: RetentionBreakdownSeries[];
  executionTimeMs: number;
  error?: string;
}

// ── Default ──

// ── Saved Retention ──

export interface SavedRetention {
  id: string;
  name: string;
  description: string;
  config: RetentionConfig;
  source: "manual" | "chat" | "auto";
  d7Retention: number | null;
  datasetId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedRetentionDisplay extends SavedRetention {
  startEventLabel: string;
  returnEventLabels: string[];
}

// ── Default ──

export function createDefaultRetentionConfig(): RetentionConfig {
  return {
    startEventId: "",
    returnEventIds: [],
    mode: "on_or_after",
    granularity: "daily",
    dateRange: { preset: "30d" },
  };
}
