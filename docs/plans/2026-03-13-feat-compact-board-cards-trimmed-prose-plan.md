---
title: "Compact Board Cards + Trimmed Prose"
type: feat
status: completed
date: 2026-03-13
---

# Compact Board Cards + Trimmed Prose

## Overview

Replace full chart cards (420px) with metric-tree-style compact cards (~80px) as the default in board document view. Trim section prose from 30-50 words to a 20-word max verdict. Full charts remain available only when the trend shape is the specific insight.

## Implementation

### Step 1: Extract CompactMetricCard from MetricTreeNode

**New file:** `src/components/board/compact-metric-card.tsx`

Extract a pure presentational component from `src/components/metric-tree/metric-tree-node.tsx` (lines 25-101). Remove ReactFlow dependencies (`Handle`, `NodeProps`). Keep:

- Status dot (reuse `StatusIndicator`)
- Name (xs, semibold, truncated)
- Value via `formatValue()` (lg font) + delta badge (10px, green/red)
- Mini sparkline SVG (48x20 polyline) — reuse `buildSparklinePath()`
- Category label (10px, muted)

Props interface — map from `BoardCard` data:

```typescript
interface CompactMetricCardProps {
  title: string;
  value: string;           // pre-formatted (heroMetric or first row value)
  delta?: string;          // heroDelta or computed
  sparklineValues?: number[]; // from card.data time series
  category?: string;
  status?: "healthy" | "partial" | "enrichment_needed" | "unavailable";
}
```

Width: `100%` (fills grid cell). Height: auto, roughly 70-80px.

### Step 2: Wire CompactMetricCard into card-renderer.tsx

**File:** `src/components/board/card-renderer.tsx`

In document context, when `card.type === "metric"`, render `CompactMetricCard` instead of the canvas `MetricRenderer`. Extract props from the BoardCard:

```typescript
case "metric":
  if (isDocument) {
    const sparkVals = card.data?.map(row => {
      const numVal = Object.values(row).find(v => typeof v === "number");
      return typeof numVal === "number" ? numVal : 0;
    });
    content = (
      <CompactMetricCard
        title={card.title}
        value={card.heroMetric ?? "—"}
        delta={card.heroDelta}
        sparklineValues={sparkVals}
      />
    );
    break;
  }
  content = <MetricRenderer {...rendererProps} />;
  break;
```

### Step 3: Update CARD_HEIGHTS for metric type in document mode

**File:** `src/components/board/section-card-grid.tsx`

The current `CARD_HEIGHTS.metric = 160` is for the canvas MetricRenderer. For document view compact cards, the height should be ~80px. Two options:

**Option A (simple):** Change metric height to 80 globally. Canvas MetricRenderer still works at 80px (it flexes).

**Option B (context-aware):** Pass context to SectionCardGrid and use different heights. More complex.

Go with **Option A** — set `metric: 80` in CARD_HEIGHTS. The MetricRenderer in canvas has its own height from the card's `size.height` field, not from CARD_HEIGHTS (which is document-view only).

### Step 4: Update board-generate prompt — 20-word prose + compact cards

**File:** `src/app/api/board-generate/route.ts`

Change the Gemini prompt:

**Prose:** Replace "tight 30-50 word insight" with:
> "Each section gets a single-sentence verdict — max 20 words. What the numbers can't say alone. Not a description, not a summary. Just the 'so what.'"

**Card types:** Add instruction:
> "Default to type 'metric' for most cards — these render as compact cards with sparkline, value, and delta. Only use type 'chart' when the trend shape or pattern over time IS the specific insight (volatility, trend breaks, seasonality). Most sections should be 2-4 metric cards in grid-2 or grid-3."

**Layout guidance update:**
- `"full"` — 1 chart card (only when trend shape matters)
- `"grid-2"` — 2 compact metric cards (comparisons)
- `"grid-3"` — 3 compact metric cards (KPI scorecards)

### Step 5: Update board-from-research prompt — same changes

**File:** `src/app/api/board-from-research/route.ts`

In `generateSectionInsights()`, change the prose instruction from "30-50 words" to "max 20 words, single-sentence verdict."

For card type inference: the current `inferCardType()` in `chart-inference.ts` decides chart/metric/table based on columns and rows. Update its logic or add a preference:
- Single row with 1-2 numeric columns → `"metric"` (compact)
- Time series data (date column + value) → still use `inferCardType()` but bias toward `"metric"` unless the query description explicitly mentions trend/pattern/volatility

### Step 6: Ensure board-generate returns heroMetric + heroDelta + data for metric cards

**File:** `src/app/api/board-generate/route.ts`

When building cards of type `"metric"`, the API must populate:
- `heroMetric`: formatted value from the latest data point
- `heroDelta`: percentage change vs previous period
- `data`: the time series rows (for sparkline rendering)

Check that the existing card-building logic already does this. If not, add extraction from the SQL result rows.

## Acceptance Criteria

- [x] CompactMetricCard renders: title, value, delta (green/red), sparkline SVG, in ~80px
- [x] Document view uses CompactMetricCard for type "metric" cards
- [x] Board-generate creates metric-type compact cards by default, chart only for trend-shape insights
- [x] Section prose is max 20 words (single-sentence verdict)
- [x] Sparkline renders from card.data time series
- [x] Full chart cards still work when type is "chart"
- [x] Monochrome — no color accents except delta green/red
- [x] Canvas view unaffected (uses its own MetricRenderer)

## Files Changed

| File | Change |
|------|--------|
| `src/components/board/compact-metric-card.tsx` | **New** — standalone compact card extracted from metric tree node |
| `src/components/board/card-renderer.tsx` | Route metric type to CompactMetricCard in document context |
| `src/components/board/section-card-grid.tsx` | Update CARD_HEIGHTS.metric to 80 |
| `src/app/api/board-generate/route.ts` | Prompt: 20-word prose, default metric type cards |
| `src/app/api/board-from-research/route.ts` | Prompt: 20-word prose |
| `src/lib/chart-inference.ts` | Bias toward "metric" type for single-row results |
