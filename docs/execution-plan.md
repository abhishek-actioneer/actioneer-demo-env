# Baby Sentinel Stabilisation — Execution Plan

**Date:** 2026-03-31
**Goal:** Make the product stable, persistent, and fully functional for uploaded datasets — no feature gaps, no data loss, no silent failures in front of clients.
**Estimated effort:** ~6.5 days

---

## System Architecture (Current State)

### Stack

Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · shadcn/ui · DuckDB (node-api) · Google Gemini (`@google/genai`) · Clerk Auth · SQLite (better-sqlite3) · localStorage (hybrid cache)

### Chat & Analytics Flow

```
User message
    ↓
POST /api/classify (Gemini — routes to analytics | direct | action | metric_update)
    ↓
┌─────────────────────────────────────────────────┐
│ ANALYTICS PATH                                  │
│                                                 │
│ POST /api/analyze (SSE stream)                  │
│   ├─ Phase 1: SQL Generation                    │
│   │   ├─ Quick mode: 1 query (rev-opt agent)    │
│   │   └─ Deep mode: 6-9 agents × 2-3 queries   │
│   │       each, generated in parallel            │
│   │       (Promise.allSettled)                   │
│   │                                             │
│   ├─ Phase 2: DuckDB Execution                  │
│   │   ├─ SELECT-only validation                 │
│   │   ├─ Per-dataset queue (prevents malloc)    │
│   │   ├─ Auto-LIMIT 500 if none present         │
│   │   └─ OOM retry with memory-efficient SQL    │
│   │                                             │
│   ├─ Phase 2.5 (deep only): Agent Summaries     │
│   │   ├─ Per-agent Gemini summary (concurrent)  │
│   │   └─ Critique agent validates findings      │
│   │                                             │
│   └─ Phase 3: Response Synthesis                │
│       ├─ Quick: streaming text                  │
│       └─ Deep: markdown report with             │
│           [agent-id:Q#] citations               │
│                                                 │
│ SSE events: phase → sql → query_result →        │
│   summary → text → recommendations → done       │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│ DIRECT PATH                                     │
│ POST /api/chat — streaming text, no SQL         │
└─────────────────────────────────────────────────┘
```

**Key LLM files:**
- `src/lib/llm.ts` — Gemini/Cerebras adapter (generateText, generateTextStream)
- `src/lib/sql-generator.ts` — Single + multi-agent SQL generation
- `src/lib/sql-executor.ts` — DuckDB execution, validation, error recovery
- `src/lib/schema.ts` — getSystemContext(datasetId) for LLM persona
- `src/app/api/analyze/route.ts` — Main SSE endpoint (~600 lines)
- `src/hooks/use-analytics.ts` — Client-side flow orchestration (~800 lines)

### Dataset System

**Two types of datasets:**

| Aspect | Sample (Static) | Uploaded (Dynamic) |
|--------|----------------|-------------------|
| Source | Hardcoded in `src/lib/datasets/*.ts` | User CSV/DuckDB in `/data/datasets/<id>/` |
| Registration | Imported in `index.ts` | Loaded by `dynamic-registry.ts` (filesystem scan) |
| Events | Hand-curated EventDefinition[] (3-30 per dataset) | **Never generated** |
| Agents | Hand-crafted with specific column refs | LLM-generated (generic hints) |
| Domain hints | 15+ rules with cross-column knowledge | 3-6 syntactic rules |
| Entity name | Hardcoded ("players", "borrowers") | **Never generated** |
| Metrics | Preseeded via `metric-data.ts` | Not auto-triggered on upload |
| Currency | Explicit ($, ₹) | LLM-detected or missing |
| Owner | None (shared demo) | Clerk userId via `ownerId` |

**Enrichment pipeline** (`schema-enricher.ts` — runs on upload):

