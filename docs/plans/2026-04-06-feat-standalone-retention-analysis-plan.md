---
title: "feat: Standalone Retention Analysis Feature"
type: feat
status: active
date: 2026-04-06
origin: memory/retention-research-2026-04-06.md
---

# Standalone Retention Analysis Feature

## Overview

Promote retention analysis from an ephemeral tab inside `/explore` into a first-class standalone feature — with persistence, pages, sidebar nav, workspace, and chat integration — following the exact pattern established by Funnels.

The existing retention infrastructure (SQL compiler, API route, hook, config panel, chart with cohort triangle) is solid and reusable. The work spans: plumbing (persistence, CRUD, pages), analytical views (Change Over Time, enhanced cohort table), actionability (segment creation from churned users), and polish (auto-generation, chat integration).

**Target:** Cover P0 retention requirements for PMs, growth teams, and analysts. Existing explorer tab ≈ 30% of Amplitude. Target after this plan: ~70%.

## Problem Statement / Motivation

The retention tab inside `/explore` is ephemeral — configs are lost on refresh, there's no way to save or revisit an analysis, and no path from retention insight to action.

Three personas need different things:

- **PMs** can't monitor retention trends over time (no Change Over Time view), can't track how D7 retention improves across releases
- **Growth teams** can't act on churn — no way to create a segment from "users who churned after Day 7" and push them to a re-engagement campaign
- **Analysts** can't compare retention across breakdowns with proper visualization, can't drill into specific cohort cells

## Proposed Solution

Build in 4 phases. Phases 1-3 cover all P0 requirements. Phase 4 is differentiation.

1. **Foundation** — Persistence, CRUD, pages, sidebar nav
2. **Analytical Views** — Change Over Time, enhanced cohort table, multi-return-event visualization
3. **Actionability** — User drill-down per cohort/bucket, create segment from churned
4. **Polish** — Chat-native creation, LLM starter retentions, auto-generation, entity registry

## Technical Approach

### Architecture

```
Sidebar Nav Group
  └─ /retentions (list page)
       └─ /retentions/[id] (detail workspace)
            ├─ Overview tab (retention curve + cohort triangle + stats)
            ├─ Change Over Time tab (selected bucket retention across cohorts)
            └─ Users tab (per-cohort/bucket drill-down → Create Segment)

Persistence: SQLite (meta-db.ts) → retention-repo.ts → /api/retentions CRUD
Execution:   /api/explorer/retention (existing, unchanged)
SQL Engine:  retention-sql.ts (existing, unchanged)
             retention-users-sql.ts (new: per-cohort/bucket user lists)
             retention-trend-sql.ts (new: Change Over Time data)
New APIs:    /api/retentions CRUD
             /api/retentions/[id]/trend
             /api/retentions/[id]/users
             /api/retentions/[id]/segment-sql
             /api/retentions/generate-starters
             /api/retentions/generate-config
```

### Data Model

```sql
-- Migration version 4 in meta-db.ts
CREATE TABLE IF NOT EXISTS retentions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  dataset_id TEXT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  config TEXT NOT NULL,          -- JSON blob: RetentionConfig
  source TEXT DEFAULT 'manual',  -- 'manual' | 'chat' | 'auto'
  d7_retention REAL,             -- cached Day 7 retention % (at-a-glance metric)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retentions_user_dataset
  ON retentions(user_id, dataset_id);
```

**Why D7 retention as the cached metric:** Day 7 is the industry-standard "north star" retention metric. It's the default bucket that matters for list view at-a-glance. Computed on save, re-computed on GET single.

### Type Extensions

```typescript
// In src/lib/retention-types.ts — extend existing file

// --- Saved retention wrapper ---
interface SavedRetention {
  id: string;
  name: string;
  description: string;
  config: RetentionConfig;
  source: "manual" | "chat" | "auto";
  d7Retention: number | null;  // cached Day 7 retention %
  datasetId: string;
  createdAt: string;
  updatedAt: string;
}

interface SavedRetentionDisplay extends SavedRetention {
  startEventLabel: string;
  returnEventLabels: string[];
}
```

---

## Implementation Phases

### Phase 1: Foundation (Persistence + Pages)

**Goal:** Users can create, save, list, view, edit, and delete retention analyses. Retentions appear in sidebar.

