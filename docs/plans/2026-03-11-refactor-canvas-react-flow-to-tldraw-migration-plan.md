---
title: "Migrate Canvas from React Flow to tldraw v4"
type: refactor
status: active
date: 2026-03-11
---

# Migrate Canvas from React Flow to tldraw v4

## Overview

Replace `@xyflow/react` with `tldraw` v4.3+ as the canvas engine. The current React Flow implementation has fundamental UX issues: interactive content inside nodes fights with React Flow's event model (`stopPropagation` wars, broken multi-select, cards that can't be clicked). tldraw solves these natively with its edit-mode concept (double-click to interact with content, single-click to select/move).

## Problem Statement

React Flow is designed for static node graphs. Our canvas has rich interactive content inside nodes (table pagination/sorting, chart tooltips, SQL run buttons, text editing). Every interaction requires fighting React Flow's pointer event model:

- `stopPropagation` on `onClick` blocks node selection
- `nodrag` / `nopan` / `nowheel` CSS classes are insufficient
- Multi-select + group move requires custom hacks
- No built-in edit mode concept — we had to wire `isEditing` state manually with no exit mechanism

tldraw v4 provides all of these as first-class primitives.

## Prior Art

This project previously used tldraw v4.3.2 before migrating to React Flow. Extensive institutional knowledge exists:

- `docs/solutions/design-patterns/tldraw-custom-shapes-canvas-rendering.md` — full ShapeUtil pattern
- `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md` — interactive content model
- `docs/solutions/best-practices/canvas-dark-mode-centralized-theming-bypass-20260219.md` — theming in shapes

## Technical Approach

### Architecture

**Dual-store model:**
- **board-store.ts** — source of truth for card DATA (sql, chartSpec, data rows, markdownContent)
- **tldraw editor.store** — source of truth for GEOMETRY (position, size, z-index, rotation)

**Sync protocol (prevents infinite loops):**
```
tldraw mutation (user drags card)
  → store.listen({ source: 'user', scope: 'document' })
  → write position/size to board-store (no sync flag needed — board-store doesn't touch tldraw)

SSE stream / board-store mutation (data arrives)
  → saveBoardCard() updates in-memory Map + localStorage
  → editor.updateShape() to update tldraw shape props
  → tldraw re-renders component() with new props
  → store.listen fires but source='user' filter skips it (programmatic changes are not source='user')
```

This is the exact pattern documented in `docs/solutions/design-patterns/tldraw-custom-shapes-canvas-rendering.md`.

### What Stays Unchanged (zero changes)

| File | Purpose |
|------|---------|
| `src/lib/board-store.ts` | localStorage persistence |
| `src/lib/board-types.ts` | Type definitions |
| `src/lib/canvas-layout.ts` | DAG layout algorithms |
| `src/lib/canvas-sse-types.ts` | SSE event parsing |
| `src/lib/canvas-graph-utils.ts` | Graph validation |
| `src/lib/canvas-executor.ts` | Dataflow execution |
| `src/lib/canvas-events.ts` | Pub/sub event bridge |
| `src/lib/board-refresh-scheduler.ts` | Auto-refresh polling |
| `src/components/canvas/card-renderers/*` | All 10 card renderers |
| `src/components/canvas/drilldown-context.tsx` | Drill-down React context |
| `src/components/canvas/drilldown-popover.tsx` | Drill-down UI |
| `src/components/canvas/new-board-modal.tsx` | Board creation modal |
| `src/components/canvas/board-picker-popover.tsx` | Board selector |
| `src/components/canvas/canvas-config-panel.tsx` | Config sidebar (minor adapter) |
| All API routes | Server-side unchanged |

### What Gets Rewritten

