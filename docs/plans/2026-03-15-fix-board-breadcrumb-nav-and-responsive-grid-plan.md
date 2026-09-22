---
title: "fix: Board breadcrumb navigation + responsive document grid with follow-up questions"
type: fix
date: 2026-03-15
---

# Board Breadcrumb Navigation + Responsive Document Grid

## Overview

Two UX issues surfaced via agentation comments on the canvas detail pages:

1. **Dead breadcrumb** — "Board" text in `CanvasTopBar` is a plain `<span>`, not a link. Users have no breadcrumb-based way to return to the boards list.
2. **Rigid 3-column grid** — `DocumentView`'s `SectionCardGrid` forces `grid-cols-3` at `lg` breakpoint regardless of available space. Cards look imbalanced when the container is wide enough for 2 but not comfortably 3. Additionally, follow-up questions should always be present and schema-aware.

## Problem Statement

### Breadcrumb
- `canvas-top-bar.tsx:32` renders `<span className="text-muted-foreground">Board</span>` — no `<Link>`, no `onClick`.
- Users on `/canvas/[id]` can only return to the board list via the sidebar nav item.
- Navigation inconsistency: sidebar uses `/canvas?board={id}`, board list page uses `/canvas/{id}`. The breadcrumb should link to `/canvas` (the list page).

### Grid Layout
- `section-card-grid.tsx:56,71` uses `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`.
- At `lg` (1024px), always 3 columns — even when the container would look better with 2 wider cards.
- `resize-handle.tsx:43` hardcodes `(gridWidth - 2 * gap) / 3` — breaks when column count isn't 3.
- `colSpan` values (1–3) aren't clamped to actual column count, causing overflow on narrower layouts.

### Follow-Up Questions
- Follow-ups are generated only for canvas-query cards (in `canvas-query/route.ts:541-577`).
- The `follow-up` card type exists and works (`card-renderer.tsx:24-73`), but generation errors are silently swallowed.
- User wants follow-up questions to always be contextual to the chart AND schema-aware (able to produce SQL).

## Proposed Solution

### Phase 1: Breadcrumb Link (trivial)

**File:** `src/components/board/canvas-top-bar.tsx`

- Import `Link` from `next/link`
- Replace `<span>Board</span>` (line 32) with `<Link href="/canvas">Board</Link>`
- Add hover style: `hover:text-foreground transition-colors`

```tsx
// Before
<span className="text-muted-foreground shrink-0">Board</span>

// After
<Link href="/canvas" className="text-muted-foreground shrink-0 hover:text-foreground transition-colors">
  Board
</Link>
```

### Phase 2: Responsive Auto-Fill Grid

**File:** `src/components/board/section-card-grid.tsx`

Replace the fixed breakpoint classes with CSS grid `auto-fill` + `minmax`:

```tsx
// Before
className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start"

// After — use inline style for the grid-template-columns
style={{
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
  gap: "16px",
  alignItems: "start",
}}
```

**Why `minmax(min(100%, 340px), 1fr)`:**
- At 340px minimum, 2 columns fit at ~700px container width, 3 columns at ~1060px
- `min(100%, 340px)` ensures single-column works on mobile (prevents overflow when container < 340px)
- `auto-fill` dynamically adds columns only when space exists — naturally prefers 2 columns over 3

**File:** `src/components/board/section-card-grid.tsx` — Track actual column count

Add a `ResizeObserver` to detect actual column count and expose it via a CSS custom property or pass it to children:

```tsx
const gridRef = useRef<HTMLDivElement>(null);
const [colCount, setColCount] = useState(2);

useEffect(() => {
  const el = gridRef.current;
  if (!el) return;
  const observer = new ResizeObserver(() => {
    const style = getComputedStyle(el);
    const cols = style.gridTemplateColumns.split(" ").length;
    setColCount(cols);
    el.style.setProperty("--col-count", String(cols));
  });
  observer.observe(el);
  return () => observer.disconnect();
}, []);
```

**File:** `src/components/board/sortable-card.tsx` — Clamp colSpan

Read `--col-count` from the grid parent and clamp:

```tsx
const span = Math.min(card.colSpan ?? 1, colCount);
// OR read from CSS custom property
```

**File:** `src/components/board/resize-handle.tsx` — Dynamic column width

Replace the hardcoded `/3` (line 43) with actual column count:

```tsx
// Before
const colWidth = (gridWidth - 2 * gap) / 3;

// After — read actual column count from CSS custom property
const colCount = parseInt(getComputedStyle(gridEl).getPropertyValue("--col-count") || "3", 10);
const colWidth = (gridWidth - (colCount - 1) * gap) / colCount;
```

Also cap `ghostSpan` and `newSpan` to `colCount` instead of hardcoded `3`:

```tsx
const newSpan = Math.min(colCount, Math.max(1, startSpan + colDelta)) as 1 | 2 | 3;
```

### Phase 3: Follow-Up Questions Always Present

The existing follow-up generation in `canvas-query/route.ts:541-577` is already schema-aware (uses `buildTextToSqlPrompt`). The issues are:

1. **Silent failure** — errors swallowed at line 575-577
2. **Only generated for text cards** — chart cards don't get follow-ups
3. **Not contextual to chart data** — chart cards should have questions that reference their specific data

**File:** `src/app/api/canvas-query/route.ts`

**3a. Generate follow-ups for ALL query groups, not just text cards:**

After all cards in a query group are complete, generate follow-ups that reference the chart data:

```tsx
const followUpPrompt = `${buildTextToSqlPrompt(datasetId)}

The user asked: "${effectiveQuery}"

Cards generated:
${ordered.map((c, i) => {
  const d = cardData.get(c.cardId);
  return `- ${c.type} card: "${c.title}" (${d?.rowCount ?? 0} rows)`;
}).join("\n")}

Generate 2-3 follow-up questions that:
1. Are contextual to the chart/data shown above
2. Can be answered by writing SQL against the schema
3. Help the user explore deeper (drill-down, compare, filter, trend)

Output ONLY a JSON array of strings.`;
```

**3b. Always emit a `follow-up` card after each query group:**

After generating follow-ups, create a `follow-up` card in the section:

```tsx
if (questions.length > 0) {
  send({
    type: "card-data",
    cardId: `followup-${queryGroupId}`,
    cardType: "follow-up",
    markdownContent: questions.join("\n"),
    silentContext: `Previous query: ${effectiveQuery}`,
  });
}
```

**3c. Add retry with fallback questions:**

If Gemini fails to generate follow-ups, provide generic but still schema-aware fallback questions based on the card types generated (e.g., "How does this trend over time?", "Break this down by category", "Compare this with last month").

## Acceptance Criteria

### Breadcrumb
- [ ] Clicking "Board" in `CanvasTopBar` navigates to `/canvas` (board list)
- [ ] Hover state shows `text-foreground` transition
- [ ] Works from both `/canvas/[id]` and `/canvas?board=[id]` entry points

### Responsive Grid
- [ ] Grid uses `auto-fill` + `minmax(340px, 1fr)` — 2 columns by default, 3 only when space allows
- [ ] Single column on mobile (< 380px container)
- [ ] `colSpan` is clamped to actual column count — no overflow
- [ ] `ResizeHandle` ghost outline uses actual column width, not hardcoded `/3`
- [ ] Max colSpan during resize drag is clamped to current column count
- [ ] Cards fill available space evenly (no wasted whitespace)

### Follow-Up Questions
- [ ] Follow-up questions appear after every query group completion (not just text cards)
- [ ] Questions are contextual to the charts/data generated
- [ ] Questions are schema-aware — clicking one can produce a valid SQL query
- [ ] Silent generation failures fall back to generic drill-down questions
- [ ] Follow-up chips use existing `FollowUpChipsRenderer` / `follow-up` card type

## Technical Considerations

### ColSpan Clamping Strategy
The grid column count is non-deterministic with `auto-fill`. A `ResizeObserver` on the grid container is the cleanest way to detect actual columns. Store the count as a CSS custom property (`--col-count`) so both `SortableCard` and `ResizeHandle` can read it without prop drilling.

### Follow-Up Card Collapse
When all chips are dismissed, `FollowUpChipsRenderer` returns `null` and the card vanishes (line 174-175 of `card-renderer.tsx`). This causes a layout shift. Consider adding a CSS `transition` on the grid item or keeping the card slot with reduced height before removing.

### Navigation URL Consistency
This plan only adds the breadcrumb link to `/canvas`. The sidebar still uses `/canvas?board={id}`. Unifying this is a separate concern — both URL schemes work, they just have different browser history behavior.

## Dependencies & Risks

- **ResizeObserver** — well-supported in all modern browsers, no polyfill needed
- **CSS `min()` function** — supported in all browsers since 2020
- **Follow-up generation latency** — already has an 8s timeout. Fallback questions prevent empty state.
- **Risk: colSpan type** — currently typed as `1 | 2 | 3`. If we clamp dynamically, the type still works (clamped values are within the union). No type changes needed.

## Files to Modify

| File | Change |
|------|--------|
| `src/components/board/canvas-top-bar.tsx` | Add `Link` import, replace `<span>` with `<Link>` |
| `src/components/board/section-card-grid.tsx` | Replace Tailwind grid classes with `auto-fill` + `minmax` inline style, add `ResizeObserver` for `--col-count` |
| `src/components/board/sortable-card.tsx` | Clamp `colSpan` to `--col-count` |
| `src/components/board/resize-handle.tsx` | Read `--col-count` instead of hardcoding 3 |
| `src/app/api/canvas-query/route.ts` | Generate follow-ups for all card types, add fallback questions |

## References

- Agentation #1: `mmrnidmm-y4eli6` — breadcrumb navigation
- Agentation #2: `mmro7d1i-m07xxi` — responsive grid + follow-up questions
- Existing follow-up generation: `src/app/api/canvas-query/route.ts:541-577`
- Follow-up card type: `src/components/board/card-renderer.tsx:24-73`
- CSS Grid auto-fill: `repeat(auto-fill, minmax(min, max))` pattern
