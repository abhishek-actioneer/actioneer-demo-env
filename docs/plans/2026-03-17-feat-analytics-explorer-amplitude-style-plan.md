---
title: "feat: Analytics Explorer — Amplitude-Style Click UX"
type: feat
status: completed
date: 2026-03-17
origin: docs/brainstorms/2026-03-17-analytics-explorer-brainstorm.md
---

# Analytics Explorer — Amplitude-Style Click UX

## Overview

Build a click-based analytics explorer that lets users configure queries visually — pick events, choose measurement types, apply segment filters, add dimension breakdowns, and adjust date ranges — all without writing SQL or natural language. Two surfaces: a full builder on a new `/explore` page (and `/metrics/[id]` Explore tab), and lightweight inline controls on board card footers.

## Problem Statement / Motivation

The client wants a familiar Amplitude/Mixpanel UX for structured exploration. The current chat-based approach is powerful for open-ended questions but frustrating for "show me Revenue by Country for the last 30 days" — that's 2 clicks in Amplitude vs. typing a sentence and waiting for LLM. This feature bridges the gap between chat-driven AI analysis and traditional click-click analytics.

## Proposed Solution

(see brainstorm: `docs/brainstorms/2026-03-17-analytics-explorer-brainstorm.md`)

**Two entry points:**
1. **`/explore`** — Standalone page with blank explorer config. Users pick events from a curated catalog, choose measurement type, add filters/breakdowns. New sidebar nav item.
2. **`/metrics/[id]`** — Adds "Explore" / "Details" tabs. Explore tab pre-loads the metric's config. Details tab preserves the current detail panel.

**SQL compilation:** Deterministic templates for standard aggregations (Uniques, Event Totals, Sum, Average). LLM fallback via Gemini for complex formulas. No latency on standard clicks.

**Board integration:** Chart cards with `explorerConfig` show a persistent footer with date range picker + breakdown toggle + "Edit in explorer" link. Re-execution via a new lightweight `/api/explorer/query` endpoint.

**State:** In-memory store (`explorerStore`) preserves config across sidebar navigation within a session.

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│ /explore page  OR  /metrics/[id] (Explore tab)          │
│                                                         │
│  ┌──────────────┐  ┌────────────────────────────────┐   │
│  │ ExplorerConfig│  │ ExplorerChart                  │   │
│  │ Panel (350px) │  │  - ReportChart (dual Y-axis)   │   │
│  │               │  │  - Chart controls bar          │   │
│  │ EventPicker   │  │  - BreakdownTable              │   │
│  │ MeasureType   │  │                                │   │
│  │ SegmentFilter │  │  [Save to Board]               │   │
│  │ BreakdownPkr  │  └────────────────────────────────┘   │
│  └──────────────┘                                       │
└───────────────────────────┬─────────────────────────────┘
                            │ ExplorerConfig
                            ▼
              ┌─────────────────────────┐
              │ explorer-sql.ts         │
              │ compileExplorerSQL()    │
              │ deterministic templates │
              │ + LLM fallback          │
              └────────────┬────────────┘
                           │ SQL string
                           ▼
              ┌─────────────────────────┐
              │ POST /api/explorer/query│
              │ executeSQLInternal()    │
              │ → QueryResult           │
              └─────────────────────────┘
```

### Core Types

```typescript
// src/lib/explorer-types.ts

interface EventDefinition {
  id: string;                    // e.g. "purchase", "page_view"
  displayName: string;           // e.g. "Purchase", "Page Viewed"
  table: string;                 // source table
  filterColumn?: string;         // e.g. "event_type" — WHERE event_type = 'purchase'
  filterValue?: string;          // e.g. "purchase"
  valueColumn?: string;          // e.g. "price" — for Sum/Average measures
  properties: EventProperty[];   // available filter dimensions
}

interface EventProperty {
  column: string;                // e.g. "brand", "category_code"
  displayName: string;
  type: "string" | "number" | "date";
  cardinalityHint?: "low" | "medium" | "high";
}

type MeasureType = "uniques" | "event_totals" | "sum" | "average";

interface EventSelection {
  eventId: string;
  measureType: MeasureType;
  filters?: PropertyFilter[];
}

interface PropertyFilter {
  property: string;
  operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "not_in";
  value: string | number | string[];
}

interface ExplorerConfig {
  events: EventSelection[];       // 1-5 events
  dateRange: { preset: "7d" | "30d" | "60d" | "90d" | "1y" } | { start: string; end: string };
  granularity: "hourly" | "daily" | "weekly" | "monthly";
  breakdown?: string;             // dimension column name
  segmentIds?: string[];          // saved segment IDs to filter by
  chartType: "line" | "bar" | "area";
}

