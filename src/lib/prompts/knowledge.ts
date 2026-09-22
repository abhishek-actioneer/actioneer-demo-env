/**
 * Knowledge base parsing prompt — extracts structured knowledge entries from free text.
 */

import type { SchemaMap } from "@/lib/datasets/types";

/**
 * Bulk generation prompt — produces starter knowledge entries from a dataset schema.
 * Returns 15-20 entries covering metric definitions, validation rules, benchmarks, and business context.
 */
export function buildKnowledgeGenerationPrompt(schemaMap: SchemaMap, label: string): string {
  let colSummary = "";
  for (const [name, meta] of Object.entries(schemaMap.columns)) {
    const type = meta.semanticType;
    const desc = meta.description;
    const gotcha = meta.sqlGotcha ? ` [GOTCHA: ${meta.sqlGotcha}]` : "";
    colSummary += `  - ${name}: ${desc} [${type}]${gotcha}\n`;
  }

  return `You are a knowledge base curator for an analytics platform.
Given the dataset schema below, generate starter knowledge entries that will help an AI analyst understand the data better.

Dataset: "${label}" (domain: ${schemaMap.domain})
${schemaMap.annotatedSchemaContext || colSummary}

${schemaMap.domainHints ? `Domain hints:\n${schemaMap.domainHints}` : ""}

Generate 15-20 knowledge entries covering these categories (aim for a mix):
- "Metric" (Critical priority) — define key metrics: what they measure, how they are calculated, which column/table they come from
- "Data validation" (High priority) — known data quality rules, NULL handling, date range bounds, column gotchas
- "Metric range" (High priority) — expected value ranges and healthy thresholds (e.g. "Conversion rate is typically 2-5%")
- "Insight" (High priority) — important domain facts, business context, how the business works
- "Segment" (Good to have) — key user cohort descriptions and how to identify them in SQL
- "Reporting" (Good to have) — how to interpret or present results for this domain

Each entry must have:
{
  "content": "1-2 clear, specific sentences stating the knowledge fact",
  "category": "Metric",
  "priority": "Critical"
}

(category must be one of: "Metric", "Data validation", "Metric range", "Insight", "Segment", "Visualisation", "Reporting", "External benchmark")
(priority must be one of: "Critical", "High", "Good to have")

GUIDELINES:
- content should be factual and specific to this dataset — not generic advice
- Metric entries should name the exact column and calculation (e.g. "Revenue is SUM(amount) from the transactions table")
- Data validation entries should call out specific gotchas from the schema
- Be concise: each content string should be 1-2 sentences, never more

Respond with ONLY the JSON array. No markdown, no explanation.`;
}

export const PARSE_PROMPT = `You are a knowledge base parser. Given a blob of text, extract individual knowledge entries.

For each entry, determine:
1. The core knowledge statement (1-2 clear sentences)
2. A category from: Data validation, External benchmark, Insight, Reporting, Segment, Visualisation, Metric, Metric range
3. A priority: Critical (core metric definitions, must-know rules), High (important context), or Good to have (nice-to-know info)

Return a JSON object with an "entries" array. Every entry has these exact fields:
- "content": string (the knowledge statement)
- "category": string (one of the categories above)
- "priority": string (Critical, High, or Good to have)
- "sourceUrl": string (copy the SOURCE URL associated with the fact, or use an empty string)

Only return the JSON object, nothing else.`;
