---
title: "Deck Processing: Wrong SQL Context Function Causes Hallucinated Table Names"
date: 2026-03-11
problem_type: logic_error
component: PDF Deck Upload Pipeline
symptoms:
  - "All slides return chartSpec: null after PDF upload"
  - "Server logs: 'Catalog Error: Table with name purchases does not exist!'"
  - "Server logs: 'IO Error: No files found that match the pattern events.parquet'"
  - "Server logs: 'Catalog Error: Table with name orders does not exist!'"
  - "SQL retry also fails with different hallucinated table name"
root_cause: "processSlide() called getSystemContext() (LLM persona prompt) instead of buildTextToSqlPrompt() (DuckDB schema + SQL rules) for SQL generation"
tags:
  - sql-generation
  - deck-processing
  - gemini
  - schema-context
  - living-deck
related_files:
  - src/app/api/decks/process/route.ts
  - src/app/api/decks/[id]/reanalyze/route.ts
  - src/lib/schema.ts
  - src/lib/prompts/sql.ts
---

# Deck Processing: Wrong SQL Context Function Causes Hallucinated Table Names

## Symptoms

After uploading a PDF deck, all slides have `chartSpec: null`. Server logs during processing show SQL errors like:

```
[deck-process] SQL error for slide "Daily Revenue": IO Error: No files found that match the pattern "events.parquet"
[deck-process] SQL error for slide "Revenue by Category": Catalog Error: Table with name purchases does not exist!
[deck-process] SQL error for slide "Top Brands": Catalog Error: Table with name products does not exist!
[deck-process] Retry also failed for slide "Revenue by Category": Binder Error: Referenced column "category" not found
```

Gemini is generating SQL with made-up table names (`purchases`, `orders`, `user_behavior`, `events.parquet`) that don't exist in the DuckDB database.

## Root Cause

The codebase has three context-building functions in `src/lib/schema.ts` and `src/lib/prompts/sql.ts` with similar-sounding names that do very different things:

| Function | Returns | Use for |
|---|---|---|
| `getSystemContext(datasetId)` | LLM persona prompt ("You are Sentinel...") | Chat responses, analysis synthesis |
| `getSchemaContext(datasetId)` | Raw table schema (columns, types) | Internal — used by `buildTextToSqlPrompt` |
| `buildTextToSqlPrompt(datasetId)` | Schema + DuckDB SQL rules combined | **SQL generation** |

The deck processing route called `getSystemContext()` and passed it as the SQL generation context:

```typescript
// WRONG — getSystemContext returns the LLM persona prompt, not the schema
const systemContext = getSystemContext(datasetId || DEFAULT_DATASET);
const slide = await processSlide(extracted, systemContext, ai, modelId, datasetId);
```

When Gemini received the persona prompt ("You are Sentinel, an AI analytics assistant...") instead of the schema, it had no knowledge of actual table names. It hallucinated plausible-sounding table names from the slide titles.

## Fix

Replace `getSystemContext()` with `buildTextToSqlPrompt()` inside `processSlide()`:

```typescript
// src/app/api/decks/process/route.ts

// BEFORE (wrong):
import { getSystemContext } from "@/lib/schema";
// ...
const systemContext = getSystemContext(datasetId || DEFAULT_DATASET);
const slide = await processSlide(extracted, systemContext, ai, modelId, datasetId);

// AFTER (correct):
import { buildTextToSqlPrompt } from "@/lib/prompts/sql";
// ...
// Remove systemContext — buildTextToSqlPrompt is called inside processSlide

async function processSlide(
  extracted: z.infer<typeof ExtractedSlideSchema>,
  datasetId: string,
  ai: GoogleGenAI,
  modelId: string,
): Promise<Omit<Slide, "commentaryThreadId" | "chatThreadId">> {
  const sqlPrompt = buildTextToSqlPrompt(datasetId);  // ← correct
  sql = await generateSQL(sqlPrompt, metricContext, extracted, ai, modelId);
}
```

Also apply same fix in `src/app/api/decks/[id]/reanalyze/route.ts`.

## Key Distinction

```
getSystemContext()  →  "You are Sentinel, an AI analytics assistant for eCommerce..."
                       ↳ No table names. Gemini makes up tables.

buildTextToSqlPrompt()  →  "TABLE: events (event_time TIMESTAMP, event_type VARCHAR...)
                             PRE-MATERIALIZED: daily_metrics, brand_metrics...
                             RULES: Output ONLY valid DuckDB SQL. LIMIT 500."
                            ↳ Gemini knows the schema. SQL is correct.
```

## Prevention

**When writing any new route that generates SQL**, import from `src/lib/prompts/sql.ts`, not from `src/lib/schema.ts`:

```typescript
// ✅ Correct for SQL generation
import { buildTextToSqlPrompt, buildSegmentSqlPrompt } from "@/lib/prompts/sql";

// ❌ Wrong for SQL generation (this is for chat/analysis response synthesis)
import { getSystemContext } from "@/lib/schema";
```

**Rule of thumb:**
- `getSystemContext()` → used in `/api/chat`, `/api/analyze` response synthesis, commentary generation
- `buildTextToSqlPrompt()` → used anywhere you call Gemini to generate a SQL query

**Code review signal:** If you see `getSystemContext` imported in an API route that also calls `executeSQL`, that's a red flag — the route is likely using the wrong context for SQL generation.

## Related

- `src/lib/sql-generator.ts` — The main text-to-SQL module; always uses `buildTextToSqlPrompt` internally
- `src/app/api/analyze/route.ts` — Correct usage reference: uses `buildTextToSqlPrompt` for SQL gen, `getSystemContext` for response synthesis
- `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md` — Similar issue: SQL generation path must preserve schema context exactly
