# Brainstorm: Generate Metric Tree & Generate Segments Flows

**Date:** 2026-03-15
**Status:** Draft
**Author:** Sashank + Claude

---

## What We're Building

Two new dataset-onboarding generation flows, mirroring the existing "Generate Metrics" button:

1. **Generate Metrics + Tree** — A single LLM generation pass that produces both `MetricDefinition[]` *and* the relationship graph between them (`MetricRelationship[]`), so the metric tree renders meaningfully from the start.
2. **Generate Segments** — LLM analyzes the schema and bulk-generates 8–12 starter segments as validated SQL, auto-saved directly to `sentinel_segments`.

Both flows are triggered from their respective page empty states (`/metrics` and `/segments`), consistent with today's "Generate Metrics" pattern.

---

## Why This Approach

### Metrics + Tree together (single LLM call)

The metric tree already exists as a React Flow canvas at `/metric-tree`, but only renders meaningful structure for preseeded ecommerce data. Auto-generated metrics have `relationships: []`. Rather than a two-step flow (generate metrics, then generate relationships), a single LLM call can produce both: Gemini sees all metric definitions as it constructs them and is better positioned to declare `drives`/`driven_by` relationships in context.

Combining into one call also avoids a synchronization problem (relationships referencing metric IDs that don't exist yet).

### Segments: auto-save all

Segments are SQL queries validated against DuckDB (user count checked). Since each generated segment is validated before saving — and can be deleted from the `/segments` UI — an auto-save flow matches how metrics work and avoids a modal/review step that adds friction. The user can clean up unwanted segments after the fact.

---

## Existing Patterns to Follow

| Concern | Where |
|---|---|
| Schema source | `data/datasets/<id>/schema-map.json` → `SchemaMap` type |
| Prompt builder | `src/lib/prompts/` — one file per concern |
| Metric persistence | `data/datasets/<id>/metrics.json` |
| Segment persistence | `sentinel_segments` DuckDB table |
| Empty-state trigger | `hasDefinitions: false` → dashed empty state + "Generate X" button |
| API cache | `globalThis.__<entity>_cache__` with 5-min TTL |

---

## Key Decisions

### Decision 1: Metrics + Relationships in One Prompt

**Chosen:** Extend `buildMetricGenerationPrompt` (or create a new `buildMetricTreePrompt`) to additionally ask Gemini to output a `relationships` array per metric. Each metric definition gets:

```typescript
relationships: Array<{
  metricId: string;        // references another metric's id
  metricName: string;
  direction: "drives" | "driven_by";
  type: "component" | "influence";
}>
```

The LLM already sees all metric IDs as it generates them, so forward-referencing is possible by describing relationships at the end of the JSON structure.

**Alternative considered:** Two-pass (generate metrics, then a separate relationships call). Rejected — adds latency, requires metric IDs to be stable, more complex orchestration.

### Decision 2: Segment Auto-Save

**Chosen:** `POST /api/segments/generate-all` — generates all segments, runs each SQL against DuckDB to get `userCount`, then bulk-inserts into `sentinel_segments`. No preview step.

UI shows a loading state ("Generating segments...") and then refreshes the segment list on completion.

**Alternative considered:** Preview + selective save modal. Rejected for now — user can delete unwanted segments from the list. Lower friction for onboarding.

### Decision 3: Entry Points

**Chosen:** Page-level empty states only (for now).
- `/metrics` empty state: button changes from "Generate Metrics" → "Generate Metrics & Tree" (or runs the extended flow silently)
- `/segments` empty state: add "Generate Starter Segments" button alongside the existing "New Segment" button

**Not in scope:** Dataset onboarding orchestration (all three together), sidebar action.

### Decision 4: Relationship Density

The LLM should be guided to produce sparse, high-confidence relationships only — not exhaustively connect every metric. Guidance: max 2–3 outgoing `drives` edges per metric, focus on causal chains (revenue ← conversion ← activation).

---

## Proposed Implementation Sketch

### Flow 1: Generate Metrics + Tree

```
User clicks "Generate Metrics & Tree" on /metrics empty state
  → POST /api/metrics/generate  (same route, extended response)
  → buildMetricTreePrompt(schemaMap, label)  [src/lib/prompts/metrics.ts]
     - same 25-40 metric definitions
     - PLUS: each metric includes `relationships` array
     - prompt instructs: "after defining all metrics, declare relationships"
  → validate: each relationship.metricId must exist in the generated set
  → write to data/datasets/<id>/metrics.json  (same file, extended schema)
  → metric tree page auto-renders on next visit
```

### Flow 2: Generate Starter Segments

```
User clicks "Generate Starter Segments" on /segments empty state
  → POST /api/segments/generate-all  { datasetId }
  → buildSegmentGenerationPrompt(schemaMap, label)  [src/lib/prompts/segments.ts]
     - ask for 8-12 named segments: name, description, sql
     - segments should cover: power users, churned, high-value, new, at-risk, etc.
     - inject schema, entity names, date range from SchemaMap
  → for each segment: execute SQL → get userCount
  → bulk INSERT INTO sentinel_segments
  → return { generated: N, failed: M }
  → client refreshes GET /api/segments
```

---

## Prompt Design Notes

### Metrics + Relationships Prompt

Add a section after the metric definitions array:

> "For each metric, add a `relationships` array. Declare at most 3 outgoing `drives` relationships per metric. Only declare relationships you are confident about — causal or compositional, not correlational. Each relationship must reference the `id` of another metric in your output."

### Segments Generation Prompt

Model after `buildMetricGenerationPrompt` but simpler:
- Inject: table names, primary entity (`entityName`), date range, sample column names
- Ask for: `{ name, description, sql }[]`
- SQL rules: SELECT only, returns at least `user_id` (or equivalent PK), no JOINs to nonexistent tables
- Categories to cover: acquisition, activation, retention, monetization, risk

---

## Open Questions

1. **Relationship validation:** If the LLM generates a `metricId` in a relationship that doesn't match any generated metric ID, do we drop it silently or surface a warning?
2. **Segment SQL failures:** If some generated segments fail DuckDB validation (bad column name, etc.), do we skip them and report partial success, or roll back all?
3. **Re-generation:** If metrics already exist, should "Generate Metrics & Tree" be available to re-run? Or only on first onboarding? (Today's flow overwrites `metrics.json` on re-run.)
4. **Segment count:** The `sentinel_segments` table is currently user-created. Seeding 8–12 rows programmatically may surprise users who return to a "clean" dataset. Should generated segments be flagged as `source: "generated"` vs `source: "manual"`?

---

## Out of Scope (for now)

- Dataset onboarding orchestration running all three flows automatically
- Manual relationship editing UI in the metric tree
- Segment template preview/review modal before saving
- Sidebar "Setup Dataset" entry point
