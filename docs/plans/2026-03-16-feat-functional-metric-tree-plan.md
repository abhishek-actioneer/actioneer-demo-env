---
title: "feat: Functional Metric Tree"
type: feat
status: active
date: 2026-03-16
origin: docs/brainstorms/2026-03-16-metric-tree-functional-brainstorm.md
---

# feat: Functional Metric Tree

## Overview

The metric tree is currently non-functional — hardcoded ecommerce metrics with fake values and hand-crafted relationships that break for every other dataset. This plan makes the tree work for any dataset by:

1. Adding a dedicated LLM relationship inference pass (separate from metric generation)
2. Making categories dynamic (LLM-assigned, not hardcoded)
3. Removing `PRESEEDED_METRICS` entirely — one code path for all datasets
4. Adding lazy backfill so existing datasets get relationships without manual regeneration

## Problem Statement

- **5 datasets** have `metrics.json` with **zero relationships** → tree renders as a flat grid of orphan nodes
- **Ecommerce** falls back to `PRESEEDED_METRICS` — fake values, fake time series, no real SQL
- **Categories** hardcoded to 4 ecommerce strings (`Acquisition`, `Engagement`, `Revenue`, `Monetization`) — meaningless for other domains
- **No empty state** — datasets without `metrics.json` show a blank canvas

## Proposed Solution

**Two-pass architecture:** metric generation (existing) produces SQL definitions → relationship inference (new) takes those definitions and produces the causal graph + dynamic categories. Both results persist in `metrics.json`.

**Dual trigger:** inference runs as second pass after `POST /api/metrics/generate` AND lazy-backfills via `GET /api/metrics` when relationships are missing.

(see brainstorm: `docs/brainstorms/2026-03-16-metric-tree-functional-brainstorm.md`)

## Implementation Phases

### Phase 1: Type System + Category Cleanup

**Goal:** Make the type system flexible enough for dynamic categories before changing any runtime behavior.

#### 1.1 Make `MetricCategory` dynamic

**File: `src/lib/metric-types.ts`**
- Change `MetricCategory` from `type MetricCategory = "Acquisition" | "Engagement" | "Revenue" | "Monetization"` → `type MetricCategory = string`
- Remove `METRIC_CATEGORIES` constant (line 107-109)
- Remove `CATEGORY_COLORS` map (line 146-151) — violates monochrome UI convention anyway
- Remove `METRIC_TYPE_COLORS` (also colored, pre-existing violation)
- Keep `MetricType` union (`"kpi" | "indicator" | "diagnostic" | "index"`) — these are structural, not domain-specific

#### 1.2 Update toolbar to derive categories from data

**File: `src/components/metric-tree/metric-tree-toolbar.tsx`**
- Remove `METRIC_CATEGORIES` import
- Accept `categories: string[]` as a prop (computed by parent from `allMetrics`)
- Render `["All", ...categories]` as filter pills
- Use monochrome styling for all category pills (no color map)

#### 1.3 Update metric tree page to compute categories

**File: `src/app/metric-tree/page.tsx`**
- Derive unique categories from fetched metrics: `[...new Set(allMetrics.map(m => m.category))]`
- Pass to toolbar as prop
- Reset `activeCategory` to `"All"` on dataset switch (add `useEffect` keyed on `datasetId`)
- Also reset `searchQuery` and `selectedMetricId` on dataset switch

#### 1.4 Fix `computeMetric` category cast

**File: `src/app/api/metrics/route.ts`**
- Line 83: change `category: def.category as Metric["category"]` → `category: def.category` (safe now that `MetricCategory = string`)

#### 1.5 Update metric edit/create modals

**Files: `src/components/metric/create-metric-modal.tsx`, `metric-edit-modal.tsx`**
- Category dropdown: if dynamic categories exist (from props), use those. Otherwise allow freeform text input
- Remove `TABLE_COLUMNS` hardcoded ecommerce tables from `metric-types.ts` — either derive from schema or remove the column picker entirely (freeform SQL input is sufficient)

---

### Phase 2: Relationship Inference

**Goal:** New LLM function that takes existing metrics and produces the relationship graph + categories.

#### 2.1 Create relationship inference prompt

**New file: `src/lib/prompts/metric-relationships.ts`**

```typescript
export function buildRelationshipInferencePrompt(
  metrics: { id: string; name: string; description: string; formula: string; sql: string }[],
  datasetLabel: string
): string
```

