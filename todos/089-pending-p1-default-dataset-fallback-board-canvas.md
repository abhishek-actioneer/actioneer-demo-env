---
status: pending
priority: p1
issue_id: "089"
tags: [code-review, architecture, dataset-isolation, pr-41]
dependencies: []
---

# `DEFAULT_DATASET` fallback in board-from-research and canvas-query bypasses dataset isolation

## Problem Statement

Two routes silently fall back to `DEFAULT_DATASET` ("ecommerce") when `x-dataset-id` is missing, violating the project's core dataset isolation invariant:

- `src/app/api/board-from-research/route.ts` line 207: `req.headers.get("x-dataset-id") ?? DEFAULT_DATASET`
- `src/app/api/canvas-query/route.ts` line 288: `bodyDatasetId || headerDatasetId || DEFAULT_DATASET`

If a client fails to send `x-dataset-id` (e.g., during a dataset switch race, a bug, or an agent calling the route directly without proper headers), the route silently runs follow-up generation and SQL against the ecommerce dataset without the caller knowing. This is precisely the cross-dataset contamination the architecture was designed to prevent.

The two new generation routes (`segments/generate-all`, `knowledge/generate`) correctly return a 400 when `datasetId` is absent. These two older routes should match that pattern.

## Findings

Source: Architecture agent + Pattern Recognition agent review.

- `board-from-research/route.ts:207` — fallback to `DEFAULT_DATASET` ("ecommerce")
- `canvas-query/route.ts:288` — triple-fallback with `DEFAULT_DATASET` as last resort
- CLAUDE.md is explicit: "No silent fallback to ecommerce"
- MEMORY.md: "The string 'ecommerce' must only appear in dataset definition files"
- `DEFAULT_DATASET` is literally `"ecommerce"` — using it as a server fallback is a regression
- `board-from-research` also imports from `@/lib/datasets` instead of `@/lib/datasets/constants` (minor but inconsistent)

## Proposed Solutions

**Option A (Recommended): Return 400 when datasetId is absent**
```ts
// board-from-research/route.ts
const datasetId = req.headers.get("x-dataset-id");
if (!datasetId) {
  return Response.json({ error: "x-dataset-id header is required" }, { status: 400 });
}
```
Same pattern for `canvas-query/route.ts`.
- Effort: Trivial | Risk: None (both routes already require valid dataset context to function)

**Option B: Keep fallback but add a warning log**
- Log a warning when `DEFAULT_DATASET` is used
- Effort: Trivial | Risk: Medium (silent degradation continues)

## Recommended Action

Option A — match the pattern from the new generation routes.

## Technical Details

- **Affected files:**
  - `src/app/api/board-from-research/route.ts` line 207
  - `src/app/api/canvas-query/route.ts` line 288

## Acceptance Criteria

- [ ] Both routes return 400 when no `x-dataset-id` header is present
- [ ] No `DEFAULT_DATASET` fallback on server-side routes
- [ ] Existing clients that correctly send `x-dataset-id` are unaffected

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (architecture + pattern agents) | New generation routes got this right; two older routes were not updated |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
- Related todo 079 (done) fixed the hardcoded "ecommerce" string but didn't catch the DEFAULT_DATASET fallback pattern