```
Step 0: data-profiler.ts
  → Row counts, column stats, cardinality, sample values per table

Step 1: analyzeColumns() — Gemini
  → columns, domain, domainPersona, domainFocus, currency

Step 2: generatePrompts() — Gemini
  → agents (AgentSpec[]), domainHints, annotatedSchemaContext,
    suggestedPrompts, welcomeSubtitle

Step 3: generateMetricDefinitions() — Gemini (non-fatal)
  → MetricDefinition[] saved to metrics.json
```

**Missing from enrichment:** events, entityName, dateRange (partial), reportMeta. This is the root cause of 5 broken features.

### Persistence Architecture

**4 storage tiers:**

| Tier | Tech | Survives Refresh | Survives Deploy | Survives Cache Clear |
|------|------|:---:|:---:|:---:|
| In-memory | JS Maps/Sets | NO | NO | NO |
| localStorage | Browser (5MB) | YES | YES | NO |
| SQLite | better-sqlite3 (WAL) | YES | YES | YES |
| Filesystem | `/data/datasets/` | YES | DEPENDS on volume | YES |

**SQLite (sentinel-meta.sqlite) — Schema v1, 8 tables:**

| Table | Data | Server Repo |
|-------|------|-------------|
| conversations | Messages, tags, pending_actions, folder_id | Direct SQL in API routes |
| boards | Board metadata (name, view_mode, time_range) | board-repo.ts |
| board_cards | Card data as JSON (FK → boards, CASCADE) | board-repo.ts |
| board_sections | Section data | board-repo.ts |
| board_connections | Connection data | board-repo.ts |
| board_frames | Frame data | board-repo.ts |
| playbooks | Full playbook JSON, schema_version (V1/V2) | playbook-repo.ts |
| segments | SQL, user_count, push_status | segment-repo.ts |

**Hybrid persistence pattern** (conversations, boards, playbooks):
```
Init:  localStorage (fast render) → background server fetch → overwrite
Write: in-memory Map → debounced localStorage → debounced server API
Close: flush + sendBeacon fallback on beforeunload/visibilitychange
```

**What has NO server persistence:**

| Data | Storage | Lost When |
|------|---------|-----------|
| Conversation folders | localStorage only | Cache clear, device switch |
| Credits & transactions | localStorage only | Cache clear, device switch |
| Saved explorer charts | localStorage only | Cache clear, device switch |
| Forecast seed edits | In-memory only | Page refresh |

**DuckDB issue:** Uploaded CSVs use lazy views (`SELECT * FROM read_csv(...)`) — both CSV and .duckdb must exist. 3-10x slower than materialized tables.

---

## What's Broken (Ranked)

### Critical — Silently Wrong Data

| # | Issue | Root Cause | Impact |
|---|-------|-----------|--------|
| 1 | **LIMIT 500 on auto-generated segments** | `src/lib/prompts/segments.ts:46` forces `LIMIT 500`. Count query strips it via regex → card shows "12,847 users" but SQL returns 500. All downstream features (composition, overlap, users tab) operate on truncated set. | **Silently wrong data shown to clients** |

### Broken — Features Don't Work on Uploads

| # | Issue | Root Cause | Impact |
|---|-------|-----------|--------|
| 2 | **Explorer (Trends/Funnel/Retention) — all 3 tabs dead** | `DatasetConfig.events` never generated. EventPicker gets empty array. No events → no queries → no breakdowns. | Main interactive demo surface unusable |
| 3 | **Segment "Explore Events" panel** | Same — button opens empty panel | Dead button in segment workspace |
| 4 | **Store / Catalog page** | 100% hardcoded game IAP mock data | Shows gems/battle passes to fintech clients |
| 5 | **Scouts page** | 100% hardcoded domain reports | Shows "whale profiles" to any dataset |
| 6 | **Funnel/Retention save button** | Validation only checks Trends tab | Can save empty configs |

### Degraded — Works But Worse