#### 1.1 SQLite Table + Repo

**Files to modify:**
- `src/lib/meta-db.ts` — bump `CURRENT_SCHEMA_VERSION` to 4, add migration block for `retentions` table, add 4 prepared statements

**Files to create:**
- `src/lib/server/retention-repo.ts` — follow `funnel-repo.ts` pattern exactly:
  - `RetentionRow` type (snake_case DB columns)
  - `rowToRetention()` mapper
  - `listRetentions(userId, datasetId): SavedRetention[]`
  - `getRetention(userId, id): SavedRetention | null`
  - `upsertRetention(userId, retention): void`
  - `deleteRetention(userId, id): boolean`

**Acceptance criteria:**
- [ ] `retentions` table created on app start (migration from v3→v4)
- [ ] CRUD operations work via repo functions
- [ ] Existing tables unaffected by migration

#### 1.2 CRUD API Routes

**Files to create:**
- `src/app/api/retentions/route.ts` — GET (list) + POST (create)
- `src/app/api/retentions/[id]/route.ts` — GET + PATCH + DELETE

**Pattern (from funnel API routes):**
- All handlers: `auth()` from Clerk, 401 if no userId
- GET list: read `datasetId` from query params or `x-dataset-id` header, call `listRetentions(userId, datasetId)`
- POST create: validate body (name required, config with startEventId + returnEventIds), generate ID, execute retention SQL for `d7Retention` snapshot, store via `upsertRetention`, return 201
- GET single: `getRetention`, 404 if missing. Re-execute SQL for fresh D7 retention rate.
- PATCH: merge fields (name, description, config), update `updatedAt`
- DELETE: `deleteRetention`, return `{ success: true }`

**Acceptance criteria:**
- [ ] POST creates retention with validated config
- [ ] GET list returns retentions filtered by dataset
- [ ] GET single returns retention with fresh D7 rate
- [ ] PATCH updates fields
- [ ] DELETE removes retention
- [ ] All routes require Clerk auth

#### 1.3 Feature Flag + Sidebar Nav

**Files to modify:**
- `src/lib/feature-flags.ts` — add `"retentions"` to `FeatureId` union
- `src/components/sidebar.tsx` — add `SidebarGroup` for Retentions (after Funnels), top 5 + "See all..."
- `src/components/sidebar-context.tsx` — add `retentions: SavedRetention[]`, `refreshRetentions()`

**Acceptance criteria:**
- [ ] Sidebar shows Retentions group with top 5 saved retentions
- [ ] Sidebar refreshes on dataset switch
- [ ] Feature flag gates all entry points

#### 1.4 List Page

**File:** `src/app/retentions/page.tsx`

- `<FeatureGate feature="retentions">`, page shell pattern
- Dual mode: list view + builder view (same as funnels)
- Table: Name | Mode | Start Event | Return Event | D7 Retention | Last Updated
- Events dependency guard (show info state if `dataset.events` empty)
- Empty state with "Create your first retention analysis" CTA

**Acceptance criteria:**
- [ ] List page renders saved retentions
- [ ] Search filters by name
- [ ] Events guard prevents creation when no events

#### 1.5 Detail Page + Workspace

**Files:** `src/app/retentions/[id]/page.tsx`, `src/components/retentions/retention-workspace.tsx`

**Workspace layout:**
```
┌─ Header ──────────────────────────────────────┐
│  ← Retentions   Onboarding Retention  [Delete]│
│  Return On or After · Daily · 30d window      │
├─ [Overview]  [Change Over Time]  [Users] ─────┤
│                                                │
│  ┌─ Config Panel (left) ──┐ ┌─ Content ──────┐│
│  │  Starting Event        │ │  Retention Curve││
│  │  Return Event(s)       │ │  Cohort Table   ││
│  │  Mode / Granularity    │ │                 ││
│  │  Breakdown             │ │                 ││
│  └────────────────────────┘ └─────────────────┘│
└────────────────────────────────────────────────┘
```

- Reuse existing `RetentionConfigPanel` and `RetentionChart` components
- Always-visible config panel (left), tab content (right)
- Debounced 300ms re-execution on config change
- "Save Changes" button appears on config diff
- Delete with AlertDialog confirmation

