---
title: "feat: Board Document View (Mixpanel-Inspired)"
type: feat
status: active
date: 2026-03-13
origin: docs/brainstorms/2026-03-13-board-document-view-brainstorm.md
---

# Board Document View (Mixpanel-Inspired)

## Overview

Add a scrollable, section-based **document view** as the default rendering mode for boards on the canvas page. Inspired by Mixpanel Boards — sections with headings, AI-generated prose, and responsive card grids. This is a second view on the same `Board` data; the tldraw spatial canvas becomes an alternate "canvas view" toggled via a button.

Additionally: **"Save as Board"** on deep research messages to convert structured research output into a board. **Board templates** to generate pre-built section structures for common analysis patterns.

(see brainstorm: `docs/brainstorms/2026-03-13-board-document-view-brainstorm.md`)

## Critical Design Decisions

These were surfaced by spec-flow analysis and resolved here:

### 1. Card-to-section source of truth
**Decision:** `BoardCard.sectionId` is the only pointer. No `cardIds[]` on `BoardSection`. Section contents derived via `cards.filter(c => c.sectionId === section.id)` sorted by `c.orderInSection`.
**Rationale:** Single-direction references match existing codebase patterns. Avoids dual-pointer consistency bugs.

### 2. BoardFrame vs BoardSection
**Decision:** Coexist. `BoardFrame` remains for spatial grouping in canvas view. `BoardSection` is a new type for document view. They do not interact.
**Rationale:** Frames have position/size (spatial), sections have order/layout (document). Different concerns. No migration needed.

