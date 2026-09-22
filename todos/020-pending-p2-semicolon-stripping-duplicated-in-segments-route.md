---
status: pending
priority: p2
issue_id: "020"
tags: [code-review, quality, segments, sql-executor]
dependencies: []
---

# Semicolon-stripping regex duplicated between ensureLimit and segments/route.ts

## Problem Statement

`ensureLimit` in `sql-executor.ts` normalises SQL by stripping trailing
semicolons:

```typescript
// sql-executor.ts:20
const normalized = sql.trim().replace(/;+\s*$/, "");
```

`POST /api/segments/route.ts` manually repeats this exact regex before
wrapping the SQL in a COUNT subquery:

```typescript
// segments/route.ts:54
const countSql = `SELECT COUNT(*) as cnt FROM (${sql.trim().replace(/;+\s*$/, "")}) __count`;
```

Two copies of the same normalization rule. If the rule ever changes (e.g., to
also strip trailing whitespace, or to handle `\r\n` endings), both must be
updated in sync.

Additionally, the inline strip in `segments/route.ts` is largely redundant:
`executeSQL` calls `ensureLimit` internally, which would normalize the
`countSql` anyway (the outer `SELECT COUNT(*)` has no semicolon, and any
trailing semicolon on `sql` inside the subquery is the only concern). DuckDB
would reject a trailing semicolon inside a subquery context, so the outer
`executeSQL` would return `countResult.error` — the same outcome as catching
it inline.

## Findings

- `src/lib/sql-executor.ts:20` — canonical normalization: `.trim().replace(/;+\s*$/, "")`
- `src/app/api/segments/route.ts:54` — duplicate: `.trim().replace(/;+\s*$/, "")`
- No shared helper for this normalization pattern

## Proposed Solutions

**Option A (Recommended): Export a `normalizeSql` helper from sql-executor.ts**

```typescript
// sql-executor.ts — add:
export function normalizeSql(sql: string): string {
  return sql.trim().replace(/;+\s*$/, "");
}
```

`ensureLimit` uses it internally, and `segments/route.ts` imports and calls it
for the subquery construction. Single source of truth.

- Effort: Trivial | Risk: None

**Option B: Remove the inline strip from segments/route.ts**

Trust that `executeSQL` → `ensureLimit` will handle normalization. If `sql`
has a trailing semicolon inside the subquery `(${sql})`, DuckDB will error,
which is caught at `countResult.error`. This is acceptable: if the user's
segment SQL has a trailing semicolon that `validateSQL` allowed through, the
COUNT query failing is a reasonable outcome.

```typescript
// Simplified:
const countSql = `SELECT COUNT(*) as cnt FROM (${sql}) __count`;
```

- Effort: Trivial | Risk: Very Low

## Recommended Action

Option B is the minimal fix — remove the inline strip. `ensureLimit` handles
the outer query's trailing semicolons, and DuckDB errors handle any inner ones.
If a shared `normalizeSql` export is desired for test clarity, Option A.

## Technical Details

- `src/app/api/segments/route.ts:54`
- `src/lib/sql-executor.ts:20`

## Acceptance Criteria

- [ ] Semicolon-stripping logic appears in exactly one place
- [ ] `SELECT * FROM events;` as segment SQL still results in a valid count (or a clear error)
- [ ] Existing segment creation tests pass

## Work Log

- 2026-03-02: Found by pattern-recognition-specialist agent on PR #29
