---
title: "feat: Configurable Board Cards"
type: feat
status: completed
date: 2026-03-13
---

# Configurable Board Cards

## Overview

Make board document view cards fully configurable: add new cards via a type picker popover, resize cards via colSpan (1/2/3), drag-reorder cards within and across sections, and drag-reorder entire sections. The goal is a Notion/Mixpanel-grade dashboard editing experience where every block is movable, resizable, and replaceable.

## Problem Statement

Board document view is currently read-only after generation. Users can delete cards and sections but cannot add new cards, resize them, reorder them, or restructure sections. The ghost placeholder `+` is non-functional. This limits boards to whatever the AI generates — no customization, no iteration.

## Proposed Solution

Four interconnected features, built in phases:

1. **Block type picker** — click `+` to add Metric / Chart / Table / Insight cards
2. **Card resize** — per-card `colSpan: 1 | 2 | 3` with drag handle
3. **Card drag-reorder** — within and across sections via @dnd-kit
4. **Section drag-reorder** — reorder entire sections via @dnd-kit

All features operate on the existing `BoardCard` and `BoardSection` data model with minimal type additions.

---

## Data Model Changes

### BoardCard additions

```typescript
// src/lib/board-types.ts
export interface BoardCard {
  // ... existing fields ...
  colSpan?: 1 | 2 | 3; // NEW — defaults to 1 if undefined
}
```

### SectionLayout removal

Remove the `SectionLayout` type and `BoardSection.layout` field. All sections become a standardized 3-column grid. Per-card `colSpan` replaces section-level layout control.

```typescript
// REMOVE:
// export type SectionLayout = "full" | "grid-2" | "grid-3";

export interface BoardSection {
  id: string;
  boardId: string;
  title: string;
  prose: string;
  // layout: SectionLayout;  ← REMOVE
  order: number;
  collapsed: boolean;
}
```

### Migration

Bump `STORAGE_VERSION` from 5 → 6 in `board-store.ts`. This wipes existing localStorage boards on next load (acceptable for prototype). No migration function needed.

### orderInSection

Make `orderInSection` effectively required — all card creation and reorder operations must set it. Reindex densely (0, 1, 2, ...) after every mutation. The card count per section is small (typically < 10), so reindexing all cards in a section on every reorder is fine.

---

## Phase 1: Card Resize (colSpan)

**Goal:** Each card can span 1, 2, or 3 columns in the grid. Resize via a drag handle with ghost outline preview.

### 1.1 Grid Standardization

**File: `src/components/board/section-card-grid.tsx`**

Replace the current `layoutClasses` map with a single 3-column grid:

```typescript
// BEFORE:
const layoutClasses: Record<SectionLayout, string> = {
  full: "grid grid-cols-1 gap-4",
  "grid-2": "grid grid-cols-1 md:grid-cols-2 gap-4",
  "grid-3": "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",
};

// AFTER:
const GRID_CLASS = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4";
```

Remove the `layout` prop from `SectionCardGrid`. Each card gets a style based on `colSpan`:

```typescript
// Per-card wrapper
<div
  key={card.id}
  className="rounded-md"
  style={{
    gridColumn: `span ${card.colSpan ?? 1}`,
    height: autoHeight ? "auto" : h,
    minHeight: autoHeight ? h : undefined,
  }}
>
```

**Responsive clamping:** At `sm` breakpoint (2 columns), `colSpan: 3` should clamp to `span 2`. At mobile (1 column), all cards become `span 1`. Use CSS `min()`:

```css
/* globals.css */
@media (max-width: 640px) {
  .board-card-span { grid-column: span 1 !important; }
}
@media (min-width: 640px) and (max-width: 1024px) {
  .board-card-span-3 { grid-column: span 2 !important; }
}
```

Or handle via a utility function that returns the appropriate `gridColumn` value based on a CSS class approach.

### 1.2 Resize Drag Handle

