import type { ChartSpec } from "./chart-types";

export interface CanvasItem {
  id: string;
  type: "chart" | "report" | "insight";
  title: string;
  pinnedAt: string; // ISO timestamp

  // Chart-specific
  chartSpec?: ChartSpec;
  sql?: string;
  data?: Record<string, unknown>[];

  // Canvas position
  position: { x: number; y: number };
  size: { width: number; height: number };

  // Linkage
  sourceConversationId?: string;
  sourceMessageIndex?: number;

  // Refresh
  lastRefreshed?: string; // ISO timestamp

  // Report-specific
  reportMarkdown?: string;
  // Report hero display
  heroMetric?: string;
  heroDelta?: string;

  // Insight-specific (SmartStack)
  insightText?: string;
  severity?: "info" | "warning" | "critical";
  dismissed?: boolean;
}

/* ── Shared severity badge tokens (used by chart-shape + smart-stack) ── */
export const SEVERITY_BADGE = {
  critical: {
    accent: "var(--severity-critical, #E5484D)",
    bg: "var(--severity-critical-bg, #fee2e2)",
    text: "var(--severity-critical-text, #991b1b)",
    label: "Critical",
  },
  warning: {
    accent: "var(--severity-warning, #F76B15)",
    bg: "var(--severity-warning-bg, #fef3c7)",
    text: "var(--severity-warning-text, #92400e)",
    label: "Warning",
  },
  info: {
    accent: "var(--severity-info, #3E63DD)",
    bg: "var(--severity-info-bg, #dbeafe)",
    text: "var(--severity-info-text, #1e40af)",
    label: "Info",
  },
} as const;

export interface CanvasItemSummary {
  id: string;
  type: CanvasItem["type"];
  title: string;
  pinnedAt: string;
  severity?: CanvasItem["severity"];
}
