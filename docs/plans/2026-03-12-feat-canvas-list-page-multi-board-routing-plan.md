---
title: "feat: Canvas list page and multi-board routing"
type: feat
date: 2026-03-12
---

# feat: Canvas list page and multi-board routing

## Overview

Convert the Canvas feature from a single-page query-param design (`/canvas?board=<id>`) to a list-first routing pattern matching the rest of the app:

- `/canvas` → **index page** listing all boards for the active dataset
- `/canvas/[id]` → **detail page** rendering a single tldraw board

This makes all user-created boards accessible from the sidebar, and aligns with how Segments, Metrics, and Decks already work.

---

## Problem Statement

The sidebar has a single "Canvas" link pointing to `/canvas`. This page uses `useSearchParams()` to read a `?board=<id>` query param and auto-redirects to the most recently used board via `useCanvasBoard`. Users have no way to discover or navigate to any board other than the one they were last on. As the number of boards grows, boards become permanently inaccessible.

---

## Proposed Solution

Adopt the **Decks pattern** (`src/app/decks/page.tsx` + `src/app/decks/[id]/page.tsx`) verbatim:

1. Rewrite `src/app/canvas/page.tsx` as a board list index (name, card count, last updated)
2. Create `src/app/canvas/[id]/page.tsx` as a thin shell that passes `id` down to the existing canvas components
3. Simplify `useCanvasBoard` to remove auto-redirect logic (ID always comes from the URL segment)
4. Update `PinButton` toast URL from `/canvas?board=${id}` → `/canvas/${id}`
5. Sidebar `href: "/canvas"` stays unchanged — already points at the index

The `board-store.ts` already has `getAllBoards(datasetId)` and `getBoardSummaries(datasetId)` needed by the index page. `TldrawCanvas` already accepts `boardId` as a required prop — no changes needed to the canvas rendering itself.

---

## Technical Considerations

### Routing change

Current: `/canvas?board=<id>` (single route, query param)
New: `/canvas` (index) + `/canvas/[id]` (detail, file-system segment)

The old URL format will be orphaned. Any bookmarks or hardcoded references to `/canvas?board=X` will not automatically redirect. All known occurrences must be updated in the same PR.

### Known URL references to update

- `src/components/canvas/pin-button.tsx` — toast "View" action constructs `/canvas?board=${boardId}`
- Grep for any other occurrences of `/canvas?board` before merging

### `useCanvasBoard` simplification

The hook currently:
1. Reads `boardId` prop (from `?board=` query param)
2. If invalid/missing, auto-selects the most recent board and does `router.replace`
3. Seeds the demo board if none exist
4. Calls `setActiveBoardId` / `notifyBoardChanged` on the sidebar context

After migration:
- Steps 2–3 move out of the hook and into the index page
- The `[id]` route always has a valid segment — the hook only needs to validate it exists and redirect to `/canvas` if not found
- `setActiveBoardId` / `notifyBoardChanged` still called from the detail page hook

### Empty state and board creation

The index page must handle the zero-board case. Preserve the current auto-seed behavior: if `getBoardSummaries(datasetId)` returns empty, call `seedDemoBoard(datasetId)` and render the resulting board in the list. Additionally, add a "New Board" button that creates a blank board via `saveBoard()` and navigates to `/canvas/${newId}`.

### Dataset switching

When the user switches datasets while on `/canvas/[id]`, the board may belong to a different dataset. The simplified hook should detect this mismatch (`board.datasetId !== currentDatasetId`) and redirect to `/canvas`.

### Back navigation

The index page must navigate with `router.push`, not `router.replace`, so the browser back button returns to the list from any board detail page.

---

## Acceptance Criteria

### Index page (`/canvas`)

- [x] Shows a list of all boards for the active dataset (name, card count, last updated)
- [x] Empty state: auto-seeds the demo board if none exist, shows it in the list
- [x] "New Board" button creates a board (name input, default "Untitled Board") and navigates to `/canvas/${newId}`
- [x] Clicking a board row navigates to `/canvas/${board.id}` via `router.push`
- [x] Page shell matches the standard: `"use client"`, `flex flex-col h-full min-w-0` outer, `max-w-5xl mx-auto px-6 py-8` content area

### Detail page (`/canvas/[id]`)

- [x] Receives `id` from Next.js file-system params (not query params)
- [x] Passes `boardId` to `TldrawCanvas` (or existing `CanvasPage` component)
- [x] If `id` does not match any board in the store, redirects to `/canvas`
- [x] If the board's `datasetId` doesn't match the active dataset, redirects to `/canvas`
- [x] Includes a "← Boards" back link in the canvas toolbar (mirroring the "← Decks" link in `deck-canvas.tsx:313`)
- [x] `useCanvasBoard` still calls `setActiveBoardId` / `notifyBoardChanged` on mount

