---
title: "feat: Generate Metric Tree & Generate Starter Segments"
type: feat
date: 2026-03-15
brainstorm: docs/brainstorms/2026-03-15-generate-metric-tree-segments-brainstorm.md
---

# feat: Generate Metric Tree & Generate Starter Segments

## Overview

Two new dataset-onboarding generation flows that mirror the existing "Generate Metrics" button:

1. **Generate Metrics & Tree** — Extends the existing metrics generation to produce `MetricRelationship[]` alongside metric definitions in a single Gemini call, so the metric tree canvas renders meaningfully for any dataset from day one.
2. **Generate Starter Segments** — Bulk-generates 8–12 starter segments (power users, churned, high-value, etc.) as validated SQL and auto-saves them to `sentinel_segments`.

Both flows are triggered from empty states on `/metrics` and `/segments` respectively.

---

## Problem Statement / Motivation

- The metric tree at `/metric-tree` only renders meaningful structure for the preseeded ecommerce dataset. Auto-generated metrics always get `relationships: []`, so the tree is a dead page for any new dataset.
- Segments can be created one at a time via chat, but there is no bulk-onboarding flow. New datasets start with an empty segment list and users must discover segments through conversation.
- Both gaps make the product feel unfinished for any dataset beyond ecommerce.

---

## Proposed Solution

### Part 1: Metrics + Tree (single LLM call)

Extend `buildMetricGenerationPrompt` in `src/lib/prompts/metrics.ts` to include a `relationships` field in the JSON schema it asks for. Each metric definition will include a sparse `relationships[]` array declaring causal/compositional edges. The post-generation validator in `metric-generator.ts` will strip any relationship that references a non-existent metric ID.

No new API route needed — `POST /api/metrics/generate` writes the same `metrics.json` file, just with richer content.

### Part 2: Starter Segments

New prompt builder `buildSegmentGenerationPrompt` in `src/lib/prompts/segments.ts`. New API route `POST /api/segments/generate-all` that calls Gemini, validates each SQL against DuckDB, and bulk-inserts into `sentinel_segments`. New empty-state UI on `/segments` page.

---

## Technical Approach

### Architecture

```
/metrics empty state
  └─ "Generate Metrics & Tree" button
       └─ POST /api/metrics/generate  (unchanged route)
            └─ buildMetricGenerationPrompt()   ← EXTENDED: includes relationships in JSON schema
                 └─ generateMetricDefinitions()  ← EXTENDED: validate + strip bad relationship refs
                      └─ writes data/datasets/<id>/metrics.json  (MetricDefinition[] with relationships[])
                           └─ metric tree renders on /metric-tree (no changes needed)

/segments empty state  (new)
  └─ "Generate Starter Segments" button
       └─ POST /api/segments/generate-all  (NEW route)
            └─ buildSegmentGenerationPrompt()  (NEW prompt in src/lib/prompts/segments.ts)
                 └─ Gemini JSON mode → { name, description, sql }[]
                      └─ for each: execute SQL → count rows → INSERT into sentinel_segments
                           └─ return { generated: N, failed: M }
                                └─ client refreshes GET /api/segments
```

### Key Constraints

- **MetricRelationship shape** (already defined in `src/lib/metric-types.ts`):
  ```typescript
  { metricId: string; metricName: string; direction: "drives" | "driven_by"; type: "component" | "influence" }
  ```
- **Relationships must be sparse** — max 3 outgoing `drives` per metric, causal/compositional only
- **Symmetric pairs required** — if A drives B, the LLM must emit both: A's array has `{ metricId: B, direction: "drives" }` and B's array has `{ metricId: A, direction: "driven_by" }`
- **Segment SQL rules** (from `buildSegmentSqlPrompt`): `SELECT DISTINCT <userIdField>`, query primary table only, LIMIT 500, handle NULLs
- **DuckDB singleton** — use existing `executeSQLInternal` from `src/lib/sql-executor.ts`, never open new connections
- **SQL context functions** — use `buildTextToSqlPrompt(datasetId)` for SQL generation, never `getSystemContext()` (see learnings doc on this exact bug)

---

## Implementation Phases

### Phase 1: Extend Metrics Prompt + Generator

**Files changed:**

