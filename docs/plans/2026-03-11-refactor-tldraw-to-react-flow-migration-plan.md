---
title: "Migrate Canvas from tldraw to React Flow"
type: refactor
status: active
date: 2026-03-11
---

# Migrate Canvas from tldraw to React Flow

## Overview

Replace the tldraw-based canvas (`src/components/canvas/`) with React Flow (`@xyflow/react` v12, already in package.json) to unlock first-class dataflow capabilities: typed handles, connection validation, and reactive data propagation between cards. The migration preserves all existing features (10 card renderers, board persistence, NL→SQL pipeline, connections, comments, presentation mode) while eliminating the module-level state hacks required by tldraw's architecture.

## Problem Statement / Motivation

The canvas is evolving from a freeform whiteboard toward a **dataflow workbench** where SQL cards feed Chart/Table cards, parameters propagate through connections, and execution order is derived from topology. tldraw was designed for drawing, not dataflow:

- **Shapes can't access React context** — forced module-level stores (`_comparisonDataStore`, `setCanvasQueryHandler`) and pub/sub bridges (`canvas-events.ts`)
- **No native connection system** — we built `ConnectionLayer` (SVG overlay), `emitConnectStart/End`, port divs with manual mouse handlers
- **Interactivity inside shapes requires hacks** — `pointerEvents: "none"` on containers, `stopPropagation()` on every interactive element, `ResponsiveContainer` height failures
- **No typed handles** — any card can connect to any card, no validation

React Flow solves all of these natively. Nodes are real React components, connections are edges with typed handles, and the API is designed for dataflow graphs.

## Proposed Solution

Replace tldraw with React Flow in a single branch. One generic `CanvasCardNode` component wraps all 10 existing card renderers. Connections become React Flow edges. The board store, API routes, and card renderers stay unchanged (with a minor props interface update).

### Architecture

```
ReactFlowProvider
  └─ ReactFlow
       ├─ nodeTypes: { card: CanvasCardNode, frame: CanvasFrameNode }
       ├─ edgeTypes: { dataflow: DataflowEdge }
       ├─ nodes ← loaded from board-store (BoardCard → Node)
       └─ edges ← loaded from board-store (CardConnection → Edge)

CanvasCardNode (generic wrapper)
  ├─ NodeResizer (resize handles)
  ├─ Handle (source/target ports, typed by card type)
  ├─ Auto-size observer (ResizeObserver on content, updates node dimensions)
  └─ CardRenderer (existing: chart, table, sql, text, metric, sticky, report, parameter, segment, insight)
       └─ Interactive elements wrapped with className="nodrag nowheel"
```

### Key Design Decisions

1. **One generic node type** — `CanvasCardNode` switches on `data.card.type` to render the correct card renderer. Keeps the node registry simple.

2. **Typed handles per card type:**
   | Card Type | Source Handle (output) | Target Handle (input) |
   |-----------|----------------------|----------------------|
   | sql | `data-output` | — |
   | parameter | `param-output` | — |
   | chart | — | `data-input` |
   | table | — | `data-input` |
   | text | — | `data-input` |
   | metric | — | `data-input` |
   | report | `data-output` | `data-input` |

3. **Connection validation** — `isValidConnection` callback checks handle types: only `*-output` → `*-input` allowed.

4. **No module-level state** — nodes access React context directly. Remove `setComparisonDataStore`, `setCanvasQueryHandler`, and the pub/sub bridge for shape→page communication.

5. **Board store unchanged** — `BoardCard` ↔ React Flow `Node` mapping is a thin adapter layer.

6. **`CardRendererProps` updated** — Remove `shape: ICanvasCardShape` prop. Replace with explicit `width: number` and `height: number`. The `isEditing` prop becomes a local state concept within the node wrapper.

7. **Auto-sizing via ResizeObserver** — `CanvasCardNode` wraps content in a `ResizeObserver`. When content overflows, it calls `setNodes()` to grow the node height (debounced). Replaces the tldraw `AutoSizeContent` → `editor.updateShape()` pattern.

8. **Interactive content via `nodrag`** — All interactive elements inside cards (buttons, inputs, scrollable containers) get `className="nodrag nowheel"`. This is the standard React Flow pattern, replacing `pointerEvents: "none"` + `stopPropagation()` hacks.

