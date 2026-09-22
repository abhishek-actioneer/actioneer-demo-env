---
title: "Board Delete Operations with Ghost Placeholders"
type: feat
status: active
date: 2026-03-13
---

# Board Delete Operations with Ghost Placeholders

## Overview

Add delete capability to the board document view for three targets: cards, sections, and prose. Each uses a hover-revealed x button (matching the sidebar board delete pattern) and leaves behind a ghost placeholder with a centered `+` icon for future re-add.

## Key Decisions

- **Placeholders are ephemeral** — stored in React component state, not localStorage. On page refresh or navigation, deleted items are simply gone. This avoids polluting the data model for a transient visual hint.
- **No confirmation dialogs** — keep it frictionless. Cards are low-cost deletes. Sections cascade-delete their child cards, which is higher cost, but a confirmation dialog would slow down the editing flow. (Undo-toast can be added later if needed.)
- **"+" button is inert for now** — renders visually but does nothing on click. Re-add flow is a separate feature.
- **Section delete cascades** — `removeBoardSection` must also remove all child cards. Currently it doesn't — this is a bug fix bundled in.

## Placeholder Visual Spec

All placeholders share the same treatment (monochrome, consistent with existing empty-section pattern):

```
bg-muted/50  border border-dashed border-border  rounded-lg
centered Lucide Plus icon (20x20) text-muted-foreground/50
```

| Target | Placeholder Size |
|--------|-----------------|
| Card | Same height as deleted card (from `CARD_HEIGHTS` lookup), full grid cell width |
| Section | Fixed 80px height, full width |
| Prose | Fixed 48px height, full width (within section, above card grid) |

## Hover X Button Spec

Same pattern as sidebar board items:

```
opacity-0 group-hover:opacity-100 transition-opacity
p-1 rounded hover:bg-muted-foreground/10 text-muted-foreground
```

| Target | X Position | Hover Zone | Notes |
|--------|-----------|------------|-------|
| Card | Top-right corner of card | Card wrapper div (`group`) | — |
| Section | Right end of section header row | Section header row only (`group`) | `e.stopPropagation()` to avoid collapse toggle |
| Prose | Top-right corner of prose block | Prose wrapper div (`group`) | Only shows when hovering prose, not section header |

## Implementation

### Step 1: Fix `removeBoardSection` cascade delete

**File:** `src/lib/board-store.ts`

In `removeBoardSection(boardId, sectionId)`, before removing the section from the array, loop through `cardsMap.get(boardId)` and call `removeBoardCard(boardId, cardId)` for every card where `card.sectionId === sectionId`.

### Step 2: Track placeholder state in `DocumentView`

**File:** `src/components/board/document-view.tsx`

Add component state for deleted items:

```typescript
// Map of cardId -> { height, sectionId } for rendering placeholders in the grid
const [deletedCards, setDeletedCards] = useState<Map<string, { height: number; sectionId: string }>>(new Map());

// Set of deleted sectionIds
const [deletedSections, setDeletedSections] = useState<Set<string>>(new Set());

// Set of sectionIds where prose was deleted
const [deletedProse, setDeletedProse] = useState<Set<string>>(new Set());
```

Create handler functions:

```typescript
function handleDeleteCard(card: BoardCard) {
  const height = CARD_HEIGHTS[card.type] ?? 300;
  setDeletedCards(prev => new Map(prev).set(card.id, { height, sectionId: card.sectionId! }));
  removeBoardCard(board.id, card.id);
}

function handleDeleteSection(sectionId: string) {
  setDeletedSections(prev => new Set(prev).add(sectionId));
  removeBoardSection(board.id, sectionId);
}

function handleDeleteProse(sectionId: string) {
  setDeletedProse(prev => new Set(prev).add(sectionId));
  const section = getBoardSections(board.id).find(s => s.id === sectionId);
  if (section) saveBoardSection({ ...section, prose: "" });
}
```

Pass handlers down to child components as props.

### Step 3: Add delete button to cards

**File:** `src/components/board/card-renderer.tsx`

Wrap existing card div with `group` class. Add absolutely-positioned x button:

```tsx
<div className="relative group">
  {/* existing card render */}
  <button
    onClick={(e) => { e.stopPropagation(); onDelete(card); }}
    className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100
               p-1 rounded hover:bg-muted-foreground/10 text-muted-foreground transition-opacity"
  >
    <X size={14} />
  </button>
</div>
```

