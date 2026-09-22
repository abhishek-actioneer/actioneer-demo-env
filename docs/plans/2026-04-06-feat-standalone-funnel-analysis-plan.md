---
title: "feat: Standalone Funnel Analysis Feature"
type: feat
status: active
date: 2026-04-06
origin: docs/funnel-analysis-research.md
---

# Standalone Funnel Analysis Feature

## Overview

Promote funnel analysis from an ephemeral tab inside the feature-flagged `/explore` page into a first-class standalone feature — with its own persistence, pages, sidebar nav, workspace, and chat integration — following the exact pattern established by Segments.

The existing funnel infrastructure (SQL compiler, API route, hook, config panel, chart) is solid and reusable. The work spans: plumbing (persistence, CRUD, pages), computation engine extensions (counting methods, hold-constant, exclusions, time distribution, significance), analytical views (trend, breakdown, users), and actionability (segment creation from drop-offs).

**Target:** Cover P0 requirements for PMs, growth teams, and analysts. Current coverage against Amplitude/Mixpanel: ~25%. Target after this plan: ~75%.

## Problem Statement / Motivation

The funnel tab inside `/explore` is feature-flagged off. Even when enabled, it's ephemeral — configs are lost on refresh, there's no way to save or revisit a funnel, and no path from funnel insight to action (the core Actioneer value prop).

Three personas need different things from funnels, and we're missing P0 requirements for all of them:

- **PMs** can't monitor funnels over time (no trend), can't trust breakdowns (no statistical significance), can't understand speed (avg only, no distribution)
- **Growth teams** can't measure transactions (Uniques only, no Totals counting), can't do session-level analysis (no hold-constant), can't model exclusions ("did A but NOT B")
- **Analysts** lack precision tools across the board — no hold-constant, no significance, no counting method toggle, no exclusions

See `docs/funnel-analysis-research.md` for the full gap analysis against Amplitude/Mixpanel.

## Proposed Solution

Build in 5 phases. Phases 1-4 cover all P0 requirements. Phase 5 is differentiation.

1. **Foundation** — Persistence, CRUD, pages, sidebar nav
2. **Computation Engine** — Counting methods, hold-constant, exclusion events, time distribution
3. **Analytical Views** — Trend (with period comparison), Breakdown (with significance), enhanced Overview
4. **Actionability** — User drill-down per step, create segment from drop-off
5. **Polish** — Chat-native creation, LLM starter funnels, auto-generation

## Technical Approach

### Architecture

```
Sidebar Nav Group
  └─ /funnels (list page)
       └─ /funnels/[id] (detail workspace)
            ├─ Overview tab (funnel bars + metrics + time-to-convert distribution)
            ├─ Trend tab (conversion over time + period comparison)
            ├─ Breakdown tab (by property + statistical significance)
            └─ Users tab (per-step drill-down → Create Segment)

Persistence: SQLite (meta-db.ts) → funnel-repo.ts → /api/funnels CRUD
Execution:   /api/explorer/funnel (existing, extended with counting methods)
SQL Engine:  funnel-sql.ts (extended: counting, hold-constant, exclusions)
             funnel-trend-sql.ts (new: date-bucketed conversion)
             funnel-users-sql.ts (new: per-step user lists)
New APIs:    /api/funnels CRUD
             /api/funnels/[id]/trend
             /api/funnels/[id]/users
             /api/funnels/[id]/segment-sql
             /api/funnels/[id]/time-distribution
             /api/funnels/generate-starters
```

### Data Model

```sql
-- Migration version 3 in meta-db.ts
CREATE TABLE IF NOT EXISTS funnels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  dataset_id TEXT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  config TEXT NOT NULL,          -- JSON blob: FunnelConfig (extended)
  source TEXT DEFAULT 'manual',  -- 'manual' | 'chat' | 'auto'
  overall_conversion REAL,       -- cached snapshot (nullable)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_funnels_user_dataset
  ON funnels(user_id, dataset_id);
```

### Type Extensions

```typescript
// In src/lib/funnel-types.ts — extend existing file

// --- Counting methods ---
type CountingMethod = "uniques" | "totals" | "sessions";

// --- Exclusion events ---
interface ExclusionEvent {
  eventId: string;
  betweenSteps: [number, number]; // [afterStep, beforeStep] indices
}

// --- Hold property constant ---
interface HoldConstantProperty {
  propertyName: string;
  // Value locked from first Step 1 event (Uniques) or per re-entry (Totals/Sessions)
}

// --- Extended FunnelConfig ---
interface FunnelConfig {
  steps: FunnelStep[];
  conversionWindow: "1h" | "1d" | "7d" | "30d" | "90d";
  order: "this_order" | "any_order" | "exact_order";
  dateRange: { preset: DateRangePreset } | { start: string; end: string };
  segmentIds?: string[];
  segmentCompare?: boolean;
  breakdown?: string;
  // NEW: P0 computation features
  countingMethod: CountingMethod;          // default: "uniques"
  holdConstant?: HoldConstantProperty[];   // max 3 properties
  exclusionEvents?: ExclusionEvent[];      // between-step exclusions
}

// --- Saved funnel wrapper ---
interface SavedFunnel {
  id: string;
  name: string;
  description: string;
  config: FunnelConfig;
  source: "manual" | "chat" | "auto";
  overallConversion: number | null;
  datasetId: string;
  createdAt: string;
  updatedAt: string;
}

interface SavedFunnelDisplay extends SavedFunnel {
  stepCount: number;
  stepLabels: string[];
  trend: number | null;
}

// --- Time to convert distribution ---
interface TimeDistributionBucket {
  label: string;        // "< 1 min", "1-5 min", "5-30 min", etc.
  minSeconds: number;
  maxSeconds: number;
  userCount: number;
  percentage: number;
}

interface TimeDistributionResult {
  stepPairs: Array<{
    fromStep: number;
    toStep: number;
    median: number;       // seconds
    p25: number;
    p75: number;
    p90: number;
    buckets: TimeDistributionBucket[];
  }>;
  overallMedian: number;
  overallP90: number;
}

// --- Statistical significance ---
interface BreakdownSignificance {
  breakdownValue: string;
  conversionRate: number;
  sampleSize: number;
  pValue: number;
  confidence: number;         // 1 - pValue
  isSignificant: boolean;     // confidence > 0.95
  insufficientData: boolean;  // sampleSize < 30
}
```

