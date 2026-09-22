---
status: complete
priority: p2
issue_id: "010"
tags: [code-review, simplicity, sql-executor]
dependencies: ["006"]
---

# rawRows.map() block is triplicated — todo-006 only extracted the constant, not the function

## Problem Statement

Todo-006 extracted `MAX_RESULT_ROWS = 500` and added the defense-in-depth comment. However, the
11-line row-materialization block is still copy-pasted verbatim in all three executor functions:

```typescript
// Lines 54-67 (executeSQLInternal)
// Lines 141-154 (executeSQLPrepared SELECT branch)
// Lines 187-200 (executeSQL)
const rows = rawRows.slice(0, MAX_RESULT_ROWS).map((row) => {
  const obj: Record<string, unknown> = {};
  colNames.forEach((col, i) => {
    const val = row[i];
    obj[col] = typeof val === "bigint" ? Number(val) : val;
  });
  return obj;
});
return {
  columns: colNames,
  rows,
  rowCount: rows.length,
  executionTimeMs: Math.round(performance.now() - start),
};
```

33 lines of identical code. If the bigint conversion or field-mapping logic ever changes, it requires
three identical edits — a classic maintenance trap.

## Proposed Solutions

**Option A (Recommended): Extract a private `buildResult` helper**
```typescript
function buildResult(
  colNames: string[],
  rawRows: unknown[][],
  start: number,
): QueryResult {
  const rows = rawRows.slice(0, MAX_RESULT_ROWS).map((row) => {
    const obj: Record<string, unknown> = {};
    colNames.forEach((col, i) => {
      const val = row[i];
      obj[col] = typeof val === "bigint" ? Number(val) : val;
    });
    return obj;
  });
  return {
    columns: colNames,
    rows,
    rowCount: rows.length,
    executionTimeMs: Math.round(performance.now() - start),
  };
}
```

Each of the three call sites becomes two lines:
```typescript
const colNames = result.columnNames();
return buildResult(colNames, await result.getRows(), start);
```

Net reduction: ~22 lines.
- Effort: Small | Risk: None

## Recommended Action

Option A. Purely mechanical extraction with zero semantic change.

## Technical Details

- Affected file: `src/lib/sql-executor.ts` (lines 54-67, 141-154, 187-200)
- Branch: `fix/railway-oom-duckdb-memory`

## Acceptance Criteria

- [ ] `buildResult` private helper exists and is used by all three executors
- [ ] No duplicate row-mapping blocks remain
- [ ] All existing tests pass unchanged

## Work Log

- 2026-03-02: Found by code-simplicity-reviewer and pattern-recognition-specialist on PR #29
