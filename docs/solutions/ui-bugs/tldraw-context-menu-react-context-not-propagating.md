# tldraw Context Menu — React Context Not Propagating Through Component Overrides

## Problem

Custom `ContextMenu` component override in tldraw v4 receives the React context **default value**
instead of the provider value, causing conditional rendering to always fail.

The observable symptom: a context menu item guarded by `if (contextValue)` never appears, even
though the parent component provides the value via `<MyContext.Provider value={...}>`.

## Root Cause

React context propagation through tldraw's internal rendering (Radix portals + tldraw's own
component resolution system) is unreliable. The component override is stored by reference and
may be invoked outside the original React tree's context scope. While React context *should*
technically propagate through portals, the path is fragile when tldraw's internals resolve the
component in isolation or across its own provider boundaries.

Secondary issue: `editor.getSelectedShapes()` returns empty when the user right-clicks without
first left-clicking to select. tldraw does **not** auto-select shapes on right-click (only on
left-click). Relying solely on `getSelectedShapes()` misses direct right-clicks entirely.

## Fix Pattern

**Replace React context with a module-level Map** keyed by a stable identifier (e.g. `boardId`):

```typescript
// Module level — immune to portal/tree propagation issues
const followUpRegistry = new Map<string, (cardId: string) => void>();
```

Populate in the parent component via `useEffect`:

```typescript
useEffect(() => {
  if (onAskFollowUp) followUpRegistry.set(boardId, onAskFollowUp);
  return () => { followUpRegistry.delete(boardId); };
}, [boardId, onAskFollowUp]);
```

Read in the tldraw component override directly from the module-level Map:

```typescript
function CustomContextMenu() {
  const editor = useEditor();
  // boardId is read from shape.props — no external context needed
  const callback = followUpRegistry.get(shapeProps.boardId);
  ...
}
```

**Bonus: use `getShapesAtPoint` as fallback** alongside `getSelectedShapes` to handle direct
right-clicks (where no shape is pre-selected):

```typescript
// Attempt 1: pre-selected shape
for (const shape of editor.getSelectedShapes()) { ... }

// Attempt 2: shape directly under the pointer
if (!targetCard) {
  const shapes = editor.getShapesAtPoint(editor.inputs.currentPagePoint);
  for (const shape of shapes) { ... }
}
```

## Also Note

`TLUiOverrides` in tldraw v4 does **not** have a `contextMenu` method. The only override surface
is the `components` prop — `{ ContextMenu: CustomContextMenu }`. Component objects must be
**static** (defined outside the component function) to prevent tldraw from re-registering on
every render, which causes flickering.

## Files Changed

- `src/components/canvas/tldraw-canvas.tsx` — replaced `FollowUpContext` + `useContext` with
  `followUpRegistry` Map; added `getShapesAtPoint` fallback; made component objects fully static.
