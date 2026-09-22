# Forecasting Page Design

## Overview

A Notion-like spreadsheet page at `/forecasting` where users build financial models with configurable metrics (rows) and time-series data (columns). Features a multi-line chart, inline editing, formula engine, CSV export, and an inspect panel for forecast provenance.

## Core Concepts

### Two metric types

- **Base metrics**: Values sourced from seed data. Represent raw measurements (e.g., IAP Revenue, Ad Revenue, Total Cost).
- **Derived metrics**: Computed from other metrics via formulas (e.g., `Gross Profit = {Total Revenue} - {Total Cost}`). Resolved client-side via dependency graph.

### Time configuration

- **Time grain**: Switchable between day, week, and month. Columns adjust accordingly.
- **Forecast divider**: A configurable date that splits the table into historical (actual) and forecast (projected) zones.
- **Forecast method**: Per-row setting — trailing 3-month average (default), playbook-linked, or manual entry.

### Visual hierarchy

- **Indent 0**: Bold label, slightly larger row height. Top-level or summary metrics.
- **Indent 1+**: Normal weight, left-padded 24px per level. Sub-metrics or category breakdowns.

## Data Model

```typescript
// forecast-types.ts

interface ForecastModel {
  id: string;
  name: string;
  timeGrain: 'day' | 'week' | 'month';
  forecastStart: string;              // ISO date — historical/forecast divider
  rows: ForecastRow[];
}

interface ForecastRow {
  id: string;
  label: string;
  type: 'base' | 'derived';
  indent: number;                     // 0 = top-level, 1+ = sub-metric
  format: 'currency' | 'percent' | 'number';
  formula?: string;                   // derived only: "{Revenue} - {Cost}"
  forecastMethod: 'trailing_avg' | 'playbook' | 'manual';
  forecastPlaybookId?: string;        // UI link to playbook (inspect panel)
  overrides?: Record<string, number>; // manual cell edits, keyed by time column
  showOnChart?: boolean;              // whether this row appears in the chart
}
```

Store pattern: `forecast-store.ts` — in-memory `Map<string, ForecastModel>` with `ensureInitialized()` seeding a default model with realistic financial data matching the reference image. Base metric seed data is a separate `Map<string, Record<string, number>>` mapping row IDs to time-keyed values.

## UI Layout

```
┌──────────────────────────────────────────────────────┐
│  Forecasting                             [Export CSV] │
│  Model: Revenue Forecast ▾    Grain: [M] [W] [D]    │
├──────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐    │
│  │  Multi-line time series chart               │    │
│  │  Solid = historical, Dashed = forecast      │    │
│  │  [Series ▾] to pick visible lines           │    │
│  └──────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────┤
│              ← Historical      Forecast →            │
│ Metric     Nov'25 Dec'25 Jan'26 │ Feb'26 Mar'26 ... │
│ ──────────────────────────────────────────────────── │
│ Total Rev  $261k  $261k  $260k  │ $255k  $265k  ... │
│  IAP Rev   $88k   $91k   $94k   │ $87k   $90k   ... │
│  Ad Rev    $170k  $170k  $166k  │ $168k  $175k  ... │
│  Organic   $62k   $64k   $72k   │ $64k   $62k   ... │
│ Total Cost $119k  $119k  $118k  │ $118k  $118k  ... │
│ Gross Prof $141k  $142k  $141k  │ $136k  $146k  ... │
│ Margin %   54.1%  54.4%  54.4%  │ 53.5%  55.3%  ... │
│ ──────────────────────────────────────────────────── │
│ [+ Add Metric]                     [Apply Changes]   │
└──────────────────────────────────────────────────────┘
```

### Styling

- **Historical columns**: Default text color (white in dark mode, dark in light mode).
- **Forecast columns**: Green text (`#4ade80` / similar accent).
- **Forecast divider**: 2px vertical green line spanning the full table height.
- **Sticky first column**: Metric labels stay visible during horizontal scroll.
- Dark theme matches existing app dark mode (using CSS variables).

### Row anatomy

```
[grip] [indent padding] Label    $val  $val  ...  [chart●] [inspect🔍]
```

- **Grip handle**: 6-dot icon, visible on hover, for drag reorder.
- **Chart toggle**: Small circle icon, visible on hover. Filled = shown on chart.
- **Inspect icon**: Magnifying glass, visible on hover. Opens the inspect panel.

## Interactions

### Notion-like table operations

**Row context menu (right-click on row handle):**
- Insert row above / below
- Indent / Outdent
- Duplicate row
- Delete row
- Toggle "Show on chart"

