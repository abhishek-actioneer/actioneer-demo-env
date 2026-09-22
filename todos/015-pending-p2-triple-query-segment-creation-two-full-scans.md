---
status: pending
priority: p2
issue_id: "015"
tags: [code-review, performance, segments]
dependencies: []
---

# POST /api/segments runs two full table scans (validate + count) for a single segment creation

## Problem Statement

`POST /api/segments` executes three sequential DuckDB operations for every
segment creation, two of which are full table scans over the same data:

```typescript
// Step 1 — full validation query (returns ≤500 rows, then discarded)
const validationResult = await executeSQL(sql, datasetId);
if (validationResult.error) return 400;

// Step 2 — COUNT(*) subquery (another full scan)
const countSql = `SELECT COUNT(*) as cnt FROM (${sql.trim().replace(/;+\s*$/, "")}) __count`;
const countResult = await executeSQL(countSql, datasetId);
const userCount = Number(countResult.rows[0]?.cnt ?? 0);

// Step 3 — INSERT (cheap)
await executeSQLPrepared(`INSERT INTO segments ...`, [...]);
```

**The problem with Step 1:** `executeSQL` applies `validateSQL` (a synchronous
keyword check) and then executes the full SQL against DuckDB. Up to 500 rows
are returned and immediately discarded. The only value extracted from Step 1 is
`validationResult.error` — but `validateSQL` already ran synchronously at the
start of `executeSQL`. The DuckDB execution in Step 1 provides no additional
validation value beyond what the static keyword check already confirmed.

**Total cost:** Two full parquet scans for validation + count, before the INSERT.
For a segment query over the events table (hundreds of thousands of rows), each
scan can take 200-500ms. Segment creation latency = 400ms-1s of redundant
scanning, plus both operations serialise through the `enqueue` queue, blocking
concurrent analytics queries.

## Findings

- `src/app/api/segments/route.ts:48-65`
- `executeSQL` at line 48: executes full SQL, returns ≤500 rows, all discarded
- `executeSQL` at line 55: wraps same SQL in COUNT(*), another full scan
- Both operations queue through `withConnection` → `enqueue`, serialised per dataset
- The validation at line 48 provides no safety value beyond the synchronous `validateSQL` call already inside `executeSQL`

## Proposed Solutions

**Option A (Recommended): Combine validation and count into a single query**

```typescript
// One query validates syntax AND returns the count
const countSql = `SELECT COUNT(*) as cnt FROM (${sql.trim().replace(/;+\s*$/, "")}) __count`;
const countResult = await executeSQL(countSql, datasetId);
if (countResult.error) {
  return Response.json({ error: `Invalid SQL: ${countResult.error}` }, { status: 400 });
}
const userCount = Number(countResult.rows[0]?.cnt ?? 0);
```

- If the segment SQL is syntactically invalid, the COUNT(*) subquery will error
  and be caught at `countResult.error`.
- The COUNT(*) itself confirms the SQL runs successfully — equivalent validation.
- One full scan instead of two. Queue entries: 2 instead of 3 (count + insert).
- Effort: Small | Risk: Low

**Option B: Replace Step 1 with EXPLAIN to validate syntax at near-zero cost**

```typescript
const explainResult = await executeSQLInternal(`EXPLAIN ${sql}`, datasetId);
if (explainResult.error) return Response.json({ error: `Invalid SQL: ${explainResult.error}` }, { status: 400 });

const countSql = `SELECT COUNT(*) as cnt FROM (${sql}) __count`;
const countResult = await executeSQL(countSql, datasetId);
```

EXPLAIN returns the query plan without executing it — essentially free. Then
the COUNT(*) is the only full scan.

- Effort: Small | Risk: Low

## Technical Details

- `src/app/api/segments/route.ts:48-65`
- Each `executeSQL` call → `withConnection` → `enqueue` → DuckDB scan

## Acceptance Criteria

- [ ] `POST /api/segments` makes at most 2 DuckDB calls (not 3) for a valid segment
- [ ] Invalid SQL still returns 400 with an error message
- [ ] `userCount` reflects the actual row count of the segment
- [ ] Existing segment creation tests pass

## Work Log

- 2026-03-02: Found by performance-oracle and architecture-strategist agents on PR #29
