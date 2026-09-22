---
title: "feat: Canvas tabbed query result card"
type: feat
date: 2026-03-15
brainstorm: docs/brainstorms/2026-03-15-canvas-tabbed-query-result-card-brainstorm.md
---

# feat: Canvas Tabbed Query Result Card

## Overview

When a canvas query runs, it currently emits 3 separate cards — chart, SQL, and table — scattered across the canvas. This clutters the workspace rapidly across follow-up questions. Replace those three with a **single tabbed card** (Chart | SQL | Table) by adding a tab switcher to the existing `chart` card renderer and suppressing the sibling `sql`/`table` shapes from the stream.

Zero data model changes — the `BoardCard` type already stores `chartSpec`, `data`, and `sql` on the same object.

## Problem Statement

Every canvas query emits 3+ cards with tldraw arrows connecting them. After 2–3 follow-ups, the canvas is an unreadable DAG of small cards. The user wants to see the visualization, not the scaffolding.

## Proposed Solution

**Approach A: Tab UI on the existing `chart` card.**

- Add Chart | SQL | Table tabs to `ChartRenderer`
- In `use-canvas-stream.ts`, suppress creating placeholder shapes for `sql` and `table` cards that share a `queryGroupId` with a `chart` card
- Route the `sql` data from the suppressed sql card's stream event onto the chart card instead

Legacy boards with standalone `sql`/`table` cards are unaffected — those renderers remain unchanged.

## Technical Approach

### Files to Change

| File | Change |
|---|---|
| `src/components/canvas/card-renderers/chart-renderer.tsx` | Add tab bar + tab content switching |
| `src/hooks/use-canvas-stream.ts` | Suppress sibling sql/table shapes; route sql data to chart card |
| `src/components/canvas/card-renderers/shared.tsx` | Increase `MIN_CARD_HEIGHT.chart` from 440 → 476 |

### Implementation Steps

#### Step 1 — Restructure `ChartRenderer` with tabs

**Current structure** (simplified):
```tsx
// chart-renderer.tsx — raw content block, no InnerContainer, no header
<div style={{ pointerEvents: "none", width, height }} className="nodrag">
  <ReportChart spec={item.chartSpec} variant="canvas" ... />
</div>
```

**New structure:**
```tsx
// chart-renderer.tsx
const [activeTab, setActiveTab] = useState<"chart" | "sql" | "table">(
  item.chartSpec ? "chart" : "table"
);
const isInteractive = isSelected || isEditing;

<InnerContainer>
  {/* Tab bar — 36px row, only interactive when card is selected */}
  <div
    style={{ pointerEvents: isInteractive ? "all" : "none", borderBottom: "1px solid var(--border)" }}
    className="nodrag nopan nowheel"
  >
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
      <TabsList variant="line" className="h-9 px-2 gap-1 rounded-none border-none bg-transparent">
        {item.chartSpec && (
          <TabsTrigger value="chart">Chart</TabsTrigger>
        )}
        <TabsTrigger value="table">Table</TabsTrigger>
        <TabsTrigger value="sql">SQL</TabsTrigger>
      </TabsList>
    </Tabs>
  </div>

  {/* Content area fills remaining height */}
  <CardBody style={{ flex: 1, minHeight: 0 }}>
    {activeTab === "chart" && item.chartSpec && (
      <ReportChart spec={item.chartSpec} variant="canvas" data={item.data} ... />
    )}
    {activeTab === "table" && (
      <TableContent data={item.data} />  {/* inline table, reuse table-renderer logic */}
    )}
    {activeTab === "sql" && (
      <SqlContent sql={item.sql} />      {/* inline sql, reuse sql-renderer logic */}
    )}
  </CardBody>
</InnerContainer>
```

**Notes on the tab bar:**
- `nodrag nopan nowheel` CSS classes prevent tldraw from intercepting pointer events when the card is selected
- `pointerEvents: isInteractive ? "all" : "none"` matches the three-zone pattern used in every other card renderer
- Use `variant="line"` from the existing shadcn `Tabs` component — the underline style is minimal and doesn't compete with chart content
- Default tab: `"chart"` if `chartSpec` exists, otherwise `"table"` (table-only query graceful degradation)

**TableContent and SqlContent** — do not import `TableRenderer`/`SqlRenderer` directly (they include their own `InnerContainer` + header wrapper which would double-wrap). Extract the inner table/sql display into small local components or inline them directly.

For SQL: a `<pre>` block with the SQL string.
For Table: a scrollable div with a simple `<table>` element (rows from `item.data`).

