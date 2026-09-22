---
title: Fix Lint Warnings Cleanup
type: fix
date: 2026-03-13
---

# Fix Lint Warnings Cleanup

## Overview

The repository currently has **63 lint warnings** (0 errors) across 33 source files. These fall into three categories:

1. **Unused variables / imports** — ~45 warnings. Dead symbols left from refactors or half-finished features.
2. **React Hooks dependency issues** — ~15 warnings. Missing or unnecessary entries in `useCallback`/`useMemo`/`useEffect` dependency arrays.
3. **Stale `eslint-disable` comments** — 3 warnings. Directives that no longer suppress any real violation.

All fixes are mechanical. No behavior changes.

---

## Approach

- **Unused vars**: Delete the symbol if it's truly dead (not referenced anywhere). Prefix with `_` only if it must stay in scope for destructuring/API surface reasons.
- **Hook deps (unnecessary)**: Remove the listed variable from the dependency array.
- **Hook deps (missing)**: Add the variable. For refs and stable setters this is safe — they never change identity.
- **Stale `eslint-disable`**: Delete the comment line.

---

## Files & Changes

### Group A — Unused variables / imports

#### `src/app/api/canvas-query/route.ts:10`
- Remove `validateGraphPlan` from imports (unused function import)

#### `src/app/playbooks/[id]/page.tsx`
- Line 10: Remove `ResizablePanel` from imports
- Line 401: Prefix `isRemoveAnnotation` → `_isRemoveAnnotation` (destructured from existing pattern, keep shape)

#### `src/components/canvas/canvas-page.tsx`
- Line 23: Remove `router` assignment (unused)
- Line 54: Remove `handleAddCard` assignment
- Line 59: Remove `handleConnect` assignment

#### `src/components/canvas/card-renderers/chart-renderer.tsx:5`
- Prefix destructured `height` param → `_height`

#### `src/components/canvas/tldraw-adapter.ts:8`
- Remove `BoardCardShape` from imports

#### `src/components/canvas/use-canvas-actions.ts`
- Line 14: Remove `addConnection` from destructuring
- Line 22: Remove `saveConversation` from imports
- Line 25: Remove `createConnectionArrow` from imports
- Line 26: Remove `ParentCardContext` from imports

#### `src/components/canvas/use-canvas-stream.ts:13`
- Remove `CanvasSSEEvent` from imports

#### `src/components/chart/report-chart.tsx`
- Line 26: Remove `ACCENT_MUTED` assignment
- Line 209: Remove `gridColor` assignment
- Line 505: Remove `renderCanvasSeries` assignment

#### `src/components/chat/autocomplete-dropdown.tsx:21`
- Prefix `prefix` param → `_prefix` (it's a function param in a callback signature, can't remove)

#### `src/components/chat/chat-input.tsx`
- Line 62: Remove `suggestedPrompts` from destructuring
- Line 63: Remove `schemaContext` from destructuring

#### `src/components/chat/chat-panel.tsx:194`
- Remove `buildBoardContextText` import/assignment

#### `src/components/chat/chat-thread.tsx`
- Line 64: Remove `onViewTask` from props destructuring
- Line 66: Remove `selectedSubagentId` from props destructuring
- Line 67: Remove `isTaskPanelOpen` from props destructuring
- Check and remove from the prop type interface too if not externally used

#### `src/components/chat/metric-context-card.tsx:154`
- Remove `formatYTick` assignment

#### `src/components/chat/report-minimap.tsx:22`
- Remove `MIN_WIDTH_FOR_MINIMAP` constant

#### `src/components/chat/research-timeline.tsx`
- Line 3: Remove `useEffect` and `useRef` from React imports
- Line 6: Remove `X` from icon imports
- Lines 517–520: Remove `completedQueries` and `totalQueries` assignments

#### `src/components/chat/segment-confirm-card.tsx:4`
- Remove `X` from icon imports

#### `src/components/playbook/playbook-canvas.tsx`
- Line 76: Prefix `isGenerating` param → `_isGenerating`
- Line 382: Remove `stepType` from destructuring
- Line 383: Remove `role` from destructuring
- Line 393: Remove `isEditMode` from destructuring
- Line 453: Remove `stepLevelAnnotations` assignment

#### `src/components/playbook/playbook-node-detail.tsx:64`
- Replace `const [expandedCellId, setExpandedCellId] = ...` with `const [, ] = ...` or remove entirely if the state is unused

#### `src/components/segments/segment-detail-panel.tsx` *(hooks section — see Group B)*

