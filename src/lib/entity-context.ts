import type { DetectedEntity, DetectedDateRange, EntityType } from "./entity-types";
import { ENTITY_TYPE_PRIORITY } from "./entity-types";

const TOKEN_BUDGET = 2000; // Approximate token cap for entity context

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatMetricValue(value: number, format?: string, currency = "₹"): string {
  if (format === "percent") return `${(value * 100).toFixed(1)}%`;
  if (format === "currency") return `${currency}${value.toLocaleString()}`;
  return value.toLocaleString();
}

// ── Rich page entity context for LLM prompt injection ──

/**
 * Build a structured context block from a page entity's rich payload.
 * Two sections: one for SQL generation (compact, SQL-focused) and one
 * for synthesis (business context, current state, trends).
 *
 * Returns { sqlContext, synthesisContext, fullContext }.
 * - sqlContext: inject into SQL generation prompts (formula, table, column, dimensions)
 * - synthesisContext: inject into report/response synthesis (value, trends, business meaning)
 * - fullContext: both combined (for single-injection-point flows)
 */
export function buildPageEntityContext(
  entity: { type: string; name: string; summary?: string; contextPayload?: Record<string, unknown> },
  options?: { currency?: string },
): { sqlContext: string; synthesisContext: string; fullContext: string } {
  const currency = options?.currency ?? "₹";
  const { type, name, contextPayload: p } = entity;
  if (!p) {
    // Fallback: minimal context from name/summary only
    const line = `The user is viewing: ${name}${entity.summary ? ` (${entity.summary})` : ""}`;
    return { sqlContext: line, synthesisContext: line, fullContext: line };
  }

  const sqlLines: string[] = [];
  const synthLines: string[] = [];

  switch (type) {
    case "metric": {
      sqlLines.push(`Entity: Metric "${name}"`);
      if (p.formula) sqlLines.push(`Formula: ${p.formula}`);
      if (p.sql) sqlLines.push(`SQL Definition: ${p.sql}`);
      if (p.table) sqlLines.push(`Table: ${p.table}`);
      if (p.column) sqlLines.push(`Column: ${p.column}`);
      if (p.aggregation) sqlLines.push(`Aggregation: ${p.aggregation}`);
      if (p.timeColumn) sqlLines.push(`Time Column: ${p.timeColumn}`);
      if (p.granularity) sqlLines.push(`Granularity: ${p.granularity}`);
      if (p.dimensions && Array.isArray(p.dimensions) && p.dimensions.length > 0) {
        sqlLines.push(`Available Dimensions: ${(p.dimensions as string[]).join(", ")}`);
      }

      synthLines.push(`Metric: ${name}`);
      if (p.description) synthLines.push(`Description: ${p.description}`);
      if (p.category) synthLines.push(`Category: ${p.category}`);
      if (p.value != null) {
        const fmt = p.valueFormat === "percent" ? `${((p.value as number) * 100).toFixed(1)}%`
          : p.valueFormat === "currency" ? `${currency}${(p.value as number).toLocaleString()}`
          : String(p.value);
        synthLines.push(`Current Value: ${fmt}`);
      }
      if (p.changePercent != null) synthLines.push(`Change: ${p.changePercent}%`);
      if (p.timeSeries && Array.isArray(p.timeSeries) && (p.timeSeries as Array<{ date: string; value: number }>).length > 0) {
        const ts = p.timeSeries as Array<{ date: string; value: number }>;
        const recent = ts.slice(-7);
        synthLines.push(`Recent Trend (last ${recent.length} periods): ${recent.map((t) => `${t.date}=${t.value}`).join(", ")}`);
      }
      if (p.relationships && Array.isArray(p.relationships) && (p.relationships as Array<{ metricName: string; type: string }>).length > 0) {
        const rels = p.relationships as Array<{ metricName: string; type: string }>;
        synthLines.push(`Related Metrics: ${rels.map((r) => `${r.metricName} (${r.type})`).join(", ")}`);
      }
      break;
    }
    case "segment": {
      sqlLines.push(`Entity: Segment "${name}"`);
      if (p.sql) sqlLines.push(`SQL Definition: ${p.sql}`);
      if (p.userCount != null) sqlLines.push(`User Count: ${p.userCount}`);

      synthLines.push(`Segment: ${name}`);
      if (p.description) synthLines.push(`Description: ${p.description}`);
      if (p.userCount != null) synthLines.push(`Users: ${(p.userCount as number).toLocaleString()}`);
      if (p.type) synthLines.push(`Type: ${p.type}`);
      if (p.behavioralTraits && Array.isArray(p.behavioralTraits)) {
        synthLines.push(`Behavioral Traits: ${(p.behavioralTraits as string[]).join(", ")}`);
      }
      if (p.behavioralSummary) synthLines.push(`Summary: ${p.behavioralSummary}`);
      if (p.differentiator) synthLines.push(`Key Differentiator: ${p.differentiator}`);
      if (p.performanceMetrics) {
        const pm = p.performanceMetrics as Record<string, { value: number; delta?: number }>;
        const parts = Object.entries(pm).map(([k, v]) => `${k}: ${v.value}${v.delta != null ? ` (${v.delta > 0 ? "+" : ""}${v.delta}%)` : ""}`);
        synthLines.push(`Performance: ${parts.join(", ")}`);
      }
      break;
    }
    case "playbook": {
      sqlLines.push(`Entity: Playbook "${name}"`);
      if (p.sourceQuery) sqlLines.push(`Original Query: ${p.sourceQuery}`);
      if (p.cells && Array.isArray(p.cells)) {
        const cells = p.cells as Array<{ label: string; sql?: string; description?: string }>;
        const withSql = cells.filter((c) => c.sql);
        if (withSql.length > 0) {
          sqlLines.push(`SQL Steps:`);
          for (const c of withSql.slice(0, 5)) {
            sqlLines.push(`  - ${c.label}: ${c.sql}`);
          }
        }
      }

      synthLines.push(`Playbook: ${name}`);
      if (p.description) synthLines.push(`Description: ${p.description}`);
      if (p.category) synthLines.push(`Category: ${p.category}`);
      if (p.cells && Array.isArray(p.cells)) {
        synthLines.push(`Steps: ${(p.cells as Array<{ label: string }>).map((c) => c.label).join(" → ")}`);
      }
      if (p.produces && Array.isArray(p.produces)) {
        synthLines.push(`Produces: ${(p.produces as Array<{ name: string; description: string }>).map((pr) => `${pr.name} (${pr.description})`).join(", ")}`);
      }
      break;
    }
    case "metrics-list": {
      const metrics = (p.metrics ?? []) as Array<{
        name: string; value: number; valueFormat?: string; changePercent?: number;
        type?: string; category?: string; description?: string;
        sql?: string; table?: string; column?: string; aggregation?: string; formula?: string;
      }>;
      sqlLines.push(`Page: Metrics catalog (${metrics.length} metrics)`);
      synthLines.push(`Metrics Catalog — ${metrics.length} defined metrics`);

      // Group by category for synthesis
      const byCategory: Record<string, typeof metrics> = {};
      for (const m of metrics) {
        const cat = (m.category as string) || "Other";
        (byCategory[cat] ??= []).push(m);
      }

      for (const [cat, items] of Object.entries(byCategory)) {
        synthLines.push(`\n[${cat}]`);
        for (const m of items) {
          const val = formatMetricValue(m.value, m.valueFormat, currency);
          const change = m.changePercent != null ? ` (${m.changePercent >= 0 ? "+" : ""}${m.changePercent.toFixed(1)}%)` : "";
          synthLines.push(`  ${m.name}: ${val}${change} — ${m.description || ""}`);
        }
      }

      // SQL context: compact table of metric SQL definitions
      sqlLines.push(`Metrics with SQL definitions:`);
      for (const m of metrics) {
        if (m.sql) {
          sqlLines.push(`  ${m.name} [${m.table || "?"}]: ${m.sql}`);
        } else if (m.formula) {
          sqlLines.push(`  ${m.name}: ${m.formula}`);
        }
      }
      break;
    }
    case "segments-list": {
      const segments = (p.segments ?? []) as Array<{
        name: string; userCount: number; sql?: string; type?: string;
        description?: string; refreshStatus?: string;
      }>;
      sqlLines.push(`Page: Segments catalog (${segments.length} segments)`);
      synthLines.push(`Segments Catalog — ${segments.length} segments`);

      for (const s of segments) {
        synthLines.push(`  ${s.name}: ${s.userCount.toLocaleString()} users${s.type ? ` (${s.type})` : ""}${s.description ? ` — ${s.description}` : ""}`);
        if (s.sql) sqlLines.push(`  ${s.name}: ${s.sql}`);
      }
      break;
    }
    case "playbooks-list": {
      const playbooks = (p.playbooks ?? []) as Array<{
        name: string; category?: string; description?: string;
        lastRunStatus?: string;
      }>;
      sqlLines.push(`Page: Playbooks catalog (${playbooks.length} playbooks)`);
      synthLines.push(`Playbooks Catalog — ${playbooks.length} playbooks`);

      for (const pb of playbooks) {
        synthLines.push(`  ${pb.name}${pb.category ? ` [${pb.category}]` : ""}${pb.description ? ` — ${pb.description}` : ""}`);
      }
      break;
    }
    case "knowledge-list": {
      const entries = (p.entries ?? []) as Array<{
        title: string; category?: string; priority?: string; scope?: string;
        content?: string;
      }>;
      synthLines.push(`Knowledge Base — ${entries.length} entries`);
      sqlLines.push(`Page: Knowledge base (${entries.length} entries)`);

      for (const e of entries) {
        synthLines.push(`  ${e.title}${e.category ? ` [${e.category}]` : ""}${e.priority ? ` (${e.priority})` : ""}`);
      }
      break;
    }
    case "data-catalog-list": {
      const tables = (p.tables ?? []) as Array<{
        name: string; rowCount?: number; columnCount?: number;
        columns?: Array<{ name: string; type: string }>;
      }>;
      sqlLines.push(`Page: Data Catalog (${tables.length} tables)`);
      synthLines.push(`Data Catalog — ${tables.length} tables`);

      for (const t of tables) {
        const cols = t.columns?.map((c) => `${c.name} (${c.type})`).join(", ") ?? "";
        sqlLines.push(`  Table "${t.name}": ${cols}`);
        synthLines.push(`  ${t.name}: ${t.rowCount?.toLocaleString() ?? "?"} rows, ${t.columnCount ?? "?"} columns`);
      }
      break;
    }
    case "scouts-list": {
      const scouts = (p.scouts ?? []) as Array<{
        name: string; playbook?: string; schedule?: string; status?: string;
      }>;
      synthLines.push(`Scouts — ${scouts.length} scouts`);
      sqlLines.push(`Page: Scouts (${scouts.length} scouts)`);

      for (const s of scouts) {
        synthLines.push(`  ${s.name}${s.playbook ? ` → ${s.playbook}` : ""}${s.schedule ? ` (${s.schedule})` : ""} [${s.status || "unknown"}]`);
      }
      break;
    }
    case "chart": {
      // Chart context injected from a canvas/deck chart card click
      sqlLines.push(`Entity: Chart "${name}"`);
      if (p.sql) sqlLines.push(`SQL: ${p.sql}`);

      synthLines.push(`Chart: ${name}`);
      if (p.clickedPoint && typeof p.clickedPoint === "object") {
        const cp = p.clickedPoint as { label?: string; measure?: string; value?: number | string };
        if (cp.label && cp.measure && cp.value != null) {
          synthLines.push(`Clicked data point: ${cp.label}, ${cp.measure} = ${typeof cp.value === "number" ? cp.value.toLocaleString() : cp.value}`);
        }
      }
      if (Array.isArray(p.data) && (p.data as unknown[]).length > 0) {
        const rows = p.data as Record<string, unknown>[];
        const preview = rows.slice(0, 30);
        synthLines.push(`Data (${rows.length} rows):\n${JSON.stringify(preview, null, 0)}`);
      }
      break;
    }
    default: {
      // Generic fallback
      sqlLines.push(`Entity: ${type} "${name}"`);
      synthLines.push(`${capitalize(type)}: ${name}`);
      for (const [k, v] of Object.entries(p)) {
        if (v != null && typeof v !== "object") {
          sqlLines.push(`${capitalize(k)}: ${v}`);
          synthLines.push(`${capitalize(k)}: ${v}`);
        }
      }
    }
  }

  const sqlContext = `--- PAGE ENTITY (for SQL) ---\n${sqlLines.join("\n")}\n--- END ---`;
  const synthesisContext = `--- PAGE ENTITY ---\n${[...synthLines].join("\n")}\n--- END ---`;
  const fullContext = `--- PAGE ENTITY ---\n${[...sqlLines, "", "Business Context:", ...synthLines.filter((l) => !sqlLines.includes(l))].join("\n")}\n--- END ---`;

  return { sqlContext, synthesisContext, fullContext };
}

