/**
 * Relationship inference prompt — takes existing metrics and produces
 * a causal/compositional relationship graph + dynamic categories.
 */

import type { MetricDefinition } from "@/lib/metric-types";

export function buildRelationshipInferencePrompt(
  metrics: MetricDefinition[],
  datasetLabel: string,
): string {
  const metricList = metrics.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    formula: m.formula,
    type: m.type,
    category: m.category,
    table: m.table,
    column: m.column,
    valueSql: m.valueSql,
    timeSeriesSql: m.timeSeriesSql,
    aggregation: m.aggregation,
    dimensions: m.dimensions,
  }));

  return `You are a metrics architect analyzing the "${datasetLabel}" dataset.

Below is a list of ${metrics.length} metrics. Your job is to:
1. Identify which metric is the ROOT — the single top-line business outcome
2. Determine the causal and compositional RELATIONSHIPS between them
3. Assign each metric a domain-appropriate CATEGORY

METRICS:
${JSON.stringify(metricList, null, 2)}

OUTPUT FORMAT — return a JSON object:
{
  "rootMetricId": "m-the-root",
  "metrics": [
    {
      "metricId": "m-example",
      "category": "Revenue",
      "relationships": [
        { "metricId": "m-other", "metricName": "Other Metric", "direction": "drives", "type": "component" }
      ]
    }
  ]
}

ROOT METRIC:
- "rootMetricId" is the single most important business outcome metric — the one everything else feeds into
- For most businesses this is total revenue, GMV, or the primary financial KPI
- The root metric should have NO outgoing "drives" relationships (it is the ultimate target)
- All other metrics should eventually connect to the root through the relationship graph

RULES:
- Every metric from the input MUST appear in the "metrics" array (by metricId)
- "direction" must be "drives" only (the consumer will infer "driven_by" automatically)
- "type" must be "component" (A is a building block of B) or "influence" (A causally affects B)
- Max 3 outgoing "drives" relationships per metric
- Only reference metricId values from the input list — no invented IDs
- Metrics with no meaningful causal connections should have an empty "relationships" array

RELATIONSHIP TYPE GUIDANCE:
- PREFER "component" over "influence" — the tree visualization is built from these edges
- Use "component" when A feeds into B in any structural way: subtotal → total, rate numerator → rate, funnel step → conversion, cost item → total cost, segment count → total count
- Use "component" broadly: if A's increase directly and mechanically increases B, that is "component"
- Use "influence" ONLY for truly indirect/behavioral links where the mechanism is unclear (e.g. NPS → brand perception)
- Goal: at least 70% of relationships should be "component" type to create a well-connected tree

CATEGORIES:
- Assign 3-6 categories total across all metrics
- Categories must be domain-appropriate for "${datasetLabel}" (e.g. "Revenue", "Operations", "Growth", "Quality", "Engagement")
- Every metric gets exactly one category string

TREE STRUCTURE:
- The relationships MUST form a connected tree/DAG rooted at "rootMetricId"
- Intermediate metrics drive the root; leaf metrics drive intermediates
- EVERY metric must connect to the tree — no orphan nodes. If a metric has no obvious parent, connect it to the most relevant intermediate metric
- The tree should have 2-4 levels of depth

Respond with ONLY the JSON object. No markdown, no explanation.`;
}
