---
name: newname-ref-unused-board-picker
description: newNameRef is declared in board-picker-popover but never read — autoFocus is used instead; dead ref
type: quality
status: pending
priority: p3
issue_id: "109"
tags: [code-review, quality, board-picker, dead-code]
---

## Problem Statement

`board-picker-popover.tsx` declares `const newNameRef = useRef<HTMLInputElement>(null)` and attaches it to the input (`ref={newNameRef}`), but never reads `newNameRef.current` anywhere. The `autoFocus` attribute on the input handles focus automatically. The ref is dead code.

## Proposed Solution

Remove `newNameRef`:
```diff
-  const newNameRef = useRef<HTMLInputElement>(null);
```

Remove `ref={newNameRef}` from the input element. Remove the `useRef` import if it becomes unused.

## Acceptance Criteria

- [ ] `newNameRef` removed
- [ ] Input still auto-focuses when `creating` mode is entered
- [ ] No TypeScript errors

## Work Log

- 2026-03-16: Identified in PR #42 code review via code-simplicity-reviewer agent
