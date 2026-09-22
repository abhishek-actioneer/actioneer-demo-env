/**
 * Canvas suggestion engine.
 *
 * When a card is added to a board, checks for related entities and returns
 * at most one suggestion the user might want to add next.
 */

import type { BoardCard } from "./board-types";
import { getAllMetrics } from "./metric-store";
import type { SegmentDisplay } from "./types";

export interface CardSuggestion {
  label: string;
  cardPayload: Partial<BoardCard>;
}

/**
 * Normalizes a string for loose matching: lowercase, strip punctuation.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

/**
 * Returns true when `haystack` contains all words from `needle`.
 */
function containsWords(haystack: string, needle: string): boolean {
  const words = normalize(needle).split(/\s+/).filter(Boolean);
  const h = normalize(haystack);
  return words.every((w) => h.includes(w));
}

/**
 * Given a newly added card and the current set of segments, return at most one
 * suggestion for a related card the user might want to add.
 *
 * Rules:
 *   - chart/sql/table card whose title mentions a metric name → suggest that metric card
 *   - metric card → suggest a segment whose name appears in the metric's related dimensions or keywords
 *   - segment card → suggest the metric most relevant to that segment (first keyword match)
 */
export function getSuggestion(
  card: BoardCard,
  segments: SegmentDisplay[],
  datasetId: string,
): CardSuggestion | null {
  const metrics = getAllMetrics(datasetId);

  // ── chart / sql / table / text card → find a metric whose name appears in the title ──
  if (
    card.type === "chart" ||
    card.type === "sql" ||
    card.type === "table" ||
    card.type === "text"
  ) {
    for (const metric of metrics) {
      if (containsWords(card.title, metric.name)) {
        return {
          label: metric.name,
          cardPayload: {
            type: "metric",
            title: metric.name,
            metricId: metric.id,
            size: { width: 280, height: 160 },
          },
        };
      }
    }
    return null;
  }

  // ── metric card → suggest the first active segment whose name matches the metric's dimensions ──
  if (card.type === "metric") {
    const metric = metrics.find((m) => m.id === card.metricId);
    if (!metric) return null;

    // Build a searchable string from the metric (name + dimensions + description)
    const metricContext = [
      metric.name,
      ...(metric.dimensions ?? []),
      metric.description ?? "",
      metric.category ?? "",
    ]
      .join(" ")
      .toLowerCase();

    for (const seg of segments.filter((s) => !s.archived)) {
      const segWords = normalize(seg.name).split(/\s+/).filter(Boolean);
      if (segWords.some((w) => w.length > 3 && metricContext.includes(w))) {
        return {
          label: seg.name,
          cardPayload: {
            type: "segment",
            title: seg.name,
            segmentId: seg.id,
            size: { width: 320, height: 200 },
          },
        };
      }
    }
    return null;
  }

  // ── segment card → suggest the metric whose name or description best matches the segment ──
  if (card.type === "segment") {
    const seg = segments.find((s) => s.id === card.segmentId);
    if (!seg) return null;

    const segContext = normalize(
      [seg.name, seg.description ?? ""].join(" ")
    );

    for (const metric of metrics) {
      const metricWords = normalize(metric.name).split(/\s+/).filter(Boolean);
      if (metricWords.some((w) => w.length > 3 && segContext.includes(w))) {
        return {
          label: metric.name,
          cardPayload: {
            type: "metric",
            title: metric.name,
            metricId: metric.id,
            size: { width: 280, height: 160 },
          },
        };
      }
    }
    return null;
  }

  return null;
}
