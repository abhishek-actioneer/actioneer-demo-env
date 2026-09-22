---
status: done
priority: p1
issue_id: "070"
tags: [code-review, data-integrity, segments, pr-41]
dependencies: []
---

# Segment user_count always <= 500 due to executeSQL row cap

## Problem Statement

In `src/app/api/segments/generate-all/route.ts:98`, the generated segment's `user_count` is set to `validationResult.rows.length`. However, `executeSQL` caps results at 500 rows (as documented in CLAUDE.md). This means every generated segment will report a user count of at most 500, which is misleading — a segment matching 50,000 users still shows "500 users".

This is **user-facing data integrity** — the segments page displays this count and users will make business decisions based on incorrect numbers.

## Findings

```typescript
// src/app/api/segments/generate-all/route.ts:97-98
const userCount = validationResult.rows.length;
```

The prompt instructs the LLM to add `LIMIT 500` to segment SQL, AND `executeSQL` also caps at 500 rows. Double-capping makes the count meaningless as a user metric.

Compare with the existing single-segment creation flow in `/api/segments/route.ts`, which likely has the same issue but is less visible since it creates one segment at a time.

## Proposed Solutions

**Option A (Recommended): Run a COUNT query after validation**
- After `executeSQL` validates the SQL, run a separate `SELECT COUNT(DISTINCT user_id) FROM (...)` query to get the actual count
- Store the real count in `sentinel_segments.user_count`
- Effort: Small | Risk: Low

**Option B: Remove LIMIT from generated SQL, add it only for validation**
- Generate SQL without LIMIT 500
- Add LIMIT 500 only when validating (to prevent OOM)
- Run the unlimited SQL wrapped in COUNT for the actual user count
- Effort: Medium | Risk: Low

**Option C: Accept the cap and label it clearly**
- Change UI to show "500+" when user_count is exactly 500
- Effort: Small | Risk: Low (but still inaccurate)

## Recommended Action

Option A — run a COUNT query for each validated segment.

## Technical Details

- **Affected files:** `src/app/api/segments/generate-all/route.ts`
- **Related:** `src/lib/sql-executor.ts` (500 row cap)

## Acceptance Criteria

- [ ] Generated segments show accurate user counts (not capped at 500)
- [ ] COUNT query uses memory-safe pattern (no full table scan)
- [ ] UI handles zero-count segments gracefully

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | executeSQL row cap affects derived metrics |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
