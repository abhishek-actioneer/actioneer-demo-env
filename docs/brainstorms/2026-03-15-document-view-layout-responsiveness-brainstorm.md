---
date: 2026-03-15
topic: document-view-layout-responsiveness
---

# Document View Layout: Better Space Utilization & Responsive Follow-ups

## What We're Building

Two focused improvements to the document view layout:

1. **Stacked right column** — when a section has a chart + analysis text + follow-up questions, the analysis and follow-up stack in the right column alongside the chart rather than occupying separate full-width rows. This eliminates the large empty gap beneath short analysis text.

2. **Compact follow-up cards** — follow-up questions rendered as compact individual cards (single-column in context, full padding reduced, question text + arrow indicator) rather than the current pill chips or full-width stacked items.

## Why This Approach

**Wasted space**: The current `grid-2` layout pairs a tall chart card with a short analysis text card. Since both cells are equal height in a CSS grid row, the analysis card leaves ~70% of its column empty. Stacking analysis + follow-ups in the right column fills the vertical space naturally.

**Rigid feel**: The current `FollowUpChipsRenderer` renders inline pill chips in a `flex-wrap` container. Inside a full-width `grid-1` or `grid-2` cell, pills stretch or stack unpredictably. Compact cards are more intentional-feeling — each question is a clear, tappable unit.

**Considered and rejected**: Combining analysis + follow-up into a single card type. That would require changing the data model and the deck-to-board processor. A layout-level fix is purely presentational and zero-risk to the data layer.

## Key Decisions

- **New layout type `"chart-stack"`** added to `SectionLayout` union in `board-types.ts`. This is a two-column layout where card[0] occupies the left column at full height, and cards[1..N] stack vertically in the right column with a `gap-3`.

- **`SectionCardGrid` handles `"chart-stack"`** as a special render path: two `div` columns in a `flex gap-4`, not a CSS grid. The left gets `flex-none` fixed to the chart height (420px), right gets `flex-1 flex flex-col gap-3 overflow-hidden`.

- **`FollowUpChipsRenderer` → compact card style**: Each question becomes a `rounded-md border border-border px-3 py-2.5` card with full question text + a `→` or `ArrowRight` icon on the right. No pills. Single column within the stacked right column. Dismiss X stays on hover.

- **The deck-to-board processor** (`use-deck-upload-to-board.ts`) should emit `layout: "chart-stack"` for sections that contain a chart + text/follow-up combination. Existing `"grid-2"` sections that are purely symmetric (two charts, two metrics) remain unchanged.

## Open Questions

- Should the left-column chart height in `"chart-stack"` be fixed (420px) or stretch to match the right column's natural height? If the right column grows tall (long analysis + 3 follow-up cards), the chart may look short. Could use `min-height: 420px` + let it stretch.
- Should `"chart-stack"` be responsive — collapse to single column on mobile (same as `grid-2` already does at `md:`)?
- Does the deck upload processor (`use-deck-upload-to-board.ts`) have access to section layout at emit time, or does the layout need to be inferred after cards are assigned?

## Next Steps

→ `/workflows:plan` for implementation details
