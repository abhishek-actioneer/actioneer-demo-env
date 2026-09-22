---
title: "feat: Segment Workspace — Drill Down & Analysis"
type: feat
status: active
date: 2026-03-19
---

# Segment Workspace — Drill Down & Analysis

## The Problem

> "Segments, once made, is a dead-end. Impossible to ask further questions about the specific segments, or know what else to do but look at the 10 sampled UIDs."
> — CEO feedback

Current `/segments/[id]`: name, SQL, 10 sample users, push buttons. Dead end.

## The Mental Model

A segment is a **living population**. Five questions matter:

1. **Is it growing or shrinking?** (Health)
2. **Who are these people?** (Composition)
3. **Where did they come from? Where are they going?** (Movement)
4. **What are they doing?** (Explore — drill down)
5. **Show me the actual users** (Users)

## The Page

```
/segments/[id]

Header: name, description, user count + trend, [Edit] [Push] [Delete]

┌──────────────────────────────────────────────────────────┐
│ Health  │  Composition  │  Movement  │  Explore  │  Users │
│ ──────                                                    │
│                                                          │
│ [Auto-computed content OR interactive drill-down]         │
│                                                          │
└──────────────────────────────────────────────────────────┘

AI Sidebar (always knows which segment + which tab)
```

### Health Tab (auto-computed, no config)

The system shows diagnostics — user doesn't configure anything.

- **KPI cards**: user count, growth vs last month, 1-2 key metrics (revenue/user, bookings/user — auto-selected from dataset)
- **Size over time**: line chart of user count by week for last 90 days
- **vs All Users**: same key metrics with "All Users" as dashed baseline
- **vs Previous Period**: table comparing now vs 30d/60d/90d ago

### Composition Tab (auto-computed, no config)

The system picks the most useful breakdowns from the dataset schema.

- **Property breakdowns**: horizontal bar charts for top 4-5 categorical properties (auto-selected: columns with `semanticType: "dimension"`, `cardinalityHint: "low"`)
- **Behavioral profile**: top events this segment performs, frequency vs all users
- **Everything is clickable**: click a bar (e.g., "Koramangala") → filters the view to just that sub-group

### Movement Tab (auto-computed, no config)

Shows user flow between segments over time.

- **Inflow**: "Of users here today, where were they 30 days ago?" — bar chart of source segments
- **Outflow**: "Of users who left in last 30 days, where did they go?" — bar chart of destination segments
- **Net flow**: +47 entered, -31 left, net +16
- **Time selector**: compare against 30d / 60d / 90d ago

SQL approach: run all saved segment SQLs against current data and date-shifted data, compute intersection sets.

### Explore Tab (interactive drill-down)

This is the Trends tool from `/explore`, scoped to this segment. Full config panel.

- **Event picker**: pick any event from the curated catalog
- **Measure types**: Uniques, Event Totals, Active %, Average, Frequency, Sum
- **Breakdown**: pick any property dimension
- **Per-event filters**: + Filter by
- **Chart controls**: chart type, granularity, date range, rolling avg, cumulative
- **Breakdown table**: full date × breakdown matrix with checkboxes, sorting, CSV export
- **No "Segment by" section**: the segment IS the filter (auto-injected)

Reuses: `ExplorerConfigPanel`, `ExplorerChart`, `BreakdownTable`, `useExplorer` hook — all get `segmentSQL` prop.

### Users Tab

- Paginated user table (50 per page)
- Columns: auto-detected from enriched join (user_id + primary table columns)
- Sort by any column, search
- Total count

## Implementation

### Phase 1: Workspace Shell + Health Tab

**New files:**
- `src/components/segments/segment-workspace.tsx` — tab bar + routing
- `src/components/segments/health-tab.tsx` — KPI cards + size chart + comparisons
- `src/app/api/segments/[id]/overview/route.ts` — parallel SQL for health metrics

**Modified:**
- `src/app/segments/[id]/page.tsx` — replace current layout with workspace

### Phase 2: Composition + Movement Tabs

**New files:**
- `src/components/segments/composition-tab.tsx` — auto-generated breakdowns
- `src/components/segments/movement-tab.tsx` — inflow/outflow analysis
- `src/app/api/segments/[id]/movement/route.ts` — cross-segment membership comparison

### Phase 3: Explore Tab

**New files:**
- `src/components/segments/explore-tab.tsx` — wraps Explorer components with segment SQL

**Modified:**
- `src/hooks/use-explorer.ts` — accept `segmentSQL` to auto-inject into all queries

### Phase 4: Users Tab + Polish

**New files:**
- `src/components/segments/users-tab.tsx` — paginated table

### What We Reuse (no changes needed)

- `ExplorerConfigPanel`, `ExplorerChart`, `BreakdownTable`
- `ReportChart` for all visualizations
- SQL compilers (`explorer-sql.ts`) — already support `segmentSQLs` param
- Dataset schema for auto-selecting properties
- Segment store/API for CRUD
- AI sidebar context injection (already wired on segment pages)
