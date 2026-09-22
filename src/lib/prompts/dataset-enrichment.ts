/**
 * Prompt builders for DuckDB dataset enrichment pipeline.
 * Moved from src/lib/datasets/schema-enricher.ts — that file imports from here.
 *
 * ColumnAnalysis is defined here (rather than in schema-enricher.ts) because
 * it exists solely to type the output of buildColumnAnalysisPrompt.
 */

import type { TableProfile } from "@/lib/datasets/data-profiler";
import type { ColumnMeta } from "@/lib/datasets/types";

export interface ColumnAnalysis {
  columns: Record<string, ColumnMeta>;
  /** LLM-detected primary entity/user identifier column */
  userIdField?: string;
  /** LLM-detected primary date/timestamp column for time-series analysis */
  dateField?: string;
  domain: string;
  domainPersona: string;
  domainFocus: string;
  currency?: string;
}

export function buildColumnAnalysisPrompt(profiles: TableProfile[], label: string): string {
  let profileText = "";
  for (const table of profiles) {
    profileText += `\n## Table: ${table.tableName} (${table.rowCount.toLocaleString()} rows)\n\n`;
    profileText += "| Column | Type | Nulls | Distinct | Sample Values |\n";
    profileText += "|--------|------|-------|----------|---------------|\n";
    for (const col of table.columns) {
      const nullPct = table.rowCount > 0
        ? `${((col.nullCount / col.totalCount) * 100).toFixed(1)}%`
        : "0%";
      const samples = col.sampleValues.length > 0
        ? col.sampleValues.slice(0, 8).join(", ")
        : "(high cardinality)";
      profileText += `| ${col.name} | ${col.type} | ${nullPct} | ${col.distinctCount.toLocaleString()} | ${samples} |\n`;
    }
    profileText += "\nSample rows (first 5):\n```json\n";
    profileText += JSON.stringify(table.sampleRows.slice(0, 5), null, 2);
    profileText += "\n```\n";
  }

  // Build cross-table column frequency summary for multi-table datasets
  let crossTableHint = "";
  if (profiles.length > 1) {
    const colTableMap = new Map<string, string[]>();
    for (const table of profiles) {
      for (const col of table.columns) {
        if (!colTableMap.has(col.name)) colTableMap.set(col.name, []);
        colTableMap.get(col.name)!.push(table.tableName);
      }
    }
    const shared = [...colTableMap.entries()]
      .filter(([, tables]) => tables.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 20);
    if (shared.length > 0) {
      crossTableHint = "\n## Shared columns (appear across multiple tables)\n";
      for (const [col, tables] of shared) {
        crossTableHint += `- **${col}** → ${tables.length} tables: ${tables.join(", ")}\n`;
      }
      crossTableHint += "\nColumns shared across many tables are strong candidates for the primary entity identifier (userIdField).\n";
    }
  }

  return `You are a data schema analyst. Analyze this dataset and provide rich metadata.

Dataset label: "${label}"

${profileText}
${crossTableHint}

Respond with a JSON object:
{
  "columns": {
    "<column_name>": {
      "description": "Clear description of what this column represents",
      "semanticType": "metric" | "dimension" | "identifier" | "timestamp" | "text",
      "sqlGotcha": "Any SQL gotcha for this column (special chars in name, date format parsing needed, etc.) or null"
    }
    // ... for EVERY column across all tables
  },
  "userIdField": "The column name of the primary entity identifier — the column you would use for SELECT DISTINCT counts, segments, and cohorts. This is NOT limited to users/customers. Every dataset has a primary entity: rides have ride_id, orders have order_id, loans have loan_id, tickets have ticket_id, sessions have session_id. Pick the column with semanticType 'identifier' that uniquely identifies each record. Must be an actual column name from the schema above. Set to null ONLY if the dataset is pre-aggregated summary data with no row-level identifier.",
  "dateField": "The column name of the primary date/timestamp column — the one used for time-series analysis, trend charts, and period filtering (e.g. 'order_date', 'created_at', 'booking_date', 'event_at'). Pick the column that best represents WHEN each record occurred. It may be stored as DATE, TIMESTAMP, or even VARCHAR (date strings). Must be an actual column name from the schema above. Set to null ONLY if no date/time column exists.",
  "domain": "Brief domain label (e.g. 'food delivery logistics', 'lending/credit risk', 'ecommerce retail')",
  "domainPersona": "Role description for an analytics assistant (e.g. 'delivery operations analytics assistant')",
  "domainFocus": "2-3 sentence focus instruction for the analytics assistant — what key business questions matter for this domain",
  "currency": "Currency code if financial data detected (e.g. 'USD', 'INR') or null"
}

Rules:
- Include EVERY column from EVERY table
- semanticType must be exactly one of: "metric", "dimension", "identifier", "timestamp", "text"
- sqlGotcha should be null for normal columns. Flag columns with: spaces/special chars in name (need quoting), date strings that need parsing (explain the format), encoded values, etc.
- domain should be 2-5 words
- domainFocus should mention 3-4 specific analytical areas relevant to this data
- userIdField: choose the column that uniquely identifies each record. Every row-level dataset has one: ride_id, order_id, loan_id, customer_id, ticket_id, session_id, etc. If both a user ID and a transaction ID exist, prefer the user ID. But if only a transaction ID exists (e.g. ride_id with no user column), use that — it's still the primary entity for segmentation and counting. Set to null ONLY for pre-aggregated summary tables. Never return the string "none" — use JSON null.
- dateField: choose the column that represents when each record happened. Prefer event/transaction timestamps over survey/response dates. The column may be VARCHAR with date strings — that's fine, pick it anyway. If multiple date columns exist, pick the one most central to the data (e.g. 'order_date' over 'survey_date'). Set to null only if no date column exists. Never return the string "none" — use JSON null.`;
}