**Acceptance criteria:**
- [ ] Loads saved config, executes live
- [ ] Cohort triangle with color-coded retention cells
- [ ] Edit mode with config panel
- [ ] Delete with AlertDialog

---

### Phase 2: Analytical Views

**Goal:** Change Over Time view and enhanced cohort table.

#### 2.1 Change Over Time Tab

**Files to create:**
- `src/lib/retention-trend-sql.ts`
- `src/app/api/retentions/[id]/trend/route.ts`
- `src/components/retentions/trend-tab.tsx`

**What it shows:** For a selected bucket (e.g. Day 7), plot that bucket's retention rate across cohort entry periods. X-axis = cohort dates, Y-axis = retention %. Answers "is our Day 7 retention getting better?"

**SQL approach:**
```sql
-- The cohort triangle already has this data — we just need to reshape it
-- For each cohort entry date, extract the retention % at the selected bucket
-- This is essentially reading column N from the cohort table as a time series
SELECT
  cohort_date AS period,
  ROUND(100.0 * retained_count / cohort_size, 2) AS retention_rate
FROM (
  -- existing retention CTE chain with bucket = selected_bucket
)
ORDER BY cohort_date
```

**API:** `POST /api/retentions/[id]/trend` accepting `{ config?, bucket?: number, granularity? }`

**Trend tab UI:**
- Bucket selector: dropdown or pills `[Day 1] [Day 3] [Day 7] [Day 14] [Day 30]`
- Line chart via Recharts using `getSeriesColor()` from chart-colors.ts
- Granularity matches the retention config's granularity
- CSS variables for axes/grid (matching app conventions)
- Per-step toggle: show retention for all buckets simultaneously (multi-line)

**Acceptance criteria:**
- [ ] Bucket selector changes which retention interval is plotted
- [ ] Line chart shows retention rate over cohort periods
- [ ] Uses app chart color system (not monochrome HSL)
- [ ] Multi-bucket overlay toggle works

#### 2.2 Enhanced Cohort Table

**Files to modify:**
- `src/components/explorer/retention-chart.tsx` — extend `CohortTriangle`

