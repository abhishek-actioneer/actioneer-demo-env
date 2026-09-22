---
name: reanalyze-no-document-progress-indicator
description: Re-analyze in canvas-top-bar.tsx streams slide updates but never calls setActivePdfStream, so DocumentView progress bar stays hidden during re-analysis
type: bug
status: pending
priority: p2
issue_id: "111"
tags: [code-review, deck, ux, demo]
---

## Problem Statement

When the user clicks "Re-analyze", `handleReanalyze` streams `slide_complete` events and updates sections in board-store. But it never calls `setActivePdfStream`. The `DocumentView` progress bar only appears when `streamState.status === "processing"` — which doesn't happen during re-analyze. Users see the button change to "Re-analyzing..." but the document view shows no feedback while individual slides are updated one-by-one. Sections just flash as they update.

**Why it matters for demo:** Re-analyze is a key demo action (show a different analysis). Without progress indication in the document, it looks frozen until all slides update at once or erratically — doesn't tell the "real-time progressive analysis" story.

## Findings

- `src/components/board/canvas-top-bar.tsx:91-128` — `handleReanalyze` streams `slide_complete` events and saves sections/cards, but:
  - Never calls `setActivePdfStream({ boardId, status: "processing", ... })`
  - Never updates stream with `completedSlides` count
  - `DocumentView` progress bar at line 402: `{(isUploading || isProcessing) && (...)}` — `isProcessing` requires `streamState?.status === "processing"`
- `setActivePdfStream` is **imported** in `canvas-top-bar.tsx` but never **called** (dead import after implementation)

## Proposed Solutions

### Option A — Call `setActivePdfStream` at start/during/end of re-analyze (Recommended)

```typescript
const handleReanalyze = useCallback(async () => {
  if (!deckId || reanalyzing) return;
  setReanalyzing(true);

  // Signal DocumentView to show progress bar
  let completedCount = 0;
  setActivePdfStream({ boardId, status: "processing", completedSlides: 0, totalSlides: 0, stage: "analyzing" });

  try {
    const res = await apiFetch(`/api/decks/${deckId}/reanalyze`, { method: "POST", stream: true });
    // ... stream loop ...
    for (const line of lines) {
      const event = JSON.parse(line);
      if (event.type === "total") {
        setActivePdfStream({ boardId, status: "processing", completedSlides: 0, totalSlides: event.count, stage: "analyzing" });
      } else if (event.type === "slide_complete") {
        const { section, cards } = deckSlideToSection(event.slide, boardId, event.slideIndex);
        saveBoardSection(section);
        for (const card of cards) saveBoardCard(card, { sync: true });
        completedCount++;
        setActivePdfStream({ boardId, status: "processing", completedSlides: completedCount, totalSlides: totalCount });
      }
    }
  } finally {
    setActivePdfStream({ boardId, status: "done", completedSlides: completedCount, totalSlides: completedCount });
    setReanalyzing(false);
  }
}, [...]);
```

Pros: Reuses existing DocumentView progress bar. Consistent with upload experience. Removes dead import.

### Option B — Keep button-only feedback, add inline text under the top bar

Show "Re-analyzing 3 of 8 slides..." as text below the top bar during re-analyze. Simpler but requires new UI element.

## Recommended Action

Option A — call `setActivePdfStream` in the re-analyze loop. This reuses the existing DocumentView progress infrastructure and makes the dead `setActivePdfStream` import live.

## Technical Details

- **Affected file:** `src/components/board/canvas-top-bar.tsx`
- **Dead import to activate:** `setActivePdfStream` from `@/lib/deck-to-board-stream` (imported but unused)
- **DocumentView progress bar:** `src/components/board/document-view.tsx:402` — already handles `streamState.status === "processing"`

## Acceptance Criteria

- [ ] DocumentView progress bar appears during re-analyze (showing "X of Y slides analyzed")
- [ ] Progress bar disappears when re-analyze completes
- [ ] `setActivePdfStream` import is used (not dead)

## Work Log

- 2026-03-16: Identified in PR #44 code review