function summarizePayload(type: EntityType, payload: Record<string, unknown>): string {
  switch (type) {
    case "metric": {
      const parts = [payload.definition as string];
      if (payload.value != null) parts.push(`current value: ${payload.value}`);
      if (payload.change != null) parts.push(`change: ${payload.change}%`);
      if (payload.sql) parts.push(`SQL: ${payload.sql}`);
      return parts.join("; ");
    }
    case "segment": {
      const parts = [payload.description as string];
      if (payload.userCount != null) parts.push(`${payload.userCount} users`);
      if (payload.sql) parts.push(`SQL: ${payload.sql}`);
      return parts.join("; ");
    }
    case "playbook":
      return `${payload.description}; category: ${payload.category}`;
    case "knowledge":
      return payload.content as string;
    case "table": {
      const parts = [`${payload.description}`];
      if (payload.columns) parts.push(`columns: ${payload.columns}`);
      return parts.join("; ");
    }
    case "scout":
      return `${payload.description}; playbook: ${payload.playbook}`;
    default:
      return JSON.stringify(payload);
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (groups[k] ??= []).push(item);
  }
  return groups;
}

/**
 * Build a formatted context string from detected entities and date range
 * for injection into LLM prompts.
 */
export function buildEntityContext(
  entities: DetectedEntity[],
  dateRange: DetectedDateRange,
): string {
  if (entities.length === 0 && dateRange.isDefault) return "";

  const sections: string[] = [];

  if (!dateRange.isDefault) {
    sections.push(`[Time Range] ${dateRange.phrase} → ${dateRange.start} to ${dateRange.end}`);
  }

  // Sort entities by priority (explicit first, then by type)
  const sorted = [...entities].sort((a, b) => {
    if (a.source !== b.source) return a.source === "explicit" ? -1 : 1;
    return ENTITY_TYPE_PRIORITY[a.entity.type] - ENTITY_TYPE_PRIORITY[b.entity.type];
  });

  // Group by type
  const grouped = groupBy(sorted, (e) => e.entity.type);
  let totalChars = sections.join("\n").length;

  for (const [type, items] of Object.entries(grouped)) {
    const lines: string[] = [];
    for (const e of items) {
      const summary = summarizePayload(type as EntityType, e.entity.contextPayload);
      const line = `- ${e.entity.name}: ${summary}`;

      // Token budget check (approximate: 1 token ≈ 4 chars)
      if (totalChars + line.length > TOKEN_BUDGET * 4) break;
      totalChars += line.length + 1;
      lines.push(line);
    }
    if (lines.length > 0) {
      sections.push(`[Detected ${capitalize(type)}s]\n${lines.join("\n")}`);
    }
  }

  return `\n--- Detected Context ---\n${sections.join("\n\n")}\n--- End Detected Context ---\n`;
}
