---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, sql-executor, correctness]
dependencies: []
---

# ensureLimit uses .search() which returns FIRST SELECT, not last — CTE guard is inverted

## Problem Statement

`ensureLimit()` in `src/lib/sql-executor.ts` is documented as checking "only the tail from the **last** SELECT to avoid false-positives on CTEs with inner LIMITs." But `String.prototype.search()` returns the index of the **first** regex match. The code and comment are directly contradictory.

For a CTE query:
```sql
WITH base AS (SELECT * FROM events LIMIT 1000)
SELECT user_id FROM base
```

- `lastSelectIdx` lands on the `SELECT` inside the CTE (position ~14)
- `tail` covers the rest of the string from there, including `LIMIT 1000`
- `/\bLIMIT\b/i.test(tail)` → `true`
- `ensureLimit` returns the query **unchanged** — no outer LIMIT appended
- The outer `SELECT user_id FROM base` runs without a LIMIT cap

This defeats the entire purpose of `ensureLimit` for CTE queries, which are exactly the complex analytical queries most likely to produce large result sets. The DuckDB `memory_limit` alone still protects against native OOM, but the JS-side materialization overhead is not bounded.

## Findings

Confirmed in `sql-executor.ts:17`:
```ts
const lastSelectIdx = normalized.search(/\bSELECT\b/i);  // finds FIRST, not last
```

Gemini generates CTEs frequently for multi-step aggregations (cohort retention, daily metrics agents).

## Proposed Solutions

**Option A (Recommended): Use matchAll to find the last SELECT**
```ts
const matches = [...normalized.matchAll(/\bSELECT\b/gi)];
const lastSelectIdx = matches.length > 0 ? matches[matches.length - 1].index! : -1;
```
- Effort: Small | Risk: Low

**Option B: Simplify — drop the CTE heuristic, just check if LIMIT exists anywhere**
```ts
function ensureLimit(sql: string, limit = MAX_RESULT_ROWS): string {
  const normalized = sql.trim().replace(/;+\s*$/, "");
  if (/\bLIMIT\b/i.test(normalized)) return normalized;
  return `${normalized} LIMIT ${limit}`;
}
```
Simpler code, but the CTE-with-inner-LIMIT false-positive is accepted as an edge case.
- Effort: Tiny | Risk: Low (acceptable for a demo app; Gemini rarely generates CTEs with inner LIMITs on outer-unbounded outer queries)

**Option C: Rely solely on DuckDB memory_limit, remove ensureLimit entirely**
- Drop the SQL rewriter, keep only the JS `.slice(0, 500)` for result delivery
- DuckDB OOM error is thrown and caught, returned as `result.error`
- Effort: Small (deletion) | Risk: Low for memory safety (DuckDB cap still applies)

## Recommended Action

Option B — simplify `ensureLimit` to a plain LIMIT-anywhere check. The `lastSelectIdx` approach is overengineered for this use case. The plan document acknowledged "CTE with inner LIMIT" as an edge case; for a demo app accepting that tradeoff is fine.

## Technical Details

- Affected file: `src/lib/sql-executor.ts:15-21`
- Branch: `fix/railway-oom-duckdb-memory`

## Acceptance Criteria

- [ ] `ensureLimit` correctly appends LIMIT on a CTE query with an inner LIMIT
- [ ] OR simplified version with known edge case documented in comment
- [ ] Existing tests pass

## Work Log

- 2026-03-02: Found by architecture-strategist, performance-oracle, security-sentinel, pattern-recognition-specialist review agents on PR #29
