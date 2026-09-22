---
status: pending
priority: p3
issue_id: "047"
tags: [code-review, quality, dead-code, pr-28]
dependencies: []
---

# Dead `liveResponseIds` prop declared in ChatThread but never consumed

## Problem Statement

`liveResponseIds` is declared in `ChatThreadProps` and passed from `page.tsx`, but is never destructured or used inside `ChatThread`. It is dead code that survived the PR #28 cleanup pass.

## Findings

**Files:**
- `src/components/chat/chat-thread.tsx:42` — declared in interface
- `src/app/page.tsx:404` — passed as `liveResponseIds={liveResponseIds.current}`

The prop exists nowhere in the component body — no destructure, no use.

## Proposed Solutions

### Option A: Remove the dead prop
Remove from `ChatThreadProps` interface and remove from the `<ChatThread>` call in `page.tsx`.

### Option B: Wire it if the streaming indicator feature is planned
If `liveResponseIds` was intentionally kept for a future streaming indicator, add a `TODO` comment and keep it declared but unused.

**Recommended: Option A** (remove it — no evidence of planned usage)

## Acceptance Criteria

- [ ] `liveResponseIds` removed from `ChatThreadProps` interface
- [ ] `liveResponseIds={liveResponseIds.current}` removed from `page.tsx` ChatThread call
- [ ] TypeScript and lint pass

## Work Log

- 2026-03-03: Identified during PR #28 code review (pattern-recognition + code-simplicity agents)