---

## Implementation Phases

### Phase 1: Foundation (Persistence + Pages)

**Goal:** Users can create, save, list, view, edit, and delete funnels. Funnels appear in sidebar. Basic overview workspace.

**Unchanged from original plan.** See sections 1.1-1.6 below.

#### 1.1 SQLite Table + Repo

**Files to modify:**
- `src/lib/meta-db.ts` — bump `CURRENT_SCHEMA_VERSION` to 3, add migration block for `funnels` table, add 4 prepared statements: `funnelUpsert`, `funnelGetById`, `funnelListByUserDataset`, `funnelDelete`

**Files to create:**
- `src/lib/server/funnel-repo.ts` — follow `segment-repo.ts` pattern exactly:
  - `FunnelRow` type (snake_case DB columns)
  - `rowToFunnel()` mapper (snake → camelCase, parse JSON config)
  - `listFunnels(userId, datasetId): SavedFunnel[]`
  - `getFunnel(userId, id): SavedFunnel | null`
  - `upsertFunnel(userId, funnel): void`
  - `deleteFunnel(userId, id): boolean`

**Acceptance criteria:**
- [x] `funnels` table created on app start (migration from v2→v3)
- [x] CRUD operations work via repo functions
- [x] Existing tables unaffected by migration

#### 1.2 CRUD API Routes

**Files to create:**
- `src/app/api/funnels/route.ts` — GET (list) + POST (create)
- `src/app/api/funnels/[id]/route.ts` — GET + PATCH + DELETE

**Pattern (from segment API routes):**
- All handlers: `auth()` from Clerk, 401 if no userId
- GET list: read `datasetId` from query params or `x-dataset-id` header, call `listFunnels(userId, datasetId)`
- POST create: validate body (name required, config with 2+ steps), generate ID, execute funnel SQL for `overallConversion` snapshot, store via `upsertFunnel`, return 201
- GET single: `getFunnel`, 404 if missing. Re-execute SQL for fresh conversion rate.
- PATCH: merge fields (name, description, config), update `updatedAt`
- DELETE: `deleteFunnel`, return `{ success: true }`

**Acceptance criteria:**
- [x] POST creates funnel with validated config
- [x] GET list returns funnels filtered by dataset
- [x] GET single returns funnel with fresh conversion rate
- [x] PATCH updates fields
- [x] DELETE removes funnel
- [x] All routes require Clerk auth

#### 1.3 Feature Flag + Sidebar Nav

**Files to modify:**
- `src/lib/feature-flags.ts` — add `"funnels"` to `FeatureId` union
- `src/components/sidebar.tsx` — add to `ALL_NAV_ITEMS` + sidebar group (top 5 + "See all...")
- `src/lib/sidebar-config.ts` — add route config
- `src/components/sidebar-context.tsx` — add `funnels: SavedFunnel[]`, `refreshFunnels()`

**Acceptance criteria:**
- [x] Sidebar shows Funnels group with top 5 saved funnels
- [x] Sidebar refreshes on dataset switch
- [x] Feature flag gates all entry points

#### 1.4 List Page

**File:** `src/app/funnels/page.tsx`

- `<FeatureGate feature="funnels">`, page shell pattern
- Table: Name | Steps | Conversion | Last Updated
- Mini funnel sparkline per row
- Events dependency guard (show info state if `dataset.events` empty)
- Empty state with "Create your first funnel" CTA

**Acceptance criteria:**
- [x] List page renders saved funnels
- [x] Search filters by name
- [x] Events guard prevents creation when no events

#### 1.5 Creation Modal

**File:** `src/components/funnels/create-funnel-modal.tsx`

- Reuse `FunnelConfigPanel` components for step builder
- Live preview: debounced 500ms funnel execution once 2+ steps set
- Counting method toggle (Uniques default, Totals, Sessions — wired in Phase 2, UI shell in Phase 1)
- Save disabled until: name + 2+ steps + preview loaded

**Acceptance criteria:**
- [x] Step builder with event picker, filters, ordering, window
- [x] Live preview with conversion rate
- [x] Save creates funnel and navigates to detail

#### 1.6 Detail Page + Basic Workspace

**Files:** `src/app/funnels/[id]/page.tsx`, `src/components/funnels/funnel-workspace.tsx`