**New file: `src/components/board/resize-handle.tsx`**

A small icon in the bottom-right corner of each card (hover-reveal, like the delete X pattern):

```
opacity-0 group-hover/card:opacity-100
```

**Interaction model:**

1. `onPointerDown` on handle → capture initial pointer X, initial colSpan, compute column width from grid container
2. `onPointerMove` → compute delta X, determine target colSpan (1/2/3) based on nearest column boundary
3. Render a **ghost outline** (absolute-positioned div with dashed border) showing the target size. The outline snaps to column boundaries.
4. `onPointerUp` → commit: call `saveBoardCard({ ...card, colSpan: targetSpan })`, remove ghost, trigger re-render

**Ghost outline rendering:** An absolutely positioned overlay div matching the target grid span width and card height, with `border: 2px dashed var(--border)` and `bg-muted/20`. Positioned relative to the card's grid cell.

**Column width calculation:** On pointer down, measure the grid container's width and divide by 3 to get column width. Account for gap (16px = gap-4). Formula: `colWidth = (containerWidth - 2 * gap) / 3`.

### 1.3 Store Integration

Update `saveBoardCard` call on resize commit. No new store functions needed — `saveBoardCard` already accepts partial updates via spread.

### Files Changed (Phase 1)

| File | Change |
|------|--------|
| `src/lib/board-types.ts` | Add `colSpan?: 1 \| 2 \| 3` to BoardCard, remove `SectionLayout`, remove `layout` from BoardSection |
| `src/lib/board-store.ts` | Bump `STORAGE_VERSION` to 6, remove `layout` references in demo seed |
| `src/components/board/section-card-grid.tsx` | Standardize to 3-col grid, apply `gridColumn: span N` per card, remove `layout` prop |
| `src/components/board/section-renderer.tsx` | Remove `layout` prop pass-through to SectionCardGrid |
| `src/components/board/document-view.tsx` | Remove `layout` references |
| `src/components/board/resize-handle.tsx` | **NEW** — drag handle component with ghost outline |
| `src/components/board/card-renderer.tsx` | Wrap card in `group/card` container with resize handle |
| `src/app/api/board-generate/route.ts` | Remove `layout` from generated sections, add `colSpan` to generated cards |
| `src/app/api/board-from-research/route.ts` | Same: remove `layout`, add `colSpan` |

---

## Phase 2: Card & Section Drag-Reorder

**Goal:** Drag cards to reorder within a section, across sections, and drag entire sections up/down.

### 2.1 dnd-kit Setup

@dnd-kit is already installed (`@dnd-kit/core` v6.3.1, `@dnd-kit/sortable` v10.0.0). Existing usage in `forecast-table.tsx` provides a reference pattern.

**Architecture:** Single `DndContext` at the board level (inside `DocumentView`), with nested `SortableContext` instances:

- One `SortableContext` for **sections** (vertical list sorting)
- One `SortableContext` per **section** for its cards (grid sorting)

This enables both section reorder and cross-section card drag from a single DndContext.

### 2.2 Card Drag Handle

**File: `src/components/board/card-renderer.tsx`**

Add a grip icon in the **top-left corner** of each card (hover-reveal, mirrors the delete X in top-right):

```
opacity-0 group-hover/card:opacity-100
```

Icon: `GripVertical` from lucide-react (6 dots). This element gets the `{...listeners, ...attributes}` from `useSortable()`.

The rest of the card surface remains interactive (chart clicks, table scrolling, text selection work normally).

### 2.3 Card Reorder Within Section

Each card in `SectionCardGrid` wrapped with `useSortable({ id: card.id })`. The sortable context uses the card IDs in order.

**Drop indicator:** A thin horizontal line (2px, `bg-foreground/20`) between cards at the drop target position. dnd-kit's `DragOverlay` shows a semi-transparent clone of the dragged card.