9. **Frames are visual-only** — Frames do NOT use `parentId` nesting. They render as separate nodes with `zIndex: -1`, same as current behavior. Dragging a frame does not move its children.

10. **Undo/redo deferred** — Removed from initial migration scope. Can be added later with a custom history stack. Ctrl+Z removed from acceptance criteria.

## Technical Considerations

### Data Model Mapping

```typescript
// BoardCard → React Flow Node
function cardToNode(card: BoardCard): Node {
  return {
    id: card.id,
    type: "card",
    position: { x: card.position.x, y: card.position.y },
    data: { card, boardId: card.boardId },
    style: { width: card.size.width, height: card.size.height },
  };
}

// CardConnection → React Flow Edge
function connectionToEdge(conn: CardConnection): Edge {
  return {
    id: conn.id,
    source: conn.fromCardId,
    target: conn.toCardId,
    type: "dataflow",
    label: conn.label,
  };
}

// Sync React Flow state back to board-store
function syncNodeToStore(node: Node) {
  const card = getBoardCard(node.data.boardId, node.id);
  if (!card) return;
  saveBoardCard({
    ...card,
    position: { x: node.position.x, y: node.position.y },
    size: { width: node.measured?.width ?? card.size.width, height: node.measured?.height ?? card.size.height },
  });
}
```

### CardRendererProps Update

```typescript
// BEFORE (tldraw-dependent)
interface CardRendererProps {
  item: BoardCard;
  shape: ICanvasCardShape;  // ← tldraw type
  isSelected: boolean;
  isEditing: boolean;
  comparisonData?: Record<string, unknown>[];
}

// AFTER (framework-agnostic)
interface CardRendererProps {
  item: BoardCard;
  width: number;
  height: number;
  isSelected: boolean;
  isEditing: boolean;
  comparisonData?: Record<string, unknown>[];
}
```

Only `chart-renderer.tsx` currently reads `shape.props.h` — update to use `height` prop instead.

### Auto-Sizing Strategy

For card types that grow with content (text, sticky, report, sql, table):

```typescript
// Inside CanvasCardNode
const AUTO_SIZE_TYPES = new Set(["text", "sticky", "report", "follow-up", "sql", "table"]);
const contentRef = useRef<HTMLDivElement>(null);
const { setNodes } = useReactFlow();

useEffect(() => {
  if (!AUTO_SIZE_TYPES.has(cardType)) return;
  const el = contentRef.current;
  if (!el) return;
  const ro = new ResizeObserver(debounce((entries) => {
    const scrollH = entries[0].contentRect.height;
    const needed = Math.max(scrollH + 4, 80);
    if (needed > currentHeight + 8) {
      setNodes(nodes => nodes.map(n =>
        n.id === nodeId ? { ...n, style: { ...n.style, height: needed } } : n
      ));
    }
  }, 100));
  ro.observe(el);
  return () => ro.disconnect();
}, [cardType]);
```

### Coordinate Conversions

| tldraw API | React Flow Equivalent | Used In |
|---|---|---|
| `editor.screenToPage(point)` | `screenToFlowPosition(point)` | card placement, double-click |
| `editor.pageToScreen(point)` | `flowToScreenPosition(point)` | toolbar positioning |
| `editor.getViewportScreenBounds()` | `getViewport()` | toolbar centering |
| `editor.getViewportScreenCenter()` | derive from viewport + container | prompt-to-card anchor |
| `editor.zoomToBounds(bounds)` | `fitBounds(bounds, { duration: 400 })` | presentation slides |
| `editor.getCamera()` / `setCamera()` | `getViewport()` / `setViewport()` | camera persistence |
| `editor.animateShape()` | CSS transition on node position | collision resolution |

### Camera Persistence

Current format (tldraw): `{ x, y, z }` stored in `baby-sentinel-canvas-camera-${boardId}`
New format (React Flow): `{ x, y, zoom }` via `getViewport()` / `setViewport()`

Migration: on load, detect old format (`z` field present), map `z → zoom`, save new format. Lazy per-board migration.

### What Gets Deleted

