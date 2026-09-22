---
title: "feat: Generate Starter Knowledge entries for new datasets"
type: feat
date: 2026-03-16
---

# feat: Generate Starter Knowledge entries for new datasets

## Overview

Add a "Generate Starter Knowledge" button to the Knowledge Base empty state that bulk-generates 15–20 domain-appropriate knowledge entries using Gemini, mirroring the "Generate Metrics & Tree" and "Generate Starter Segments" flows shipped in PR #41.

The knowledge store is **already fully dataset-scoped** (nested `Map<string, Map<string, KnowledgeEntry>>` pattern). The only gap is the generation flow itself: new datasets start with no entries and users must discover what to add through manual effort. The `source: "auto-generated"` value already exists in `KnowledgeSource`.

---

## Problem Statement / Motivation

Non-default datasets (quickhelp, game-demo, etc.) land on the Knowledge Base with zero entries. Users have no scaffolding to understand what kind of context helps the LLM — metric definitions, validation rules, benchmarks, segment descriptions. A generated starter set primes the knowledge base with relevant entries immediately.

---

## Proposed Solution

Three small changes, following the established generation patterns exactly:

1. **New prompt** — `buildKnowledgeGenerationPrompt(schemaMap, label)` in `src/lib/prompts/knowledge.ts`
2. **New API route** — `POST /api/knowledge/generate` that calls Gemini in JSON mode and returns `{ entries: KnowledgeEntry[] }`. Client saves via the existing `handleBulkAdd`.
3. **UI** — Add `onGenerate` prop to the `EmptyState` component; show a "Generate Starter Knowledge" button when the dataset has no entries at all (`allEntries.length === 0 && !hasFilters`).

---

## Technical Approach

### Why client-side save (not server-side)?

Existing knowledge API routes (`/api/knowledge/add`, `/api/knowledge/parse`) both return entries and let the client call `saveKnowledgeEntry()`. This is intentional: the knowledge store is client-side in-memory; persisting via the API route would require the server to call `saveKnowledgeEntry` in the same process, which is fragile for a Next.js route handler. Following the established client-save pattern keeps all knowledge writes consistent and uses the existing `handleBulkAdd` path.

### Architecture

```
/knowledge page (Global Context tab, allEntries.length === 0)
  └─ EmptyState "Generate Starter Knowledge" button
       └─ handleGenerateAll()
            └─ POST /api/knowledge/generate  { datasetId }
                 └─ buildKnowledgeGenerationPrompt(schemaMap, label)
                      └─ Gemini JSON mode → KnowledgeEntry[]
                           └─ return { entries }
                                └─ handleBulkAdd(entries)
                                     └─ saveKnowledgeEntry(datasetId, e) × N
                                          └─ setRefreshKey(k+1)
```

---

## Implementation Phases

### Phase 1: Knowledge Generation Prompt

**File: `src/lib/prompts/knowledge.ts`** — add `buildKnowledgeGenerationPrompt` alongside existing `PARSE_PROMPT`.

```typescript
import type { SchemaMap } from "@/lib/datasets/types";

export function buildKnowledgeGenerationPrompt(schemaMap: SchemaMap, label: string): string
```

Prompt structure:
1. Dataset + schema context (same `annotatedSchemaContext || colSummary` pattern as metrics)
2. Domain hints block
3. Instruction: generate 15–20 entries across these categories:
   - **Metric** (Critical) — key metric definitions (e.g. "Revenue is SUM(price) for purchase events")
   - **Data validation** (High) — data quality rules, NULL handling, date range, known gotchas
   - **Metric range** (High) — expected value ranges and healthy thresholds for key metrics
   - **Insight** (High) — important domain facts and business context
   - **Segment** (Good to have) — key user cohort descriptions
   - **Reporting** (Good to have) — how to interpret or present results
4. JSON schema per entry:
   ```json
   { "content": "string", "category": "Metric", "priority": "Critical", "level": "global" }
   ```
   - `content`: 1–2 clear sentences
   - `category`: one of the 8 KnowledgeCategory values
   - `priority`: "Critical", "High", or "Good to have"
   - `level`: always "global" for generated entries (domain context, not user preference)

---

### Phase 2: API Route

**New file: `src/app/api/knowledge/generate/route.ts`**

```
POST /api/knowledge/generate
Body: { datasetId: string }
```

Handler flow:
1. Validate `datasetId` (Zod, same as other generate routes)
2. Load SchemaMap from `data/datasets/<id>/schema-map.json` or fall back to `ds.schemaContext`
3. Call `buildKnowledgeGenerationPrompt(schemaMap, ds.label)`
4. Gemini call: `responseMimeType: "application/json"` (JSON mode)
5. Parse → filter entries where `content` is truthy
6. Map to full `KnowledgeEntry` objects:
   ```typescript
   {
     id: Math.random().toString(36).slice(2, 10),
     content: e.content,
     level: "global",
     category: sanitize(e.category, KNOWLEDGE_CATEGORIES, "Insight"),
     priority: sanitize(e.priority, KNOWLEDGE_PRIORITIES, "High"),
     source: "auto-generated",
     dateAdded: new Date().toISOString(),
     addedBy: "Sentinel AI",
   }
   ```
