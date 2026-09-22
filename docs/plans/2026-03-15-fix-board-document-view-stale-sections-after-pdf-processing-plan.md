---
title: "fix: Board document view shows only one slide after PDF processing completes"
type: fix
date: 2026-03-15
---

# fix: Board document view shows only one slide after PDF processing completes

## Overview

When opening a board for the first time after PDF slides have finished processing, only one slide is shown. The user must click canvas view and switch back to document view to see all processed slides. This is a race condition between the PDF upload stream processing and React's batched state updates in `DocumentView`.

## Problem Statement

`DocumentView` relies on three `useEffect` hooks (lines 70-91) to re-read the board-store when stream state changes. This coupling to `streamState` prop changes is fragile because:

1. **React batching coalesces stream state updates**: When multiple `slide_complete` events arrive in the same NDJSON chunk, React batches all `setStreamState` calls. `streamState` jumps from `{processing, N}` directly to `null`, skipping intermediate states. Effect 2 (which re-reads on processing changes) misses them.

2. **Mount-after-done**: If `DocumentView` mounts after the stream has already completed, `streamState` is `null` from the start. `prevStreamStateRef` starts as `undefined`, so Effect 3's `wasProcessing && !streamState` check evaluates to `false`. The final re-read never fires.

3. **Indirect multi-hop coupling**: Store write → stream notification → CanvasPage state → DocumentView prop → Effect → store re-read. Too many hops, each introducing batching/timing fragility.

### Why switching views "fixes" it

Switching to canvas and back unmounts and remounts `DocumentView`. On remount, Effect 1 reads the store fresh with current `boardId` + `refreshKey`, getting all sections that are now in the store.

## Proposed Solution

Add a **direct board-store change notification channel** (pub/sub pattern matching existing `catalog-invalidation.ts`) and have `DocumentView` subscribe directly to store mutations. This eliminates the indirect stream-state-based re-read path entirely.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Debounce strategy | `requestAnimationFrame` coalescing in subscriber | Prevents 30-40 re-reads during rapid processing; simpler than setTimeout |
| Pub/sub payload | Carries `boardId` parameter | Trivial to add, prevents unnecessary re-reads for other boards |
| Effects 2 and 3 | Delete | They are the root cause; fully replaced by pub/sub |
| Effect 1 (mount read) | Keep | Handles initial data on mount; `refreshKey` path for manual operations |
| `refreshKey` key prop | Keep as-is | Orthogonal to this fix; address in follow-up |
| `useDocumentStream.onUpdate` | Keep | Defense-in-depth; already debounced at 300ms |
| Stream singleton cleanup | Add `setActivePdfStream(null)` after done | Prevents stale `done` state lingering |

## Technical Approach

### Phase 1: Board-store pub/sub

**File: `src/lib/board-store.ts`**

Add a pub/sub notification channel (following `catalog-invalidation.ts` pattern):

```typescript
// --- Board change notification (pub/sub) ---
const _boardChangeListeners = new Set<(boardId: string) => void>();

export function subscribeToBoardChanges(fn: (boardId: string) => void): () => void {
  _boardChangeListeners.add(fn);
  return () => _boardChangeListeners.delete(fn);
}

function notifyBoardChanged(boardId: string) {
  _boardChangeListeners.forEach((fn) => fn(boardId));
}
```

Add `notifyBoardChanged(boardId)` call to these mutation functions:

- [x] `saveBoardCard` — after `cardsMap` mutation (line ~648)
- [x] `removeBoardCard` — after `cardsMap` deletion (line ~690)
- [x] `saveBoardSection` — after `sectionsMap` mutation (line ~855)
- [x] `removeBoardSection` — after `sectionsMap` deletion (line ~881)
- [x] `reorderCardsInSection` — after reorder (line ~906)
- [x] `moveCardToSection` — after move (line ~923)
- [x] `reorderSections` — after reorder (line ~962)
- [x] `clearBoardCards` — after clear (line ~684)
- [x] `populateDemoBoard` — after population (line ~514)

**NOT** added to: `addCardComment`, `saveDismissedChips` (these modify card content, not the card/section list that `DocumentView` tracks).

