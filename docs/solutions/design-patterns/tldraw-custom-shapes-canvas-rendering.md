---
title: "Canvas Phase 3: Infinite tldraw Canvas with Pinned Chart Rendering"
date: 2026-02-17
category: design-patterns
tags:
  - canvas
  - tldraw
  - chart-rendering
  - shape-utilities
  - state-sync
  - interactive-ui
component: canvas
status: resolved
problem_statement: |
  Implement an infinite canvas interface using tldraw v4.3.2 that allows users to pin
  and arrange interactive charts/reports as draggable, resizable shapes. The canvas
  needed to support persistent camera state, grid-based auto-placement for new pins,
  and bi-directional sync between tldraw shape mutations and the in-memory canvas store.
key_files:
  - src/components/canvas/chart-shape.tsx
  - src/components/canvas/canvas-page.tsx
  - src/app/canvas/page.tsx
  - src/lib/canvas-store.ts
  - src/lib/canvas-types.ts
---

# Canvas Phase 3: tldraw Infinite Canvas with Pinned Charts

## Overview

The `/canvas` route renders a tldraw infinite canvas where pinned charts and reports appear as interactive, draggable, resizable shapes. This replaces the Phase 1 placeholder grid with a full tldraw integration.

## Solution

### 1. Custom Shape Util (`chart-shape.tsx`)

Extends tldraw v4's `BaseBoxShapeUtil` to render chart/report cards as interactive shapes.

**Module augmentation (required in tldraw v4):**

```typescript
export const CHART_SHAPE_TYPE = "canvas-chart" as const;

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [CHART_SHAPE_TYPE]: {
      w: number;
      h: number;
      canvasItemId: string;  // links tldraw shape to external store
    };
  }
}
```

**Shape util class:**

- `type = "canvas-chart"` — registered shape type
- `canEdit()` / `canResize()` return `true`
- `component(shape)`:
  - **Charts**: wraps `<ReportChart spec={...} />` inside `HTMLContainer`
  - **Reports**: renders styled card with title, markdown preview (first 6 lines), pinned date
  - `pointerEvents: isEditing ? "all" : "none"` — gates interaction on edit mode
- `indicator(shape)`: rounded rectangle outline for selection
- Props validated via `RecordProps`: `w: T.number, h: T.number, canvasItemId: T.string`

**Key pattern**: `canvasItemId` prop links the lightweight tldraw shape to the external canvas store. Data lives in the store, not in tldraw's record system.

### 2. Canvas Page (`canvas-page.tsx`)

**Initialization on `onMount`:**

1. Load all items via `getAllCanvasItems()`
2. Convert to tldraw shape partials with `type`, position, and props
3. `editor.createShapes(shapes)`
4. Restore camera from localStorage with `{ immediate: true }`

**Store sync via `editor.store.listen`:**

```typescript
editor.store.listen(
  (entry) => {
    // Updated shapes (move/resize) → saveCanvasItem()
    // Removed shapes (delete) → removeCanvasItem()
  },
  { source: "user", scope: "document" }
);
```

Using `source: "user"` prevents feedback loops — programmatic `createShapes()` calls don't trigger the listener.

**Camera persistence** — separate listener on `{ source: "user", scope: "session" }` saves camera position to localStorage on every change.

**Grid auto-placement:**

```
GRID_COL_W = 480px, GRID_ROW_H = 370px, GRID_PAD = 30px
findOpenSlot(): scans 10x20 grid, returns first unused cell
```

**UI customization (defined outside component for stable references):**

```typescript
const tldrawOverrides: TLUiOverrides = {
  tools(_editor, tools) {
    const allowed = new Set(["select", "hand", "zoom"]);
    for (const key of Object.keys(tools)) {
      if (!allowed.has(key)) delete (tools as Record<string, unknown>)[key];
    }
    return tools;
  },
};

const tldrawComponents: TLComponents = {
  StylePanel: null, MainMenu: null, PageMenu: null,
  HelpMenu: null, DebugPanel: null, DebugMenu: null,
};
```

### 3. Route Entry (`src/app/canvas/page.tsx`)

Dynamic import with `ssr: false` — tldraw is client-only:

```typescript
const CanvasPage = dynamic(() => import("@/components/canvas/canvas-page"), {
  ssr: false,
  loading: () => <div>Loading canvas...</div>,
});
```

## Best Practices & Gotchas

1. **Module augmentation is required** in tldraw v4 for custom shapes — extend `TLGlobalShapePropsMap` at module level before creating shape utils.

2. **Avoid `as const` on variable references** — using `as const` on a variable that's already typed as a const string fails in TypeScript. Use the variable directly.

3. **Define stable config outside components** — `shapeUtils`, `overrides`, and `components` must be defined outside the React component body. Inline definitions cause re-registration on every render, leading to flickering.

4. **Use `source: "user"` in `store.listen`** — prevents feedback loops when syncing to external store. Without it, programmatic `createShapes()` calls trigger the listener too.

5. **Set `pointerEvents: "none"` on HTMLContainer when not editing** — critical for allowing tldraw's drag/select to work. Only set `"all"` when `this.editor.getEditingShapeId() === shape.id`.

6. **Stop propagation on interactive children** — buttons/inputs inside `HTMLContainer` need `e.stopPropagation()` to prevent tldraw from capturing clicks.

7. **Dynamic import with `ssr: false`** — tldraw cannot be server-rendered. Always wrap with `dynamic(() => import(...), { ssr: false })`.

8. **Camera restore needs `{ immediate: true }`** — skip animation on page load to prevent visual jank.

9. **Edit mode: use editor as source of truth** — check `this.editor.getEditingShapeId() === shape.id`, don't track edit state separately in React.

10. **BaseBoxShapeUtil for rectangular shapes** — provides automatic geometry, resize handles, and hit-testing. Only override if your shape deviates from a standard box.

11. **CSS import must be explicit** — `import 'tldraw/tldraw.css'` at module level in the canvas component.

12. **Dual store listeners** — one for `scope: "document"` (shape changes) and one for `scope: "session"` (camera). Both required for full persistence.

## Related Documentation

- **`docs/brainstorms/2026-02-17-canvas-generative-ui-brainstorm.md`** — Full vision and conceptual design for Canvas + Generative UI. Covers the core concept (pinning live charts, AI-initiated insights via SmartStack), architectural decisions (tldraw vs alternatives), and constraints.

- **`docs/plans/2026-02-17-feat-canvas-generative-ui-plan.md`** — Detailed 7-phase implementation plan. Includes data model (`CanvasItem` type), Phase 3 specifics, and acceptance criteria per phase.

- **`docs/solutions/design-patterns/split-panel-to-sidebar-three-tier-consolidation.md`** — Establishes the 3-tier sidebar pattern (icon rail -> hover panel -> landing page -> detail route) that Canvas follows. Includes "New Sidebar Feature Checklist".

- **`docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md`** — Documents the `SidebarContext` pattern (callback refs + version bumpers). Shows how `canvasVersion` counter triggers sidebar re-renders when canvas items change.

- **Memory: tldraw v4 notes** — Project memory file contains tldraw-specific patterns: module augmentation, `BaseBoxShapeUtil`, `HTMLContainer`, pointer events, edit mode, dynamic import.

- **`docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`** — Visual overhaul patterns: three-zone pointer events model, accent strip sibling nesting, selection-based toolbar, CSS custom properties for severity colors (not Tailwind arbitrary values), design token constants.