| Current File | New File | Change |
|---|---|---|
| `canvas-flow.tsx` | `tldraw-canvas.tsx` | `<ReactFlow>` → `<Tldraw>` wrapper |
| `canvas-adapter.ts` | `tldraw-adapter.ts` | `cardToNode()` → `cardToShape()`, `connectionToEdge()` → arrow+bindings |
| `canvas-card-node.tsx` | `card-shape-util.ts` | React Flow NodeProps → tldraw ShapeUtil |
| `canvas-frame-node.tsx` | (removed) | Use tldraw's native frame shape |
| `dataflow-edge.tsx` | (removed) | Use tldraw's built-in arrow shape |
| `use-canvas-stream.ts` | `use-canvas-stream.ts` | Replace `useReactFlow()` with `useEditor()` |
| `canvas-page.tsx` | `canvas-page.tsx` | Replace `ReactFlowProvider` with tldraw setup |

### Implementation Phases

#### Phase 1: Foundation — CardShapeUtil + tldraw wrapper

**Goal:** Render existing cards as tldraw shapes with edit mode. No arrows yet. No SSE.

**Files to create/modify:**

1. **`src/components/canvas/shapes/card-shape-util.ts`** — Custom ShapeUtil

```typescript
// Module augmentation (required for tldraw v4)
declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    'board-card': {
      w: number
      h: number
      cardId: string    // links to board-store
      boardId: string
    }
  }
}

class CardShapeUtil extends ShapeUtil<BoardCardShape> {
  static override type = 'board-card' as const
  static override props = {
    w: T.number,
    h: T.number,
    cardId: T.string,
    boardId: T.string,
  }

  override canEdit() { return true }  // double-click enables interaction
  override canResize() { return true }

  override getDefaultProps() {
    return { w: 400, h: 260, cardId: '', boardId: '' }
  }

  override getGeometry(shape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override onResize(shape, info) {
    return resizeBox(shape, info)
  }

  // Renders card content — reads data from board-store, not tldraw props
  override component(shape) {
    const isEditing = this.editor.getEditingShapeId() === shape.id
    const card = getBoardCard(shape.props.boardId, shape.props.cardId)
    if (!card) return <HTMLContainer>Card not found</HTMLContainer>

    return (
      <HTMLContainer style={{ pointerEvents: isEditing ? 'all' : 'none' }}>
        <CardContent card={card} isEditing={isEditing} />
      </HTMLContainer>
    )
  }

  override indicator(shape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}
```

2. **`src/components/canvas/shapes/card-content.tsx`** — Wrapper that delegates to existing renderers

Uses the same switch statement from current `canvas-card-node.tsx` but passes `isEditing` from tldraw instead of local state. Wraps content with the three-zone pointer events model:
- Header zone: `pointerEvents: isEditing ? 'all' : 'none'`
- Content zone: `pointerEvents: isEditing ? 'all' : 'none'`
- Toolbar: `pointerEvents: 'all'` always (with `stopPropagation` on buttons)

3. **`src/components/canvas/tldraw-canvas.tsx`** — tldraw wrapper (replaces `canvas-flow.tsx`)

```typescript
// MUST be defined outside the component to prevent flicker
const customShapeUtils = [CardShapeUtil]
const customComponents = {
  StylePanel: null,
  MainMenu: null,
  PageMenu: null,
  HelpMenu: null,
  DebugPanel: null,
}

export function TldrawCanvas({ boardId }: { boardId: string }) {
  const handleMount = useCallback((editor: Editor) => {
    // Load cards from board-store → create tldraw shapes
    const cards = getBoardCards(boardId)
    editor.createShapes(cards.map(cardToShape))

    // Load connections → create arrows with bindings
    const connections = getBoardConnections(boardId)
    for (const conn of connections) {
      createArrowBetweenShapes(editor, conn)
    }

    // Sync tldraw geometry changes → board-store
    editor.store.listen((entry) => {
      syncTldrawToStore(entry, boardId)
    }, { source: 'user', scope: 'document' })

    // Camera persistence
    const savedCamera = loadCamera(boardId)
    if (savedCamera) editor.setCamera(savedCamera, { immediate: true })

    editor.store.listen(() => {
      saveCamera(boardId, editor.getCamera())
    }, { source: 'user', scope: 'session' })
  }, [boardId])

  return (
    <Tldraw
      shapeUtils={customShapeUtils}
      components={customComponents}
      onMount={handleMount}
    />
  )
}
```

