---
title: "CanvasFlow Crashes Without ReactFlowProvider — Self-Contain the Provider"
date: 2026-03-11
problem_type: runtime_error
component: Canvas / React Flow
symptoms:
  - "React Flow context errors when rendering CanvasFlow on a new page"
  - "useReactFlow() called outside ReactFlowProvider"
  - "Canvas renders loading state but never shows nodes"
  - "Works on /canvas but crashes on /decks/[id]"
root_cause: "CanvasFlow used useReactFlow() internally but delegated ReactFlowProvider to the parent. New page consumers didn't know this requirement."
tags:
  - react-flow
  - canvas
  - provider
  - context
  - living-deck
related_files:
  - src/components/canvas/canvas-flow.tsx
  - src/components/deck/deck-canvas.tsx
---

# CanvasFlow Crashes Without ReactFlowProvider — Self-Contain the Provider

## Symptoms

`<CanvasFlow boardId={...} />` works on the main `/canvas` page but crashes on new pages (e.g., `/decks/[id]`) with React Flow context errors. The canvas renders a loading spinner but nodes never appear.

The root file had a comment: `// The parent must wrap this in <ReactFlowProvider>` — but new consumers don't see this comment and don't provide the wrapper.

## Root Cause

`CanvasFlow` called `useReactFlow()` internally (via `CanvasFlowInner`) but required its parent to supply `ReactFlowProvider`. This is an **implicit dependency** — it works fine on pages that happen to have a provider, but silently breaks on any new page that doesn't.

```typescript
// BEFORE — implicit requirement on parent
export function CanvasFlow(props: CanvasFlowProps) {
  // Comment says "parent must wrap in ReactFlowProvider" — but consumers don't see this
  return <CanvasFlowInner {...props} />;
}
```

When the deck canvas page added `<CanvasFlow boardId={boardId} />` without a provider wrapper, it crashed.

## Fix

Move `ReactFlowProvider` inside `CanvasFlow` so it's self-contained. Consumers don't need to know about the provider:

```typescript
// src/components/canvas/canvas-flow.tsx

import { ReactFlowProvider } from "@xyflow/react";

// AFTER — self-contained, no parent requirement
export function CanvasFlow(props: CanvasFlowProps) {
  return (
    <ReactFlowProvider>
      <CanvasFlowInner {...props} />
    </ReactFlowProvider>
  );
}
```

`CanvasFlowInner` (the actual implementation using `useReactFlow()`) remains unchanged. The provider is simply moved one level in.

## Prevention

**Rule:** Any component that uses a context hook (`useReactFlow`, `useEditor`, etc.) should be self-contained — either wrap itself in the provider or export a standalone variant.

**Pattern A (preferred): Self-contained wrapper**
```typescript
export function MyComponent(props: Props) {
  return (
    <RequiredProvider>
      <MyComponentInner {...props} />
    </RequiredProvider>
  );
}

function MyComponentInner(props: Props) {
  const ctx = useRequiredContext(); // ← safe, provider guaranteed above
}
```

**Pattern B: Explicit inner/outer split**
```typescript
/** Internal: requires RequiredProvider in parent tree */
export function MyComponentInner(props: Props) {
  const ctx = useRequiredContext();
}

/** Self-contained: provides its own context */
export function MyComponent(props: Props) {
  return <RequiredProvider><MyComponentInner {...props} /></RequiredProvider>;
}
```

**Code review signal:** If a component has `useReactFlow()` / `useEditor()` / any context hook, check that either:
1. The component wraps itself in the provider, OR
2. Every call site in the codebase is already inside a provider wrapper

**When adding a new page that uses `CanvasFlow`:** Just use `<CanvasFlow boardId={id} />` directly — no provider needed. The component handles it internally.

## Related

- `src/components/canvas/canvas-flow.tsx` — `CanvasFlow` (self-contained) and `CanvasFlowInner` (uses `useReactFlow`)
- `src/components/canvas/canvas-page.tsx` — The main canvas page; also uses `CanvasFlowInner` directly (already inside a provider from a different path)
- `src/components/deck/deck-canvas.tsx` — The deck canvas page; uses `<CanvasFlow>` (self-contained wrapper)
