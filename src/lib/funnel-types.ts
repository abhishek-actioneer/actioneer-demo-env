import type { PropertyFilter, DateRangePreset } from "./explorer-types";

// ── Funnel Step ──

export interface FunnelStep {
  eventId: string;
  label?: string;
  filters?: PropertyFilter[];
}

// ── Funnel Config ──

export type ConversionWindow = "1h" | "1d" | "7d" | "30d" | "90d";

export const CONVERSION_WINDOW_LABELS: Record<ConversionWindow, string> = {
  "1h": "1 hour",
  "1d": "1 day",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

export type FunnelOrder = "this_order" | "any_order" | "exact_order";

export const FUNNEL_ORDER_LABELS: Record<FunnelOrder, string> = {
  this_order: "This Order",
  any_order: "Any Order",
  exact_order: "Exact Order",
};

// ── Counting Methods ──

export type CountingMethod = "uniques" | "totals" | "sessions";

export const COUNTING_METHOD_LABELS: Record<CountingMethod, string> = {
  uniques: "Uniques",
  totals: "Totals",
  sessions: "Sessions",
};

export interface FunnelConfig {
  steps: FunnelStep[];
  conversionWindow: ConversionWindow;
  order: FunnelOrder;
  dateRange: { preset: DateRangePreset } | { start: string; end: string };
  segmentIds?: string[];
  segmentCompare?: boolean;
  breakdown?: string;
  countingMethod?: CountingMethod;
}

// ── Funnel Result ──

export interface FunnelStepResult {
  stepIndex: number;
  eventId: string;
  label: string;
  userCount: number;
  conversionRate: number;  // % of step 0 users (step 0 = 100%)
  dropOffRate: number;     // % dropped from previous step
  dropOffCount: number;    // absolute drop from previous step
  avgTimeSeconds?: number; // average time from previous step (seconds)
  medianTimeSeconds?: number; // median time from previous step (seconds)
}

export interface FunnelSegmentResult {
  segmentId: string;
  segmentName: string;
  steps: FunnelStepResult[];
  totalEntered: number;
  totalConverted: number;
  overallConversionRate: number;
}

export interface FunnelBreakdownRow {
  stepIndex: number;
  breakdown: string;
  userCount: number;
  conversionRate: number; // % of step 0 for this breakdown value
}

export interface FunnelResult {
  config: FunnelConfig;
  sql: string;
  steps: FunnelStepResult[];
  totalEntered: number;
  totalConverted: number;
  overallConversionRate: number;
  /** Per-segment results when segmentCompare is true */
  segmentResults?: FunnelSegmentResult[];
  /** Per-breakdown-value per-step rows when breakdown is set */
  breakdownRows?: FunnelBreakdownRow[];
  executionTimeMs: number;
  error?: string;
}

// ── Saved Funnel ──

export interface SavedFunnel {
  id: string;
  name: string;
  description: string;
  config: FunnelConfig;
  source: "manual" | "chat" | "auto";
  overallConversion: number | null;
  datasetId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedFunnelDisplay extends SavedFunnel {
  stepCount: number;
  stepLabels: string[];
}

// ── Default config ──

export function createDefaultFunnelConfig(): FunnelConfig {
  return {
    steps: [],
    conversionWindow: "30d",
    order: "this_order",
    dateRange: { preset: "30d" },
  };
}
