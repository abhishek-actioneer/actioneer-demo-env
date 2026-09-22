# Plan: Dataset Consistency — Eliminate All Hardcoded Elements

**Date:** 2026-03-15
**Branch:** `fix/dataset-consistency`
**Goal:** Every data route, seed file, UI component, and prompt must respect the active dataset. No hardcoded ecommerce assumptions.

---

## Problem Statement

The app supports multiple datasets via `DatasetProvider` → `apiFetch` → `x-dataset-id` header → `withConnection(datasetId)`. But **dozens of files** hardcode ecommerce-specific data: table names, column names, mock segments, demo conversations, date ranges (`2019-11-*`), category names (`electronics`, `appliances`), currency symbols (`₹`), and string literals (`"ecommerce"`). When a user switches datasets, they still see ecommerce metrics, ecommerce conversations, ecommerce playbook templates, and ecommerce forecast data.

---

## Architecture Principle

Every piece of data the user sees must flow from one of two sources:

1. **Dataset config** (`data/datasets/<id>/`) — static metadata, schema, metrics.json, agents, suggested prompts
2. **Live queries** — SQL executed against the active dataset's DuckDB instance

**Never** from hardcoded TypeScript constants that assume a specific domain.

---

## Phase 1: Core Infrastructure — Dataset-Aware Defaults

**Priority:** CRITICAL — blocks all other phases

### 1.1 Replace all `"ecommerce"` string literals with `DEFAULT_DATASET`

Every file that compares against or falls back to the string `"ecommerce"` should use the `DEFAULT_DATASET` constant from `src/lib/datasets/index.ts`.

| File | Line(s) | Current | Fix |
|------|---------|---------|-----|
| `src/lib/api-client.ts` | 14 | `let _datasetId = "ecommerce"` | `let _datasetId = DEFAULT_DATASET` |
| `src/app/api/classify/route.ts` | 9 | `datasetId \|\| "ecommerce"` | `datasetId \|\| DEFAULT_DATASET` |
| `src/app/api/metrics/route.ts` | 120, 134 | `"ecommerce"` fallback + check | Use `DEFAULT_DATASET` constant |
| `src/app/api/board-generate/route.ts` | 167 | `datasetId === "ecommerce"` | `datasetId === DEFAULT_DATASET` |
| `src/components/sidebar-context.tsx` | 71, 119-128 | `currentDatasetId === "ecommerce"` | `currentDatasetId === DEFAULT_DATASET` |
| `src/app/segments/page.tsx` | multiple | `datasetId === "ecommerce"` | `datasetId === DEFAULT_DATASET` |
| `src/app/segments/[id]/page.tsx` | multiple | `datasetId === "ecommerce"` | `datasetId === DEFAULT_DATASET` |
| `src/components/sidebar/panels.tsx` | 1 ref | `switchDataset("ecommerce")` | `switchDataset(DEFAULT_DATASET)` |
| `src/components/chat/chat-input.tsx` | 1 ref | `datasetId = "ecommerce"` | `datasetId = DEFAULT_DATASET` |
| `src/lib/dataset-context.tsx` | 30-39, 50, 56-61, 100-105 | Multiple `"ecommerce"` refs | All use `DEFAULT_DATASET` |
| `src/lib/schema.ts` | 1 ref | `ECOMMERCE_SYSTEM_CONTEXT = getSystemContext("ecommerce")` | Remove — callers should pass datasetId |

**Estimated scope:** ~15 files, ~30 replacements. Mechanical find-and-replace.

### 1.2 Fix API routes that ignore `x-dataset-id` header entirely

These routes never read the header and always hit the default dataset:

| Route | Issue | Fix |
|-------|-------|-----|
| `src/app/api/events/route.ts` | Uses `withConnection(DEFAULT_DATASET, ...)` | Read `x-dataset-id` header, pass to `withConnection()` |
| `src/app/api/ingest/route.ts` | Uses `withConnection(DEFAULT_DATASET, ...)` | Same |
| `src/app/api/integrations/route.ts` | No header reading | Either make dataset-aware or document as global-only |
| `src/app/api/forecast/generate-sql/route.ts` | Calls `getSchemaContext()` without datasetId | Pass `datasetId` from header |

### 1.3 Fix `ECOMMERCE_SYSTEM_CONTEXT` export leak