| # | Issue | Root Cause |
|---|-------|-----------|
| 7 | Metrics page empty after upload | Upload route doesn't trigger metric generation |
| 8 | Currency shows ₹ on non-INR data | Fallback hardcoded in `chart-core.tsx` (₹ on tooltips, $ on Y-axis — inconsistent) and `dataset-context.tsx` |
| 9 | LLM persona quality | Enrichment failure → generic persona, swallowed with console.warn |
| 10 | Entity catalog / @ mentions | 0 entities on upload vs 20-30 on samples |
| 11 | Subagent task quality (deep research) | Generic hints vs column-specific hand-crafted hints |
| 12 | Suggested prompts | Generic fallback, no caching |
| 13 | Board generation | `datasetHints` never populated by callers |

### Persistence Gaps

| # | Issue | Impact |
|---|-------|--------|
| 14 | Folders localStorage-only | Lost on cache clear / device switch |
| 15 | Credits localStorage-only | Resets to seed (453 credits) |
| 16 | Saved charts localStorage-only | Lost on cache clear / device switch |
| 17 | Forecast seeds in-memory only | Lost on page refresh |
| 18 | localStorage quota (5MB) | Only board-store handles QuotaExceededError. All other stores silently fail. |
| 19 | Unbounded conversation messages | 500KB-3MB in localStorage |
| 20 | Unbounded playbook runHistory | 500KB-1.5MB in localStorage |
| 21 | DuckDB lazy CSV views | 3-10x slower, two files to persist |
| 22 | Railway ephemeral filesystem | Uploaded datasets lost on redeploy if volume misconfigured |

### No Recovery Path

| # | Issue | Impact |
|---|-------|--------|
| 23 | Enrichment is fire-and-forget | If Gemini flakes during upload, dataset permanently degraded. No retry, no re-enrich button. |

---

## Execution Plan

### Day 1 — Quick Wins: Stop Breaking in Front of Clients

All small, high-impact fixes. Clear the "embarrassing in demos" bugs.

#### 1a. Fix LIMIT 500 on auto-generated segments (30 min)

**File:** `src/lib/prompts/segments.ts`

Remove "Always LIMIT 500" from SQL rules (line 53) and example SQL template (line 46). The count query already strips LIMIT. Segments should select the full user set.

**Verification:** Generate segments on a dataset, confirm SQL has no LIMIT, confirm user count matches actual query result.

#### 1b. Hide Store and Scouts for uploaded datasets (1 hour)

**Files:** `src/components/sidebar.tsx`, `src/app/store/page.tsx`, `src/app/scouts/page.tsx`

For datasets where `dataset.isDynamic === true`:
- Hide nav items in sidebar, OR
- Show empty state: "This feature is available for sample datasets"

#### 1c. Fix currency default (30 min)

**Files:** `src/components/chart/chart-core.tsx`, `src/lib/dataset-context.tsx`

Current state: `₹` on tooltips (lines 68, 96), `$` on Y-axis (line 500) — inconsistent.

Fix: If currency is undefined, show no currency symbol. Never show a wrong one.

#### 1d. Auto-trigger metric generation on upload (1 hour)

**File:** `src/app/api/datasets/upload/route.ts`

The enrichment pipeline already has `generateMetricDefinitions()` as Step 3. The upload route calls `enrichDataset()` but doesn't trigger metric generation separately. Add the call after enrichment completes.

#### 1e. Fix funnel/retention save button validation (30 min)

**File:** `src/app/explore/page.tsx`

Current: `disabled={!trends.config.events.length && activeTab === "trends"}`

Fix: Add validation for all tabs:
```typescript
disabled={
  (activeTab === "trends" && !trends.config.events.length) ||
  (activeTab === "funnel" && funnel.config.steps.length < 2) ||
  (activeTab === "retention" && (!retention.config.startEventId || !retention.config.returnEventIds.length))
}
```

#### 1f. Add re-enrich API endpoint (1 hour)

**New file:** `src/app/api/datasets/[id]/re-enrich/route.ts`