**On drop:** Reindex all cards in the section with dense `orderInSection` values (0, 1, 2, ...) based on the new order from dnd-kit. Call `saveBoardCard()` for each changed card.

### 2.4 Card Reorder Across Sections

When a card is dragged over a different section's `SortableContext`, dnd-kit fires `onDragOver` with the target container ID. On `onDragEnd`:

1. Update the card's `sectionId` to the target section
2. Reindex `orderInSection` in both source and target sections
3. Call `saveBoardCard()` for each affected card

**Collapsed sections do NOT accept drops.** The drop zone is only active when a section is expanded. dnd-kit's `useDroppable` can be conditionally disabled based on `collapsed` state.

**Empty section drop zone:** When a section has no cards, render a minimal drop target area (dashed border, "Drop card here" text) so cards can be dragged into empty sections.

### 2.5 Section Reorder

Sections are wrapped in their own `SortableContext` with `verticalListSortingStrategy`. Each `SectionRenderer` uses `useSortable({ id: section.id })`.

**Drag handle:** A grip icon on the section header row (left of the chevron), hover-reveal with `group-hover/section:opacity-100`.

**On drop:** Call existing `reorderSections(boardId, newSectionIds)` from the board store.

### 2.6 DndContext Configuration

```typescript
<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
>
  <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
    {sections.map(section => (
      <SortableSection key={section.id} section={section}>
        <SortableContext items={cardIds} strategy={rectSortingStrategy}>
          {cards.map(card => (
            <SortableCard key={card.id} card={card} />
          ))}
        </SortableContext>
      </SortableSection>
    ))}
  </SortableContext>
  <DragOverlay>
    {activeItem && <DragOverlayRenderer item={activeItem} />}
  </DragOverlay>
</DndContext>
```

**Sensors:** `PointerSensor` with `activationConstraint: { distance: 5 }` to prevent accidental drags on click. `KeyboardSensor` with `coordinateGetter: sortableKeyboardCoordinates` for accessibility.

### Files Changed (Phase 2)

| File | Change |
|------|--------|
| `src/components/board/document-view.tsx` | Wrap in DndContext, add drag handlers, DragOverlay |
| `src/components/board/section-renderer.tsx` | Wrap with useSortable, add section grip handle |
| `src/components/board/section-card-grid.tsx` | Wrap with SortableContext, empty section drop zone |
| `src/components/board/card-renderer.tsx` | Add grip handle (top-left), wrap with useSortable |
| `src/components/board/sortable-card.tsx` | **NEW** — wrapper component connecting card to dnd-kit |
| `src/components/board/drag-overlay-renderer.tsx` | **NEW** — renders dragged card/section preview |
| `src/lib/board-store.ts` | Add `reindexCardsInSection(boardId, sectionId, orderedCardIds)` helper |

---

## Phase 3: Block Type Picker (the + button)

**Goal:** Three trigger points open a popover with 4 card type options. Each option leads to a card creation flow.

### 3.1 Type Picker Popover

**New file: `src/components/board/card-type-picker.tsx`**

A Radix Popover (existing `src/components/ui/popover.tsx`) with 4 options rendered as a compact vertical list:

| Icon | Label | Description |
|------|-------|-------------|
| `Hash` | Metric | Pick from dataset metrics |
| `BarChart3` | Chart | Visualize with a question |
| `Table` | Table | Query as a data table |
| `FileText` | Insight | AI-generated analysis |

Each option is a button. Clicking one either:
- Opens an inline sub-view inside the popover (Metric picker), or
- Closes the popover and replaces the trigger with an inline input (Chart/Table), or
- Immediately starts generation (Insight — no input needed)

**Popover styling:** Monochrome, `w-56`, each item is a row with icon + label + subtle description. Hover state: `bg-muted`. Matches existing shadcn popover conventions.

### 3.2 Trigger Point 1: Between-Row Divider

**New file: `src/components/board/row-divider.tsx`**

