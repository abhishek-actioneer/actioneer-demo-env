# Unified Refactor Execution Plan

**Date:** 2026-03-15
**Branch:** `refactor/dataset-consistency-frontend-simplification`
**Sources:** Synthesized from two plans + findings from 12 parallel review/research agents
**Scope:** ~40 files touched across 7 phases (0-6)

### Late-Breaking Corrections (from final 3 agents)

- **`src/lib/sql-highlight.tsx` already exists** with 3 importers — Task 1.5 must consolidate INTO this file, not create new `sql-highlighting.tsx`
- **SQL_KEYWORDS has 6 copies** (not 2): sources-panel, task-panel, inline-sources (dead), sql-renderer, chart-renderer, sql-highlight.tsx — consolidate all
- **6 additional files with hardcoded ecommerce** missed by original plans: `metric-store-server.ts`, `segment-detail-panel.tsx` (mock brands), `create-segment-modal.tsx` (placeholder text), `playbook/validate/route.ts` (2019-11-01), `schema/tables/route.ts` (2019-11-01/16 dates), `entity-context.ts` ($ currency)
- **`catalog-store.ts` doesn't exist** — original plan references it incorrectly. The file is `catalog-data.ts` (static data, no store)
- **canvas-store.ts has 4 active importers** (not 1): page.tsx, board-store.ts, intersection-cards.ts, smart-stack.tsx
- **React 19**: Use `<Context value={...}>` syntax (not `<Context.Provider>`) in all new providers
- **Next.js 16**: `headers()` is async — verify all route handlers use `await headers()`
- **AGENT_ICONS** has 4th active copy in `working-trace.tsx` — must also consolidate
- **Merge conflict risk**: `use-analytics.ts` has 20 commits (highest churn) — changes here should be atomic and merged fast

---

## Enhancement Summary

**Deepened on:** 2026-03-15
**Research agents used:** Architecture Strategist, Pattern Recognition Specialist, Performance Oracle, Code Simplicity Reviewer, Kieran TypeScript Reviewer, Julik Frontend Races Reviewer, Security Sentinel, Spec Flow Analyzer, Learnings Researcher, Best Practices Researcher, Framework Docs Researcher, Repo Research Analyst, Git History Analyzer

### Key Design Decisions (From Agent Synthesis)

1. **SKIP shared components** (FormDialog, DetailPanel, EmptyState, StatusBadge) — only 1-2 consumers each; premature abstraction for a prototype
2. **SKIP 4-way context split** — only 4 consumers of useChatState(); simplify to ChatThread consuming hook directly
3. **SKIP JSON seed data migration** — no second dataset needs seed data yet; defer until needed
4. **SKIP semantic color tokens** — contradicts CLAUDE.md monochrome rule
5. **SKIP use-analytics decomposition** — single-caller extraction moves complexity, doesn't remove it
6. **ADD security prerequisites** — SQL injection in /api/ingest and dataset ID validation must ship first
7. **ADD dataset switch race condition fix** — capture datasetId at handleSend start, pass explicitly to all apiFetch calls
8. **ADD dataset switch lifecycle** — wire onSwitch to abort in-flight requests, reset UI state
9. **REORDER** ECOMMERCE_SYSTEM_CONTEXT removal + consumer fix into same commit (TypeScript reviewer)
10. **Make datasetId REQUIRED** in store functions, not optional with fallback (TypeScript reviewer)

### Institutional Learnings Applied

