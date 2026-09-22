---
status: complete
priority: p1
issue_id: "122"
tags: [code-review, data-integrity, sqlite, pr-48]
dependencies: []
---

# deleteSection is not atomic — partial card deletes on process crash

## Problem Statement

`src/lib/server/board-repo.ts` `deleteSection` performs N individual card deletes followed by one section delete with **no transaction wrapper**:

```ts
export function deleteSection(boardId: string, sectionId: string): boolean {
  const s = stmts();
  const cardRows = s.cardGetByBoard.all(boardId); // fetch all cards
  for (const row of cardRows) {
    const card = JSON.parse(row.data) as BoardCard;
    if (card.sectionId === sectionId) {
      s.cardDeleteOne.run(boardId, card.id); // individual deletes!
    }
  }
  return s.sectionDeleteOne.run(boardId, sectionId).changes > 0;
}
```

If the process crashes between any two card deletes (OOM, Railway restart), some cards from the section are deleted and others remain — orphaned cards with `sectionId` pointing to a non-existent section. The FK constraint only cascades from board→cards, not from section→cards.

Additionally, this is an N+1 query pattern (one DELETE per card vs. one bulk DELETE).

## Findings

Source: Data Integrity Guardian + Performance Oracle.

- `board-repo.ts:140–149` — unbounded card fetch + per-card delete loop
- SQLite FK schema: section delete does NOT cascade to cards (only board→card has cascade)
- Orphaned cards remain in `board_cards` with invalid `sectionId` after partial failure
- No repair path — corrupt board state is permanent

## Proposed Solutions

**Option A (Recommended): Wrap in transaction + use bulk DELETE**
```ts
export function deleteSection(boardId: string, sectionId: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    // Delete cards where JSON sectionId matches — single statement
    db.prepare(`
      DELETE FROM board_cards
      WHERE board_id = ?
      AND json_extract(data, '$.sectionId') = ?
    `).run(boardId, sectionId);
    return (db.prepare(`
      DELETE FROM board_sections WHERE board_id = ? AND id = ?
    `).run(boardId, sectionId).changes > 0);
  })();
}
```
- Atomic: both succeed or both roll back
- Single DELETE instead of N deletes (eliminates N+1)
- Effort: Small | Risk: Low

**Option B: Add transaction wrapper without query change**
- Wrap existing loop in `db.transaction()` for atomicity
- Keeps N+1 pattern but at least prevents partial state
- Effort: Trivial | Risk: Low

## Recommended Action

Option A — fixes both atomicity and N+1 in one change.

## Technical Details

- **Affected files:** `src/lib/server/board-repo.ts:140–149`
- **Related:** `src/lib/meta-db.ts` (getDb export)
- `json_extract(data, '$.sectionId')` is supported by SQLite ≥ 3.38 (which is in Node's bundled version)

## Acceptance Criteria

- [x] Section + its cards deleted atomically
- [x] Process crash mid-delete leaves database in consistent state
- [x] No orphaned cards remain after section delete
- [x] Single SQL statement replaces N individual DELETE calls

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (data-integrity-guardian + performance-oracle) | better-sqlite3 transactions are synchronous and easy to add — always wrap multi-step mutations |
| 2026-03-23 | Implemented Option A: replaced N+1 loop with `db.transaction()` wrapping a single `json_extract`-based bulk DELETE for cards then section delete. Both deletes are atomic. | `json_extract(data, '$.sectionId')` works in SQLite bundled with Node 18+; no migration needed |

## Resources

- PR #48: Unified Chart System + Server Persistence
- better-sqlite3 transactions: `db.transaction(fn)()`