If Gemini flakes during upload, the dataset is permanently degraded today. Add a POST endpoint that re-runs `enrichDataset()` for a given dataset ID. Wire a "Re-enrich" button in the dataset settings or an error state.

---

### Day 2 — Event Generator: Unlock Explorer for Uploads

The single biggest feature fix. Mechanical algorithm, no LLM needed.

#### 2a. Build event auto-generation from schema-map (1 day)

**New file:** `src/lib/datasets/event-generator.ts`
**Modified:** `src/lib/datasets/schema-enricher.ts`, `src/lib/datasets/dynamic-registry.ts`

**Algorithm:**

**Step 1 — Table-level events:** Every table becomes a base event.
```typescript
{ id: "orders", displayName: "Orders", table: "orders", properties: [...] }
```

**Step 2 — Event-type column detection:** Find VARCHAR columns named like `event_type`, `event_name`, `action`, `type`, `status` with cardinality between 3-50. For each distinct value:
```typescript
{ id: "orders_purchase", displayName: "Purchase", table: "orders",
  filterColumn: "event_type", filterValue: "purchase", properties: [...] }
```

**Step 3 — Properties:** String columns with low/medium cardinality (from schema-map) become `EventProperty` items for breakdown/filtering.

**Step 4 — Value columns:** Numeric columns (revenue, amount, price) become `valueColumn` for sum/average measures.

**Step 5 — Date column:** Use `dataset.dateField` as default, or detect first TIMESTAMP/DATE column per table.

**Storage:** Save to `/data/datasets/<id>/events.json`. Load in `dynamic-registry.ts`:
```typescript
if (existsSync(eventsPath)) {
  raw.events = JSON.parse(readFileSync(eventsPath, "utf-8"));
}
```

**Call site:** After enrichment completes in `schema-enricher.ts`, call event generator. No LLM call needed.

**Result:** Explorer, Funnel, Retention, and Segment Explore panel all work on uploaded datasets.

**Verification:** Upload a CSV, confirm events appear in Explorer EventPicker, build a Trends query, verify SQL executes correctly.

---

### Day 3 — DuckDB Import + localStorage Stability

#### 3a. Switch CSV uploads to DuckDB import (3 hours)

**File:** `src/app/api/datasets/upload/route.ts`

Change from lazy views to materialized import:
```sql
-- FROM (current):
CREATE OR REPLACE VIEW ${tableName} AS SELECT * FROM read_csv('${filePath}')

-- TO (materialized):
CREATE TABLE IF NOT EXISTS ${tableName} AS SELECT * FROM read_csv('${filePath}', AUTO_DETECT=TRUE)
CHECKPOINT
-- then delete the CSV
```

**Benefits:**
- Single `.duckdb` file per dataset (one thing to persist)
- 3-10x faster queries (columnar vs CSV scan)
- No parquet conversion needed
- Multi-CSV uploads = multiple tables in one `.duckdb`

Update `config.json`: `sourceFiles` becomes metadata-only.

#### 3b. Verify Railway volume covers /data/datasets/ (15 min)

Check Railway config. If `/data/datasets/` is empty after redeploy, adjust mount path.

#### 3c. Cap localStorage growth (1 hour)

**File:** `src/lib/conversation-store.ts`
- Cache only last 20 conversations in localStorage. Server has all — rest fetched on demand.

**File:** `src/lib/playbook-store.ts`
- Cap `runHistory` to last 50 entries before persisting to localStorage.

Both already have server backup, so localStorage is just a fast cache.

---

### Day 4 — Full Persistence: 4 New SQLite Tables + Hybrid Stores

#### 4a. Add 4 tables to SQLite (2 hours)

**File:** `src/lib/meta-db.ts`

Bump `CURRENT_SCHEMA_VERSION` from 1 to 2. Add migration:

