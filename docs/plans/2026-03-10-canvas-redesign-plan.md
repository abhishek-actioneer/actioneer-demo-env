# Canvas Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the canvas from a static pinboard into a multi-board analytical workspace with live data, card conversations, visual dataflow workflows, structured investigations, and presentation boards.

**Architecture:** Multi-board system backed by localStorage Maps (one per board). Each board is a tldraw instance with custom shape utils per card type. Workflow connections use ReactFlow-style ports on tldraw shapes. LLM integration via existing Gemini pipeline for prompt-to-card, card conversations, and investigation scaffolding.

**Tech Stack:** tldraw 4.3.2, @xyflow/react (connection ports), @google/genai (Gemini), DuckDB (live SQL refresh), Recharts (charts), React 19, Next.js 16, localStorage persistence.

**Design Doc:** `docs/plans/2026-03-10-canvas-redesign-prd.md`

---

## Phasing Strategy

This is broken into 6 phases. Each phase ships independently and adds value on its own. Do NOT start a later phase before the current one is complete and tested.

| Phase | What | Depends On |
|-------|------|------------|
| **1** | Multi-board foundation + new card types | Nothing |
| **2** | Five entry points (pin everything, prompt-to-card, drag, manual add, suggestions) | Phase 1 |
| **3** | Liveness (real refresh, reactive sync, Compare To) | Phase 1 |
| **4** | Card conversations + LLM annotations | Phase 1 |
| **5** | Workflow builder (connections, dataflow, parameters) | Phase 1, 3 |
| **6** | Investigation boards + Presentation boards | Phase 1, 4 |

---

## Phase 1: Multi-Board Foundation + New Card Types

**Goal:** Replace the single-canvas system with a multi-board system. Add new card types. Update sidebar to show boards list.

---

### Task 1.1: Board Store

**Files:**
- Create: `src/lib/board-store.ts`
- Create: `src/lib/board-types.ts`
- Modify: `src/lib/canvas-store.ts` (deprecate, re-export from board-store for backward compat)

**Step 1: Define board types**

Create `src/lib/board-types.ts`:

```typescript
import type { ChartSpec } from "./chart-types";

export interface Board {
  id: string;
  name: string;
  description?: string;
  datasetId: string;
  template?: "dashboard" | "investigation" | "presentation" | "blank";
  sourceInvestigationBoardId?: string;
  createdAt: string;
  updatedAt: string;
}

export type CardType =
  | "chart" | "table" | "metric" | "sql" | "text" | "sticky"
  | "follow-up" | "report" | "parameter" | "segment";

export interface BoardCard {
  id: string;
  boardId: string;
  type: CardType;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  author: "user" | "system";

  // Type-specific data
  sql?: string;
  chartSpec?: ChartSpec;
  data?: Record<string, unknown>[];
  markdownContent?: string;
  parameterConfig?: ParameterConfig;
  metricId?: string;
  segmentId?: string;

  // Investigation
  hypothesisStatus?: "testing" | "supported" | "refuted" | "inconclusive";
  linkedHypothesisId?: string;

  // Liveness
  refreshCadence: "manual" | "hourly" | "daily";
  lastRefreshed?: string;
  lastData?: Record<string, unknown>[];

  // Provenance
  sourceConversationId?: string;
  sourceMessageIndex?: number;
  pinnedAt: string;
}

export interface ParameterConfig {
  inputType: "date-range" | "dropdown" | "text" | "number";
  defaultValue?: string;
  options?: string[];
  label?: string;
}

export interface CardComment {
  id: string;
  cardId: string;
  author: "user" | "system";
  content: string;
  timestamp: string;
  spawnedCardId?: string;
}

export interface CardConnection {
  id: string;
  boardId: string;
  fromCardId: string;
  toCardId: string;
  label?: string;
}

export interface BoardFrame {
  id: string;
  boardId: string;
  title: string;
  description?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  collapsed: boolean;
  order?: number;
}

export interface BoardSummary {
  id: string;
  name: string;
  template?: Board["template"];
  cardCount: number;
  updatedAt: string;
}
```

**Step 2: Write the board store**

Create `src/lib/board-store.ts`. Follow the exact same pattern as the existing `canvas-store.ts` — module-level Maps, `ensureInitialized()`, `persistToStorage()` with 300ms debounce, `STORAGE_VERSION` check.

```typescript
import type { Board, BoardCard, CardConnection, BoardFrame, CardComment, BoardSummary } from "./board-types";

const STORAGE_PREFIX = "baby-sentinel-boards";
const CARDS_PREFIX = "baby-sentinel-board-cards";
const CONNECTIONS_PREFIX = "baby-sentinel-board-connections";
const FRAMES_PREFIX = "baby-sentinel-board-frames";
const STORAGE_VERSION = 1;

const boardsMap = new Map<string, Board>();
const cardsMap = new Map<string, Map<string, BoardCard>>(); // boardId → cardId → card
const connectionsMap = new Map<string, CardConnection[]>();  // boardId → connections
const framesMap = new Map<string, BoardFrame[]>();           // boardId → frames
let initialized = false;
```

Public API to implement:

