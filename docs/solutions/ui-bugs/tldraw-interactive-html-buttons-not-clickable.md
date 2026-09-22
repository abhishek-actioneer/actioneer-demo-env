# tldraw: Interactive HTML Buttons Not Clickable Inside Shapes

## Problem

Buttons and interactive elements inside tldraw shape `component()` renders are unresponsive to clicks. Clicking a button briefly fires the pointer event but then the click is lost — or the shape deselects/moves instead of the button handler firing.

## Root Cause

tldraw's canvas event handler (`useCanvasEvents.onPointerDown`) has an early-return guard:

```js
if (editor.wasEventAlreadyHandled(e)) return;
```

This check uses **native event object identity** tracked in a Set:

```js
markEventAsHandled(e) {
  const nativeEvent = "nativeEvent" in e ? e.nativeEvent : e;
  this.handledEvents.add(nativeEvent);
}
```

React's `e.stopPropagation()` only stops propagation within React's synthetic event tree. It does **not** add the native event to tldraw's `handledEvents` Set. So even after calling `stopPropagation()`, tldraw's canvas handler still fires, dispatches `flushSync`, synchronously re-renders the shape (selection state changes), old DOM nodes get detached, and the subsequent `click` event is lost.

## Fix

Use `onPointerDownCapture` (not `onPointerDown`) with `editor.markEventAsHandled(e)`. The capture phase fires **before** tldraw's bubble-phase handler, ensuring the guard check sees the event as already handled.

```typescript
import { useEditor } from "tldraw";

function MyButton({ onClick }) {
  const editor = useEditor();

  return (
    <button
      onClick={onClick}
      onPointerDownCapture={(e) => {    // ← CAPTURE phase, not bubble
        e.stopPropagation();
        editor.markEventAsHandled(e);
      }}
    >
      Click me
    </button>
  );
}
```

Both calls are required:
- `stopPropagation()` — prevents React event propagation
- `markEventAsHandled(e)` — tells tldraw "I own this native event, don't process it"

## Why `onPointerDownCapture` Instead of `onPointerDown`

Using `onPointerDown` (bubble phase) does **not** work even with `markEventAsHandled`. The reason is event phase ordering:

```
1. NATIVE CAPTURE phase (top → down):
   window → document → body → #root (React fires onPointerDownCapture HERE)
   → tldraw wrappers → tl-canvas → ... → <button>

2. NATIVE BUBBLE phase (bottom → up):
   <button> → ... → tl-canvas  ← tldraw's onPointerDown runs HERE
   → ... → #root  ← React fires onPointerDown bubble here (too late!)
```

tldraw's canvas handler runs during the bubble phase at `tl-canvas`, which is between `<button>` and React root. By the time React's `onPointerDown` fires at `#root`, tldraw has already:
1. Checked `wasEventAlreadyHandled` (false at this point)
2. Called `setPointerCapture(e.currentTarget, e)` — routes ALL subsequent pointer events to the canvas

`setPointerCapture` is the mechanism that breaks `click`: the button never receives `pointerup`, so the browser never fires `click`, so `onClick` never runs.

`onPointerDownCapture` fires at `#root` during the **native capture phase** (step 1), which is always before any bubble handler. So `markEventAsHandled` is set before tldraw checks `wasEventAlreadyHandled` — causing tldraw to skip `dispatch()` and `setPointerCapture()` entirely.

## useEditor Availability

`useEditor()` works inside any component rendered within a tldraw shape's `component()` method. Shape content lives in tldraw's React context tree, so the hook is always available there.

## Files Changed

- `src/components/canvas/card-renderers/insight-renderer.tsx` — `FollowUpChip` component
- `src/components/canvas/card-renderers/shared.tsx` — `ToolbarBtn` component

## Also Required: Pointer Events Gate

Interactive zones also need `pointerEvents: "all"` when selected, plus the `nodrag` class to prevent tldraw from initiating drag on the element:

```tsx
<div
  className={isSelected || isEditing ? "nodrag" : undefined}
  style={{ pointerEvents: isSelected || isEditing ? "all" : "none" }}
>
  <MyButton />
</div>
```

All three pieces together (pointer events gate + stopPropagation + markEventAsHandled) are required for reliable interactive HTML inside tldraw shapes.
