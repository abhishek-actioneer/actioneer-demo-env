---
name: metrics-apifetch-query-param-violation
description: Metrics fetch passes datasetId as URL query param instead of x-dataset-id header; route also doesn't read the header; missing skipModel
type: bug
status: pending
priority: p1
issue_id: "100"
tags: [code-review, architecture, apifetch, metrics, api]
---

## Problem Statement

`add-card-menu.tsx` calls `apiFetch` with `?datasetId=` as a URL query parameter instead of relying on the auto-injected `x-dataset-id` header. This violates the project's established API contract (CLAUDE.md: "All frontend→backend calls MUST use `apiFetch`... `apiFetch` auto-injects `x-dataset-id`... headers"). The metrics API route also exclusively reads from the query string (`searchParams.get("datasetId")`), not the header — making both the call site and the route inconsistent with every other API route. Additionally, `skipModel: true` is missing for a non-LLM route.

**Why it matters:** Creates a divergent pattern that future developers may copy. If the metrics route is later refactored to follow header convention (as it should), this call silently breaks. The `x-model-id` header is sent unnecessarily on every metric list fetch.

## Findings

- **Call site:** `src/components/board/add-card-menu.tsx:105`
  ```typescript
  apiFetch<{ metrics: Metric[] }>(`/api/metrics?datasetId=${datasetId}`)
  ```
- **Route:** `src/app/api/metrics/route.ts:121` reads `searchParams.get("datasetId")` — no header fallback
- **All other routes** (`segments/route.ts`, `integrations/route.ts`) check `req.headers.get("x-dataset-id")` first
- **Missing:** `skipModel: true` option (metrics listing is not an LLM call)

## Proposed Solutions

### Option A — Fix both call site and route (Recommended)

**In `add-card-menu.tsx`:**
```typescript
apiFetch<{ metrics: Metric[] }>("/api/metrics", { skipModel: true, datasetId })
```

**In `src/app/api/metrics/route.ts`:**
```typescript
const rawDatasetId = req.headers.get("x-dataset-id") || searchParams.get("datasetId");
const datasetId = validateDatasetId(rawDatasetId) ?? DEFAULT_DATASET;
```

Pros: Brings both files into compliance with conventions. Cons: Two-file change.

### Option B — Fix call site only, keep query param in route as fallback
Keep `searchParams.get()` in the route but add header read as primary. Call site still removes the query param.

Pros: Safer (backward compatible if anything else queries with param). Cons: Route remains inconsistent.

## Recommended Action

Option A — fix both. The route should follow the established convention used by every other route.

## Technical Details

- **Affected files:** `src/components/board/add-card-menu.tsx`, `src/app/api/metrics/route.ts`
- **Convention doc:** CLAUDE.md "API Calls — apiFetch" section
- **Pattern to match:** `src/app/api/segments/route.ts` line showing `req.headers.get("x-dataset-id")`

## Acceptance Criteria

- [ ] `apiFetch` call has no `?datasetId=` in the URL
- [ ] `apiFetch` call includes `{ skipModel: true, datasetId }` options
- [ ] Metrics route reads `x-dataset-id` header (with query param as fallback)
- [ ] Metrics still load correctly in the add-card menu

## Work Log

- 2026-03-16: Identified in PR #42 code review via architecture-strategist and security-sentinel agents
