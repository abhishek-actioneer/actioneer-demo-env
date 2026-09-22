---
status: pending
priority: p2
issue_id: "055"
tags: [code-review, security, sql, segments]
dependencies: []
---

# executeSQLInternal bypasses SQL validation when re-executing stored segment SQL

## Problem Statement

`GET /api/segments/[id]` retrieves segment SQL from the database and re-executes it via `executeSQLInternal`, which explicitly bypasses `validateSQL()`. The comment says "trusted queries" but segment SQL originally came from LLM output. If an LLM were manipulated (e.g., via prompt injection) to generate DDL SQL, and a subsequent PATCH stores it without validation, the GET would re-execute that SQL without any safety check — creating a complete injection-to-execution chain.

## Findings

- `src/app/api/segments/[id]/route.ts` — GET handler uses `executeSQLInternal` with the comment "bypass validation (these are server-generated, trusted queries)".
- PATCH endpoint in the same file has no SQL validation (see issue 056), so the "trusted" assumption is not enforced.
- POST `/api/segments` does validate SQL on creation, but PATCH can overwrite stored SQL with arbitrary content — and the GET will execute it unsafely.
- The chain: prompt injection → LLM generates DDL → PATCH persists it unvalidated → GET re-executes it via `executeSQLInternal` with no validation.

## Proposed Solutions

### Option A: Replace `executeSQLInternal` with `executeSQL` in the GET handler

Swap the internal call for the public wrapper that runs `validateSQL()` first. Simplest fix with no API surface change.

### Option B: Explicit pre-validation before calling `executeSQLInternal`

Keep `executeSQLInternal` but add an explicit `validateSQL(sql)` call before it in the GET handler. Throw (or return 422) if validation fails, so the unsafe SQL never reaches DuckDB.

## Recommended Action

Option B is the safer long-term pattern because it makes the validation intent explicit at the call site. Pair this fix with issue 056 (PATCH validation) to close the full chain.

## Technical Details

- `executeSQLInternal` skips the `validateSQL()` guard that blocks DDL/DML keywords (DROP, INSERT, UPDATE, etc.).
- `validateSQL()` is defined in `src/lib/sql-executor.ts` and checks for blocked keywords plus SELECT-only enforcement.
- Affected file: `src/app/api/segments/[id]/route.ts`, GET handler.

## Acceptance Criteria

- [ ] GET `/api/segments/[id]` validates retrieved SQL before executing it against DuckDB.
- [ ] A segment whose stored SQL contains DDL (e.g., `DROP TABLE`) fails with an appropriate error rather than executing.
- [ ] No regression: valid SELECT-based segment SQL continues to execute and return results.
- [ ] Unit or integration test covers the "stored DDL SQL is blocked on GET" case.

## Work Log

## Resources

- Related: issue 056 (PATCH accepts unvalidated SQL)
- `src/app/api/segments/[id]/route.ts`
- `src/lib/sql-executor.ts` — `validateSQL`, `executeSQL`, `executeSQLInternal`
