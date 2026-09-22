---
name: empty-handledragover-yagni
description: handleDragOver in document-view.tsx is a no-op useCallback with a YAGNI comment — should be removed
type: quality
status: pending
priority: p3
issue_id: "108"
tags: [code-review, quality, yagni, document-view]
---

## Problem Statement

`document-view.tsx` defines `handleDragOver` as an empty `useCallback` passed to `DndContext.onDragOver`. The comment says "Could add visual feedback here in the future." This is a YAGNI violation — three lines of no-op code that allocates a memoized function on every render for no current purpose.

## Proposed Solution

Delete `handleDragOver` (lines 289–291) and remove `onDragOver={handleDragOver}` from the `DndContext` JSX.

```diff
-  const handleDragOver = useCallback((_event: DragOverEvent) => {
-    // Could add visual feedback here in the future
-  }, []);
```

Remove `DragOverEvent` from the import if no longer used.

## Acceptance Criteria

- [ ] `handleDragOver` removed from document-view.tsx
- [ ] Drag-and-drop still works correctly (start, over, end)

## Work Log

- 2026-03-16: Identified in PR #42 code review via code-simplicity-reviewer agent