```typescript
// Board CRUD
export function getAllBoards(datasetId: string): Board[]
export function getBoard(id: string): Board | undefined
export function saveBoard(board: Board): boolean
export function removeBoard(id: string): boolean
export function getBoardSummaries(datasetId: string): BoardSummary[]

// Card CRUD (scoped to board)
export function getBoardCards(boardId: string): BoardCard[]
export function getBoardCard(boardId: string, cardId: string): BoardCard | undefined
export function saveBoardCard(card: BoardCard): boolean
export function removeBoardCard(boardId: string, cardId: string): boolean

// Comments (stored on card)
export function addCardComment(boardId: string, cardId: string, comment: CardComment): boolean
export function getCardComments(boardId: string, cardId: string): CardComment[]

// Connections
export function getBoardConnections(boardId: string): CardConnection[]
export function addConnection(conn: CardConnection): boolean
export function removeConnection(boardId: string, connectionId: string): boolean

// Frames
export function getBoardFrames(boardId: string): BoardFrame[]
export function saveFrame(frame: BoardFrame): boolean
export function removeFrame(boardId: string, frameId: string): boolean
```

Persistence: each board's cards, connections, and frames persist to separate localStorage keys (`${CARDS_PREFIX}-${boardId}`, etc.). Board list persists to `${STORAGE_PREFIX}`.

**Step 3: Add demo board seed data**

In `board-store.ts`, add a `seedDemoBoard(datasetId: string)` function that creates:
- One "Dashboard" board with 2 demo chart cards and 2 demo report cards (migrate from current `DEMO_ITEMS` in `canvas-store.ts`)
- Position/size values same as current demo items

Call this from `ensureInitialized()` when no boards exist for the given dataset.

**Step 4: Deprecate old canvas store**

Modify `src/lib/canvas-store.ts` — add a comment at the top: `// DEPRECATED: Use board-store.ts instead. This file re-exports for backward compatibility during migration.`

Keep all existing exports working so nothing breaks. We'll migrate consumers in later tasks.

**Step 5: Commit**

```bash
git add src/lib/board-types.ts src/lib/board-store.ts src/lib/canvas-store.ts
git commit -m "feat(canvas): add multi-board store with typed card system"
```

---

### Task 1.2: Board Switcher in Sidebar

**Files:**
- Modify: `src/lib/sidebar-config.ts` (canvas group gets sub-items)
- Modify: `src/components/sidebar.tsx` (render board list under canvas icon)
- Modify: `src/components/sidebar/panels.tsx` (CanvasPanel shows board list)
- Modify: `src/components/sidebar-context.tsx` (expose board state)

**Step 1: Update sidebar config**

In `src/lib/sidebar-config.ts`, change the canvas group from a simple route to an expandable group with dynamic items (boards will be loaded at runtime, not statically defined).

**Step 2: Update SidebarContext**

In `src/components/sidebar-context.tsx`, add:
- `boards` state (loaded from `getBoardSummaries(datasetId)`)
- `activeBoardId` state
- `refreshBoards()` function
- `boardVersion` counter (bumped on changes, triggers re-read)

**Step 3: Update CanvasPanel**

In `src/components/sidebar/panels.tsx`, update `CanvasPanel` to:
- List all boards for the current dataset
- Each board row: name, card count, last updated
- Active board highlighted
- "+" button at bottom to create new board
- Click a board → navigate to `/canvas?board={id}`

**Step 4: Board creation flow**

When "+" is clicked, show a small inline form or modal:
- Board name (text input)
- Template picker: Dashboard / Investigation / Presentation / Blank (4 buttons)
- "Create" button
- Creates board via `saveBoard()`, navigates to it

**Step 5: Commit**

```bash
git add src/lib/sidebar-config.ts src/components/sidebar.tsx src/components/sidebar/panels.tsx src/components/sidebar-context.tsx
git commit -m "feat(canvas): board switcher in sidebar with create flow"
```

---

### Task 1.3: Multi-Board Canvas Page

**Files:**
- Modify: `src/app/canvas/page.tsx` (accept `?board=` query param)
- Modify: `src/components/canvas/canvas-page.tsx` (load/save per board, re-mount on board switch)

**Step 1: Route with board param**

Update `src/app/canvas/page.tsx` to read `searchParams.board` and pass it to `CanvasPage`.

**Step 2: Refactor canvas-page.tsx**

The key change: instead of loading from `getAllCanvasItems()`, load from `getBoardCards(boardId)`. Instead of `saveCanvasItem()`, use `saveBoardCard()`.

- Accept `boardId` prop
- On mount: load cards for this board, create tldraw shapes
- On board change: unmount and re-mount tldraw (or clear and reload shapes)
- Camera persistence keyed per board: `baby-sentinel-canvas-camera-${boardId}`
- Shape sync listener writes to `saveBoardCard()` instead of `saveCanvasItem()`
- SmartStack: keep for now, will evolve in Phase 6

**Step 3: Handle missing board**

If `?board=` is not provided or board doesn't exist:
- If boards exist for this dataset, redirect to the most recently updated one
- If no boards exist, create the default demo board (via `seedDemoBoard()`), then redirect

**Step 4: Commit**

```bash
git add src/app/canvas/page.tsx src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): multi-board canvas page with per-board loading"
```

---

### Task 1.4: New Card Shape Renderers