interface ExplorerResult {
  config: ExplorerConfig;
  sql: string;                    // compiled SQL
  chartSpec: ChartSpec;           // for rendering
  data: Record<string, unknown>[];
  breakdownData?: Record<string, unknown>[];  // for breakdown table
  executionTimeMs: number;
}
```

### SQL Compilation Templates

```typescript
// src/lib/explorer-sql.ts — deterministic compiler

// Uniques: COUNT(DISTINCT user_id) grouped by time bucket
// Event Totals: COUNT(*) grouped by time bucket
// Sum: SUM(valueColumn) grouped by time bucket
// Average: AVG(valueColumn) grouped by time bucket

// With breakdown: adds GROUP BY breakdown_column
// With segment: adds WHERE user_id IN (SELECT ... FROM segment_sql)
// With filters: adds WHERE property_column operator value

// Multi-event: UNION ALL of per-event queries with event_name label column
// Dual Y-axis: separate queries, merged client-side by date key
```

### Implementation Phases

#### Phase 1: Foundation — Types, SQL Compiler, API

**Tasks:**
- [x] Create `src/lib/explorer-types.ts` — `ExplorerConfig`, `EventDefinition`, `EventSelection`, `PropertyFilter`, `MeasureType`, `ExplorerResult`
- [x] Create `src/lib/explorer-sql.ts` — `compileExplorerSQL(config, dataset)` deterministic compiler with templates for 4 measure types, breakdown GROUP BY, segment WHERE subquery, date range filter, granularity bucketing, multi-event UNION ALL
- [x] Create `src/lib/explorer-store.ts` — module-level in-memory store for active explorer config (survives navigation, lost on refresh)
- [x] Add `events: EventDefinition[]` to `DatasetConfig` in `src/lib/datasets/types.ts`
- [x] Add curated events to ecommerce dataset in `src/lib/datasets/ecommerce.ts` — Purchase, View, Add to Cart, Remove from Cart with properties (brand, category_code, price)
- [x] Create `POST /api/explorer/query` route in `src/app/api/explorer/route.ts` — receives `ExplorerConfig`, calls `compileExplorerSQL()`, executes via `executeSQLInternal()`, returns `ExplorerResult`
- [x] Add LLM fallback path in `explorer-sql.ts` — when `compileExplorerSQL` returns `null` (unsupported formula), call Gemini with config + schema context to generate SQL

**Success criteria:** `compileExplorerSQL()` produces correct SQL for all 4 measure types × single/multi event × with/without breakdown × with/without segment filter. API endpoint returns chart-ready data.

**Key files:**
| File | Action |
|------|--------|
| `src/lib/explorer-types.ts` | **New** |
| `src/lib/explorer-sql.ts` | **New** |
| `src/lib/explorer-store.ts` | **New** |
| `src/app/api/explorer/route.ts` | **New** |
| `src/lib/datasets/types.ts` | **Modify** — add `events` field |
| `src/lib/datasets/ecommerce.ts` | **Modify** — add event definitions |

#### Phase 2: Explorer Page — Config Panel + Chart

**Tasks:**
- [x] Create `src/app/explore/page.tsx` — standalone explorer page with two-panel layout (config left 350px, chart right flex-1)
- [x] Create `src/components/explorer/explorer-config-panel.tsx` — collapsible sections: Events, Measured as, Segment by, Breakdown
- [x] Create `src/components/explorer/event-picker.tsx` — dropdown listing `dataset.events`, each event shows display name + kebab menu for filters. "+ Add Event" button. Max 5 events.
- [x] Create `src/components/explorer/measure-type-picker.tsx` — pill toggle buttons: Uniques, Event Totals, Sum, Average. Per-event measure selection.
- [x] Create `src/components/explorer/segment-filter-builder.tsx` — list of active segment filters. "+ Add Segment" opens a dropdown of saved segments. Each segment shows name + remove button.
- [x] Create `src/components/explorer/breakdown-picker.tsx` — dropdown of available properties (from dataset events + schema columns with `semanticType: "dimension"`). Single selection. Shows "+ Select Property" when empty.
- [x] Create `src/components/explorer/explorer-chart.tsx` — wraps `ReportChart` with controls bar (chart type switcher, granularity picker, date range presets). Dual Y-axis support for multi-event with different scales.
- [x] Create `src/components/explorer/breakdown-table.tsx` — data table below chart showing breakdown dimension rows × time columns. Checkbox toggles for series visibility. "Export CSV" button (future).
- [x] Create `src/components/explorer/explorer-controls-bar.tsx` — horizontal bar above chart: `[Line chart ▾] [Daily ▾] [7d] [30d] [60d] [90d] [Custom]`
- [x] Add `useExplorer` hook in `src/hooks/use-explorer.ts` — manages config state, calls API on config change (debounced 300ms), transforms results to ChartSpec, reads/writes explorer-store
- [x] Add "Explore" to `NAV_ITEMS` in `src/components/sidebar.tsx`

**Success criteria:** User can open `/explore`, pick events, select measure type, optionally add breakdown/segment, see chart update on each config change. Multi-event overlay works with dual Y-axis.

**Key files:**
| File | Action |
|------|--------|
| `src/app/explore/page.tsx` | **New** |
| `src/components/explorer/` (8 files) | **New** |
| `src/hooks/use-explorer.ts` | **New** |
| `src/components/sidebar.tsx` | **Modify** — add Explore nav item |
| `src/components/chart/report-chart.tsx` | **Modify** — add dual Y-axis support |

#### Phase 3: Metrics Page Integration — Explore/Details Tabs

**Tasks:**
- [x] Modify `src/app/metrics/[id]/page.tsx` — add tab bar ("Explore" / "Details") at top. Default to Explore tab. Details tab renders existing `MetricChart` + pushes `MetricDetailPanel` to sidebar.
- [x] In Explore tab, render `ExplorerConfigPanel` + `ExplorerChart` with config pre-populated from metric's `aggregation`, `table`, `column`, `timeColumn`, `dimensions`
- [x] Add `metricToExplorerConfig(metric, dataset)` utility in `explorer-store.ts` — converts a `Metric` to an initial `ExplorerConfig` by matching metric fields to dataset event definitions
- [x] Modify `src/components/metric/metric-detail-panel.tsx` — no structural changes, just ensure it renders correctly in the Details tab context

**Success criteria:** `/metrics/[id]` shows tabs. Explore tab pre-loads the metric's config into the explorer. Details tab shows the existing detail panel. Tab state persists during the session.

**Key files:**
| File | Action |
|------|--------|
| `src/app/metrics/[id]/page.tsx` | **Modify** — add tabs, import explorer |
| `src/lib/explorer-store.ts` | **Modify** — add `metricToExplorerConfig()` |
| `src/components/metric/metric-detail-panel.tsx` | **Minor modify** — ensure tab context works |

#### Phase 4: Board Card Footer Controls

**Tasks:**
- [x] Add `explorerConfig?: ExplorerConfig` to `BoardCard` in `src/lib/board-types.ts`
- [x] Create `src/components/board/card-explorer-footer.tsx` — persistent footer bar with: date range dropdown (presets), breakdown dimension dropdown, "Edit in explorer ↗" link. Renders below chart area, above card border.
- [x] Modify `src/components/board/card-renderer.tsx` — for chart cards with `explorerConfig`, render `CardExplorerFooter` below the chart
- [x] Add "Save to Board" button to explorer page — uses `board-picker-popover.tsx` to select target board, creates `BoardCard` with `type: "chart"`, `explorerConfig`, `chartSpec`, `sql`, `data`
- [x] Implement footer control handlers — date range change or breakdown change calls `compileExplorerSQL()` with modified config, POSTs to `/api/explorer/query`, updates card data + chartSpec in board-store
- [x] "Edit in explorer" link — navigates to `/explore` with config hydrated from the card's `explorerConfig` via `explorerStore.set(card.explorerConfig)`

**Success criteria:** Explorer charts can be saved to boards. Board cards show footer with working date range + breakdown controls. "Edit in explorer" round-trips correctly.

**Key files:**
| File | Action |
|------|--------|
| `src/lib/board-types.ts` | **Modify** — add `explorerConfig` field |
| `src/components/board/card-explorer-footer.tsx` | **New** |
| `src/components/board/card-renderer.tsx` | **Modify** — render footer for explorer cards |
| `src/components/board/document-view.tsx` | **Minor modify** — card height adjustment for footer |

#### Phase 5: Polish + Edge Cases

**Tasks:**
- [x] Empty states: no events selected (show prompt), zero results (show "No data for this range"), loading state (skeleton chart)
- [x] High-cardinality warning: when breakdown column has `cardinalityHint: "high"` or `"unique"`, show warning badge and auto-add `LIMIT 20` to GROUP BY results
- [x] Dataset switch handling: subscribe to `dataset-switch.ts`, clear explorer-store on dataset change
- [x] Error handling: SQL compilation failure shows inline error with "Try adjusting your config". LLM fallback failure shows "Unable to generate query" with retry button.
- [x] Auto-granularity: when date range changes, auto-select sensible granularity (7d → daily, 30d → daily, 90d → weekly, 1y → monthly). User can override.
- [x] Max 5 events enforcement in event picker UI
- [x] Ensure all new charts follow `report-chart.tsx` conventions (CustomTooltip, strokeDasharray, color tokens) per institutional learnings

**Success criteria:** No crashes on edge cases. Sensible defaults. Clear error messages.

## System-Wide Impact

### Interaction Graph

- User picks config → `useExplorer` debounces 300ms → `POST /api/explorer/query` → `compileExplorerSQL()` → `executeSQLInternal()` → response to client → `ReportChart` renders
- Board card footer change → same pipeline but updates `board-store` card data via `saveBoardCard(card, { sync: true })`
- "Save to Board" → `saveBoardCard()` → `invalidateCatalog()` → sidebar refreshes board list
- Dataset switch → `notifyDatasetSwitch()` → `explorerStore.clear()` → explorer resets

### Error Propagation

- SQL compilation error → `compileExplorerSQL` returns `null` → LLM fallback → if both fail, `ExplorerResult.error` string → UI shows inline error
- DuckDB OOM → `executeSQLInternal` returns `error` field → API returns 200 with error in body → UI shows "Query too large" message
- High-cardinality breakdown → preventive: auto-LIMIT 20, warning badge before execution

### State Lifecycle Risks

- Explorer-store is module-level (singleton) — shared across all tabs/instances. If user opens two explorer tabs, they share state. Acceptable for V1.
- Board card `explorerConfig` persists to localStorage — if event definitions change (dataset config updated), stored configs may reference nonexistent events. Mitigation: validate config on load, strip invalid events.

### API Surface Parity

- New `POST /api/explorer/query` is the only new endpoint. It does NOT duplicate `/api/analyze` — it's a lightweight SQL executor without classification, multi-agent, or streaming.
- Existing `/api/metrics` GET endpoint unchanged.

### Integration Test Scenarios

1. **Config → SQL → Chart round-trip:** Pick 2 events with different measure types, add breakdown, verify chart renders correctly with dual Y-axis and correct data
2. **Save to Board → Edit in Explorer:** Save explorer chart to board, navigate to board, change date range via footer, verify data updates. Click "Edit in explorer", verify config is restored.
3. **Dataset switch:** Build config on ecommerce, switch dataset, verify explorer resets and event catalog changes
4. **Segment filter composition:** Apply a saved segment filter, verify SQL includes `WHERE user_id IN (...)` subquery with correct segment SQL
5. **LLM fallback:** Create a config that deterministic compiler can't handle, verify LLM fallback produces valid SQL

## Acceptance Criteria

### Functional Requirements

- [ ] `/explore` page loads with empty config, shows event picker prompt
- [ ] User can select 1-5 events from curated dataset catalog
- [ ] 4 measurement types work: Uniques, Event Totals, Sum, Average
- [ ] Date range presets (7d, 30d, 60d, 90d, 1y) and custom range work
- [ ] Granularity options (hourly, daily, weekly, monthly) work with auto-selection
- [ ] Breakdown by dimension column produces grouped chart + breakdown table
- [ ] Segment filter applies saved segment as WHERE subquery
- [ ] Multi-event overlay renders with dual Y-axis when scales differ
- [ ] Chart type switcher (line, bar, area) works
- [ ] `/metrics/[id]` has Explore/Details tabs, Explore pre-loads metric config
- [ ] "Save to Board" creates a chart card with explorerConfig on the selected board
- [ ] Board card footer shows date range + breakdown controls that re-execute queries
- [ ] "Edit in explorer" on board card navigates to `/explore` with config restored
- [ ] Explorer state survives sidebar navigation within session

### Non-Functional Requirements

- [ ] Config change → chart update in <500ms for deterministic SQL (no LLM)
- [ ] LLM fallback completes in <3s
- [ ] No DuckDB OOM on high-cardinality breakdowns (auto-LIMIT 20)
- [ ] Monochrome UI — uses muted/foreground/border tokens only

### Quality Gates

- [ ] All new charts follow `report-chart.tsx` conventions (CustomTooltip, grid styling, color tokens)
- [ ] Fixed grid layouts (no `auto-fill`) per institutional learnings
- [ ] Shared renderers never call tldraw hooks per institutional learnings
- [ ] SQL queries return 2+ columns for charts per institutional learnings
- [ ] `apiFetch` used for all API calls (never raw `fetch`)

## Dependencies & Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Dual Y-axis in Recharts is complex | Medium | Recharts has `YAxis` with `yAxisId` prop — proven pattern. May need custom tick formatting. |
| Event catalog doesn't generalize to non-event datasets | High | V1 is ecommerce-focused. Dynamic datasets can derive events from `SchemaMap` columns later. |
| SQL compiler edge cases | Medium | Start with 4 simple measure types. LLM fallback catches gaps. |
| Board card footer conflicts with drag-drop | Low | Spatially separated — footer is below chart, drag handle is on top. |
| Explorer-store lost on page refresh | Low (accepted) | In-memory is sufficient for V1. URL params or localStorage can be added later. |

## File Summary

### New Files (~14)

| File | Purpose |
|------|---------|
| `src/lib/explorer-types.ts` | Core types: ExplorerConfig, EventDefinition, MeasureType, etc. |
| `src/lib/explorer-sql.ts` | Deterministic SQL compiler + LLM fallback |
| `src/lib/explorer-store.ts` | In-memory config store + metricToExplorerConfig() |
| `src/app/api/explorer/route.ts` | POST endpoint for query execution |
| `src/app/explore/page.tsx` | Standalone explorer page |
| `src/components/explorer/explorer-config-panel.tsx` | Left config panel wrapper |
| `src/components/explorer/event-picker.tsx` | Event selection with filters |
| `src/components/explorer/measure-type-picker.tsx` | Measure type pill buttons |
| `src/components/explorer/segment-filter-builder.tsx` | Segment filter list |
| `src/components/explorer/breakdown-picker.tsx` | Breakdown dimension dropdown |
| `src/components/explorer/explorer-chart.tsx` | Chart + controls wrapper |
| `src/components/explorer/breakdown-table.tsx` | Breakdown data table |
| `src/components/explorer/explorer-controls-bar.tsx` | Chart type + granularity + date range bar |
| `src/hooks/use-explorer.ts` | Config state management + API calls |
| `src/components/board/card-explorer-footer.tsx` | Board card footer controls |

### Modified Files (~8)

| File | Change |
|------|--------|
| `src/lib/datasets/types.ts` | Add `events: EventDefinition[]` to DatasetConfig |
| `src/lib/datasets/ecommerce.ts` | Add curated event definitions |
| `src/lib/board-types.ts` | Add `explorerConfig?: ExplorerConfig` to BoardCard |
| `src/components/sidebar.tsx` | Add "Explore" nav item |
| `src/components/chart/report-chart.tsx` | Add dual Y-axis support |
| `src/app/metrics/[id]/page.tsx` | Add Explore/Details tabs |
| `src/components/board/card-renderer.tsx` | Render explorer footer for chart cards |
| `src/components/board/document-view.tsx` | Minor card height adjustment |

### Untouched Systems

Chat, playbooks, scouts, knowledge, forecasting, canvas/tldraw, provider architecture, SSE streaming, sql-generator.ts, segments store.

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-17-analytics-explorer-brainstorm.md](docs/brainstorms/2026-03-17-analytics-explorer-brainstorm.md) — Key decisions: deterministic SQL with LLM fallback, curated event catalog, metrics page tabs, board card footer controls, no new entity type.

### Internal References

- Metric types: `src/lib/metric-types.ts:28-68`
- ChartSpec: `src/lib/chart-types.ts`
- ReportChart: `src/components/chart/report-chart.tsx`
- SQL executor: `src/lib/sql-executor.ts:96` (`executeSQLInternal`)
- BoardCard: `src/lib/board-types.ts:43-96`
- DatasetConfig: `src/lib/datasets/types.ts:5-66`
- Ecommerce dataset: `src/lib/datasets/ecommerce.ts`
- Board card renderer: `src/components/board/card-renderer.tsx`

### Institutional Learnings Applied

- Chart consistency: follow `report-chart.tsx` conventions (`docs/solutions/best-practices/recharts-consistency-custom-tooltip-Forecasting-20260220.md`)
- Fixed grid layouts, no auto-fill (`docs/solutions/ui-bugs/board-grid-auto-fill-shows-3-columns-instead-of-2.md`)
- Shared renderers: never call tldraw hooks (`docs/solutions/runtime-errors/tldraw-useeditor-crash-outside-canvas-context-20260315.md`)
- SQL must return 2+ columns for charts (`docs/solutions/runtime-errors/chart-data-not-found-conversion-funnel-missing-charttype.md`)
- Detail panel state reset: "adjust state during render" pattern (`docs/solutions/design-patterns/segment-detail-panel-ux-patterns.md`)
