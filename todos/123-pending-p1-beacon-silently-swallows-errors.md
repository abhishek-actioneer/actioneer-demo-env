---
status: complete
priority: p1
issue_id: "123"
tags: [code-review, data-integrity, observability, pr-48]
dependencies: []
---

# Beacon endpoints silently swallow all errors including disk-full writes

## Problem Statement

Both beacon endpoints catch every exception and return 204 regardless:

```ts
// src/app/api/boards/[id]/beacon/route.ts:12
} catch { /* sendBeacon — silent failure */ }

// src/app/api/conversations/[id]/beacon/route.ts:48
} catch { /* sendBeacon — silent failure */ }
```

A disk-full condition on Railway's volume, SQLite file corruption, or WAL lock timeout will silently swallow the error. Users closing a tab when disk is full will lose their last session state with no log entry, no metric, and no alert.

Additionally, the board beacon writes `upsertBoard` and `bulkUpsertCards` as **two separate transactions** — if the process is killed between them, board metadata and card data end up in inconsistent states.

## Findings

Source: Data Integrity Guardian.

- `boards/[id]/beacon/route.ts:10–12` — upsertBoard then bulkUpsertCards, catch swallows all
- `conversations/[id]/beacon/route.ts:48` — same silent catch pattern
- Two separate transactions for board+cards means partial persistence on crash
- Railway volumes do fill up — this is a known operational risk for this project

## Proposed Solutions

**Option A (Recommended): Log errors before swallowing + wrap in single transaction**
```ts
try {
  const db = getDb();
  db.transaction(() => {
    if (body.board) upsertBoard({ ...body.board, id });
    if (body.cards) bulkUpsertCards(id, body.cards);
  })();
} catch (err) {
  console.error("[beacon] board save failed:", err); // observable in Railway logs
  // Still return 204 — sendBeacon ignores the response
}
```
- Atomic board+cards write
- Error is logged but 204 still returned (sendBeacon ignores it)
- Effort: Small | Risk: Low

**Option B: Add error monitoring hook**
- Log to a structured error store or send to an observability endpoint
- More complex but enables alerting
- Effort: Medium | Risk: Low

## Recommended Action

Option A — add `console.error` logging inside the catch block as the minimum fix. The 204 response stays correct for sendBeacon semantics, but operators can now see failures in logs.

## Technical Details

- **Affected files:**
  - `src/app/api/boards/[id]/beacon/route.ts:10–12`
  - `src/app/api/conversations/[id]/beacon/route.ts:46–48`
- **Related:** `src/lib/server/board-repo.ts` (upsertBoard, bulkUpsertCards)

## Acceptance Criteria

- [x] Disk-full errors appear in Railway logs when beacon write fails
- [x] Board + cards saved in a single transaction (atomic)
- [x] 204 response still returned regardless of error (sendBeacon semantics preserved)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (data-integrity-guardian) | Silent catches on persistence paths = invisible data loss. Always log before swallowing. |
| 2026-03-23 | Fixed: wrapped board upsertBoard+bulkUpsertCards in a single `db.transaction()` call; changed both catch blocks from bare `catch {}` to `catch (err) { console.error(...) }`. Imported `getDb` from `@/lib/meta-db` in board beacon. |

## Resources

- PR #48: Unified Chart System + Server Persistence
