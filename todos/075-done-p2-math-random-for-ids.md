---
status: done
priority: p2
issue_id: "075"
tags: [code-review, reliability, pr-41]
dependencies: []
---

# Math.random() used for entity IDs — collision-prone

## Problem Statement

Two new routes use `Math.random().toString(36).slice(2, 10)` for generating entity IDs:

- `src/app/api/segments/generate-all/route.ts:100` — segment IDs
- `src/app/api/knowledge/generate/route.ts:81` — knowledge entry IDs

`Math.random()` produces ~52 bits of entropy. After slicing to 8 chars in base-36, the effective ID space is ~41 bits (~2 trillion values). While collisions are unlikely for small datasets, this pattern is weaker than necessary and inconsistent with best practices. `crypto.randomUUID()` is available in all modern Node.js runtimes and produces 122 bits of entropy.

## Findings

```typescript
// segments/generate-all/route.ts:100
const id = Math.random().toString(36).slice(2, 10);

// knowledge/generate/route.ts:81
id: Math.random().toString(36).slice(2, 10),
```

## Proposed Solutions

**Option A (Recommended): Use crypto.randomUUID()**
- Replace both instances with `crypto.randomUUID()`
- Consistent, standard, zero collision risk
- Effort: Trivial | Risk: None

## Technical Details

- **Affected files:** `src/app/api/segments/generate-all/route.ts`, `src/app/api/knowledge/generate/route.ts`

## Acceptance Criteria

- [ ] All new entity IDs use `crypto.randomUUID()` or equivalent
- [ ] No `Math.random()` used for IDs in new code

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
