---
title: "feat: Pin to current deck canvas from sidebar chat"
type: feat
date: 2026-03-13
---

# feat: Pin to current deck canvas from sidebar chat

## Overview

When on a deck page (`/decks/:id`), clicking "Pin to board" in the sidebar chat should pin the
card to the **current deck's tldraw canvas** — appearing immediately and persisting alongside
other follow-up cards — rather than prompting a generic board picker.

## Problem Statement

`PinButton` uses `getTargetBoardId(datasetId)` to find a pin target. This scans the
`board-store` for boards registered via `saveBoard()`. The deck board (`deck-{deckId}`) is a
synthetic ID — never registered in `boardsMap` — so the picker pops open or the card lands on an
unrelated canvas. Even if the card were saved to `board-store` under `deck-{deckId}`,
`DeckCanvas.populateBoard()` calls `clearBoardCards(boardId)` on every load, wiping cards not in
`deck.followUpCards`.

## Proposed Solution

Reuse the **module-level singleton handler pattern** already established in `canvas-events.ts`
(the `_canvasQueryHandler` / `setCanvasQueryHandler` / `sendCanvasQuery` trio). `DeckCanvas`
registers a handler on mount; `PinButton` checks for it and routes accordingly.

The handler points to `handleFollowUpGenerated`, which already does the three required steps:
1. `saveBoardCard(card)` — board-store
2. `addFollowUpCard(deckId, card)` — deck-store persistence (survives SPA navigation and populates on next deck load)
3. `editorRef.current?.createShapes([cardToShape(card)])` — immediate tldraw canvas appearance

`PinButton.buildCard(deckBoardId)` handles position (`findPackedPosition`) and type-aware sizing
(`CARD_SIZES[cardType]`) before handing the fully-built `BoardCard` to the handler — no changes
needed to `handleFollowUpGenerated`.

## Critical Files

- `src/components/canvas/canvas-events.ts` — add deck-pin handler registry
- `src/components/deck/deck-canvas.tsx` — register handler on mount, clear on unmount
- `src/components/canvas/pin-button.tsx` — detect deck context and reroute

## Implementation

### 1. `src/components/canvas/canvas-events.ts`

Add after the `sendCanvasQuery` block. Requires one new import:

```typescript
import type { BoardCard } from "@/lib/board-types";

/* ── Deck pin bridge ── */

type DeckPinHandler = (card: BoardCard) => void;
let _deckPinHandler: DeckPinHandler | null = null;
let _deckPinBoardId: string | null = null;

/** DeckCanvas calls this on mount to register itself as the active pin target. */
export function setDeckPinHandler(handler: DeckPinHandler | null, boardId?: string) {
  _deckPinHandler = handler;
  _deckPinBoardId = boardId ?? null;
}

/** Returns the board ID of the active deck canvas, or null when not on a deck page. */
export function getDeckPinBoardId(): string | null {
  return _deckPinBoardId;
}

/** Routes a card to the active deck canvas. Returns false if no deck handler is registered. */
export function deckPinCard(card: BoardCard): boolean {
  if (!_deckPinHandler) return false;
  _deckPinHandler(card);
  return true;
}
```

### 2. `src/components/deck/deck-canvas.tsx`

Add one import and one `useEffect` (placed after `handleFollowUpGenerated` is defined):

```typescript
import { setDeckPinHandler } from "@/components/canvas/canvas-events";
```

```typescript
// Register this deck as the active pin target while the canvas is mounted
useEffect(() => {
  setDeckPinHandler((card) => handleFollowUpGenerated(card), boardId);
  return () => setDeckPinHandler(null);
}, [boardId, handleFollowUpGenerated]);
```

The cleanup (`setDeckPinHandler(null)`) prevents stale handler closure issues if the user
navigates away: `editorRef` becomes null after unmount, so `createShapes` would silently no-op
without this guard.

### 3. `src/components/canvas/pin-button.tsx`

Add imports:

```typescript
import { getDeckPinBoardId, deckPinCard } from "@/components/canvas/canvas-events";
```

Replace the `handleClick` body:

```typescript
function handleClick(e: React.MouseEvent) {
  e.stopPropagation();

  if (pinned) {
    toast.info("Already pinned", { description: `"${title}" is already on a board.` });
    return;
  }

  // When on a deck page, pin directly to that deck's canvas
  const deckBoardId = getDeckPinBoardId();
  if (deckBoardId) {
    const card = buildCard(deckBoardId);
    if (deckPinCard(card)) {
      setPinned(true);
      onPinned?.();
      // No "View" action — user is already on the deck canvas
      toast.success("Pinned to deck", { description: title });
    } else {
      toast.error("Failed to pin to deck");
    }
    return;
  }

  // Normal board pin flow (non-deck pages)
  const targetId = getTargetBoardId(datasetId);
  if (targetId) {
    pinToBoard(targetId);
  } else {
    setPickerOpen(true);
  }
}
```

No changes to `buildCard`, `pinToBoard`, or `BoardPickerPopover` — the non-deck path is
unchanged.

## Edge Cases Handled

| Scenario | Behavior |
|---|---|
| User navigates away mid-pin | `setDeckPinHandler(null)` on unmount; falls through to normal board flow |
| Editor not yet ready at pin time | Card persists to `deck.followUpCards`; appears on next `populateBoard` call |
| Two deck tabs open | Last-writer-wins (acceptable for prototype) |
| Non-deck page | `getDeckPinBoardId()` returns null; normal board path executes |

## Acceptance Criteria

- [x] On `/decks/:id`, clicking "Pin to board" shows toast "Pinned to deck" with **no** "View" action button
- [x] Pinned card appears immediately on the tldraw canvas (no reload needed)
- [x] Pinned card survives SPA navigation away and back (repopulated from `deck.followUpCards`)
- [x] On any non-deck page, "Pin to board" behaves exactly as before (board picker / last-used board)
- [x] `pnpm build` passes with no new TypeScript errors

## Verification Steps

1. `pnpm build` — clean compile
2. Navigate to `/decks/:id`
3. Ask a question in the sidebar chat → get an analysis result with a "Pin to board" button
4. Click "Pin" → toast reads **"Pinned to deck"** with just the title, no "View" button
5. Card appears immediately on the deck tldraw canvas
6. Navigate to `/segments`, then back to `/decks/:id` → pinned card is still on canvas
7. Navigate to `/canvas` (a regular board) → the card does **not** appear there
8. On any non-deck page, click "Pin to board" → existing board picker / last-used board behavior unchanged