**Workspace layout:**
```
┌─ Header ──────────────────────────────────────┐
│  ← Funnels   Checkout Flow     [Edit] [Delete]│
│  4 steps · 30d window · This order · Uniques   │
├────────────────────────────────────────────────┤
│  ┌─ Funnel Chart (always visible) ───────────┐│
│  │  Step 1 ████████████████████████  10,241   ││
│  │        ↓ 35% dropped off (3,584)           ││
│  │  Step 2 ████████████████  6,657  (65.0%)   ││
│  │        ↓ 28% dropped off (1,864)           ││
│  │  Step 3 ██████████  4,793  (46.8%)         ││
│  │        ↓ 56% dropped off (2,683)           ││
│  │  Step 4 █████  2,110  (20.6%)              ││
│  │                                             ││
│  │  Overall: 20.6% · Median time: 2.4 days    ││
│  └─────────────────────────────────────────────┘│
│                                                │
│  [Overview]  [Trend]  [Breakdown]  [Users]     │
│  ──────────────────────────────────────────    │
│  (tab content)                                 │
└────────────────────────────────────────────────┘
```

**Phase 1 Overview tab:** Step table (Step | Users | Conv% | Drop% | Avg Time), date range presets, SQL preview.

**Edit mode:** "Edit" toggles left config panel inline. Save → PATCH → re-execute.

**Delete:** AlertDialog confirmation.

**Acceptance criteria:**
- [x] Loads saved config, executes live
- [x] Drop-off indicators between bars
- [x] Edit mode with config panel
- [x] Delete with AlertDialog

---

### Phase 2: Computation Engine (P0 for Growth + Analysts)

**Goal:** The SQL compiler handles all three counting methods, hold-property-constant, exclusion events, and time-to-convert distribution. This is the analytical foundation that all views build on.

#### 2.1 Counting Methods — Totals + Sessions

**Files to modify:**
- `src/lib/funnel-sql.ts` — extend `compileFunnelSQL` to accept `countingMethod`
- `src/lib/funnel-types.ts` — `CountingMethod` type (already defined above)
- `src/components/explorer/funnel-config-panel.tsx` — add counting method toggle

**SQL changes by counting method:**

**Uniques (current, default):**
```sql
-- Current behavior: one entry per user, first Step 1 only
-- COUNT(DISTINCT user_id) at each step
-- No change needed
```

**Totals (re-entry):**
```sql
-- User can re-enter after: conversion, timeout, or exclusion drop
-- Each attempt is a separate funnel instance
-- Key change: assign attempt_id to each Step 1 occurrence
WITH step1_attempts AS (
  SELECT user_id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp) AS attempt_id,
         timestamp AS entry_time
  FROM events WHERE ...
),
-- Each subsequent step matches to the NEAREST prior step1 attempt
-- within the conversion window
step2 AS (
  SELECT a.user_id, a.attempt_id, MIN(e.timestamp) AS t2
  FROM step1_attempts a
  JOIN events e ON e.user_id = a.user_id
    AND e.timestamp > a.entry_time
    AND e.timestamp <= a.entry_time + INTERVAL '{window}'
  WHERE e.event_type = 'step2_event'
  GROUP BY a.user_id, a.attempt_id
)
-- COUNT(*) instead of COUNT(DISTINCT user_id) — counts attempts
```

**Sessions (hold session_id constant):**
```sql
-- Implemented as a special case of hold-constant with session identifier
-- The dataset's session column (or a configurable property) is held constant
-- One entry per session, not per user
```

**UI:** 3-button toggle in config panel: `[Uniques] [Totals] [Sessions]`
- Uniques: "Count each user once"
- Totals: "Count every attempt"  
- Sessions: "Count each session" (grayed out if no session property detected — show tooltip explaining why)

**Acceptance criteria:**
- [ ] Uniques counting works as before (default)
- [ ] Totals counting tracks re-entry: user entering twice = 2 funnel attempts
- [ ] Sessions counting uses session property (hold-constant shortcut)
- [ ] Counting method toggle appears in config panel and creation modal
- [ ] Results change meaningfully when switching methods (verified with test query)

#### 2.2 Hold Property Constant

**Files to modify:**
- `src/lib/funnel-sql.ts` — add `holdConstant` parameter to `compileFunnelSQL`
- `src/lib/funnel-types.ts` — `HoldConstantProperty` type
- `src/components/explorer/funnel-config-panel.tsx` — add hold-constant picker

**SQL approach:**
```sql
-- Hold property constant adds a JOIN condition requiring same value across all CTEs
-- Example: hold "product_id" constant

WITH step1 AS (
  SELECT user_id, product_id, timestamp
  FROM events WHERE event_type = 'view_product'
),
step2 AS (
  SELECT s1.user_id, s1.product_id, MIN(e.timestamp) AS t2
  FROM step1 s1
  JOIN events e ON e.user_id = s1.user_id
    AND e.product_id = s1.product_id  -- ← HOLD CONSTANT
    AND e.timestamp > s1.timestamp
    AND e.timestamp <= s1.timestamp + INTERVAL '{window}'
  WHERE e.event_type = 'add_to_cart'
  GROUP BY s1.user_id, s1.product_id
)
-- When counting: COUNT(DISTINCT (user_id, product_id)) pairs
```

