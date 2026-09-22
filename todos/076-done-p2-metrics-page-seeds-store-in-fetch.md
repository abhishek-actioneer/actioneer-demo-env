---
status: done
priority: p2
issue_id: "076"
tags: [code-review, architecture, separation-of-concerns, pr-41]
dependencies: []
---

# Metrics page seeds client-side store inside fetch callback

## Problem Statement

`src/app/metrics/page.tsx:38-39` calls `saveMetric(datasetId, m)` in a synchronous for-loop inside `fetchMetrics()`:

```typescript
for (const m of fetched) {
  saveMetric(datasetId, m);
}
```

This mixes data fetching with store mutation inside a React component. Each `saveMetric` call may trigger `invalidateCatalog()`, causing N catalog rebuilds for N metrics. It also means the metrics page has a side effect: visiting `/metrics` silently populates the metric-store, which `/metric-tree` depends on.

## Findings

- `saveMetric` in `metric-store.ts` likely calls `invalidateCatalog()` on each save
- The comment says "Seed the client-side metric-store so /metric-tree renders generated metrics" — this is a workaround for `/metric-tree` not fetching its own data
- This creates an implicit dependency: `/metric-tree` only works after visiting `/metrics`

## Proposed Solutions

**Option A (Recommended): Batch-save with single invalidation**
- Add `saveMetrics(datasetId, metrics[])` to metric-store that does bulk insert + single `invalidateCatalog()`
- Effort: Small | Risk: Low

**Option B: Move store seeding to a shared hook or provider**
- Create a hook that fetches + seeds on mount, used by both `/metrics` and `/metric-tree`
- Effort: Medium | Risk: Low

**Option C: Have /metric-tree fetch its own data**
- The metric tree page should fetch metrics from the API directly instead of relying on client-side store
- Effort: Medium | Risk: Low (but larger refactor)

## Recommended Action

Option A for immediate fix (batch save), Option C as follow-up.

## Technical Details

- **Affected files:** `src/app/metrics/page.tsx`, `src/lib/metric-store.ts`

## Acceptance Criteria

- [ ] Catalog invalidation fires at most once per fetch cycle
- [ ] `/metric-tree` works without first visiting `/metrics` (stretch goal)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | Page components shouldn't have store-seeding side effects |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
