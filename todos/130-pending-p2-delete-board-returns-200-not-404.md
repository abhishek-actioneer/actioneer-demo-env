---
status: pending
priority: p2
issue_id: "130"
tags: [code-review, api, correctness, pr-48]
dependencies: []
---

# DELETE /api/boards/[id] returns 200 for non-existent board (ignores changes count)

## Problem Statement

`src/app/api/boards/[id]/route.ts` DELETE handler ignores whether any rows were actually deleted:

```ts
export async function DELETE(_req: Request, { params }: ...) {
  const { id } = await params;
  deleteBoard(id);  // returns boolean — ignored!
  return Response.json({ ok: true });  // always 200
}
```

Deleting a non-existent board ID returns `{ ok: true }` with 200 instead of 404. The conversations route correctly checks `result.changes === 0` and returns 404. This is an inconsistency and a bug for any client that checks the response to confirm deletion.

## Findings

Source: TypeScript reviewer + Data Integrity Guardian.

- `boards/[id]/route.ts:32–36` — `deleteBoard()` return value ignored
- `conversations/[id]/route.ts:117–119` — correct pattern: `if (result.changes === 0) return 404`
- `board-repo.ts:deleteBoard` — returns `boolean` indicating rows changed

## Proposed Solutions

**Option A (Recommended): Check changes and return 404**
```ts
export async function DELETE(_req: Request, ...) {
  const { id } = await params;
  const deleted = deleteBoard(id);
  if (!deleted) return Response.json({ error: "Board not found" }, { status: 404 });
  return Response.json({ ok: true });
}
```

## Recommended Action

Option A — trivial 2-line fix matching the conversations pattern.

## Technical Details

- **Affected files:** `src/app/api/boards/[id]/route.ts:32–36`

## Acceptance Criteria

- [ ] DELETE for non-existent board ID returns 404
- [ ] DELETE for existing board returns 200 with `{ ok: true }`
- [ ] Consistent with conversations DELETE behavior

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (typescript-reviewer) | |

## Resources

- PR #48: Unified Chart System + Server Persistence