`src/lib/schema.ts` exports `ECOMMERCE_SYSTEM_CONTEXT = getSystemContext("ecommerce")` — a cached ecommerce-specific persona. Any consumer using this instead of `getSystemContext(datasetId)` will get the ecommerce persona regardless of active dataset.

**Fix:** Remove the export. Audit all consumers to call `getSystemContext(datasetId)` directly.

---

## Phase 2: Seed Data — Make Dataset-Scoped

**Priority:** HIGH — users see wrong data on non-ecommerce datasets

The core issue: all `*-data.ts` files export constants that assume ecommerce. These need to become **dataset-scoped** — either by moving them into `data/datasets/<id>/` JSON files (preferred) or by keying them by `datasetId`.

### 2.1 Preloaded Conversations → Dataset-Scoped

**Files:** `src/lib/chat-data.ts`, `src/lib/conversation-data.ts`

**Current state:** 6+ preloaded conversations with hardcoded ecommerce questions/answers ("Daily revenue trends", "$7.2M", "Top 10 Brands", "apple/samsung/huawei", "Nov 1-16 2019").

**Fix options (pick one):**
- **Option A (recommended):** Move preloaded conversations to `data/datasets/<id>/conversations.json`. `conversation-store.ts` reads from there based on active dataset. Non-ecommerce datasets get either no preloaded conversations or their own.
- **Option B:** Remove preloaded conversations entirely. They're demo scaffolding.
- **Option C:** Generate preloaded conversations at dataset upload time using LLM (most complex, best UX for new datasets).

### 2.2 Metrics Seed Data → Dataset JSON

**File:** `src/lib/metric-data.ts` (579 lines)

**Current state:** 22 hardcoded metrics with ecommerce SQL (`daily_metrics`, `brand_metrics`, `event_type = 'purchase'`), ecommerce dimensions (`brand`, `category_code`), and 2019 time series.

**Fix:** The metrics API route already supports loading from `data/datasets/<id>/metrics.json`. The ecommerce preseeded metrics should be moved there. `PRESEEDED_METRICS` becomes the fallback *only* for the ecommerce dataset (checked via `DEFAULT_DATASET`, not string literal).

**Steps:**
1. Export current `PRESEEDED_METRICS` to `data/datasets/ecommerce/metrics.json`
2. Remove `PRESEEDED_METRICS` from TypeScript (or keep as ecommerce-only with clear guard)
3. The API route already handles the JSON path — just ensure `metric-data.ts` isn't imported elsewhere without dataset guards

### 2.3 Forecast Seed Data → Dataset JSON

**File:** `src/lib/forecast-data.ts` (173 lines)

**Current state:** `BASE_SEED_DATA` has weekly revenue for Sep–Nov 2019 with categories (`electronics`, `appliances`, `apparel`, `furniture`). `DEFAULT_MODEL` references `daily_metrics` table and `category_code`.

**Fix:**
1. Move `BASE_SEED_DATA` + `DEFAULT_MODEL` to `data/datasets/ecommerce/forecast.json`
2. `forecast-store.ts` loads seed data from dataset JSON if available, otherwise shows empty state
3. Non-ecommerce datasets show "No forecast data — generate one" prompt

### 2.4 Playbook Templates → Dataset JSON

**File:** `src/lib/playbook-data.ts` (~1500 lines)

**Current state:** Template playbooks reference `ecommerce-store-health-check`, default dates `2019-11-01` to `2019-11-16`, and `'dataset': 'ecommerce.duckdb'`.

**Fix:**
1. Move ecommerce-specific templates to `data/datasets/ecommerce/playbooks.json`
2. Keep only truly dataset-agnostic template structures in `playbook-data.ts` (if any)
3. `playbook-store.ts` loads templates from dataset JSON

### 2.5 Knowledge Base Entries → Dataset JSON

**File:** `src/lib/knowledge-data.ts` (~130 lines)

**Current state:** 8 knowledge entries with ecommerce facts ("Revenue is calculated as SUM(price) for purchase events", "Event types: view, cart, remove_from_cart, purchase", "Top categories: electronics 45%").

**Fix:**
1. Move to `data/datasets/ecommerce/knowledge.json`
2. `knowledge-store.ts` loads from dataset JSON
3. Non-ecommerce datasets use their own knowledge entries or start empty

### 2.6 Mock Segments → Dataset-Scoped

**File:** `src/components/segments/mock-segments.ts`

