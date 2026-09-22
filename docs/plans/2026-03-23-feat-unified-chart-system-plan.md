---
title: Unified Chart System
type: feat
status: active
date: 2026-03-23
---

# Unified Chart System

## Overview

Replace all chart rendering paths with a single `<UnifiedChart>` component that exposes three variants — compact, normal, expanded — with a consistent baseline of features across every surface. Build and validate in an isolated dev page (`/dev/charts`) before wiring into the main app.

## Problem Statement

Charts across the app are fragmented:

- **5 separate recharts rendering files**, 4 of which duplicate area chart logic (period tabs, trend colors, tooltip formatting, gradient fills)
- **7 surfaces** where charts appear, each with different feature sets
- **3 competing color systems** (#22c55e vs #10b981 vs SERIES_COLORS), CSS `chart-1..5` tokens defined but unused
- **3 independent time picker implementations** (7 presets / 5 presets / 6 buttons) with different filtering logic
- **Zero parity** on grain picker, CSV export, annotations, accessible legends, or SQL display
- No way to see the underlying data table or export it on most surfaces

Users see different charts behave differently depending on where they appear. There is no design system for data visualization.

## Proposed Solution

### Single Component, Three Variants

```
<UnifiedChart
  spec={chartSpec}           // Extended ChartSpec — the data contract
  variant="compact"          // compact | normal | expanded
  onGrainChange={...}        // optional — parent handles re-query
  onTimeRangeChange={...}    // optional — parent handles re-query
  onAnnotationAdd={...}      // optional — parent handles persistence
  onUpdateSpec={...}         // optional — parent handles spec mutations
/>
```

| Variant | Shows | Hides | Used In |
|---------|-------|-------|---------|
| **Compact** | Title, chart, minimal legend | All controls | Chat inline, segment health |
| **Normal** | Title, chart, time picker, grain picker, legends, type switcher. Table/SQL/export behind tabs | Annotations editor | Board cards, segment workspace, segment composition, metric detail |
| **Expanded** | Everything: all controls visible, full table, SQL, CSV, annotations editor | Nothing | Modal overlay (from any variant via expand button) |

**Compact → Expanded:** Click or expand icon opens a modal overlay with the Expanded variant. No intermediate "Normal" step — compact charts jump straight to full detail.

**Normal → Expanded:** Expand icon in the top-right opens the same modal.

**Expanded → dismiss:** Close modal, return to previous variant. Changes made in the modal (chart type, annotations) are passed back via callbacks if the parent supports persistence.

### MetricContextCard — Special Case

The chat metric context card (`metric-context-card.tsx`) is **not a chart variant** — it is a **metric card** that happens to contain a chart. It has:
- Hero KPI value with change percentage
- Stats grid (high/low/avg)
- Aggregation-aware computation (sum vs latest)
- Trend-based red/green coloring
- Deep-dive link to `/metrics/[id]`

**Decision:** MetricContextCard stays as its own component but replaces its internal standalone recharts with `<UnifiedChart variant="compact" />`. The card wraps the chart, keeping its hero value, stats grid, and link. This gives it consistent chart rendering without losing its distinctive UX.

### Metric Detail Page — Absorption

`metric-chart.tsx` is absorbed entirely into UnifiedChart. Its period tabs become the standard time picker. Its trend-based coloring becomes a `trendColor` prop. Metric detail page renders `<UnifiedChart variant="normal" />` with time picker and grain picker callbacks wired to client-side filtering (metric data is pre-loaded).

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    UnifiedChart                      │
│  ┌───────────────────────────────────────────────┐  │
│  │  ChartShell (title bar, controls, expand btn) │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  ChartCore (recharts rendering engine)  │  │  │
│  │  │  Line | Bar | Area | Pie | Scatter      │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  ChartControls (variant-dependent)      │  │  │
│  │  │  TimePicker | GrainPicker | TypeSwitch  │  │  │
│  │  │  LegendBar (a11y shapes)                │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  ChartDrawer (tabs: Table | SQL | CSV)  │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  ExpandedModal (wraps UnifiedChart expanded)  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Component breakdown:**

| Component | Responsibility |
|-----------|---------------|
| `UnifiedChart` | Top-level. Receives spec + variant + callbacks. Orchestrates layout. |
| `ChartShell` | Title (editable when callback provided), expand button, variant-dependent chrome |
| `ChartCore` | Pure recharts rendering. Replaces current `ReportChart` internals. All 5 chart types. Single color system. A11y legends. |
| `ChartControls` | Time picker, grain picker, chart type switcher, stacked toggle. Hidden in compact. |
| `ChartLegend` | Custom legend with shapes (circle, square, triangle, diamond, cross) + color for a11y. Not recharts default Legend. |
| `ChartDrawer` | Tab panel below chart: Data Table (sortable, paginated) / SQL (highlighted, copy button) / Export (CSV download). Hidden in compact. |
| `ExpandedModal` | Dialog overlay rendering UnifiedChart with `variant="expanded"`. Triggered from any variant. |
| `AnnotationsLayer` | Reference lines, markers, user notes overlaid on the chart. Editable in expanded. Read-only in normal. Hidden in compact. |

### Extended ChartSpec

```typescript
// src/lib/chart-types.ts — backward-compatible extension
interface ChartSpec {
  // --- existing fields (unchanged) ---
  type: "bar" | "line" | "area" | "pie" | "scatter";
  title: string;
  data: Record<string, string | number>[];
  xKey?: string;
  yKeys?: string[];
  yLabels?: string[];
  nameKey?: string;
  valueKey?: string;
  format?: Record<string, "number" | "currency" | "percent">;
  highlight?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  stacked?: boolean;
  forecastKeys?: string[];
  forecastStartX?: string | number;

  // --- new fields ---
  sql?: string;                          // source SQL query (for display + re-query)
  grain?: "daily" | "weekly" | "monthly"; // current aggregation granularity
  dateRange?: { start: string; end: string }; // current time window
  currency?: string;                     // "$", "EUR", "INR" — from DatasetConfig
  annotations?: ChartAnnotation[];       // user-defined markers
  datasetId?: string;                    // for dataset-aware operations
}

interface ChartAnnotation {
  id: string;
  x: string | number;        // x-axis position
  label: string;              // annotation text
  type: "marker" | "line";    // vertical line or point marker
  color?: string;             // optional override
}
```

### UnifiedChart Props

```typescript
interface UnifiedChartProps {
  spec: ChartSpec;
  variant?: "compact" | "normal" | "expanded";  // default: "normal"

  // Data
  fullData?: Record<string, unknown>[];  // full result set for table view (spec.data may be sliced)

  // Controls behavior
  onGrainChange?: (grain: "daily" | "weekly" | "monthly") => void;
  onTimeRangeChange?: (range: { start: string; end: string } | string) => void;  // string = preset like "30d"
  onTypeChange?: (type: ChartSpec["type"], stacked?: boolean) => void;

  // Mutations
  onTitleChange?: (title: string) => void;
  onAnnotationAdd?: (annotation: ChartAnnotation) => void;
  onAnnotationRemove?: (id: string) => void;
  onUpdateSpec?: (updates: Partial<ChartSpec>) => void;

  // Canvas integration
  canvasMode?: boolean;  // enables three-zone pointer events
  isSelected?: boolean;
  isEditing?: boolean;

  // Display
  height?: number | string;
  className?: string;
}
```

### Grain & Time Range — Data Pipeline

**The UnifiedChart component never fetches data.** It renders what it receives. The parent is responsible for re-querying.

**Pattern:**

```
User changes grain → onGrainChange("weekly") fired
  → Parent decides how to get new data:
     • Board cards: POST /api/canvas-query with modified SQL (DATE_TRUNC swap)
     • Metric detail: client-side re-aggregate from full time series
     • Segment charts: POST /api/segments/[id]/overview?grain=weekly
     • Chat inline: grain picker DISABLED (no re-query path — data is from LLM stream)
```

**When callbacks are not provided, the corresponding picker is hidden.** This means:
- Chat inline charts: no grain/time pickers (compact variant, no callbacks)
- Board cards: grain + time pickers shown (parent wires to canvas-query)
- Metric detail: time picker shown, grain picker shown (both client-side filter)
- Segment health: time picker shown (API re-query), grain picker shown

**New API support needed:**
- `POST /api/chart-requery` — takes `{ sql, grain, dateRange, datasetId }`, swaps `DATE_TRUNC` in SQL, re-executes, returns new data
- This single endpoint serves board cards, segment charts, and any surface with source SQL
- Falls back to the original SQL if DATE_TRUNC substitution fails

### Color System — Single Canonical Palette

**One green accent, one neutral ramp:**

```typescript
// src/lib/chart-colors.ts
export const CHART_ACCENT = "#22c55e";  // green-500 — canonical, used everywhere
export const CHART_NEGATIVE = "#ef4444"; // red-500 — for negative trends only

export const CHART_PALETTE = [
  CHART_ACCENT,
  "var(--color-muted-foreground)",  // series 2
  "color-mix(in srgb, var(--color-muted-foreground) 70%, transparent)",  // series 3
  "color-mix(in srgb, var(--color-muted-foreground) 50%, transparent)",  // series 4
  "color-mix(in srgb, var(--color-muted-foreground) 35%, transparent)",  // series 5
  "color-mix(in srgb, var(--color-muted-foreground) 25%, transparent)",  // series 6
];

// Accessibility: shapes per series (used in legends + scatter)
export const CHART_SHAPES: Array<"circle" | "square" | "triangle" | "diamond" | "cross"> = [
  "circle", "square", "triangle", "diamond", "cross",
];
```

**Replaces:** `#10b981` in forecast/metric charts, `SCATTER_COLORS` array, `SERIES_COLORS` in explorer. Everything converges to `CHART_PALETTE`.

### Accessible Legends

Custom `<ChartLegend>` component (not recharts `<Legend>`):

```
[●] Revenue   [■] Users   [▲] Sessions   [◆] Conversion
```

Each series gets a unique **shape + color** combination. Shapes are rendered as small SVG icons in the legend row. On the chart itself:
- Line charts: different `strokeDasharray` patterns per series (solid, dashed, dotted, dash-dot)
- Scatter charts: different marker shapes (already supported by recharts)
- Bar/area: shapes only in legend (bars are distinguishable by position)

This ensures the chart is readable in grayscale printing and by color-blind users.

### Annotations

**Creation:** In expanded variant, click on the chart area to place a vertical reference line with a label input. Or click "Add annotation" button and enter an x-value manually.

**Rendering:** `<ReferenceLine>` from recharts with a label badge above the chart area.

**Persistence:** Via `onAnnotationAdd` / `onAnnotationRemove` callbacks. Board cards persist to board store. Other surfaces: annotations are session-only (lost on unmount) unless the parent implements persistence.

**Read-only in normal variant:** Annotations render but cannot be added/edited. Must expand to modify.

### CSV Export

```typescript
function exportCSV(spec: ChartSpec, fullData?: Record<string, unknown>[]) {
  const data = fullData ?? spec.data;
  const columns = Object.keys(data[0] ?? {});
  const header = columns.join(",");
  const rows = data.map(row => columns.map(c => JSON.stringify(row[c] ?? "")).join(","));
  const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  // trigger download with filename: `${spec.title}-${new Date().toISOString().split("T")[0]}.csv`
}
```

Available in normal (behind drawer tab) and expanded (visible button) variants.

### Table View

Single `<ChartDataTable>` component used everywhere:
- Columns derived from data keys
- Sortable headers (click to toggle asc/desc)
- Paginated: 20 rows in normal, 50 rows in expanded
- Numeric columns right-aligned with `tabular-nums`
- Currency columns formatted with `spec.currency`
- Horizontal scroll for many columns
- Styled per CLAUDE.md: `bg-muted/50` headers, `hover:bg-muted/30` rows, `border-b border-border`

### SQL Display

`<ChartSQLDisplay>` component:
- Renders `spec.sql` with syntax highlighting (reuse `SqlHighlighted` from `src/lib/sql-highlight.tsx`)
- Copy-to-clipboard button
- If `spec.sql` is undefined, tab is hidden (graceful degradation)

## Implementation Phases

### Phase 1: Foundation — Isolated Build (`/dev/charts`)

Build the component system on a dev-only page with mock data. No app integration.

**Deliverables:**
- `src/components/chart/unified-chart.tsx` — main component
- `src/components/chart/chart-shell.tsx` — title bar + expand button
- `src/components/chart/chart-core.tsx` — recharts rendering (extracted from current report-chart.tsx)
- `src/components/chart/chart-controls.tsx` — time picker, grain picker, type switcher, stacked toggle
- `src/components/chart/chart-legend.tsx` — accessible legend with shapes
- `src/components/chart/chart-drawer.tsx` — tabs: table / SQL / export
- `src/components/chart/chart-data-table.tsx` — sortable, paginated data table
- `src/components/chart/chart-sql-display.tsx` — SQL viewer with copy
- `src/components/chart/chart-annotations.tsx` — reference lines + markers
- `src/components/chart/expanded-modal.tsx` — dialog overlay
- `src/lib/chart-colors.ts` — single color palette + shapes
- `src/lib/chart-types.ts` — extended ChartSpec (backward compatible)
- `src/app/dev/charts/page.tsx` — test harness page

**Test harness must cover:**
- All 5 chart types (line, bar, area, pie, scatter) × 3 variants × dark/light theme = 30 combinations
- Edge cases: empty data, single row (metric), single series, 6+ series, 500+ rows
- Stacked bar, stacked area
- Long x-axis labels, long series names
- Currency/percent/number formatting
- Annotations (add, remove, display)
- Time picker presets + custom range
- Grain switching (mock — just swap data)
- CSV download
- SQL display + copy
- Table pagination + sorting
- Expand modal from compact and normal
- Canvas mode (pointer events)

**Tasks:**

- [ ] `src/lib/chart-colors.ts` — extract canonical palette + shapes from report-chart.tsx
- [ ] `src/lib/chart-types.ts` — add `sql`, `grain`, `dateRange`, `currency`, `annotations`, `datasetId` fields to ChartSpec
- [ ] `src/components/chart/chart-core.tsx` — extract pure recharts rendering from report-chart.tsx. Line, bar, area, pie, scatter. Single color system. No chrome.
- [ ] `src/components/chart/chart-legend.tsx` — custom legend with SVG shapes + color. Interactive (click to toggle series). Not recharts Legend.
- [ ] `src/components/chart/chart-controls.tsx` — time picker (presets: 7d/30d/90d/6m/1y/all + dataset-aware date range), grain picker (daily/weekly/monthly), chart type switcher (icons), stacked toggle
- [ ] `src/components/chart/chart-data-table.tsx` — sortable, paginated, styled per conventions
- [ ] `src/components/chart/chart-sql-display.tsx` — SqlHighlighted + copy button
- [ ] `src/components/chart/chart-annotations.tsx` — ReferenceLine rendering + add/remove UI
- [ ] `src/components/chart/chart-drawer.tsx` — tab panel: Data / SQL / Export
- [ ] `src/components/chart/chart-shell.tsx` — title (editable via callback), expand button, variant-dependent layout
- [ ] `src/components/chart/expanded-modal.tsx` — Dialog overlay wrapping UnifiedChart expanded
- [ ] `src/components/chart/unified-chart.tsx` — compose all subcomponents, variant switching, prop wiring
- [ ] `src/app/dev/charts/page.tsx` — test harness with mock data fixtures for all 30 combinations
- [ ] Visual QA: all chart types × variants × themes render correctly
- [ ] CSV export works (downloads file)
- [ ] Table sorting + pagination works
- [ ] Expand modal opens/closes from both compact and normal
- [ ] Legends toggle series visibility
- [ ] Time picker and grain picker fire callbacks

### Phase 2: Wire to App — Simple Surfaces

Replace existing chart rendering on surfaces that currently use `<ReportChart>` directly. Lowest risk.

**Order:**
1. Segment health tab
2. Segment composition tab
3. Segment workspace size chart
4. Chat inline markdown

**For each surface:**
- Replace `<ReportChart spec={...} />` with `<UnifiedChart spec={...} variant="compact|normal" />`
- Pass `sql` into ChartSpec if available from the data pipeline
- Wire `onTimeRangeChange` / `onGrainChange` if the surface has a re-query mechanism
- If no re-query mechanism exists, omit callbacks (pickers auto-hide)
- Visually verify: chart looks the same or better

**Tasks:**

- [ ] `src/components/segments/health-tab.tsx` — replace ReportChart with UnifiedChart compact, pipe `sql` from API response if available
- [ ] `src/components/segments/composition-tab.tsx` — replace ReportChart with UnifiedChart normal, pipe `sql`
- [ ] `src/components/segments/segment-workspace.tsx` — replace size chart ReportChart with UnifiedChart normal + time picker callback (filter sizeOverTime data client-side)
- [ ] `src/lib/markdown.tsx` — replace `<ReportChart spec={spec} />` with `<UnifiedChart spec={spec} variant="compact" />`
- [ ] Visual verification: all 4 surfaces render correctly in dark/light theme
- [ ] Expand modal works from all 4 surfaces

### Phase 3: Wire to App — Complex Surfaces

Replace board card chart renderer and metric detail page. These have more interaction complexity.

#### Board Cards

`chart-renderer.tsx` currently wraps ReportChart with its own tab bar and type switcher. Replace the entire component with `<UnifiedChart variant="normal" canvasMode />`.

**Migration:**
- Remove `ChartTypeSwitcher` component from chart-renderer.tsx (absorbed into ChartControls)
- Remove the Table tab implementation (absorbed into ChartDrawer)
- Pass `item.sql` into ChartSpec.sql
- Pass `item.data` as `fullData` prop (for table view with all rows)
- Wire `onUpdateSpec` to `onUpdateCard` (persists type/grain/annotations to board store)
- Wire `onGrainChange` / `onTimeRangeChange` to new `/api/chart-requery` endpoint
- Preserve canvas pointer event model via `canvasMode` + `isSelected` + `isEditing` props

**Tasks:**

- [ ] `src/components/canvas/card-renderers/chart-renderer.tsx` — replace with UnifiedChart, wire canvasMode + callbacks
- [ ] Ensure three-zone pointer events work (header interactive when selected, content pass-through)
- [ ] Board card type switching works (line/bar/area/pie)
- [ ] Board card table tab shows full data with sort + pagination
- [ ] Board card SQL tab shows source SQL with copy
- [ ] Board card CSV export downloads
- [ ] Board card grain/time changes trigger re-query and update card data

#### Metric Detail Page

Absorb `metric-chart.tsx` entirely.

**Migration:**
- Remove `src/components/metric/metric-chart.tsx`
- Replace with `<UnifiedChart variant="normal" />` in metric detail page
- Wire `onTimeRangeChange` to client-side filtering (metric time series is pre-loaded)
- Wire `onGrainChange` to client-side re-aggregation (group by week/month from daily data)
- Map metric `valueFormat` to ChartSpec `format`
- Pass `currency` from DatasetConfig

**Tasks:**

- [ ] `src/components/metric/metric-chart.tsx` — delete, replace usage with UnifiedChart normal
- [ ] Metric detail page: wire time picker to client-side date filtering
- [ ] Metric detail page: wire grain picker to client-side aggregation
- [ ] Verify: trend colors still work (green up / red down)
- [ ] Verify: period availability detection (dim unavailable presets)

#### MetricContextCard

Replace only the internal recharts rendering. Keep the card wrapper.

**Tasks:**

- [ ] `src/components/chat/metric-context-card.tsx` — replace internal AreaChart with `<UnifiedChart variant="compact" />`
- [ ] Preserve: hero KPI, change %, stats grid, deep-dive link
- [ ] Verify: time tab switching still filters data correctly
- [ ] Verify: trend-based coloring (green/red) still works

### Phase 4: Backend — Re-query Endpoint

Build the `/api/chart-requery` endpoint for grain and time range changes.

**Tasks:**

- [ ] `src/app/api/chart-requery/route.ts` — POST handler: receives `{ sql, grain, dateRange, datasetId }`, modifies SQL (DATE_TRUNC swap, WHERE clause date filter), executes via `executeSQLInternal`, returns `{ data, columns }`
- [ ] SQL modification logic: parse and replace `DATE_TRUNC('day', ...)` → `DATE_TRUNC('week', ...)` etc. Add/replace `WHERE date_col BETWEEN ... AND ...` for date range.
- [ ] Validation: SELECT-only, dataset-id validation, error handling
- [ ] Wire board card `onGrainChange` / `onTimeRangeChange` to this endpoint
- [ ] Wire segment chart callbacks to this endpoint

### Phase 5: Cleanup

Remove old chart components and dead code.

**Tasks:**

- [ ] Delete `src/components/chart/report-chart.tsx` (replaced by chart-core.tsx)
- [ ] Delete `src/components/metric/metric-chart.tsx` (absorbed into UnifiedChart)
- [ ] Remove standalone recharts imports from `metric-context-card.tsx`
- [ ] Remove `ChartTypeSwitcher` from `chart-renderer.tsx`
- [ ] Remove unused color constants (ACCENT, NEUTRALS, SCATTER_COLORS from report-chart.tsx)
- [ ] Update `chart-inference.ts` to populate new ChartSpec fields (sql, grain, currency)
- [ ] Update `/api/board-generate` and `/api/board-from-research` to include `sql` in generated ChartSpecs
- [ ] Grep for any remaining `<ReportChart` imports — should be zero
- [ ] Grep for remaining direct recharts imports outside of chart-core.tsx — should be zero (except forecast/explorer which are out of scope)

## System-Wide Impact

### Interaction Graph

`UnifiedChart` renders in 7 surfaces. Changing its behavior affects:
- Board system: card-renderer.tsx → ChartRenderer → UnifiedChart → board-store (persist type/annotations)
- Chat: markdown.tsx → UnifiedChart (compact, no persistence)
- Chat: metric-context-card.tsx → wraps UnifiedChart (compact, parent controls time)
- Segments: health-tab/composition-tab/segment-workspace → UnifiedChart (normal, API re-query)
- Metrics: metric detail page → UnifiedChart (normal, client-side filter)

### Error Propagation

- `ChartCore` catches recharts rendering errors via React error boundary → shows "Chart could not be rendered" fallback (existing pattern from markdown.tsx)
- `/api/chart-requery` errors → UnifiedChart shows inline error message, preserves current data
- CSV export errors (empty data) → disabled button state
- SQL display with undefined SQL → tab hidden, not error

### State Lifecycle Risks

- **Grain/time changes with no callback:** Pickers auto-hide. No broken state possible.
- **Expand modal with mutations:** If user changes chart type in modal and parent has no `onUpdateSpec`, changes are lost on modal close. This is documented behavior — not a bug.
- **Board card data race:** If grain change triggers re-query while previous query is in-flight, use AbortController pattern (existing in use-analytics.ts).

### API Surface Parity

These files expose chart rendering and all need updating:
- `chart-inference.ts` — `inferChartSpec()` must populate new fields
- `board-generate/route.ts` — `buildChartSpec()` must include `sql`
- `board-from-research/route.ts` — must pipe `query.sql` into ChartSpec
- `canvas-query/route.ts` — must pipe SQL into card ChartSpec

## Acceptance Criteria

### Functional Requirements

- [ ] All 7 surfaces render charts via `<UnifiedChart>`
- [ ] All charts have: title, x-axis, y-axis, accessible legend
- [ ] Normal/expanded charts have: time picker, grain picker, type switcher, table/SQL/CSV tabs
- [ ] Compact charts expand to modal on click/button
- [ ] Chart type switching works for all types (line, bar, area, pie, scatter) with stacked toggle for bar/area
- [ ] Time picker fires callback, parent re-queries, chart updates
- [ ] Grain picker fires callback, parent re-queries, chart updates
- [ ] CSV export downloads a .csv file with chart data
- [ ] SQL tab shows source SQL with syntax highlighting and copy button
- [ ] Data table is sortable and paginated
- [ ] Annotations can be added/removed in expanded variant
- [ ] Annotations render as reference lines in normal and expanded
- [ ] Canvas pointer events work (three-zone model preserved)

### Non-Functional Requirements

- [ ] Legends are color-blind accessible (shapes + colors, not color alone)
- [ ] Charts render correctly in dark and light themes
- [ ] Charts handle empty data gracefully (empty state, not crash)
- [ ] Charts handle 500+ data points without jank (test with recharts performance)
- [ ] No regressions in existing chart rendering (visual comparison)

### Quality Gates

- [ ] Zero direct recharts imports outside `chart-core.tsx` (excluding forecast/explorer out-of-scope files)
- [ ] Zero remaining `<ReportChart` imports
- [ ] `/dev/charts` page exercises all 30 combinations (5 types × 3 variants × 2 themes)
- [ ] All existing chart surfaces visually verified in both themes

## Dependencies & Prerequisites

- **No external dependencies needed.** Recharts 3.7 already supports everything required.
- **shadcn/ui components used:** Dialog (expanded modal), Tabs (drawer), Button, DropdownMenu (type switcher)
- **Backend prerequisite:** Phase 4 (`/api/chart-requery`) blocks grain/time switching on board cards and segments. Phase 1-3 can proceed without it — pickers simply won't appear until callbacks are wired.

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Canvas pointer events break after chart-renderer replacement | High — board cards become unresponsive | `canvasMode` prop preserves exact current behavior. Test in canvas AND document view. |
| Recharts performance with 500+ points after grain change to daily | Medium — chart becomes sluggish | Data sampling: if rows > 300, downsample by picking every Nth point. Show "Showing 300 of 1,200 points" indicator. |
| MetricContextCard loses its distinctive feel | Medium — UX regression | MetricContextCard keeps its wrapper. Only the internal recharts is swapped. Visual parity test required. |
| SQL unavailable on most surfaces initially | Low — SQL tab just hidden | Graceful degradation: tab hidden when `spec.sql` is undefined. No broken state. |
| Date range re-query on chat inline charts impossible | Low — picker hidden | No callback = no picker. Users expand to modal to see data table instead. |

## Future Considerations

- **Formula-based metrics:** When the formula engine is built, metric charts may need to render computed series. UnifiedChart's multi-series support handles this naturally.
- **Real-time streaming data:** If live data feeds are added, ChartCore would need an append-only data mode. Not needed now.
- **Collaborative annotations:** If multiple users view the same board, annotations could be synced. Current design supports this via the callback pattern — just wire to a real-time store.
- **Chart templates:** Saved chart configurations (type + grain + range + annotations) that can be applied to new data. The extended ChartSpec already carries all this state.

## Sources & References

### Internal References

- Current ReportChart: `src/components/chart/report-chart.tsx` (836 lines — to be replaced by chart-core.tsx)
- ChartSpec type: `src/lib/chart-types.ts` (extended in this plan)
- Chart inference: `src/lib/chart-inference.ts` (inferCardType, inferChartSpec — updated in Phase 5)
- Board card renderer: `src/components/canvas/card-renderers/chart-renderer.tsx` (replaced in Phase 3)
- Metric chart: `src/components/metric/metric-chart.tsx` (deleted in Phase 3)
- Metric context card: `src/components/chat/metric-context-card.tsx` (internal swap in Phase 3)
- SQL highlighting: `src/lib/sql-highlight.tsx` (reused for SQL tab)
- Board store: `src/lib/board-store.ts` (persistence for chart mutations)

### Institutional Learnings

- Card renderers must be context-free — no tldraw hooks: `docs/solutions/runtime-errors/tldraw-useeditor-crash-outside-canvas-context-20260315.md`
- Three-zone pointer events for canvas cards: `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`
- Recharts consistency — use CustomTooltip, CartesianGrid with dasharray, neutral palette: `docs/solutions/best-practices/recharts-consistency-custom-tooltip-Forecasting-20260220.md`
- ChartSpec extension pattern (type → builder → renderer): `docs/plans/2026-03-11-feat-chartspec-axis-labels-passthrough-plan.md`
- Board grid must be fixed 2-column, not auto-fill: `docs/solutions/ui-bugs/board-grid-auto-fill-shows-3-columns-instead-of-2.md`
