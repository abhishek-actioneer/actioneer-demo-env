---
status: pending
priority: p3
issue_id: "068"
tags: [code-review, react, hooks, use-action-handlers]
dependencies: []
---

# markPendingActionCompleted function declaration nested inside useCallback body

## Problem Statement

In `use-action-handlers.ts`, `markPendingActionCompleted` is declared as a named function inside the body of `handleFollowUpAction`'s `useCallback`. This means the inner function is recreated on every invocation of the callback (not just on dep changes), makes the code harder to follow due to nesting depth, and relies on implicit closure over `activeConvId` without the dep list automatically covering any future expansions of the inner function's dependencies.

## Findings

- `src/hooks/use-action-handlers.ts` lines 82-89: `function markPendingActionCompleted(a: FollowUpAction) { ... }` declared inside the `useCallback` for `handleFollowUpAction`.
- The inner function closes over `activeConvId` from the outer hook scope.
- `activeConvId` appears in the `useCallback` deps array for the outer callback, but the inner function's own implicit deps are not separately tracked — a future addition to `markPendingActionCompleted` that uses another hook value could silently miss the dep.

## Proposed Solutions

### Option A: Extract as a module-level pure function

Move `markPendingActionCompleted` outside the hook entirely as a pure module-level function with explicit parameters:

```typescript
function markPendingActionCompleted(
  activeConvId: string | null,
  action: FollowUpAction
): void {
  if (!activeConvId) return;
  const conv = getConversation(activeConvId);
  if (!conv) return;
  markPendingAction(conv, action, "completed");
}
```

Call it from inside the `useCallback` passing `activeConvId` explicitly. The inner function is no longer recreated on callback invocation, and all dependencies are explicit.

### Option B: Hoist to a separate useCallback inside the hook

Define `markPendingActionCompleted` as its own `useCallback` at the hook level, not nested. It can still close over `activeConvId` but is stable across renders when deps don't change, and its dep list is explicit and independently verifiable.

## Recommended Action

Option A if `markPendingActionCompleted` has no reason to be reactive (it operates on store functions and a passed ID). Option B if future versions need access to other hook state. Option A results in a simpler, testable pure function.

## Technical Details

- Functions declared inside `useCallback` bodies are recreated on every callback call, not just on dep changes. For a frequently-called action handler this is a minor but unnecessary allocation.
- The deeper concern is maintainability: a contributor adding logic to `markPendingActionCompleted` may not notice the missing dep list for the inner function, since inner functions don't have their own `useCallback` dep arrays.
- `getConversation` and `markPendingAction` are store utilities — they are likely stable references, making Option A viable.

## Acceptance Criteria

- [ ] `markPendingActionCompleted` is no longer declared inside a `useCallback` body.
- [ ] All dependencies of `markPendingActionCompleted` are explicit (either as function parameters or in a `useCallback` dep array).
- [ ] Behavior is identical — same store mutations, same early-return guards.
- [ ] No TypeScript errors. No lint errors.

## Work Log

## Resources

- `src/hooks/use-action-handlers.ts` lines 82-89
