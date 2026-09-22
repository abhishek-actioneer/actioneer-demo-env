---
title: "feat: Pass xAxisLabel/yAxisLabel through ChartSpec to chart renderer"
type: feat
date: 2026-03-11
---

# feat: Pass xAxisLabel/yAxisLabel through ChartSpec to chart renderer

## Overview

The deck workflow extracts `xAxisLabel` and `yAxisLabel` from uploaded PDFs via Gemini, but these strings are silently dropped before reaching the chart renderer. The fix is a 3-layer change: add the fields to the `ChartSpec` type, populate them in `buildChartSpec`, and render them via Recharts `label` props.

## Problem Statement

The failure chain has three steps:

1. **Type layer** — `ChartSpec` (`src/lib/chart-types.ts`) has no `xAxisLabel`/`yAxisLabel` fields. There is no place in the type to carry axis title text.
2. **Construction layer** — `buildChartSpec` in `src/app/api/decks/process/route.ts` receives `extracted.xAxisLabel`/`extracted.yAxisLabel` (successfully parsed from PDFs), uses them only as a column-name heuristic, then drops them when building the returned `ChartSpec`.
3. **Rendering layer** — `ReportChart` in `src/components/chart/report-chart.tsx` passes no `label` prop to Recharts `<XAxis>` or `<YAxis>`. YAxis is fully hidden (`hide`) in both the canvas and default variants.

## Proposed Solution

Three targeted changes, one per layer. No structural refactoring needed.

## Acceptance Criteria

- [x] `ChartSpec` type has optional `xAxisLabel?: string` and `yAxisLabel?: string` fields
- [x] `buildChartSpec` in the deck process route populates both fields from `extracted.xAxisLabel`/`extracted.yAxisLabel` when present
- [x] Default variant renders xAxisLabel below the x-axis when the field is present
- [x] Default variant renders yAxisLabel as a rotated label on the y-axis when the field is present (axis line/ticks remain hidden; only the label text shows)
- [x] Canvas variant renders xAxisLabel below the x-axis when the field is present (compact sizing)
- [x] Canvas variant omits yAxisLabel rendering (too cramped at 380px card width)
- [x] When the field is absent/undefined, rendering is identical to current behavior (no regression)
- [x] TypeScript compiles without errors

## Implementation

### Step 1 — `src/lib/chart-types.ts`

Add two optional fields to `ChartSpec`:

```typescript
interface ChartSpec {
  type: "bar" | "line" | "area" | "pie"
  title: string
  data: Record<string, string | number>[]
  xKey?: string
  yKeys?: string[]
  yLabels?: string[]
  nameKey?: string
  valueKey?: string
  format?: Record<string, "number" | "currency" | "percent">
  highlight?: string
  xAxisLabel?: string   // ← add
  yAxisLabel?: string   // ← add
}
```

### Step 2 — `src/app/api/decks/process/route.ts`

In `buildChartSpec`, spread the new fields into the returned object:

```typescript
return {
  type,
  xKey,
  yKeys: [yKey],
  data: ...,
  title: extracted.title,
  ...(extracted.xAxisLabel && { xAxisLabel: extracted.xAxisLabel }),  // ← add
  ...(extracted.yAxisLabel && { yAxisLabel: extracted.yAxisLabel }),  // ← add
};
```

### Step 3 — `src/components/chart/report-chart.tsx`

**Canvas variant XAxis** (around line 636) — add `label` and extra `height` when label present:

```tsx
<XAxis
  dataKey={xKey}
  tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
  tickLine={false}
  axisLine={false}
  height={spec.xAxisLabel ? 32 : 20}
  interval="preserveStartEnd"
  {...(spec.xAxisLabel && {
    label: {
      value: spec.xAxisLabel,
      position: "insideBottom",
      offset: -2,
      fontSize: 8,
      fill: "var(--color-muted-foreground)",
    },
  })}
/>
```

**Canvas variant YAxis** — no change (keep hidden; label omitted at this card size).

**Default variant XAxis** (around line 720) — add `label` and extra `height` when label present:

```tsx
<XAxis
  dataKey={xKey}
  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
  tickLine={false}
  axisLine={false}
  angle={data.length > 6 ? -30 : 0}
  textAnchor={data.length > 6 ? "end" : "middle"}
  height={spec.xAxisLabel ? (data.length > 6 ? 72 : 44) : (data.length > 6 ? 60 : 30)}
  interval={data.length > 12 ? "preserveStartEnd" : 0}
  {...(spec.xAxisLabel && {
    label: {
      value: spec.xAxisLabel,
      position: "insideBottom",
      offset: -4,
      fontSize: 10,
      fill: "var(--color-muted-foreground)",
    },
  })}
/>
```

**Default variant YAxis** (around line 730) — show label-only axis when `yAxisLabel` present:

```tsx
<YAxis
  domain={spec.type === "bar" ? undefined : [yMin, yMax]}
  hide={!spec.yAxisLabel}
  width={spec.yAxisLabel ? 48 : 0}
  tick={false}
  axisLine={false}
  tickLine={false}
  {...(spec.yAxisLabel && {
    label: {
      value: spec.yAxisLabel,
      angle: -90,
      position: "insideLeft",
      offset: 12,
      fontSize: 10,
      fill: "var(--color-muted-foreground)",
    },
  })}
/>
```

## References

- `ChartSpec` type: `src/lib/chart-types.ts:1`
- Deck build function: `src/app/api/decks/process/route.ts:105`
- Slide extraction schema: `src/app/api/decks/process/route.ts:26`
- Chart renderer: `src/components/chart/report-chart.tsx:636` (canvas), `:720` (default)
- Recharts conventions: `docs/solutions/best-practices/recharts-consistency-custom-tooltip-Forecasting-20260220.md`