**Key rules (from Mixpanel research):**
- Property must exist on events at every funnel step (validate at config time)
- Max 3 simultaneous hold-constant properties
- Uniques mode: property value locked from first Step 1 event
- Totals mode: property resets per re-entry attempt
- Changes the counting unit from "users" to "user × property pairs"

**UI:** "Hold property constant" section in config panel (collapsible, advanced):
- Property picker dropdown (intersection of properties available on ALL step events)
- Add up to 3 properties
- Chip display with remove button
- Tooltip: "Users must have the same value for this property at every step to count as converted"

**Sessions shortcut:** When user selects "Sessions" counting method, auto-add the dataset's session property to hold-constant (if one exists). If no session property is detected, prompt user to select one.

**Acceptance criteria:**
- [ ] Hold-constant adds same-value JOIN across all step CTEs
- [ ] Property picker shows only properties common to all steps
- [ ] Max 3 properties enforced
- [ ] Count unit changes to user × property pairs (reflected in chart labels)
- [ ] Sessions counting auto-sets hold-constant on session property
- [ ] Validation error if property doesn't exist on a step's event

#### 2.3 Exclusion Events

**Files to modify:**
- `src/lib/funnel-sql.ts` — add exclusion event handling between step CTEs
- `src/lib/funnel-types.ts` — `ExclusionEvent` type
- `src/components/explorer/funnel-config-panel.tsx` — add exclusion placement UI

**SQL approach:**
```sql
-- Exclusion event between steps 1 and 2:
-- User drops off if they fire the exclusion event after completing step 1
-- but before completing step 2

step2 AS (
  SELECT s1.user_id, MIN(e.timestamp) AS t2
  FROM step1 s1
  JOIN events e ON e.user_id = s1.user_id
    AND e.timestamp > s1.timestamp
    AND e.timestamp <= s1.timestamp + INTERVAL '{window}'
  WHERE e.event_type = 'step2_event'
    -- EXCLUSION: no exclusion event between s1.timestamp and e.timestamp
    AND NOT EXISTS (
      SELECT 1 FROM events ex
      WHERE ex.user_id = s1.user_id
        AND ex.event_type = '{exclusion_event}'
        AND ex.timestamp > s1.timestamp
        AND ex.timestamp < e.timestamp
    )
  GROUP BY s1.user_id
)
```

**UI:** Between each pair of steps in the config panel, show a subtle "+" button:
```
  Step 1: Product Viewed
    [+ Exclude event between steps]     ← click to add
  Step 2: Add to Cart
```

Clicking opens an event picker for the exclusion event. Once set, it appears as a red-ish muted chip between the steps:
```
  Step 1: Product Viewed
    ✕ Exclude: Used Coupon              ← chip with remove
  Step 2: Add to Cart
```

**Scope options:** Exclusion can apply:
- Between specific step pair (default)
- Between all steps (shortcut — applies the same exclusion between every consecutive pair)

**Acceptance criteria:**
- [ ] Exclusion events add NOT EXISTS clause between step CTEs
- [ ] Users who fire exclusion event between steps drop off
- [ ] In Totals mode, dropped users can re-enter on next Step 1
- [ ] UI allows placing exclusions between any step pair
- [ ] "Between all steps" shortcut works
- [ ] Removing exclusion updates SQL immediately

#### 2.4 Time-to-Convert Distribution

**Files to create:**
- `src/lib/funnel-time-sql.ts` — SQL for time distribution + percentiles
- `src/app/api/funnels/[id]/time-distribution/route.ts`
- `src/components/funnels/time-distribution-chart.tsx`

**SQL approach:**
```sql
-- For each consecutive step pair, compute time differences
WITH step_times AS (
  SELECT user_id,
         t1, t2,
         EPOCH(t2 - t1) AS seconds_to_convert
  FROM ... -- existing step CTEs, filtered to converted users only
)
SELECT
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY seconds_to_convert) AS p25,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY seconds_to_convert) AS median,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY seconds_to_convert) AS p75,
  PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY seconds_to_convert) AS p90,
  MIN(seconds_to_convert) AS min_time,
  MAX(seconds_to_convert) AS max_time,
  COUNT(*) AS total_converted
FROM step_times;

-- Plus histogram binning:
SELECT
  CASE
    WHEN seconds_to_convert < 60 THEN '< 1 min'
    WHEN seconds_to_convert < 300 THEN '1-5 min'
    WHEN seconds_to_convert < 1800 THEN '5-30 min'
    WHEN seconds_to_convert < 3600 THEN '30-60 min'
    WHEN seconds_to_convert < 86400 THEN '1-24 hours'
    WHEN seconds_to_convert < 604800 THEN '1-7 days'
    ELSE '7+ days'
  END AS bucket,
  COUNT(*) AS user_count
FROM step_times
GROUP BY bucket
ORDER BY MIN(seconds_to_convert);
```

**Bin strategy:** Auto-detect based on data range. If 90% of conversions happen within 1 hour, use minute-level bins. If spread over weeks, use day-level bins. DuckDB can compute the range first, then pick appropriate buckets.

**Visualization:**
- Horizontal bar histogram (buckets on Y-axis, user count on X-axis)
- Percentile markers: P25, P50 (median), P75, P90 as vertical lines overlaid
- Summary stats: "Median: 12 min · P90: 2.4 hours" below the chart
- Step pair selector: show distribution for overall or between specific step pairs