- `chart-shape.tsx` — tldraw shape util, module augmentation, `_comparisonDataStore`
- `frame-shape.tsx` — tldraw frame shape util
- `connection-layer.tsx` — custom SVG arrow renderer (React Flow edges replace this)
- `canvas-store.ts` — already deprecated
- `smart-stack.tsx` — imports from deprecated `canvas-store.ts`, migrate to board-store or remove
- tldraw imports/setup in `canvas-page.tsx` (~1,600 lines of tldraw integration)
- `canvas-events.ts` — `emitConnectStart/End` removed (keep `onCanvasEvent` for non-connection events like "run-sql", "open-comments")

### What Stays Unchanged

- All 10 card renderers (`src/components/canvas/card-renderers/*`) — minor props update only
- `board-store.ts`, `board-types.ts` — data layer
- `canvas-executor.ts` — DAG dataflow execution (reads from board-store, not React Flow state)
- `canvas-layout.ts` — collision detection, packing
- `canvas-suggestions.ts`, `board-refresh-scheduler.ts` — business logic
- All 8 `/api/canvas-*` routes — fully backend
- `card-comment-thread.tsx`, `canvas-config-panel.tsx`, `new-board-modal.tsx`, `pin-button.tsx`, `board-picker-popover.tsx` — framework-agnostic UI

### Files That Need `useEditor()` → `useReactFlow()` Migration

| File | tldraw APIs Used | Migration |
|---|---|---|
| `canvas-page.tsx` | Everything | Full rewrite of tldraw integration |
| `collective-toolbar.tsx` | `getSelectedShapeIds`, `getShape`, `createShape`, `deleteShapes`, `sendToBack`, `pageToScreen` | Replace with `useReactFlow()` + `useNodes()` |
| `add-card-toolbar.tsx` | `getViewportScreenBounds`, `screenToPage` | Replace with `useReactFlow()` |
| `presentation-controls.tsx` | `zoomToBounds` | Replace with `fitBounds()` |
| `present-button.tsx` | `createShape` (on new board, then navigates) | Replace with `setNodes()` or direct board-store |
| `compare-to-picker.tsx` | `useEditor()` (no actual usage) | Remove import entirely |

### Dataflow Execution

The `onConnect` handler must:
1. Save connection to board-store via `addConnection()`
2. Call `executeCanvasDataflow()` which reads from board-store directly
3. Update React Flow nodes with new data from executor results

This ensures the executor always works with board-store data, not React Flow state.

### Performance

React Flow handles 50+ nodes well with selective re-rendering via `memo()`. For large boards, batch node updates and use `useNodesInitialized()`.

## System-Wide Impact

- **Provider tree** — `ReactFlowProvider` wraps the canvas page only (not global). No changes to `layout-shell.tsx`.
- **Chat-to-canvas bridge** — `setCanvasQueryHandler` replaced by React context method. Chat panel calls context method → canvas page handles it. Fallback when not on canvas: context method returns false (same as current `sendCanvasQuery()` pattern).
- **Sidebar** — Board picker, navigation unchanged. `activeBoardId` from `SidebarContext` works as-is.
- **Package changes** — Remove `tldraw` dependency, keep `@xyflow/react`. Remove `tldraw/tldraw.css` import.

## Acceptance Criteria

### Functional Requirements

- [ ] All 10 card types render correctly in React Flow nodes
- [ ] Cards are draggable, resizable (NodeResizer), and selectable
- [ ] Interactive content inside cards works: table pagination/sort, SQL run button, text editing, parameter dropdowns
- [ ] Connections (edges) render between cards with labels
- [ ] Connection creation via drag from source handle to target handle
- [ ] Connection validation: only valid handle type pairs connect
- [ ] NL→SQL pipeline from chat panel creates cards on canvas (SQL, table, chart, text)
- [ ] NL→SQL pipeline from double-click creates cards on canvas
- [ ] Cards persist to localStorage via board-store (position, size, data)
- [ ] Camera/viewport persists per board
- [ ] Keyboard shortcuts: Delete (remove selected), Ctrl+A (select all)
- [ ] Frames/groups: visual grouping with collapsible frames
- [ ] Comments work on cards
- [ ] Presentation mode works (fitBounds per slide)
- [ ] Board templates (dashboard, investigation, presentation, blank) work
- [ ] Auto-refresh scheduler works
- [ ] Dataflow execution: upstream changes propagate to downstream cards
- [ ] Multi-select toolbar (arrange, delete, edit) works
- [ ] Auto-sizing works for text/sticky/report/sql/table cards

### Non-Functional Requirements

