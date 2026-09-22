---
title: "feat: Document View — chart-stack layout + compact follow-up cards"
type: feat
date: 2026-03-15
brainstorm: docs/brainstorms/2026-03-15-document-view-layout-responsiveness-brainstorm.md
---

# feat: Document View — chart-stack layout + compact follow-up cards

## Overview

Two focused improvements to the document view:

1. **`"chart-stack"` section layout** — card[0] (chart) fills the left column; cards[1+] (analysis text, follow-up questions) stack in the right column. Eliminates the large vertical gap that appears when a short analysis text card occupies half a `grid-2` row.

2. **Compact follow-up cards** — replace inline pill chips with compact, full-width bordered cards inside the right column stack. Each card shows the full question text + a right-arrow icon. One card per question, single column.

## Problem Statement

In the current `grid-2` layout, CSS grid forces equal-height cells per row. A chart card (420px tall) paired with a short analysis text card leaves ~70% of the right column empty. Follow-up question chips rendered in a separate full-width section feel like an afterthought — they look like a stacked text list rather than interactive prompts.

## Proposed Solution

Add a `"chart-stack"` layout type rendered as two flex columns:
- Left: the first card (`cards[0]`), pinned at `min-height: 420px`, growing if the right column is taller
- Right: remaining cards stacked with `flex-col gap-3`, auto-height

`deckSlideToSection` in `deck-to-board.ts` conditionally assigns `"chart-stack"` when a chart card is present, keeping the existing `"full"` layout for text-only or empty slides.

`FollowUpChipsRenderer` is restyled from pill chips to compact bordered cards with `ArrowRight` icon.

## ⚠️ Important: All Four Files Must Change in One Commit

The `layoutClasses` record in `SectionCardGrid` is typed as `Record<SectionLayout, string>`. The moment `"chart-stack"` is added to `SectionLayout` in `board-types.ts`, TypeScript requires the record to include the new key. If the record is updated but `deck-to-board.ts` is not (or vice versa), the new layout is either unreachable or causes a broken `className="undefined"` at runtime. Ship all four changes atomically.

## Technical Approach

### Files to Change

| File | Change |
|---|---|
| `src/lib/board-types.ts` | Add `"chart-stack"` to `SectionLayout` union |
| `src/components/board/section-card-grid.tsx` | Custom JSX render path for `"chart-stack"`, fix `follow-up` auto-height, add `follow-up` to `CARD_HEIGHTS` |
| `src/components/board/card-renderer.tsx` | Restyle `FollowUpChipsRenderer`, suppress empty wrapper when all chips dismissed |
| `src/lib/deck-to-board.ts` | Conditionally assign `"chart-stack"` vs `"full"` |

### Files to Leave Unchanged

- `src/app/api/board-generate/route.ts` — AI boards use `"grid-2"` / `"grid-3"` only; `"chart-stack"` is exclusively for deck-derived sections
- `src/app/api/board-from-research/route.ts` — same
- All other inline `SectionLayout` type repetitions (`board-store.ts`, `use-action-handlers.ts`, `document-view.tsx`) — they don't constrain the new value; TypeScript won't error because those inline unions are used only as input types, not as exhaustive Record keys

---

## Acceptance Criteria

### Functional

- [ ] Uploading a PDF deck with chart slides renders each section in `"chart-stack"` layout: chart on the left, analysis + follow-up stacked on the right
- [ ] PDF slides that produce no chart card (text-only) use `"full"` layout, not `"chart-stack"`
- [ ] Follow-up questions render as compact bordered cards with full question text and a right-arrow icon
- [ ] Clicking a follow-up card injects the question into the sidebar chat (existing behavior preserved)
- [ ] Dismissing a follow-up card removes it from the right column stack
- [ ] When all follow-up chips are dismissed, the follow-up card disappears entirely (no empty bordered box)
- [ ] Section collapse animation works correctly for `"chart-stack"` sections (both columns collapse together)
- [ ] Existing `"grid-2"` and `"grid-3"` sections are visually unchanged
- [ ] AI-generated boards (`board-generate`, `board-from-research`) are visually unchanged

