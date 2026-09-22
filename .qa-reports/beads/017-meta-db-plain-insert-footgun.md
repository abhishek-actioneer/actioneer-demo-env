# BEAD-017: meta-db.ts has plain INSERT statement that violates upsert convention

**Severity:** LOW
**Category:** Consistency / Data Integrity
**Page:** N/A (server-side)
**Ship-Readiness Impact:** WARN
**PR:** #48

---

## Summary

`src/lib/meta-db.ts` defines an `insert` prepared statement (line ~113) that is a bare `INSERT INTO conversations` without an `ON CONFLICT` clause. Per project conventions (AGENTS.md: "All server-side write endpoints must be idempotent upserts from day 1"), this is a footgun that will throw on duplicate IDs.

## Root Cause

**File:** `src/lib/meta-db.ts`

```typescript
insert: db.prepare(`
  INSERT INTO conversations (id, user_id, title, dataset_id, folder_id, origin, created_at, updated_at, tags, pending_actions, messages)
  VALUES (@id, @user_id, @title, @dataset_id, @folder_id, @origin, @created_at, @updated_at, @tags, @pending_actions, @messages)
`),
```

The file also has `upsertFull` and `upsertMessages` which are correct. The `insertOrIgnore` is acceptable for migration (skip duplicates). But `insert` will fail with `SQLITE_CONSTRAINT` if the same conversation ID is inserted twice (e.g., on retry after a timeout).

## Fix

Either:
1. Remove the `insert` statement if it's unused (check callers)
2. Replace with `ON CONFLICT(id) DO UPDATE SET ...` to match `upsertFull`
3. At minimum, rename to `insertStrict` to signal that it intentionally throws on duplicates, with a comment explaining the use case