**Files:**
- Modify: `src/components/canvas/chart-shape.tsx` (rename to `card-shape.tsx`, add new type renderers)
- Create: `src/components/canvas/card-renderers/table-renderer.tsx`
- Create: `src/components/canvas/card-renderers/metric-renderer.tsx`
- Create: `src/components/canvas/card-renderers/sql-renderer.tsx`
- Create: `src/components/canvas/card-renderers/text-renderer.tsx`
- Create: `src/components/canvas/card-renderers/sticky-renderer.tsx`
- Create: `src/components/canvas/card-renderers/parameter-renderer.tsx`
- Create: `src/components/canvas/card-renderers/segment-renderer.tsx`

**Step 1: Refactor chart-shape.tsx → card-shape.tsx**

Rename the shape type from `canvas-chart` to `canvas-card`. Update the `component()` method to dispatch to per-type renderers based on `item.type`. Keep the existing chart/report/insight renderers working.

The `component()` method becomes a switch:

```typescript
component(shape: ICanvasCardShape) {
  const item = getBoardCard(shape.props.boardId, shape.props.canvasItemId);
  if (!item) return <EmptyCard />;

  switch (item.type) {
    case "chart": return <ChartRenderer item={item} shape={shape} ... />;
    case "report": return <ReportRenderer item={item} shape={shape} ... />;
    case "table": return <TableRenderer item={item} shape={shape} ... />;
    case "metric": return <MetricRenderer item={item} shape={shape} ... />;
    case "sql": return <SqlRenderer item={item} shape={shape} ... />;
    case "text": return <TextRenderer item={item} shape={shape} ... />;
    case "sticky": return <StickyRenderer item={item} shape={shape} ... />;
    case "parameter": return <ParameterRenderer item={item} shape={shape} ... />;
    case "segment": return <SegmentRenderer item={item} shape={shape} ... />;
    // follow-up, insight handled similarly
  }
}
```

**Step 2: Table renderer**

Compact data grid. Columns from `item.data[0]` keys. Max 10 visible rows, scrollable. Sortable columns (click header). Row count badge. Same 3-zone pointer events pattern.

**Step 3: Metric renderer**

Big number display. `item.title` as label. Primary value from `item.data` (first row, first numeric column). Delta badge if `lastData` exists. Optional sparkline (tiny inline Recharts line, no axes). Same accent strip as reports (indigo).

**Step 4: SQL renderer**

Editable SQL text area (monospace, syntax highlighted via existing `sql-highlight.tsx`). "Run" button in header. Row count + execution time in footer after run. Result preview (first 5 rows) below SQL. `pointer-events: all` on the SQL textarea when editing.

**Step 5: Text renderer**

Markdown rendering via existing `MarkdownContent` from `src/lib/markdown.tsx`. Editable when double-clicked (toggle between rendered markdown and textarea). AI badge if `item.author === "system"`.

**Step 6: Sticky renderer**

Small colored card. Freeform text, no markdown. Background color from a small palette (yellow, blue, green, pink — muted tones). AI badge if `item.author === "system"`. Smallest preset size.

**Step 7: Parameter renderer**

Shows the input control based on `item.parameterConfig.inputType`:
- `date-range`: two date inputs (from/to)
- `dropdown`: select from `options[]`
- `text`: text input
- `number`: number input
All interactive (`pointer-events: all`). Value stored in `item.data` as `[{ value: currentValue }]`.

**Step 8: Segment renderer**

Segment name, user count badge, SQL preview (truncated, expandable). If `item.segmentId` is set, shows live data. Accent strip color: foreground/muted.

**Step 9: Update shape props**

The shape props need `boardId` added:

```typescript
declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [CARD_SHAPE_TYPE]: {
      w: number;
      h: number;
      canvasItemId: string;
      boardId: string;
    };
  }
}
```

**Step 10: Commit**

```bash
git add src/components/canvas/card-shape.tsx src/components/canvas/card-renderers/
git commit -m "feat(canvas): add renderers for all 10 card types"
```

---

### Task 1.5: Frames as Tldraw Shapes

**Files:**
- Create: `src/components/canvas/frame-shape.tsx`
- Modify: `src/components/canvas/canvas-page.tsx` (register frame shape util, load/save frames)

**Step 1: Frame shape util**

Create a new `BaseBoxShapeUtil` subclass for frames. Shape type: `canvas-frame`. Props: `{ w, h, boardId, frameId }`.

Rendering:
- Dashed border rectangle with rounded corners
- Title bar at top (editable text)
- Description below title (smaller, muted)
- Collapse/expand toggle button
- When collapsed: only title bar visible, fixed small height
- Background: very subtle tint (`var(--muted)` at 5% opacity)

