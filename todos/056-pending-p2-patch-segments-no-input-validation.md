---
status: pending
priority: p2
issue_id: "056"
tags: [code-review, security, segments, api]
dependencies: []
---

# PATCH /api/segments/[id] accepts raw SQL without Zod schema or SQL validation

## Problem Statement

The PATCH handler in `src/app/api/segments/[id]/route.ts` accepts `name` and `sql` from the request body with only an `as { name?: string; sql?: string }` TypeScript cast — no Zod schema, no length limits, and no `validateSQL()` call. An authenticated caller can set a segment's SQL to any arbitrary string including DDL statements. The updated SQL is then re-executed via `executeSQLInternal` on every subsequent GET, creating a stored-SQL injection chain.

## Findings

- `src/app/api/segments/[id]/route.ts` PATCH handler — body destructured with bare `as { name?: string; sql?: string }` cast, no Zod parse.
- No call to `validateSQL()` on the incoming `sql` field before it is persisted.
- POST `/api/segments` does call `validateSQL()` on creation, so the validation logic exists — PATCH simply bypasses it.
- Combined with issue 055 (`executeSQLInternal` bypass on GET), this forms a complete stored-injection chain: PATCH stores DDL → GET executes it.

## Proposed Solutions

### Option A: Add Zod schema and SQL validation to the PATCH handler

Define a Zod schema:

```typescript
const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sql: z.string().min(1).optional(),
});
```

Parse the request body with `patchSchema.safeParse(body)`. If `sql` is present, call `validateSQL(sql)` before persisting. Return 400 on schema failure, 422 on SQL validation failure.

### Option B: Disallow SQL updates via PATCH entirely

Only allow `name` changes through PATCH. If the SQL needs to change, the caller must create a new segment via POST (which already validates). This is the most conservative fix and eliminates the attack surface entirely for SQL mutation.

## Recommended Action

Option A preserves flexibility while closing the vulnerability. Pair with issue 055 to ensure defense-in-depth: validate on write (PATCH) and validate on read (GET).

## Technical Details

- Affected file: `src/app/api/segments/[id]/route.ts`, PATCH handler.
- `validateSQL()` is in `src/lib/sql-executor.ts`.
- Zod is already a project dependency; other API routes (e.g., POST `/api/segments`) use it consistently.

## Acceptance Criteria

- [ ] PATCH body is parsed through a Zod schema with defined field types and length limits.
- [ ] Any `sql` field in a PATCH request is run through `validateSQL()` before being persisted.
- [ ] A PATCH request with DDL SQL (e.g., `DROP TABLE events`) returns 422, not 200.
- [ ] A PATCH request with a valid SELECT SQL updates the segment successfully.
- [ ] A PATCH request with an oversized `name` (>200 chars) returns 400.

## Work Log

## Resources

- Related: issue 055 (GET re-executes stored SQL without validation)
- `src/app/api/segments/[id]/route.ts`
- `src/lib/sql-executor.ts` — `validateSQL`