4. **`src/components/canvas/tldraw-adapter.ts`** — replaces `canvas-adapter.ts`

```typescript
import { createShapeId, type TLShapeId } from 'tldraw'

export function cardToShape(card: BoardCard): TLShapePartial<BoardCardShape> {
  return {
    id: cardIdToShapeId(card.id),
    type: 'board-card',
    x: card.position.x,
    y: card.position.y,
    props: {
      w: card.size.width,
      h: card.size.height,
      cardId: card.id,
      boardId: card.boardId,
    },
  }
}

// Stable mapping: card UUID → tldraw ShapeId
const shapeIdCache = new Map<string, TLShapeId>()
export function cardIdToShapeId(cardId: string): TLShapeId {
  let id = shapeIdCache.get(cardId)
  if (!id) {
    id = createShapeId(cardId)
    shapeIdCache.set(cardId, id)
  }
  return id
}
```

**Acceptance criteria:**
- [ ] Cards render on canvas with correct positions/sizes from board-store
- [ ] Single-click selects card
- [ ] Double-click enters edit mode (table scrolls, buttons work)
- [ ] Click outside exits edit mode
- [ ] Multi-select with Shift+click
- [ ] Lasso select with drag
- [ ] Group drag moves all selected cards
- [ ] Resize handles work
- [ ] Delete key removes selected cards
- [ ] Camera persists across refreshes

#### Phase 2: Arrows + Store Sync

**Goal:** Directed arrows between cards with labels. Bidirectional sync between board-store and tldraw.

**Files to create/modify:**

1. **Arrow creation utility** in `tldraw-adapter.ts`:

```typescript
export function createConnectionArrow(
  editor: Editor,
  conn: CardConnection
) {
  const arrowId = createShapeId(conn.id)
  const startId = cardIdToShapeId(conn.fromCardId)
  const endId = cardIdToShapeId(conn.toCardId)

  editor.run(() => {
    editor.createShape({
      id: arrowId,
      type: 'arrow',
      props: {
        start: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
        richText: conn.label ? toRichText(conn.label) : undefined,
        arrowheadEnd: 'arrow',
        arrowheadStart: 'none',
      },
    })
    editor.createBindings([
      {
        fromId: arrowId,
        toId: startId,
        type: 'arrow',
        props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 1 }, isExact: false, isPrecise: false },
      },
      {
        fromId: arrowId,
        toId: endId,
        type: 'arrow',
        props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0 }, isExact: false, isPrecise: false },
      },
    ])
  })
}
```

2. **Store sync function** `syncTldrawToStore()`:

Listens to tldraw store changes, writes position/size updates to board-store for `board-card` type shapes only. Debounced (300ms).

**Acceptance criteria:**
- [ ] Arrows render between connected cards with correct labels
- [ ] Arrows follow cards when dragged
- [ ] Arrows removed when source/target card is deleted
- [ ] Position/size changes in tldraw persist to board-store → localStorage
- [ ] Connections persist across page refresh

#### Phase 3: SSE Streaming Integration

**Goal:** Replace `useReactFlow()` calls in `use-canvas-stream.ts` with tldraw `editor` API.

**Changes to `use-canvas-stream.ts`:**

```typescript
// Before (React Flow):
const { setNodes, setEdges } = useReactFlow()

// After (tldraw):
const editor = useEditor()
```

