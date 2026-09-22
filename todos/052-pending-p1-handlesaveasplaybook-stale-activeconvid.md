---
status: done
priority: p1
issue_id: "052"
tags: [code-review, bug, react, hooks, use-action-handlers]
dependencies: []
---

# handleSaveAsPlaybook missing activeConvId in useCallback deps — playbook saved with stale conversation ID

## Problem Statement
In `use-action-handlers.ts`, `handleSaveAsPlaybook` uses `activeConvId` inside its callback body but does not include it in the `useCallback` dependency array. When a user switches conversations and then saves a playbook, the callback stale-closes over the old `activeConvId`, associating the playbook with the wrong (previous) conversation. This is a silent data integrity bug — no error is thrown, but the playbook is permanently linked to the incorrect conversation.

## Findings
`src/hooks/use-action-handlers.ts` lines 96-116:

```typescript
const handleSaveAsPlaybook = useCallback(
  (userQuery: string) => {
    const playbook = buildPlaybookFromResearch(
      messages,
      userQuery,
      activeConvId ?? undefined   // uses activeConvId from closure
    );
    // ...
  },
  [messages, setMessages, router, notifyPlaybookSaved]   // activeConvId NOT listed here — BUG
);
```

- `activeConvId` is referenced inside the callback at the `buildPlaybookFromResearch` call.
- It is not present in the dependency array, so React will never re-create the callback when `activeConvId` changes.
- After switching conversations, `handleSaveAsPlaybook` still holds the previous conversation's ID.
- Confirmed by the pattern-recognition agent as a real stale closure bug.

## Proposed Solutions

### Option A: Add activeConvId to the dependency array
**Description:** Add `activeConvId` to the `useCallback` deps: `[messages, setMessages, router, notifyPlaybookSaved, activeConvId]`. This is the minimal, correct fix.
**Pros:** Single-line change. Follows the established hook pattern. ESLint's `exhaustive-deps` rule would have caught this if enabled.
**Cons:** None — this is straightforwardly the right fix.
**Effort:** Small
**Risk:** Low

### Option B: Use a ref for activeConvId
**Description:** Store `activeConvId` in a `useRef` and read `.current` inside the callback. The callback would never need to be recreated, and it would always read the latest value.
**Pros:** Avoids unnecessary callback recreation on every `activeConvId` change (minor perf optimization).
**Cons:** More code. Ref pattern is less obvious than deps. Marginal benefit since `handleSaveAsPlaybook` is only called on user gesture.
**Effort:** Small
**Risk:** Low

## Recommended Action
<!-- Leave blank for triage -->

## Technical Details
- **Affected files:** `src/hooks/use-action-handlers.ts`
- **Components:** Action handlers hook, playbook creation flow
- **Lines:** ~96-116
- **Related:** Enable `react-hooks/exhaustive-deps` ESLint rule to prevent this class of bug automatically

## Acceptance Criteria
- [ ] `activeConvId` is present in the `useCallback` dependency array for `handleSaveAsPlaybook`
- [ ] Saving a playbook after switching conversations associates it with the current (new) conversation, not the previous one
- [ ] No regression: saving a playbook without switching conversations still works correctly

## Work Log

### 2026-03-10
Added `activeConvId` to the `useCallback` dependency array for `handleSaveAsPlaybook` in `src/hooks/use-action-handlers.ts` (line 115). The callback called `buildPlaybookFromResearch(messages, userQuery, activeConvId ?? undefined)` but the dep array was `[messages, setMessages, router, notifyPlaybookSaved]`, omitting `activeConvId`. Changed to `[messages, setMessages, router, notifyPlaybookSaved, activeConvId]`. Single-line fix; no logic changes.

## Resources
- PR #33
