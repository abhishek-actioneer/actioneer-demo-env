/**
 * Prompt builder for LLM-powered event generation.
 * Produces EventDefinition[] with PM-readable names, composite events, and business categories.
 */

import type { SchemaMap } from "@/lib/datasets/types";

export function buildEventGenerationPrompt(
  schemaMap: SchemaMap,
  label: string,
  dateField?: string,
): string {
  let columnSummary = "";
  for (const [colName, meta] of Object.entries(schemaMap.columns)) {
    const samples = meta.sampleValues?.length
      ? ` | Values: ${meta.sampleValues.slice(0, 10).join(", ")}`
      : "";
    const gotcha = meta.sqlGotcha ? ` | Gotcha: ${meta.sqlGotcha}` : "";
    columnSummary += `  - ${colName} [${meta.semanticType}]: ${meta.description}${samples}${gotcha}\n`;
  }

  return `You are a product analytics expert generating an event catalog for a dataset.

DATASET: "${label}"
DOMAIN: ${schemaMap.domain}
DATE FIELD: ${dateField || "(not specified — pick the best timestamp column)"}

ANNOTATED SCHEMA:
${schemaMap.annotatedSchemaContext}

COLUMN DETAILS:
${columnSummary}

TASK: Generate a JSON array of event definitions that a PM or analyst would immediately understand. These events power a click-based analytics explorer (Trends, Funnel, Retention).

OUTPUT FORMAT — JSON array where each element has these fields:
{
  "id": "snake_case_unique_id",
  "displayName": "Clear Human Name",
  "category": "Business Category",
  "table": "table_name",
  "filterColumn": "column_name or null",
  "filterValue": "value or null",
  "filterSQL": "raw SQL predicate or null",
  "countColumn": "column to COUNT or null (defaults to *)",
  "valueColumn": "numeric column for Sum/Average or null",
  "dateColumn": "date column if different from ${dateField || "primary date field"} or null",
  "properties": [
    { "column": "col", "displayName": "Label", "type": "string|number|date", "cardinalityHint": "low|medium|high" }
  ]
}

RULES FOR GOOD EVENT NAMES:
1. Use action-oriented names a PM understands: "Booking Completed", "Search Performed", "Payment Failed" — NOT "True", "False", "Table by Column"
2. Boolean columns represent actions. "searched=true" → "Search Performed". "booked=true" → "Booking Completed". Never name an event "True" or "False".
3. Status/category columns represent variants. "status=cancelled" → "Booking Cancelled". "payment_method=upi" → "UPI Payment".
4. Create composite events when business-meaningful: "Search Without Booking" (searched=true AND booked=false), "Offer-Driven Booking" (viewed_offers=true AND booked=true). Use filterSQL for composites.
5. Every event must have a clear, self-explanatory displayName. If someone reads just the name, they should know what it measures.

RULES FOR EVENT STRUCTURE:
1. Start with 1-2 base events per table (the "all rows" event). Name it after the business action the table represents, not the table name.
2. Add filtered variants for each meaningful dimension value — but only values that represent distinct business actions or outcomes.
3. For boolean flags: ONLY create the "true" variant as a named event. Do NOT create a "false" variant (it's just "not X" — rarely useful as its own event).
4. properties should include low and medium cardinality dimensions useful for breakdown. Exclude identifiers, timestamps, and high-cardinality columns.
5. valueColumn should be the most relevant numeric metric (revenue, duration, score, count).
6. dateColumn only needed if different from the dataset's primary date field.
7. Use filterColumn+filterValue for single-column filters. Use filterSQL for composite conditions (AND/OR).

RULES FOR CATEGORIES:
1. Group events by business function: "Engagement", "Conversion", "Payments", "Onboarding", "Retention", etc.
2. Categories should make sense for this specific domain — not generic labels.
3. A dataset with one table should still have 2-4 categories based on what the events represent.

QUANTITY GUIDELINES:
- Single-table dataset: 8-20 events
- Multi-table dataset: 10-40 events
- More events is fine if each represents a distinct, useful business concept
- Fewer events is fine if the dataset is narrow

Respond with ONLY a single JSON object of the form {"events": [ ...the event definitions... ]}. No markdown, no explanation.`;
}