- Never read localStorage in useState initializers (hydration mismatch)
- Provider tree ordering is sacred — new providers nest INSIDE existing ones
- DuckDB singleton pattern must be preserved — no per-dataset connections
- SQL context functions: getSystemContext → synthesis, buildTextToSqlPrompt → SQL gen (never mix)
- ESLint: .worktrees/** in globalIgnores, React Compiler rules disabled
- Next.js 16: proxy.ts not middleware.ts

---

## Phase 0: Security & Race Condition Prerequisites

**Priority:** CRITICAL — must ship before any other phase
**Risk:** HIGH — existing vulnerabilities worsened by the refactor
**Estimated scope:** 4 files, ~60 lines changed

### Task 0.1: Fix SQL Injection in /api/ingest

**File:** `src/app/api/ingest/route.ts`

The route constructs SQL INSERT statements via string concatenation with only single-quote escaping. This is exploitable.

**Fix:** Replace string interpolation with parameterized queries.

```typescript
// BEFORE (vulnerable):
await conn.run(`INSERT INTO sentinel_live_events (...) VALUES ('${id}', '${tenantId.replace(/'/g, "''")}', ...)`);

// AFTER (safe):
await conn.run(
  `INSERT INTO sentinel_live_events (...) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
  [id, tenantId, appId, eventType, sessionId, anonymousId, userId, platform, deviceType, propertiesJson, contextJson]
);
```

**Verify:** `pnpm build` passes. Test with `curl -X POST /api/ingest` with a crafted payload containing `'; DROP TABLE --` — should insert literally, not execute.

### Task 0.2: Add validateDatasetId() Centralized Validation

**File:** `src/lib/datasets/index.ts`

**Create:**
```typescript
const SAFE_DATASET_ID = /^[a-z0-9-]+$/;

export function validateDatasetId(raw: string | null | undefined): DatasetId {
  const id = raw || DEFAULT_DATASET;
  if (!SAFE_DATASET_ID.test(id) || id.length > 64) {
    throw new Error(`Invalid dataset ID: "${id}"`);
  }
  return id as DatasetId;
}
```

**Also fix `getDataset()` to throw on unknown ID** instead of silently falling back to ecommerce:
```typescript
export function getDataset(id: DatasetId): DatasetConfig {
  const ds = STATIC_DATASETS[id] ?? getDynamicDataset(id);
  if (!ds) throw new Error(`Dataset "${id}" not found. Known: ${Object.keys(STATIC_DATASETS).join(", ")}`);
  return ds;
}
```

**Verify:** `pnpm build` passes. Any route passing an unknown dataset ID returns a 400/500 error, not ecommerce data.

### Task 0.3: Fix Dataset Switch Race Condition in useAnalytics

**File:** `src/hooks/use-analytics.ts`

**Problem:** In-flight `apiFetch` calls inside `handleSend` read module-level `_datasetId` at call time. If the user switches datasets mid-stream, nested fetches (/api/ack, /api/recommend, /api/query, /api/segments/generate-sql) use the WRONG dataset.

**Fix:** At the top of `handleSend`, capture the dataset ID and pass it explicitly:

```typescript
const handleSend = useCallback(async (...) => {
  const capturedDatasetId = datasetId; // capture at invocation time

  // All nested apiFetch calls pass it explicitly:
  const classifyRes = await apiFetch("/api/classify", {
    method: "POST", body: { query, datasetId: capturedDatasetId }
  });
  // ... same for /api/analyze, /api/ack, /api/recommend, /api/query, etc.
}, [datasetId, ...]);
```

**Verify:** `pnpm build` passes. Manual test: start a deep research query, switch datasets mid-stream — no cross-dataset data contamination.

### Task 0.4: Wire Dataset Switch Lifecycle

**Files:** `src/components/layout-shell.tsx`, `src/lib/dataset-context.tsx`, `src/hooks/use-analytics.ts`

**Problem:** `DatasetProvider.onSwitch` is never wired. On dataset switch: in-flight requests continue, panel state persists, deepResearch toggle persists, segmentModal stays open.

**Fix:**
1. In `layout-shell.tsx`, pass an `onSwitch` callback to `DatasetProvider` that:
   - Calls `handleStop()` (from ChatStateProvider) to abort in-flight analytics
   - Resets `deepResearch` to false
   - Closes any open panel
   - Closes segmentModal

2. Since `DatasetProvider` is an ancestor of `ChatStateProvider` in the provider tree, use a module-level event emitter pattern (like the existing `catalog-invalidation.ts`):

```typescript
// src/lib/dataset-switch.ts
type Listener = () => void;
const listeners = new Set<Listener>();
export function onDatasetSwitch(fn: Listener) { listeners.add(fn); return () => listeners.delete(fn); }
export function notifyDatasetSwitch() { listeners.forEach(fn => fn()); }
```

3. `DatasetProvider.switchDataset` calls `notifyDatasetSwitch()`.
4. `ChatStateProvider` subscribes via `useEffect` and calls `handleStop`, resets deepResearch, closes panels.

**Verify:** `pnpm build` passes. Switch datasets while processing — stream aborts, panel closes, toggle resets.

---

## Phase 1: Dead Code Cleanup & File Renames

**Priority:** HIGH — reduces surface area for later phases
**Risk:** LOW — mechanical, no behavioral change
**Estimated scope:** ~700 LOC removed, 6 files deleted/renamed

### Task 1.1: Delete Dead Chat Components

**Files to delete:**
- `src/components/chat/agent-card.tsx` (167 lines)
- `src/components/chat/entity-chip-bar.tsx` (82 lines)
- `src/components/chat/inline-sources.tsx` (209 lines)

**Pre-check:** Verify zero external imports for each file.
**Verify:** `pnpm build` passes.

### Task 1.2: Delete Legacy src/lib/sidebar-context.tsx

**File to delete:** `src/lib/sidebar-context.tsx` (68 lines)

The active provider is `@/components/sidebar-context`. This is the old SidebarOverrides API — dead code.

**Pre-check:** Verify no source files import from `@/lib/sidebar-context`.
**Verify:** `pnpm build` passes.

### Task 1.3: Delete Deprecated canvas-store.ts

**File to delete:** `src/lib/canvas-store.ts`

**Pre-check:** Find all importers. Migrate any remaining to `board-store.ts` equivalents. The architecture strategist confirmed only `smart-stack.tsx` still imports from `canvas-store`.

**Verify:** `pnpm build` passes.

### Task 1.4: Rename Misnamed Store Files

- `git mv src/lib/scout-store.ts src/lib/scout-data.ts`
- `git mv src/lib/connector-store.ts src/lib/connector-data.ts`
- Update all import paths.

**Verify:** `pnpm build` passes.

### Task 1.5: Extract SQL Highlighting to Shared Module

**CORRECTION:** `src/lib/sql-highlight.tsx` ALREADY EXISTS with 3 importers. Consolidate INTO this file — do not create a new `sql-highlighting.tsx`.

**Consolidate all 6 copies of SQL_KEYWORDS** into `src/lib/sql-highlight.tsx`:
- `src/components/chat/sources-panel.tsx` (remove inline copy)
- `src/components/chat/task-panel.tsx` (remove inline copy)
- `src/components/canvas/card-renderers/sql-renderer.tsx` (remove inline copy)
- `src/components/canvas/card-renderers/chart-renderer.tsx` (remove inline copy)
- `src/components/chat/inline-sources.tsx` (dead — already deleted in Task 1.1)

**Also consolidate AGENT_ICONS** (4 active copies):
- `src/components/chat/sources-panel.tsx`
- `src/components/question/working-trace.tsx`
- Make `getAgentIcon(id: string): LucideIcon` function (not static map) for future dataset-awareness.

**Verify:** `pnpm build` passes.

### Task 1.6: Extract Subagent Config to Shared Module

**Create:** `src/lib/subagent-config.ts` with `SUBAGENT_TASKS` config.
**Modify:** `src/components/chat/research-timeline.tsx`, `src/components/chat/task-panel.tsx` — import from shared module.

**Design choice (from architecture strategist):** Make it a function `getSubagentConfig(datasetId?: string)` that tries `DatasetConfig.agents` first, falls back to hardcoded defaults. This bridges the dataset plan's Phase 4.8.

**Verify:** `pnpm build` passes.

---

## Phase 2: Dataset Consistency — Core Infrastructure

**Priority:** CRITICAL — the primary objective of this refactor
**Risk:** MEDIUM — mechanical find-and-replace plus targeted fixes
**Estimated scope:** ~15 files, ~40 replacements

### Task 2.1: Replace All "ecommerce" String Literals with DEFAULT_DATASET

Find every file that compares against or falls back to the string `"ecommerce"` and replace with `DEFAULT_DATASET` from `src/lib/datasets/index.ts`.

**Files (verified list from pattern recognition agent):**

| File | Fix |
|------|-----|
| `src/lib/api-client.ts:14` | `let _datasetId = DEFAULT_DATASET` (also: initialize to "" and throw if unset — TypeScript reviewer) |
| `src/app/api/classify/route.ts:9` | `datasetId \|\| DEFAULT_DATASET` |
| `src/app/api/metrics/route.ts:120,134` | Use `DEFAULT_DATASET` constant |
| `src/app/api/board-generate/route.ts:167` | `datasetId === DEFAULT_DATASET` |
| `src/components/sidebar-context.tsx:71,119-128` | `currentDatasetId === DEFAULT_DATASET` |
| `src/app/segments/page.tsx` | `datasetId === DEFAULT_DATASET` |
| `src/app/segments/[id]/page.tsx` | `datasetId === DEFAULT_DATASET` |
| `src/components/sidebar/panels.tsx` | `switchDataset(DEFAULT_DATASET)` |
| `src/components/chat/chat-input.tsx` | `datasetId = DEFAULT_DATASET` |
| `src/lib/dataset-context.tsx:30-39,50,56-61,100-105` | All use `DEFAULT_DATASET`. Replace `DEFAULT_META` with `getDataset(DEFAULT_DATASET)` |

**Additional from repo research analyst:** Also check `/api/query`, `/api/recommend`, `/api/events`, `/api/ingest` for hardcoded fallbacks.

**Critical (TypeScript reviewer):** In `api-client.ts`, initialize `_datasetId = ""` and throw if `apiFetch` called before `setActiveDatasetId`:
```typescript
let _datasetId = "";
// In apiFetch:
if (!_datasetId) throw new Error("apiFetch called before setActiveDatasetId");
```

**Verify:** `grep -r '"ecommerce"' src/` returns 0 results outside of `src/lib/datasets/ecommerce.ts` and the `DEFAULT_DATASET` definition. `pnpm build` passes.

### Task 2.2: Fix API Routes That Ignore x-dataset-id Header

These routes never read the header — always hit default dataset:

| Route | Fix |
|-------|-----|
| `src/app/api/events/route.ts` | Add `const datasetId = validateDatasetId(req.headers.get("x-dataset-id"))` |
| `src/app/api/ingest/route.ts` | Same (already touched in Phase 0) |
| `src/app/api/integrations/route.ts` | Same, or document as global-only |
| `src/app/api/forecast/generate-sql/route.ts` | Read header, pass to `getSchemaContext(datasetId)` |
| `src/app/api/forecast/seed/route.ts` | Same — both main handler and `llmFixSQL()` |

**Standard pattern (from repo research analyst):**
```typescript
const datasetId = validateDatasetId(body.datasetId || req.headers.get("x-dataset-id"));
```

**Verify:** `pnpm build` passes.

### Task 2.3: Remove ECOMMERCE_SYSTEM_CONTEXT + Fix All Consumers (SAME COMMIT)

**Why same commit (TypeScript reviewer):** Removing the export from `schema.ts` breaks `playbook-executor.ts` at compile time. Must fix both simultaneously.

**Files:**
1. `src/lib/schema.ts:16` — Remove `export const ECOMMERCE_SYSTEM_CONTEXT`
2. `src/lib/playbook-executor.ts:3,388,517,559` — Replace import with `getSystemContext(datasetId)`. Thread `datasetId` from the API route caller.
3. Audit all other consumers of `ECOMMERCE_SYSTEM_CONTEXT` — find with grep.

**Also:** Make `getSystemContext()` require `datasetId` as non-optional parameter.

**Verify:** `pnpm build` passes. `grep -r 'ECOMMERCE_SYSTEM_CONTEXT' src/` returns 0.

### Task 2.4: Make Store Functions Dataset-Aware (Required datasetId)

**Pattern (from TypeScript reviewer):** Use nested `Map<DatasetId, Map<string, T>>`:

```typescript
// src/lib/dataset-store.ts — optional factory
export function createDatasetStore<T extends { id: string }>(
  loader: (datasetId: DatasetId) => T[],
) {
  const stores = new Map<DatasetId, Map<string, T>>();
  const initialized = new Set<DatasetId>();
  function getStore(datasetId: DatasetId): Map<string, T> {
    if (!initialized.has(datasetId)) {
      const items = loader(datasetId);
      const map = new Map<string, T>();
      items.forEach(item => map.set(item.id, item));
      stores.set(datasetId, map);
      initialized.add(datasetId);
    }
    return stores.get(datasetId)!;
  }
  return {
    getAll: (datasetId: DatasetId) => Array.from(getStore(datasetId).values()),
    get: (datasetId: DatasetId, id: string) => getStore(datasetId).get(id),
    save: (datasetId: DatasetId, item: T) => { getStore(datasetId).set(item.id, item); invalidateCatalog(); },
    delete: (datasetId: DatasetId, id: string) => { getStore(datasetId).delete(id); invalidateCatalog(); },
  };
}
```

**Stores to update:** `metric-store.ts`, `knowledge-store.ts`, `catalog-store.ts`. Keep `board-store.ts` as-is (already dataset-scoped). Keep `playbook-store.ts` pattern (no ensureInitialized).

**Critical (TypeScript reviewer):** `datasetId` parameter is REQUIRED, not optional. No silent fallback to DEFAULT_DATASET.

**For now:** The loader function returns the existing TypeScript constants filtered by dataset (e.g., ecommerce gets PRESEEDED_METRICS, others get empty). JSON migration deferred.

**Verify:** `pnpm build` passes. All callers of `getAllMetrics()` etc. updated to pass `datasetId`.

### Task 2.5: Make buildEntityCatalog() and Knowledge/Entity Context Dataset-Scoped

**Files:**
- `src/lib/entity-registry.ts` — Add `datasetId` parameter to `buildEntityCatalog()`. Pass to all store calls.
- `src/components/chat/entity-catalog-provider.tsx` — Pass `datasetId` from `useDataset()` to `buildEntityCatalog()`.
- Knowledge context builder (referenced in `use-analytics.ts`) — Add `datasetId` parameter, filter knowledge entries.
- Entity context builder (referenced in `use-analytics.ts`) — Add `datasetId` parameter.

**Also (spec flow analyzer):** Fix `$` currency in `entity-registry.ts:23` — use `dataset.currency` from config.

**Verify:** `pnpm build` passes. Switch to non-ecommerce dataset → @ picker shows only that dataset's entities.

---

## Phase 3: Dataset Consistency — UI Strings

**Priority:** HIGH — visible to users immediately
**Risk:** LOW — string replacements
**Estimated scope:** ~8 files

### Task 3.1: Fix Topbar Hardcoded Label

**File:** `src/components/topbar.tsx:11`
**Current:** `<span>eCommerce Store</span>`
**Fix:** Use `dataset.label` from `useDataset()` context.

### Task 3.2: Fix Research Report Hardcoded Strings

**File:** `src/components/chat/research-report.tsx`
- Line ~170: "eCommerce Store Performance..." → Use dataset label
- Line ~179: "DuckDB - ecommerce.duckdb" → Use `dataset.dbName`
- Line ~197: "multi-category eCommerce store" → Remove or make dynamic

### Task 3.3: Fix Task Panel Hardcoded Text

**File:** `src/components/chat/task-panel.tsx`
Remove "Revenue & Conversion Analysis for eCommerce Analytics" — title should come from actual query.

### Task 3.4: Fix Currency Symbol

**File:** `src/components/canvas/drilldown-popover.tsx:45`
**Current:** `const prefix = format === "currency" ? "₹" : ""`
**Fix:** Read `dataset.currency` from `DatasetConfig`.

### Task 3.5: Fix Segment Renderer "users" Label

**File:** `src/components/canvas/card-renderers/segment-renderer.tsx:94`
Use entity name from dataset config.

### Task 3.6: Fix Metric Detail Panel Tables & Dimensions

**File:** `src/components/metric/metric-detail-panel.tsx:28-43`
Load `AVAILABLE_TABLES` and `AVAILABLE_DIMENSIONS` from `DatasetConfig.columns`.

**Verify all Phase 3:** `pnpm build` passes. Switch to non-ecommerce dataset → no ecommerce text visible in any UI component.

---

## Phase 4: Dataset Consistency — Prompts & Agents

**Priority:** HIGH — affects LLM quality
**Risk:** MEDIUM — prompt changes can affect LLM behavior
**Estimated scope:** ~6 files

### Task 4.1: Fix Classification Prompt Examples

**File:** `src/lib/prompts/classify.ts:11-47`
Replace ecommerce-biased examples with domain-neutral ones or inject from `DatasetConfig.suggestedPrompts`.

### Task 4.2: Consolidate Action Recommender Prompts

**Files:** `src/lib/prompts/actions.ts`, `src/lib/action-recommender.ts`
Consolidate into one prompt. Make dataset-aware: accept `DatasetConfig`, generate action types based on domain.

### Task 4.3: Fix Dataset Enrichment Examples

**File:** `src/lib/prompts/dataset-enrichment.ts:108-118`
Make agent example queries domain-neutral or multi-domain.

### Task 4.4: Unify Agent Display Metadata

**Files:** `src/lib/chat-data.ts:15-22`, `src/lib/conversation-data.ts:6-13`, `src/hooks/use-classify.ts:66-96`
Single source of truth — read from `DatasetConfig.agents`. Delete 3 duplicate AGENT_DISPLAY constants.

### Task 4.5: Add datasetId to Playbook Type

**Files:** `src/lib/playbook-store.ts`, `src/lib/playbook-data.ts`
Add `datasetId` field to Playbook and PlaybookV2 types. Filter in `getAllPlaybookSummariesMerged(datasetId)`. Prevent cross-dataset playbook execution.

**Verify all Phase 4:** `pnpm build` passes. Run a query on quickhelp → LLM persona says domain-appropriate text, not "eCommerce analytics assistant".

---

## Phase 5: Frontend Simplification — File Splits & Prop Fix

**Priority:** MEDIUM — code organization
**Risk:** MEDIUM — component restructuring
**Estimated scope:** ~4 files

### Task 5.1: Split task-panel.tsx into 3 Files

**Create:**
- `src/components/chat/main-agent-panel.tsx` (~500 lines) — MainAgentPanel + TimelineBlock
- `src/components/chat/subagent-detail-panel.tsx` (~350 lines) — SubagentDetailPanel
**Modify:** `src/components/chat/task-panel.tsx` → ~50-line router

**Verify:** `pnpm build` passes.

### Task 5.2: Fix ChatThread Prop Drilling (Simplified)

**File:** `src/components/chat/chat-thread.tsx`

Instead of the full 4-way context split, do the minimal change:
1. Have ChatThread consume `useChatState()` directly
2. Delete the 29-prop `ChatThreadProps` interface
3. Keep only layout props: `hideMinimap`, `compact`, `onChartPinned`

**Also (Performance Oracle):** Add `React.memo()` to ChatThread for re-render reduction.

**Modify:** `src/components/chat/chat-panel.tsx` — simplify `<ChatThread>` call from 25+ props to ~3.

**Verify:** `pnpm build` passes. Chat thread renders correctly with all interactions working.

---

## Phase 6: Verification & Cleanup

### Task 6.1: Full Validation Suite

Run all validation criteria from the original dataset plan:

1. `grep -r '"ecommerce"' src/` — 0 results outside dataset definition files
2. Switch to non-ecommerce dataset → no ecommerce text visible anywhere
3. Switch back to ecommerce → all existing functionality works
4. Currency test: non-USD datasets show correct symbol
5. Agent test: deep research shows dataset-appropriate agent names
6. Playbook test: run on quickhelp → persona says domain-appropriate text
7. Forecast SQL test: on quickhelp → references correct tables

### Task 6.2: Build & Lint

```bash
pnpm build   # Must pass with 0 errors
pnpm lint    # Must pass with 0 errors
```

---

## Files Inventory (Complete)

### Files to DELETE (Phase 1)
1. `src/components/chat/agent-card.tsx` (167 lines)
2. `src/components/chat/entity-chip-bar.tsx` (82 lines)
3. `src/components/chat/inline-sources.tsx` (209 lines)
4. `src/lib/sidebar-context.tsx` (68 lines)
5. `src/lib/canvas-store.ts` (~200 lines)

### Files to CREATE
6. `src/lib/dataset-switch.ts` (~15 lines — dataset switch event emitter)
7. `src/lib/datasets/validation.ts` (~15 lines — validateDatasetId)
8. `src/lib/sql-highlighting.tsx` (~60 lines — extracted shared module)
9. `src/lib/subagent-config.ts` (~80 lines — extracted shared module)
10. `src/components/chat/main-agent-panel.tsx` (~500 lines — split from task-panel)
11. `src/components/chat/subagent-detail-panel.tsx` (~350 lines — split from task-panel)

### Files to RENAME
12. `src/lib/scout-store.ts` → `src/lib/scout-data.ts`
13. `src/lib/connector-store.ts` → `src/lib/connector-data.ts`

### Files to MODIFY (major changes)
14. `src/app/api/ingest/route.ts` — parameterized queries
15. `src/lib/datasets/index.ts` — validateDatasetId, getDataset throws
16. `src/hooks/use-analytics.ts` — capture datasetId, pass explicitly
17. `src/components/layout-shell.tsx` — wire dataset switch lifecycle
18. `src/lib/schema.ts` — remove ECOMMERCE_SYSTEM_CONTEXT
19. `src/lib/playbook-executor.ts` — use getSystemContext(datasetId)
20. `src/lib/api-client.ts` — fail-loud on missing datasetId
21. `src/lib/dataset-context.tsx` — replace DEFAULT_META
22. `src/lib/metric-store.ts` — dataset-scoped nested Map
23. `src/lib/knowledge-store.ts` — dataset-scoped nested Map
24. `src/lib/catalog-store.ts` — dataset-scoped nested Map
25. `src/lib/entity-registry.ts` — add datasetId, fix $ currency
26. `src/components/chat/entity-catalog-provider.tsx` — pass datasetId
27. `src/components/topbar.tsx` — dynamic label
28. `src/components/chat/research-report.tsx` — dynamic strings
29. `src/components/chat/task-panel.tsx` — split into 3 files + fix strings
30. `src/components/canvas/drilldown-popover.tsx` — dynamic currency
31. `src/components/canvas/card-renderers/segment-renderer.tsx` — dynamic entity name
32. `src/components/metric/metric-detail-panel.tsx` — dynamic tables/dimensions
33. `src/lib/prompts/classify.ts` — domain-neutral examples
34. `src/lib/prompts/actions.ts` + `src/lib/action-recommender.ts` — consolidate
35. `src/hooks/use-classify.ts` — use DatasetConfig.agents
36. `src/components/chat/chat-thread.tsx` — consume hook directly, React.memo
37. `src/components/chat/chat-panel.tsx` — remove prop drilling

### Files SAFE (no changes needed — properly parameterized)
- `src/lib/prompts/analyze.ts`
- `src/lib/prompts/sql.ts`
- `src/lib/prompts/metrics.ts`
- `src/lib/prompts/schema-generic.ts`
- `src/lib/prompts/knowledge.ts`
- `src/lib/prompts/connectors.ts`

---

## What Was Explicitly DEFERRED

| Item | Reason | Revisit When |
|------|--------|-------------|
| JSON seed data migration (Phase 2 of dataset plan) | No second dataset needs seed data yet | A second dataset needs preseeded metrics/playbooks/knowledge |
| Shared components (FormDialog, DetailPanel, EmptyState, StatusBadge) | 1-2 consumers each, premature abstraction | 5+ identical instances exist |
| 4-way ChatStateContext split | Only 4 consumers, no measured perf problem | Re-render profiling shows measurable impact |
| use-analytics decomposition | Single-caller extraction, moves not removes complexity | New concern needs extraction |
| Semantic color tokens (--success, --warning) | Contradicts monochrome UI rule in CLAUDE.md | Design system explicitly adopts color |
| Server Component conversion | Working client components, no benefit for prototype | Production readiness requires SSR optimization |
| Store dataset isolation via createDatasetStore factory | Can use simpler filtering for now | 4+ stores need identical dataset scoping |
| Dataset config completeness validation | Only 3 datasets, no production deployment | Multi-tenant production launch |
| SidebarContext split (25 props) | Not specified in detail in frontend plan | Sidebar becomes a performance bottleneck |

---

## Execution Constraints

1. **Always on branch** `refactor/dataset-consistency-frontend-simplification`
2. **Build must pass** after every phase (`pnpm build`)
3. **Commit after each task** with descriptive message
4. **Phase order is strict** — each phase depends on prior
5. **Within a phase**, tasks can be parallelized if they touch different files
6. **Never create middleware.ts** — Next.js 16 uses proxy.ts
7. **Never reorder provider tree** in layout-shell.tsx
8. **Never read localStorage in useState initializers**
9. **All API calls use apiFetch** (never raw fetch)
10. **Store mutations call invalidateCatalog()**
