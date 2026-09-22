---
title: "CSS auto-fill grid allows 3+ columns instead of fixed 2-column board layout"
description: "Replacing explicit grid-cols-2 with auto-fill minmax(420px, 1fr) caused uncontrolled column count on wide screens"
category: ui-bugs
tags:
  - css-grid
  - tailwind
  - responsive-layout
  - react-flow-migration
  - regression
component: src/components/board/section-card-grid.tsx
date: 2026-03-15
severity: medium
symptoms:
  - "On wide screens (~1572px+), board grid renders 3 columns instead of intended 2"
  - "Chart, analysis, and follow-up cards each occupy their own column instead of chart spanning 2 rows on left"
  - "Board layout visually broken compared to main branch's fixed 2-column design"
  - "auto-fill creates as many columns as fit the container width, ignoring maximum column count intent"
---

## Problem

The `react-flow-migration` branch replaced `main`'s explicit 2-column grid layout in `SectionCardGrid` with CSS `auto-fill`:

```tsx
// Broken — no column cap
const GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 420px), 1fr))",
  gap: "16px",
  alignItems: "start",
  gridAutoFlow: "dense",
};
```

On `main`, the grid used Tailwind `grid grid-cols-1 md:grid-cols-2 gap-4` which hard-caps at 2 columns. The `auto-fill` approach creates as many columns as fit the container — on screens wider than ~1260px (3 × 420px + gaps), 3 columns appear.

**Visible result:** Chart, analysis, and follow-up cards each in their own column. The intended layout is chart spanning 2 rows on the left with analysis + follow-up stacked on the right.

## Solution

### Root Cause

`repeat(auto-fill, minmax(420px, 1fr))` is viewport-responsive in a way that cannot be capped. The old per-layout Tailwind classes enforced a hard `md:grid-cols-2` ceiling that `auto-fill` removed.

### Fix

Replace the `GRID_STYLE` constant with Tailwind breakpoint classes and a minimal inline style:

```diff
- const GRID_STYLE: React.CSSProperties = {
-   display: "grid",
-   gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 420px), 1fr))",
-   gap: "16px",
-   alignItems: "start",
-   gridAutoFlow: "dense",
- };
+ const GRID_DENSE_STYLE: React.CSSProperties = {
+   gridAutoFlow: "dense",
+   alignItems: "start",
+ };

  <div
    ref={combinedRef}
-   style={GRID_STYLE}
-   className={`rounded-md transition-colors ${...}`}
+   style={GRID_DENSE_STYLE}
+   className={`grid grid-cols-1 md:grid-cols-2 gap-4 rounded-md transition-colors ${...}`}
  >
```

- `gridAutoFlow: "dense"` stays as inline style — needed for row-spanning cards to pack correctly
- `alignItems: "start"` prevents cards from stretching to fill row height
- Column count and gap handled by Tailwind: 1 column on mobile, 2 on `md:` breakpoint

### What Was NOT Changed

- **ResizeObserver / `updateColCount`**: Still needed because `SortableCard` receives `colCount` as a prop for `clampSpan()`. The grid transitions between 1 and 2 columns at the `md:` breakpoint, and cards must know the current count.
- **`SortableCard` row-spanning**: `gridRow: "span 2"` for chart/table cards when `colCount >= 2` already works correctly with a fixed 2-column grid.
- **`--col-count` CSS custom property**: Forward-compatible hook set by the ResizeObserver. Not harmful, not removed.

## Prevention

1. **Prefer explicit column counts for board layouts.** `auto-fill` is for fluid galleries where column count should grow unbounded. Board layouts have a design-intentional cap — use `grid-cols-1 md:grid-cols-2`.

2. **Migration checklist: verify grid at 3+ viewport widths.** Check narrow (~640px), medium (~1024px), and wide (~1440px+). `auto-fill` regressions only surface on wide screens.

3. **Diff computed grid properties, not just visual output.** In DevTools, compare `grid-template-columns` between old and new branches at the same viewport. If old shows `repeat(2, 1fr)` and new shows `repeat(auto-fill, ...)`, that's a behavioral change.

4. **Match `main` branch layout tokens unless design spec changes them.** During migrations, default to behavioral parity. If the grid strategy changes, call it out in the PR description.

## Related Documentation

- `docs/plans/2026-03-15-fix-board-breadcrumb-nav-and-responsive-grid-plan.md` — Primary plan file for this fix area
- `docs/plans/2026-03-13-feat-configurable-board-cards-plan.md` — Introduced `colSpan` and `SortableCard`
- `docs/plans/2026-03-13-feat-board-document-view-plan.md` — Original board layout architecture (`grid-2`, `grid-3`)
- `docs/solutions/runtime-errors/reactflow-provider-missing-canvasflow-context.md` — Related React Flow migration context
- `section-card-grid.tsx` is a hotspot — 5+ plan files touch this component; coordinate changes carefully
