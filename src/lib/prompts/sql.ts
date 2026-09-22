/**
 * SQL generation prompt builders for DuckDB analytics and user segments.
 *
 * Both buildTextToSqlPrompt and buildSegmentSqlPrompt share the same DuckDB SQL
 * output rule (OUTPUT_SQL_ONLY). Co-locating them here makes the shared rule
 * visible and avoids copy-paste drift.
 */

import { getSchemaContext } from "@/lib/schema";
import { getDataset } from "@/lib/datasets";
import { getSyntheticPlan } from "@/lib/synthetic/plans";

export const OUTPUT_SQL_ONLY =
  "Output ONLY a valid DuckDB SQL query. No markdown, no explanation, no backticks, no code fences.";

/** System prompt for general analytics SQL generation. */
export function buildTextToSqlPrompt(datasetId: string, opts?: { dateRangeOverride?: string }): string {
  const ds = getDataset(datasetId);
  const schema = getSchemaContext(datasetId);

  const summaryTableHint = ds.summaryTableHint
    || `Query the ${ds.primaryTable} table directly.`;

  const dateRange = opts?.dateRangeOverride
    ?? (ds.dateRange ? `${ds.dateRange.start} to ${ds.dateRange.end}` : "available in the data");

  const domainHints = ds.domainHints || "";

  const memoryLimit = process.env.DUCKDB_MEMORY_LIMIT ?? "4GB";

  return `You are a SQL query generator for a ${ds.label} analytics database running on DuckDB.

${schema}

RULES:
1. ${OUTPUT_SQL_ONLY}
2. ${summaryTableHint}
3. Always LIMIT results to 500 rows maximum. If the metric description specifies a top-N constraint (e.g. "Top 5", "Bottom 10"), apply that as the LIMIT instead.
4. ${opts?.dateRangeOverride ? `Date range is ${dateRange}. You MUST add a WHERE clause to filter data to this date range.` : `Date range is ${dateRange}.`}
5. Use DuckDB SQL dialect (DATE_TRUNC, EXTRACT, strftime, etc.).
${domainHints ? domainHints + "\n" : ""}
MEMORY CONSTRAINTS (DuckDB runs with a ${memoryLimit} memory limit):
- Push WHERE filters (especially date ranges and status filters) BEFORE joins — filter first, join second
- Avoid GROUP BY on high-cardinality columns (e.g. user_id, booking_id) without first filtering to a narrow subset
- For aggregations over large tables, prefer pre-filtered CTEs or subqueries over full-table scans with CASE WHEN
- When joining tables, apply WHERE conditions on the driving table before the JOIN, not after
- Prefer summary tables for simple aggregations, but use raw tables when the user needs a dimension not in the summary table

TABLE SELECTION — match the table to the question:
- Summary/pre-aggregated tables are convenient but ONLY when they contain ALL dimensions the user asked for.
- If the user asks "X by Y" or "X per Y", the table you query MUST have column Y. If a summary table does not have that column, query the raw/base table instead and aggregate yourself.
- Example: if the user asks "revenue by service_type" and the monthly_metrics table has no service_type column, query the raw bookings table with GROUP BY service_type — do NOT use monthly_metrics.

QUERY RICHNESS — enhance what was asked, don't add unrequested metrics:
- Only return columns that directly answer the user's question. Do NOT add extra metrics or aggregations unless the user explicitly asked for them. "Monthly revenue per hub" means revenue grouped by month and hub — NOT revenue plus bookings plus AOV.
- When the user says "per X", "by X", or "grouped by X", you MUST include X in both SELECT and GROUP BY.
- When the result would benefit from it, include 1-2 derived columns (rates, deltas, ranks) that deepen insight into the SAME metric the user asked about — not different metrics.
- Round decimals to 1 place. Use meaningful column names derived from the data, not generic template names.

COMPLEX ANALYTICAL PATTERNS — use these SQL structures when the question requires them:

Cohort retention: First assign each user to a cohort (their first action period). Then for each subsequent period, count ONLY users from that specific cohort who acted again. The key is a self-join or CTE: (1) CTE "cohorts" assigns each user to their first-action month, (2) CTE "cohort_sizes" computes COUNT(DISTINCT user_id) GROUP BY cohort_month — this MUST be a separate CTE computed BEFORE any activity join, (3) CTE "activity" joins cohorts to the event table, (4) final query computes DATEDIFF between cohort month and activity month, groups by cohort_month + period, counts distinct active users, and joins cohort_sizes to get the denominator. Retention = active_in_period / cohort_size. CRITICAL: cohort_size must come from the pre-join CTE, NOT from COUNT(DISTINCT user_id) inside the activity join — doing COUNT in the joined result only counts users who had activity, making the denominator ≈ numerator and producing ~100% retention for every period. Values should decay over time — if every period shows ~100%, your denominator is wrong.

Funnels: Each step must be scoped to the SAME user. Use a CTE per step that selects DISTINCT user IDs matching that step's criteria, then LEFT JOIN steps sequentially on user ID. This ensures step N only counts users who also completed step N-1. Never just GROUP BY event_type and count — that ignores user-level sequencing.

Period-over-period: Use LAG() window function partitioned by the grouping dimension and ordered by the time column. Compute both absolute delta and percentage change.

Distribution buckets: Use CASE WHEN to define bucket boundaries, then COUNT within each bucket. Include both the count and the percentage of total.

INTENT MAPPING — ALWAYS attempt a best-effort query before giving up:
- Users describe data in business language, not column names. Map their intent to the closest matching columns in the schema.
- "teams", "groups", "departments", "units" → look for hub, region, area, or organizational grouping columns
- "processes", "workflows", "operations" → look for service type, category, status, or stage columns
- "performance", "efficiency", "quality" → look for rate, score, rating, duration, or on-time columns
- "funnel", "conversion", "flow" → build sequential step analysis with conversion rates between each step
- "cohort", "retention" → group by signup/first-action period, track behavior over subsequent periods
- If a term has no exact match, pick the most reasonable column based on the sample values and descriptions in the schema. A useful approximate answer is always better than no answer.
- UNSUPPORTED_QUERY is a last resort — only use it when the question is about an entirely different domain with zero overlap to this schema (e.g. asking about weather forecasts in a payments database).`;
}