A hover-reveal `+` button that appears **between rows** of cards in the grid.

**Implementation:** After each logical row in the grid, insert an invisible hover zone (8px tall, full width). On hover, it expands to show a thin line with a centered `+` circle button:

```
<div className="relative h-2 -my-1 group/divider">
  <div className="absolute inset-x-0 top-1/2 h-px bg-border opacity-0 group-hover/divider:opacity-100" />
  <button className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover/divider:opacity-100 ...">
    <Plus size={14} />
  </button>
</div>
```

**Row boundary detection:** Since we're in a CSS grid, we need to compute which cards end a row. Given the 3-column grid and each card's `colSpan`, walk through cards in order, accumulating colSpan until it exceeds 3 (new row starts). Insert a `RowDivider` component after each row group.

This logic lives in `SectionCardGrid` and is computed as a `useMemo`:

```typescript
function computeRows(cards: BoardCard[]): BoardCard[][] {
  const rows: BoardCard[][] = [];
  let currentRow: BoardCard[] = [];
  let currentSpan = 0;
  for (const card of cards) {
    const span = card.colSpan ?? 1;
    if (currentSpan + span > 3 && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [card];
      currentSpan = span;
    } else {
      currentRow.push(card);
      currentSpan += span;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
}
```

Each `RowDivider`'s `+` click opens the `CardTypePicker` popover. The insertion position is the `orderInSection` of the first card in the next row (new card is inserted before that row).

### 3.3 Trigger Point 2: End of Section

A persistent `+` button at the bottom of each section's card grid. Same visual as `RowDivider` but always visible (not hover-reveal) with subtle styling:

```
<button className="flex items-center gap-2 text-sm text-muted-foreground/50 hover:text-muted-foreground ...">
  <Plus size={14} /> Add card
</button>
```

Click opens `CardTypePicker`. New card appends at `maxOrderInSection + 1`.

### 3.4 Trigger Point 3: Ghost Placeholder

Update `GhostPlaceholder` to accept an `onClick` that opens `CardTypePicker`. The placeholder becomes the popover trigger. New card takes the deleted card's position (same `orderInSection` and `sectionId`). Ghost placeholder disappears after card creation.

### 3.5 Metric Card Creation (instant)

When user picks "Metric" from the popover:

1. Popover content switches to a **searchable metric list**. Shows dataset's `MetricDefinition[]` fetched from `/api/metrics` (or from client metric store if already loaded).
2. Each row: metric name, category badge, value format hint.
3. User clicks a metric → card created instantly:

```typescript
const newCard: BoardCard = {
  id: `card-${Date.now()}-${randomSuffix}`,
  boardId,
  type: "metric",
  title: metric.name,
  metricId: metric.id,
  sql: metric.valueSql,
  heroMetric: undefined, // computed on next refresh
  colSpan: 1,
  sectionId,
  orderInSection,
  // ... standard defaults
};
saveBoardCard(newCard);
```

Then trigger a refresh to compute the metric value (call existing refresh logic or inline execute the `valueSql`).

### 3.6 Chart / Table Card Creation (NL input)

**New file: `src/app/api/board-card-generate/route.ts`**

Lightweight API endpoint for single-card generation:

**Request:**
```typescript
POST /api/board-card-generate
{
  query: string;          // NL question
  forceType?: "table";    // omit for auto-infer (chart/metric/table)
}
// Headers: x-dataset-id, x-model-id (via apiFetch)
```

**Response:**
```typescript
{
  type: CardType;         // inferred or forced
  title: string;          // from SQL description
  sql: string;
  data: Record<string, unknown>[];
  columns: string[];
  chartSpec?: ChartSpec;  // only for chart type
  heroMetric?: string;    // only for metric type
  heroDelta?: string;
}
```

**Implementation:** Reuses existing `generateQueries()` (quick mode, single query), `executeSQL()`, `inferCardType()`, `inferChartSpec()`. Includes retry-on-error via `retryWithError()`. Single JSON response (not streaming) — the operation is fast enough (2-5 seconds).

