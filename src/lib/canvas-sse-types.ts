/**
 * Typed SSE events for /api/canvas-query.
 *
 * The server emits a "plan" event first describing the full card graph,
 * then "card-data" events in topological order as each card is executed.
 */

import type { CardType } from "./board-types";
import type { ChartSpec } from "./chart-types";

// ── Graph Plan ──

export interface CanvasCardPlan {
  cardId: string; // server-assigned, e.g. "card-0"
  type: CardType;
  title: string;
  derivedFrom: string[]; // cardIds this card depends on
  intent?: string; // LLM-generated description of what this card should contain
  /** For chart cards: LLM-specified config so we can build ChartSpec without a second LLM call */
  chartConfig?: {
    chartType: "bar" | "line" | "area" | "pie";
    xKey?: string;
    yKeys?: string[];
    nameKey?: string;
    valueKey?: string;
    format?: Record<string, "number" | "currency" | "percent">;
  };
}

// ── SSE Events ──

export type CanvasSSEEvent =
  | { type: "plan"; cards: CanvasCardPlan[]; queryGroupId: string }
  | {
      type: "card-data";
      cardId: string;
      cardType: "sql";
      sql: string;
      description: string;
    }
  | {
      type: "card-data";
      cardId: string;
      cardType: "query_result";
      columns: string[];
      rows: Record<string, unknown>[];
      rowCount: number;
      timeMs: number;
      error?: string;
    }
  | {
      type: "card-data";
      cardId: string;
      cardType: "chart";
      chartSpec: ChartSpec;
    }
  | {
      type: "card-data";
      cardId: string;
      cardType: "metric";
      value: string | number;
      label: string;
      delta?: string;
    }
  | { type: "card-data"; cardId: string; cardType: "text"; delta: string }
  | {
      type: "card-data";
      cardId: string;
      cardType: "annotation";
      text: string;
      severity: string;
    }
  | { type: "card-complete"; cardId: string }
  | { type: "progress"; cardId: string; phase: string }
  | {
      type: "annotations";
      items: Array<{ targetCardId: string; text: string }>;
      queryGroupId: string;
    }
  | { type: "suggestions"; questions: string[]; targetCardId: string; queryGroupId: string }
  | { type: "done"; queryGroupId: string }
  | { type: "error"; message: string; cardId?: string };

// ── Parsing ──

const VALID_CANVAS_TYPES = new Set([
  "plan",
  "card-data",
  "card-complete",
  "progress",
  "annotations",
  "suggestions",
  "done",
  "error",
]);

/** Parse an NDJSON line into a typed canvas SSE event. Returns null for unparseable lines. */
export function parseCanvasEvent(line: string): CanvasSSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Strip markdown code fences that LLMs sometimes wrap output in
  const clean = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  if (!clean) return null;

  try {
    const parsed = JSON.parse(clean);
    if (
      typeof parsed?.type === "string" &&
      VALID_CANVAS_TYPES.has(parsed.type)
    ) {
      return parsed as CanvasSSEEvent;
    }
    return null;
  } catch {
    return null;
  }
}