```sql
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  dataset_id TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);

CREATE TABLE IF NOT EXISTS saved_charts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,     -- JSON: ExplorerConfig
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_charts_user_dataset ON saved_charts(user_id, dataset_id);

CREATE TABLE IF NOT EXISTS credits (
  org_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  transactions TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS forecast_seeds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  model_data TEXT NOT NULL,
  seed_data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forecast_user_dataset ON forecast_seeds(user_id, dataset_id);
```

#### 4b. Add repo files + API routes (3 hours)

Follow the `segment-repo.ts` pattern:

| New file | API route | Pattern |
|----------|-----------|---------|
| `src/lib/server/folder-repo.ts` | `GET/POST/DELETE /api/folders` | CRUD with userId |
| `src/lib/server/saved-chart-repo.ts` | `GET/POST/DELETE /api/saved-charts` | CRUD with userId + datasetId |
| `src/lib/server/credit-repo.ts` | `GET/PATCH /api/credits` | Read + update balance |
| `src/lib/server/forecast-repo.ts` | `GET/PUT /api/forecast/seeds` | Read + upsert |

#### 4c. Convert 4 client stores to hybrid persistence (4 hours)

Apply the same pattern conversations/boards/playbooks already use:

```
Init:  localStorage (fast render) → background server fetch → overwrite
Write: in-memory Map → debounced localStorage → debounced server API
Close: flush + sendBeacon fallback on beforeunload/visibilitychange
```

Apply to: `folder-store.ts`, `saved-chart-store.ts`, `credit-store.ts`, `forecast-store.ts`

**After Day 4, persistence matrix:**

| Data | Refresh | Cache Clear | Device Switch | Redeploy |
|------|:---:|:---:|:---:|:---:|
| Conversations | YES | YES | YES | YES |
| Boards + cards | YES | YES | YES | YES |
| Playbooks | YES | YES | YES | YES |
| Segments | YES | YES | YES | YES |
| Folders | YES | **YES** | **YES** | YES |
| Credits | YES | **YES** | **YES** | YES |
| Saved charts | YES | **YES** | **YES** | YES |
| Forecast seeds | **YES** | **YES** | **YES** | YES |

(Bold = newly persistent)

---

### Day 5-6 — Deep Research Quality Parity

The quality gap: sample datasets have 15+ hand-crafted domain hints with cross-column knowledge. Uploaded datasets get 3-6 syntactic rules from one LLM pass. Fix: better profiling + two-pass enrichment.

#### 5a. Cross-column profiling queries (3 hours)

**New file:** `src/lib/datasets/data-profiler.ts` (extend existing)

Add SQL profiling queries that run against actual data before the LLM enrichment:

```sql
-- Table size warnings
SELECT COUNT(*) FROM each_table

-- Date range detection
SELECT MIN(date_col)::VARCHAR, MAX(date_col)::VARCHAR FROM primary_table

-- Cross-column correlations (impossible filter combos)
SELECT DISTINCT col_a, col_b FROM table
WHERE col_b IN (top_5_values) LIMIT 100

-- Value distribution skew
SELECT col, COUNT(*) as cnt FROM table
GROUP BY col ORDER BY cnt DESC LIMIT 20

-- Column co-occurrence nullity
SELECT col_a IS NULL AND col_b IS NOT NULL as pattern, COUNT(*) FROM table GROUP BY 1
```

**Cost:** 5-10 SQL queries per table. DuckDB executes each in <1s on imported data. Total: 5-30 seconds.

#### 5b. Two-pass enrichment (2 hours)

**File:** `src/lib/datasets/schema-enricher.ts`

Add a second LLM pass after profiling:

