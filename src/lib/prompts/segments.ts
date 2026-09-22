/**
 * Segment generation prompt — bulk-produces starter segment definitions from a schema map.
 */

import type { SchemaMap } from "@/lib/datasets/types";

export function buildSegmentGenerationPrompt(
  schemaMap: SchemaMap,
  userIdField: string | undefined,
  label: string,
): string {
  if (userIdField && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(userIdField)) {
    throw new Error(`Invalid userIdField: "${userIdField}"`);
  }

  // Build column summary fallback (same pattern as metrics prompt)
  let colSummary = "";
  for (const [name, meta] of Object.entries(schemaMap.columns)) {
    const type = meta.semanticType;
    const desc = meta.description;
    const gotcha = meta.sqlGotcha ? ` [GOTCHA: ${meta.sqlGotcha}]` : "";
    colSummary += `  - ${name}: ${desc} [${type}]${gotcha}\n`;
  }

  const memoryLimit = process.env.DUCKDB_MEMORY_LIMIT ?? "4GB";

  const selectClause = userIdField
    ? `SELECT DISTINCT ${userIdField} FROM ... WHERE ...`
    : `SELECT * FROM ... WHERE ...`;

  const sqlRules = userIdField
    ? `1. Must SELECT DISTINCT ${userIdField} as the first (and only required) column`
    : `1. Must SELECT * (or specific columns) with a WHERE clause that filters to the segment. Each row represents one entity.`;

  return `You are a data analyst creating segment definitions for an analytics platform.
Given the dataset schema below, generate starter segments that cover the most valuable cohorts for this domain.

Dataset: "${label}" (domain: ${schemaMap.domain})
${schemaMap.annotatedSchemaContext || colSummary}

${schemaMap.domainHints ? `SQL hints:\n${schemaMap.domainHints}` : ""}

Generate 8-12 segments that the teams who own this domain would actually build and act on. Frame them for the teams that matter HERE, not a generic "growth" lens:
- Consumer / app / marketplace domains: growth, marketing, lifecycle, and retention teams.
- Financial services and lending: risk, collections, cross-sell, upsell, and lifecycle teams.
- Healthcare / operations: operations, retention, and reactivation teams.
They must be realistic and specific to this domain, not generic placeholders.

COVERAGE: span the lifecycle so the set feels complete:
- Acquisition and activation (new or recently onboarded, signed up but not yet activated)
- Engagement (power users, declining engagement, dormant)
- Monetization (high-value, low-value, upsell or cross-sell ready)
- Retention and churn risk (at-risk, lapsed, win-back candidates)
- Domain-specific risk or status cohorts that matter here (for example delinquency buckets, failed transactions, SLA breaches, no-shows)

QUALITY BAR:
- Names should read like a real operator wrote them: specific and concrete (for example "High-Value Borrowers 30+ DPD", "Dormant SIP Investors 90d+", "Lapsed Power Users, Last 60 Days"), never vague ("Segment 1", "Active Users").
- Use realistic, defensible thresholds grounded in the schema and the dataset's date range. Prefer relative recency windows (last 30 / 60 / 90 days measured from the most recent date in the data) over hardcoded calendar dates, and pick value or frequency cutoffs that actually split the population.
- Every segment must map to a clear action (a campaign, a call list, an alert). The description states that action and why it matters in one sentence.
- Avoid degenerate segments: nothing that selects almost everyone or almost no one, and no two segments that are near-duplicates.

Each segment must have:
{
  "name": "Specific, operator-style name (3-6 words)",
  "description": "One sentence: what this cohort is and the action it enables",
  "sql": "${selectClause}"
}

SQL RULES:
${sqlRules}
2. Query the primary table directly — do NOT use summary or aggregation tables
3. Do NOT add LIMIT — the full matching set is needed for accurate counts and downstream features
4. Use DuckDB SQL syntax (DATE_TRUNC, EXTRACT, strftime, INTERVAL, etc.)
5. Handle NULL values with COALESCE or WHERE ... IS NOT NULL filters
6. Use only tables and columns shown in the schema above
7. Push WHERE filters before any joins or aggregations

MEMORY CONSTRAINTS (DuckDB runs with a ${memoryLimit} memory limit):
- Push WHERE filters (especially date ranges) BEFORE joins — filter first, join second
- Prefer pre-filtered CTEs or subqueries over full-table scans

Respond with ONLY a single JSON object of the form {"segments": [ ...the segment definitions... ]}. No markdown, no explanation.`;
}
