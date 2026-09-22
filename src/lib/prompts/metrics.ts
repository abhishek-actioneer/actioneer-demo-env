/**
 * Metric definition generation prompt — produces structured metric JSON from a schema map.
 */

import type { SchemaMap } from "@/lib/datasets/types";

export function buildMetricGenerationPrompt(schemaMap: SchemaMap, label: string): string {
  // Build column summary
  let colSummary = "";
  for (const [name, meta] of Object.entries(schemaMap.columns)) {
    const type = meta.semanticType;
    const desc = meta.description;
    const gotcha = meta.sqlGotcha ? ` [GOTCHA: ${meta.sqlGotcha}]` : "";
    colSummary += `  - ${name}: ${desc} [${type}]${gotcha}\n`;
  }

  return `You are a metrics engineer for an analytics platform. Given the dataset schema below, generate metric definitions.

Dataset: "${label}" (domain: ${schemaMap.domain})
${schemaMap.annotatedSchemaContext || colSummary}

${schemaMap.domainHints ? `SQL hints:\n${schemaMap.domainHints}` : ""}
${schemaMap.summaryTableHint ? `Query hint: ${schemaMap.summaryTableHint}` : ""}

Generate as many metrics as the dataset can support (aim for 25-40). Cover EVERY table and summary table mentioned above. Mix of:
- 8-12 KPIs (total revenue, GMV, total bookings, completion rate — the top-line numbers)
- 8-12 Indicators (avg order value, daily active count, partner rating — supporting metrics)
- 8-12 Diagnostics (revenue per user, churn rate, LTV:CAC — derived ratios)

Be exhaustive. If there is a summary table, there should be metrics from it. If there is a numeric column, consider whether it deserves a metric.

Each metric must have:
{
  "id": "m-<kebab-case-id>",
  "name": "Human-readable name",
  "description": "One sentence explanation",
  "type": "kpi",
  "category": "Domain-specific category (e.g. Revenue, Growth, Quality, Operations, Engagement)",
  "valueFormat": "number",
  "aggregation": "sum",
  "valueSql": "SELECT ... AS value FROM ... -- single row, single 'value' column",
  "timeSeriesSql": "SELECT ... AS date, ... AS value FROM ... ORDER BY date -- returns date + value columns",
  "table": "primary table name",
  "column": "primary column being aggregated",
  "timeColumn": "date/time column used for time series",
  "formula": "Human-readable formula (e.g. SUM(price), COUNT(DISTINCT user_id))",
  "timeGrain": "daily",
  "dimensions": ["column1", "column2"],
  "relationships": [
    { "metricId": "m-other-id", "metricName": "Other Metric Name", "direction": "drives", "type": "component" }
  ]
}
(type: "kpi", "indicator", or "diagnostic"; valueFormat: "number", "currency", "percent", or "integer"; aggregation: "sum", "count", "ratio", "derived_ratio", or "unique_count"; timeGrain: "daily", "weekly", or "monthly"; direction: "drives" or "driven_by"; relationship type: "component" or "influence")

RULES:
- All SQL must be valid DuckDB SQL
- valueSql must return exactly one row with a column named "value"
- timeSeriesSql must return rows with "date" (DATE or VARCHAR) and "value" columns, ordered by date
- Use CAST/TRY_CAST for type conversions if needed
- For percent metrics, return the decimal (e.g. 0.89 not 89) — the UI will format it
- category should be domain-appropriate (not limited to Acquisition/Engagement/Revenue/Monetization)
- Use AT MOST 6 distinct category values across ALL metrics — broad domain buckets that group related metrics, never a unique category per metric (categories render as filter chips in the UI)
- dimensions should list columns useful for slicing this metric
- Respect any column quoting or date parsing gotchas mentioned above
- NEVER use CURRENT_DATE, NOW(), or CURRENT_TIMESTAMP in SQL — the dataset may be historical. Instead, use the MAX date from the data itself (e.g. WHERE date >= (SELECT MAX(date) FROM table) - INTERVAL '30 days')
${schemaMap.currency ? `- Currency is ${schemaMap.currency} — use "currency" valueFormat for monetary metrics` : ""}

RELATIONSHIPS:
- Populate each metric's "relationships" array with causal or compositional connections only (not correlational)
- Emit at most 3 outgoing "drives" relationships per metric
- For every A→B "drives" pair, also emit the mirror: B must have { metricId: A.id, direction: "driven_by" }
- Only reference "metricId" values that appear in your output (use the exact "id" value)
- Focus on causal chains (e.g. activation → retention → revenue) and compositional metrics (subtotals → totals)
- Metrics with no meaningful causal connections should have an empty "relationships" array

Respond with ONLY a single JSON object of the form {"metrics": [ ...the metric definitions... ]}. No markdown, no explanation.`;
}
