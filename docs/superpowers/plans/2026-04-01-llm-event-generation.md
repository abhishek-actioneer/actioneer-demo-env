# LLM-Powered Event Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mechanical `event-generator.ts` with an LLM-powered generator that produces clear, PM-readable event names and composite events from any uploaded dataset.

**Architecture:** Add a new prompt builder (`buildEventGenerationPrompt`) that sends the SchemaMap + annotatedSchemaContext to Gemini and asks it to return `EventDefinition[]` in the exact shape the Explorer/Funnel/Retention APIs already consume. The LLM call replaces the call to `generateEventsFromSchema()` in `schema-enricher.ts` Step 4. The mechanical generator is kept as a fallback if the LLM call fails.

**Tech Stack:** Gemini API (existing `ai` + `GEMINI_MODEL` from `src/lib/gemini.ts`), existing `EventDefinition` / `EventProperty` types from `src/lib/explorer-types.ts`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/prompts/event-generation.ts` | **Create** | Prompt builder for LLM event generation |
| `src/lib/datasets/event-generator.ts` | **Modify** | Add `generateEventsWithLLM()`, keep old function as `generateEventsMechanical()` fallback |
| `src/lib/datasets/schema-enricher.ts` | **Modify** | Step 4 calls new LLM generator with mechanical fallback |

3 files total. No new dependencies. No type changes needed — output is already `EventDefinition[]`.

---

### Task 1: Build the event generation prompt

**Files:**
- Create: `src/lib/prompts/event-generation.ts`

This prompt is the heart of the change. It teaches the LLM to produce events that a PM would recognize.

- [ ] **Step 1: Create the prompt builder**

```typescript
// src/lib/prompts/event-generation.ts

import type { SchemaMap } from "@/lib/datasets/types";

/**
 * Build the prompt that asks Gemini to generate EventDefinition[] for a dataset.
 * Receives the full SchemaMap (column metadata, domain, annotated schema).
 */