### 3. Global time filter mechanism
**Decision:** For v1, the time filter wraps original SQL in a date-filtered CTE using the dataset's `dateField`:
```sql
WITH _source AS ({original_sql})
SELECT * FROM _source WHERE {dateField} >= '{start}' AND {dateField} < '{end}'
```
Falls back gracefully — if the original query doesn't reference the date field, the wrapper returns all rows (no filtering, no error).
**Rationale:** No LLM calls needed, works on arbitrary SQL, predictable behavior. Imperfect (can't filter on computed date expressions) but sufficient for v1.

### 4. ChartSpec generation
**Decision:** Extract the chart inference logic from `/api/canvas-query/route.ts` into a shared `inferChartSpec(columns, rows, title)` function in `src/lib/chart-inference.ts`. Used by both canvas-query API and board conversion.
**Rationale:** Reuse existing proven logic. No additional LLM calls for chart type detection.

### 5. Canvas ↔ document position sync
**Decision:** Independent. Document view uses `sectionId` + `orderInSection`. Canvas view uses `position: {x, y}`. Toggling from document → canvas auto-layouts cards by section grouping (section 1 top-left, section 2 below, etc.) ONLY if cards have no prior canvas positions. Manual canvas repositioning does NOT change section assignments.
**Rationale:** Keeping them independent is simpler and avoids confusing position ↔ order feedback loops.

### 6. Query result data retention on ChatMessage
**Decision:** Extend `QueryInfo` to include `columns?: string[]` and `data?: Record<string, unknown>[]` (capped at 50 rows). Populated from `query_result` SSE events during deep research streaming.
**Rationale:** Avoids re-executing 17 SQL queries on "Save as Board." Small storage cost (50 rows × 17 queries). Falls back to re-execution if data is missing (old conversations).

### 7. Subagent → section mapping
**Decision:** Skip `data-quality` and `critique` agents. Map remaining agents to sections. Add a "Summary" section at top from synthesis text. Critique findings become a callout at the bottom of the summary section prose.
**Rationale:** Data-quality and critique are meta-analysis, not user-facing insights. The summary section provides the executive overview.

## Proposed Solution

### Phase 1: Data Model & Store (`board-types.ts`, `board-store.ts`)

**New type — `BoardSection`:**
```typescript
interface BoardSection {
  id: string;
  boardId: string;
  title: string;
  prose: string;           // Markdown, AI-generated
  layout: "full" | "grid-2" | "grid-3";
  order: number;
  collapsed: boolean;
}
```

**Extend `Board`:**
```typescript
interface Board {
  // ... existing fields
  viewMode: "document" | "canvas";   // default: "document"
  globalTimeRange?: {
    preset?: "7d" | "30d" | "90d" | "1y" | "custom";
    start?: string;  // ISO date
    end?: string;    // ISO date
  };
}
```

**Extend `BoardCard`:**
```typescript
interface BoardCard {
  // ... existing fields
  sectionId?: string;        // Which section this card belongs to (document view)
  orderInSection?: number;   // Order within section
}
```

**Extend `QueryInfo` (in `types.ts`):**
```typescript
interface QueryInfo {
  // ... existing fields
  columns?: string[];
  data?: Record<string, unknown>[];  // Capped at 50 rows
}
```

**Store additions (`board-store.ts`):**
```typescript
// Section CRUD
export function getBoardSections(boardId: string): BoardSection[]
export function saveBoardSection(section: BoardSection): boolean
export function removeBoardSection(boardId: string, sectionId: string): boolean
export function reorderSections(boardId: string, sectionIds: string[]): void
```

Storage key: `baby-sentinel-board-sections-{boardId}` in localStorage, same debounced persist pattern.

**Files changed:**
- `src/lib/board-types.ts` — add `BoardSection`, extend `Board`, extend `BoardCard`
- `src/lib/board-store.ts` — add section CRUD, section persistence, extend `loadBoard`/`saveBoard`
- `src/lib/types.ts` — extend `QueryInfo` with `columns` and `data`
- `src/hooks/use-analytics.ts` — populate `QueryInfo.columns` and `QueryInfo.data` from `query_result` SSE events (cap at 50 rows)

### Phase 2: Extract Card Renderers for Reuse

Currently, card renderers live in `src/components/canvas/card-renderers/` and are dispatched by `src/components/canvas/shapes/card-content.tsx`. They have no tldraw imports but use canvas-specific CSS classes (`nodrag`, `nopan`) and pointer-events patterns.

**Extract to shared location:**

Move `card-content.tsx` dispatch logic into a new `src/components/board/card-renderer.tsx` that:
- Accepts `BoardCard` + `width` + `height` + `context: "canvas" | "document"`
- In `document` context: no `pointerEvents: "none"`, no `nodrag`/`nopan` classes, full interactivity
- In `canvas` context: preserves existing behavior
- Passes `showToolbar={false}` in document mode (or a different toolbar later)

The actual renderer components (`ChartRenderer`, `TableRenderer`, `MetricRenderer`, etc.) stay in `src/components/canvas/card-renderers/` — they're already clean. Only the dispatcher and wrapper styles change.

**Extract chart inference:**

Move chart type + ChartSpec inference from `/api/canvas-query/route.ts` into `src/lib/chart-inference.ts`:
```typescript
export function inferCardType(columns: string[], rows: Record<string, unknown>[]): CardType
export function inferChartSpec(columns: string[], rows: Record<string, unknown>[], title: string): ChartSpec | null
```

**Files changed:**
- `src/components/board/card-renderer.tsx` — NEW, shared card dispatcher
- `src/lib/chart-inference.ts` — NEW, extracted from canvas-query route
- `src/components/canvas/shapes/card-content.tsx` — refactor to delegate to shared renderer
- `src/app/api/canvas-query/route.ts` — import inference from shared module

### Phase 3: Document View Component

**New component: `src/components/board/document-view.tsx`**

The main scrollable document renderer:

```
DocumentView ({ boardId })
├── BoardHeader — board name, description
├── TimeFilterBar — global time range presets + custom picker
├── BoardSection[] — one per section, sorted by order
│   ├── SectionHeader — title (h2) + collapse toggle
│   ├── SectionProse — markdown prose block (read-only for v1)
│   └── SectionCardGrid — responsive grid based on section.layout
│       └── DocumentCard[] — card renderer in document context
│           ├── CardHeader (title, type icon)
│           └── CardBody (chart/table/metric/text renderer)
├── AddSectionInput — "+ Add section" with NL input
└── DataQualityCallout — optional, from critique agent
```

**Section layouts (CSS grid):**
- `full`: `grid-cols-1`, card takes full container width
- `grid-2`: `grid-cols-1 md:grid-cols-2`, two cards side by side
- `grid-3`: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, three cards (metric row)

**Card sizing in document view:**
- Charts: aspect ratio ~16:10, full grid cell width
- Metrics: compact, fixed height ~120px
- Tables: auto-height based on row count (max 10 visible, scroll for more)
- Text: auto-height, prose styling

**Responsive behavior:**
- Max content width: `max-w-5xl mx-auto` (~64rem / 1024px)
- Below `md` breakpoint: all layouts collapse to single column
- Padding: `px-6 py-8` on container

**Interactions:**
- Hover card → subtle border highlight
- Click section header → collapse/expand (CSS grid 0fr→1fr transition, reuse existing pattern)
- "+ Add section" → text input appears, submit fires NL→section generation

**Files:**
- `src/components/board/document-view.tsx` — NEW, main document renderer
- `src/components/board/section-renderer.tsx` — NEW, single section (header + prose + grid)
- `src/components/board/section-card-grid.tsx` — NEW, responsive card grid
- `src/components/board/document-card.tsx` — NEW, card wrapper for document context
- `src/components/board/time-filter-bar.tsx` — NEW, global time filter
- `src/components/board/add-section-input.tsx` — NEW, NL section creation input
- `src/components/board/board-header.tsx` — NEW, board title + description

### Phase 4: View Toggle + Board List

**Modify `canvas-page.tsx`:**

Add a view mode toggle and conditional rendering:

```tsx
// canvas-page.tsx
const board = getBoard(resolvedBoardId);
const viewMode = board?.viewMode ?? "document";

return (
  <div>
    <CanvasTopBar
      boardId={resolvedBoardId}
      viewMode={viewMode}
      onToggleView={() => updateBoardViewMode(resolvedBoardId, newMode)}
    />
    {viewMode === "document" ? (
      <DocumentView boardId={resolvedBoardId} />
    ) : (
      <TldrawCanvas boardId={resolvedBoardId} ... />
    )}
  </div>
);
```

**Board list (when no board selected):**

New component `src/components/board/board-list.tsx` shown when `resolvedBoardId` is null:
- Lists all boards for the active dataset via `getBoardSummaries(datasetId)`
- Each item: board name, card count, last updated, view mode icon
- "New Board" button → options: Blank, From Template
- Click board → navigates to `?board={id}`

**Top bar component `src/components/board/canvas-top-bar.tsx`:**
- Board name (editable on click)
- View toggle: `[📄 Document] [🔲 Canvas]` — pill-style toggle
- Time filter (only in document view)
- Board picker (breadcrumb or dropdown to switch boards)

**Files:**
- `src/components/canvas/canvas-page.tsx` — add view mode conditional, top bar
- `src/components/board/board-list.tsx` — NEW, board list page
- `src/components/board/canvas-top-bar.tsx` — NEW, shared top bar

### Phase 5: Research → Board Conversion

**"Save as Board" button:**

Add to `src/components/chat/research-report.tsx` alongside the existing "View Report" button:

```tsx
<Button onClick={handleSaveAsBoard}>Save as Board</Button>
```

**Conversion function: `src/lib/board-converter.ts`**

```typescript
export async function convertResearchToBoard(
  message: ChatMessage,
  datasetId: string
): Promise<string>  // returns boardId
```

**Steps:**
1. Create a new `Board` with `viewMode: "document"`
2. Create "Summary" section (order 0) with:
   - Title: AI-generated from the original question (or just the question)
   - Prose: `message.content` (the synthesis text)
   - Layout: `full`
3. For each subagent (skip `data-quality`, `critique`):
   - Create a `BoardSection` with:
     - Title: prettified agent name (e.g., "daily-metrics" → "Daily Metrics")
     - Prose: `subagent.summary`
     - Layout: auto-inferred from card count (1 card → `full`, 2 → `grid-2`, 3 → `grid-3`)
   - For each query with data:
     - Use `inferCardType(columns, rows)` to determine card type
     - If chartable: use `inferChartSpec(columns, rows, description)` to generate ChartSpec
     - Create `BoardCard` with appropriate type, data, and sectionId
   - For queries without data (old conversations): create a `sql` card with the SQL text as a fallback
4. If critique agent exists, append its findings to the Summary section prose as a callout
5. Save all to board-store
6. Return boardId

**Toast with link:**
After conversion, show a toast: "Board created" with a "View Board" link that navigates to `/canvas?board={id}`.

**Double-click protection:** Disable the button after first click, re-enable if conversion fails.

**Files:**
- `src/lib/board-converter.ts` — NEW, research → board conversion logic
- `src/components/chat/research-report.tsx` — add "Save as Board" button
- `src/hooks/use-analytics.ts` — ensure `QueryInfo.columns` and `QueryInfo.data` are populated

### Phase 6: Global Time Filter

**Time filter bar component: `src/components/board/time-filter-bar.tsx`**

Preset buttons: `7D | 30D | 90D | 1Y | Custom`

On change:
1. Update `board.globalTimeRange` in store
2. Collect all `BoardCard` with `sql` field
3. For each, wrap SQL in date-filtered CTE:
   ```sql
   WITH _source AS ({original_sql})
   SELECT * FROM _source
   WHERE {dateField} >= '{start}' AND {dateField} < '{end}'
   ```
   where `dateField` comes from `DatasetConfig.dateField`
4. Execute all queries in parallel via `POST /api/query` (existing endpoint)
5. Update card data + chartSpec (re-infer if data shape changed)
6. Show loading state per-card during execution (skeleton shimmer)

**Loading states:**
- Individual card skeletons while their query is running
- A subtle progress indicator in the time filter bar ("Updating 12/17...")
- Cards update one-by-one as results return (not batch)

**Files:**
- `src/components/board/time-filter-bar.tsx` — NEW
- `src/lib/board-refresh.ts` — NEW, time-filter SQL wrapping + batch execution logic
- `src/components/board/document-card.tsx` — add loading skeleton state

### Phase 7: Board Templates

**Template definitions: `src/lib/board-templates.ts`**

```typescript
interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  sections: BoardTemplateSectionDef[];
}

interface BoardTemplateSectionDef {
  title: string;
  description: string;  // NL description for AI SQL generation
  layout: "full" | "grid-2" | "grid-3";
  cardDefs: BoardTemplateCardDef[];
}

interface BoardTemplateCardDef {
  type: "chart" | "metric" | "table";
  nlQuery: string;  // NL description → AI generates SQL
}
```

**Built-in templates:**

1. **"Overview Dashboard"**
   - Section: "Key Metrics" (grid-3) — 3 metric cards: total revenue, total users, conversion rate
   - Section: "Trends" (full) — 1 line chart: daily revenue + users over time
   - Section: "Top Categories" (grid-2) — 1 bar chart: revenue by category, 1 table: top 10 products

2. **"Funnel Analysis"**
   - Section: "Conversion Funnel" (full) — 1 chart: event type funnel
   - Section: "Drop-off Analysis" (grid-2) — 1 bar chart: drop-off by step, 1 table: drop-off reasons
   - Section: "Funnel Trends" (full) — 1 line chart: conversion rate over time

3. **"Retention & Cohorts"**
   - Section: "Retention Overview" (grid-2) — 1 metric: 30-day retention rate, 1 chart: retention curve
   - Section: "Cohort Analysis" (full) — 1 table: cohort retention grid
   - Section: "Repeat Behavior" (grid-2) — 1 chart: purchase frequency distribution, 1 metric: repeat rate

4. **"User Segments"**
   - Section: "Segment Overview" (grid-3) — 3 metrics: power users, casual, dormant counts
   - Section: "Engagement Distribution" (full) — 1 chart: engagement tier breakdown
   - Section: "Revenue by Segment" (grid-2) — 1 bar chart: revenue per segment, 1 table: segment details

**Template execution flow:**
1. User selects template from board list "New Board" → "From Template"
2. For each `BoardTemplateCardDef.nlQuery`, call `/api/canvas-query` (existing NL→SQL→execute pipeline) adapted for single-card generation
3. Or: batch all NL queries into a single Gemini call that returns SQL for all cards, then execute in parallel
4. Infer chart specs from results
5. Create board with sections and cards
6. Open in document view

**Template picker UI:** Modal or inline in board-list with template cards showing name + description + preview icon.

**Dataset compatibility:** Templates use NL queries, not raw SQL. The Gemini call receives the dataset's `schemaContext`, so it generates appropriate SQL for any dataset. If a query makes no sense for the dataset (e.g., "revenue" on a dataset with no revenue column), the AI either adapts or the query returns 0 rows → card shows "No data" state.

**Files:**
- `src/lib/board-templates.ts` — NEW, template definitions + execution logic
- `src/components/board/template-picker.tsx` — NEW, template selection UI
- `src/components/board/board-list.tsx` — wire up "From Template" flow

### Phase 8: Add Section (NL → Section Generation)

The "+ Add section" input at the bottom of the document view:

1. User types NL question (e.g., "Show me retention by cohort")
2. Call `/api/canvas-query` with the question (existing pipeline)
3. Stream returns plan + card data + chart specs
4. Create a new `BoardSection` with:
   - Title: from the plan's first card title or AI-generated
   - Prose: brief AI summary (from text card if generated, or a quick Gemini call)
   - Layout: inferred from card count
5. Create `BoardCard` entries with `sectionId` set
6. Append section to board (order = max existing order + 1)
7. Scroll to new section

This reuses the existing canvas stream pipeline (`useCanvasStream`) but routes output to the document view's section model instead of tldraw shapes.

**Files:**
- `src/components/board/add-section-input.tsx` — input UI
- `src/components/board/use-document-stream.ts` — NEW, adapts canvas stream for document sections

## Acceptance Criteria

### Phase 1 (Data Model)
- [ ] `BoardSection` type added to `board-types.ts`
- [ ] `Board` extended with `viewMode` and `globalTimeRange`
- [ ] `BoardCard` extended with `sectionId` and `orderInSection`
- [ ] `QueryInfo` extended with `columns` and `data`
- [ ] Section CRUD functions in `board-store.ts` with localStorage persistence
- [ ] `use-analytics.ts` populates `QueryInfo.data` from SSE events (capped 50 rows)

### Phase 2 (Renderer Extraction)
- [ ] `src/components/board/card-renderer.tsx` dispatches cards in both `canvas` and `document` contexts
- [ ] `src/lib/chart-inference.ts` exports `inferCardType` and `inferChartSpec`
- [ ] Canvas view continues to work unchanged after refactor
- [ ] Card renderers are interactive in document context (no pointer-events block)

### Phase 3 (Document View)
- [x] Scrollable document view renders sections with headings, prose, and card grids
- [x] Three layout modes work: `full`, `grid-2`, `grid-3`
- [x] Responsive: collapses to single column below `md` breakpoint
- [x] Section collapse/expand with smooth transition
- [x] Cards render correctly (charts, tables, metrics, text) in document context
- [x] Empty state for boards with no sections

### Phase 4 (View Toggle + Board List)
- [x] View toggle in top bar switches between document and canvas
- [x] Board list shows when no board selected
- [x] "New Board" creates a blank board in document mode
- [ ] URL params `?board=` and `?view=` work correctly
- [x] Board name display in top bar

### Phase 5 (Research → Board)
- [ ] "Save as Board" button appears on completed deep research messages
- [ ] Converts research agents → sections with prose and cards
- [ ] Chart inference produces correct card types from query data
- [ ] Toast with "View Board" link appears after creation
- [ ] Button disabled while conversion is in progress
- [ ] Works for old conversations (falls back to sql cards if no data stored)

### Phase 6 (Time Filter)
- [ ] Time filter bar with presets: 7D, 30D, 90D, 1Y, Custom
- [ ] Changing filter re-executes all SQL cards with date-wrapped CTE
- [ ] Per-card loading skeletons during execution
- [ ] Progress indicator in filter bar
- [ ] Cards update as results return

### Phase 7 (Templates)
- [ ] 4 built-in templates defined
- [ ] Template picker accessible from board list "New Board"
- [ ] Template execution generates SQL via Gemini, executes, infers charts
- [ ] Resulting board opens in document view with all sections populated
- [ ] Graceful handling of no-data results (empty state per card)

### Phase 8 (Add Section)
- [ ] "+ Add section" input at bottom of document view
- [ ] NL query → section with cards via canvas stream pipeline
- [ ] New section appended with auto-inferred layout
- [ ] Scroll to new section after creation

## Implementation Order

```
Phase 1 (Data Model)           ← foundation, everything depends on this
  ↓
Phase 2 (Renderer Extraction)  ← unblocks Phase 3
  ↓
Phase 3 (Document View)        ← core deliverable
  ↓
Phase 4 (View Toggle + List)   ← makes it navigable
  ↓
Phase 5 (Research → Board)     ← the killer feature
  ↓
Phase 6 (Time Filter)          ← dynamic metric tracking
  ↓
Phase 7 (Templates)            ← onboarding + quick start
  ↓
Phase 8 (Add Section)          ← progressive board building
```

Phases 1-4 are the MVP. Phases 5-8 can ship incrementally after.

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-13-board-document-view-brainstorm.md](../brainstorms/2026-03-13-board-document-view-brainstorm.md)
- **Mixpanel Board screenshots:** `/Users/vimarsh/Downloads/Images/screencapture-mixpanel-*`
- **Board types:** `src/lib/board-types.ts`
- **Board store:** `src/lib/board-store.ts` (seed pattern at line 536)
- **Card renderers:** `src/components/canvas/card-renderers/` (10 renderers, reusable)
- **Card content dispatcher:** `src/components/canvas/shapes/card-content.tsx`
- **Canvas page:** `src/components/canvas/canvas-page.tsx`
- **Deep research types:** `src/lib/types.ts` (AgentInfo, SubagentInfo, QueryInfo)
- **Analytics hook:** `src/hooks/use-analytics.ts` (SSE event handling)
- **Chart types:** `src/lib/chart-types.ts` (ChartSpec)
- **Canvas stream:** `src/components/canvas/use-canvas-stream.ts`
- **Dataset config:** `src/lib/datasets/types.ts` (DatasetConfig.dateField)
- **Learnings:** `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usememo-*.md` (useEffect for localStorage, not useMemo)
- **Learnings:** `docs/solutions/database-issues/duckdb-connection-leak-*.md` (singleton connection pattern)
