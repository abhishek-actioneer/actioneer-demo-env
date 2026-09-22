---
status: pending
priority: p2
issue_id: "087"
tags: [code-review, performance, metrics, pr-41]
dependencies: []
---

# Metrics first-load fires 50-80 DuckDB queries with no lazy loading

## Problem Statement

In `src/app/api/metrics/route.ts:148-149`, the first request (no cache) runs `Promise.all(definitions.map((def) => computeMetric(def, datasetId)))`. Each `computeMetric` fires 2 SQL queries (`valueSql` + `timeSeriesSql`). With 25-40 generated metrics, that's 50-80 queries all enqueued into the DuckDB serial queue.

At 200-500ms per query, the first load takes **10-40 seconds**. The stale-while-revalidate cache (5 min TTL) handles subsequent requests, but cold-start latency is severe.

## Findings

Source: Performance Oracle agent.

- DuckDB `enqueue()` serializes per-dataset — all queries run sequentially
- First visit to `/metrics` blocks until all queries complete
- Background recompute (`recomputeInBackground`) has the same unbounded `Promise.all`

## Proposed Solutions

**Option A: Lazy metric computation**
- Return metric definitions with `status: "pending"` on first load (names, types, categories only)
- Compute values on-demand when user visits `/metrics/[id]`
- Landing page doesn't need live values
- Effort: Medium | Risk: Low

**Option B: Persist computed values to disk**
- After first computation, write results to `metrics-computed.json`
- Subsequent server restarts use cached values
- Effort: Medium | Risk: Low

**Option C: Concurrency-limited computation**
- Use `p-limit(4)` to match DuckDB thread count
- Won't reduce total time (queue serializes anyway) but better architecture for future connection pooling
- Effort: Small | Risk: Low

## Technical Details

- **Affected files:** `src/app/api/metrics/route.ts`

## Acceptance Criteria

- [ ] `/metrics` page loads in < 3 seconds on first visit
- [ ] Metric values are eventually computed and cached

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (performance-oracle agent) | DuckDB serial queue creates linear latency |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
