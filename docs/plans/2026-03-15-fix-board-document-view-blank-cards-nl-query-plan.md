---
title: "fix: Board document view blank cards when adding sections/cards with NL queries"
type: fix
date: 2026-03-15
---

# fix: Board document view blank cards when adding sections/cards with NL queries

## Overview

When a user adds a section or card on the Board (document view) with a natural language query, blank cards appear showing "No SQL" and no chart. The two code paths in `document-view.tsx` create static placeholder entities but never call `/api/canvas-query` to generate SQL, execute queries, or build chart specs. The Canvas (tldraw) view works correctly via `use-canvas-stream.ts`.

## Problem Statement / Motivation

The Board document view is the primary reading/consumption interface for analytics boards. Users expect that typing a query like "Show me week on week revenue in January 2026" will produce a populated card with SQL, data, and a chart — exactly as it works in the Canvas view. Instead, they get an empty card shell, making the "Add section" and "Add card" features non-functional.

**Root cause (confirmed):**

1. **`AddSectionInput.onSubmit`** (`document-view.tsx:546-558`) — Creates a `BoardSection` with `title: query` but no cards and no API call.
2. **`handleAddCard`** (`document-view.tsx:222-269`) — Creates a `BoardCard` with placeholder `markdownContent` ("Generating chart for...") but never calls any API. Card has `sql: undefined`, `data: []`, `chartSpec: undefined`.

## Proposed Solution

Create a new `useDocumentStream` hook that reuses the existing `/api/canvas-query` API but is decoupled from tldraw. Wire it into both broken code paths.

### New: `src/hooks/use-document-stream.ts` (~140 lines)

A lightweight stream processor for Board document view. Reuses existing infrastructure:
- `parseCanvasEvent()` from `@/lib/canvas-sse-types` — NDJSON parsing
- `saveBoardCard(card, { sync: true })` from `@/lib/board-store` — immediate persistence
- `apiFetch` with `{ stream: true }` from `@/lib/api-client` — SSE call
- `flushPendingPersists()` from `@/lib/board-store` — final flush on stream end

**API:**

```typescript
interface UseDocumentStreamResult {
  /** Run a query and create/populate cards in a section */
  runQuery: (query: string, sectionId: string, opts?: {
    preferredType?: "chart" | "table";  // Which card type to keep (default: "chart")
  }) => Promise<void>;
  /** Card IDs currently being streamed */
  loadingCardIds: Set<string>;
  /** Cancel all active streams */
  cancel: () => void;
}

function useDocumentStream(
  boardId: string,
  datasetId: string,
  onUpdate: () => void  // bumps refreshKey
): UseDocumentStreamResult;
```

**Stream event handling (mirrors `use-canvas-stream.ts` without tldraw):**

| Event | Action |
|-------|--------|
| `plan` | Create placeholder `BoardCard`s with `sectionId` + `orderInSection`. Suppress intermediate sql/table cards that have a chart downstream (same logic as canvas, lines 186-194). Map server→node IDs. |
| `card-data` sql | Route SQL to the chart card (if suppressed) or update the card directly. |
| `card-data` query_result | Stash rows. Skip suppressed cards. |
| `card-data` chart | Update chart `BoardCard` with `chartSpec`, `data`, `sql`. |
| `card-data` text | Accumulate `delta` into text `BoardCard`'s `markdownContent`. |
| `suggestions` | Attach `followUpQuestions` to the text card. |
| `annotations` | Skip — spatial sticky notes don't apply to document grid layout. |
| `done` | Remove from `loadingCardIds`, `flushPendingPersists()`, call `onUpdate()`. |
| `error` | Set card `markdownContent` to error, remove from `loadingCardIds`. |

**Key design decisions:**
- **`sectionId` is passed by the caller**, not from the API (the API returns spatial positions, not sections). The hook assigns `sectionId` + `orderInSection` to every card it creates.
- **Concurrent streams**: Uses per-stream `AbortController` (not a single global). Multiple sections can stream simultaneously. `loadingCardIds` is a `Set` accumulating all active card IDs.
- **Re-renders**: `onUpdate` callback is debounced internally (~300ms) during streaming, with a final immediate call on `done`.
- **NDJSON parsing**: Same buffer pattern as `use-canvas-stream.ts` (lines 132-152): `reader.read()` + `TextDecoder` + line buffer + `parseCanvasEvent()`.

### Modify: `src/components/board/document-view.tsx`

**Wire the hook (top of component):**
```typescript
const { datasetId } = useDataset();
const { runQuery, loadingCardIds, cancel } = useDocumentStream(
  boardId, datasetId, () => setRefreshKey((k) => k + 1)
);
```

**Fix "Add section" (`onSubmit`, line 546-558):**
```typescript
onSubmit={(query) => {
  const sectionId = crypto.randomUUID();
  saveBoardSection({ id: sectionId, boardId, title: query, prose: "", order: liveSections.length, collapsed: false });
  setRefreshKey((k) => k + 1);
  runQuery(query, sectionId);  // fire-and-forget — hook manages loading state
}}
```