### Phase 2: DocumentView subscription

**File: `src/components/board/document-view.tsx`**

1. **Add** a `useEffect` that subscribes to `subscribeToBoardChanges` with `requestAnimationFrame` coalescing:

```typescript
// Direct subscription to board-store mutations — replaces stream-state-based re-reads
useEffect(() => {
  let rafId: number;
  const unsub = subscribeToBoardChanges((changedBoardId) => {
    if (changedBoardId !== boardId) return;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      setLiveSections(getBoardSections(boardId));
      setAllCards(getBoardCards(boardId));
    });
  });
  return () => { unsub(); cancelAnimationFrame(rafId); };
}, [boardId]);
```

2. **Delete** Effect 2 (lines 76-80) — stream-state-based re-read during processing
3. **Delete** Effect 3 (lines 83-91) — stream-state transition detection with `prevStreamStateRef`
4. **Keep** Effect 1 (lines 70-73) — mount + `refreshKey` path for manual operations

After these changes, `DocumentView`'s data flow is:
- **Mount**: Effect 1 reads the store (handles data that arrived before mount)
- **Subsequent mutations**: Pub/sub subscriber reads the store (handles mutations after mount)
- **Manual operations**: `refreshKey` bump triggers Effect 1 (existing path, unchanged)
- **`streamState` prop**: Used **only** for progress bar UI (`isProcessing`, skeleton count), not for data re-reads

### Phase 3: Stream singleton cleanup

**File: `src/hooks/use-deck-upload-to-board.ts`**

After the `done` event processing (line 167-174), schedule clearing the singleton:

```typescript
} else if (event.type === "done") {
  removeBoardCard(boardId, `${boardId}-sentinel`);
  setActivePdfStream({
    boardId,
    status: "done",
    completedSlides,
    totalSlides,
  });
  // Clean up singleton after downstream has had time to process
  requestAnimationFrame(() => setActivePdfStream(null));
}
```

## Acceptance Criteria

### Functional Requirements

- [ ] Opening a board after PDF processing completes shows ALL processed slides (not just one)
- [ ] Opening a board during PDF processing shows slides as they complete (live updates)
- [ ] Switching between canvas and document view shows correct sections in both states
- [ ] Normal boards (no PDF processing) continue to work correctly
- [ ] Adding/removing/reordering sections and cards updates the view immediately
- [ ] Drag-and-drop reordering continues to work
- [ ] Demo board auto-generation still works

### Test Scenarios

| Scenario | Expected |
|---|---|
| Upload 5-slide PDF, wait for processing, open board | All 5 sections visible |
| Upload 5-slide PDF, open board during processing | Sections appear one by one, all visible after done |
| Upload 10-slide PDF (slow), toggle views during processing | Consistent section count in both views |
| Open existing board (no stream) | All sections visible (regression check) |
| Add section via NL query input | New section appears immediately |
| Delete a section | Section disappears (ghost placeholder shown) |
| Drag-reorder cards within a section | Order updates immediately |

## Dependencies & Risks

- **Low risk**: The pub/sub pattern is already established in the codebase (`catalog-invalidation.ts`, `dataset-switch.ts`, `deck-to-board-stream.ts`).
- **No API changes**: All changes are client-side.
- **No database changes**: Board-store is localStorage-backed.
- **Backward compatible**: The `streamState` prop is kept for progress UI; only the data re-read path changes.

## References

### Internal References
- `src/lib/catalog-invalidation.ts` — Existing pub/sub pattern to follow
- `src/lib/deck-to-board-stream.ts` — Current stream state singleton
- `src/hooks/use-deck-upload-to-board.ts` — Upload hook writing to board-store
- `src/components/canvas/canvas-page.tsx:40-60` — Stream state subscription + done→null mapping
- `src/components/board/document-view.tsx:70-91` — The three effects being modified

### Learnings Applied
- `docs/plans/2026-03-15-fix-board-document-view-blank-cards-nl-query-plan.md` — Related document-view fix for NL query cards
- `docs/solutions/logic-errors/deck-processing-wrong-sql-context-function.md` — Deck processing uses correct `buildTextToSqlPrompt` (verified)
