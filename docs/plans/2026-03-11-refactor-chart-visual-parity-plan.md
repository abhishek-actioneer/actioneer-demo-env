---
title: "refactor: Unify chart appearance — decks/canvas matches chat"
type: refactor
date: 2026-03-11
brainstorm: docs/brainstorms/2026-03-11-chart-visual-parity-brainstorm.md
---

# refactor: Unify Chart Appearance — Decks/Canvas Matches Chat

## Overview

`ReportChart` has two rendering modes controlled by `variant?: "default" | "canvas"`. The chat surface always uses the default (no prop passed). The canvas/decks surface passes `variant="canvas"`, producing a visually different widget: colorful palette, no hero stat, no footer, solid pie.

**This refactor removes the canvas variant entirely.** There will be one chart style across the product — the chat style. The canvas/decks surface will stop opting into the alternate rendering.

**The chat surface is not modified at all.** No changes to `MarkdownContent`, `ChatThread`, `DocumentView`, or any `src/components/chat/` file.

## What Changes vs. What Doesn't

| | Chat surface | Canvas/Decks surface |
|---|---|---|
| **Files changed** | ❌ None | ✅ `chart-renderer.tsx`, `deck-canvas.tsx`, `shared.tsx`, `canvas-store.ts` |
| **`report-chart.tsx`** | Only dead-code removal | Dead-code removal |
| **Visual output** | Unchanged | Now matches chat exactly |

## The Single Chart Style (chat style, applied everywhere)

- Monochrome grays + green `#22c55e` accent on primary series
- Hero stat above chart (large number, label, trend %)
- 260px chart area
- Stats footer below (High / Low / Avg or Largest / Smallest / Categories)
- Donut pie (`innerRadius={55}`)
- SVG gradient fill on area charts
- Card shell: `border border-border rounded-xl bg-card overflow-hidden`

## Why This Approach

The chat surface calls `<ReportChart spec={spec} />` — no `variant` prop. Removing the `variant="canvas"` branch code has **zero effect** on chat rendering. The "default" rendering is the one true style; the canvas simply needs to stop opting out of it.

No new props, no new abstraction, no `showShell` toggle. Just dead-code removal + one call-site change.

## Acceptance Criteria

- [ ] Charts in deck slides show hero stat, stats footer, monochrome + green accent, donut pie, SVG gradient
- [ ] Charts in the canvas board show the same
- [ ] Chat charts are visually identical to before this change
- [ ] `CANVAS_COLORS` constant is deleted from `report-chart.tsx`
- [ ] `renderCanvasSeries()` function is deleted from `report-chart.tsx`
- [ ] All `variant === "canvas"` branches are deleted from `report-chart.tsx` (4 branch points)
- [ ] `variant="canvas"` prop is removed from the `ReportChart` call in `chart-renderer.tsx`
- [ ] Canvas chart cards are tall enough that the full widget (hero + 260px chart + footer) fits without clipping
- [ ] `pnpm build` passes with no TypeScript errors
- [ ] `pnpm lint` passes with no ESLint errors

## Implementation Steps

### Step 1 — Delete dead code in `report-chart.tsx`

Remove the `variant` prop and all `variant === "canvas"` branches. There are **4 branch points** to remove:

**1a. Prop signature** — remove `variant` from destructuring and interface:
```typescript
// Before:
export function ReportChart({ spec, variant }: { spec: ChartSpec; variant?: "default" | "canvas" })

// After:
export function ReportChart({ spec }: { spec: ChartSpec })
```

**1b. Empty-data guard** (around line 207) — delete the `if (variant === "canvas")` block; keep only the default empty state div.

**1c. Pie chart path** (around line 248) — delete the entire early-return `if (variant === "canvas")` block. The default pie path (card shell + hero stat + donut + footer) is the only path.

**1d. Bar/line/area path** (around line 435) — delete the early-return `if (variant === "canvas")` block (returns bare `ResponsiveContainer` with `CANVAS_COLORS`). The default sectioned layout is the only path.

**1e. Series rendering** — delete `renderCanvasSeries()` function and `CANVAS_COLORS` constant. `renderSeries()` is the only series renderer.

No other changes to `report-chart.tsx`. The default rendering is preserved exactly as-is.

### Step 2 — Update `chart-renderer.tsx`