#### `src/lib/prompts/metrics.ts`
- Add `relationships` to the JSON schema block in `buildMetricGenerationPrompt`:
  ```
  "relationships": [
    { "metricId": "string", "metricName": "string", "direction": "drives|driven_by", "type": "component|influence" }
  ]
  ```
- Add instructions after the metric list instruction:
  > "After defining all metrics, populate each metric's `relationships` array. Emit at most 3 outgoing `drives` per metric. For every A→B `drives` pair, also emit the mirror B→A `driven_by`. Focus on causal chains (revenue ← conversion ← activation) and compositional metrics (total ← sum of parts). Do not declare correlational relationships. Only reference `id` values that appear in your output."

#### `src/lib/datasets/metric-generator.ts`
- After filtering valid metrics, build `validIds = new Set(metrics.map(m => m.id))`
- Strip invalid relationship refs: `m.relationships = (m.relationships ?? []).filter(r => validIds.has(r.metricId))`
- Sanitize `direction` to `["drives", "driven_by"]` defaulting to `"drives"`
- Sanitize `type` to `["component", "influence"]` defaulting to `"influence"`

#### `src/app/metrics/page.tsx`
- Change button label from `"Generate Metrics"` to `"Generate Metrics & Tree"` (~line 75 area)
- No logic changes needed

---

### Phase 2: Segment Generation Prompt

**New file: `src/lib/prompts/segments.ts`**

```typescript
import { SchemaMap } from "@/lib/datasets/types";

export function buildSegmentGenerationPrompt(
  schemaMap: SchemaMap,
  userIdField: string,
  label: string,
): string
```

Prompt structure:
1. Schema context block (`schemaMap.annotatedSchemaContext || column summary` — same pattern as metrics prompt)
2. Domain hints block (`schemaMap.domainHints`)
3. User entity description (`userIdField`, `label`)
4. Target: 8–12 segments covering acquisition, activation, retention, monetization, and risk categories
5. JSON schema for each segment:
   ```json
   { "name": "string", "description": "string (1 sentence)", "sql": "string" }
   ```
6. SQL rules:
   - Must `SELECT DISTINCT <userIdField>` as first column
   - Query primary user/entity table only, not summary tables
   - `LIMIT 500`
   - Handle NULLs with COALESCE or WHERE IS NOT NULL
   - DuckDB syntax only
   - Never reference tables not shown in the schema

---

### Phase 3: Generate-All API Route

**New file: `src/app/api/segments/generate-all/route.ts`**

```
POST /api/segments/generate-all
Body: { datasetId?: string }
```

Handler flow:
1. Validate + resolve `datasetId` (same pattern as `/api/metrics/generate`)
2. Load SchemaMap from disk (`data/datasets/<id>/schema-map.json`) or fallback to DatasetConfig fields
3. Call `buildSegmentGenerationPrompt(schemaMap, ds.userIdField ?? "user_id", ds.label)`
4. Gemini call with `responseMimeType: "application/json"` — parse array
5. For each `{ name, description, sql }`:
   - Execute SQL via `executeSQLInternal(datasetId, sql)` — if error, skip + count as failed
   - Count rows in result (capped at 500 by LIMIT) as `userCount`
   - Generate id: `Math.random().toString(36).slice(2, 10)`
   - INSERT into `sentinel_segments` via `executeSQLInternal` with parameterized query
6. Return `{ generated: number, failed: number, total: number }`

Error handling:
- If Gemini fails entirely → 500 with message
- If all segments fail SQL validation → 422 with explanation
- Partial success (some fail) → 200 with `{ generated, failed }` counts

---

### Phase 4: Segments Page Empty State UI

**File changed: `src/app/segments/page.tsx`**

Add state:
```typescript
const [generating, setGenerating] = useState(false);
```

Empty-state condition: `segments.length === 0 && !loading`

Replace the current minimal `<tr>No segments found</tr>` empty state with a proper dashed-border empty state (following the "Empty state" recurring pattern from CLAUDE.md):
```
[icon: Users, muted, size-10]
No segments yet
Describe your users in natural language to create a segment, or generate starter segments for this dataset.
[Generate Starter Segments button]  [New Segment button]
```