**Current state:** 4+ mock segments ("HV Mobile Users", "Summer Churn Risk", "Abandoned Cart 2024", "Flash Sale Urgent") with ecommerce SQL and hardcoded user counts.

**Fix:**
1. Move to `data/datasets/ecommerce/segments.json`
2. Already partially guarded (`datasetId === "ecommerce"`) — change guard to `DEFAULT_DATASET` and load from JSON

### 2.7 Catalog/Schema Data → Already Dynamic (Verify)

**File:** `src/lib/catalog-data.ts`

**Current state:** `EVENTS_COLUMNS` hardcodes ecommerce columns (`event_type`, `category_code`, `brand`) with sample values (`samsung`, `apple`).

**Fix:** This should come from the dataset's `DatasetConfig.columns` (which already exists on `DatasetConfig` type). Remove `EVENTS_COLUMNS` or make it the ecommerce-only fallback.

### 2.8 Store/SKU Mock Data → Dataset-Scoped

**File:** `src/lib/store-data.ts`

**Current state:** `MOCK_SKUS` with game-currency items ("100 Gems", "500 Gems").

**Fix:** Move to `data/datasets/ecommerce/store.json` or conditionally load. Non-ecommerce datasets show empty store.

---

## Phase 3: UI Components — Remove Hardcoded Display Text

**Priority:** HIGH — visible to users immediately

### 3.1 Topbar — Hardcoded "eCommerce Store"

**File:** `src/components/topbar.tsx:11`

**Current:** `<span>eCommerce Store</span>`
**Fix:** Use `dataset.label` from `useDataset()` context.

### 3.2 Research Report — Hardcoded eCommerce Strings

**File:** `src/components/chat/research-report.tsx`

| Line | Current | Fix |
|------|---------|-----|
| ~170 | "eCommerce Store Performance & Customer Behavior Deep Analysis" | Use dataset label + dynamic title |
| ~179 | "DuckDB · ecommerce.duckdb" | Use `dataset.dbName` from context |
| ~197 | "pricing optimization opportunities across the multi-category eCommerce store" | Remove or make LLM-generated |

### 3.3 Task Panel — Hardcoded eCommerce Text

**File:** `src/components/chat/task-panel.tsx`

**Current:** References "Revenue & Conversion Analysis for eCommerce Analytics"
**Fix:** Title should come from the actual query analysis, not be hardcoded.

### 3.4 Metric Detail Panel — Hardcoded Tables & Dimensions

**File:** `src/components/metric/metric-detail-panel.tsx:28-43`

**Current:**
- `dataset: "ecommerce_prod"` in `AVAILABLE_TABLES`
- `AVAILABLE_DIMENSIONS`: `country_code`, `platform`, `brand`, `category_code` (ecommerce-specific)

**Fix:** Load available tables and dimensions from `DatasetConfig.columns` dynamically.

### 3.5 Currency Symbol — Hardcoded ₹

**File:** `src/components/canvas/drilldown-popover.tsx:45`

**Current:** `const prefix = format === "currency" ? "₹" : ""`
**Fix:** Read `dataset.currency` from `DatasetConfig` (field already exists on the type).

### 3.6 Segment Renderer — Hardcoded "users" Label

**File:** `src/components/canvas/card-renderers/segment-renderer.tsx:94`

**Current:** `<span>users</span>` hardcoded
**Fix:** Use entity name from dataset config (could be "users", "customers", "accounts", "patients").

### 3.7 Canvas Demo Items — Ecommerce Content

**File:** `src/lib/canvas-store.ts:14-137` (`DEMO_ITEMS` array)

**Current:** All demo items are ecommerce-specific ("Weekly Revenue Trend", "Cohort Retention Rates", "$119,600", "APAC revenue drop", "Mobile cart abandonment spike").

**Fix:** Move to `data/datasets/ecommerce/canvas-demo.json`. Non-ecommerce datasets start with empty canvas or generate demo items via LLM at dataset upload time.

### 3.8 Board Store — Demo Board Name

**File:** `src/lib/board-store.ts:32-44`

**Current:** Demo board name "Growth Overview" and description "Understand your product's growth, engagement, and retention at a glance"

**Fix:** Low priority — text is generic enough. Could read from dataset config if desired.

---

## Phase 4: Prompts & Agent Definitions

