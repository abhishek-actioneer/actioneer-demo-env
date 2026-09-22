---
status: complete
priority: p1
issue_id: "118"
tags: [code-review, security, chart-requery, pr-48]
dependencies: []
---

# chart-requery executes client-supplied SQL via executeSQLInternal (no validation)

## Problem Statement

`src/app/api/chart-requery/route.ts` accepts raw SQL from the HTTP request body and passes it to `executeSQLInternal` after regex-based transformations. `executeSQLInternal` explicitly **bypasses SQL validation** — it was designed for "known-safe, server-generated queries only." A client sending DDL (`DROP TABLE`), file exfiltration (`COPY ... TO '/tmp/out.txt'`), or `read_parquet('/etc/passwd')` will execute without any guard.

Concrete exploit:
```json
{ "sql": "COPY (SELECT * FROM read_parquet('/etc/passwd')) TO '/tmp/out.txt'", "newGrain": "daily" }
```

## Findings

Source: Security Sentinel + TypeScript reviewer.

- `src/app/api/chart-requery/route.ts:94` calls `executeSQLInternal(transformed, datasetId)`
- `sql-executor.ts:96` documents: "Internal SQL executor — bypasses validation. Only use from server-side API routes for known-safe queries."
- The SQL comes directly from `req.json()` with no prior validation
- `validateSQL()` in sql-executor.ts blocks DDL/DML keywords — it's deliberately not called here

## Proposed Solutions

**Option A (Recommended): Replace with `executeSQL`**
- Change line 94 to `executeSQL(transformed, datasetId)` which calls `validateSQL` first
- Return 400 if validation fails (the SQL was already validated when originally generated, so a failure here indicates tampering)
- Effort: Trivial | Risk: Low

**Option B: Add explicit validateSQL call**
- Call `validateSQL(transformed)` at the top of the handler and return 400 on failure
- Keeps `executeSQLInternal` for performance reasons (no extra validation overhead)
- Effort: Trivial | Risk: Low

## Recommended Action

Option A — simply use `executeSQL` which already has the validation gate built in.

## Technical Details

- **Affected files:** `src/app/api/chart-requery/route.ts:94`
- **Related:** `src/lib/sql-executor.ts` (executeSQLInternal vs executeSQL)
- The same issue was previously caught for metrics (#084) and segments (#055)

## Acceptance Criteria

- [ ] chart-requery validates SQL before execution
- [ ] DDL/DML payloads return 400, not 500 or 200
- [ ] Valid grain/date-transformed SQL still executes correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (security-sentinel + typescript-reviewer) | executeSQLInternal is a recurring bypass pattern — all new routes must use executeSQL |
| 2026-03-23 | Fixed: replaced `executeSQLInternal` with `executeSQL` in `src/app/api/chart-requery/route.ts` (import + call site). SQL validation now enforced before execution. | One-line fix; `executeSQL` already has the validateSQL gate built in — no other changes needed. |

## Resources

- PR #48: Unified Chart System + Server Persistence
- Related: #084 (metrics), #055 (segments)
