---
status: done
priority: p1
issue_id: "079"
tags: [code-review, dataset-consistency, pr-41]
dependencies: []
---

# Hardcoded "ecommerce" fallback in board-from-research route violates CLAUDE.md

## Problem Statement

`src/app/api/board-from-research/route.ts:206` introduces `req.headers.get("x-dataset-id") ?? "ecommerce"` — a hardcoded `"ecommerce"` fallback that violates the CLAUDE.md rule:

> **No hardcoded "ecommerce"** — use `DEFAULT_DATASET` from `@/lib/datasets/constants` (client) or `@/lib/datasets` (server). The string `"ecommerce"` must only appear in dataset definition files.

Other routes in this PR correctly avoid this pattern.

## Findings

```typescript
// src/app/api/board-from-research/route.ts:206
const datasetId = req.headers.get("x-dataset-id") ?? "ecommerce";
```

Should be:
```typescript
import { DEFAULT_DATASET } from "@/lib/datasets";
const datasetId = req.headers.get("x-dataset-id") ?? DEFAULT_DATASET;
```

## Proposed Solutions

**Option A (Recommended): Import and use DEFAULT_DATASET**
- Effort: Trivial | Risk: None

## Technical Details

- **Affected files:** `src/app/api/board-from-research/route.ts`

## Acceptance Criteria

- [ ] No hardcoded `"ecommerce"` string outside dataset definition files
- [ ] Route uses `DEFAULT_DATASET` from `@/lib/datasets`

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | CLAUDE.md convention violation |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
