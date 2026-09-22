---
status: pending
priority: p3
issue_id: "064"
tags: [code-review, simplification, use-action-handlers]
dependencies: []
---

# handleSavePlaybookPreview is a stub function wired through 3 abstraction layers for a single toast

## Problem Statement

`handleSavePlaybookPreview` in `use-action-handlers.ts` does nothing but call `toast.info("Playbook generation now opens in the canvas directly.")`. It accepts `_msgId` (intentionally unused, prefixed with `_`), wraps it in `useCallback`, exports it through `use-action-handlers.ts` → `ChatStateContextValue` interface (adds a field to the 30-field context) → `useMemo` deps array → every context consumer. A static toast does not need this level of abstraction.

## Findings

- `src/hooks/use-action-handlers.ts` lines 118-123: `handleSavePlaybookPreview` defined as `useCallback((_msgId: string) => { toast.info("Playbook generation now opens in the canvas directly."); }, [toast])`.
- Exported through `ChatStateContextValue` in `chat-state-provider.tsx` — adds one field to an already large 30-field context interface.
- Included in the `useMemo` value object and its deps array in the provider.
- Called at exactly one call site.

## Proposed Solutions

### Option A: Inline at the call site

Inline `toast.info("Playbook generation now opens in the canvas directly.")` at the single call site. Remove `handleSavePlaybookPreview` from `use-action-handlers.ts`, remove it from `ChatStateContextValue`, remove it from the `useMemo` value object and deps array.

## Recommended Action

Option A. There is no scenario where this toast message changes per-call or needs to be overridden by different consumers. Inlining removes 3 layers of indirection for a one-liner.

## Technical Details

- The `_msgId` prefix signals the parameter was already known to be unused at authorship — a sign this abstraction was never necessary.
- `useCallback` with a stable `[toast]` dep is not harmful in isolation, but contributing it to a 30-field context object has real cost: every consumer re-renders when the context shape is updated, and the field adds noise to the interface definition.

## Acceptance Criteria

- [ ] `handleSavePlaybookPreview` removed from `use-action-handlers.ts`.
- [ ] Field removed from `ChatStateContextValue` interface in `chat-state-provider.tsx`.
- [ ] Field removed from `useMemo` value object and deps array in the provider.
- [ ] Call site updated to inline `toast.info(...)` directly.
- [ ] No TypeScript errors. No lint errors.

## Work Log

## Resources

- `src/hooks/use-action-handlers.ts` lines 118-123
- `src/providers/chat-state-provider.tsx` (ChatStateContextValue interface + useMemo)