**Where it appears:**
- Overview tab: compact summary (median + P90 text) next to each step pair in the step table
- Dedicated section in Overview tab: full histogram for overall time-to-convert
- Optionally: expand any step pair row to see its specific distribution

**Acceptance criteria:**
- [ ] Percentiles (P25, P50, P75, P90) computed via DuckDB
- [ ] Histogram with auto-detected bin sizes
- [ ] Per-step-pair and overall distributions available
- [ ] Summary stats shown in overview tab step table
- [ ] Full histogram visible in overview tab

---

### Phase 3: Analytical Views (P0 for PMs + Analysts)

**Goal:** Trend, Breakdown, and enhanced Overview tabs — with period comparison and statistical significance.

#### 3.1 Conversion Over Time (Trend Tab)

**Files to create:**
- `src/lib/funnel-trend-sql.ts`
- `src/app/api/funnels/[id]/trend/route.ts`
- `src/components/funnels/trend-tab.tsx`

**SQL:** `compileFunnelTrendSQL(config, dataset, granularity)` — groups step entries by `DATE_TRUNC(grain, entry_timestamp)`, computes per-bucket conversion rates. Respects `countingMethod` and `holdConstant`.

**Previous period comparison (PM P0):**
- Toggle: "Compare to previous period" / "Compare to previous year"
- Runs the same funnel SQL twice: current date range + shifted date range
- Overlay on the same chart: solid line = current, dashed line = comparison
- Delta shown: "+3.2pp" or "-1.8pp" (percentage points) in header

**Trend tab UI:**
- Line chart via `UnifiedChart`
- Default: overall conversion rate over time
- Toggle: per-step conversion (one line per step)
- Granularity picker: daily / weekly / monthly
- Comparison toggle: None / Previous Period / Previous Year
- Buckets by entry date (not completion date)

**Acceptance criteria:**
- [ ] Trend shows conversion rate over time as line chart
- [ ] Granularity picker works
- [ ] Per-step toggle shows N lines
- [ ] Previous period comparison as dashed overlay
- [ ] Delta percentage points in header

#### 3.2 Breakdown Tab with Statistical Significance

**Files to create:**
- `src/lib/funnel-significance.ts` — chi-squared or z-test utility
- `src/components/funnels/breakdown-tab.tsx`

**Statistical significance computation:**
```typescript
// Z-test for two proportions (breakdown value vs overall)
function computeSignificance(
  valueConversion: number,  // e.g., 0.28 for iOS
  valueSampleSize: number,  // e.g., 5000
  overallConversion: number, // e.g., 0.22
  overallSampleSize: number  // e.g., 20000
): { pValue: number; confidence: number; isSignificant: boolean; insufficientData: boolean } {
  if (valueSampleSize < 30) return { pValue: 1, confidence: 0, isSignificant: false, insufficientData: true };

  const p = overallConversion;
  const pHat = valueConversion;
  const n = valueSampleSize;
  const se = Math.sqrt(p * (1 - p) / n);
  const z = (pHat - p) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(z))); // two-tailed
  const confidence = 1 - pValue;

  return { pValue, confidence, isSignificant: confidence > 0.95, insufficientData: false };
}
```

**Breakdown tab UI:**
- Property picker dropdown
- Grouped funnel bars: one set per breakdown value (top 10 by entry count)
- Breakdown table: Step × Value matrix with conversion %
- **Significance indicators per cell:**
  - Green dot: significant positive (confidence > 0.95, conversion above overall)
  - Red dot: significant negative (confidence > 0.95, conversion below overall)
  - Gray dot: not significant or insufficient data
  - Hover tooltip: "28.1% conversion (p=0.003, 99.7% confidence)" or "Insufficient data (n=12)"
- "Others" bucket for values beyond top 10

**Acceptance criteria:**
- [ ] Breakdown shows per-value funnel comparison
- [ ] Statistical significance computed for each value vs overall
- [ ] Significance indicators visible in table cells
- [ ] Insufficient data (<30 samples) flagged explicitly
- [ ] Top 10 values with "Others" bucket

#### 3.3 Enhanced Overview Tab

**Files to modify:**
- `src/components/funnels/funnel-workspace.tsx` — extend overview tab content

**Additions to Overview tab (building on Phase 1 basic overview):**
- **Time distribution section:** Histogram from Phase 2.4, positioned below the step table
- **Counting method badge:** Shows "Uniques" / "Totals" / "Sessions" in header
- **Hold-constant badge:** Shows held properties if any
- **Exclusion indicators:** Shows exclusion events between relevant steps in the step table
- **Step table additions:** Add Median Time column (alongside Avg Time), color-code conversion cells (monochrome intensity scale)

**Acceptance criteria:**
- [ ] Overview tab integrates time distribution histogram
- [ ] Counting method and hold-constant shown in badges
- [ ] Exclusion events visible in step display
- [ ] Median time shown per step pair

---

### Phase 4: Actionability (The Differentiator)

**Goal:** Users drill into who dropped off at each step and create segments. This is the Actioneer value proposition — insight → action in one click.

#### 4.1 Users Tab — Per-Step Drill-Down

**Files to create:**
- `src/lib/funnel-users-sql.ts` — SQL for per-step user lists
- `src/app/api/funnels/[id]/users/route.ts`
- `src/components/funnels/users-tab.tsx`

**API:** `GET /api/funnels/[id]/users?step=N&status=converted|dropped&limit=50&offset=0`

