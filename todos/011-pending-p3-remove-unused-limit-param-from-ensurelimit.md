---
status: complete
priority: p3
issue_id: "011"
tags: [code-review, simplicity, sql-executor]
dependencies: []
---

# `ensureLimit` has a `limit` parameter that is never passed by any call site

## Problem Statement

`ensureLimit` has a default parameter `limit = MAX_RESULT_ROWS`:

```typescript
// src/lib/sql-executor.ts:19
function ensureLimit(sql: string, limit = MAX_RESULT_ROWS): string {
```

Every call site passes only one argument:
- `ensureLimit(sql)` — line 123 (`executeSQLPrepared`)
- `ensureLimit(sql)` — line 183 (`executeSQL`)

The parameter exists for flexibility that is never exercised. It creates a subtle footgun:
a future caller could write `ensureLimit(sql, 100)` to cap at 100 rows at the SQL level, while
the JS `.slice(0, MAX_RESULT_ROWS)` defense layer still uses `MAX_RESULT_ROWS = 500` — producing
inconsistent caps between the two layers (SQL returns 100, but the code implies up to 500 is expected).

## Proposed Solutions

**Option A (Recommended): Remove the parameter**
```typescript
function ensureLimit(sql: string): string {
  const normalized = sql.trim().replace(/;+\s*$/, "");
  if (/\bLIMIT\b/i.test(normalized)) return normalized;
  return `${normalized} LIMIT ${MAX_RESULT_ROWS}`;
}
```
Closes the two-layer inconsistency footgun.
- Effort: Trivial | Risk: None

## Recommended Action

Option A. One-line change with no behavior impact.

## Technical Details

- Affected file: `src/lib/sql-executor.ts` (line 19)
- Branch: `fix/railway-oom-duckdb-memory`

## Acceptance Criteria

- [ ] `ensureLimit` has no second parameter
- [ ] All call sites unchanged (they already pass only `sql`)
- [ ] Tests pass

## Work Log

- 2026-03-02: Found by code-simplicity-reviewer on PR #29