export function buildPromptGenerationInput(
  analysis: ColumnAnalysis,
  profiles: TableProfile[],
  label: string,
): string {
  // Build column summary for the LLM
  let colSummary = "";
  for (const table of profiles) {
    colSummary += `\nTable: ${table.tableName} (${table.rowCount.toLocaleString()} rows)\n`;
    for (const col of table.columns) {
      const meta = analysis.columns[col.name];
      const desc = meta?.description || "unknown";
      const type = meta?.semanticType || "unknown";
      const gotcha = meta?.sqlGotcha ? ` [GOTCHA: ${meta.sqlGotcha}]` : "";
      colSummary += `  - ${col.name} (${col.type}): ${desc} [${type}]${gotcha}\n`;
      if (col.sampleValues.length > 0 && col.sampleValues.length <= 15) {
        colSummary += `    Values: ${col.sampleValues.join(", ")}\n`;
      }
    }
  }

  const primaryTable = profiles[0]?.tableName || "data";
  const secondaryTables = profiles.slice(1);

  return `You are a prompt engineer for a multi-agent SQL analytics system. Given the column analysis below, generate optimized prompts.

Dataset: "${label}" (domain: ${analysis.domain})
${colSummary}

${secondaryTables.length > 0 ? `Secondary tables: ${secondaryTables.map(t => t.tableName).join(", ")}` : "Single table dataset."}

Generate a JSON object with these exact fields:

{
  "domainHints": "Numbered rules (starting at 6) for SQL generation gotchas specific to THIS dataset. Include: column quoting requirements, date parsing patterns, value encoding, join guidance. Example format:\\n6. Column \\\"Time_taken (min)\\\" has spaces — always quote it.\\n7. Date field is VARCHAR like 'Jan-2015', parse with strptime(issue_d, '%b-%Y').\\nProvide 3-6 rules. If no gotchas, provide general DuckDB hints.",

  "summaryTableHint": "One sentence telling the SQL generator how to query this dataset. Example: 'Query the ${primaryTable} table directly for all analysis. No pre-materialized summary tables exist.'",

  "agents": [
    {
      "id": "<choose from canonical list>",
      "queries": [
        { "description": "<domain-relevant analysis query>", "hint": "<SQL hint using actual column names from schema>" },
        { "description": "<another relevant query>", "hint": "<specific SQL pattern: GROUP BY, WHERE, aggregation>" },
        { "description": "<trend or breakdown query>", "hint": "<date-based or dimensional aggregation hint>" },
        { "description": "<ranking or top-N query>", "hint": "<ORDER BY ... LIMIT pattern>" }
      ]
    },
    {
      "id": "data-quality",
      "queries": [
        { "description": "NULL rates for all key fields", "hint": "COUNT(*) - COUNT(col) for each column" },
        { "description": "Daily volume anomaly detection", "hint": "COUNT(*) GROUP BY date, look for drops" },
        { "description": "Duplicate record check", "hint": "COUNT(*) vs COUNT(DISTINCT id)" },
        { "description": "Value range validation", "hint": "MIN/MAX/AVG for numeric columns, check for outliers" }
      ]
    }
  ],

  "annotatedSchemaContext": "A complete schema context block for SQL generation. Format:\\nDATABASE ENGINE: DuckDB\\n\\nPRIMARY TABLE: tablename (~N rows)\\n  - column_name    TYPE    -- description (sample values if low cardinality)\\n  ...\\n\\nFor each table. Include a DATA CONTEXT section with domain facts.",

  "suggestedPrompts": [
    "6 example questions a user might ask about THIS specific dataset.",
    "Each should be a natural-language analytics question referencing real columns/concepts.",
    "Mix of simple (one metric) and complex (comparison, trend, breakdown).",
    "Example for food delivery: 'How does weather affect average delivery time?'",
    "Example for ecommerce: 'What is the purchase conversion rate?'",
    "Example for lending: 'What are the default rates by loan grade?'"
  ],

  "welcomeSubtitle": "A single sentence describing what users can ask about this dataset. Example: 'Ask anything about delivery times, driver performance, or order patterns.' Keep it under 20 words."
}

AGENTS RULES — this is the most important part:
- Choose ONLY the agents that are relevant for this dataset from the 6 canonical roles below.
- SKIP agents that don't make sense (e.g. skip "geographic" if no location/region data, skip "cohort-retention" if no user/entity ID for repeat analysis).
- Each agent should have 4-8 queries to thoroughly cover its domain. Think about every useful analytical angle: breakdowns, distributions, trends, rankings, comparisons, cross-tabs, outlier detection. More queries = more comprehensive analysis. Only use fewer than 4 if the agent's scope is genuinely narrow for this dataset.
- The "hint" field should give concrete SQL guidance (GROUP BY clauses, CASE WHEN patterns, date parsing, etc.)
- Every query must reference actual column names from the schema.

The 9 canonical agent roles (use these exact IDs):
  data-quality     — NULL rates per column, field completeness checks, volume anomaly detection, duplicate detection, value range validation, data freshness, referential integrity between tables
  daily-metrics    — Time-series trends for every key metric: daily/weekly/monthly aggregations, moving averages, period-over-period comparisons, seasonality patterns, peak/trough detection
  cohort-retention — Repeat behavior analysis, frequency distributions, retention curves, churn analysis, time-between-events, first-event-to-second-event gaps, lifetime value by cohort (needs a user/entity ID column)
  rev-opt          — Primary value metric optimization: revenue/conversion breakdowns by every dimension, funnel analysis, price distribution, top-N rankings, cross-dimensional revenue analysis, discount/promotion impact
  user-segmentation — Entity grouping by behavior, spending tiers, engagement levels, RFM analysis, power user identification, inactive user detection, segment size distribution (needs a user/entity ID)
  geographic       — Location/region/category dimensional breakdowns: performance by geography, regional comparisons, concentration analysis, cross-category behavior, dimensional heat maps
  research             — External context, industry benchmarks, competitive analysis, market trends, seasonal patterns, best practice recommendations (useful for any dataset)
  data-analysis        — Statistical distributions, correlation analysis, trend significance testing, outlier detection, confidence intervals, descriptive statistics (useful for any dataset with numeric data)
  marketing-optimization — Channel attribution, customer acquisition cost, LTV analysis, campaign ROI, conversion funnel optimization, marketing effectiveness metrics (needs source/channel or acquisition data)

Other rules:
- annotatedSchemaContext should annotate every column with a comment, group logically, and include value enumerations for low-cardinality dimensions
- suggestedPrompts: 6 natural-language analytics questions referencing real columns
- Minimum 3 agents, maximum 9 agents`;
}
