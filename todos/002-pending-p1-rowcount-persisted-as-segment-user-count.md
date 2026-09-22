---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, data-integrity, segments]
dependencies: []
---

# rowCount capped at 500 is persisted as segment user_count — wrong data in DB

## Problem Statement

`src/app/api/segments/route.ts:54` uses `validationResult.rowCount` as the `user_count` written into the `segments` table:

```ts
const userCount = validationResult.rowCount;  // now always <= 500
// ...
`INSERT INTO segments (id, name, sql, user_count, ...) VALUES ($1, $2, $3, $4, $5)`,
[id, name, sql, userCount, ...]
```

Before this PR, `rowCount` was `rawRows.length` — still capped at 500 by `.slice()`, so this was already wrong. The PR cements this by also capping at the SQL level. A segment matching 50,000 users will show "500 users" in the segment list UI and push integrations will operate on this wrong number.

The GET `/api/segments/[id]` detail view re-runs a `COUNT(*)` and gets the real number, but the list view reads `user_count` directly from the stored row.

## Findings

Confirmed via grep:
```
src/app/api/segments/route.ts:54 — const userCount = validationResult.rowCount;
src/app/api/segments/route.ts:57 — INSERT INTO segments (..., user_count, ...) VALUES (..., $4, ...)
```

## Proposed Solutions

**Option A (Recommended): Run a separate COUNT(*) query for user_count**
```ts
const countResult = await executeSQL(`SELECT COUNT(*) as cnt FROM (${sql}) __count`, datasetId);
const userCount = Number(countResult.rows[0]?.cnt ?? 0);
```
This is exactly what `/api/segments/[id]` already does correctly.
- Effort: Small | Risk: Low

**Option B: Remove user_count from INSERT, always compute on demand**
- DELETE `user_count` column from segments table, always run COUNT on list view
- Effort: Medium (schema migration needed) | Risk: Medium

**Option C: Document rowCount as "rows returned (≤500)" and use it explicitly**
- Accept the cap, display "500+" in UI when rowCount === 500
- Effort: Small | Risk: Low (semantic change, not a fix)

## Recommended Action

Option A — run a `COUNT(*)` subquery for `user_count` on segment creation. Matches the pattern already used by the detail view.

## Technical Details

- Affected files: `src/app/api/segments/route.ts`
- Branch: `fix/railway-oom-duckdb-memory`

## Acceptance Criteria

- [ ] Segment creation stores the actual user count (not capped at 500) in `user_count`
- [ ] Creating a segment that matches >500 events stores the real count
- [ ] Existing tests still pass

## Work Log

- 2026-03-02: Found by data-integrity-guardian review agent on PR #29