- [ ] No tldraw imports remain in codebase
- [ ] No module-level state hacks for shape↔context bridging
- [ ] `pnpm build` passes (ignoring pre-existing busboy error)
- [ ] No TypeScript errors in canvas files

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| React Flow NodeResizer doesn't match tldraw resize UX | NodeResizer is well-documented, test early in Phase 1 |
| Frames without `parentId` need manual z-ordering | Use `zIndex: -1` on frame nodes |
| Presentation mode relied on `zoomToBounds` | Use `fitBounds(bounds, { duration: 400 })` |
| Collision resolution needs animation | Apply CSS `transition: transform 200ms` on node wrapper |
| Auto-sizing may cause render loops | Debounce ResizeObserver, only grow (never shrink), guard with 8px threshold |
| `SmartStack` depends on deprecated `canvas-store.ts` | Delete SmartStack or migrate imports to board-store |
| Chat-to-canvas context may not be ready on mount | Context method returns false when no canvas, same as current pattern |
| Drag handler captures clicks on interactive elements | Use `className="nodrag nowheel"` on all interactive containers |
| `onNodesChange` fires for both user and programmatic changes | Debounce store persistence, skip saves during batch operations |

## Implementation Phases

### Phase 1: Foundation (Day 1-2)

**Goal:** React Flow renders all cards, basic drag/resize/persist works.

Files to create:
- `src/components/canvas/canvas-flow.tsx` — React Flow setup, node/edge types, event handlers
- `src/components/canvas/nodes/canvas-card-node.tsx` — generic card node (NodeResizer + Handles + auto-size + nodrag wrappers)
- `src/components/canvas/nodes/canvas-frame-node.tsx` — frame/group node (zIndex: -1, collapse toggle)
- `src/components/canvas/edges/dataflow-edge.tsx` — custom edge with label
- `src/components/canvas/canvas-adapter.ts` — BoardCard↔Node, CardConnection↔Edge converters

Files to modify:
- `canvas-page.tsx` — replace `<Tldraw>` with `<CanvasFlow>`, keep all business logic handlers
- `card-renderers/types.ts` — replace `shape: ICanvasCardShape` with `width: number, height: number`
- `card-renderers/chart-renderer.tsx` — `shape.props.h` → `height` prop
- `card-renderers/shared.tsx` — remove `pointerEvents: "none"` hacks, add `nodrag` classes to interactive elements

Files to delete:
- `chart-shape.tsx` (tldraw shape util)
- `frame-shape.tsx` (tldraw frame util)

Key tasks:
- [ ] Update `CardRendererProps` interface (remove `shape`, add `width`/`height`)
- [ ] Update `chart-renderer.tsx` to use `height` prop instead of `shape.props.h`
- [ ] Create `CanvasCardNode` with NodeResizer + Handle ports + auto-size ResizeObserver
- [ ] Create adapter functions (`cardToNode`, `connectionToEdge`, `syncNodeToStore`)
- [ ] Create `CanvasFlow` component wrapping `<ReactFlow>` with `<Background variant="dots">`
- [ ] Replace `<Tldraw>` mount in `canvas-page.tsx` with `<CanvasFlow>`
- [ ] Load nodes/edges from board-store on mount
- [ ] Persist position/size changes via `onNodesChange` (debounced)
- [ ] Camera persistence with `onMoveEnd` / `setViewport` (with old format migration)
- [ ] Add `className="nodrag nowheel"` to interactive elements in card renderers

### Phase 2: Connections & Dataflow (Day 3)

**Goal:** Connections work natively, dataflow executes, card interactivity verified.

Files to modify:
- `canvas-card-node.tsx` — typed source/target handles per card type
- `canvas-flow.tsx` — `onConnect`, `isValidConnection`, `onEdgesChange`
- `canvas-page.tsx` — wire `executeCanvasDataflow()` to connection events

Files to delete:
- `connection-layer.tsx`

Key tasks:
- [ ] Add typed handles to CanvasCardNode (source for sql/parameter, target for chart/table/text/metric)
- [ ] Implement `isValidConnection` (output → input only)
- [ ] `onConnect` → `addConnection()` to board-store → `executeCanvasDataflow()`
- [ ] Edge deletion → `removeConnection()`
- [ ] Remove `ConnectionLayer`, remove `emitConnectStart/End` from `canvas-events.ts`
- [ ] Verify interactive content: table sort/pagination, SQL run, text editing, parameter inputs

