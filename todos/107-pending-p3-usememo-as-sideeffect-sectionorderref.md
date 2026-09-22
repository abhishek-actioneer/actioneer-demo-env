---
name: usememo-as-sideeffect-sectionorderref
description: document-view.tsx uses useMemo to mutate sectionOrderRef — React explicitly reserves the right to skip/re-run memoized computations
type: quality
status: pending
priority: p3
issue_id: "107"
tags: [code-review, quality, react, document-view]
---

## Problem Statement

`document-view.tsx` uses `useMemo` to run a side effect (mutating `sectionOrderRef.current`). This is fragile — React can skip or re-run `useMemo` at any time. The comment acknowledges the workaround ("useMemo runs during render so the ref is current"). The two adjacent `useMemo` calls can be merged into one correct computation.

## Proposed Solution

Merge the two `useMemo` blocks into one:

```typescript
const sectionOrder = useMemo(() => {
  // Accumulate ever-seen section IDs
  const known = new Set(sectionOrderRef.current);
  const toAdd = liveSections.map((s) => s.id).filter((id) => !known.has(id));
  if (toAdd.length > 0) sectionOrderRef.current = [...sectionOrderRef.current, ...toAdd];
  // Derive order: live sections first, then deleted placeholders
  const liveSet = new Set(liveSections.map((s) => s.id));
  const deletedPlaceholders = sectionOrderRef.current.filter((id) => !liveSet.has(id));
  return [...liveSections.map((s) => s.id), ...deletedPlaceholders];
}, [liveSections]);
```

This eliminates the split across two declarations and keeps the ref mutation inside the computation that reads from it.

## Acceptance Criteria

- [ ] Section order still accumulates deleted section IDs for placeholder rendering
- [ ] No separate `useMemo` exists solely for mutating `sectionOrderRef`

## Work Log

- 2026-03-16: Identified in PR #42 code review via code-simplicity-reviewer agent