**Fix "Add card" for chart/table (`handleAddCard`, lines 245-263):**
Replace the static placeholder creation with a stream call:
```typescript
case "chart":
case "table":
  runQuery(value!, sectionId, { preferredType: type });
  break;
```
The hook creates the card(s) from the `plan` event — no need to pre-create a placeholder.

**Cancel on dataset switch:**
```typescript
useEffect(() => { return () => cancel(); }, [datasetId, cancel]);
```

**Pass `loadingCardIds` down:**
```typescript
<SectionRenderer ... loadingCardIds={loadingCardIds} />
```

### Modify: `src/components/board/section-renderer.tsx`

Accept and pass through `loadingCardIds`:
```typescript
interface SectionRendererProps {
  // ... existing props
  loadingCardIds?: Set<string>;
}
// Pass to SectionCardGrid:
<SectionCardGrid ... loadingCardIds={loadingCardIds} />
```

### Modify: `src/components/board/section-card-grid.tsx`

Accept and pass through `loadingCardIds`:
```typescript
interface SectionCardGridProps {
  // ... existing props
  loadingCardIds?: Set<string>;
}
// Pass to SortableCard:
<SortableCard ... isLoading={loadingCardIds?.has(card.id)} />
```

### Modify: `src/components/board/sortable-card.tsx`

Accept `isLoading` prop and render a spinner overlay:
```tsx
interface SortableCardProps {
  // ... existing props
  isLoading?: boolean;
}

// Inside render, after <CardRenderer>:
{isLoading && (
  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius)] bg-card/80 backdrop-blur-[1px]">
    <div className="flex flex-col items-center gap-2">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/30 border-t-foreground" />
      <span className="text-xs text-muted-foreground">Generating...</span>
    </div>
  </div>
)}
```

## Technical Considerations

**Architecture:** New hook lives in `src/hooks/` (not `src/components/canvas/`) since it's document-view specific and has no tldraw dependency. Follows CLAUDE.md convention: "one hook per concern."

**Suppression logic:** When `preferredType: "table"`, the hook suppresses chart cards instead of table cards. Default behavior suppresses sql/table cards (same as canvas). This ensures clicking "Add Table" actually produces a table card.

**Hydration safety:** The hook only writes to board-store in event handlers (not during render), consistent with the existing `useEffect`-based store reads in `document-view.tsx`.

**No API changes:** `/api/canvas-query` is used as-is. It returns spatial positions (irrelevant to document view) which the hook ignores, substituting `sectionId`-based placement instead.

## Acceptance Criteria

- [ ] "Add section" with NL query creates a section + populates it with chart card(s) and text summary card
- [ ] "Add card" → Chart with NL query creates a chart card with SQL, data, and chartSpec
- [ ] "Add card" → Table with NL query creates a table card with SQL and data rows
- [ ] Cards show a loading spinner while the stream is in progress
- [ ] Errors display inline on the card (not a toast)
- [ ] Switching datasets cancels in-progress streams
- [ ] Multiple concurrent section additions work independently
- [ ] SQL tab shows the generated query, Table tab shows data rows, Chart renders correctly

## Dependencies & Risks

**Low risk:** This fix adds a new hook and modifies 4 existing files with small changes. No API changes. No store schema changes.

**Risk: Stream failure mid-way:** If the stream errors after the `plan` event (cards already created), the user sees empty cards with the loading spinner replaced by an error message. This is acceptable — the user can delete the card and retry.

**Risk: Multi-part queries create many cards:** If the LLM decomposes "revenue and retention" into 2 sub-questions, the section gets 2 chart cards + 1 text card. This matches the canvas behavior and is expected.

## References & Research

### Internal References
- Existing canvas stream: `src/components/canvas/use-canvas-stream.ts` (pattern template)
- SSE types + parser: `src/lib/canvas-sse-types.ts:98` (`parseCanvasEvent`)
- Board store sync: `src/lib/board-store.ts:648` (`saveBoardCard` with `{ sync: true }`)
- Loading component: `src/components/canvas/card-renderers/shared.tsx:441` (`CardPlaceholder`)
- Card renderers: `src/components/board/card-renderer.tsx` (context-free, no tldraw)
- Brainstorm: `docs/brainstorms/2026-03-13-board-document-view-brainstorm.md`

### Institutional Learnings Applied
- Card renderers must be context-free — no tldraw hooks (`docs/solutions/runtime-errors/tldraw-useeditor-crash-outside-canvas-context-20260315.md`)
- Hydration safety: store reads in `useEffect`, not `useMemo` (`docs/solutions/ui-bugs/hydration-mismatch-localstorage-usememo-PlaybookPage-20260224.md`)
- Race condition safety: capture `datasetId` at invocation time (CLAUDE.md convention)

## Files Summary

| File | Change | Lines |
|------|--------|-------|
| `src/hooks/use-document-stream.ts` | **New** — stream hook for document view | ~140 |
| `src/components/board/document-view.tsx` | Wire hook into Add section + Add card | ~30 |
| `src/components/board/section-renderer.tsx` | Pass `loadingCardIds` through | ~5 |
| `src/components/board/section-card-grid.tsx` | Pass `loadingCardIds` through | ~5 |
| `src/components/board/sortable-card.tsx` | Add loading overlay | ~15 |