**Enhancements:**
- Clickable cells (highlight on hover, cursor pointer) — prepares for Phase 3 drill-down
- Show absolute user counts on hover (tooltip: "450/1,200 retained (37.5%)")
- Column headers show bucket labels clearly
- Incomplete data cells marked with `*` (if cohort hasn't reached that interval yet)
- Multi-return-event support: tab/picker to switch between return events when `seriesResults` has 2 entries

**Acceptance criteria:**
- [ ] Cells are hoverable with count/rate tooltip
- [ ] Incomplete data marked with asterisk
- [ ] Multi-return-event tab picker works

---

### Phase 3: Actionability (The Differentiator)

**Goal:** Users drill into who was retained or churned at each cohort/bucket cell and create segments.

#### 3.1 Users Tab — Per-Cohort/Bucket Drill-Down

**Files to create:**
- `src/lib/retention-users-sql.ts`
- `src/app/api/retentions/[id]/users/route.ts`
- `src/components/retentions/users-tab.tsx`

**SQL approach:**
```sql
-- "Retained" at cohort C, bucket B: users in cohort C who fired return event on/after day B
-- "Churned" at cohort C, bucket B: users in cohort C who did NOT fire return event on/after day B
-- Uses the same CTE chain from retention-sql.ts

-- Retained:
SELECT DISTINCT user_id FROM returns
WHERE cohort_date = '{C}' AND days_since >= {B}
LIMIT 50 OFFSET 0

-- Churned:
SELECT user_id FROM cohort WHERE cohort_date = '{C}'
EXCEPT
SELECT DISTINCT user_id FROM returns WHERE cohort_date = '{C}' AND days_since >= {B}
LIMIT 50 OFFSET 0
```

Respects retention mode:
- **on_or_after**: `days_since >= B`
- **on**: `days_since = B`
- **custom**: maps to bracket range

**API:** `GET /api/retentions/[id]/users?cohort=2025-12-01&bucket=7&status=churned&limit=50&offset=0`

**Segment creation:** `POST /api/retentions/[id]/segment-sql` with `{ cohort?: string, bucket: number, status: "retained" | "churned" }`
- If `cohort` is specified: segment = users from that specific cohort
- If `cohort` is omitted: segment = all users across all cohorts (column-level)
- Returns `{ sql, estimatedCount, suggestedName }`
- suggestedName: `"{retention name} - Churned by Day {bucket}"` or `"{retention name} - Retained at Day {bucket}"`

**Users tab UI:**
- Cohort selector: date picker or dropdown of cohort dates from result
- Bucket selector: pills matching the retention buckets
- Status toggle: [Retained] [Churned] (default: Churned)
- Paginated user table with `dataset.entityName` header
- **"Create Segment" button** — prominent, calls segment-sql API → opens dialog with name/SQL/count → saves

**Acceptance criteria:**
- [ ] Cohort + bucket selectors filter user list
- [ ] Retained / Churned toggle switches displayed users
- [ ] Paginated table with 50 users per page
- [ ] "Create Segment" opens modal with pre-filled SQL
- [ ] Created segment appears in Segments sidebar

---

### Phase 4: Polish (Differentiation)

**Goal:** Chat-native creation, auto-generated starters, entity registry.

#### 4.1 Auto-Generated Starter Retentions

**Files to create:**
- `src/lib/server/retention-generator.ts`
- `src/app/api/retentions/generate-starters/route.ts`

**Pattern (from `funnel-generator.ts`):**
- Takes `userId`, `datasetId`, `events: EventDefinition[]`, `label`
- Gemini prompt generates 2-3 meaningful start→return event pairs
- Validates: all eventIds exist, execute each to verify non-zero cohort
- Skip retentions with 0 users in cohort
- Server-side idempotency guard
- Trigger: first visit to `/retentions` when empty (sample datasets only)

**Acceptance criteria:**
- [ ] 2-3 starter retentions generated with meaningful event pairs
- [ ] 0-cohort retentions not saved
- [ ] Idempotency prevents duplicate generation

#### 4.2 Chat Integration

**Files to create:**
- `src/app/api/retentions/generate-config/route.ts`
- `src/components/chat/retention-confirm-card.tsx`

**Files to modify:**
- `src/lib/prompts/classify.ts` — add `"create-retention"` actionType
- `src/lib/types.ts` — add `"retention-confirm"` variant + `retentionConfirm` field
- `src/hooks/use-analytics.ts` — add `create-retention` branch
- `src/hooks/use-action-handlers.ts` — add `handleRetentionConfirm/Cancel/Refine`
- `src/components/chat/chat-state-provider.tsx` — wire retention handlers
- `src/components/chat/chat-thread.tsx` — render `retention-confirm` variant

**Keywords for classifier:** "create a retention", "build a retention analysis", "retention for signup to purchase", "show me retention from X to Y"

**Confirm card:** Retention name (editable), start event, return event(s), mode, D7 preview, [Confirm] [Refine] [Cancel]

**Acceptance criteria:**
- [ ] Chat recognizes retention creation intent
- [ ] LLM generates RetentionConfig from description
- [ ] Confirm card shows preview
- [ ] Confirm saves and links to detail page

#### 4.3 Entity Registry

**Files to modify:**
- `src/lib/entity-types.ts` — add `"retention"` to `EntityType`
- `src/lib/entity-registry.ts` — add retention entries to `buildEntityCatalog()`

**Acceptance criteria:**
- [ ] Saved retentions appear in @ mention picker
- [ ] Selecting retention injects context (name, events, D7 rate)

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cached summary metric | D7 retention % | Industry-standard north star metric; computed on save, refreshed on GET |
| Change Over Time meaning | Selected bucket retention across cohort periods | Most actionable: "is our D7 improving?" |
| Drill-down interaction | Cell-level (cohort date + bucket) | Matches Amplitude/Mixpanel; most precise |
| "Churned" definition | Did NOT fire return event on/after selected bucket day | Aligns with "Return On or After" default mode |
| Auto-gen scope | Sample datasets only | Matches funnel pattern; avoids bad starters on unknown data |
| Custom bracket editor | Ship with default brackets, editor in fast-follow | Reduces Phase 1 scope; default brackets cover 80% of use cases |
| Sidebar position | After Funnels | Conceptually related; maintains analytical tools grouping |

---

## System-Wide Impact

### Interaction Graph

- Creating: API → retention-repo → meta-db (SQLite) → sidebar-context refreshRetentions() → sidebar re-render
- Deleting: API → retention-repo → meta-db → invalidateCatalog() → refreshRetentions()
- Executing: RetentionWorkspace → /api/explorer/retention → retention-sql.ts → DuckDB singleton
- Trend: /api/retentions/[id]/trend → retention-trend-sql.ts → DuckDB
- Users: /api/retentions/[id]/users → retention-users-sql.ts → DuckDB
- Segment from churn: /api/retentions/[id]/segment-sql → retention-users-sql.ts → segment-repo → refreshSegments()

### Error Propagation

- DuckDB query failures → `friendlyError()` → error state in hook → error banner
- SQLite write failures → repo throws → API 500 → toast
- Multi-return-event partial failure → show partial results with warning banner
- LLM auto-gen failures → `{ generated: 0, failed: N }` → empty state (not broken)
- Events missing on dataset → guard in list page → info state

### State Lifecycle Risks

- **Dataset switch on detail page:** Redirect to `/retentions` (subscribe to `dataset-switch.ts`)
- **Concurrent auto-generation:** Server-side idempotency (check existing `source='auto'`)
- **Incomplete cohort data:** Mark cells with `*`, exclude from overall weighted average
- **BigInt from DuckDB:** Use `safeStringify()` for all API responses (COUNT results are BigInt)

---

## API Surface

| Operation | Endpoint | Method | Phase |
|-----------|----------|--------|-------|
| List retentions | `/api/retentions` | GET | 1 |
| Create retention | `/api/retentions` | POST | 1 |
| Get retention | `/api/retentions/[id]` | GET | 1 |
| Update retention | `/api/retentions/[id]` | PATCH | 1 |
| Delete retention | `/api/retentions/[id]` | DELETE | 1 |
| Execute retention | `/api/explorer/retention` | POST | Existing |
| Trend data | `/api/retentions/[id]/trend` | POST | 2 |
| User drill-down | `/api/retentions/[id]/users` | GET | 3 |
| Segment SQL | `/api/retentions/[id]/segment-sql` | POST | 3 |
| Auto-generate | `/api/retentions/generate-starters` | POST | 4 |
| Generate config | `/api/retentions/generate-config` | POST | 4 |

---

## Files Summary

### New Files (16)

| File | Phase | Purpose |
|------|-------|---------|
| `src/lib/server/retention-repo.ts` | 1 | CRUD repository |
| `src/app/api/retentions/route.ts` | 1 | GET list + POST create |
| `src/app/api/retentions/[id]/route.ts` | 1 | GET + PATCH + DELETE |
| `src/app/retentions/page.tsx` | 1 | List page |
| `src/app/retentions/[id]/page.tsx` | 1 | Detail page |
| `src/components/retentions/retention-workspace.tsx` | 1 | Multi-tab workspace |
| `src/lib/retention-trend-sql.ts` | 2 | Trend SQL compiler |
| `src/app/api/retentions/[id]/trend/route.ts` | 2 | Trend endpoint |
| `src/components/retentions/trend-tab.tsx` | 2 | Change Over Time chart |
| `src/lib/retention-users-sql.ts` | 3 | Per-cohort/bucket user SQL |
| `src/app/api/retentions/[id]/users/route.ts` | 3 | User drill-down endpoint |
| `src/app/api/retentions/[id]/segment-sql/route.ts` | 3 | Churn SQL for segments |
| `src/components/retentions/users-tab.tsx` | 3 | User drill-down + Create Segment |
| `src/lib/server/retention-generator.ts` | 4 | LLM starter generation |
| `src/app/api/retentions/generate-starters/route.ts` | 4 | Auto-gen endpoint |
| `src/app/api/retentions/generate-config/route.ts` | 4 | Chat config generation |
| `src/components/chat/retention-confirm-card.tsx` | 4 | Chat confirm card |

### Modified Files (10)

| File | Phase | Change |
|------|-------|--------|
| `src/lib/meta-db.ts` | 1 | Add retentions table migration (v4) + prepared statements |
| `src/lib/retention-types.ts` | 1 | Add SavedRetention, SavedRetentionDisplay |
| `src/lib/feature-flags.ts` | 1 | Add `"retentions"` to FeatureId |
| `src/components/sidebar.tsx` | 1 | Add Retentions nav group |
| `src/components/sidebar-context.tsx` | 1 | Add retentions state + refresh |
| `src/components/explorer/retention-chart.tsx` | 2 | Enhanced cohort table (clickable cells, tooltips, multi-event tabs) |
| `src/lib/entity-types.ts` | 4 | Add `"retention"` to EntityType |
| `src/lib/entity-registry.ts` | 4 | Add retentions to @ picker catalog |
| `src/lib/prompts/classify.ts` | 4 | Add `"create-retention"` actionType |
| `src/hooks/use-action-handlers.ts` | 4 | Add retention create handler |

### Existing Files Reused (unchanged)

| File | What It Provides |
|------|------------------|
| `src/lib/retention-sql.ts` | Full SQL compiler (all 3 modes, breakdown, segments) |
| `src/hooks/use-retention.ts` | Config state management + debounced execution |
| `src/components/explorer/retention-config-panel.tsx` | Config panel (events, mode, granularity, breakdown) |
| `src/app/api/explorer/retention/route.ts` | Execution endpoint |

---

## Acceptance Criteria

### Functional Requirements

- [ ] Retentions persist across refreshes (SQLite)
- [ ] Three retention modes: Return On or After, Return On, Return On (Custom)
- [ ] Change Over Time view with bucket selector
- [ ] Cohort triangle with clickable cells and tooltips
- [ ] Per-cohort/bucket user drill-down with pagination
- [ ] Create segment from churned users (server-generated SQL)
- [ ] Auto-generated starter retentions from dataset events
- [ ] Chat-native retention creation
- [ ] Sidebar nav with top 5 retentions
- [ ] Dataset switch handles gracefully
- [ ] Multiple return events visualized

### Non-Functional Requirements

- [ ] Retention execution < 3s for datasets up to 10M rows
- [ ] List page loads < 500ms (SQLite read)
- [ ] All API routes require Clerk auth
- [ ] Chart uses app color system (getSeriesColor, CSS variables)
- [ ] BigInt safety via safeStringify

### Quality Gates

- [ ] `pnpm build` succeeds
- [ ] `pnpm lint` passes (0 new errors)
- [ ] All routes use `apiFetch`
- [ ] Delete uses `AlertDialog`
- [ ] Feature flag gates all entry points

---

## Sources & References

### Origin

- **Research document:** [memory/retention-research-2026-04-06.md] — Amplitude's 3 retention modes, 2 time models, usage interval, Change Over Time, calculation formulas, FAQ edge cases
- **Amplitude docs:** 7 pages on retention analysis (build, calculation, interpret, time, usage interval, FAQ)

### Internal References

- Funnel pattern: `src/lib/server/funnel-repo.ts`, `src/app/funnels/page.tsx`, `src/components/funnels/funnel-workspace.tsx`
- SQLite migrations: `src/lib/meta-db.ts`
- Feature flags: `src/lib/feature-flags.ts`
- Sidebar nav: `src/components/sidebar.tsx`
- Retention SQL compiler: `src/lib/retention-sql.ts`
- Chart colors: `src/lib/chart-colors.ts`

### External References

- [Amplitude: Retention Analysis](https://amplitude.com/docs/analytics/charts/retention-analysis)
- [Amplitude: Build a Retention Analysis](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-build)
- [Amplitude: How Retention Calculates](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-calculation)
- [Amplitude: Interpret Retention](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-interpret)
- [Amplitude: Change Over Time](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-interpret-usage)
- [Amplitude: Time in Retention](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-time)
- [Amplitude: Retention FAQ](https://amplitude.com/docs/faq/retention-analysis)

### Learnings Applied

- DuckDB singleton (docs/solutions/database-issues/duckdb-connection-leak)
- BigInt coercion (docs/solutions/database-issues/duckdb-node-api-v1-usage-patterns)
- Recharts conventions (docs/solutions/best-practices/recharts-consistency-custom-tooltip)
- Sidebar 7-point checklist (docs/solutions/best-practices/sidebar-panel-replacement-checklist)
- 3-tier navigation pattern (docs/solutions/design-patterns/split-panel-to-sidebar-three-tier-consolidation)
