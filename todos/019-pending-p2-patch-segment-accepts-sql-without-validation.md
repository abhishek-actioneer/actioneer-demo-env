---
status: pending
priority: p2
issue_id: "019"
tags: [code-review, security, segments]
dependencies: ["013"]
---

# PATCH /api/segments/:id accepts sql field without calling validateSQL

## Problem Statement

`PATCH /api/segments/:id` allows updating the `sql` field of a stored segment.
The updated SQL is bound as a parameter (safe against injection into the UPDATE
statement itself), but it is not validated with `validateSQL` before storage:

```typescript
// src/app/api/segments/[id]/route.ts:42-68
const { name, sql } = body as { name?: string; sql?: string };

if (sql) { sets.push(`sql = $${paramIdx++}`); values.push(sql); }  // no validateSQL

const result = await executeSQLPrepared(
  `UPDATE segments SET ${sets.join(", ")} WHERE id = $${paramIdx}`,
  values,
  datasetId,
);
```

An attacker who can authenticate can store arbitrary SQL strings via PATCH.
Stored malicious SQL is then re-executed on every GET request (see todo-014).
This is the write-side of the stored SQL injection vector:

- `POST /api/segments` validates SQL before storage (calls `executeSQL` which calls `validateSQL`)
- `PATCH /api/segments/:id` skips validation — an inconsistent security posture

Even without todo-014 or todo-013 being exploited, this creates a direct path
for an authenticated user to intentionally overwrite a segment's SQL with
a value that will behave differently than the segment's original validated SQL.

## Findings

- `src/app/api/segments/[id]/route.ts:46-52` — PATCH body parsing, no validateSQL for `sql`
- `src/app/api/segments/route.ts:48` — POST handler calls `executeSQL(sql, ...)` which validates; PATCH does not
- Inconsistency: POST validates, PATCH does not — same resource, different security posture

## Proposed Solutions

**Option A (Recommended): Add validateSQL check in PATCH handler**

```typescript
if (sql) {
  const validation = validateSQL(sql);
  if (!validation.valid) {
    return Response.json({ error: `Invalid SQL: ${validation.error}` }, { status: 400 });
  }
  sets.push(`sql = $${paramIdx++}`);
  values.push(sql);
}
```

- Effort: Trivial | Risk: None

**Option B: Validate and execute the new SQL to check it works**

Like POST, run the SQL against DuckDB before storing. Confirms the SQL is
not just syntactically valid but also semantically executable.

- Effort: Small | Risk: Low (adds latency)

## Recommended Action

Option A — add the `validateSQL` check. One-liner, consistent with POST.

## Technical Details

- `src/app/api/segments/[id]/route.ts:46-52`
- `validateSQL` is exported from `@/lib/sql-executor`

## Acceptance Criteria

- [ ] PATCH with a `sql` field containing `DROP TABLE events` returns 400
- [ ] PATCH with a valid `SELECT * FROM events WHERE ...` succeeds
- [ ] Import for `validateSQL` added to `segments/[id]/route.ts`

## Work Log

- 2026-03-02: Found by security-sentinel agent on PR #29