export function buildEventGenerationPrompt(
  schemaMap: SchemaMap,
  label: string,
  dateField?: string,
): string {
  // Build column summary with semantic types and sample values
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
  "dateColumn": "date column if different from ${dateField || 'primary date field'} or null",
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

Respond with ONLY the JSON array. No markdown, no explanation.`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/prompts/event-generation.ts
git commit -m "feat: add LLM event generation prompt builder"
```

---

### Task 2: Add LLM generator function to event-generator.ts

**Files:**
- Modify: `src/lib/datasets/event-generator.ts`

Add `generateEventsWithLLM()` alongside the existing mechanical function. The mechanical function stays as fallback.

- [ ] **Step 1: Rename the existing export and add the LLM generator**

At the top of `src/lib/datasets/event-generator.ts`, add imports and the new function. Keep all existing code but rename the export:

```typescript
// Add these imports at the top of the file, after existing imports:
import { ai, GEMINI_MODEL, withTimeout } from "../gemini";
import { buildEventGenerationPrompt } from "@/lib/prompts/event-generation";
```

Rename the existing `generateEventsFromSchema` to `generateEventsMechanical`:

```typescript
// Old:
export function generateEventsFromSchema(
// New:
export function generateEventsMechanical(
```

Then add the new LLM-powered function at the end of the file, before the helpers section:

```typescript
/**
 * LLM-powered event generation. Sends SchemaMap to Gemini and gets back
 * EventDefinition[] with PM-readable names, composite events, and proper categories.
 *
 * Falls back to mechanical generation on LLM failure.
 */
export async function generateEventsWithLLM(
  schemaMap: SchemaMap,
  label: string,
  datasetDateField?: string,
): Promise<EventDefinition[]> {
  const prompt = buildEventGenerationPrompt(schemaMap, label, datasetDateField);

  let events: EventDefinition[];
  try {
    console.log(`[event-generator] calling LLM for event generation (${label})`);
    const result = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      }),
      45_000,
      "Event generation",
    );

    const text = (result.text || "").trim();
    const parsed = JSON.parse(text);
    events = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`[event-generator] LLM event generation failed, falling back to mechanical:`, err);
    return generateEventsMechanical(schemaMap, datasetDateField);
  }

  // Validate and sanitize each event
  const validated = events
    .filter((e) => e.id && e.displayName && e.table && Array.isArray(e.properties))
    .map((e) => ({
      id: String(e.id),
      displayName: String(e.displayName),
      ...(e.category ? { category: String(e.category) } : {}),
      table: String(e.table),
      ...(e.filterColumn ? { filterColumn: String(e.filterColumn) } : {}),
      ...(e.filterValue ? { filterValue: String(e.filterValue) } : {}),
      ...(e.filterSQL ? { filterSQL: String(e.filterSQL) } : {}),
      ...(e.countColumn ? { countColumn: String(e.countColumn) } : {}),
      ...(e.valueColumn ? { valueColumn: String(e.valueColumn) } : {}),
      ...(e.dateColumn ? { dateColumn: String(e.dateColumn) } : {}),
      properties: e.properties
        .filter((p: EventProperty) => p.column && p.displayName && p.type)
        .map((p: EventProperty) => ({
          column: String(p.column),
          displayName: String(p.displayName),
          type: (["string", "number", "date"].includes(p.type) ? p.type : "string") as EventProperty["type"],
          ...(p.cardinalityHint ? { cardinalityHint: p.cardinalityHint } : {}),
        })),
    }));

  if (validated.length === 0) {
    console.warn(`[event-generator] LLM returned 0 valid events, falling back to mechanical`);
    return generateEventsMechanical(schemaMap, datasetDateField);
  }

  console.log(`[event-generator] LLM generated ${validated.length} events for "${label}"`);
  return validated;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/vimarsh/Documents/baby-sentinel && npx tsc --noEmit src/lib/datasets/event-generator.ts 2>&1 | head -20`

If there are import issues with `EventProperty` type, add it to the existing import at the top:
```typescript
import type { EventDefinition, EventProperty } from "../explorer-types";
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/datasets/event-generator.ts
git commit -m "feat: add LLM-powered generateEventsWithLLM with mechanical fallback"
```

---

### Task 3: Wire LLM generator into the enrichment pipeline

**Files:**
- Modify: `src/lib/datasets/schema-enricher.ts`

Change Step 4 from calling `generateEventsFromSchema` (mechanical) to calling `generateEventsWithLLM` (LLM-powered with mechanical fallback).

- [ ] **Step 1: Update the import**

In `src/lib/datasets/schema-enricher.ts`, change:

```typescript
// Old:
import { generateEventsFromSchema } from "./event-generator";
// New:
import { generateEventsWithLLM } from "./event-generator";
```

- [ ] **Step 2: Update Step 4 to call the LLM generator**

Replace the Step 4 block (lines ~229-242) in `enrichDataset()`:

```typescript
  // Step 4: Generate events via LLM (falls back to mechanical internally)
  console.log(`[schema-enricher] step 4: generating events via LLM`);
  try {
    // Find the date field from profiled tables
    const primaryDateField = tables[0]?.tableName
      ? findDateFieldFromProfiles(profiles)
      : undefined;

    const events = await generateEventsWithLLM(schemaMap, label, primaryDateField);
    if (events.length > 0) {
      const eventsPath = join(datasetDir, "events.json");
      writeFileSync(eventsPath, JSON.stringify(events, null, 2));
      console.log(`[schema-enricher] saved ${events.length} LLM-generated events to ${eventsPath}`);
    } else {
      console.warn(`[schema-enricher] no events generated for "${label}"`);
    }
  } catch (err) {
    console.error(`[schema-enricher] event generation failed (non-fatal):`, err);
  }
```

- [ ] **Step 3: Add the helper to extract dateField from profiles**

Add this helper function somewhere above `enrichDataset()` in `schema-enricher.ts`:

```typescript
/** Extract the most likely date field from profiled columns */
function findDateFieldFromProfiles(profiles: TableProfile[]): string | undefined {
  const datePatterns = /^(date|time|timestamp|created_?at|updated_?at|event_?at|event_?date|occurred_?at|session_?date|booking_?date)$/i;
  for (const table of profiles) {
    for (const col of table.columns) {
      if (datePatterns.test(col.name)) return col.name;
      if (col.type.toLowerCase().includes("date") || col.type.toLowerCase().includes("timestamp")) return col.name;
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/vimarsh/Documents/baby-sentinel && pnpm build 2>&1 | tail -20`

Expected: Build succeeds. If there are type errors, fix them.

- [ ] **Step 5: Commit**

```bash
git add src/lib/datasets/schema-enricher.ts
git commit -m "feat: wire LLM event generation into enrichment pipeline (Step 4)"
```

---

### Task 4: Handle filterSQL in explorer SQL compilation

**Files:**
- Modify: `src/lib/explorer-sql.ts` (if `filterSQL` isn't already handled)
- Modify: `src/lib/funnel-sql.ts` (if `filterSQL` isn't already handled)
- Modify: `src/lib/retention-sql.ts` (if `filterSQL` isn't already handled)

The LLM will generate composite events using `filterSQL` (e.g., `searched = 'true' AND booked = 'false'`). The Explorer APIs need to apply this as a WHERE clause predicate. Check if `filterSQL` is already supported — if not, add it.

- [ ] **Step 1: Check if filterSQL is already handled**

Search for `filterSQL` in these three files:
- `src/lib/explorer-sql.ts`
- `src/lib/funnel-sql.ts`
- `src/lib/retention-sql.ts`

If `filterSQL` is already handled (it's defined in the `EventDefinition` type), skip to Step 4.

- [ ] **Step 2: Add filterSQL support to explorer-sql.ts**

Find the WHERE clause construction where `filterColumn` / `filterValue` are applied. Add `filterSQL` as an additional predicate. The pattern is:

```typescript
// Wherever you see this pattern:
if (eventDef.filterColumn && eventDef.filterValue) {
  conditions.push(`"${eventDef.filterColumn}" = '${eventDef.filterValue}'`);
}

// Add immediately after:
if (eventDef.filterSQL) {
  conditions.push(`(${eventDef.filterSQL})`);
}
```

Apply this to all three SQL builder files wherever event filters are constructed.

- [ ] **Step 3: Verify build**

Run: `cd /Users/vimarsh/Documents/baby-sentinel && pnpm build 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add src/lib/explorer-sql.ts src/lib/funnel-sql.ts src/lib/retention-sql.ts
git commit -m "feat: support filterSQL predicate in explorer/funnel/retention SQL builders"
```

---

### Task 5: Manual smoke test with existing dataset

No code changes — verify the system works end-to-end.

- [ ] **Step 1: Re-generate events for the daily-sessions dataset**

Write a quick script or use the existing enrichment pipeline to re-run event generation for the `user3b-daily-sessions` dataset. The simplest way:

```bash
cd /Users/vimarsh/Documents/baby-sentinel
npx tsx -e "
const { loadSchemaMap } = require('./src/lib/datasets/schema-enricher');
const { generateEventsWithLLM } = require('./src/lib/datasets/event-generator');
const fs = require('fs');

async function main() {
  const dir = 'data/datasets/user3b-daily-sessions';
  const schemaMap = JSON.parse(fs.readFileSync(dir + '/schema-map.json', 'utf-8'));
  const events = await generateEventsWithLLM(schemaMap, 'Daily Sessions', 'session_date');
  console.log(JSON.stringify(events, null, 2));
  console.log('Total events:', events.length);
}
main().catch(console.error);
"
```

- [ ] **Step 2: Verify event quality**

Check the output:
1. No event should be named "True" or "False"
2. Events should have clear action-oriented names: "Search Performed", "Booking Completed", etc.
3. Composite events should exist: "Search Without Booking", "Offer-Driven Booking", etc.
4. Categories should be business-meaningful: "Engagement", "Conversion", etc.
5. Properties should be breakdownable dimensions (platform, etc.) — not metrics listed as string properties

- [ ] **Step 3: Write events to disk if correct**

If the output looks good, save it:

```bash
# The events were already printed. Copy the output to the events.json file.
# Or re-run the script with a write:
npx tsx -e "
const { loadSchemaMap } = require('./src/lib/datasets/schema-enricher');
const { generateEventsWithLLM } = require('./src/lib/datasets/event-generator');
const fs = require('fs');

async function main() {
  const dir = 'data/datasets/user3b-daily-sessions';
  const schemaMap = JSON.parse(fs.readFileSync(dir + '/schema-map.json', 'utf-8'));
  const events = await generateEventsWithLLM(schemaMap, 'Daily Sessions', 'session_date');
  fs.writeFileSync(dir + '/events.json', JSON.stringify(events, null, 2));
  console.log('Saved', events.length, 'events');
}
main().catch(console.error);
"
```

- [ ] **Step 4: Test in Explorer UI**

Run: `pnpm dev`

1. Navigate to `/explore`
2. Switch to the daily-sessions dataset
3. Open the event picker — verify events show with clear names
4. Select "Booking Completed" → run a Trends query → verify chart renders
5. Try a Funnel: "Search Performed" → "Booking Completed" → verify conversion rates
6. Try Retention: start event = "Session Started", return event = "Booking Completed"

---

## Summary

| Task | What | Files | LLM calls |
|------|------|-------|-----------|
| 1 | Prompt builder | `prompts/event-generation.ts` (create) | 0 |
| 2 | LLM generator function | `event-generator.ts` (modify) | 0 |
| 3 | Wire into enrichment | `schema-enricher.ts` (modify) | 0 |
| 4 | filterSQL support | `explorer-sql.ts`, `funnel-sql.ts`, `retention-sql.ts` (modify if needed) | 0 |
| 5 | Smoke test | None | 1 (manual test) |

**Total new LLM calls per dataset upload:** 1 (event generation, ~45s timeout). Previously 0 for events. This is added alongside the existing 3 LLM calls (column analysis, prompt generation, metric generation) — total becomes 4.

**Fallback chain:** LLM fails → mechanical generator → empty events (existing behavior). No regression possible.