**Priority:** MEDIUM-HIGH — affects LLM quality, can cause wrong SQL and misleading actions

### 4.1 `playbook-executor.ts` — ECOMMERCE_SYSTEM_CONTEXT (CRITICAL)

**File:** `src/lib/playbook-executor.ts:3, 388, 517, 559`

**Current:** Imports `ECOMMERCE_SYSTEM_CONTEXT` from `schema.ts` and uses it as the LLM system prompt in 3 places:
- Line 388: Playbook initialization prompt — tells LLM "You are ecommerce analytics assistant" even when running a quickhelp playbook
- Line 517: Scoring engine prompt — scores playbook results with ecommerce persona
- Line 559: Summary generation prompt — summarizes with ecommerce context

**Impact:** Every playbook execution on any dataset uses the ecommerce persona ("eCommerce analytics assistant, analyzing data for a large multi-category online store"). The LLM frames all playbook insights in ecommerce terms regardless of actual dataset.

**Fix:** `playbook-executor.ts` needs a `datasetId` parameter. Replace `ECOMMERCE_SYSTEM_CONTEXT` with `getSystemContext(datasetId)` in all 3 call sites. The datasetId should flow from the API route caller.

### 4.2 `actions.ts` — Two Competing Versions, Both Ecommerce

There are **two** action recommendation prompts:

**File 1:** `src/lib/prompts/actions.ts` (69 lines) — the "store management" version
- Line 4: "analytics and **store management** platform"
- Line 8: "map analysis insights to the MOST RELEVANT **store SKU**"
- Lines 10-14: Entirely about offers, pricing, discounts, revenue optimization
- Line 28: "If analysis shows 20% price sensitivity, use ~20%"
- Offer preview JSON schema assumes SKU IDs, discount percentages, audience targeting
- Only useful for ecommerce/retail datasets

**File 2:** `src/lib/action-recommender.ts:16-39` — the "simplified" version
- Line 16: Just "analytics platform" (more generic)
- Lines 22-23: `create-segment` with `pushTo: "clevertap"/"firebase"` (mobile gaming assumption)
- Line 23: `view-in-store` action type (ecommerce assumption)
- Line 36: Example follow-up "How does weekend vs weekday revenue compare?" (ecommerce-biased)

**Impact:** Both versions assume the dataset has products/SKUs and revenue-based actions. A quickhelp (food delivery) dataset would get told to "create offers for store SKUs" or "push segment to CleverTap."

**Fix:**
1. Consolidate into one prompt in `src/lib/prompts/actions.ts`
2. Make it dataset-aware: accept `DatasetConfig` and generate action types based on domain. E.g.:
   - Ecommerce → `create-offer`, `view-in-store`
   - Food delivery → `create-campaign`, `view-partner-dashboard`
   - SaaS → `create-feature-flag`, `view-cohort`
3. Remove hardcoded action examples; inject from dataset config

### 4.3 Classification Prompt — Ecommerce-Biased Examples

**File:** `src/lib/prompts/classify.ts:11-47`

**Current examples (lines 39-44):**
- `"how is DAU trending?"` → references `m-dau` metric ID (ecommerce-specific)
- `"revenue by category"` → ecommerce dimension
- `"show me users who spent over $100"` → ecommerce spending

**Why it matters:** While classification categories (`analytics`/`direct`/`action`) are universal, the examples bias the LLM. On a quickhelp dataset, "how are bookings trending?" could get misclassified because the examples only show ecommerce patterns.