**Frontend flow:**

1. User picks "Chart" or "Table" → popover closes
2. Trigger point (divider/ghost/end-of-section) becomes an **inline input field**: text input + "Create" button + Escape to cancel
3. User types question, hits Enter
4. Input replaced by a **shimmer skeleton** at the target position (card-sized placeholder with subtle animation)
5. On success: skeleton replaced with real card
6. On error: skeleton replaced with error message + "Retry" button + "Cancel" link

### 3.7 Insight Card Creation (context-aware)

**New file: `src/app/api/board-card-insight/route.ts`**

LLM generates a supporting analysis paragraph based on sibling cards in the section.

**Request:**
```typescript
POST /api/board-card-insight
{
  siblingCards: Array<{
    title: string;
    type: CardType;
    sql?: string;
    heroMetric?: string;
    heroDelta?: string;
    data?: Record<string, unknown>[]; // capped at 10 rows
  }>;
  sectionTitle: string;
  boardName: string;
}
// Headers: x-dataset-id, x-model-id
```

**Response:**
```typescript
{
  content: string;  // markdown text
  title: string;    // short title for the card
}
```

**Prompt strategy:** Send sibling card context (titles, key values, sample data rows) and ask the LLM to write a concise analytical insight (2-4 sentences) that connects or explains the data shown by the neighboring cards. Cap input to prevent token overflow: max 10 rows per sibling card, max 6 sibling cards.

**Frontend flow:**

1. User picks "Insight" → no input needed
2. Trigger point becomes a shimmer skeleton immediately
3. API call with sibling card context
4. On success: text card with `markdownContent` from LLM
5. On error: error state with retry

**Edge case — empty section:** If the section has no other cards, the Insight option is **disabled** in the popover (grayed out with tooltip: "Add other cards first").

### Files Changed (Phase 3)

| File | Change |
|------|--------|
| `src/components/board/card-type-picker.tsx` | **NEW** — popover with 4 card type options |
| `src/components/board/metric-picker.tsx` | **NEW** — searchable metric list sub-view |
| `src/components/board/inline-card-input.tsx` | **NEW** — NL text input for Chart/Table creation |
| `src/components/board/row-divider.tsx` | **NEW** — hover-reveal `+` between grid rows |
| `src/components/board/ghost-placeholder.tsx` | Add onClick → open CardTypePicker |
| `src/components/board/section-card-grid.tsx` | Compute row boundaries, insert RowDividers, add trailing `+` |
| `src/components/board/section-renderer.tsx` | Pass section context for insight generation |
| `src/components/board/document-view.tsx` | Add card creation handlers, shimmer state management |
| `src/app/api/board-card-generate/route.ts` | **NEW** — NL → SQL → execute → card data |
| `src/app/api/board-card-insight/route.ts` | **NEW** — sibling-aware LLM insight generation |

---

## Phase 4: Integration & Polish

### 4.1 Interaction Between Resize and Drag

- Resize handle (bottom-right) and drag handle (top-left) are separate elements — no conflict
- During a drag operation, resize handles are hidden (the card is in DragOverlay)
- During a resize operation, drag is disabled (pointer is captured by resize handle)

### 4.2 Re-render Strategy

The board store is not reactive. After any mutation (resize, reorder, card creation, deletion):

- Call `setRefreshKey(k => k + 1)` to force DocumentView to re-read from store
- dnd-kit manages its own drag state internally — only need to sync to store on `onDragEnd`

For drag operations, batch all `saveBoardCard()` calls (reindexing multiple cards) before triggering the re-render.

### 4.3 Card Height Behavior with ColSpan

Card heights remain fixed per type via `CARD_HEIGHTS`. A `colSpan: 3` chart card is full-width at 420px height — wider but same height. This matches how dashboard tools like Mixpanel and Grafana work (width varies, height is fixed per visualization type).