7. Return `{ entries: KnowledgeEntry[], count: number }`

Error handling:
- No schema available → 404
- Gemini fails → 500
- Zero valid entries → 500 with message

---

### Phase 3: Knowledge Page UI

**File: `src/app/knowledge/page.tsx`**

Add state and handler:
```typescript
const [generating, setGenerating] = useState(false);

const handleGenerateAll = useCallback(async () => {
  setGenerating(true);
  try {
    const data = await apiFetch<{ entries: KnowledgeEntry[] }>("/api/knowledge/generate", {
      method: "POST",
      body: { datasetId },
    });
    handleBulkAdd(data.entries);
  } catch {
    // silently fail — user can retry via manual add
  } finally {
    setGenerating(false);
  }
}, [datasetId, handleBulkAdd]);
```

Update `EmptyState` component signature to accept `onGenerate` and `generating`:
```typescript
function EmptyState({
  hasFilters,
  allEntriesCount,   // new: total entries across all tabs
  generating,        // new
  onWrite, onUpload, onPaste,
  onGenerate,        // new
})
```

Show the generate button only when `allEntriesCount === 0 && !hasFilters` (truly virgin dataset, no entries anywhere). When filters are active or there are entries on other tabs, show only the three manual buttons.

The generate button renders as the primary CTA above the manual options:
```
[Sparkles icon]  Generate Starter Knowledge   ← primary (bg-foreground)
---
Write entry  |  Upload file  |  Paste text    ← secondary (border only)
```

Pass `allEntries.length` as `allEntriesCount` to `EmptyState` (available at call site).

---

## Acceptance Criteria

- [ ] For a non-default dataset with no knowledge entries, the Knowledge Base empty state shows a "Generate Starter Knowledge" button above the manual add options
- [ ] Clicking generates 12–20 entries with `source: "auto-generated"` and `level: "global"` and saves them to the knowledge store
- [ ] Entries cover at least 4 of the 8 categories (Metric, Data validation, Insight, Segment minimum)
- [ ] Generated entries appear in the "Global Context" tab immediately after generation
- [ ] Button is disabled and shows loading state during generation
- [ ] Generate button does NOT appear when `allEntries.length > 0` (only on completely empty datasets)
- [ ] Generate button does NOT appear when filters are active (shows "no match" message instead)
- [ ] For the ecommerce default dataset (has preseeded entries), the empty state with generate button never shows
- [ ] `pnpm lint` passes with no new errors
- [ ] No raw `fetch()` calls — uses `apiFetch`

---

## Success Metrics

- A new dataset lands on the Knowledge Base with 15+ relevant entries in < 30 seconds
- Generated entries are immediately visible to the chat LLM (via entity catalog `@` picker)

---

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| Gemini generates entries with invalid category values | Sanitize in the route handler with a fallback to `"Insight"` |
| Gemini generates too few entries for simple schemas | Accept ≥ 10 entries as success; no minimum enforced |
| `handleBulkAdd` is memoized with `[datasetId]` dep — reference must be stable | Pass via callback ref in `handleGenerateAll` dependency array |
| User on the "My Preferences" tab with 0 user entries but existing global entries would see the generate button incorrectly | Fixed by using `allEntries.length === 0` (not `filtered.length === 0`) |

---

## References

### Internal

- Existing knowledge prompt: `src/lib/prompts/knowledge.ts` — `PARSE_PROMPT` (follow this style)
- Knowledge types: `src/lib/knowledge-types.ts` — `KnowledgeEntry`, `KNOWLEDGE_CATEGORIES`, `KNOWLEDGE_PRIORITIES`
- Knowledge store: `src/lib/knowledge-store.ts` — `saveKnowledgeEntry`, `getAllEntries`
- Knowledge page: `src/app/knowledge/page.tsx` — `handleBulkAdd` (line 149), `EmptyState` component (line 610), `allEntries` (line 57)
- Analogous generation routes: `src/app/api/metrics/generate/route.ts`, `src/app/api/segments/generate-all/route.ts`
- Metrics prompt for structure reference: `src/lib/prompts/metrics.ts`

### Pattern references (CLAUDE.md)

- **Empty state pattern**: icon + heading + sub-text + CTA, `text-muted-foreground`, no color
- **apiFetch**: all API calls via `apiFetch`, never raw `fetch`
- **Store invalidation**: `saveKnowledgeEntry` already calls `invalidateCatalog()` — no extra call needed
