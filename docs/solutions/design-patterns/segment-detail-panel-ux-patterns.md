---
title: Segments Detail Panel - React Hooks, UX Patterns & Query Optimization
date: 2026-02-17
category: design-patterns
tags: [react-hooks, state-management, lint-fixes, ux-design, query-optimization, keyboard-navigation]
components: [segment-detail-panel.tsx, segment-list-card.tsx, create-segment-modal.tsx, segments-page.tsx]
stack: [Next.js 16, React 19, ESLint, DuckDB]
severity: medium
---

# Segments Detail Panel - UX Patterns & Decisions

## What Was Built

Split-panel segments view with list cards on the left and a rich detail panel on the right. During implementation, several UX and code quality decisions were made that are worth preserving as patterns.

## Solution 1: React setState-in-useEffect → "Adjust State During Render"

### Problem

ESLint's `react-hooks/set-state-in-effect` rule flagged 4 errors where `setState` was called synchronously inside `useEffect` to reset component state when props changed.

### Root Cause

The common React pattern of "reset state when props change" was implemented via `useEffect`, which triggers cascading renders and is explicitly discouraged by React's documentation.

### Fix

Use React's recommended "adjust state during render" pattern — track the previous prop value in state and compare during render:

**Before (lint error):**
```tsx
useEffect(() => {
  setPushStatus(segment.pushStatus);
  setPreview([]);
  setPreviewLoading(true);
  setFreshCount(null);
}, [segment.id, segment.pushStatus]);
```

**After (clean):**
```tsx
const [prevSegmentId, setPrevSegmentId] = useState(segment.id);

if (segment.id !== prevSegmentId) {
  setPrevSegmentId(segment.id);
  setPushStatus(segment.pushStatus);
  setPreview([]);
  setPreviewLoading(!segment.id.startsWith("mock-"));
  setFreshCount(null);
}
```

Same pattern applied to `create-segment-modal.tsx` for resetting modal state when `open` prop transitions from `false` to `true`.

### Key Insight

This pattern runs during render (not as a side effect), so React batches the state updates into a single re-render. It's both more performant and lint-clean.

## Solution 2: Refresh Button UX — Approach A (Icon in Card Header)

### Problem

Users needed a way to manually trigger a refresh of segment data from the detail panel. The Refresh card is compact (one of three in a 3-column grid).

### Approaches Considered

| Approach | Description | Verdict |
|----------|-------------|---------|
| **A: Icon button in header** | Small `RefreshCw` icon right-aligned next to "Refresh" label | **Chosen** |
| B: Entire card clickable | Whole card becomes a button with hover state | Rejected — poor discoverability |
| C: Text link below | "Refresh now" link under the time label | Rejected — makes card taller, breaks grid symmetry |

### Why Approach A

- **Compact**: No extra height, fits within existing card layout
- **Discoverable**: Refresh icon is universally recognized
- **Loading state for free**: Spinning icon animation communicates progress without extra UI
- **Status dot enhancement**: Pulses blue during refresh, label shows "Refreshing..."
- **Completion feedback**: Label updates to "Just now" after successful refresh

### Implementation Details

```tsx
<button
  onClick={handleRefresh}
  disabled={refreshing}
  className="p-0.5 rounded hover:bg-muted transition-colors disabled:opacity-50"
>
  <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
</button>
```

The handler re-fetches the segment API, updating both the user count (Users card) and preview table simultaneously.

## Solution 3: Preview Query LIMIT 10 Optimization

### Problem

The segment detail API (`/api/segments/[id]`) re-executed the full segment SQL query to get both user count and preview rows, then sliced to 50 in JavaScript. For large segments, this was wasteful.

### Fix

Split into two parallel queries at the API level:

```typescript
const [countResult, previewResult] = await Promise.all([
  executeSQL(`SELECT COUNT(*) as cnt FROM (${sql})`),
  executeSQL(`SELECT * FROM (${sql}) LIMIT 10`),
]);
```

- **COUNT query**: Gets accurate total without transferring rows
- **LIMIT 10 query**: Returns only the rows needed for preview
- **Parallel execution**: Both run simultaneously via `Promise.all`

### Key Insight

Always separate count queries from data queries. Never fetch N rows just to call `.length` on them.

## Solution 4: Keyboard Navigation for Segment List

### Problem

List-detail layouts should support keyboard-only navigation for power users.

### Fix

Added `keydown` event listener on `window` with arrow up/down handling:

- **Wrap-around**: Arrow down on last item goes to first, and vice versa
- **Scroll into view**: Selected card auto-scrolls with `{ block: "nearest", behavior: "smooth" }`
- **Input guard**: Ignores key events when focus is in search input or textarea
- **Data attributes**: Uses `data-segment-card` on wrapper divs for `querySelectorAll` targeting

### Key Insight

Plan keyboard navigation from the start for any list-detail layout. Adding it as polish is more work than building it in from the beginning.

## Prevention & Best Practices

### Pattern: State Sync with Prop Changes
- **When to apply**: Component state must reset when a prop like `id` or `open` changes
- **How to apply**: Track previous prop in state, compare during render, batch all resets
- **Anti-pattern**: `useEffect` with synchronous `setState` — causes cascading renders and lint errors

### Pattern: Structured UX Decision-Making
- **When to apply**: Adding interactive elements to space-constrained layouts
- **How to apply**: Document 3+ alternatives with pros/cons before coding. Evaluate: space, discoverability, loading states, grid symmetry
- **Anti-pattern**: Implementing the first idea without comparing alternatives

### Pattern: Dual-Query for Preview + Count
- **When to apply**: Any UI showing both a total count and a data sample
- **How to apply**: `Promise.all([COUNT query, LIMIT query])` — never fetch all rows just to count them
- **Anti-pattern**: Single query → slice in JS

### Pattern: Keyboard Navigation in List-Detail
- **When to apply**: Any split-panel or sidebar layout with selectable items
- **How to apply**: Arrow keys with wrap-around + scrollIntoView + input field guard
- **Anti-pattern**: Adding keyboard nav as afterthought; forgetting scroll-into-view

## Related Documentation

- [Segments Brainstorm](../../brainstorms/2026-02-17-segments-list-redesign-brainstorm.md) — Split panel layout decision, card design, search/filter patterns
- [Segments Implementation Plan](../../plans/2026-02-17-feat-segments-split-panel-redesign-plan.md) — 5-phase plan with acceptance criteria
- [Follow-up Actions Redesign](./follow-up-actions-card-redesign.md) — Brand icon registry pattern, component merging, state management
- [Race Conditions Review](../../reviews/race-conditions-review-segments-plan.md) — AbortController patterns, state lifecycle guards
