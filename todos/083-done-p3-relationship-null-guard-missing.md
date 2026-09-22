---
status: done
priority: p3
issue_id: "083"
tags: [code-review, robustness, metrics, pr-41]
dependencies: []
---

# Relationship array elements not guarded against null before property access

## Problem Statement

In `src/lib/datasets/metric-generator.ts:54-55`, `m.relationships.filter((r) => validIds.has(r.metricId))` accesses `r.metricId` without verifying `r` is a non-null object. If the LLM returns `relationships: [null, {...}]`, this throws `TypeError: Cannot read properties of null`.

The outer try-catch handles the crash, but it causes the entire metric generation to fail even though only one metric had a malformed relationship.

## Proposed Solutions

**Option A (Recommended): Add null guard**
```typescript
.filter((r) => r && validIds.has(r.metricId))
```
- Effort: Trivial | Risk: None

## Technical Details

- **Affected files:** `src/lib/datasets/metric-generator.ts`

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | LLM JSON arrays can contain nulls |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