#### `src/components/sidebar.tsx`
- Line 19: Remove `LayoutDashboard` from imports
- Line 92: Remove `resolvedTheme` from destructuring

#### `src/components/ui/shimmering-text.tsx`
- Line 4: Remove `motion` from imports
- Line 39: Prefix `repeat` → `_repeat`
- Line 40: Prefix `repeatDelay` → `_repeatDelay`
- Line 58: Remove `shouldAnimate` assignment

#### `src/hooks/use-action-handlers.ts:1`
- Remove `useRef` from React imports

#### `src/hooks/use-analytics.ts:1`
- Remove `useEffect` from React imports

#### `src/lib/board-store.ts:224`
- Replace `const [board, ...rest]` destructuring → `const [, ...rest]` (or rename `board` → `_board`)

#### `src/lib/prompts/schema-generic.ts:116`
- Prefix `rowCount` param → `_rowCount`

---

### Group B — React Hooks dependency fixes

#### `src/app/segments/[id]/page.tsx:61`
- `useCallback` has unnecessary dep `datasetId` — remove from dep array

#### `src/app/segments/page.tsx:41`
- `useCallback` has unnecessary dep `datasetId` — remove from dep array

#### `src/components/board/document-view.tsx`
- Line 55: `useEffect` missing dep `liveSections` — add to dep array. Verify the effect should run when `liveSections` changes (it likely should).
- Line 134: `useCallback` has unnecessary dep `boardId` — remove from dep array

#### `src/components/canvas/card-comment-thread.tsx:336`
- `useCallback` missing dep `onAnnotations` — add to dep array. Since `onAnnotations` is a prop, the parent should wrap it in `useCallback` if needed to prevent churn; add it here.

#### `src/components/chat/chat-panel-provider.tsx:189`
- `useMemo` missing dep `setEntity` — add to dep array. `setEntity` is a state setter (stable reference), so adding it is safe.

#### `src/components/chat/chat-state-provider.tsx:294`
- `useMemo` missing deps: `agentMsgIdRef`, `messagesRef`, `setDeepResearch`, `setMessages` — add all four. Refs and state setters have stable identity, so this won't cause extra renders.

#### `src/components/chat/entity-catalog-provider.tsx`
- Lines 36 and 56: `useMemo` has unnecessary dep `catalogVersion` — **keep** this dep. `catalogVersion` is the version-counter pattern used to force catalog rebuilds. ESLint sees it as unused because the value isn't read inside the memo body, but removing it would break reactivity. Add `// eslint-disable-next-line react-hooks/exhaustive-deps` with a comment explaining the intentional pattern.

#### `src/components/playbook/playbook-canvas.tsx:224`
- `useMemo` has unnecessary dep `filledCellIds` — remove from dep array if it's not read inside the memo. Read the memo body first to confirm.

#### `src/components/segments/segment-detail-panel.tsx:127`
- `useCallback` has unnecessary dep `datasetId` — remove from dep array

#### `src/hooks/use-segment-creation.ts:82`
- `useCallback` has unnecessary dep `datasetId` — remove from dep array

---

### Group C — Stale `eslint-disable` comments

#### `src/app/playbooks/[id]/page.tsx:751`
- Delete the `// eslint-disable-next-line react-hooks/exhaustive-deps` line (no violation follows it after our hook reorder)

#### `src/components/canvas/use-canvas-stream.ts:134`
- Delete the `// eslint-disable-next-line no-constant-condition` line

#### `src/components/playbook/playbook-canvas.tsx:105`
- Delete the `// eslint-disable-next-line react-hooks/exhaustive-deps` line

---

## Acceptance Criteria

- [ ] `pnpm lint` exits with code 0 (no errors, no warnings)
- [ ] `pnpm build` still passes
- [ ] No behavior changes — all removals are dead code only
- [ ] `catalogVersion` deps in `entity-catalog-provider.tsx` are preserved with a clear explanatory comment

## Notes

- **`entity-catalog-provider.tsx` `catalogVersion` deps**: These are intentional. The version counter is the only mechanism that forces the catalog memo to rebuild after a mutation. ESLint can't see the indirect dependency, so we suppress with a comment explaining why.
- **`datasetId` in `useCallback` deps**: ESLint marks it unnecessary because `datasetId` is stable within the render (it's not changing between renders in these contexts). It's safe to remove.
- **`chat-state-provider.tsx:294` missing deps**: All four (`agentMsgIdRef`, `messagesRef`, `setDeepResearch`, `setMessages`) are refs or state setters — guaranteed stable. Adding them satisfies the linter without causing re-renders.
