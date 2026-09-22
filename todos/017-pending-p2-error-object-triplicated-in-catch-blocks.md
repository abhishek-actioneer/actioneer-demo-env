---
status: pending
priority: p2
issue_id: "017"
tags: [code-review, quality, sql-executor]
dependencies: []
---

# Error return object triplicated across all three executor catch blocks

## Problem Statement

PR #29 correctly extracted the success-path row materialisation into
`buildResult`. However, the failure-path is still copy-pasted identically
in all three executor functions:

```typescript
// executeSQLInternal catch (lines 78-86)
return {
  columns: [],
  rows: [],
  rowCount: 0,
  executionTimeMs: Math.round(performance.now() - start),
  error: err instanceof Error ? err.message : String(err),
};

// executeSQLPrepared catch (lines 131-138) — byte-for-byte identical
return {
  columns: [],
  rows: [],
  rowCount: 0,
  executionTimeMs: Math.round(performance.now() - start),
  error: err instanceof Error ? err.message : String(err),
};

// executeSQL catch (lines 163-170) — byte-for-byte identical
return {
  columns: [],
  rows: [],
  rowCount: 0,
  executionTimeMs: Math.round(performance.now() - start),
  error: err instanceof Error ? err.message : String(err),
};
```

If the error message format ever needs to change (e.g., to include a stack
trace in dev mode, or to sanitize error details in prod), three identical edits
are required — the exact problem `buildResult` was extracted to solve.

## Findings

- `src/lib/sql-executor.ts:78-86` — first copy
- `src/lib/sql-executor.ts:131-138` — second copy
- `src/lib/sql-executor.ts:163-170` — third copy
- `buildResult` (lines 26-45) correctly handles the success path; same pattern not applied to failure path

## Proposed Solutions

**Option A (Recommended): Extract `buildError` private helper**

```typescript
function buildError(err: unknown, start: number): QueryResult {
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    executionTimeMs: Math.round(performance.now() - start),
    error: err instanceof Error ? err.message : String(err),
  };
}
```

Each catch block becomes:

```typescript
} catch (err) {
  return buildError(err, start);
}
```

Removes 21 lines of duplication, consistent with the `buildResult` pattern
already established in this PR.

- Effort: Trivial | Risk: None

**Option B: Accept the duplication as intentional**

Each catch block is short and self-contained. The duplication is visible and
unlikely to drift. Reasonable position for a demo codebase.

## Recommended Action

Option A — extract `buildError`. The `buildResult` extraction was done in this
same PR specifically to eliminate this kind of copy-paste; applying the same
pattern to the error path is the natural completion.

## Technical Details

- `src/lib/sql-executor.ts:78-86, 131-138, 163-170`

## Acceptance Criteria

- [ ] A private `buildError(err, start)` helper exists
- [ ] All three catch blocks call it instead of inlining the object literal
- [ ] No `QueryResult` object literals remain in catch blocks
- [ ] All existing tests pass

## Work Log

- 2026-03-02: Found by code-simplicity-reviewer and pattern-recognition-specialist agents on PR #29