One line change — remove the `variant` prop from the `ReportChart` call:

```typescript
// Before (line 24):
<ReportChart spec={spec} variant="canvas" />

// After:
<ReportChart spec={spec} />
```

`ChartBody`'s height computation (`shapeH - 44`) continues to set the wrapper height. Since the default `ReportChart` has a natural height of ~388px (80 hero + 260 chart + 48 footer), the canvas card node must be at least 388px + 44px header = **~432px** to avoid clipping. We address this in Step 3.

> **Note on the card shell**: The default `ReportChart` renders its own card shell (`border border-border rounded-xl bg-card overflow-hidden`). The current canvas variant renders none. Switching means the chart now provides its own visual card frame inside the React Flow node. The React Flow node itself is transparent — it provides drag/resize/selection behavior only, not a visual background. This is the correct behavior and matches the user's intent: one unified card style everywhere.

### Step 3 — Update canvas chart card heights

The canvas card minimum height must accommodate the full default widget height.

Natural `ReportChart` height breakdown:
- Header (`CardHeader` in `ChartRenderer`): 44px
- Hero stat section: ~80px
- Chart area: 260px (fixed `h-[260px]` in default variant)
- Stats footer: ~48px
- **Total**: ~432px

Set all chart card height constants to **440px** (small buffer above 432px).

**`src/components/deck/deck-canvas.tsx`:**
```typescript
// Before:
const CARD_H = 340;

// After:
const CARD_H = 440;
```

**`src/components/canvas/shared.tsx`:**
```typescript
// Before:
export const MIN_CARD_HEIGHT: Record<string, number> = {
  chart: 340,
  ...
};

// After:
export const MIN_CARD_HEIGHT: Record<string, number> = {
  chart: 440,
  ...
};
```

**`src/lib/canvas-store.ts`** — update any hardcoded `height: 340` values for chart-type demo items to `height: 440`.

### Step 4 — Verify

```bash
pnpm build    # must pass — no TypeScript errors
pnpm lint     # must pass — no ESLint errors
```

Manual verification:
- Open `/` (chat) — charts look identical to before
- Open `/decks/[id]` — charts show hero stat, monochrome colors, donut pie, stats footer
- Open `/canvas` — same chart widget visible on any chart cards

## Files Changed

| File | Change | Lines affected |
|---|---|---|
| `src/components/chart/report-chart.tsx` | Delete `variant` prop, `CANVAS_COLORS`, `renderCanvasSeries()`, 4 branch blocks | ~60-80 lines deleted |
| `src/components/canvas/card-renderers/chart-renderer.tsx` | Remove `variant="canvas"` prop | 1 line |
| `src/components/deck/deck-canvas.tsx` | `CARD_H` 340 → 440 | 1 line |
| `src/components/canvas/shared.tsx` | `MIN_CARD_HEIGHT.chart` 340 → 440 | 1 line |
| `src/lib/canvas-store.ts` | Demo chart item heights 340 → 440 | 1-2 lines |

**No changes to:**
- `src/components/chat/` (any file)
- `src/lib/markdown.tsx`
- `src/lib/chart-types.ts`
- `src/lib/canvas-store.ts` structure
- `src/lib/deck-store.ts`
- Any API route

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Canvas chart overflows if `shapeH < 432` on existing boards | `MIN_CARD_HEIGHT.chart` enforces 440px minimum at resize; existing small cards are edge case in a prototype app |
| Card shell inside React Flow node creates double-frame | Investigated: current canvas variant has NO card shell. React Flow nodes are transparent. The ReportChart shell becomes the only visible frame — correct behavior. |
| Pie chart: solid → donut affects existing deck slides | Intentional parity change. Donuts are the product-standard pie style. |

## References

- Brainstorm: `docs/brainstorms/2026-03-11-chart-visual-parity-brainstorm.md`
- Chart component (4 variant branch points): `src/components/chart/report-chart.tsx` (~lines 207, 248, 435, renderCanvasSeries)
- Call site to update: `src/components/canvas/card-renderers/chart-renderer.tsx:24`
- Height constants: `src/components/deck/deck-canvas.tsx` (`CARD_H`), `src/components/canvas/shared.tsx` (`MIN_CARD_HEIGHT`)
- Learning: Never use Tailwind arbitrary values with CSS variables in canvas — use `style={{}}` (`docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`)