`handleGenerateAll()`:
1. `setGenerating(true)`
2. `POST /api/segments/generate-all` with `{ datasetId }` via `apiFetch`
3. On success: call `fetchSegments()` to reload, show inline success count
4. On error: show inline error message
5. `setGenerating(false)` in finally

---

## Acceptance Criteria

### Generate Metrics & Tree

- [x] For a dataset with no `metrics.json`, clicking "Generate Metrics & Tree" on `/metrics` generates metrics with non-empty `relationships` arrays for most metrics
- [x] The `/metric-tree` page renders a connected graph (nodes with edges) after generation for non-ecommerce datasets
- [x] Relationship `metricId` references are valid (no dangling refs in generated output)
- [x] Symmetric pairs exist: if A drives B, B has a `driven_by` A relationship
- [x] Existing behavior for ecommerce preseeded metrics is unchanged
- [x] Button label updated to "Generate Metrics & Tree"
- [x] Re-running generation overwrites the existing `metrics.json` (same behavior as before)

### Generate Starter Segments

- [x] `/segments` page shows an empty state with "Generate Starter Segments" button when no segments exist
- [x] Clicking generates 6–12 segments (partial failures are acceptable) and saves to `sentinel_segments`
- [x] Each saved segment has a valid `userCount` > 0
- [x] SQL validation failures are skipped silently; only valid segments are saved
- [x] A `{ generated: N, failed: M }` response is returned and surfaced in the UI
- [x] After generation, the segment list refreshes automatically
- [x] Button is disabled and shows loading state during generation

### General

- [x] `pnpm lint` passes with no new errors
- [x] Works for the `quickhelp` dataset (non-default, has schema-map.json)
- [x] No raw `fetch()` calls — all API calls use `apiFetch`

---

## Success Metrics

- The `/metric-tree` page renders a meaningful tree for any newly generated dataset (not just ecommerce)
- A new dataset can go from zero to having segments in < 30 seconds via one button click

---

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| Gemini may not generate symmetric relationship pairs consistently | Post-generation pass in `metric-generator.ts` can optionally add mirror pairs programmatically |
| LLM generates segment SQL referencing wrong column names | Same validation path as single-segment creation — execute SQL, skip invalid ones |
| Metric tree may have cycles (A drives B drives A) | `metric-tree-layout.ts:buildTreeLayout` handles this via root detection; DAG structure isn't enforced by the UI |
| `/segments/generate-all` may be slow for large schemas (8-12 DuckDB queries) | Execute DuckDB validations sequentially (not parallel) to respect singleton connection pattern; cap at 12 segments |

---

## Open Questions Resolved

1. **Relationship validation if bad metricId:** Drop silently (matches metric filtering pattern in generator)
2. **Segment SQL failures:** Skip + count as `failed`, continue with valid ones, return partial success
3. **Re-generation:** Allowed — overwrites metrics.json and creates new sentinel_segments rows (duplicates possible; out of scope for now)
4. **Segment source flag:** Not in scope — can add `source: "generated" | "manual"` column to `sentinel_segments` in a follow-up

---

## References & Research

### Internal

- Metrics generation route: `src/app/api/metrics/generate/route.ts`
- Metrics prompt: `src/lib/prompts/metrics.ts`
- Metric generator: `src/lib/datasets/metric-generator.ts`
- MetricDefinition + MetricRelationship types: `src/lib/metric-types.ts`
- Metrics page empty state: `src/app/metrics/page.tsx` (lines ~75–88, ~138)
- Segment creation API: `src/app/api/segments/route.ts`
- Segment SQL prompt: `src/lib/prompts/sql.ts` — `buildSegmentSqlPrompt`
- SchemaMap type: `src/lib/datasets/types.ts`
- Metric tree canvas: `src/app/metric-tree/page.tsx`

### Institutional Learnings

- **SQL context confusion**: Always use `buildTextToSqlPrompt` for SQL generation, never `getSystemContext`. See `docs/solutions/logic-errors/deck-processing-wrong-sql-context-function.md`
- **DuckDB singleton**: Never call `inst.connect()` multiple times. Use existing `executeSQLInternal`. See `docs/solutions/database-issues/duckdb-connection-leak-server-crash-System-20260219.md`
- **Empty state pattern**: Follows recurring UI pattern from CLAUDE.md — icon + heading + sub-text + CTA, `text-muted-foreground`, no color
