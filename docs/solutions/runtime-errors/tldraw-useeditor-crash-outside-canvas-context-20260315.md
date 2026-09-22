---
title: tldraw useEditor hook crash when card renderer used outside tldraw context
problem_type: runtime-error
component: src/components/canvas/card-renderers/chart-renderer.tsx
symptom: "useEditor must be used inside of the <Tldraw /> or <TldrawEditor /> components"
tags: [tldraw, react-hooks, canvas, context, card-renderer]
date: 2026-03-15
severity: high
---

# tldraw `useEditor` crash when card renderer used outside tldraw context

## Problem

`ChartRenderer` contains a `TabButton` component that called `useInteractiveTldrawButton()`, which internally calls tldraw's `useEditor()` hook. While this worked correctly when `ChartRenderer` was rendered inside the tldraw canvas (`src/components/canvas/shapes/card-content.tsx`), it crashed when the same component was rendered in the document/board view (`src/components/board/card-renderer.tsx`), which has no tldraw provider in its tree.

**Key fact about this codebase:** Card renderers (`ChartRenderer`, `TableRenderer`, etc.) are used in two places:
1. `src/components/canvas/shapes/card-content.tsx` — inside tldraw canvas (tldraw context present ✓)
2. `src/components/board/card-renderer.tsx` — in document/board view (no tldraw context ✗)

Any hook that calls `useEditor()` will crash when the component renders in context #2.

## Root Cause

`useInteractiveTldrawButton()` calls `useEditor()` unconditionally at the top of the hook. React's rules of hooks forbid conditional hook calls, so there is no safe way to guard against the missing tldraw context. Because `ChartRenderer` is a shared renderer used in both contexts, using any tldraw hook inside it — or any component it creates — causes a crash in the document view.

## Solution

**Before (broken):**
```tsx
function TabButton({ label, active, onSelect }) {
  const handlePointerDown = useInteractiveTldrawButton(); // ← calls useEditor() → crashes outside tldraw
  return (
    <button
      onPointerDownCapture={handlePointerDown}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}
```

**After (correct):**
```tsx
function TabButton({ label, active, onSelect }) {
  return (
    <button
      // stopPropagation in capture phase prevents tldraw's bubble-phase handler
      // from calling setPointerCapture (which would steal pointerup/click).
      // Works correctly both inside tldraw canvas and in document view.
      onPointerDownCapture={(e) => e.stopPropagation()}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}
```

## Why the fix works

`useInteractiveTldrawButton` returns a handler that calls both `e.stopPropagation()` and `editor.markEventAsHandled(e)`. The `markEventAsHandled` tells tldraw not to call `setPointerCapture`, which would otherwise steal the `pointerup`/`click` events (see the related doc below). By firing `stopPropagation()` in the **capture phase** instead, the event never reaches tldraw's bubble-phase canvas handler, so `setPointerCapture` is never called. The end result is identical interactive behavior inside tldraw canvas, and because no tldraw context is accessed, the component renders safely in document view too.

**In short:** `onPointerDownCapture={(e) => e.stopPropagation()}` is the context-free primitive that achieves the same effect as `useInteractiveTldrawButton` for simple interactive buttons.

## Prevention

- **Treat card renderers as context-free.** Any renderer appearing in both `card-content.tsx` and `card-renderer.tsx` must contain zero tldraw hook calls. Treat it as if tldraw does not exist.

- **Name tldraw-specific hooks explicitly.** `useInteractiveTldrawButton` already signals its tldraw dependency in its name — follow this convention. A hook named `useTldrawX` or `useXTldraw` signals: "requires tldraw provider; do not use outside canvas shapes."

- **Use the DOM-native primitive first.** `onPointerDownCapture={(e) => e.stopPropagation()}` is a plain React DOM handler that works everywhere. Only escalate to a tldraw hook if the DOM primitive is genuinely insufficient, and only in `BaseBoxShapeUtil.component()` subtrees that are never rendered outside tldraw.

- **Injectable tldraw behavior pattern.** If tldraw-specific behavior is truly needed in a shared renderer, accept it as a prop (`onInteract?: () => void`) and provide the tldraw-specific implementation from the shape layer — keeps the renderer itself context-agnostic.

## Checklist when adding interactive elements to card renderers

- [ ] Does the new component call any hook that imports from `"tldraw"`? Search for `useEditor()` in the hook's file. If yes: cannot be used in a shared renderer.
- [ ] Is the interactive behavior achievable with `onPointerDownCapture` / `onClick` / `stopPropagation`? If yes: use that.
- [ ] Where is this renderer mounted? If it appears anywhere outside a `BaseBoxShapeUtil.component()` subtree (modals, document view, reports), it is shared and must be context-free.

## Related

- `docs/solutions/ui-bugs/tldraw-interactive-html-buttons-not-clickable.md` — original fix using `useInteractiveTldrawButton` (works when exclusively inside tldraw shapes)
- `docs/solutions/runtime-errors/reactflow-provider-missing-canvasflow-context.md` — same class of bug with React Flow's `useReactFlow()` hook
- `docs/solutions/design-patterns/tldraw-custom-shapes-canvas-rendering.md` — canonical tldraw v4 shape patterns
- `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md` — pointer-events model for canvas cards