Prompt structure:
- **User message** (not system — per institutional learning, LLMs weight user message content 2-3x more): full metric list with id, name, description, formula, SQL
- Ask LLM to produce for each metric: `{ metricId, relationships: [{metricId, metricName, direction, type}], category }`
- Constraint: max 3 outgoing `"drives"` per metric, only `"drives"` direction (layout infers `driven_by`)
- Constraint: only `"component"` type for tree edges, `"influence"` for soft links
- Constraint: `metricId` references must exist in the input list
- Include `datasetLabel` for domain-appropriate category naming
- Ask for 3-6 categories total (keeps the filter bar manageable)

#### 2.2 Create inference function

**File: `src/lib/datasets/metric-generator.ts`** (extend existing, not new file)

```typescript
export async function inferMetricRelationships(
  metrics: MetricDefinition[],
  datasetLabel: string
): Promise<MetricDefinition[]>
```

- Build compact metric summary (id, name, description, formula — exclude full SQL to save tokens unless < 30 metrics)
- Single `ai.models.generateContent()` call with `responseMimeType: "application/json"`
- Wrap with `withTimeout(20_000)` (same pattern as board-generate)
- Parse response, validate:
  - Strip relationships referencing non-existent metric IDs
  - Normalize direction to `"drives"` only
  - Normalize type to `"component"` or `"influence"`
  - Assign categories back to each `MetricDefinition`
- Return enriched `MetricDefinition[]` with relationships + categories populated
- On failure (timeout, bad JSON): return original metrics unchanged (graceful degradation)
- Skip inference if `metrics.length < 3` (not enough data for meaningful relationships)

#### 2.3 Add second pass to generate route

**File: `src/app/api/metrics/generate/route.ts`**

After `generateMetricDefinitions()` returns (line ~27), before writing to disk:

```typescript
const enriched = await inferMetricRelationships(metrics, ds.label);
writeFileSync(metricsPath, JSON.stringify(enriched, null, 2));
```

This means every new generation automatically produces relationships.

---

### Phase 3: Lazy Backfill

**Goal:** Existing datasets with `metrics.json` but no relationships get them without manual regeneration.

#### 3.1 Add `needsRelationships` flag to GET response

**File: `src/app/api/metrics/route.ts`**

After loading definitions, check if relationships are missing:

```typescript
const needsRelationships = definitions && definitions.length >= 3 &&
  definitions.every(d => !d.relationships || d.relationships.length === 0);
```

Include `needsRelationships: true` in the JSON response alongside `metrics`.

#### 3.2 New API endpoint for relationship inference

**New file: `src/app/api/metrics/infer-relationships/route.ts`**

`POST /api/metrics/infer-relationships`
- Reads `datasetId` from body
- Loads `metrics.json` from disk
- Calls `inferMetricRelationships(definitions, ds.label)`
- Writes enriched result back to `metrics.json`
- Invalidates `__metrics_cache__`
- Concurrent protection: module-level `Set<string>` of in-flight datasetIds — if already in-flight, return `{ status: "already_running" }` immediately
- Returns `{ success: true, count: number }`

#### 3.3 Client-side backfill trigger

**File: `src/app/metric-tree/page.tsx`**

In `fetchMetrics`:
- Check response for `needsRelationships: true`
- If true, show a subtle banner: "Analyzing metric relationships..."
- Fire `POST /api/metrics/infer-relationships` (fire-and-forget with `.then()`)
- On completion, re-fetch metrics → tree re-renders with edges
- On failure, dismiss banner, show error toast, tree stays flat (graceful degradation)

---

### Phase 4: Remove PRESEEDED_METRICS

**Goal:** One code path for all datasets. Ecommerce works like every other dataset.

#### 4.1 Generate ecommerce `metrics.json`

**One-time migration:** Run the generate pipeline for ecommerce and commit the result.

```bash
curl -X POST http://localhost:3000/api/metrics/generate \
  -H "Content-Type: application/json" \
  -d '{"datasetId": "ecommerce"}'
```

This produces `data/datasets/ecommerce/metrics.json` with real SQL + LLM-inferred relationships. Commit to repo.

#### 4.2 Remove all PRESEEDED_METRICS references