```
Pass 1 (existing): Profile → analyzeColumns → generatePrompts

Pass 2 (new): Run profiling queries from 5a → feed Pass 1 results +
profiling results to Gemini with refined prompt:

  "You previously analyzed this dataset as {domain}.
  Here are runtime profiling results:
  - Table sizes: orders (2.3M rows), products (500 rows)
  - Date range: 2024-03-01 to 2025-01-15
  - Cross-column: [channel='apple_search_ads' → platform='IOS' only]
  - Skewed: [status: 95% 'active'] [country: 60% 'US']
  - NULL patterns: [result IS NULL when level_type IN ('FreeDrive')]

  Generate IMPROVED domainHints with table size warnings, date range
  constraints, impossible filter combos, skew warnings, NULL patterns."
```

**Cost:** One additional LLM call (~2s) + profiling queries. Total enrichment: ~60s → ~90s.

#### 5c. Better agent query prompts + validation (2 hours)

**File:** `src/lib/prompts/dataset-enrichment.ts`

Current LLM output: `{ hint: "GROUP BY key dimensions" }` (generic)
Target: `{ hint: "GROUP BY channel, platform — from orders table" }` (specific)

Fix the prompt to demand column references:
```
MANDATORY: Every hint MUST reference actual column names from the schema.
```

Add validation in `generatePrompts()`: reject any agent query whose hint doesn't contain at least one column name from the schema. Re-prompt once if validation fails.

#### 5d. Example queries in schemaContext (1 hour)

**File:** `src/lib/prompts/dataset-enrichment.ts`

Add to annotatedSchemaContext: generate 2-3 example SQL queries per table so the downstream SQL generator sees correct patterns:

```
TABLE: orders (2.3M rows)
  - order_id     VARCHAR  -- unique order identifier
  - total_amount DOUBLE   -- order total in USD

EXAMPLE QUERIES:
  Daily revenue: SELECT order_date, SUM(total_amount) FROM orders WHERE status='completed' GROUP BY 1
```

#### Quality comparison after Phase 3

| Aspect | Before (3-6 rules) | After (10-15 rules) | Hand-crafted (15+) |
|--------|:---:|:---:|:---:|
| Column quoting/parsing | YES | YES | YES |
| Date range constraints | NO | YES | YES |
| Table size warnings | NO | YES | YES |
| Impossible filter combos | NO | YES | YES |
| Value distribution skew | NO | YES | YES |
| Business domain rules | NO | NO | YES |

The remaining ~5-10% gap is business-domain knowledge not in the data. Doesn't matter for demos.

---

### Day 6.5 — Polish + Validation

#### 6a. Surface enrichment status in UI (2 hours)

Users currently have zero visibility into enrichment progress or failure. Add:
- Progress indicator during upload enrichment
- Error state if enrichment fails (with "Retry" button wired to re-enrich endpoint from 1f)

#### 6b. LLM polish for event display names (1 hour)

Event generator produces IDs like `orders_purchase`. Add a lightweight Gemini call to humanize: "Successful Purchase", "New Order Placed".

#### 6c. Pass datasetHints to board generation (30 min)

**Files:** `src/app/api/board-generate/route.ts`, `src/app/api/board-from-research/route.ts`

`ChartContext.datasetHints` is defined but never populated. Pass currency, entityName from dataset config.

#### 6d. Validate userIdField/dateField detection (2 hours)

Add a confirmation step during upload where user can correct auto-detected columns before enrichment runs.

#### 6e. Test across uploaded datasets (2 hours)

Upload 3-4 CSVs (ecommerce, fintech, gaming, SaaS) and verify:
- Events appear in Explorer, queries execute
- Domain hints include date range, table sizes, impossible combos
- Agent queries reference actual column names
- Deep research produces focused SQL
- All data survives refresh, cache clear, device switch
- Currency correct or absent (never wrong)
- Segments show correct user counts (no LIMIT 500)

---

## Files Changed (Summary)