**Column context menu (right-click on column header):**
- Insert column before / after
- Delete column
- Set as forecast start

**Cell editing:**
- Click a cell to enter edit mode (inline input).
- Overridden cells get a subtle dot indicator in the corner.
- `Enter` to confirm, `Escape` to cancel.
- Arrow keys to navigate cells.
- `Tab` / `Shift+Tab` to indent/outdent selected row.

### Apply Changes flow

Adding/removing rows is instant (optimistic UI with skeleton loaders for empty cells). Clicking "Apply Changes" triggers:

1. Base metric values loaded from seed data
2. Formula engine resolves derived rows (topological sort)
3. Forecast values generated (trailing avg for base, formula for derived)
4. Table and chart re-render

## Formula Engine

Client-side, in `forecast-engine.ts`:

1. **Parse**: Convert `"{Total Revenue} - {Total Cost}"` into tokens (metric refs + operators).
2. **Build dependency graph**: Map derived rows to their dependencies.
3. **Topological sort**: Determine evaluation order (detect circular dependencies).
4. **Evaluate**: For each time column, look up base values, compute derived values in order.
5. **Forecast**: For columns past `forecastStart`:
   - Base rows: trailing 3-period average of historical values.
   - Derived rows: apply formula to the forecasted values of dependencies.
   - Manual overrides take precedence over computed values.

Supported operators: `+`, `-`, `*`, `/`, parentheses, numeric literals.

## Chart

- **Library**: Recharts (already in the project).
- **Type**: Multi-line time series. One line per selected metric.
- **Historical vs forecast**: Solid lines for historical, dashed lines for forecast. A subtle vertical reference line at the forecast divider.
- **Series picker**: Dropdown (multi-select checklist) to toggle which metrics appear as lines. Defaults to output/summary metrics only (indent 0 rows with `showOnChart: true`).
- **Tooltip**: Shows values for all visible series at the hovered time point.
- **Colors**: Auto-assigned from a palette (chart accent colors).

## Inspect Panel

A shadcn `Sheet` (slide-in from right) triggered by the inspect icon on each row:

- **For base metrics**: Shows the data source description (seed data info, or conceptual SQL).
- **For derived metrics**: Shows the formula and lists dependent metrics with their current values.
- **For rows with playbook**: Shows the linked playbook name, description, and steps (pulled from `playbook-store`). Mimics the "sources" panel in the chat UI.
- **Header**: Row label + format badge.
- **Footer**: "Edit Metric" button to open the row editor.

## CSV Export

Click "Export CSV" → browser download of the visible table:

- First column: Metric label (with indent indicated by leading spaces).
- Subsequent columns: Time period labels.
- Forecast columns prefixed with `[F]` (e.g., `[F] Feb 2026`).
- Uses `Blob` + `URL.createObjectURL` for download trigger.

## File Structure

```
src/app/forecasting/page.tsx              — page shell ("use client", flex layout)
src/lib/forecast-types.ts                 — TypeScript interfaces
src/lib/forecast-store.ts                 — model store + seed data (Map pattern)
src/lib/forecast-engine.ts                — formula parser, dependency graph, evaluator
src/components/forecast/
  forecast-table.tsx                       — spreadsheet table component
  forecast-chart.tsx                       — Recharts multi-line chart
  forecast-toolbar.tsx                     — grain toggle, model selector, export button
  row-context-menu.tsx                     — right-click menu for rows
  column-context-menu.tsx                  — right-click menu for columns
  cell-editor.tsx                          — inline cell editing overlay
  series-picker.tsx                        — chart series multi-select dropdown
  inspect-panel.tsx                        — slide-in panel for metric provenance
```

Sidebar update: Add `/forecasting` entry to `sidebar.tsx` navigation.

## Seed Data

Default model seeds realistic financial data matching the reference image:
- 7 rows: Total Revenue, IAP Revenue, Ad Revenue, Organic Revenue, Total Cost, Gross Profit, Gross Margin %
- 12 months of data (6 historical, 6 forecast)
- Revenue breakdown: Total = IAP + Ad + Organic (derived formula)
- Gross Profit = Total Revenue - Total Cost (derived)
- Gross Margin % = Gross Profit / Total Revenue * 100 (derived)
- Forecast start: Feb 2026

## Not in scope (for this prototype)

- Real DuckDB query execution for base metrics
- Actual playbook execution for forecasts
- Multi-model management (single default model for now)
- Collaborative editing or persistence beyond in-memory store
- Undo/redo