Replace all node/edge creation:
- `setNodes((prev) => [...prev, ...newNodes])` → `editor.createShapes(newShapes)`
- `setEdges((prev) => [...prev, ...newEdges])` → arrow creation via `createConnectionArrow()`
- `setNodes((prev) => prev.map(...))` for updates → `editor.updateShape({ id, props: { ... } })`

**Key change for data updates:** Since card data lives in board-store (not tldraw props), the `updateBoardCard` helper just calls `saveBoardCard()` and then forces a tldraw re-render by updating a version counter prop:

```typescript
function updateBoardCard(cardId, boardId, editor, updates) {
  const existing = getBoardCard(boardId, cardId)
  if (!existing) return
  const updated = { ...existing, ...cleanUpdates }
  saveBoardCard(updated, { sync: true })

  // Force tldraw to re-render the shape component
  const shapeId = cardIdToShapeId(cardId)
  const shape = editor.getShape(shapeId)
  if (shape) {
    editor.updateShape({
      id: shapeId,
      type: 'board-card',
      props: { ...shape.props }, // identity update triggers re-render
    })
  }
}
```

**Acceptance criteria:**
- [ ] User asks a question → placeholder cards appear on canvas
- [ ] Cards fill in with data as SSE events arrive (sql, table rows, chart specs, text)
- [ ] Arrows connect cards per the plan's `derivedFrom` graph
- [ ] Annotations (sticky notes) appear
- [ ] Stream abort works (cancel button, navigation away)
- [ ] `flushPendingPersists()` fires on stream completion

#### Phase 4: Canvas Page + Cleanup

**Goal:** Wire everything together in `canvas-page.tsx`, remove React Flow, clean up.

**Changes:**
1. Replace `<ReactFlowProvider>` + `<CanvasFlow>` with `<TldrawCanvas>`
2. Pass `editor` ref from `onMount` to child components that need it
3. Update `canvas-config-panel.tsx` to read selection from tldraw
4. Remove React Flow CSS import (`@xyflow/react/dist/style.css`)
5. Add tldraw CSS import (`tldraw/tldraw.css`)
6. Import tldraw CSS in a client component or layout

**Dependency changes:**
```bash
pnpm add tldraw@^4.3.2
pnpm remove @xyflow/react
```

**Files to delete:**
- `src/components/canvas/canvas-flow.tsx`
- `src/components/canvas/canvas-adapter.ts`
- `src/components/canvas/nodes/canvas-card-node.tsx`
- `src/components/canvas/nodes/canvas-frame-node.tsx`
- `src/components/canvas/edges/dataflow-edge.tsx`

**Legacy cleanup:**
- Delete `src/lib/canvas-store.ts` (deprecated)
- Delete `src/lib/canvas-types.ts` (deprecated)
- Update tldraw comment in `globals.css`

**Acceptance criteria:**
- [ ] Full end-to-end flow: ask question → cards + arrows appear → persist → refresh → still there
- [ ] Edit mode: double-click table → sort/paginate → click away → exits edit mode
- [ ] Multi-select + group drag
- [ ] Board switching preserves camera per board
- [ ] Auto-refresh scheduler works
- [ ] Drill-down from chart creates child cards with parent arrow
- [ ] No React Flow imports remain in codebase
- [ ] `pnpm build` succeeds
- [ ] `pnpm lint` passes

## System-Wide Impact

### Interaction Graph

1. User double-clicks canvas → `prompt-to-card-input` opens → user types query → `useCanvasStream.processStream()` → POST `/api/canvas-query` → NDJSON events → `editor.createShapes()` + `saveBoardCard()` → localStorage
2. Card renderer button click → `emitCanvasEvent()` → `canvas-page.tsx` handler → `executeCanvasDataflow()` → `/api/canvas-refresh` → `saveBoardCard()` → `editor.updateShape()`
3. User drags card → tldraw `store.listen({source: 'user'})` → `syncTldrawToStore()` → `saveBoardCard()` → localStorage
4. Auto-refresh timer → `board-refresh-scheduler` → `/api/canvas-refresh` → `saveBoardCard()` → `editor.updateShape()`