### Phase 3: Canvas Features (Day 4-5)

**Goal:** All canvas features work — prompt-to-card, toolbars, frames, presentation.

Files to modify:
- `canvas-page.tsx` — prompt-to-card flows, query handler context, keyboard shortcuts
- `add-card-toolbar.tsx` — `useEditor()` → `useReactFlow()` + `screenToFlowPosition()`
- `collective-toolbar.tsx` — `useEditor()` → `useReactFlow()` + `useNodes()` for selection
- `presentation-controls.tsx` — `zoomToBounds()` → `fitBounds()`
- `present-button.tsx` — remove `useEditor()`, use board-store directly
- `compare-to-picker.tsx` — remove unused `useEditor()` import
- `canvas-events.ts` — simplify (remove connection events, keep run-sql/open-comments)

Key tasks:
- [ ] Chat-to-canvas pipeline: replace `setCanvasQueryHandler` with React context
- [ ] Double-click prompt-to-card: `onPaneClick` double-click detection → show `PromptToCardInput`
- [ ] Keyboard shortcuts: `onKeyDown` handler (Delete, Ctrl+A)
- [ ] Migrate `add-card-toolbar.tsx` (viewport → card placement math)
- [ ] Migrate `collective-toolbar.tsx` (selection, create, delete, group, centroid positioning)
- [ ] Migrate `presentation-controls.tsx` (`fitBounds` per slide)
- [ ] Fix `present-button.tsx` and `compare-to-picker.tsx`
- [ ] Frame nodes: zIndex management, collapse toggle
- [ ] Investigation board scaffold: convert `editor.createShape()` calls to `setNodes()`

### Phase 4: Cleanup & Polish (Day 6-7)

Key tasks:
- [ ] Remove `tldraw` from package.json, run `pnpm install`
- [ ] Delete: `canvas-store.ts`, `smart-stack.tsx` (or migrate), `connection-layer.tsx`
- [ ] Remove all module-level state: `_comparisonDataStore`, `setCanvasQueryHandler`
- [ ] Clean `canvas-events.ts` (keep only `onCanvasEvent`/`emitCanvasEvent`)
- [ ] Migrate camera localStorage keys (lazy format conversion)
- [ ] Collision resolution: `onNodeDragStop` + `resolveCollision()` + CSS transition
- [ ] Snap-to-preset on resize end via `NodeResizer` `onResizeEnd` callback
- [ ] Test all 14 user flows (see flow inventory below)
- [ ] Verify `pnpm build` passes
- [ ] Update CLAUDE.md canvas section

## User Flow Test Inventory

| # | Flow | What to Test |
|---|------|-------------|
| 1 | Board init | Navigate to `/canvas`, cards load, camera restores |
| 2 | Prompt via double-click | Double-click → input → SQL/table/chart/text cards appear |
| 3 | Prompt via chat panel | Type in chat → cards appear on canvas with status updates |
| 4 | Prompt via "+" toolbar | Click "+" → Query → input → cards appear |
| 5 | Manual card add | "+" → Sticky/Text/Parameter → card at viewport center |
| 6 | Connection create | Drag from SQL output handle to chart input handle |
| 7 | Connection delete | Click edge → delete |
| 8 | Drag/resize persist | Move card, resize card → reload → position/size preserved |
| 9 | Frame create | Multi-select → Group → frame appears behind cards |
| 10 | Frame collapse | Click chevron → frame collapses to title bar |
| 11 | Presentation mode | Create presentation → navigate slides with arrows |
| 12 | Multi-select toolbar | Select 2+ cards → Summarize, Compare, Group, Delete |
| 13 | Card comments | Click comment icon → type comment → persists |
| 14 | Investigation scaffold | New board → Investigation template → hypothesis/evidence cards |

## Sources & References

- React Flow docs: https://reactflow.dev/learn
- `@xyflow/react` v12 (already in package.json at `^12.10.0`)
- Current tldraw setup: `src/components/canvas/chart-shape.tsx`, `canvas-page.tsx`
- Board data model: `src/lib/board-types.ts`
- Card renderers: `src/components/canvas/card-renderers/`
- Dataflow executor: `src/lib/canvas-executor.ts`
- API routes: `src/app/api/canvas-*/route.ts` (8 endpoints, all framework-agnostic)