Keep these simple for V1. Copy the essential rendering from existing renderers, strip the `CardHeader` and `InnerContainer` wrappers.

#### Step 2 — Adjust `MIN_CARD_HEIGHT.chart`

In `src/components/canvas/card-renderers/shared.tsx`:

```ts
// Before
chart: 440,

// After — +36px for tab bar row
chart: 476,
```

This prevents the tab bar from eating into the chart's minimum render space. Existing chart cards placed before this change will resize to the new minimum on next render (tldraw reshapes on `getDefaultProps` changes).

#### Step 3 — Suppress sibling sql/table cards in the stream

In `src/hooks/use-canvas-stream.ts`, inside the `"plan"` event handler:

```ts
// Build suppression map: suppressed card id → chart card id
// A sql/table card is suppressed if a chart card with the same queryGroupId exists
const suppressedToChart = new Map<string, string>();

const chartCardIds = new Set(
  event.cards.filter(c => c.type === "chart").map(c => c.id)
);

for (const card of event.cards) {
  if (card.type === "sql" || card.type === "table") {
    // Find a chart card in the same query group
    const chartSibling = event.cards.find(
      c => c.type === "chart" && c.queryGroupId === card.queryGroupId
    );
    if (chartSibling) {
      suppressedToChart.set(card.id, chartSibling.id);
    }
  }
}

// When creating placeholder shapes, skip suppressed cards
for (const card of event.cards) {
  if (suppressedToChart.has(card.id)) continue; // skip
  // ... existing shape creation logic
}
```

Then in the `"card-data"` event handler, route suppressed sql data to the chart card:

```ts
case "sql": {
  const targetCardId = suppressedToChart.get(event.cardId) ?? event.cardId;
  // Update sql field on chart card (or sql card if not suppressed)
  updateBoardCard(boardId, targetCardId, { sql: event.sql });
  break;
}

case "query_result": {
  if (suppressedToChart.has(event.cardId)) break; // chart card already receives data
  // ... existing table card update logic
  break;
}
```

`suppressedToChart` can be a `useRef` so it persists across event callbacks within the same stream.

## Acceptance Criteria

- [x] Canvas query emits a single chart card with Chart | SQL | Table tabs instead of 3 separate cards
- [x] Chart tab shows the chart visualization (default when chartSpec exists)
- [x] SQL tab shows the raw SQL query that generated the data
- [x] Table tab shows the raw result rows in a scrollable table
- [x] Tabs are not clickable when the card is deselected (three-zone pointer-events pattern preserved)
- [x] Table-only query (no chartSpec): no Chart tab rendered (Chart tab only shown when chartSpec present)
- [x] Legacy `sql` and `table` cards on existing boards still render correctly (no regression)
- [x] Card minimum height is sufficient to show the tab bar + chart without clipping

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| `suppressedToChart` is out of scope across stream reconnects | Use `useRef` scoped to the stream connection lifecycle, reset on new stream |
| Chart card created before sql data arrives (stream ordering) | `updateBoardCard` is safe to call multiple times; the card re-renders when `sql` field populates |
| tldraw version bump changes pointer-events behaviour | Covered by existing three-zone pattern in `shared.tsx` — no new surface area |
| `MIN_CARD_HEIGHT` bump resizes existing boards on reload | Acceptable — existing chart cards were already 440px+; growing to 476px is benign |

## References

### Internal
- `src/components/canvas/card-renderers/chart-renderer.tsx` — current renderer (no header, raw content)
- `src/components/canvas/card-renderers/sql-renderer.tsx` — SQL renderer pattern (AccentStrip + InnerContainer + CardHeader + pre block)
- `src/components/canvas/card-renderers/table-renderer.tsx` — Table renderer pattern (InnerContainer + CardHeader + scrollable table)
- `src/components/canvas/card-renderers/shared.tsx:38` — `MIN_CARD_HEIGHT` constants
- `src/components/canvas/card-renderers/shared.tsx:80` — `CardHeader`, `CardBody`, `InnerContainer` layout primitives
- `src/components/ui/tabs.tsx` — shadcn Tabs with `variant="line"` (already installed)
- `src/hooks/use-canvas-stream.ts:159` — plan event handler where shapes are created
- `src/hooks/use-canvas-stream.ts:249` — card-data event handler where data is routed
- `src/lib/board-types.ts` — `BoardCard` type (already has `sql`, `data`, `chartSpec` fields)

### Patterns to Follow
- `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-*.md` — pointer-events model for interactive tabs
- CLAUDE.md: "Strictly monochrome UI" — use `variant="line"` Tabs, no colored tab accents
