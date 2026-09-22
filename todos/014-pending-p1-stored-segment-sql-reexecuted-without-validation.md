---
status: pending
priority: p1
issue_id: "014"
tags: [code-review, security, segments]
dependencies: ["013"]
---

# GET /api/segments/:id re-executes stored SQL without calling validateSQL

## Problem Statement

`GET /api/segments/:id` reads the stored `sql` field from the database and
re-executes it to get a fresh user count and row preview:

```typescript
// src/app/api/segments/[id]/route.ts:21-24
const [countResult, previewResult] = await Promise.all([
  executeSQLPrepared(`SELECT COUNT(*) as cnt FROM (${sql})`, [], datasetId),
  executeSQLPrepared(`SELECT * FROM (${sql}) LIMIT 10`, [], datasetId),
]);
```

`executeSQLPrepared` does NOT call `validateSQL`. The stored `sql` is wrapped
in an outer subquery and executed directly. If an attacker stores malicious SQL
in the `segments` table (via the comment-based regex bypass described in
todo-013, or any future input path), every subsequent GET to that segment ID
will re-execute it.

**Concrete attack chain:**

1. Attacker bypasses `validateSQL` (see todo-013) and stores:
   `sql = "events WHERE 1=1; DELETE FROM segments WHERE 1=1 RETURNING user_id"`
2. Segment is inserted with this SQL value.
3. Any user calls `GET /api/segments/<id>`.
4. The handler builds:
   `SELECT COUNT(*) as cnt FROM (events WHERE 1=1; DELETE FROM segments WHERE 1=1 RETURNING user_id)`
   DuckDB executes the DELETE (via RETURNING subquery trick) and returns rows.
5. Every future GET re-executes the DELETE — segments table is wiped on every read.

This is a stored SQL injection / persistent execution pattern. Writing once
causes repeated damage on every read, by any user.

**Note:** This finding is dependent on todo-013 (validateSQL bypass) for the
write step. If todo-013 is fixed, storing malicious SQL becomes harder. However,
defense-in-depth requires that read paths also validate stored values, since
the database is not an unconditionally trusted source.

## Findings

- `src/app/api/segments/[id]/route.ts:18` — `const sql = row.sql as string;` (read from DB, treated as trusted)
- `src/app/api/segments/[id]/route.ts:22` — `executeSQLPrepared(\`SELECT COUNT(*) as cnt FROM (${sql})\`, [], ...)` — stored SQL interpolated directly, no validation
- `src/app/api/segments/[id]/route.ts:23` — same for the preview query
- PATCH handler (line 52) accepts a `sql` update without calling `validateSQL`, enabling storage of new malicious SQL (see also todo-019)

## Proposed Solutions

**Option A (Recommended): Re-validate stored SQL before re-executing**

```typescript
// At top of GET handler, after reading the row:
const sql = row.sql as string;
const validation = validateSQL(sql);
if (!validation.valid) {
  return Response.json({ error: "Segment SQL is invalid" }, { status: 500 });
}
// ... then proceed with the count/preview queries
```

One-line addition. Ensures stored SQL passes the same safety check as newly
submitted SQL. If the SQL was stored before the fix (and was valid at that time),
it will still pass. If someone managed to store malicious SQL, the GET handler
catches it before re-executing.

- Effort: Trivial | Risk: Low

**Option B: Parameterize the subquery wrapping**

Instead of interpolating `sql` directly into the outer query string, use DuckDB's
parameterized statement for the outer wrapper. However, DuckDB does not support
a full SQL string as a bound parameter (only scalar values), so subquery
interpolation is unavoidable. This does not help.

**Option C: Store and re-execute only a sanitized SQL hash, not the raw SQL**

Too large a refactor for the current demo scope.

## Recommended Action

Option A — add `validateSQL(sql)` check in the GET handler before re-executing
stored SQL. Also add the same check in the PATCH handler before accepting `sql`
updates (see todo-019).

## Technical Details

- `src/app/api/segments/[id]/route.ts:8-39` (GET handler)
- Import `validateSQL` (already exported from `@/lib/sql-executor`)

## Acceptance Criteria

- [ ] GET /api/segments/:id calls `validateSQL(sql)` on the stored SQL before re-executing
- [ ] If `validateSQL` returns `valid: false`, GET returns 500 with error message
- [ ] Existing segment read tests pass

## Work Log

- 2026-03-02: Found by security-sentinel agent on PR #29