### Step 4: Add delete button to section headers

**File:** `src/components/board/section-renderer.tsx`

Add `group` to the header row div. Add x button at the right end, with `e.stopPropagation()` to prevent triggering the collapse toggle:

```tsx
<div className="flex items-center gap-2 group">
  {/* existing chevron + title */}
  <button
    onClick={(e) => { e.stopPropagation(); onDeleteSection(section.id); }}
    className="opacity-0 group-hover:opacity-100 ml-auto p-1 rounded
               hover:bg-muted-foreground/10 text-muted-foreground transition-opacity"
  >
    <X size={14} />
  </button>
</div>
```

### Step 5: Add delete button to prose blocks

**File:** `src/components/board/section-renderer.tsx`

Wrap the prose `MarkdownContent` in a `relative group` div. Add x button top-right:

```tsx
{section.prose && !proseDeleted && (
  <div className="relative group">
    <MarkdownContent content={section.prose} className="text-[13px] text-muted-foreground max-w-3xl" />
    <button
      onClick={() => onDeleteProse(section.id)}
      className="absolute top-0 right-0 opacity-0 group-hover:opacity-100
                 p-1 rounded hover:bg-muted-foreground/10 text-muted-foreground transition-opacity"
    >
      <X size={14} />
    </button>
  </div>
)}
```

### Step 6: Render ghost placeholders

**New file:** `src/components/board/ghost-placeholder.tsx`

Single reusable component:

```tsx
interface GhostPlaceholderProps {
  height: number | string;
  className?: string;
}

export function GhostPlaceholder({ height, className }: GhostPlaceholderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/50",
        className
      )}
      style={{ height }}
    >
      <Plus size={20} className="text-muted-foreground/50" />
    </div>
  );
}
```

Usage in each context:

- **Card placeholder** in `section-card-grid.tsx`: When rendering the card list, interleave real cards and placeholders. For each `deletedCards` entry matching this section, render `<GhostPlaceholder height={entry.height} />` in the grid at that position.
- **Section placeholder** in `document-view.tsx`: When rendering sections, if `deletedSections.has(section.id)`, render `<GhostPlaceholder height={80} />` instead of `<SectionRenderer>`.
- **Prose placeholder** in `section-renderer.tsx`: When `deletedProse.has(section.id)`, render `<GhostPlaceholder height={48} />` instead of `<MarkdownContent>`.

### Step 7: Wire props through component tree

Update prop interfaces:

- `SectionRenderer` gets: `onDeleteSection`, `onDeleteProse`, `proseDeleted`, `onDeleteCard`, `deletedCardIds`
- `SectionCardGrid` gets: `onDeleteCard`, `deletedCards` (Map for heights)
- `CardRenderer` gets: `onDelete`

`DocumentView` orchestrates — reads placeholder state, passes handlers and flags down.

## Acceptance Criteria

- [x] Hovering a card shows x button (top-right), clicking deletes card and shows ghost placeholder at same height
- [x] Hovering a section header shows x button (right end), clicking replaces entire section with 80px placeholder
- [x] Section delete also removes all child cards from store (cascade)
- [x] Hovering prose shows x button, clicking replaces prose with 48px placeholder
- [x] All placeholders: `bg-muted/50`, dashed border, centered `+` icon
- [x] X buttons use `opacity-0 → group-hover:opacity-100` transition
- [x] Section header x does not trigger collapse toggle
- [x] On page refresh, deleted items are gone (no stale placeholders)
- [x] Canvas view reflects deletions (shared store)
- [x] Monochrome only — no color accents

## Files Changed

| File | Change |
|------|--------|
| `src/lib/board-store.ts` | Cascade-delete child cards in `removeBoardSection` |
| `src/components/board/document-view.tsx` | Placeholder state, handlers, conditional rendering |
| `src/components/board/section-renderer.tsx` | X buttons on header and prose, placeholder rendering |
| `src/components/board/section-card-grid.tsx` | Interleave card placeholders in grid |
| `src/components/board/card-renderer.tsx` | X button on card hover |
| `src/components/board/ghost-placeholder.tsx` | **New** — reusable placeholder component |