### URL migration

- [x] `pin-button.tsx` toast "View" action navigates to `/canvas/${boardId}` (not `/canvas?board=${boardId}`)
- [x] No other occurrences of `/canvas?board=` remain in the codebase
- [x] Sidebar "Canvas" item (`href: "/canvas"`) unchanged — points at the index

### Navigation behavior

- [x] Browser back button from `/canvas/[id]` returns to `/canvas` index (router.push, not replace)
- [x] Sidebar "Canvas" item is highlighted (`activePage === "canvas"`) for both `/canvas` and `/canvas/[id]` — `pathname.startsWith("/canvas")` already handles this

---

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| Old `/canvas?board=<id>` URLs break | Grep for all occurrences before PR; update in same commit |
| `useCanvasBoard` auto-redirect removed — missing edge cases | Keep redirect logic for the "board not found" case; only remove the "pick most recent" logic |
| `canvas-store.ts` still used in some places | It's deprecated; the plan only touches `board-store.ts` |
| tldraw SSR — `dynamic(..., { ssr: false })` required | Already in place on current canvas page; carry it through to `[id]/page.tsx` |

---

## Implementation Steps

### Step 1 — Grep for `/canvas?board=` occurrences

Before touching any code, run:
```
grep -r "canvas?board\|canvas\?board" src/
```
List and fix every occurrence in the same PR as the routing change.

### Step 2 — Create `src/app/canvas/[id]/page.tsx`

Thin shell: read `params.id`, lazy-import `CanvasPage` with `ssr: false`, pass `boardId={params.id}`.

```tsx
// src/app/canvas/[id]/page.tsx
"use client";
import dynamic from "next/dynamic";

const CanvasPage = dynamic(() => import("@/components/canvas/canvas-page"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading canvas...</p>
      </main>
    </div>
  ),
});

export default function CanvasDetailRoute({ params }: { params: { id: string } }) {
  return <CanvasPage boardId={params.id} />;
}
```

### Step 3 — Simplify `useCanvasBoard`

Remove the "auto-select most recent board" and `router.replace` logic. Keep only:
- Validate `boardId` exists in store
- If not found: `router.push("/canvas")`
- If board's `datasetId` !== `currentDatasetId`: `router.push("/canvas")`
- `setActiveBoardId` / `notifyBoardChanged` still called

### Step 4 — Rewrite `src/app/canvas/page.tsx` as the index

Model after `src/app/decks/page.tsx`:
- `useEffect` → `getBoardSummaries(datasetId)` or `seedDemoBoard` if empty
- List of board rows (name, card count, updated timestamp)
- "New Board" button → `saveBoard({ id: createId(), name: "Untitled Board", datasetId, createdAt, updatedAt })` → `router.push(`/canvas/${id}`)`
- Standard page shell

### Step 5 — Update `pin-button.tsx`

Change the "View" toast action URL:
```ts
// Before
router.push(`/canvas?board=${boardId}`);
// After
router.push(`/canvas/${boardId}`);
```

### Step 6 — Add "← Boards" back link to canvas toolbar

In `src/components/canvas/canvas-page.tsx` (or wherever the toolbar renders), add a back link mirroring `deck-canvas.tsx:313`:
```tsx
<button onClick={() => router.push("/canvas")}>← Boards</button>
```

---

## References

### Internal

- Pattern reference (Decks): `src/app/decks/page.tsx`, `src/components/deck/deck-canvas.tsx:313`
- Board store: `src/lib/board-store.ts` — `getAllBoards`, `getBoardSummaries`, `saveBoard`, `seedDemoBoard`
- Board types: `src/lib/board-types.ts`
- Current canvas route: `src/app/canvas/page.tsx`
- Board hook: `src/components/canvas/use-canvas-board.ts`
- Pin button (URL to update): `src/components/canvas/pin-button.tsx`
- Sidebar nav items: `src/components/sidebar.tsx:65`
- tldraw canvas component: `src/components/canvas/tldraw-canvas.tsx`
- Board picker popover: `src/components/canvas/board-picker-popover.tsx`

### Patterns from CLAUDE.md / Memory

- Page shell: `"use client"` + `flex flex-col h-full min-w-0` outer + `max-w-5xl mx-auto px-6 py-8` content
- tldraw components must use `dynamic(() => import(...), { ssr: false })` — tldraw is client-only
- All API calls via `apiFetch` (if any API routes are added)
- Strictly monochrome UI — no colorful badges; use `muted`, `foreground`, `border` tokens only