| File | Change |
|------|--------|
| `src/lib/metric-data.ts` | **Delete entire file** |
| `src/lib/metric-store.ts` (line 2, 15-16) | Remove import and seeding logic |
| `src/app/api/metrics/route.ts` (line 6, 135-137) | Remove import and ecommerce fallback |
| `src/app/api/board-generate/route.ts` (line 5, 168-187) | Remove import and ecommerce fallback → use `loadMetricDefinitions(datasetId)` instead |
| `src/lib/metric-store-server.ts` (line 4, 27-29) | Remove import and fallback |

#### 4.3 Add empty state to metric tree page

**File: `src/app/metric-tree/page.tsx`**

When `allMetrics.length === 0 && !loading`:
- Centered empty state following existing pattern: icon (`GitFork`, muted, `size-10`) → heading "No metrics yet" → subtext "Generate metrics from your dataset schema" → CTA button "Generate Metrics" (calls `handleRegenerate`)
- Consume `hasDefinitions` from API response to differentiate messaging:
  - `hasDefinitions: false` → "Generate Metrics" (no metrics.json exists)
  - `hasDefinitions: true` but 0 metrics → "Your metrics file is empty. Try regenerating."

---

## Acceptance Criteria

### Functional Requirements

- [ ] Visiting `/metric-tree` for any dataset with `metrics.json` shows a connected tree (not flat orphan grid)
- [ ] Relationship inference produces meaningful causal graph (root metric → children → leaves)
- [ ] Categories are domain-appropriate (e.g., "Operations", "Quality" for support datasets)
- [ ] Toolbar category filter shows actual categories from the data, not hardcoded ecommerce ones
- [ ] "Regenerate" button produces metrics WITH relationships in one flow
- [ ] Existing datasets with `metrics.json` but no relationships get backfilled on first tree visit
- [ ] Ecommerce dataset works identically to all other datasets (no special fallback)
- [ ] Empty state shown when no `metrics.json` exists, with "Generate" CTA
- [ ] Dataset switch resets category filter, search query, and selected metric
- [ ] Concurrent backfill requests for the same dataset are deduplicated

### Non-Functional Requirements

- [ ] Relationship inference completes within 20s (timeout)
- [ ] Inference failure degrades gracefully to flat layout (no crash)
- [ ] No colored category badges (monochrome UI convention)

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| LLM produces poor/no relationships | Graceful degradation to flat layout. User can retry via "Regenerate" |
| LLM assigns inconsistent categories across regenerations | Accept this — no stability guarantee, but categories are always valid |
| Ecommerce metrics.json generation produces different metrics than PRESEEDED | Expected and desired — real SQL-computed values replace mock data |
| Relationship inference prompt too large (50+ metrics) | Send compact summaries (id, name, description, formula) not full SQL |
| Backfill write races with concurrent requests | Module-level `Set<string>` prevents duplicate in-flight inference per dataset |

## Key Files

| Purpose | File |
|---------|------|
| Types (category change) | `src/lib/metric-types.ts` |
| Relationship prompt | `src/lib/prompts/metric-relationships.ts` (new) |
| Inference function | `src/lib/datasets/metric-generator.ts` (extend) |
| Backfill API route | `src/app/api/metrics/infer-relationships/route.ts` (new) |
| Generate route (2nd pass) | `src/app/api/metrics/generate/route.ts` |
| GET route (flag) | `src/app/api/metrics/route.ts` |
| Tree page (backfill + empty state) | `src/app/metric-tree/page.tsx` |
| Toolbar (dynamic categories) | `src/components/metric-tree/metric-tree-toolbar.tsx` |
| Delete | `src/lib/metric-data.ts` |
| Clean up | `src/lib/metric-store.ts`, `metric-store-server.ts`, `board-generate/route.ts` |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-16-metric-tree-functional-brainstorm.md](docs/brainstorms/2026-03-16-metric-tree-functional-brainstorm.md) — key decisions: kill preseeded data, separate LLM inference for relationships, dynamic categories, dual trigger
- **Institutional learning:** LLM prompt context — pass full metric context in user message, not system prompt ([docs/solutions/logic-errors/deck-review-date-year-llm-prompt-ambiguity.md](docs/solutions/logic-errors/deck-review-date-year-llm-prompt-ambiguity.md))
- **Pattern reference:** Board generation LLM call with `withTimeout()` at `src/app/api/board-generate/route.ts`
- **Pattern reference:** Metric generator validation at `src/lib/datasets/metric-generator.ts`