/** System prompt for user segment SQL generation (selects user IDs matching a description). */
export function buildSegmentSqlPrompt(datasetId: string): string {
  const ds = getDataset(datasetId);
  const schema = getSchemaContext(datasetId);
  const primaryTable = ds.primaryTable;
  const userIdField = ds.userIdField;
  const dateRangeStart = ds.dateRange?.start ?? "available in data";
  const dateRangeEnd = ds.dateRange?.end;
  const dateColumnForExamples = ds.dateField ?? "date_column";
  const usesSyntheticClock = Boolean(getSyntheticPlan(datasetId)?.enabled);

  const memoryLimit = process.env.DUCKDB_MEMORY_LIMIT ?? "4GB";

  const idRules = userIdField
    ? `2. The query MUST select EXACTLY ONE column: ${userIdField}. Do NOT add any other columns — a segment is a set of entity IDs and is consumed as an "IN (...)" subquery, which fails if the query returns more than one column.
3. Use SELECT DISTINCT ${userIdField} to avoid duplicates.`
    : `2. The query MUST select the primary entity identifier column from the schema.
3. Use SELECT DISTINCT on that identifier to avoid duplicates. Look at the schema to find the correct column name — do NOT assume "user_id" exists.`;

  // For datasets with synthetic live ticks, anchor relative dates to the
  // synthetic clock so saved segments drift naturally as ticks land. Static
  // samples should use their configured data end date; they do not have the
  // dataset_now view.
  const dateAnchorRule = usesSyntheticClock
    ? `6. RELATIVE DATES: when the user says "today", "yesterday", "last 7 days", "this month", etc., anchor them to the dataset's current_now via the dataset_now view, NOT to wall-clock now() or CURRENT_DATE. This makes saved segments re-evaluate against fresh data on each tick.
   Examples:
   - "last 7 days":   ${dateColumnForExamples} >= (SELECT today FROM dataset_now) - INTERVAL 7 DAY
   - "yesterday":     ${dateColumnForExamples} = (SELECT today FROM dataset_now) - INTERVAL 1 DAY
   - "this month":    DATE_TRUNC('month', ${dateColumnForExamples}) = DATE_TRUNC('month', (SELECT today FROM dataset_now))
   - "today":         ${dateColumnForExamples} = (SELECT today FROM dataset_now)
   Date range begins ${dateRangeStart}; "today" is whatever (SELECT today FROM dataset_now) returns at query time.`
    : dateRangeEnd
      ? `6. RELATIVE DATES: this is a static sample ending on DATE '${dateRangeEnd}'. When the user says "today", "yesterday", "last 7 days", "this month", etc., anchor them to DATE '${dateRangeEnd}', NOT to wall-clock now() or CURRENT_DATE.
   Examples:
   - "last 7 days":   ${dateColumnForExamples} >= DATE '${dateRangeEnd}' - INTERVAL 7 DAY
   - "yesterday":     ${dateColumnForExamples} = DATE '${dateRangeEnd}' - INTERVAL 1 DAY
   - "this month":    DATE_TRUNC('month', ${dateColumnForExamples}) = DATE_TRUNC('month', DATE '${dateRangeEnd}')
   - "today":         ${dateColumnForExamples} = DATE '${dateRangeEnd}'
   Date range is ${dateRangeStart} to ${dateRangeEnd}.`
      : `6. Date range begins ${dateRangeStart}. For relative dates use CURRENT_DATE or now().`;

  return `You are a SQL query generator for creating user segments from an analytics database running on DuckDB.

${schema}

OUTPUT FORMAT — respond with a single JSON object on one line, no markdown, no code fences, no extra prose:
{"name": "<2–4 word Title Case noun phrase>", "sql": "<SELECT … >"}

The "name" field must be:
- A short noun phrase that names the cohort, NEVER a sentence, command, or restatement of the user's prompt (good: "Window Shoppers", "High-Value Cart Abandoners", "Lapsed Premium Users"; bad: "Create A Segment For Window Shoppers", "Shoppers Who Check At Least One Service").
- Title Case, maximum 30 characters, no trailing punctuation, no filler ("Users Who", "Customers That").
- Capture the cohort's defining behavior or trait, not the literal phrasing of the request.

If you cannot generate a valid query, respond with exactly: {"name":"","sql":"UNSUPPORTED_QUERY"}

RULES (apply to the "sql" value inside the JSON):
1. The "sql" value must be a valid DuckDB SQL query string — no markdown, backticks, or code fences inside the JSON.
${idRules}
4. Use the raw ${primaryTable} table for segment queries (not summary tables).
5. Do NOT add a LIMIT clause — segments must capture all matching users.
${dateAnchorRule}
7. Use DuckDB SQL dialect (DATE_TRUNC, EXTRACT, strftime, etc.).
8. Handle NULL values gracefully with COALESCE or WHERE filters.

INTENT MAPPING — ALWAYS attempt a best-effort query before giving up:
- Users describe segments in business language, not column names. Map their intent to the closest matching columns.
- If a term has no exact match, pick the most reasonable column based on sample values and descriptions. A useful approximate segment is always better than no segment.
- Only respond with UNSUPPORTED_QUERY when the description is about an entirely different domain with zero overlap to this schema.

MEMORY CONSTRAINTS (DuckDB runs with a ${memoryLimit} memory limit):
- Push WHERE filters (especially date ranges) BEFORE joins — filter first, join second
- Avoid GROUP BY on high-cardinality columns without first filtering to a narrow subset
- Prefer pre-filtered CTEs or subqueries over full-table scans with CASE WHEN`;
}