### Error Propagation

- SSE stream errors → caught in `use-canvas-stream.ts` `catch` block → `flushPendingPersists()` in `finally` → `onStatus({ phase: 'error' })`
- localStorage QuotaExceededError → `persistBoardCardsSync` catches → `purgeStaleBoards()` + `clearLegacyStorage()` → retry
- tldraw shape creation failure → `editor.run()` is atomic → rolls back on error

### State Lifecycle Risks

- **Partial SSE stream:** If stream aborts mid-flow, some cards exist without connections. Mitigation: `flushPendingPersists()` in `finally` block ensures whatever was created is persisted.
- **Board-store ↔ tldraw desync:** If `editor.updateShape()` fails silently, tldraw shows stale geometry while board-store has updated data. Mitigation: on board load, always create shapes from board-store (source of truth).

## Edge Cases

| Scenario | Handling |
|----------|----------|
| SSE stream + user navigates away | `AbortController.abort()` in useEffect cleanup |
| User in edit mode + SSE update for same card | Buffer update, show "Updated" badge, apply on edit exit |
| localStorage QuotaExceededError | Purge stale boards → clear legacy → trim to 10 rows → retry |
| Cards without queryGroupId (demo/manual) | Work normally — queryGroupId is optional |
| Arrow target deleted | tldraw auto-removes bindings when bound shape is deleted |
| Concurrent auto-refresh + SSE stream | Pause scheduler during active stream |

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| tldraw v4 API changes | Low | High | Pin to `^4.3.2`, test before upgrading |
| tldraw bundle size (~500KB) | Medium | Low | Already using dynamic import with `ssr: false` |
| tldraw license key for production | High | Medium | Free for localhost; evaluate license cost for production |
| Performance with 50+ shapes | Low | Medium | tldraw handles hundreds of shapes natively |

## Acceptance Criteria

### Functional
- [ ] All 10 card types render correctly in tldraw shapes
- [ ] Double-click enters edit mode; interactive content works (table sort/pagination, chart drill-down, SQL run)
- [ ] Click outside / Escape exits edit mode
- [ ] Single-click selects; Shift+click multi-selects; lasso selects
- [ ] Group drag moves all selected shapes
- [ ] Directed arrows with labels connect cards per DAG
- [ ] Arrows follow shapes on drag
- [ ] SSE streaming creates placeholder shapes, fills data, wires arrows
- [ ] All data persists across page refresh (cards, connections, viewport)
- [ ] Board switching works with per-board camera persistence
- [ ] Drill-down from chart creates child query flow
- [ ] Auto-refresh updates stale cards
- [ ] Delete key removes selected shapes + their arrows

### Non-Functional
- [ ] `pnpm build` succeeds with zero tsc errors
- [ ] `pnpm lint` passes
- [ ] No `@xyflow/react` imports remain
- [ ] Dynamic import with `ssr: false` for tldraw component
- [ ] Canvas loads in < 2s on refresh

## Sources & References

### Internal
- Prior tldraw implementation: `docs/solutions/design-patterns/tldraw-custom-shapes-canvas-rendering.md`
- Three-zone pointer events: `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`
- Dark mode theming: `docs/solutions/best-practices/canvas-dark-mode-centralized-theming-bypass-20260219.md`
- Original canvas plan: `docs/archived/plans/2026-02-17-feat-canvas-generative-ui-plan.md`

### External
- tldraw custom shapes: https://tldraw.dev/docs/shapes
- tldraw persistence: https://tldraw.dev/sdk-features/persistence
- tldraw arrow bindings: https://tldraw.dev/reference/tlschema/TLArrowBindingProps
- tldraw Editor API: https://tldraw.dev/reference/editor/Editor
- tldraw Next.js template: https://github.com/tldraw/nextjs-template
