# Analytics Explorer — Amplitude/Mixpanel-Style Click UX

**Date:** 2026-03-17
**Status:** Brainstorm
**Scope:** Metrics detail page extension + Board card interactivity

---

## What We're Building

A click-based analytics explorer that lets users configure queries visually — pick events, choose measurement types (uniques, totals, frequency), apply segment filters, add dimension breakdowns, and adjust date ranges — all without writing SQL or natural language. Inspired by Amplitude's Segmentation tab.

**Two surfaces:**
1. **Metrics detail page** — Full builder. Users start from a metric, then add breakdowns, filters, measure types. This is the primary config surface.
2. **Board cards** — Lightweight inline controls for quick adjustments (date range, breakdown toggle). Not the full builder. "Edit in explorer" link goes back to the full page.

---

## Why This Approach

The client wants a familiar click-click UX for structured exploration. The current chat-based approach is powerful for open-ended questions but frustrating for "show me Revenue by Country for the last 30 days" — that's 2 clicks in Amplitude vs. typing a sentence and waiting for LLM.

Building on metrics (not a standalone /explore page) because:
- Metrics already have SQL recipes, dimensions, time grains
- Avoids a parallel entity system
- Natural flow: browse metrics → pick one → slice it → save to board

---

## Blast Radius Analysis

### Files That CHANGE (Modify Existing)

| File | What Changes | Risk |
|------|-------------|------|
| **`src/lib/metric-types.ts`** | Add `ExplorerConfig` type, extend `Metric` with optional `explorerConfig` | Low — additive |
| **`src/lib/board-types.ts`** | Add `explorerConfig?: ExplorerConfig` to `BoardCard` | Low — additive, optional field |
| **`src/lib/datasets/types.ts`** | Add `events: EventDefinition[]` to `DatasetConfig` for curated event catalog | Medium — touches all dataset configs |
| **`src/lib/datasets/ecommerce.ts`** | Add event definitions (e.g., "Purchase", "Page View", "Add to Cart") | Low |
| **`src/app/metrics/[id]/page.tsx`** | Major rework — add explorer config panel alongside chart | **High** — main UI change |
| **`src/components/metric/metric-detail-panel.tsx`** | Rework or replace — becomes the explorer config panel | **High** — significant rewrite |
| **`src/components/metric/metric-chart.tsx`** | Extend to accept breakdown data (multiple series) + breakdown table below | Medium |
| **`src/components/chart/report-chart.tsx`** | May need chart type switcher controls, date range picker integration | Medium |
| **`src/components/board/card-renderer.tsx`** | Add lightweight explorer controls overlay for chart cards with `explorerConfig` | Medium |
| **`src/components/board/document-view.tsx`** | Card hover/click needs to show inline controls | Low-Medium |
| **`src/app/api/metrics/route.ts`** | Add POST endpoint for explorer query execution (config → SQL → results) | Medium |
| **`src/lib/metric-store.ts`** | Save/load explorer configs alongside metrics | Low |
| **`src/components/sidebar.tsx`** | No change needed (metrics nav item already exists) | None |

### Files That Are NEW (Create)

| File | Purpose |
|------|---------|
| **`src/lib/explorer-types.ts`** | `ExplorerConfig`, `EventDefinition`, `MeasureType`, `PropertyFilter`, `BreakdownConfig` types |
| **`src/lib/explorer-sql.ts`** | Deterministic SQL compiler: `ExplorerConfig → SQL string`. Handles aggregations, filters, breakdowns, date ranges. LLM fallback for complex formulas. |
| **`src/components/metric/explorer-config-panel.tsx`** | Left config panel: event picker, measure type pills, segment builder, breakdown picker |
| **`src/components/metric/event-picker.tsx`** | Event selection dropdown with dataset-curated events |
| **`src/components/metric/measure-type-picker.tsx`** | Pill buttons: Uniques, Event Totals, Active %, Average, Frequency |
| **`src/components/metric/segment-filter-builder.tsx`** | Add filters, apply saved segments, cohort selection |
| **`src/components/metric/breakdown-picker.tsx`** | Dimension breakdown dropdown (populated from schema) |
| **`src/components/metric/breakdown-table.tsx`** | Data table below chart showing breakdown rows |
| **`src/components/board/card-explorer-controls.tsx`** | Lightweight inline controls for board cards (date range, breakdown toggle) |
| **`src/app/api/explorer/route.ts`** | POST endpoint: receives `ExplorerConfig`, compiles SQL, executes, returns chart data |

### Files That Are UNTOUCHED

- Chat system (`chat/`, hooks, chat-state-provider) — no changes
- Board store (`board-store.ts`) — only additive (explorerConfig on card)
- Sidebar navigation — no new nav items
- Playbooks, scouts, knowledge, forecasting — completely untouched
- Canvas/tldraw — untouched (board document view gets controls, not canvas)
- SQL generator (`sql-generator.ts`) — untouched (explorer has its own compiler)
- DuckDB layer (`db.ts`, `sql-executor.ts`) — reused as-is

---

## Key Design Decisions

