---
status: complete
priority: p2
issue_id: "006"
tags: [code-review, simplicity, sql-executor]
dependencies: ["001", "003"]
---

# rawRows.slice(0, 500) is a no-op after ensureLimit; magic number 500 scattered in 4 places

## Problem Statement

`ensureLimit(sql, 500)` caps DuckDB output at 500 rows at the SQL level. The three `rawRows.slice(0, 500)` calls that follow in `executeSQLInternal`, `executeSQLPrepared`, and `executeSQL` are now no-ops in the success path. The magic number `500` appears in:

1. `ensureLimit` default parameter
2. `sql-executor.ts:50` — `rawRows.slice(0, 500)`
3. `sql-executor.ts:137` — `rawRows.slice(0, 500)`
4. `sql-executor.ts:183` — `rawRows.slice(0, 500)`

If the cap ever needs to change, 4 edits are required instead of 1.

## Proposed Solutions

**Option A: Extract MAX_RESULT_ROWS constant, keep slices as documented defense-in-depth**
```ts
const MAX_RESULT_ROWS = 500;
// then: ensureLimit(sql, MAX_RESULT_ROWS) and rawRows.slice(0, MAX_RESULT_ROWS)
// add comment: // defense-in-depth: ensureLimit already caps at SQL level
```
- Effort: Small | Risk: None

**Option B: Remove the slice calls entirely (relying solely on ensureLimit)**
- Effort: Small | Risk: Low (ensureLimit is the primary cap; removing slice is cleaner)
- Requires fixing P1-003 first so the ensureLimit is actually reliable

## Recommended Action

Option A — extract the constant and add a comment explaining dual-cap intent. Keep the slices as documented safety net.

## Technical Details

- Affected file: `src/lib/sql-executor.ts`

## Acceptance Criteria

- [ ] `MAX_RESULT_ROWS = 500` constant defined once
- [ ] All `slice(0, 500)` and `ensureLimit` default use the constant
- [ ] Comment explains dual-cap design

## Work Log

- 2026-03-02: Found by code-simplicity-reviewer and pattern-recognition-specialist on PR #29
