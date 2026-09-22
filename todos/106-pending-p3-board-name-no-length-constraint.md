---
name: board-name-no-length-constraint
description: New board name input in board-picker-popover has no max length — arbitrarily long strings stored in memory and shown in toasts
type: quality
status: pending
priority: p3
issue_id: "106"
tags: [code-review, quality, board, validation]
---

## Problem Statement

`handleCreateBoard` in `board-picker-popover.tsx` only validates that `name` is non-empty (`if (!name) return`). There is no maximum length check. A very long board name (e.g., 10,000 chars) would be stored in the in-memory board store and later rendered in toast notifications and the popover list.

## Proposed Solution

Add a max length cap in `handleCreateBoard`:
```typescript
if (name.length > 100) return; // or trim with toast warning
```

Also add `maxLength={100}` to the `<input>` element for browser-level enforcement.

## Acceptance Criteria

- [ ] Board names longer than 100 characters are rejected or truncated
- [ ] Input field has `maxLength={100}` attribute

## Work Log

- 2026-03-16: Identified in PR #42 code review via security-sentinel agent