**SQL:** `compileFunnelUserSQL(config, dataset, step, status)` — generates set operations from funnel CTEs:
```sql
-- Dropped at step N: completed step N-1 but NOT step N
SELECT user_id FROM step_{N-1}_cte
EXCEPT
SELECT user_id FROM step_N_cte
-- With pagination: LIMIT 50 OFFSET 0
```

Respects counting method:
- **Uniques:** Returns distinct user IDs
- **Totals:** Returns user_id + attempt_id pairs
- **Hold-constant:** Returns user_id + held-property-value pairs

**Users tab UI:**
- Step selector: clickable pills (Step 1, Step 2, ... Step N) with user count badges
- Status toggle: "Converted" / "Dropped off" (default: dropped)
- Paginated user table: columns from data (User ID + held-constant properties if any)
- Column header uses `dataset.entityName`
- **"Create Segment" button** — prominent, above the table

**Create Segment from drop-off:**
- `POST /api/funnels/[id]/segment-sql` with `{ step, status }` → returns `{ sql, estimatedCount }`
- SQL generated server-side to match exact funnel computation
- Opens `CreateSegmentModal` pre-filled with name and SQL
- Name default: `"{Funnel Name} - Dropped at {Step Label}"`

**Acceptance criteria:**
- [ ] Step selector shows user counts per step
- [ ] Converted / Dropped toggle switches displayed users
- [ ] Paginated table with 50 users per page
- [ ] "Create Segment" opens modal with pre-filled SQL
- [ ] Segment SQL matches the funnel's exact computation
- [ ] Created segment appears in Segments sidebar

#### 4.2 Entity Registry Integration

**Files to modify:**
- `src/lib/entity-registry.ts` — add funnels to `buildEntityCatalog()`

**Acceptance criteria:**
- [ ] Saved funnels appear in @ mention picker
- [ ] Selecting funnel injects context (name, steps, conversion)

---

### Phase 5: Polish (Differentiation)

**Goal:** Chat-native creation and auto-generated starters. Things Amplitude/Mixpanel don't have.

#### 5.1 Auto-Generated Starter Funnels

**Files to create:**
- `src/lib/server/funnel-generator.ts`
- `src/app/api/funnels/generate-starters/route.ts`

**Pattern (from `segment-generator.ts`):**
- Takes `userId`, `datasetId`, `events: EventDefinition[]`, `label`
- Gemini prompt generates 3-5 meaningful sequential journeys from the event catalog
- Validates: all eventIds exist, 2+ steps, execute each to verify non-zero conversion
- Skip funnels with 0 entries
- Clear previous auto-generated (`source = 'auto'`) before inserting
- Server-side idempotency guard

**Trigger:** Client-side on first visit to `/funnels` when empty (same as segments auto-gen).

**Acceptance criteria:**
- [ ] 3-5 starter funnels generated with meaningful journeys
- [ ] Starter funnels show "Starter" badge
- [ ] 0-conversion funnels not saved
- [ ] Idempotency prevents duplicate generation

#### 5.2 Chat Integration — Funnel Confirm Card

**Files to create:**
- `src/components/chat/funnel-confirm-card.tsx`

**Files to modify:**
- `src/lib/types.ts` — add `"funnel-confirm"` variant
- `src/hooks/use-action-handlers.ts` — add `handleFunnelCreate`
- `src/hooks/use-classify.ts` — add `"create-funnel"` action type
- `src/components/chat/chat-thread.tsx` — render `funnel-confirm` variant

**Classification:** Use existing `action` mode with `actionType: "create-funnel"` — don't change mode enum.

**Confirm card:** Funnel name (editable), step list, conversion preview, [Confirm] [Refine] [Cancel].

**Acceptance criteria:**
- [ ] Chat recognizes funnel creation intent
- [ ] LLM generates FunnelConfig from description
- [ ] Confirm card shows preview
- [ ] Confirm saves and links to detail page

---

## P0 Coverage Matrix (Post-Implementation)

### Product Manager

| P0 Requirement | Phase | Status |
|---|---|---|
| Save and revisit funnels | 1 | Covered |
| Conversion over time trend | 3 | Covered |
| Breakdown by property | 3 | Covered |
| Time to convert (median + distribution) | 2 | Covered |
| Previous period comparison | 3 | Covered |
| Segment from drop-off | 4 | Covered |
| Statistical significance on breakdowns | 3 | Covered |

### Growth Team

| P0 Requirement | Phase | Status |
|---|---|---|
| Totals counting (re-entry) | 2 | Covered |
| Session-level analysis (hold constant) | 2 | Covered |
| Exclusion events ("did A but NOT B") | 2 | Covered |
| Conversion over time | 3 | Covered |
| User drill-down → segment → push | 4 | Covered |
| Breakdown by property | 3 | Covered |

### Analyst

| P0 Requirement | Phase | Status |
|---|---|---|
| Three counting methods (toggle) | 2 | Covered |
| Hold property constant | 2 | Covered |
| Exclusion events | 2 | Covered |
| Statistical significance | 3 | Covered |
| Time to convert distribution | 2 | Covered |
| Breakdown with confidence | 3 | Covered |

**Post-implementation coverage vs Amplitude/Mixpanel: ~75%** (up from ~25%)

