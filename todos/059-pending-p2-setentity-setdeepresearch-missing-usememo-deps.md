---
status: pending
priority: p2
issue_id: "059"
tags: [code-review, react, hooks, chat-panel-provider, chat-state-provider]
dependencies: []
---

# setEntity missing from ChatPanelProvider useMemo deps; setDeepResearch missing from ChatStateProvider useMemo deps

## Problem Statement

Two `useMemo` dependency array omissions exist across provider files. In `chat-panel-provider.tsx`, `setEntity` is included in the memoized value object but is absent from the deps array. In `chat-state-provider.tsx`, `setDeepResearch` is included in the memoized value object but is absent from the deps array. Both are stable `useState` setters today so there is no current runtime bug, but the omissions will fail ESLint `exhaustive-deps` linting and become real stale closure bugs if the setters ever gain non-trivial identity (e.g., if they are replaced with `useReducer` dispatch or wrapped callbacks).

## Findings

- `src/components/chat/chat-panel-provider.tsx` line 137 — `value` useMemo includes `setEntity` in the returned object but the deps array does not list it.
- `src/components/chat/chat-state-provider.tsx` line ~287 — `value` useMemo includes `setDeepResearch` in the returned object but the deps array does not list it.
- Both omissions are detectable by ESLint `react-hooks/exhaustive-deps` rule.
- `useState` setters have stable identity across renders in React's current implementation, so there is no observable bug today. The risk is forward-looking.

## Proposed Solutions

### Option A: Add the missing setters to their respective useMemo dep arrays

In `chat-panel-provider.tsx`: add `setEntity` to the deps array of the `value` useMemo.

In `chat-state-provider.tsx`: add `setDeepResearch` to the deps array of the `value` useMemo.

Both setters are stable React `useState` setters, so adding them to the dep array will not cause additional re-renders. This satisfies `exhaustive-deps`, future-proofs the code, and makes the dep arrays honest.

## Recommended Action

Option A only. Simple, zero-risk change that closes a lint warning and prevents a latent bug.

## Technical Details

- `useState` setter stability is a React implementation detail, not a guaranteed API contract. The React docs recommend including all referenced values in deps.
- If these components are ever refactored to use `useReducer` or a wrapped callback, a missing dep would cause a stale closure bug that is hard to debug.
- Affected files: `src/components/chat/chat-panel-provider.tsx`, `src/components/chat/chat-state-provider.tsx`.

## Acceptance Criteria

- [ ] `setEntity` is listed in the `useMemo` deps array in `chat-panel-provider.tsx`.
- [ ] `setDeepResearch` is listed in the `useMemo` deps array in `chat-state-provider.tsx`.
- [ ] `pnpm lint` passes with zero `react-hooks/exhaustive-deps` warnings on both files.
- [ ] No additional re-renders are introduced (verify with React DevTools Profiler if needed).

## Work Log

## Resources

- `src/components/chat/chat-panel-provider.tsx`
- `src/components/chat/chat-state-provider.tsx`
- React docs: https://react.dev/reference/react/useMemo#every-time-my-component-renders-the-value-in-usememo-recalculates
