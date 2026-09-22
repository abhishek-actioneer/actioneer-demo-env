# Chart Visual Parity: Decks ↔ Chat

**Date:** 2026-03-11
**Status:** Brainstorm complete
**Goal:** Make chart cards in the decks/canvas surface look identical to the charts rendered in the main chat interface.

---

## What We're Building

A unified chart appearance across both surfaces. Currently, `ReportChart` has two presentation modes controlled by the `variant` prop:

- `variant="default"` (chat): monochrome grays + green accent, hero stat above, stats footer below, donut pie, hidden Y-axis, SVG gradient on area charts
- `variant="canvas"` (decks/canvas): colorful 8-color palette, no hero stat, no footer, solid pie, visible axes, flat area fill

The goal is to make the canvas/decks variant adopt the full visual language of the chat variant — including the hero stat, stats footer, color scheme, and donut pies — while still working correctly inside the React Flow node frame.

---

## Why This Matters

- **Consistency of meaning**: charts represent data insights. Their visual language (green = positive, monochrome = neutral) should be consistent regardless of where they appear.
- **Reduces cognitive load**: users moving from chat to decks see the same widget, not two different charting systems.
- **CLAUDE.md convention**: "Strictly monochrome UI — no colorful tags, labels, badges, or accents unless specifically requested." The colorful `CANVAS_COLORS` palette violates this.

---

## Current State

```
ReportChart (src/components/chart/report-chart.tsx)
  variant="default"  → chat surface
  variant="canvas"   → canvas/decks surface (via ChartRenderer)

ChartRenderer (src/components/canvas/card-renderers/chart-renderer.tsx)
  - reserves 44px for CardHeader
  - passes remaining pixel height to ChartBody
  - calls <ReportChart variant="canvas" />
```

The chat variant owns its own card shell (`border border-border rounded-xl bg-card`). The canvas/deck surface provides its own card frame via the React Flow node — so simply switching to `variant="default"` would cause double-framing (two borders, two backgrounds).

---

## Key Decisions

### 1. How to handle the card shell conflict

The `variant="default"` wraps itself in a card shell div (border + bg + rounded corners). The React Flow node already provides this frame. We need the visual contents (hero stat, colors, stats footer) without the outer wrapper.

**Decision: Extract shell into an opt-in prop**

Add a `showShell?: boolean` prop (default `true` for backward compat in chat, `false` for canvas). The canvas renders the exact same internals minus the outer `div`.

Alternative considered: Merge the two variants into one, always shell-less, and add the shell in the chat surface's `MarkdownContent` call site — rejected because it changes the chat surface unnecessarily.

### 2. How to handle the explicit pixel height in canvas

`ChartRenderer` passes a computed pixel height to `ChartBody`. The default variant uses a fixed `260px` for the chart. With the hero stat (~80px) and stats footer (~48px), the minimum comfortable height is ~420px.

**Decision: Pass available height through and let `ChartBody` use it minus reserved space**

When `showShell=false` (canvas mode), the chart height becomes: `availableHeight - heroStatHeight(~80) - statsFooterHeight(~48)`. The canvas card will need to be tall enough to show all elements. We can set a minimum card height (e.g. 380px) for chart cards in `ChartRenderer`.

### 3. Eliminate `CANVAS_COLORS`

The colorful palette (`#5B5BD6`, `#3E63DD`, etc.) used only in the canvas variant is discarded. All charts use the monochrome + green-accent palette already defined in `ReportChart`.

---

## Approach

**Single-pass refactor of `ReportChart` + `ChartRenderer`:**

1. **`report-chart.tsx`**: Add `showShell?: boolean` prop (default `true`). When `false`, skip the outer card wrapper but render identical internals (hero stat, monochrome colors, green accent, stats footer, donut, gradient).

2. **`chart-renderer.tsx`**: Switch to `<ReportChart variant="default" showShell={false} height={availableHeight} />`. Remove CANVAS_COLORS. Set minimum canvas chart card height to ~420px.

3. **Remove `variant="canvas"` branch** from `ReportChart` (or keep as deprecated alias pointing to `variant="default" showShell={false}` for safety).

4. **No changes to chat surface** — `MarkdownContent` continues calling `<ReportChart spec={spec} />` with all defaults.

---

## What Changes

| Element | Before (canvas) | After (canvas) |
|---|---|---|
| Colors | 8-color brand palette | Monochrome + green accent |
| Hero stat | Missing | Shown above chart |
| Stats footer | Missing | High/Low/Avg row |
| Pie style | Solid | Donut (innerRadius=55) |
| Area fill | Flat 15% opacity | SVG gradient |
| Y-axis | Visible | Hidden |
| Card shell | None (node provides it) | None (unchanged) |

---

## What Does NOT Change

- Chart data contract (`ChartSpec`) — untouched
- How charts are pinned from chat to canvas — untouched
- Forecast chart — independent component, untouched
- Chat surface rendering — untouched

---

## Open Questions

- Should canvas chart cards have a minimum height enforced by `DeckCanvas` (when converting `Slide` → `BoardCard`), or by `ChartRenderer` itself?
- Is the hero stat always meaningful on a deck slide? (It shows "Total" or "Latest" based on chart type — likely yes, adds context.)
- Should pie charts in canvas also become donuts? (Recommendation: yes, for full parity.)

---

## Scope

**Files to change (estimated):**
- `src/components/chart/report-chart.tsx` — add `showShell` prop, refactor variant branching (~30-50 line change)
- `src/components/canvas/card-renderers/chart-renderer.tsx` — switch variant, remove CANVAS_COLORS, set min height (~10-15 line change)

**Files unchanged:**
- `src/lib/chart-types.ts`
- `src/lib/markdown.tsx`
- `src/components/chat/` (all)
- `src/lib/canvas-store.ts`, `deck-store.ts`

**Effort:** Small — 1-2 hours. No new components, no new APIs, no data model changes.
