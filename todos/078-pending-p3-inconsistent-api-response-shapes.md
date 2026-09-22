---
status: pending
priority: p3
issue_id: "078"
tags: [code-review, api-design, consistency, pr-41]
dependencies: []
---

# Inconsistent API response shapes across generate endpoints

## Problem Statement

The three new generate endpoints return different response shapes:

- `segments/generate-all`: `{ generated: number, failed: number, total: number }` on success, `{ error, failed }` on 422
- `knowledge/generate`: `{ entries: KnowledgeEntry[], count: number }` on success
- `metrics/generate`: (existing, likely different again)

No unified response pattern makes client-side error handling inconsistent.

## Proposed Solutions

**Option A: Standardize on `{ items: T[], generated: number, failed: number }`**
- All endpoints return the same shape with typed items
- Effort: Small | Risk: Low

## Technical Details

- **Affected files:** `src/app/api/segments/generate-all/route.ts`, `src/app/api/knowledge/generate/route.ts`

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
