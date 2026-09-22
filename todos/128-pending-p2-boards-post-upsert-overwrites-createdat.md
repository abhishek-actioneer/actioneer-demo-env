---
status: pending
priority: p2
issue_id: "128"
tags: [code-review, data-integrity, sqlite, pr-48]
dependencies: []
---

# POST /api/boards upsert overwrites createdAt on client retry

## Problem Statement

`src/app/api/boards/route.ts` calls `upsertBoard()` which uses `ON CONFLICT(id) DO UPDATE SET ...` including `created_at`. A client-side retry of the create call (after a network timeout) will reset `createdAt` to the retry timestamp. The board will appear to have been "created" at the time of the retry, not the original creation.

```ts
// boards/route.ts POST handler
const now = new Date().toISOString();
upsertBoard({
  id: body.id, name: body.name, datasetId: body.datasetId,
  createdAt: now, updatedAt: now,  // ← overwrites original createdAt on retry
});
```

## Findings

Source: Data Integrity Guardian.

- `boards/route.ts:14–20` — creates with `now` as `createdAt`
- `upsertBoard` in `board-repo.ts` — `ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at` (overwrites on conflict)
- Compare: `conversations/route.ts` uses `insertOrIgnore` which correctly ignores duplicates
- Client-side board creation uses optimistic IDs (UUID generated client-side), making retries likely

## Proposed Solutions

**Option A (Recommended): Use COALESCE to preserve original createdAt**
```sql
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  updated_at = excluded.updated_at,
  -- Do NOT update created_at on conflict
  created_at = boards.created_at  -- keep original
```
Or use `INSERT OR IGNORE` for the create path (like conversations).

**Option B: Separate insert vs upsert paths**
- `POST /api/boards` uses `boardInsertIgnore` statement
- `PATCH /api/boards/[id]` uses `upsertBoard`
- Semantically cleaner: create is idempotent, update is explicit

## Recommended Action

Option A — add `created_at = boards.created_at` to the `DO UPDATE SET` clause in the upsert SQL.

## Technical Details

- **Affected files:** `src/lib/meta-db.ts` (boardUpsert prepared statement), `src/lib/server/board-repo.ts`

## Acceptance Criteria

- [ ] Retrying POST /api/boards with same ID does not change createdAt
- [ ] Board name and updatedAt still update correctly on upsert

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (data-integrity-guardian) | |

## Resources

- PR #48: Unified Chart System + Server Persistence
