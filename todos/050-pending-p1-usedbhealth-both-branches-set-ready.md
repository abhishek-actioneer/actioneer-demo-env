---
status: done
priority: p1
issue_id: "050"
tags: [code-review, bug, react, chat]
dependencies: []
---

# useDbHealth dataset-switch logic bug — both branches set "ready", health recheck never triggered

## Problem Statement
In `chat-state-provider.tsx` lines 51-55, both branches of the `if (prevDataset !== datasetId)` check call `setDbStatus("ready")`. The else branch was clearly meant to call `setDbStatus("checking")` and trigger a recheck for the new dataset. As written, switching datasets never shows the "checking" state, the health check is never triggered for the new dataset, and the UI permanently shows "ready" regardless of actual DB state after a dataset switch.

## Findings
`src/components/chat/chat-state-provider.tsx` lines 53-54:

```typescript
if (healthCache.get(datasetId)) setDbStatus("ready");
else setDbStatus("ready");   // BUG: should be "checking"
```

- The cache-hit branch correctly calls `setDbStatus("ready")` — this is intentional.
- The cache-miss branch also calls `setDbStatus("ready")` — this is the bug. It should set `"checking"` and invoke `checkHealth()` to validate the new dataset.
- Confirmed independently by both the pattern-recognition and performance-and-architecture review agents.
- Practical impact: if a dataset has a broken DB connection, switching to it will display "ready" permanently with no error indication to the user.

## Proposed Solutions

### Option A: Fix the else branch
**Description:** Change the else branch to call `setDbStatus("checking")` followed by `checkHealth()`. This is the minimal, targeted fix that restores the intended control flow.
**Pros:** Minimal change, easy to review and verify. Fixes the bug exactly where it occurs.
**Cons:** Preserves the `getDerivedStateFromProps`-style render-phase state mutation pattern, which is a React anti-pattern (see Option B).
**Effort:** Small
**Risk:** Low

### Option B: Refactor to useEffect on datasetId
**Description:** Remove the render-phase state mutation entirely. Add a `useEffect` with `[datasetId]` as the dependency that checks the cache and either sets `"ready"` immediately or sets `"checking"` and calls `checkHealth()`. This is the idiomatic React pattern for responding to prop/state changes.
**Pros:** Eliminates the render-phase side-effect anti-pattern. More predictable and testable.
**Cons:** Slightly larger diff; requires care not to introduce an infinite loop if `checkHealth` causes re-renders.
**Effort:** Small
**Risk:** Low

## Recommended Action
<!-- Leave blank for triage -->

## Technical Details
- **Affected files:** `src/components/chat/chat-state-provider.tsx`
- **Components:** Chat state provider, DB health status indicator
- **Lines:** ~51-55

## Acceptance Criteria
- [ ] Switching datasets shows a "checking" status indicator briefly before resolving
- [ ] Health check fires for the new dataset on every uncached switch
- [ ] Cache hit on dataset switch still shows "ready" immediately (no regression)
- [ ] A dataset with a broken DB connection correctly shows an error state after switching

## Work Log

### 2026-03-10
Implemented Option B (useEffect refactor) in `.worktrees/review-pr33/src/components/chat/chat-state-provider.tsx`.

- Added `useEffect` to the React import list.
- Removed the render-phase state mutation: the `prevDataset`/`setPrevDataset` state variable and the `if (prevDataset !== datasetId)` block (lines 50-55) were deleted entirely.
- Added a `useEffect([datasetId])` that checks `healthCache`: cache hit → `setDbStatus("ready")` immediately; cache miss → `setDbStatus("checking")` then `checkHealth()`. This fires on every dataset switch and on initial mount.
- The `useState` initializer still seeds from the cache for the initial render, so there is no flash of "checking" on first load when the dataset is already cached.
- Added an eslint-disable comment for `react-hooks/exhaustive-deps` on the effect since `checkHealth` is intentionally excluded (it's memoized on `datasetId` and including it would be redundant but could confuse the linter).

## Resources
- PR #33