### Responsive

- [ ] On mobile (`< md`, 768px), `"chart-stack"` collapses to single column: chart first, then right-column cards below
- [ ] Right column cards are full-width in the single-column view

### Visual

- [ ] Left column chart grows vertically (`min-height: 420px`) if the right column is taller — no misalignment between columns
- [ ] Follow-up cards use `rounded-md border border-border px-3 py-2.5` (not `rounded-full`)
- [ ] Arrow icon is `text-muted-foreground/50`, sized 12px
- [ ] Hover state: `hover:text-foreground hover:bg-muted/50` on the full card button
- [ ] Dismiss X remains hidden until `group-hover/chip`, same behavior as before

---

## Implementation Steps

### Step 1 — Add `"chart-stack"` to the type union

**File:** `src/lib/board-types.ts`, line 18

```typescript
// Before
export type SectionLayout = "full" | "grid-2" | "grid-3";

// After
export type SectionLayout = "full" | "grid-2" | "grid-3" | "chart-stack";
```

---

### Step 2 — Update `SectionCardGrid`

**File:** `src/components/board/section-card-grid.tsx`

**2a. Add `follow-up` to `CARD_HEIGHTS`** (line 14 block)

```typescript
export const CARD_HEIGHTS: Record<string, number> = {
  chart: 420,
  metric: 80,
  table: 380,
  report: 320,
  text: 240,
  sql: 200,
  sticky: 140,
  parameter: 120,
  segment: 160,
  "follow-up": 120,  // add this line — used for ghost placeholder height only
};
```

**2b. Fix `autoHeight` to include `follow-up`** (line 53)

```typescript
// Before
const autoHeight = card.type === "text" || card.type === "report";

// After
const autoHeight = card.type === "text" || card.type === "report" || card.type === "follow-up";
```

**2c. Add `"chart-stack"` to `layoutClasses`** (line 26 block)

```typescript
const layoutClasses: Record<SectionLayout, string> = {
  full: "grid grid-cols-1 gap-4",
  "grid-2": "grid grid-cols-1 md:grid-cols-2 gap-4",
  "grid-3": "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",
  "chart-stack": "",  // handled by custom JSX below — value unused but required for Record<SectionLayout, string>
};
```

**2d. Add the custom JSX render path** — insert before the `return` on line 49:

```tsx
// chart-stack: card[0] fills left column, cards[1+] stack in right column
if (layout === "chart-stack") {
  const [mainCard, ...stackedCards] = cards;
  const mainH = CARD_HEIGHTS[mainCard?.type ?? "chart"] ?? 420;

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* Left column: chart, grows to match right column if taller */}
      {mainCard && (
        <div className="flex-1" style={{ minHeight: mainH }}>
          <CardRenderer
            card={mainCard}
            width={0}
            height={mainH}
            context="document"
            onDelete={onDeleteCard}
          />
        </div>
      )}
      {/* Right column: analysis + follow-up stacked */}
      {stackedCards.length > 0 && (
        <div className="flex-1 flex flex-col gap-3">
          {stackedCards.map((card) => {
            const h = CARD_HEIGHTS[card.type] ?? 300;
            const auto = card.type === "text" || card.type === "report" || card.type === "follow-up";
            return (
              <div
                key={card.id}
                style={{ height: auto ? "auto" : h, minHeight: auto ? h : undefined }}
              >
                <CardRenderer
                  card={card}
                  width={0}
                  height={h}
                  context="document"
                  onDelete={onDeleteCard}
                />
              </div>
            );
          })}
          {deletedCards?.map((dc) => (
            <GhostPlaceholder key={`placeholder-${dc.id}`} height={dc.height} />
          ))}
        </div>
      )}
    </div>
  );
}
```