Frames should render BEHIND card shapes (lower z-index). Cards inside a frame should move with the frame on drag (tldraw's `onChildrenChange` or manual grouping).

**Step 2: Frame creation action**

Add to canvas-page.tsx: when multiple cards are selected, show a "Group into frame" button in a floating toolbar. On click:
- Calculate bounding box of selected shapes + padding
- Create a frame shape at that position/size
- Save frame to board store
- LLM title suggestion (see Phase 4 — for now, default to "Untitled Group")

**Step 3: Frame sync to store**

Same listener pattern as cards — frame shape move/resize syncs back to `saveFrame()`. Frame deletion calls `removeFrame()`.

**Step 4: Commit**

```bash
git add src/components/canvas/frame-shape.tsx src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): frame shapes for grouping cards"
```

---

### Task 1.6: Update Canvas Config Panel for New Types

**Files:**
- Modify: `src/components/canvas/canvas-config-panel.tsx`

**Step 1: Extend config panel**

The config panel currently handles chart/report/insight. Extend it to handle all card types:

- **Table**: show full data grid, column visibility toggles
- **Metric**: edit title, view formula/SQL, view history
- **SQL**: full SQL editor, run button, result preview
- **Text**: markdown editor
- **Sticky**: text editor, color picker
- **Parameter**: configure input type, default value, options
- **Segment**: view SQL, user count, link to segment page

Use a switch on `item.type` to render the appropriate config section. Keep existing chart type selector for chart cards.

**Step 2: Commit**

```bash
git add src/components/canvas/canvas-config-panel.tsx
git commit -m "feat(canvas): extend config panel for all card types"
```

---

## Phase 2: Five Entry Points

**Goal:** Content gets onto boards from everywhere — enhanced pin from chat, prompt-to-card, drag from sidebar, manual add, system suggestions.

---

### Task 2.1: Pin Everything from Chat

**Files:**
- Modify: `src/components/canvas/pin-button.tsx` (accept all content types, board picker)
- Modify: `src/components/chat/chat-thread.tsx` (add PinButton to tables, SQL, text, metrics, follow-ups)
- Create: `src/components/canvas/board-picker-popover.tsx` (small popover to pick target board)

**Step 1: Board picker popover**

Small popover listing boards for the current dataset. Shows board name + icon. "Last used" board is pre-selected. Appears when pin button is clicked.

**Step 2: Extend PinButton**

Current PinButton only accepts `ChartSpec`. Refactor to accept a generic payload:

```typescript
interface PinButtonProps {
  cardType: CardType;
  title: string;
  // Type-specific payloads (only one set)
  chartSpec?: ChartSpec;
  sql?: string;
  data?: Record<string, unknown>[];
  markdownContent?: string;
  metricId?: string;
  segmentId?: string;
  // Provenance
  sourceConversationId?: string;
  onPinned?: () => void;
}
```

On pin: create a `BoardCard`, save via `saveBoardCard()`, show toast with "View on board" link.

**Step 3: Add PinButton throughout chat-thread**

Add pin icons to:
- Query result tables (after table render)
- SQL code blocks (after SQL display)
- Text analysis sections (after markdown content)
- Metric context cards (in card header)
- Follow-up action chips (small pin icon)
- Research report sections (per-section pin)

**Step 4: Commit**

```bash
git add src/components/canvas/pin-button.tsx src/components/canvas/board-picker-popover.tsx src/components/chat/chat-thread.tsx
git commit -m "feat(canvas): pin any chat output to any board"
```

---

### Task 2.2: Prompt-to-Card

**Files:**
- Modify: `src/components/canvas/canvas-page.tsx` (double-click handler, inline prompt input)
- Create: `src/components/canvas/prompt-to-card-input.tsx` (floating input component)
- Create: `src/app/api/canvas-query/route.ts` (lightweight analytics endpoint for canvas)

**Step 1: Double-click handler**

In canvas-page.tsx, listen for double-click on empty canvas space (not on a shape). On double-click:
- Get the click position in canvas coordinates (editor.screenToPage)
- Show a floating input at that position

**Step 2: Prompt-to-card input component**

Floating text input with:
- Auto-focus on appear
- Escape to dismiss
- Enter to submit
- Small "Analyzing..." loading state

**Step 3: Canvas query API route**

Create `src/app/api/canvas-query/route.ts`. This is a simplified version of `/api/analyze`:
- Accepts: `{ query: string, datasetId: string }`
- Runs classify → if analytics, generates SQL, executes, returns results
- Returns NDJSON stream with: `sql`, `query_result`, `text` (summary), `chart` (if chart detected)
- Lighter than full deep research — more like quick mode

**Step 4: Wire it together**

On submit:
1. Call canvas-query API
2. As events stream in:
   - `sql` event → create SQL card at click position
   - `query_result` event → create table card next to SQL card
   - `chart` event → create chart card, wire to SQL card
   - `text` event → create text card with summary
3. Cards appear progressively as they stream

**Step 5: Commit**

```bash
git add src/components/canvas/canvas-page.tsx src/components/canvas/prompt-to-card-input.tsx src/app/api/canvas-query/route.ts
git commit -m "feat(canvas): prompt-to-card with streaming results"
```

---

### Task 2.3: Manual Card Add

**Files:**
- Create: `src/components/canvas/add-card-toolbar.tsx`
- Modify: `src/components/canvas/canvas-page.tsx` (render toolbar, handle add)

**Step 1: Add card toolbar**

Floating "+" button near the floating toolbar at bottom. On click, shows a popover with card type icons:
- Sticky Note, SQL Block, Text Block, Parameter, Empty Chart

Each option has an icon + label. Click one → card appears at center of viewport (or near last interaction point).

**Step 2: Create empty cards**

Each card type has sensible defaults:
- Sticky: empty text, yellow background, small size
- SQL: empty query, "Write your SQL..." placeholder
- Text: empty markdown, "Click to edit..." placeholder
- Parameter: date-range type by default, opens config panel immediately
- Empty Chart: opens config panel to configure data source

**Step 3: Commit**

```bash
git add src/components/canvas/add-card-toolbar.tsx src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): manual card add toolbar"
```

---

### Task 2.4: Drag from Sidebar

**Files:**
- Modify: `src/components/sidebar/panels.tsx` (make entity items draggable)
- Modify: `src/components/canvas/canvas-page.tsx` (drop handler)

**Step 1: Draggable sidebar items**

In the sidebar panels (metrics list, segments list, etc.), add `draggable` attribute and `onDragStart` handler. Set drag data to JSON: `{ type: "metric", id: metricId, title: "Revenue" }`.

**Step 2: Canvas drop handler**

In canvas-page.tsx, add `onDrop` and `onDragOver` handlers on the canvas container:
- Read drag data
- Convert drop position to canvas coordinates
- Create appropriate BoardCard based on entity type
- Save to board store
- Create tldraw shape

**Step 3: Commit**

```bash
git add src/components/sidebar/panels.tsx src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): drag entities from sidebar onto canvas"
```

---

### Task 2.5: System Suggestions

**Files:**
- Create: `src/lib/canvas-suggestions.ts` (suggestion logic)
- Modify: `src/components/canvas/canvas-page.tsx` (show suggestion toasts)

**Step 1: Suggestion engine**

When a card is added to a board, check for related entities:
- Chart/SQL card with metric name in title → suggest the matching metric card
- Metric card → suggest related segments (from entity registry)
- Segment card → suggest key metrics for that segment

Return suggestions as: `{ label: string, cardPayload: Partial<BoardCard> }[]`

**Step 2: Show suggestions**

Use existing `toast` (sonner) with action button. "Add Revenue metric too?" → [Add] button. Max 1 suggestion per card add, dismiss after 5s.

**Step 3: Commit**

```bash
git add src/lib/canvas-suggestions.ts src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): contextual card suggestions on add"
```

---

## Phase 3: Liveness

**Goal:** Cards with SQL auto-refresh with real data. Reactive sync. Compare To mode.

---

### Task 3.1: Real SQL Refresh

**Files:**
- Create: `src/app/api/canvas-refresh/route.ts` (batch SQL execution endpoint)
- Modify: `src/components/canvas/card-shape.tsx` (refresh triggers re-render with new data)
- Modify: `src/lib/board-store.ts` (store previous data for delta)

**Step 1: Canvas refresh API**

`POST /api/canvas-refresh` accepts `{ cards: { id, sql }[], datasetId }`. Executes each SQL via `executeSQLInternal()`. Returns `{ results: { cardId, data, executionTimeMs, error }[] }`.

Batch execution avoids N individual API calls for boards with many cards.

**Step 2: Per-card refresh**

In the card shape toolbar, wire the Refresh button to:
1. Call `/api/canvas-refresh` with this card's SQL
2. On response: save `lastData = item.data` (for delta), update `item.data` with new result, update `lastRefreshed`
3. Card re-renders with new data
4. Delta badge appears if values changed

**Step 3: Board-level refresh**

Add a "Refresh All" button to the board toolbar. Collects all SQL-backed cards, calls `/api/canvas-refresh` in one batch.

**Step 4: Commit**

```bash
git add src/app/api/canvas-refresh/route.ts src/components/canvas/card-shape.tsx src/lib/board-store.ts
git commit -m "feat(canvas): real SQL refresh with batch execution"
```

---

### Task 3.2: Auto-Refresh Cadence

**Files:**
- Create: `src/lib/board-refresh-scheduler.ts` (client-side interval manager)
- Modify: `src/components/canvas/canvas-page.tsx` (start scheduler on mount)
- Modify: `src/components/canvas/canvas-config-panel.tsx` (cadence picker per card)

**Step 1: Cadence picker in config panel**

Add a "Refresh" section to the config panel for SQL-backed cards. Three options: Manual, Hourly, Daily. Saved on the card's `refreshCadence` field.

**Step 2: Client-side scheduler**

On canvas page mount, start an interval that checks all cards on the board:
- If `refreshCadence !== "manual"` and `lastRefreshed` is older than cadence → trigger refresh
- Check interval: every 60 seconds
- Batch all due cards into one `/api/canvas-refresh` call

**Step 3: Stale indicator**

In card renderers, if `lastRefreshed` is older than `refreshCadence`, show a subtle indicator (faded border or small clock icon with timestamp).

**Step 4: Commit**

```bash
git add src/lib/board-refresh-scheduler.ts src/components/canvas/canvas-page.tsx src/components/canvas/canvas-config-panel.tsx
git commit -m "feat(canvas): auto-refresh cadence with stale indicators"
```

---

### Task 3.3: Compare To

**Files:**
- Create: `src/components/canvas/compare-to-picker.tsx` (date picker for board-level comparison)
- Modify: `src/components/canvas/canvas-page.tsx` (comparison state, pass to renderers)
- Modify card renderers to show delta badges when comparison active

**Step 1: Compare To picker**

Floating date picker in the board toolbar area. When a date is selected, the board enters "comparison mode." A banner shows "Comparing to: Mar 3, 2026" with a clear/dismiss button.

**Step 2: Comparison data fetch**

When comparison mode activates, for each SQL-backed card:
- Modify the card's SQL to filter for the comparison date (inject date constraint)
- Execute via `/api/canvas-refresh`
- Store comparison results on a `comparisonData` transient state (not persisted)

**Step 3: Delta badges on cards**

When comparison is active, each card renderer shows:
- Current value (normal)
- Comparison value (smaller, muted)
- Delta badge (green/red pill with ±% change)

**Step 4: Commit**

```bash
git add src/components/canvas/compare-to-picker.tsx src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): board-level Compare To with delta badges"
```

---

## Phase 4: Card Conversations + LLM Annotations

**Goal:** Every card has a comment thread. LLM responds to questions and generates annotations.

---

### Task 4.1: Card Comment Thread UI

**Files:**
- Create: `src/components/canvas/card-comment-thread.tsx`
- Modify card renderers: add comment icon that opens thread
- Modify: `src/lib/board-store.ts` (comments stored on card)

**Step 1: Comment thread component**

Floating panel anchored to a card (appears to the right or below). Shows:
- List of comments (user and system, chronological)
- Text input at bottom
- User comments: plain text, user avatar
- System comments: AI badge, markdown rendering
- "→ Created [card title]" links when a comment spawned a card

**Step 2: Comment icon on cards**

Add a small message icon to every card's header toolbar (next to existing refresh/settings icons). Badge with unread count if system has replied. Click opens the comment thread.

**Step 3: Store comments**

Comments stored as array on `BoardCard.comments`. Use `addCardComment()` from board-store.

**Step 4: Commit**

```bash
git add src/components/canvas/card-comment-thread.tsx src/lib/board-store.ts
git commit -m "feat(canvas): card comment thread UI"
```

---

### Task 4.2: LLM Responses to Card Comments

**Files:**
- Create: `src/app/api/canvas-comment/route.ts` (LLM endpoint for card comments)
- Modify: `src/components/canvas/card-comment-thread.tsx` (send comments to API, handle responses)

**Step 1: Canvas comment API**

`POST /api/canvas-comment` accepts:
```typescript
{ cardId, boardId, comment, cardContext: { type, title, sql, data, chartSpec }, datasetId }
```

The API:
1. Builds a prompt with the card's context (type, data, SQL)
2. Appends the user's comment
3. Classifies: is this a question (needs analysis), an instruction (modify card), or a note (just store)?
4. For questions: runs analysis, returns text response + optional new card payload
5. For instructions: modifies card (e.g., re-runs SQL with different params), returns updated card
6. For notes: just stores the comment, no LLM call

**Step 2: Handle responses in UI**

- Text response → add as system comment in thread
- New card payload → create card on board, add "→ Created [title]" comment, connect with arrow
- Card update → update the card's data, show "Card updated" in thread

**Step 3: Commit**

```bash
git add src/app/api/canvas-comment/route.ts src/components/canvas/card-comment-thread.tsx
git commit -m "feat(canvas): LLM responses to card comments"
```

---

### Task 4.3: LLM-Generated Sticky Notes

**Files:**
- Modify: `src/app/api/canvas-comment/route.ts` (return annotations alongside responses)
- Modify: `src/app/api/canvas-query/route.ts` (return annotations with prompt-to-card results)
- Modify: `src/components/canvas/canvas-page.tsx` (place annotation stickies)

**Step 1: Annotation generation**

When the LLM processes a card comment or prompt-to-card query, it can return optional annotations:

```typescript
{ annotations?: { text: string, relatedCardId: string, severity?: "info" | "warning" }[] }
```

The LLM prompt includes: "If you notice data caveats, statistical issues, or connections to other cards on the board, return them as annotations."

**Step 2: Place annotation stickies**

When annotations are returned:
- Create sticky note cards with `author: "system"`
- Position them near the related card (offset right + down)
- Small size, AI badge visible

**Step 3: Commit**

```bash
git add src/app/api/canvas-comment/route.ts src/app/api/canvas-query/route.ts src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): LLM-generated annotation sticky notes"
```

---

### Task 4.4: LLM-Powered Frame Titles

**Files:**
- Create: `src/app/api/canvas-frame-title/route.ts` (generate title + description from card contents)
- Modify: `src/components/canvas/canvas-page.tsx` (call API on frame creation)

**Step 1: Frame title API**

`POST /api/canvas-frame-title` accepts `{ cards: { type, title, sql?, data? }[] }`. Returns `{ title: string, description: string }`. Quick Gemini call with a focused prompt.

**Step 2: Wire into frame creation**

When user groups cards into a frame:
1. Create frame with "Generating title..." placeholder
2. Call frame title API with card summaries
3. Update frame title + description on response
4. Frame title is editable — user can overwrite

**Step 3: Commit**

```bash
git add src/app/api/canvas-frame-title/route.ts src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): LLM-generated frame titles and descriptions"
```

---

### Task 4.5: Sidebar Chat Integration

**Files:**
- Modify: `src/components/chat/chat-panel.tsx` (board comment log mode)
- Modify: `src/components/canvas/canvas-page.tsx` (sync comments to sidebar)

**Step 1: Board chat mode**

When on `/canvas`, the sidebar chat shows a unified log of all card comments on the active board. Each message prefixed with the card name (clickable → zooms to card on canvas).

**Step 2: Board-level questions**

Messages typed in sidebar chat (without clicking a card) are "board-level" — the system gets all card summaries as context and can answer questions like "summarize this board" or "what changed since yesterday?"

**Step 3: Commit**

```bash
git add src/components/chat/chat-panel.tsx src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): sidebar chat shows board comment log"
```

---

## Phase 5: Workflow Builder

**Goal:** Wire cards together with connection ports. Dataflow execution. Parameters feed downstream.

---

### Task 5.1: Connection Ports on Cards

**Files:**
- Modify: `src/components/canvas/card-shape.tsx` (add port handles)
- Create: `src/components/canvas/connection-layer.tsx` (SVG overlay for arrows)
- Modify: `src/components/canvas/canvas-page.tsx` (connection state, drag-to-connect)

**Step 1: Port handles**

Add small circular port dots to card shapes:
- Output port: bottom center edge
- Input port: top center edge
- Hidden by default, visible on hover
- Styled: 8px circle, border: 2px solid muted-foreground, bg: card

**Step 2: Drag-to-connect interaction**

When user drags from an output port:
- Show a temporary line following the cursor
- Highlight valid drop targets (input ports on other cards)
- On drop onto an input port → create a `CardConnection` in store
- On drop elsewhere → cancel

**Step 3: Connection arrows**

SVG overlay layer on top of the canvas (but below card shapes). Reads connections from store. Draws curved arrows from source card bottom to target card top. Arrows are selectable (click to select, backspace to delete).

**Step 4: Commit**

```bash
git add src/components/canvas/card-shape.tsx src/components/canvas/connection-layer.tsx src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): connection ports and arrow layer"
```

---

### Task 5.2: Dataflow Execution Engine

**Files:**
- Create: `src/lib/canvas-executor.ts` (topological execution of connected cards)
- Modify: `src/components/canvas/canvas-page.tsx` (trigger execution on connect/change)

**Step 1: Canvas executor**

Similar to `playbook-executor.ts` but adapted for canvas cards:

```typescript
export async function executeCanvasDataflow(
  cards: BoardCard[],
  connections: CardConnection[],
  changedCardId: string,
  datasetId: string
): Promise<Map<string, BoardCard>>
```

1. Build dependency graph from connections
2. Find all cards downstream of `changedCardId`
3. Topological sort downstream cards
4. Execute in order:
   - SQL cards: run SQL via `/api/canvas-refresh`, store result in `card.data`
   - Chart/Table cards with an incoming connection: update `data` from source card's output
   - Text (LLM) cards with incoming connections: call Gemini with all source card data as context, generate summary
   - Parameter cards: value flows to downstream SQL cards via `{{placeholder}}` substitution

**Step 2: Eager execution on connect**

When a new connection is created, immediately trigger `executeCanvasDataflow` for the target card and its downstream dependents. This makes the canvas reactive.

**Step 3: Eager execution on change**

When a SQL card's query is edited and run, or a parameter value changes, trigger downstream execution.

**Step 4: Commit**

```bash
git add src/lib/canvas-executor.ts src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): live dataflow execution engine"
```

---

### Task 5.3: Parameter → SQL Wiring

**Files:**
- Modify: `src/lib/canvas-executor.ts` (parameter substitution)
- Modify parameter renderer (show downstream connections count)

**Step 1: Parameter substitution**

When executing a SQL card that has an incoming connection from a Parameter card:
- Read the parameter's current value from `card.data[0].value`
- Substitute all `{{parameterName}}` in the SQL with the value
- Use `substituteParams()` from existing `src/lib/playbook-params.ts`

**Step 2: Parameter card UX**

Show a small badge on parameter cards: "Connected to N cards". When value changes, downstream cards show a brief loading state.

**Step 3: Commit**

```bash
git add src/lib/canvas-executor.ts src/components/canvas/card-renderers/parameter-renderer.tsx
git commit -m "feat(canvas): parameter cards wire into SQL via placeholder substitution"
```

---

### Task 5.4: Collective Operations

**Files:**
- Create: `src/components/canvas/collective-toolbar.tsx` (floating toolbar on multi-select)
- Modify: `src/components/canvas/canvas-page.tsx` (detect multi-select, show toolbar)

**Step 1: Multi-select detection**

Listen for tldraw selection changes. When 2+ cards are selected, show a floating toolbar above the selection.

**Step 2: Collective actions**

Toolbar buttons:
- **Summarize**: call LLM with all selected cards' data → create new text card wired to all selected
- **Compare**: call LLM to compare selected cards → create comparison text card
- **Group into frame**: create frame around selection (existing from Task 1.5)
- **Delete**: remove all selected cards

**Step 3: Commit**

```bash
git add src/components/canvas/collective-toolbar.tsx src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): collective operations on multi-select"
```

---

## Phase 6: Investigation + Presentation Boards

**Goal:** Structured investigation scaffold. LLM-assisted presentation conversion.

---

### Task 6.1: Investigation Board Template

**Files:**
- Create: `src/app/api/canvas-investigate/route.ts` (generate investigation scaffold)
- Modify: `src/lib/board-store.ts` (investigation board creation)
- Modify: `src/components/canvas/canvas-page.tsx` (load investigation scaffold)

**Step 1: Investigation scaffold API**

`POST /api/canvas-investigate` accepts `{ trigger: string, datasetId: string }`.

The LLM:
1. Analyzes the trigger ("churn spiked 18% WoW")
2. Generates 2-3 hypothesis sticky notes
3. Suggests an initial SQL query to run for evidence
4. Returns: `{ triggerCard, hypotheses[], initialQuery, frameTitles }`

**Step 2: Board creation with scaffold**

When user creates an Investigation board (from sidebar or via prompt-to-card "investigate X"):
1. Create the board
2. Call `/api/canvas-investigate` with the trigger description
3. Create cards: trigger metric card → hypotheses frame with sticky notes → evidence frame (empty) → conclusion text card (empty)
4. Position in a top-to-bottom flow

**Step 3: Investigation-specific UX**

Hypothesis sticky notes show status badges: Testing, Supported, Refuted, Inconclusive. Status updated by LLM when evidence cards are added to the evidence frame (via card comment or manual tagging).

**Step 4: Commit**

```bash
git add src/app/api/canvas-investigate/route.ts src/lib/board-store.ts src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): investigation board template with LLM scaffold"
```

---

### Task 6.2: Investigation LLM Participation

**Files:**
- Modify: `src/app/api/canvas-comment/route.ts` (investigation-aware responses)
- Create: `src/lib/investigation-agent.ts` (hypothesis management logic)

**Step 1: Hypothesis evaluation**

When a card is added to an investigation board's evidence frame, the system:
1. Reads all hypothesis stickies and the new evidence card
2. Calls LLM: "Given this evidence, update the status of each hypothesis"
3. Updates hypothesis sticky notes with new status badges
4. Drops LLM annotation stickies for observations

**Step 2: Evidence suggestions**

After hypothesis evaluation, the LLM suggests next steps:
- "Want to test the seasonal pattern hypothesis? Try this query: ..."
- Appears as a prompt-to-card suggestion near the evidence frame

**Step 3: Gap detection**

Periodic check (on card add or manual trigger): which hypotheses have no evidence? Surface as a subtle prompt: "2 hypotheses haven't been tested yet."

**Step 4: Auto-conclusion draft**

When evidence exists for all hypotheses, offer to draft a conclusion: "Ready to summarize? I can draft a conclusion based on your evidence." → fills the conclusion text card.

**Step 5: Commit**

```bash
git add src/app/api/canvas-comment/route.ts src/lib/investigation-agent.ts
git commit -m "feat(canvas): investigation LLM agent with hypothesis management"
```

---

### Task 6.3: Presentation Board Conversion

**Files:**
- Create: `src/app/api/canvas-present/route.ts` (convert board to presentation)
- Create: `src/components/canvas/present-button.tsx` (trigger conversion)

**Step 1: Presentation conversion API**

`POST /api/canvas-present` accepts `{ boardId, cards[], frames[], connections[] }`.

The LLM:
1. Reads all cards, filters out noise (empty stickies, dead-end SQL, refuted hypotheses)
2. Selects key evidence cards
3. Orders narratively (not chronologically)
4. Generates connecting text cards between evidence
5. Creates section frames with titles: "The Problem", "What We Found", "Root Cause", "Recommendations"
6. Returns: `{ cards: BoardCard[], frames: BoardFrame[], textCards: BoardCard[] }`

**Step 2: Create presentation board**

On the source board, add a "Create Presentation" button (in board toolbar or right-click menu).

On click:
1. Call `/api/canvas-present` with current board's data
2. Create new Presentation board with `sourceInvestigationBoardId`
3. Populate with returned cards, frames, text cards
4. Navigate to the new board

**Step 3: Clean mode toggle**

Add a "Clean Mode" toggle to presentation boards. When active: hides connection arrows, port dots, comment icons, AI badges. Just cards and frames — screenshot-ready.

**Step 4: Commit**

```bash
git add src/app/api/canvas-present/route.ts src/components/canvas/present-button.tsx
git commit -m "feat(canvas): LLM-assisted presentation board conversion"
```

---

### Task 6.4: Frame Export

**Files:**
- Create: `src/components/canvas/export-button.tsx`
- Modify: `src/components/canvas/frame-shape.tsx` (export action in frame header)

**Step 1: Export to PNG**

Add "Export" button to frame headers on presentation boards. Uses `html2canvas` or tldraw's built-in export to capture the frame area as a PNG.

**Step 2: Full board export**

Board toolbar: "Export Board" → captures the full visible canvas area as PNG.

**Step 3: Commit**

```bash
git add src/components/canvas/export-button.tsx src/components/canvas/frame-shape.tsx
git commit -m "feat(canvas): frame and board export to PNG"
```

---

## Migration Notes

### Backward Compatibility

- The old `canvas-store.ts` continues to work during migration
- Old canvas items (CanvasItem type) can be migrated to BoardCard via a one-time migration function in board-store
- The single `/canvas` route now accepts `?board=` param — no board param falls back to default board
- SmartStack (insights) keeps working on the default board

### Storage Version Bump

- Board store starts at `STORAGE_VERSION = 1`
- Old canvas store at `STORAGE_VERSION = 2`
- No conflict — different localStorage keys
- Migration function reads old canvas items, creates a "Dashboard" board, converts items to BoardCards

### Performance Considerations

- Batch SQL refresh to avoid N individual DuckDB queries
- Limit auto-refresh to visible board only (don't refresh boards in background)
- Cap at 100 cards per board (warn user)
- Debounce dataflow execution (300ms after last change)
