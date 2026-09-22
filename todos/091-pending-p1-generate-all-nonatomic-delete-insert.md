---
status: pending
priority: p1
issue_id: "091"
tags: [code-review, security, data-integrity, segments, pr-41]
dependencies: []
---

# Non-atomic DELETE before INSERT in `segments/generate-all` — no rollback on failure

## Problem Statement

`src/app/api/segments/generate-all/route.ts` runs a destructive `DELETE` (line 57) unconditionally before any new segments are validated or inserted:

```ts
await executeSQLPrepared(
  `DELETE FROM sentinel_segments WHERE source_conversation_id IS NULL`,
  [],
  datasetId,
);
// ... then sequential insert loop — up to 60 seconds, no transaction
```

If any of the following occurs after the DELETE:
- All 12 candidate SQLs fail validation
- The `VALIDATION_DEADLINE` (60s) expires before any insert completes
- The server crashes mid-loop
- A network timeout interrupts the request

...then the user's previously auto-generated segments are permanently deleted with no rollback. The user's manually-created segments (with `source_conversation_id IS NOT NULL`) are preserved, but auto-generated ones are gone.

This creates a denial-of-service condition against the user's own data when generation partially fails.

## Findings

Source: Security Sentinel agent review.

- Line 57–61: DELETE runs before any validation
- Line 67: `VALIDATION_DEADLINE = Date.now() + 60_000` — hard stop, partial results possible
- Line 115–120: if `generated === 0`, returns 422 — but segments are already deleted
- DuckDB supports explicit transactions — none are used here

## Proposed Solutions

**Option A (Recommended): Wrap in a transaction**
```ts
await executeSQLPrepared(`BEGIN`, [], datasetId);
try {
  await executeSQLPrepared(`DELETE FROM sentinel_segments WHERE source_conversation_id IS NULL`, [], datasetId);
  // ... insert loop ...
  await executeSQLPrepared(`COMMIT`, [], datasetId);
} catch (err) {
  await executeSQLPrepared(`ROLLBACK`, [], datasetId);
  throw err;
}
```
Note: `executeSQLPrepared` validates for SELECT-only — `BEGIN`/`COMMIT`/`ROLLBACK` will need to use `executeSQLInternal` (which is appropriate for trusted server-side transaction management SQL).
- Effort: Small | Risk: Low

**Option B: Move DELETE after at least one successful INSERT**
- Only delete old segments after confirming at least one new segment was inserted successfully
- Soft protection — doesn't cover mid-loop crashes
- Effort: Small | Risk: Medium (doesn't fully solve the problem)

**Option C: Use a staging approach**
- Insert new segments with a temporary `_pending` flag, then atomically swap
- Effort: Large | Risk: Low

## Recommended Action

Option A — explicit transaction using `executeSQLInternal` for the transaction control statements, since `BEGIN`/`COMMIT`/`ROLLBACK` are safe administrative SQL.

## Technical Details

- **Affected file:** `src/app/api/segments/generate-all/route.ts` lines 57–113
- DuckDB WAL mode supports BEGIN/COMMIT/ROLLBACK

## Acceptance Criteria

- [ ] If all segment insertions fail, previously auto-generated segments are preserved
- [ ] If the server crashes mid-generation, the database rolls back to its pre-call state
- [ ] Successful generation still clears old auto-generated segments and replaces with new ones

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (security-sentinel agent) | DuckDB supports transactions; executeSQLInternal needed for DDL-like control statements |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