**Fix:**
- Keep the classifier structure (it's sound)
- Replace examples with domain-neutral ones OR inject 2-3 examples from `DatasetConfig.suggestedPrompts`
- Remove the hardcoded `m-dau` metricId — instead reference "the relevant metric" generically

### 4.4 Forecast Routes — Missing datasetId in Schema Context (2 files)

**File 1:** `src/app/api/forecast/generate-sql/route.ts:14`
```typescript
const schema = getSchemaContext(); // ← no datasetId!
```

**File 2:** `src/app/api/forecast/seed/route.ts:73`
```typescript
const schema = getSchemaContext(); // ← no datasetId!
```

Both files also have an `llmFixSQL()` function (seed route, line 73) that calls `getSchemaContext()` without datasetId.

**Impact:** Forecast SQL generation always uses the ecommerce schema, even when the user is on the quickhelp dataset. Generated SQL will reference `events`, `daily_metrics`, `event_type = 'purchase'` etc. — all wrong for quickhelp.

**Fix:** Read `x-dataset-id` from request headers, pass to `getSchemaContext(datasetId)` in all call sites.

### 4.5 `dataset-enrichment.ts` — Ecommerce Defaults in Agent Examples

**File:** `src/lib/prompts/dataset-enrichment.ts:108-118`

The `buildPromptGenerationInput()` prompt includes hardcoded agent query examples:
```typescript
"agents": [
  {
    "id": "rev-opt",
    "queries": [
      { "description": "Revenue by category breakdown", "hint": "SUM(price) GROUP BY category" },
      { "description": "Conversion funnel: view to cart to purchase", ... },
      ...
    ]
  }
]
```

**Why it matters:** These examples in the prompt guide the LLM when generating agent configurations for **new** datasets. The ecommerce-biased examples (SUM(price), event_type='purchase', product_id) cause the LLM to generate ecommerce-style agents even for non-ecommerce datasets.

**Fix:** Make the examples domain-neutral or include multiple domain examples (which the `suggestedPrompts` field at line 133-139 already partially does — it shows food delivery, ecommerce, and lending examples). The `agents` example block should follow suit.

### 4.6 `analyze.ts` — Well-Structured (Mostly Safe)

**Files:** `src/lib/prompts/analyze.ts`

**Status:** This prompt file is **well-designed for dataset consistency**:
- `getAgentSummaryTemplate()` accepts `DatasetConfig` and uses `ds.label`, `ds.reportMeta.dbName`, `ds.primaryTable` — all dynamic
- `getCritiqueSummaryTemplate()` accepts `DatasetConfig` — dynamic
- `getReportGenerationTemplate()` accepts `DatasetConfig` — dynamic
- `getQuickResponseTemplate()` accepts `DatasetConfig` — dynamic

**One issue (line 203):** Citation example uses `[rev-opt:Q1]` and `[daily-metrics:Q2]` — these are ecommerce agent IDs. Not harmful (the LLM adapts), but could be made generic.

### 4.7 `schema-generic.ts` — Well-Structured (Safe)

**File:** `src/lib/prompts/schema-generic.ts`

**Status:** This is the generic fallback prompt builder. Properly parameterized:
- `buildGenericSystemContext()` — uses `label` and `schemaContext` params
- `buildEnrichedSystemContext()` — uses `SchemaMap.domainPersona`, `domain`, `domainFocus`
- `buildGenericQueryDescriptions()` — agent descriptions are deliberately vague ("Top-level breakdown", "Category/segment analysis")
- `buildGenericMultiAgentPrompt()` — uses `primaryTable` param

**No issues.** This is the model for how all prompts should work.

### 4.8 Agent Names — Semi-Generic but Duplicated

**Files:** `src/lib/chat-data.ts:15-22`, `src/lib/conversation-data.ts:6-13`, `src/hooks/use-classify.ts:66-96`

**Current:** 6 hardcoded agents defined in 3 separate locations:
- `rev-opt` → "Revenue Optimization Agent" (ecommerce-biased name)
- `geographic` → "Geographic Agent" (ecommerce has no geo data — this agent actually does category analysis)

`DatasetConfig.agents` already exists with per-dataset agent definitions. The display metadata should come from there.

**Fix:**
1. Single source of truth — one function that maps agent IDs to display metadata
2. Read from `DatasetConfig.agents` which has dataset-specific agent names and descriptions
3. Delete the 3 duplicate `AGENT_DISPLAY` constants

### 4.9 `knowledge.ts` and `connectors.ts` — Safe

**File:** `src/lib/prompts/knowledge.ts` — Generic knowledge parsing prompt. No dataset assumptions.
**File:** `src/lib/prompts/connectors.ts` — Generic connector mapping prompt. No dataset assumptions.

### 4.10 `metrics.ts` — Safe

**File:** `src/lib/prompts/metrics.ts` — Uses `SchemaMap` with `domain`, `domainHints`, `currency`. Properly parameterized.

### 4.11 `sql.ts` — Safe

**File:** `src/lib/prompts/sql.ts` — `buildTextToSqlPrompt(datasetId)` and `buildSegmentSqlPrompt(datasetId)` both properly accept and use `datasetId`. Schema, date range, domain hints all dynamic.

---

## Phase 5: Structural Cleanup

**Priority:** LOW — correctness, not visibility

### 5.1 Dataset Config Completeness Validation

Add a startup validation that checks every registered dataset has required fields populated:
- `suggestedPrompts` (6 items)
- `welcomeSubtitle`
- `agents` array
- `domain`, `domainPersona`, `domainFocus`
- `currency` (if applicable)

Log warnings for missing fields so new datasets don't silently degrade.

### 5.2 Remove Dead Exports

- `ECOMMERCE_SYSTEM_CONTEXT` from `schema.ts` (Phase 1.3)
- Any `PRESEEDED_*` exports that become JSON files (Phase 2)

### 5.3 Entity Registry — Dataset Filtering

**File:** `src/lib/entity-registry.ts`

`buildEntityCatalog()` merges ALL stores (metrics, knowledge, playbooks, scouts, catalog tables, decks, boards) into the `@` mention picker **without any dataset filtering**. This means the `@` picker in chat shows ecommerce metrics and playbooks even when the user is on a different dataset.

**Fix:** Pass `datasetId` to `buildEntityCatalog()` and filter each source:
- `getAllMetrics(datasetId)` — only metrics for active dataset
- `getAllEntries(datasetId)` — only knowledge for active dataset
- `getAllPlaybookSummariesMerged(datasetId)` — only playbooks for active dataset
- `getAllCatalogTables(datasetId)` — only tables for active dataset
- Boards/decks already have `datasetId` field — filter on it

### 5.4 Conversation Store — Dataset Scoping

**File:** `src/lib/conversation-store.ts:108-117`

`getConversationSummaries(filterDatasetId?)` supports filtering, but preseeded conversations lack `datasetId` field. Ensure all preseeded conversations are tagged with their dataset.

### 5.5 Mock Segment SQL Validity Bug

**File:** `src/components/segments/mock-segments.ts`

Independent of dataset consistency: mock segment SQL references `device_type` column that **doesn't exist** in the ecommerce `events` table. This is a data quality bug — executing any mock segment SQL will fail even on ecommerce.

**Fix:** Either fix the SQL to use valid columns, or remove mock segments entirely (recommended — they should be generated per-dataset).

### 5.6 Stores Without Dataset Isolation

These in-memory stores load all preseeded data into a global `Map` with no dataset parameter:

| Store | Function | Issue |
|-------|----------|-------|
| `metric-store.ts` | `getAllMetrics()` | Returns all 22 ecommerce metrics for any dataset |
| `playbook-store.ts` | `getAllPlaybookSummariesMerged()` | Merges ecommerce templates always |
| `knowledge-store.ts` | `getAllEntries()` | Returns ecommerce knowledge for any dataset |
| `catalog-store.ts` | `getAllCatalogTables()` | Returns ecommerce schema for any dataset |

**Fix:** Add optional `datasetId` parameter to all `getAll*()` functions. Filter preseeded data by dataset before returning.

---

## Execution Order

```
Phase 1 (Core Infra)     ██████████  ~2 hours  — mechanical, unblocks everything
Phase 3 (UI Strings)     ██████████  ~2 hours  — visible user impact, quick wins
Phase 2 (Seed Data)      ████████████████████  ~4 hours  — largest phase, JSON migrations
Phase 4 (Prompts/Agents) ██████████  ~2 hours  — LLM quality improvements
Phase 5 (Cleanup)        █████       ~1 hour   — polish
```

**Total estimated scope:** ~40-50 files touched, 5 phases.

---

## Files Inventory (Complete)

### Files that hardcode `"ecommerce"` (Phase 1.1)
1. `src/lib/api-client.ts`
2. `src/lib/dataset-context.tsx`
3. `src/lib/schema.ts`
4. `src/app/api/classify/route.ts`
5. `src/app/api/metrics/route.ts`
6. `src/app/api/board-generate/route.ts`
7. `src/app/segments/page.tsx`
8. `src/app/segments/[id]/page.tsx`
9. `src/components/sidebar-context.tsx`
10. `src/components/sidebar/panels.tsx`
11. `src/components/chat/chat-input.tsx`
12. `src/components/chat/research-report.tsx`
13. `src/components/metric/metric-detail-panel.tsx`

### Files with hardcoded ecommerce content (Phase 2 + 3)
14. `src/lib/chat-data.ts` — preloaded conversations
15. `src/lib/conversation-data.ts` — preloaded conversations (duplicate)
16. `src/lib/metric-data.ts` — 22 ecommerce metrics
17. `src/lib/forecast-data.ts` — 2019 revenue data
18. `src/lib/playbook-data.ts` — ecommerce playbook templates
19. `src/lib/knowledge-data.ts` — ecommerce knowledge entries
20. `src/lib/catalog-data.ts` — ecommerce column schema
21. `src/lib/store-data.ts` — mock SKUs
22. `src/lib/canvas-store.ts` — demo canvas items
23. `src/lib/board-store.ts` — demo board
24. `src/components/segments/mock-segments.ts` — mock segments
25. `src/components/topbar.tsx` — "eCommerce Store" label
26. `src/components/chat/research-report.tsx` — ecommerce report text
27. `src/components/chat/task-panel.tsx` — ecommerce task text
28. `src/components/canvas/drilldown-popover.tsx` — ₹ currency
29. `src/components/canvas/card-renderers/segment-renderer.tsx` — "users" label
30. `src/components/metric/metric-detail-panel.tsx` — tables/dimensions

### Prompt files with ecommerce context leak (Phase 4)
31. `src/lib/playbook-executor.ts` — **CRITICAL**: imports `ECOMMERCE_SYSTEM_CONTEXT`, uses it in 3 LLM calls (init, scoring, summary). Every playbook on every dataset gets ecommerce persona.
32. `src/lib/prompts/actions.ts` — entire prompt assumes store SKUs, offers, discounts, pricing
33. `src/lib/action-recommender.ts` — duplicate action prompt with CleverTap/Firebase push assumptions
34. `src/lib/prompts/classify.ts` — examples reference ecommerce metric IDs and dimensions
35. `src/lib/prompts/dataset-enrichment.ts:108-118` — agent example queries assume ecommerce columns (SUM(price), event_type='purchase')
36. `src/hooks/use-classify.ts` — AGENT_DISPLAY + AGENT_FRIENDLY_NAMES hardcoded in 3 locations

### Prompt files that are SAFE (properly parameterized)
- `src/lib/prompts/analyze.ts` — accepts `DatasetConfig`, uses `ds.label`, `ds.reportMeta`, `ds.primaryTable`
- `src/lib/prompts/sql.ts` — accepts `datasetId`, reads schema dynamically
- `src/lib/prompts/metrics.ts` — accepts `SchemaMap` with domain/hints
- `src/lib/prompts/schema-generic.ts` — fully parameterized generic fallbacks
- `src/lib/prompts/knowledge.ts` — domain-neutral parsing prompt
- `src/lib/prompts/connectors.ts` — domain-neutral connector mapping

### API routes missing dataset header (Phase 1.2)
37. `src/app/api/events/route.ts`
38. `src/app/api/ingest/route.ts`
39. `src/app/api/integrations/route.ts`
40. `src/app/api/forecast/generate-sql/route.ts` — calls `getSchemaContext()` without datasetId
41. `src/app/api/forecast/seed/route.ts` — calls `getSchemaContext()` without datasetId (in both main handler and `llmFixSQL()`)

---

## Validation Criteria

After all phases, these must pass:

1. **String audit:** `grep -r '"ecommerce"' src/` returns 0 results outside of `src/lib/datasets/ecommerce.ts` and `DEFAULT_DATASET` definition
2. **Dataset switch test:** Switch to a non-ecommerce dataset → no ecommerce text visible in sidebar, topbar, chat, metrics, forecasts, playbooks, knowledge, segments, canvas, or reports
3. **New dataset test:** Upload a new dataset → all pages show either dataset-appropriate content or clean empty states
4. **Ecommerce regression:** Switch back to ecommerce → all existing functionality still works (metrics, forecasts, playbooks, preloaded conversations)
5. **Currency test:** Non-USD datasets show correct currency symbol
6. **Agent test:** Deep research mode shows dataset-appropriate agent names and descriptions
7. **Playbook test:** Run a playbook on quickhelp dataset → LLM persona says "food delivery" not "eCommerce analytics assistant"
8. **Forecast SQL test:** Generate forecast SQL on quickhelp → schema references `bookings` table, not `events`/`daily_metrics`
9. **Action recommendations test:** After a quickhelp analysis → no "create offer" / "view in store" actions; should suggest domain-appropriate actions
