import type { DetectableEntity } from "./entity-types";
import type { SegmentDisplay } from "./types";
import type { SavedFunnel } from "./funnel-types";
import type { SavedRetention } from "./retention-types";
import type { Metric } from "./metric-types";
import { getAllMetrics } from "./metric-store";
import { getAllEntries } from "./knowledge-store";
import { getAllPlaybookSummariesMerged } from "./playbook-store";
import { getScouts } from "./scout-data";
import { getAllBoards } from "./board-store";

function formatMetricStat(m: Metric, currency = "₹"): string {
  const change = m.changePercent;
  if (change == null) return formatValue(m.value, m.valueFormat, currency);
  const arrow = change >= 0 ? "\u2191" : "\u2193";
  return `${arrow}${Math.abs(change)}% WoW`;
}

function formatValue(value: number, format: string, currency = "₹"): string {
  if (format === "currency") {
    if (value >= 1_000_000) return `${currency}${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${currency}${(value / 1_000).toFixed(1)}k`;
    return `${currency}${value.toFixed(0)}`;
  }
  if (format === "percent") return `${value.toFixed(1)}%`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

function formatUserCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M users`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k users`;
  return `${count} users`;
}

function formatRowCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M rows`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}k rows`;
  return `${count} rows`;
}

/**
 * Build a unified catalog of all detectable entities from existing stores.
 * Segments come from SidebarContext (React), so they're passed as a parameter.
 * @param datasetId - Active dataset ID for scoping store queries
 * @param segments - Segments from SidebarContext
 * @param currency - Currency symbol (defaults to "₹", derived from dataset config)
 */
export function buildEntityCatalog(datasetId: string, segments: SegmentDisplay[], currency = "₹", funnels: SavedFunnel[] = [], retentions: SavedRetention[] = []): DetectableEntity[] {
  return [
    // Metrics — full payload matching page-level entity context
    ...getAllMetrics(datasetId).map((m): DetectableEntity => ({
      id: m.id,
      type: "metric",
      name: m.name,
      description: m.description,
      tags: [m.category],
      stat: formatMetricStat(m, currency),
      route: "/metrics",
      contextPayload: {
        id: m.id,
        name: m.name,
        description: m.description,
        formula: m.formula,
        sql: m.sql,
        table: m.table,
        column: m.column,
        timeColumn: m.timeColumn,
        aggregation: m.aggregation,
        granularity: m.granularity,
        dimensions: m.dimensions,
        category: m.category,
        value: m.value,
        valueFormat: m.valueFormat,
        changePercent: m.changePercent,
        timeSeries: m.timeSeries,
        relationships: m.relationships,
        version: m.version,
      },
    })),

    // Segments — full payload matching page-level entity context
    ...segments
      .filter((s) => !s.archived)
      .map((s): DetectableEntity => ({
        id: s.id,
        type: "segment",
        name: s.name,
        description: s.description,
        tags: [s.type],
        stat: formatUserCount(s.userCount),
        route: `/segments/${s.id}`,
        contextPayload: {
          description: s.description,
          sql: s.sql,
          userCount: s.userCount,
          type: s.type,
          behavioralTraits: s.behavioralTraits,
          behavioralSummary: s.behavioralSummary,
          differentiator: s.differentiator,
          performanceMetrics: s.performanceMetrics,
        },
      })),

    // Playbooks — merged static + saved, using summary fields only
    ...getAllPlaybookSummariesMerged().map((p): DetectableEntity => ({
      id: p.id,
      type: "playbook",
      name: p.name,
      description: p.description,
      tags: [p.category],
      stat: p.lastRun || "Never run",
      route: `/playbooks/${p.id}`,
      contextPayload: {
        description: p.description,
        category: p.category,
      },
    })),

    // Knowledge entries
    ...getAllEntries(datasetId).map((k): DetectableEntity => ({
      id: k.id,
      type: "knowledge",
      name: k.content.length > 60 ? k.content.slice(0, 57) + "..." : k.content,
      description: k.content,
      tags: [k.category],
      stat: k.category,
      route: undefined,
      contextPayload: {
        content: k.content,
        level: k.level,
        category: k.category,
        priority: k.priority,
      },
    })),

    // Scouts
    ...getScouts().map((s): DetectableEntity => ({
      id: s.id,
      type: "scout",
      name: s.name,
      description: s.description,
      tags: [],
      stat: s.status,
      route: `/scouts/${s.id}`,
      contextPayload: {
        description: s.description,
        prompt: s.prompt,
        schedule: s.schedule,
        playbook: s.playbook.name,
      },
    })),

    // Boards — scoped to active dataset
    ...getAllBoards(datasetId).map((b): DetectableEntity => ({
      id: b.id,
      type: "board",
      name: b.name,
      description: b.description ?? "",
      tags: ["board"],
      stat: b.updatedAt ? new Date(b.updatedAt).toLocaleDateString() : "",
      route: `/canvas/${b.id}`,
      contextPayload: { boardId: b.id, description: b.description ?? "" },
    })),

    // Funnels — from sidebar context
    ...funnels.map((f): DetectableEntity => ({
      id: f.id,
      type: "funnel",
      name: f.name,
      description: f.description,
      tags: [`${f.config.steps.length} steps`],
      stat: f.overallConversion != null ? `${f.overallConversion}% conversion` : "",
      route: `/funnels/${f.id}`,
      contextPayload: {
        name: f.name,
        description: f.description,
        steps: f.config.steps.map((s) => s.eventId),
        overallConversion: f.overallConversion,
        conversionWindow: f.config.conversionWindow,
      },
    })),

    // Retentions — from sidebar context
    ...retentions.map((r): DetectableEntity => ({
      id: r.id,
      type: "retention",
      name: r.name,
      description: r.description,
      tags: [r.config.mode],
      stat: r.d7Retention != null ? `${r.d7Retention}% D7` : "",
      route: `/retentions/${r.id}`,
      contextPayload: {
        name: r.name,
        description: r.description,
        startEventId: r.config.startEventId,
        returnEventIds: r.config.returnEventIds,
        d7Retention: r.d7Retention,
        mode: r.config.mode,
      },
    })),
  ];
}
