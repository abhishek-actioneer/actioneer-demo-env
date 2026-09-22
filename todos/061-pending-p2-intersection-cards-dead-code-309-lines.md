---
status: pending
priority: p2
issue_id: "061"
tags: [code-review, dead-code, simplification]
dependencies: []
---

# intersection-cards.ts is 309 lines of dead code — exported function has zero import sites

## Problem Statement

`src/lib/intersection-cards.ts` exports `getIntersectionCards()` but this function is never imported anywhere in the codebase. The entire file — three card types, O(n×m) conversation walking, `ACTION_PAGE_MAP`, and helper functions — ships in the bundle without any live consumer. Additionally, `PendingAction.completedAt/dismissedAt` lifecycle tracking and `markPendingAction()` in `conversation-store.ts` exist only to serve this dead function, adding maintenance surface and cognitive overhead for no active benefit.

## Findings

- `src/lib/intersection-cards.ts` — 309 lines, exports `getIntersectionCards()`.
- Grep for `getIntersectionCards` across the entire `src/` directory returns zero import sites.
- The function calls `getAllConversations()`, `getAllSavedPlaybooks()`, `getAllEntries()`, `getAllCanvasItems()` — all live store functions, used only for this dead path.
- `conversation-store.ts` exports `markPendingAction()` which is called from `use-action-handlers.ts` to set `completedAt` — a field read only by `intersection-cards.ts`.
- `PendingAction.completedAt` and `PendingAction.dismissedAt` fields in `conversation-types.ts` exist only for this dead feature.
- Estimated total removal: ~380 lines across files.

## Proposed Solutions

### Option A: Delete intersection-cards.ts and remove all dead supporting code

1. Delete `src/lib/intersection-cards.ts` entirely.
2. Remove `PendingAction.completedAt` and `PendingAction.dismissedAt` from `src/lib/conversation-types.ts`.
3. Simplify or remove `extractPendingActions()` and `markPendingAction()` from `src/lib/conversation-store.ts`.
4. Remove the call to `markPendingActionCompleted` (or equivalent) in `src/hooks/use-action-handlers.ts`.
5. Run `pnpm build` and `pnpm lint` to confirm no remaining references.

### Option B: Wire up getIntersectionCards() to a component before merging

If the intersection cards feature is intended to be part of this PR, add a consumer component that calls `getIntersectionCards()` with a `useMemo` guard. This validates the function is intentional and not accidentally orphaned.

## Recommended Action

Option A. If the feature was intentional and is coming in a future PR, the dead code should still be removed now and reintroduced with its consumer. Shipping 380 lines of dead code adds bundle weight and maintenance burden.

## Technical Details

- `getIntersectionCards()` walks all conversations and playbooks with nested loops — if it ever gets a live consumer without memoization, it will be a performance issue.
- The `ACTION_PAGE_MAP` constant in `intersection-cards.ts` may partially duplicate routing logic elsewhere; check before deleting.
- Affected files: `src/lib/intersection-cards.ts`, `src/lib/conversation-types.ts`, `src/lib/conversation-store.ts`, `src/hooks/use-action-handlers.ts`.

## Acceptance Criteria

- [ ] `intersection-cards.ts` is deleted (or has a live import).
- [ ] `markPendingAction` / `completedAt` / `dismissedAt` are removed if they have no remaining consumers.
- [ ] `pnpm build` passes after removal.
- [ ] `pnpm lint` passes after removal.
- [ ] No `getIntersectionCards` references remain in the codebase.

## Work Log

## Resources

- `src/lib/intersection-cards.ts`
- `src/lib/conversation-types.ts`
- `src/lib/conversation-store.ts`
- `src/hooks/use-action-handlers.ts`
