---
name: metrics-route-path-traversal-datasetid
description: /api/metrics interpolates unsanitized datasetId query param into filesystem path — path traversal allows reading files outside data/datasets/
type: security
status: pending
priority: p2
issue_id: "104"
tags: [code-review, security, api, path-traversal, metrics]
---

## Problem Statement

The metrics API route reads `datasetId` from the query string and uses it directly in a `path.join()` call to construct a filesystem path. `path.join` does not prevent directory traversal — a value like `../../etc/passwd` resolves to a path outside the intended `data/datasets/` directory. While this endpoint requires authentication (session cookie), an authenticated user can craft a raw HTTP request with a malicious `datasetId`.

## Findings

- **File:** `src/app/api/metrics/route.ts` (lines ~9, 121–122)
- **Pattern:**
  ```typescript
  const DATASETS_DIR = resolve(process.cwd(), "data/datasets");
  const metricsPath = join(DATASETS_DIR, datasetId, "metrics.json");
  ```
- **No validation:** `validateDatasetId()` is not called (the function referenced in CLAUDE.md doesn't exist in source yet)
- **Impact:** Read any file named `metrics.json` on the server filesystem accessible to the Node.js process
- **Scope:** Authenticated users only (session gate protects the route)

## Proposed Solutions

### Option A — Validate format + assert path stays within DATASETS_DIR (Recommended)

```typescript
// 1. Validate format
const rawId = searchParams.get("datasetId") || req.headers.get("x-dataset-id");
if (!rawId || !/^[a-z0-9-]+$/.test(rawId) || rawId.length > 64) {
  return NextResponse.json({ error: "Invalid dataset" }, { status: 400 });
}

// 2. Construct path and verify it stays inside DATASETS_DIR
const metricsPath = resolve(DATASETS_DIR, rawId, "metrics.json");
if (!metricsPath.startsWith(resolve(DATASETS_DIR) + "/")) {
  return NextResponse.json({ error: "Invalid dataset" }, { status: 400 });
}
```

Pros: Defense in depth — format check prevents traversal attempts, path check catches edge cases.

### Option B — Use `validateDatasetId()` utility (when implemented)

Per CLAUDE.md, `validateDatasetId(raw)` validates `/^[a-z0-9-]+$/`, max 64 chars. Once this utility exists, use it here.

## Recommended Action

Option A immediately (path check is the critical guard). Migrate to `validateDatasetId()` when it's implemented.

## Technical Details

- **Affected file:** `src/app/api/metrics/route.ts`
- **Related:** All other API routes that accept `datasetId` — check they all validate

## Acceptance Criteria

- [ ] `datasetId` value of `../../etc/passwd` returns 400 from `/api/metrics`
- [ ] `datasetId` value of `../data` returns 400
- [ ] Valid dataset IDs still return correct metrics

## Work Log

- 2026-03-16: Identified in PR #42 code review via security-sentinel agent
