/**
 * Generic prompt builders for dynamically uploaded datasets.
 * These are intentionally vague so the LLM can adapt them to any schema.
 *
 * Moved from src/lib/datasets/generic-prompts.ts — that file now re-exports
 * from here for backward compatibility.
 */

import type { SchemaMap } from "@/lib/datasets/types";

export function buildGenericQueryDescriptions(): Record<string, string[]> {
  return {
    "data-quality": [
      "NULL rates & field completeness",
      "Volume anomaly detection",
    ],
    "daily-metrics": [
      "Daily trends overview",
      "Key metric trends",
      "Volume patterns",
    ],
    "cohort-retention": [
      "Repeat entity analysis",
      "Frequency distribution",
      "Time between events",
    ],
    "rev-opt": [
      "Top-level breakdown",
      "Category/segment analysis",
      "Value distribution",
    ],
    "user-segmentation": [
      "Activity tier distribution",
      "Value tier distribution",
      "Cross-segment analysis",
    ],
    geographic: [
      "Dimension A performance",
      "Dimension B performance",
      "Cross-dimension analysis",
    ],
    "research": [
      "Industry context analysis",
      "Benchmark comparisons",
    ],
    "data-analysis": [
      "Statistical distributions",
      "Correlation analysis",
      "Trend detection",
    ],
    "marketing-optimization": [
      "Channel performance",
      "Acquisition cost analysis",
      "Conversion optimization",
    ],
  };
}

export function buildGenericMultiAgentPrompt(primaryTable: string): string {
  return `
data-quality|1| — Data completeness: NULL rates for all columns in ${primaryTable}
data-quality|2| — Daily volume: count rows per day to detect anomalies

daily-metrics|1| — Daily row counts and key metric trends
daily-metrics|2| — Distribution of key numeric columns over time
daily-metrics|3| — Aggregate statistics per day

cohort-retention|1| — Repeat entity analysis (entities appearing multiple times)
cohort-retention|2| — Frequency distribution of key grouping columns
cohort-retention|3| — Time gaps between events for same entity

rev-opt|1| — Breakdown by the most important categorical column
rev-opt|2| — Top categories/segments by key numeric metric
rev-opt|3| — Average values and distributions

user-segmentation|1| — Tier distribution by activity level
user-segmentation|2| — Tier distribution by numeric value
user-segmentation|3| — Cross-tabulation of key dimensions

geographic|1| — Performance by location/category dimension
geographic|2| — Top entities by key metric
geographic|3| — Cross-dimensional patterns

research|1| — Industry benchmarks and external context for key metrics
research|2| — Market context analysis and seasonal patterns

data-analysis|1| — Statistical distributions for key numeric columns
data-analysis|2| — Correlation analysis between key variables
data-analysis|3| — Trend significance testing

marketing-optimization|1| — Channel/source attribution analysis
marketing-optimization|2| — Acquisition cost analysis by entry path
marketing-optimization|3| — Conversion funnel optimization`;
}

export function buildGenericSystemContext(label: string, schemaContext: string, rowCount: number): string {
  return `You are Actioneer, an AI-powered analytics assistant. You are analyzing data for: ${label}.

Dataset: ~${rowCount.toLocaleString()} rows.

${schemaContext}

Response guidelines:
- Use markdown: headers (##, ###), tables, bullet points, bold for emphasis
- Cite specific numbers from the query results — never hallucinate data
- Be analytical and actionable — what should the business do?
- Note any limitations in the data
- Do NOT include suggested follow-up questions in your response — they are generated separately
- Never use emojis`;
}

/**
 * Build system context using schema map enrichment data.
 * Does NOT embed the full schema (avoids token waste from duplication).
 */
export function buildEnrichedSystemContext(sm: SchemaMap, label: string, _rowCount: number): string {
  const currencyNote = sm.currency ? `\nCurrency: ${sm.currency}` : "";
  return `You are Actioneer, an AI-powered ${sm.domainPersona}. You are analyzing data for: ${label}.
Domain: ${sm.domain}${currencyNote}

${sm.domainFocus}

Response guidelines:
- Use markdown: headers (##, ###), tables, bullet points, bold for emphasis
- Cite specific numbers from the query results — never hallucinate data
- Be analytical and actionable — what should the business do?
- Note any limitations in the data
- Do NOT include suggested follow-up questions in your response — they are generated separately
- Never use emojis`;
}

