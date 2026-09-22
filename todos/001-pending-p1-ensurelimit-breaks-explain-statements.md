---
status: complete
priority: p1
issue_id: "001"
tags: [code-review, data-integrity, sql-executor]
dependencies: []
---

# ensureLimit() injected into EXPLAIN statements — breaks playbook validation

## Problem Statement

`executeSQLInternal` now runs `ensureLimit(sql)` unconditionally before every `conn.run()` call. Two production call sites pass `EXPLAIN <sql>` to this function:

- `src/app/api/playbook/validate/route.ts:24` — `executeSQLInternal(\`EXPLAIN ${resolvedSql}\`)`
- `src/app/api/schema/tables/route.ts:53` — `executeSQLInternal(\`EXPLAIN ${sanitized}\`)`

`ensureLimit` finds the `SELECT` inside the EXPLAIN body and appends `LIMIT 500`, producing malformed SQL like `EXPLAIN SELECT ... LIMIT 500`. This may work in current DuckDB versions (silently) but breaks the semantic purpose of EXPLAIN and risks DuckDB rejecting it in future versions, causing all playbook validation to fail.

## Findings

Confirmed via grep:
```
src/app/api/playbook/validate/route.ts:24 — executeSQLInternal(`EXPLAIN ${resolvedSql}`)
```

`executeSQLInternal` is documented as a bypass path for "known-safe queries that may not be SELECT statements" — applying `ensureLimit` inside it is too broad.

## Proposed Solutions

**Option A (Recommended): Move ensureLimit out of executeSQLInternal, apply only at call sites that guarantee SELECT**
- Remove `ensureLimit()` from `executeSQLInternal`
- Keep it in `executeSQL` (already validates SELECT-only) and in `executeSQLPrepared` SELECT branch
- Effort: Small | Risk: Low

**Option B: Add an EXPLAIN guard inside ensureLimit**
- Check for `/^\s*EXPLAIN\b/i` and return early
- Effort: Small | Risk: Low (but treats symptom not cause)

**Option C: Add a `skipLimit` parameter to executeSQLInternal**
- Callers that pass EXPLAIN pass `skipLimit: true`
- Effort: Small | Risk: Medium (easy to forget)

## Recommended Action

Option A — move `ensureLimit` out of `executeSQLInternal`. That function is already named "Internal" to signal it's for trusted/bypass use; adding a SQL rewriter to it violates that contract.

## Technical Details

- Affected files: `src/lib/sql-executor.ts`, `src/app/api/playbook/validate/route.ts`, `src/app/api/schema/tables/route.ts`
- Branch: `fix/railway-oom-duckdb-memory`

## Acceptance Criteria

- [ ] `executeSQLInternal` does NOT call `ensureLimit`
- [ ] `EXPLAIN SELECT * FROM events` via playbook validation returns no error
- [ ] `executeSQL` and `executeSQLPrepared` SELECT branch still call `ensureLimit`

## Work Log

- 2026-03-02: Found by data-integrity-guardian and security-sentinel review agents on PR #29