### 1. Deterministic SQL with LLM fallback
Standard cases (COUNT, SUM, AVG with GROUP BY + WHERE + date range) compile via code templates — instant, no API cost. Complex formulas (ratios, custom expressions) fall back to Gemini. ~90/10 split expected.

### 2. Event catalog is curated per dataset
Each `DatasetConfig` gets an `events: EventDefinition[]` field listing available events with display names, the underlying table/column, and available properties for filtering. Not auto-discovered from schema enricher — the client wants a clean, controlled list.

### 3. Metrics page is the full builder, boards get lightweight controls
Avoids complexity explosion of embedding a full config panel in every board card. Board cards show: date range picker, breakdown toggle (on/off or switch dimension), and "Open in explorer" link.

### 4. No new entity type (for now)
Explorer configs live either:
- **On a Metric** — as `metric.explorerConfig` (the last-used config for that metric)
- **On a BoardCard** — as `card.explorerConfig` (the config that produced this card's data)

This avoids a new store, new API routes, new catalog entries. If users later need "saved views" as a first-class entity, that's a clean extension — add a store + list page.

---

## Interaction Flow

```
User clicks "Metrics" in sidebar
  → Metrics list page (existing)
  → Clicks a metric (e.g., "Revenue")
  → Metric detail page loads with explorer layout:

  ┌─────────────────────┬──────────────────────────────────┐
  │ CONFIG PANEL (350px) │ CHART + TABLE (flex-1)           │
  │                     │                                  │
  │ ▾ Events            │ [Line chart ▾] [Daily ▾] [30d]  │
  │   A Purchase     ⋮  │                                  │
  │   + Filter by       │   ┌──────────────────────────┐   │
  │   + Group by        │   │   📈 Revenue time series  │   │
  │   + Add Event       │   │   with breakdown series   │   │
  │                     │   └──────────────────────────┘   │
  │ ▾ Measured as       │                                  │
  │  [Sum] [Count] ...  │ Breakdown by: [Top 5 ▾] 🔍      │
  │                     │ ┌──────────────────────────────┐ │
  │ ▾ Segment by        │ │ Country  │ Nov 16 │ Nov 17 │  │
  │   1 All Users    ⋮  │ │ US       │ $1.2k  │ $1.4k  │  │
  │   + Filter by       │ │ UK       │ $800   │ $750   │  │
  │   + Add Segment     │ └──────────────────────────────┘ │
  │                     │                                  │
  │ ▾ Breakdown         │         [Save to Board]          │
  │   + Select Property │                                  │
  └─────────────────────┴──────────────────────────────────┘
```

**Board card (lightweight controls):**
```
  ┌──────────────────────────────────┐
  │ Revenue by Country    [30d ▾] ⚙  │
  │                                  │
  │   📈 Chart                       │
  │                                  │
  │ Breakdown: Country ▾  [Edit ↗]   │
  └──────────────────────────────────┘
```

---

## Resolved Questions

### 1. What happens to the current metric detail page layout?
**Decision: Keep both — tab switch.** Tabs at the top of the metric detail page: "Explore" (explorer view) and "Details" (current detail sidebar with calculations, scope, relationships, metadata). Users switch between analyzing and viewing metadata.

### 2. Multiple events on one chart?
**Decision: Multiple events from the start.** Full Amplitude parity — users can stack/overlay events on the same chart. SQL compiler needs to handle UNION or multi-column aggregation. Chart renderer needs multi-series support (already has `yKeys[]`).

### 3. Should the explorer work for metrics without SQL recipes?
**Decision: Yes — config-driven SQL always.** The explorer compiles SQL from (event + measure type + filters + breakdown). Existing metric SQL recipes are optional shortcuts, not required. This means the SQL compiler is the primary engine, not a wrapper around existing recipes.

### 4. How do board card controls interact with the existing board edit UX?
**Decision: Controls in card footer.** Persistent footer bar below the chart with date range + breakdown dropdowns + "Edit in explorer" link. Drag handle and delete stay on hover at the top. Clear spatial separation — no conflicts with existing drag-drop.

```
┌──────────────────────────────┐
│ Revenue          [drag] [x]  │  <- hover actions (existing)
│                              │
│   Chart area                 │
│                              │
├──────────────────────────────┤
│ 30d ▾  |  By: Country ▾  | ↗ │  <- persistent footer (new)
└──────────────────────────────┘
```

## Open Questions

None — all resolved.

---

## Estimated Scope

| Area | New Files | Modified Files | Effort |
|------|-----------|---------------|--------|
| Types & SQL compiler | 2 | 2 | Medium-Large (multi-event UNION, LLM fallback) |
| Explorer config panel (6 sub-components) | 6 | 0 | Large |
| Metrics page rework (add Explore/Details tabs) | 0 | 2 | Large |
| Multi-event chart + breakdown table | 1 | 1 | Medium-Large (multi-series overlay) |
| Board card footer controls | 1 | 2 | Medium |
| API endpoint | 1 | 0 | Medium |
| Dataset event catalog (curated per dataset) | 0 | 2 | Small |
| **Total** | **~11** | **~9** | **~20 files touched** |

**Untouched:** chat system, playbooks, scouts, knowledge, forecasting, segments store, canvas/tldraw, sidebar nav, provider architecture, SSE streaming, board store (additive only).