**Remaining gaps (not in scope — future work):**
- Attribution models (First Step / Last Step / Per-Step) — Mixpanel-only, medium value
- Frequency analysis between steps — medium value
- Inline vs Global filter distinction — medium value, complex UX
- Optimized re-entry (Mixpanel) — advanced, low ROI
- Optional steps (Amplitude) — nice to have
- Property Sum (revenue through funnel) — medium value

---

## System-Wide Impact

### Interaction Graph

- Creating: API → funnel-repo → meta-db (SQLite) → sidebar-context refreshFunnels() → sidebar re-render
- Deleting: API → funnel-repo → meta-db → invalidateCatalog() → refreshFunnels()
- Executing: useFunnel → /api/explorer/funnel → funnel-sql.ts (extended) → DuckDB singleton
- Trend: /api/funnels/[id]/trend → funnel-trend-sql.ts → DuckDB
- Users: /api/funnels/[id]/users → funnel-users-sql.ts → DuckDB
- Segment from drop-off: /api/funnels/[id]/segment-sql → funnel-sql.ts → segment-repo → refreshSegments()

### Error Propagation

- DuckDB query failures → `friendlyError()` → error state in hook → error banner
- SQLite write failures → repo throws → API 500 → toast
- Hold-constant validation failure (property missing on a step) → config-time error → inline validation message
- LLM auto-gen failures → `{ generated: 0, failed: N }` → empty state (not broken)
- Events missing on dataset → guard in list page → info state

### State Lifecycle Risks

- **Dataset switch on detail page:** Redirect to `/funnels` (subscribe to `dataset-switch.ts`)
- **Concurrent auto-generation:** Server-side idempotency (check existing `source='auto'`)
- **Edit mutation vs trend:** Recomputed with new config (no versioning) — matches Mixpanel behavior
- **Hold-constant property removed from dataset:** Funnel execution returns 0 results with SQL error → show "Property not found" warning, offer to remove from config

### API Surface

| Operation | Endpoint | Method | Phase |
|---|---|---|---|
| List funnels | `/api/funnels` | GET | 1 |
| Create funnel | `/api/funnels` | POST | 1 |
| Get funnel | `/api/funnels/[id]` | GET | 1 |
| Update funnel | `/api/funnels/[id]` | PATCH | 1 |
| Delete funnel | `/api/funnels/[id]` | DELETE | 1 |
| Execute funnel | `/api/explorer/funnel` | POST | Existing (extended Phase 2) |
| Trend data | `/api/funnels/[id]/trend` | POST | 3 |
| Time distribution | `/api/funnels/[id]/time-distribution` | POST | 2 |
| User drill-down | `/api/funnels/[id]/users` | GET | 4 |
| Segment SQL | `/api/funnels/[id]/segment-sql` | POST | 4 |
| Auto-generate | `/api/funnels/generate-starters` | POST | 5 |

---

## Acceptance Criteria

### Functional Requirements

- [ ] Funnels persist across refreshes (SQLite)
- [ ] Three counting methods: Uniques, Totals, Sessions
- [ ] Hold property constant (up to 3 properties)
- [ ] Exclusion events between steps
- [ ] Conversion over time trend with period comparison
- [ ] Breakdown with statistical significance indicators
- [ ] Time-to-convert distribution (histogram + percentiles)
- [ ] Per-step user drill-down with pagination
- [ ] Create segment from funnel drop-off (server-generated SQL)
- [ ] Auto-generated starter funnels from dataset events
- [ ] Chat-native funnel creation
- [ ] Sidebar nav with top 5 funnels
- [ ] Dataset switch handles gracefully

### Non-Functional Requirements

- [ ] Funnel execution < 3s for datasets up to 10M rows
- [ ] List page loads < 500ms (SQLite read)
- [ ] Monochrome design system throughout
- [ ] All API routes require Clerk auth
- [ ] Max 10 steps, max 3 hold-constant properties
- [ ] User drill-down paginates at 50/page

### Quality Gates

- [ ] `pnpm build` succeeds
- [ ] `pnpm lint` passes (0 new errors)
- [ ] All routes use `apiFetch`
- [ ] Delete uses `AlertDialog`
- [ ] Feature flag gates all entry points

---

## Dependencies & Prerequisites

1. **Events on datasets** — Funnels require `EventDefinition[]`. Verify event generation is wired on this branch; if not, port from `pretext-exp`.
2. **DuckDB singleton** — Already in place. Never create per-request connections.
3. **Segment creation infrastructure** — Phase 4 depends on existing segment modal/API. Already built.
4. **Sidebar context** — Phase 1 extends `SidebarContextValue`. Test provider order preserved.
5. **Session property detection** — Sessions counting needs a way to identify the session column. Could use `DatasetConfig` field or LLM detection during enrichment.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Events not generated on this branch | High | Blocks all funnel creation for uploads | Verify; port from pretext-exp if needed |
| Hold-constant SQL is slow (extra JOINs) | Medium | Slow execution on large datasets | Benchmark with 1M+ rows; add index hints if needed |
| Totals counting SQL complexity | Medium | Bugs in re-entry logic | Test with known scenarios: user enters 3x, converts on 2nd attempt |
| Auto-generated funnels have 0 conversions | Medium | Bad first impression | Execute each, skip 0-entry funnels |
| Statistical significance confusing for non-analysts | Low | UX noise | Show only in Breakdown tab, use simple dots not p-values by default |
| Chat classifier destabilized | Medium | Existing classification degrades | Use actionType under existing action mode |
| Session property not detectable | Medium | Sessions counting unusable | Fall back to "select a property" picker; don't auto-detect |

