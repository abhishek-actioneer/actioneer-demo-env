---
status: pending
priority: p1
issue_id: "084"
tags: [code-review, security, metrics, pr-41]
dependencies: []
---

# LLM-generated metric SQL executed without validation via executeSQLInternal

## Problem Statement

`src/app/api/metrics/route.ts` (lines 46 and 58) calls `executeSQLInternal(def.valueSql, datasetId)` and `executeSQLInternal(def.timeSeriesSql, datasetId)` in `computeMetric()`. The `executeSQLInternal` function explicitly **bypasses SQL validation** (it was designed for "known-safe queries that may not be SELECT statements").

The metric definitions are LLM-generated JSON written to disk by `/api/metrics/generate`. Neither the generation path nor the execution path validates that the SQL is SELECT-only and free of DDL/DML.

If the LLM is manipulated (via prompt injection through schema data, or a model regression) to emit `DROP TABLE`, `DELETE FROM`, or `INSERT INTO` as `valueSql` or `timeSeriesSql`, those statements will execute without any guard.

## Findings

Source: Security Sentinel agent review.

- `executeSQLInternal` (sql-executor.ts:95+) is documented as a bypass for "known-safe queries"
- Metric SQL comes from LLM output → disk → execution with no validation gate
- Compare: segment SQL validation in `generate-all` uses `executeSQL()` which enforces SELECT-only
- Additionally, DuckDB functions like `read_csv('/etc/passwd')` would pass even `executeSQL` validation

## Proposed Solutions

**Option A (Recommended): Route metric SQL through executeSQL() instead of executeSQLInternal()**
- Change `computeMetric` to use `executeSQL(def.valueSql, datasetId)` and `executeSQL(def.timeSeriesSql, datasetId)`
- This applies the validateSQL gate (SELECT-only, DDL/DML blocklist)
- Effort: Trivial | Risk: Low (may surface existing bad SQL in metrics.json files)

**Option B: Validate at generation time before writing to disk**
- Add `validateSQL()` check in `generateMetricDefinitions()` and reject any metric whose SQL fails
- Effort: Small | Risk: Low

**Option C: Both (belt and suspenders)**
- Validate at generation AND at execution time
- Effort: Small | Risk: None

## Recommended Action

Option C — validate at both boundaries.

## Technical Details

- **Affected files:** `src/app/api/metrics/route.ts`, `src/lib/datasets/metric-generator.ts`
- **Related:** `src/lib/sql-executor.ts` (executeSQLInternal bypass path)

## Acceptance Criteria

- [ ] Metric SQL passes through validateSQL before execution
- [ ] Malicious SQL in metrics.json does not execute
- [ ] Existing valid metric SQL continues to work

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (security-sentinel agent) | executeSQLInternal is a validation bypass |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