Exception: `text` and `report` cards remain `height: auto` with `minHeight` — they grow to fit content regardless of colSpan.

### 4.4 CompactMetricCard at Wider ColSpan

When a metric card has `colSpan: 2` or `3`, the `CompactMetricCard` component stretches horizontally. The current layout (dot + title, value + sparkline) works fine at wider sizes — the sparkline just gets more horizontal space. No renderer changes needed.

### 4.5 Board Generation Updates

Both `/api/board-generate` and `/api/board-from-research` need to:
- Stop emitting `layout` on sections
- Start emitting `colSpan` on cards (default 1, with some cards at 2 or 3 based on LLM judgment)

Update the LLM prompts in both routes to include `colSpan` in the output schema.

---

## Acceptance Criteria

### Phase 1: Card Resize
- [ ] `colSpan` field on BoardCard (1/2/3, default 1)
- [ ] All sections render as 3-column grid
- [ ] Bottom-right resize handle appears on card hover
- [ ] Dragging handle shows ghost outline snapping to 1x/2x/3x
- [ ] Dropping commits the new colSpan to store
- [ ] CSS grid reflows siblings naturally on resize
- [ ] Responsive: colSpan 3 clamps to 2 at `sm`, all clamp to 1 on mobile
- [ ] `SectionLayout` type removed, no regressions in section rendering

### Phase 2: Drag-Reorder
- [ ] Card drag handle (top-left grip icon) appears on hover
- [ ] Cards can be dragged to reorder within a section
- [ ] Cards can be dragged into a different (expanded) section
- [ ] Drop indicator (thin line) shows insertion point
- [ ] DragOverlay shows semi-transparent card preview
- [ ] Sections can be dragged to reorder via header grip handle
- [ ] Collapsed sections reject card drops
- [ ] Empty sections show a drop zone
- [ ] All reorders persist to localStorage via board store
- [ ] orderInSection reindexed densely after every mutation

### Phase 3: Block Type Picker
- [ ] Popover with 4 options: Metric, Chart, Table, Insight
- [ ] Between-row divider `+` appears on hover between card rows
- [ ] Persistent `+` at end of each section
- [ ] Ghost placeholder `+` opens the same popover
- [ ] Metric: searchable picker → instant card creation
- [ ] Chart: inline NL input → API → chart card with shimmer loading
- [ ] Table: inline NL input → API → table card (forced type)
- [ ] Insight: immediate API call → text card from sibling context
- [ ] Insight disabled when section has no other cards
- [ ] Error states with retry for Chart/Table/Insight
- [ ] New cards get correct sectionId and orderInSection

### Phase 4: Integration
- [ ] Resize and drag handles don't conflict
- [ ] Board generation APIs emit colSpan, no layout field
- [ ] STORAGE_VERSION bumped to 6
- [ ] No regressions in existing board functionality (delete, collapse, prose, canvas view toggle)

---

## Implementation Order

```
Phase 1 (Card Resize)
├── 1.1 Data model: add colSpan, remove SectionLayout, bump version
├── 1.2 Grid standardization: 3-col grid, gridColumn: span N
├── 1.3 Resize handle component with ghost outline
└── 1.4 Update board generation APIs

Phase 2 (Drag-Reorder)
├── 2.1 DndContext + SortableContext wiring in DocumentView
├── 2.2 Card drag handle + SortableCard wrapper
├── 2.3 Card reorder within section (orderInSection reindex)
├── 2.4 Card reorder across sections (sectionId change)
├── 2.5 Section drag-reorder
└── 2.6 DragOverlay + drop indicators

Phase 3 (Block Type Picker)
├── 3.1 CardTypePicker popover component
├── 3.2 MetricPicker sub-view
├── 3.3 InlineCardInput for Chart/Table NL flow
├── 3.4 /api/board-card-generate route
├── 3.5 /api/board-card-insight route
├── 3.6 Row divider + end-of-section + ghost placeholder triggers
└── 3.7 Shimmer loading + error states

Phase 4 (Integration & Polish)
├── 4.1 Interaction guards (resize vs drag exclusivity)
├── 4.2 Board generation API updates
└── 4.3 Smoke test all flows end-to-end
```