---

### Step 3 — Update `FollowUpChipsRenderer` in `card-renderer.tsx`

**File:** `src/components/board/card-renderer.tsx`

**3a. Add `ArrowRight` to imports** (line 7):

```typescript
import { X, ArrowRight } from "lucide-react";
```

**3b. Replace the render return in `FollowUpChipsRenderer`** (lines 45–70):

```tsx
// Track whether any visible chips remain
if (visible.length === 0) return null;

return (
  <div className="p-3 flex flex-col gap-2">
    {chips.map((chip, idx) => {
      if (dismissed.has(idx)) return null;
      return (
        <div key={idx} className="flex items-center gap-1 group/chip">
          <button
            type="button"
            onClick={() => injectText(chip, card.silentContext ?? "")}
            className="flex-1 flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-left"
          >
            <span className="flex-1">{chip}</span>
            <ArrowRight size={12} className="shrink-0 text-muted-foreground/50" />
          </button>
          <button
            type="button"
            onClick={() => dismiss(idx)}
            className="opacity-0 group-hover/chip:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted/50 text-muted-foreground"
            aria-label="Dismiss"
          >
            <X size={10} />
          </button>
        </div>
      );
    })}
  </div>
);
```

**3c. Suppress the `CardRenderer` wrapper when `follow-up` content is null**

The `CardRenderer` wrapper always renders a bordered div even when the child returns `null`. For `follow-up` type, this produces an empty hairline box when all chips are dismissed. Fix by wrapping `content` check at the bottom of `CardRenderer`:

After `switch (card.type as string) { ... }` block (line 168), before the `return`:

```tsx
// Don't render the card shell if the content is null (e.g. all follow-up chips dismissed)
if (content === null) return null;
```

---

### Step 4 — Update `deck-to-board.ts` to emit `"chart-stack"`

**File:** `src/lib/deck-to-board.ts`, line 63

Assign `"chart-stack"` only when the slide has chart specs; otherwise use `"full"` for text-only slides (single column, no empty left column).

```typescript
// Before
layout: "grid-2",

// After
layout: slide.chartSpecs && slide.chartSpecs.length > 0 ? "chart-stack" : "full",
```

---

## Edge Cases and Guardrails

| Case | Handling |
|---|---|
| Slide has no chart (text-only PDF slide) | `deck-to-board.ts` assigns `"full"`, not `"chart-stack"` — no empty left column |
| Slide has chart but no commentary | Right column has only the follow-up card; no empty bordered commentary box |
| Slide has chart but no follow-ups | Right column has only the text card; single auto-height card fills the column |
| All follow-up chips dismissed | `FollowUpChipsRenderer` returns `null` → `CardRenderer` returns `null` → no bordered ghost box |
| Chart card deleted by user | Ghost placeholder occupies left column at `CARD_HEIGHTS.chart` (420px) height; right column stays |
| Section collapse | `SectionRenderer` wraps `SectionCardGrid` in `overflow-hidden` — the flex layout inside collapses identically to the CSS grid variants |
| Mobile (< 768px) | `flex-col md:flex-row` — chart stacks above right-column cards |
| Error placeholder card (type "text" at orderInSection 0) | Will appear in the left column at full height — acceptable for an error state |
| AI-generated boards | Never emit `"chart-stack"` — their local `BoardSection` interface excludes it; no type error because those interfaces are local, not exported |

## References

- Brainstorm: `docs/brainstorms/2026-03-15-document-view-layout-responsiveness-brainstorm.md`
- `src/lib/board-types.ts:18` — `SectionLayout` union
- `src/components/board/section-card-grid.tsx:26` — `layoutClasses` record
- `src/components/board/card-renderer.tsx:23` — `FollowUpChipsRenderer`
- `src/lib/deck-to-board.ts:63` — hardcoded `"grid-2"` layout assignment