---

## Files Summary

### New Files (20)

| File | Phase | Purpose |
|---|---|---|
| `src/lib/server/funnel-repo.ts` | 1 | CRUD repository |
| `src/app/api/funnels/route.ts` | 1 | GET list + POST create |
| `src/app/api/funnels/[id]/route.ts` | 1 | GET + PATCH + DELETE |
| `src/app/funnels/page.tsx` | 1 | List page |
| `src/app/funnels/[id]/page.tsx` | 1 | Detail page |
| `src/components/funnels/funnel-workspace.tsx` | 1 | Multi-tab workspace |
| `src/components/funnels/create-funnel-modal.tsx` | 1 | Creation modal |
| `src/lib/funnel-time-sql.ts` | 2 | Time distribution SQL |
| `src/app/api/funnels/[id]/time-distribution/route.ts` | 2 | Time distribution endpoint |
| `src/components/funnels/time-distribution-chart.tsx` | 2 | Histogram visualization |
| `src/lib/funnel-trend-sql.ts` | 3 | Trend SQL compiler |
| `src/lib/funnel-significance.ts` | 3 | Statistical significance utility |
| `src/app/api/funnels/[id]/trend/route.ts` | 3 | Trend endpoint |
| `src/components/funnels/trend-tab.tsx` | 3 | Trend line chart + comparison |
| `src/components/funnels/breakdown-tab.tsx` | 3 | Breakdown + significance |
| `src/lib/funnel-users-sql.ts` | 4 | Per-step user SQL |
| `src/app/api/funnels/[id]/users/route.ts` | 4 | User drill-down endpoint |
| `src/app/api/funnels/[id]/segment-sql/route.ts` | 4 | Drop-off SQL for segments |
| `src/components/funnels/users-tab.tsx` | 4 | User drill-down + Create Segment |
| `src/lib/server/funnel-generator.ts` | 5 | LLM starter generation |
| `src/app/api/funnels/generate-starters/route.ts` | 5 | Auto-gen endpoint |
| `src/components/chat/funnel-confirm-card.tsx` | 5 | Chat confirm card |

### Modified Files (12)

| File | Phase | Change |
|---|---|---|
| `src/lib/meta-db.ts` | 1 | Add funnels table migration (v3) + prepared statements |
| `src/lib/funnel-types.ts` | 1+2 | Add SavedFunnel, CountingMethod, HoldConstant, ExclusionEvent, TimeDistribution, Significance types |
| `src/lib/feature-flags.ts` | 1 | Add `"funnels"` to FeatureId |
| `src/components/sidebar.tsx` | 1 | Add Funnels nav item + sidebar group |
| `src/lib/sidebar-config.ts` | 1 | Add route config |
| `src/components/sidebar-context.tsx` | 1 | Add funnels state + refresh |
| `src/lib/funnel-sql.ts` | 2 | Extend with counting methods, hold-constant, exclusion events |
| `src/components/explorer/funnel-config-panel.tsx` | 2 | Add counting toggle, hold-constant picker, exclusion UI |
| `src/app/api/explorer/funnel/route.ts` | 2 | Pass counting method + hold-constant + exclusions to compiler |
| `src/lib/entity-registry.ts` | 4 | Add funnels to @ picker catalog |
| `src/lib/types.ts` | 5 | Add `funnel-confirm` variant |
| `src/hooks/use-action-handlers.ts` | 5 | Add funnel create handler |

### Existing Files Reused (unchanged)

| File | What It Provides |
|---|---|
| `src/hooks/use-funnel.ts` | Config state management + debounced execution |
| `src/components/explorer/funnel-chart.tsx` | Funnel bars visualization |

---

## Sources & References

### Origin

- **Research document:** [docs/funnel-analysis-research.md](../funnel-analysis-research.md) — computation models, Amplitude/Mixpanel gap analysis, prioritized scope, persona breakdowns. Key decisions carried forward: counting methods scope, hold-constant as P0, exclusion events as P0, statistical significance requirement.

### Internal References

- Segments pattern: `src/lib/server/segment-repo.ts`, `src/app/segments/page.tsx`, `src/app/segments/[id]/page.tsx`
- SQLite migrations: `src/lib/meta-db.ts:120-180`
- Feature flags: `src/lib/feature-flags.ts`
- Sidebar nav: `src/components/sidebar.tsx:74-84`
- Funnel SQL compiler: `src/lib/funnel-sql.ts`

### External References

- [Amplitude: Funnel Analysis](https://amplitude.com/docs/analytics/charts/funnel-analysis)
- [Amplitude: Hold Properties Constant](https://amplitude.com/docs/analytics/charts/funnel-analysis/funnel-analysis-hold-properties-constant)
- [Mixpanel: Funnels Advanced](https://docs.mixpanel.com/docs/reports/funnels/funnels-advanced)

### Learnings Applied

- DuckDB singleton (docs/solutions/database-issues/duckdb-connection-leak)
- UNION ALL for chart data (docs/solutions/runtime-errors/chart-data-not-found-conversion-funnel)
- Sidebar 7-point checklist (docs/solutions/best-practices/sidebar-panel-replacement-checklist)
- Recharts design tokens (docs/solutions/best-practices/recharts-consistency-custom-tooltip)