---

## Technical Considerations

### Performance
- DndContext at board level means all sections participate in drag detection. For large boards (10+ sections, 50+ cards), this could cause drag jank. Mitigation: use `useSortable` with `animateLayoutChanges: () => false` to skip layout animations during rapid reorders.
- `computeRows()` for row divider placement is O(n) per section and runs in `useMemo` — negligible cost.

### Pointer Events
- Card drag handle (top-left) uses `{...listeners, ...attributes}` from dnd-kit — only that element initiates drag
- Rest of card content remains interactive (chart clicks, table scroll, text selection)
- Resize handle captures pointer events independently — uses raw `onPointerDown/Move/Up`, not dnd-kit
- The `doc-card-interactive` CSS class continues to ensure `pointer-events: auto` on card content

### Store Consistency
- After drag-reorder, batch all `saveBoardCard()` calls before the `setRefreshKey()` to avoid intermediate renders
- dnd-kit state is transient — store is updated only on `onDragEnd`, not during drag
- Resize ghost outline is pure React state — no store writes until drop

### Canvas View Sync
- `colSpan` is a document-view concept. Canvas view uses `position` (x, y) and `size` (width, height) which are unrelated. No sync needed.
- `orderInSection` is also document-view only. Canvas positions cards absolutely.

---

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| dnd-kit nested sortable contexts (sections + cards) may have edge cases | Existing forecast-table.tsx proves dnd-kit works in the codebase; test cross-section drag early |
| Resize ghost outline positioning in CSS grid is tricky | Compute column widths from container measurement, not CSS |
| Row boundary computation depends on ordered cards + colSpan arithmetic | Unit-testable pure function, validate with edge cases |
| LLM insight quality depends on sibling card context richness | Cap input, degrade gracefully (disable option for empty sections) |
| STORAGE_VERSION bump wipes boards | Acceptable for prototype; users regenerate boards easily |

---

## Sources & References

### Internal References
- Board types: `src/lib/board-types.ts`
- Board store: `src/lib/board-store.ts`
- Document view: `src/components/board/document-view.tsx`
- Section card grid: `src/components/board/section-card-grid.tsx`
- Card renderer: `src/components/board/card-renderer.tsx`
- Ghost placeholder: `src/components/board/ghost-placeholder.tsx`
- Chart inference: `src/lib/chart-inference.ts`
- Canvas config panel (card editing reference): `src/components/canvas/canvas-config-panel.tsx`
- dnd-kit usage reference: `src/components/forecast/forecast-table.tsx`
- Popover primitive: `src/components/ui/popover.tsx`

### Existing Patterns
- Hover-reveal actions: `group/card` + `opacity-0 group-hover/card:opacity-100` (card-renderer.tsx)
- Named Tailwind groups: `group/card`, `group/section`, `group/prose` (section-renderer.tsx)
- Board store persistence: debounced localStorage writes, STORAGE_VERSION gating (board-store.ts)
- Card type inference: always data-driven via `inferCardType()`, never layout-driven (memory: feedback_card_type_selection.md)

### Key Decisions
- Standardize to 3-col grid, remove section-level layout (discussed in brainstorm)
- Ghost outline for resize preview, not live reflow (user preference for snappiness)
- Horizontal row dividers only, not column dividers (simpler, unambiguous)
- Card drag handle in top-left, resize handle in bottom-right (no conflict)
- Collapsed sections reject card drops (user must expand first)
- Dense orderInSection reindexing on every mutation
- STORAGE_VERSION bump (wipe) for migration