### Day 1 — Quick Wins
| File | Change |
|------|--------|
| `src/lib/prompts/segments.ts` | Remove LIMIT 500 |
| `src/components/sidebar.tsx` | Hide Store/Scouts for dynamic datasets |
| `src/app/store/page.tsx` | Empty state for dynamic datasets |
| `src/app/scouts/page.tsx` | Empty state for dynamic datasets |
| `src/components/chart/chart-core.tsx` | Fix currency fallback (no symbol if undefined) |
| `src/lib/dataset-context.tsx` | Fix currency fallback |
| `src/app/api/datasets/upload/route.ts` | Auto-trigger metric generation |
| `src/app/explore/page.tsx` | Fix save button validation for all tabs |
| `src/app/api/datasets/[id]/re-enrich/route.ts` | NEW: re-enrich endpoint |

### Day 2 — Event Generator
| File | Change |
|------|--------|
| `src/lib/datasets/event-generator.ts` | NEW: mechanical event generation from schema-map |
| `src/lib/datasets/schema-enricher.ts` | Call event generator after enrichment |
| `src/lib/datasets/dynamic-registry.ts` | Load events.json |

### Day 3 — DuckDB + localStorage
| File | Change |
|------|--------|
| `src/app/api/datasets/upload/route.ts` | CREATE TABLE instead of VIEW, delete CSVs, CHECKPOINT |
| `src/lib/conversation-store.ts` | Cap localStorage to 20 conversations |
| `src/lib/playbook-store.ts` | Cap runHistory to 50 entries |

### Day 4 — Full Persistence
| File | Change |
|------|--------|
| `src/lib/meta-db.ts` | Add 4 tables, bump schema to v2 |
| `src/lib/server/folder-repo.ts` | NEW: CRUD |
| `src/lib/server/saved-chart-repo.ts` | NEW: CRUD |
| `src/lib/server/credit-repo.ts` | NEW: CRUD |
| `src/lib/server/forecast-repo.ts` | NEW: CRUD |
| `src/app/api/folders/route.ts` | NEW: API route |
| `src/app/api/saved-charts/route.ts` | NEW: API route |
| `src/app/api/credits/route.ts` | NEW: API route |
| `src/app/api/forecast/seeds/route.ts` | NEW: API route |
| `src/lib/folder-store.ts` | Hybrid server sync |
| `src/lib/saved-chart-store.ts` | Hybrid server sync |
| `src/lib/credit-store.ts` | Hybrid server sync |
| `src/lib/forecast-store.ts` | Hybrid server sync + localStorage |

### Day 5-6 — Deep Research Quality
| File | Change |
|------|--------|
| `src/lib/datasets/data-profiler.ts` | Cross-column profiling queries |
| `src/lib/datasets/schema-enricher.ts` | Two-pass enrichment |
| `src/lib/prompts/dataset-enrichment.ts` | Column-ref validation, example queries in schemaContext |

### Day 6.5 — Polish
| File | Change |
|------|--------|
| Upload/onboarding UI components | Enrichment status indicator |
| `src/lib/datasets/event-generator.ts` | LLM polish for display names |
| `src/app/api/board-generate/route.ts` | Pass datasetHints |
| `src/app/api/board-from-research/route.ts` | Pass datasetHints |
| Upload UI components | userIdField/dateField confirmation step |

---

## Stability Scorecard

| Dimension | Now | After Day 1-2 | After Day 3-4 | After Day 5-6.5 |
|-----------|:---:|:---:|:---:|:---:|
| Upload feature completeness | 3 | 8 | 8 | 9 |
| Sample dataset experience | 9 | 9 | 9 | 9 |
| Data durability (refresh) | 6 | 6 | 9 | 9 |
| Data durability (redeploy) | 5 | 5 | 9 | 9 |
| Data durability (cache clear) | 4 | 4 | 9 | 9 |
| Query correctness | 6 | 9 | 9 | 9 |
| Query performance (uploads) | 5 | 5 | 8 | 8 |
| Deep research quality (uploads) | 4 | 4 | 4 | 8 |
| Error visibility | 2 | 3 | 3 | 6 |
| **Overall** | **~4.5** | **~6** | **~7.5** | **~8.5** |
