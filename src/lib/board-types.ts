import type { ChartSpec } from "./chart-types";
import type { ExplorerConfig } from "./explorer-types";

export interface Board {
  id: string;
  name: string;
  description?: string;
  datasetId: string;
  createdAt: string;
  updatedAt: string;
  viewMode?: "document" | "canvas";
  globalTimeRange?: {
    preset?: "7d" | "30d" | "90d" | "1y" | "custom";
    start?: string;
    end?: string;
  };
  /** Links this board to a deck in deck-store (set when board was created from PDF upload) */
  deckId?: string;
  /** Template ID used to generate this board (drives LLM focus prompt) */
  templateId?: string;
}

export interface BoardSection {
  id: string;
  boardId: string;
  title: string;
  prose: string;
  order: number;
  collapsed: boolean;
}

export type CardType =
  | "chart"
  | "table"
  | "metric"
  | "sql"
  | "text"
  | "sticky"
  | "follow-up"
  | "report"
  | "parameter"
  | "segment"
  | "challenge"
  | "commentary";

export interface BoardCard {
  id: string;
  boardId: string;
  type: CardType;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  author: "user" | "system";

  // Type-specific data
  sql?: string;
  chartSpec?: ChartSpec;
  data?: Record<string, unknown>[];
  markdownContent?: string;
  parameterConfig?: ParameterConfig;
  metricId?: string;
  segmentId?: string;

  // Report-specific
  reportMarkdown?: string;
  heroMetric?: string;
  heroDelta?: string;

  // Liveness
  refreshCadence: "manual" | "hourly" | "daily";
  lastRefreshed?: string;
  lastData?: Record<string, unknown>[];

  // Provenance
  sourceConversationId?: string;
  sourceMessageIndex?: number;
  queryGroupId?: string;
  sourceCardId?: string;
  pinnedAt: string;

  // Document view
  sectionId?: string;
  orderInSection?: number;
  colSpan?: 1 | 2 | 3;

  // Comments
  comments: CardComment[];

  // User-attributed display name for this card
  authorChip?: string;

  // Silent LLM context attached to follow-up chips — not shown in UI
  silentContext?: string;

  // Indices of dismissed follow-up chips (persisted so they stay hidden after navigation)
  dismissedChips?: number[];

  // Schema-aware follow-up questions generated after a canvas query
  followUpQuestions?: string[];

  // Per-slide challenge finding from deck challenge API
  challengeFindings?: string;

  // Explorer config for interactive chart cards (date range / breakdown controls)
  explorerConfig?: ExplorerConfig;
}

export interface ParameterConfig {
  inputType: "date-range" | "dropdown" | "text" | "number";
  defaultValue?: string;
  options?: string[];
  label?: string;
}

export interface CardComment {
  id: string;
  cardId: string;
  author: "user" | "system";
  content: string;
  timestamp: string;
  spawnedCardId?: string;
}

export interface CardConnection {
  id: string;
  boardId: string;
  fromCardId: string;
  toCardId: string;
  label?: string;
}

export interface BoardFrame {
  id: string;
  boardId: string;
  title: string;
  description?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  collapsed: boolean;
  order?: number;
}

export interface BoardSummary {
  id: string;
  name: string;
  cardCount: number;
  updatedAt: string;
}
