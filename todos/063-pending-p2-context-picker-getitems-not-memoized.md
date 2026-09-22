---
status: pending
priority: p2
issue_id: "063"
tags: [code-review, performance, context-picker, react]
dependencies: []
---

# getItems() in ContextPicker not memoized — getAllConversations() sort runs on every keypress

## Problem Statement

In `src/components/chat/context-picker.tsx`, `getItems()` is called directly in the component body without `useMemo`. This means the function runs on every render. Inside `getItems`, the "Chats" category count calls `getAllConversations()`, which executes `Array.from(map.values()).sort(...)` — an O(n log n) sort that allocates a new array on every call. Because the context picker re-renders on every keystroke while the `@` mention picker is open, this sort fires on every character the user types.

## Findings

- `src/components/chat/context-picker.tsx` line ~62 — `const items = getItems(activeCategory, entityCatalog, filter)` called without `useMemo`.
- `getCategoryCount()` inside `getItems` calls `getAllConversations()` for the Chats category, which does `Array.from(map.values()).sort(...)`.
- The component re-renders on every keystroke (controlled `filter` input), so this sort runs on every keypress while the picker is open.
- The sort result is used only for its `.length`, making the O(n log n) sort doubly wasteful — a `Map.size` or an unsorted `Array.from(map.values()).length` would suffice for a count.

## Proposed Solutions

### Option A: Wrap getItems() call with useMemo

```typescript
const items = useMemo(
  () => getItems(activeCategory, entityCatalog, filter),
  [activeCategory, entityCatalog, filter]
);
```

This prevents recomputation when unrelated state causes the picker to re-render. `filter` still causes recomputation on every keypress, but the dependency is explicit and correct.

### Option B: Also fix getCategoryCount to use Map.size instead of sort for counts

In addition to the `useMemo` wrapper, change `getCategoryCount` for the Chats category to use `conversationStore.size` (or equivalent O(1) count access) rather than calling `getAllConversations()` which sorts. This eliminates the O(n log n) allocation entirely for the count path.

## Recommended Action

Apply both options — Option A for correctness (memoization on unrelated re-renders) and Option B for efficiency (eliminate the sort-for-count anti-pattern). Option A alone is the minimum acceptable fix.

## Technical Details

- Affected file: `src/components/chat/context-picker.tsx`.
- `getAllConversations()` is in `src/lib/conversation-store.ts` — check whether it has a `size` or `count` export that avoids the sort.
- The picker is triggered by typing `@` in the chat input, so this runs in a latency-sensitive path.
- On a user with 200 past conversations, the sort allocates a 200-element array on every keypress.

## Acceptance Criteria

- [ ] `getItems()` result is wrapped in `useMemo` with correct deps `[activeCategory, entityCatalog, filter]`.
- [ ] `getCategoryCount` for the Chats category does not call `getAllConversations().sort()` (or equivalent) — uses an O(1) count instead.
- [ ] Typing in the context picker does not trigger a full conversation sort on every keypress (verify with React DevTools Profiler).
- [ ] Context picker items still filter correctly as the user types.

## Work Log

## Resources

- `src/components/chat/context-picker.tsx`
- `src/lib/conversation-store.ts`
