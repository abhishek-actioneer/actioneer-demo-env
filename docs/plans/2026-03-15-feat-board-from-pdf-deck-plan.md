---
title: "feat: Board from PDF Deck"
type: feat
date: 2026-03-15
deepened: 2026-03-15
---

# feat: Board from PDF Deck

## Enhancement Summary

**Deepened on:** 2026-03-15
**Research agents used:** TypeScript reviewer, race-condition reviewer, architecture strategist, performance oracle, security sentinel, code-simplicity reviewer, pattern-recognition specialist, data-integrity guardian, agent-native reviewer, best-practices researcher, frontend-design, architecture reviewer, learnings researcher

### Key Improvements Discovered

1. **Pub/sub instead of polling** — Replace 500ms `setInterval` with a subscriber pattern on `deck-to-board-stream.ts`, matching the `catalog-invalidation.ts` precedent already in the codebase
2. **Discriminated union for stream state** — `ActivePdfStream` must be a typed union over status variants, not a flat interface; the flat shape silently allows invalid state combinations
3. **`saveBoardSection` has no sync option** — The current board-store API is `saveBoardSection(section): boolean` (no options). Only `saveBoardCard` and `saveBoard` have `{ sync: true }` support — the plan must not call a non-existent overload
4. **Write a sentinel card before `router.push`** — `purgeStaleBoards()` deletes boards with 0 cards on re-init; the board needs at least one card before navigation fires
5. **Hydration safety is mandatory** — This codebase has two documented incidents of localStorage reads inside `useMemo`/`useState` causing hydration crashes; all board-store reads must be in `useEffect`
6. **Board entity missing from entity catalog** — `buildEntityCatalog()` in `entity-registry.ts` omits boards; add so agents can reference boards by name in chat

### New Considerations Discovered

- Dismiss state for follow-up chips must be persisted, not ephemeral component state
- AbortError narrowing is needed in the hook's catch block (cancel ≠ error)
- UX: label normalization and loading banner position need attention
- UX: action buttons should be disabled during PDF processing
- Agent-native: `GET /api/boards/[id]/cards` needed for agent access to follow-up context

---

## Overview

Add a "From PDF deck" option to the "New board" dropdown on `/canvas`. Users select a PDF business review deck, the existing `/api/decks/process` pipeline handles extraction + SQL + Gemini commentary, and the result materializes as a board in document view — one section per slide, chart card + analysis card + follow-up chips per section. Follow-up chip clicks pre-fill the sidebar chat with slide context. No changes to the existing `/decks` feature.

## Problem Statement / Motivation

The `/decks` feature does this analysis well, but outputs to a tldraw canvas with no native chat integration. The boards system has native chat integration ("pin to board"), but no way to populate it from a PDF. This feature closes the gap: users get the analytical depth of deck processing with the interactive polish of boards.

## Proposed Solution

Reuse `POST /api/decks/process` (untouched). Add a thin translation layer (`deck-to-board.ts`) that maps `Slide` objects to `BoardSection` + `BoardCard` objects. A new hook (`use-deck-upload-to-board.ts`) drives the file-pick → upload → stream → navigate flow. A module-level singleton with pub/sub (`deck-to-board-stream.ts`) persists stream progress across the route navigation from `/canvas` to `/canvas/[boardId]`.

## Key Architecture Decisions

### 1. Stream Survival Across Navigation

The SSE stream starts on `/canvas` and navigates to `/canvas/[boardId]` on the `total` event. React component state does not survive navigation — the hook's local state and any non-ref values in the index page are destroyed on unmount.

**Decision:** Module-level singleton in `src/lib/deck-to-board-stream.ts`. This pattern is already established in the codebase:
- `api-client.ts` uses `let _datasetId`, `let _modelId` with `setActiveDatasetId()` / `getActiveDatasetId()` — exact same shape
- `canvas-events.ts` uses `let _canvasQueryHandler`, `let _deckPinHandler` with `set*` / `get*` / `send*` — multiple singletons coexist

The singleton also exposes a **pub/sub subscriber** (matching `catalog-invalidation.ts`) so the board page can receive updates without polling:

```typescript
// src/lib/deck-to-board-stream.ts

// Discriminated union — not a flat interface with nullable fields
type ActivePdfStream =
  | { boardId: string; status: "uploading" }
  | { boardId: string; status: "processing"; completedSlides: number; totalSlides: number }
  | { boardId: string; status: "done"; completedSlides: number; totalSlides: number }
  | { boardId: string; status: "error"; error: string; completedSlides: number };

let _active: ActivePdfStream | null = null;
const _subscribers = new Set<() => void>();

export function setActivePdfStream(s: ActivePdfStream | null) {
  _active = s;
  _subscribers.forEach((fn) => fn());  // notify all subscribers
}
export function getActivePdfStream() { return _active; }
export function subscribeToStream(fn: () => void): () => void {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);  // returns cleanup function
}
```

The board page subscribes in a `useEffect`:
```typescript
useEffect(() => {
  const unsubscribe = subscribeToStream(() => {
    const s = getActivePdfStream();
    if (s?.boardId === boardId) setStreamState(s);
  });
  return unsubscribe;
}, [boardId]);
```

**Why not `setInterval` polling:** Zero-lag event-driven updates, no wasted renders every 500ms, consistent with how `catalog-invalidation.ts` and `canvas-events.ts` work in this codebase.

### 2. DocumentView Re-Render Signal

`DocumentView` reads from `board-store` synchronously at render time (`getBoardSections`, `getBoardCards`). It only re-renders when its own React state changes.

**Decision:** The board page subscribes to the singleton (as above). Each `slide_complete` event fires `setActivePdfStream(updatedState)`, which notifies the subscriber, which calls `setStreamState()` in the board page, which triggers a re-render of `DocumentView` via a `refreshKey` or explicit sections prop.

No polling. No interval. Pure event-driven.

### 3. Follow-Up Card Rendering

The `"follow-up"` `CardType` exists in `board-types.ts` but has no renderer in `src/components/board/card-renderer.tsx`.

**Decision:** Extend `card-renderer.tsx` with a `follow-up` case that:
- Parses `markdownContent` (newline-split) into an array of suggestion strings
- Caps at 3 chips (follows the documented "max 3 action slots" pattern from `follow-up-actions-card-redesign.md`)
- Renders as `flex flex-wrap gap-2` of `<button>` elements styled as muted pills
- On click: calls `injectText(question, card.silentContext ?? "")` from `useChatPanel()`
- Stores `chipDismissed` state in board-store (not ephemeral component state) so dismissed chips stay hidden after navigation

Follow-up chips live as their **own card row** below the analysis card (matching the existing deck-canvas pattern).

### 4. Board Creation Timing + Purge Safety

**Decision:** Create the board AND write a sentinel placeholder card synchronously on the `total` event, before `router.push()`. Order matters:

```
1. saveBoard(newBoard)                    ← sync, no await
2. saveBoardCard(placeholderCard, sync)  ← sentinel: prevents purgeStaleBoards() from deleting it
3. setActivePdfStream({ status: "processing", ... })
4. router.push("/canvas/{boardId}")      ← async — fires last
```

**Why the sentinel card:** `purgeStaleBoards()` in `board-store.ts` (lines 219-228) deletes any board with 0 cards during `ensureInitialized()`. A board created on `total` has 0 cards until the first `slide_complete` — a race window of several seconds. The sentinel card (`type: "text"`, `markdownContent: ""`, to be overwritten or hidden) blocks purge.

**The redirect guard:** `use-canvas-board.ts:22-27` immediately redirects to `/canvas` if `getBoard(boardId)` returns `null`. This means `saveBoard()` must complete synchronously before `router.push()` fires. Never put an `await` between them.

### 5. Default ViewMode

**Decision:** `viewMode: "document"` always. Canvas view is accessible via the existing toggle, but card positions are set to a sensible grid so switching to canvas view renders readably:
- Chart card: `x: 0, y: slideIndex * 400`
- Text card: `x: 460, y: slideIndex * 400`
- Follow-up card: `x: 0, y: slideIndex * 400 + 260, size: { width: 900, height: 120 }`

### 6. Duplicate PDF

**Decision:** Always create a new board (no deduplication). Matches existing deck flow behavior. Board list accumulates — users can delete old boards manually.

## Technical Considerations

### New Files

**`src/lib/deck-to-board-stream.ts`** — module-level singleton + pub/sub (see discriminated union above). Mirrors `canvas-events.ts` and `api-client.ts` shape.

**`src/lib/deck-to-board.ts`** — pure conversion utility (no React, no side effects).

```typescript
// Pure function: Slide → BoardSection + BoardCard[]
export function deckSlideToSection(
  slide: Omit<Slide, "commentaryThreadId" | "chatThreadId">,
  boardId: string,
  slideIndex: number
): { section: BoardSection; cards: BoardCard[] }

// Shared utility: matches deck-canvas.tsx's buildFollowUpContext (extract + export)
export function buildFollowUpContext(slide: Omit<Slide, ...>): string
```

- Adapts `slideToCards()` logic from `deck-canvas.tsx:83-168` — do not duplicate, extract or adapt
- Card types per slide: `"chart"` (chartSpecs[0]), `"text"` (commentary), `"follow-up"` (followUps, with silentContext)
- `sectionId` set on every card — required for `DocumentView` grouping (cards without `sectionId` fall into "Unsectioned")
- `orderInSection`: chart = 0, text = 1, follow-up = 2
- PDF filename → board title: strip `.pdf`, replace `_`/`-` with spaces, title-case each word
- If `slide.chartSpecs` is empty: skip chart card — return only text + follow-up (or just follow-up if commentary also empty)

**`src/hooks/use-deck-upload-to-board.ts`** — React hook.

```typescript
// Return shape matches codebase hook convention (named properties object)
export function useDeckUploadToBoard(): {
  upload: (file: File) => Promise<void>;
  isUploading: boolean;
  error: string | null;
}
```

- Raw `fetch` with `FormData` (CLAUDE.md multipart exception — do NOT use `apiFetch`)
- AbortController stored in a `useRef<AbortController | null>` — NOT module-level. The `useRef` persists across renders but is correctly cleaned up by the hook's `useEffect` return:
  ```typescript
  useEffect(() => {
    return () => { abortRef.current?.abort(); setActivePdfStream(null); };
  }, []);
  ```
- On `total` event:
  1. `saveBoard(newBoard)` — synchronous
  2. `saveBoardCard(sentinelCard, { sync: true })` — sentinel against purge
  3. `setActivePdfStream({ status: "processing", boardId, completedSlides: 0, totalSlides: count })`
  4. `router.push("/canvas/{boardId}")` — async navigation fires last, no await before it
- On `slide_complete`: `deckSlideToSection(slide, boardId, slideIndex)` → `saveBoardSection(section)` → `saveBoardCard(card, { sync: true })` × 2-3
- On `done`: `setActivePdfStream({ status: "done", ... })`
- On `error` with slideIndex: mark section with error placeholder card (replace sentinel if first slide)
- On global `error` (no slideIndex): `setActivePdfStream({ status: "error", error: message, ... })`
- **AbortError narrowing in catch:**
  ```typescript
  catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return; // user cancelled — not an error
    setError(e instanceof Error ? e.message : "Upload failed");
  }
  ```
- Handle the `"progress"` variant in the switch — `DeckProcessEvent` includes it even if it's a no-op
- **`upload` function must be wrapped in `useCallback`** with `router` in the dependency array (ESLint `react-hooks/exhaustive-deps` is enforced in CI)

### Hydration Safety (Mandatory)

This codebase has two documented hydration crashes from localStorage reads in `useMemo`/`useState` (Sidebar-20260218, PlaybookPage-20260224). All board-store reads in the new components must follow the safe pattern:

```typescript
// WRONG — causes hydration mismatch:
const board = useMemo(() => getBoard(boardId), [boardId]);

// CORRECT:
const [board, setBoard] = useState<Board | null>(null);
useEffect(() => { setBoard(getBoard(boardId)); }, [boardId, refreshKey]);
```

Never call board-store functions in component body, `useMemo`, or `useState` initializers. Only in `useEffect`.

### `saveBoardSection` API Correction

**Critical:** The current `board-store.ts` has `saveBoardSection(section: BoardSection): boolean` with NO options parameter. Only `saveBoardCard` and `saveBoard` support `{ sync: true }`. The plan must not call `saveBoardSection(section, { sync: true })` — TypeScript will catch this at build time.

Sections are less latency-critical than cards (they don't carry chart data). The debounced section write is acceptable.

### Modified Files

**`src/app/canvas/page.tsx`**

- Extend the "New board" creation UI to show 3 options: **"Blank"**, **"Generate with AI"**, **"Upload PDF deck"** (label normalization — consistent noun/verb phrasing)
- "Upload PDF deck" expands to a drag-target sub-area (or opens a small confirmatory sheet) before triggering `<input type="file">` — avoids jarring OS dialog on mis-click
- On file select: call `useDeckUploadToBoard().upload(file)` — navigation handled inside hook
- File validation client-side: check `file.type === "application/pdf"` before upload begins (shows inline error below the action area if invalid)
- Error state: inline error message below the creation area (not a toast)

**`src/app/canvas/[id]/page.tsx`**

- On mount: call `getActivePdfStream()`. If present and `boardId` matches and `status !== "done"`: subscribe to the singleton via `subscribeToStream()`
- Pass `streamState` down to `CanvasPage` / `DocumentView` as a prop
- Disable share/export action buttons while `streamState.status === "processing"`

**`src/components/board/document-view.tsx`**

- Accept `streamState?: ActivePdfStream | null` prop
- Loading indicator: a **subtle inline progress bar** beneath the board title (not a full-width banner) + "N of M slides analyzed" text in the title area subtitle. Use `text-muted-foreground` — not a colored banner
- Suppress `AddSectionInput` while processing (prevents layout collisions with arriving sections)
- Show `totalSlides - completedSlides` skeleton section rows below complete sections
- On `status === "error"`: show a muted inline error message + "Close" button
- If `streamState.status === "processing"` and 0 sections have arrived yet: show full-page skeleton treatment (not a frozen empty state)
- **All `board-store` reads in `useEffect`** (see hydration safety above)

**`src/components/board/card-renderer.tsx`**

- Add `case "follow-up"`: parse `markdownContent` (split on `\n`, filter empty), cap at 3 chips, render as pill buttons
- On chip click: `injectText(question, card.silentContext ?? "")` from `useChatPanel()`
- Dismiss state: store dismissed chip indices in board-store (a field on `BoardCard.markdownContent` is insufficient — consider adding `dismissedChips?: number[]` to `BoardCard` type, or storing dismissed state separately in board-store with a `saveDismissedChips(cardId, indices)` helper)
- Action buttons in the board should be `disabled` during `status === "processing"` — pass this down or read from the singleton

### Board Entity Catalog

**`src/lib/entity-registry.ts`** — add boards to `buildEntityCatalog()` so agents can reference boards by name in the @ picker:

```typescript
// Add alongside existing segments, metrics, playbooks entries:
const boards = getAllBoards();
boards.forEach(b => catalog.push({
  type: "board",
  id: b.id,
  name: b.name,
  description: b.description ?? "",
}));
```

This also enables the sidebar chat to have board context when the user @ mentions a board.

### Agent-Native Considerations

**`GET /api/boards/[id]/cards`** — new API route returning `BoardCard[]` for a board, including `silentContext`. Enables agents to enumerate follow-up suggestions programmatically. Use `apiFetch` from the client; requires session cookie on server.

The system prompt should document that boards are createable from PDFs via the UI and that follow-up cards carry pre-loaded analysis questions.

### Gotchas from Institutional Learnings

- **`buildTextToSqlPrompt()`** — deck pipeline already uses the right function; no change needed
- **DuckDB connection leak** — no new API routes that touch DuckDB; existing `/api/decks/process` uses singleton connection pattern
- **`saveBoardCard(card, { sync: true })`** — use sync option when writing from SSE callbacks so sections appear immediately
- **`purgeStaleBoards()` race** — mitigated by sentinel card written before `router.push`
- **Tailwind arbitrary values with CSS variables** — use `style={{}}` for dynamic colors; never `bg-[var(--x)]` in canvas components
- **SSE sync write cancels pending debounce write** — if a user edits a card concurrently with an SSE sync write on the same key, the debounce timer resets. Mitigation: PDF-derived boards don't have user edits during processing, so this race is theoretical not practical in v1
- **Recharts chart rendering** — `chartSpec` from the deck pipeline uses the same `ChartSpec` type as the report-chart renderer; no conversion needed, just pass through

## Acceptance Criteria

### Entry Point

- [x] "New board" action on `/canvas` shows 3 options: **Blank**, **Generate with AI**, **Upload PDF deck**
- [x] Clicking "Upload PDF deck" shows a drag-target or confirmatory sheet before opening the file picker
- [x] Non-PDF files are rejected with an inline error message before upload begins
- [x] `file.type === "application/pdf"` checked client-side before any network request

### Happy Path — Loading

- [x] After file selection, app navigates to `/canvas/[boardId]` when the `total` SSE event arrives
- [x] Board title is auto-set from PDF filename (underscores/hyphens → spaces, title-cased, `.pdf` stripped)
- [x] A subtle loading indicator (progress bar + "N of M slides analyzed" subtitle) appears beneath the board title during processing
- [x] Skeleton section rows appear for slides not yet complete
- [x] As each `slide_complete` event arrives, the corresponding section populates within one render cycle (pub/sub, not polling lag)
- [ ] Action buttons (share, export, etc.) are disabled during processing — CanvasTopBar doesn't expose share/export buttons yet; streamState is wired but no buttons to disable

### Happy Path — Completed Board

- [x] Each slide produces one board section with title = slide title
- [x] Each section contains: chart card (left), analysis text card (right, grid-2 layout), follow-up card below
- [x] Follow-up card renders as muted pill chips (max 3 per slide)
- [x] Loading indicator disappears when `done` event arrives
- [x] Board name is editable inline (existing board title editor — no change needed)
- [x] Dismissed chips remain dismissed after page navigation (persisted, not ephemeral)

### Follow-Up Interaction

- [x] Clicking a follow-up chip: opens sidebar chat panel, pre-fills chat input with question (not auto-sent)
- [x] `silentContext` carrying slide data summary is attached to the message on send
- [x] Chips are capped at 3 per slide

### Error Handling

- [x] Upload fails before `total` (non-200, file too large, invalid PDF): inline error below the action area, no navigation
- [x] Global stream error after navigation: loading indicator becomes muted error message; board shows whatever sections completed
- [x] Per-slide processing failure: section renders a "Could not analyze this slide" placeholder card
- [ ] Zero chartable slides (text-only PDF): board created but shows a "No charts were found in this PDF" empty state — board shows the empty-state view which is already present; dedicated empty message is v1.1

### Hydration & Store Safety

- [x] All board-store reads in `useEffect`, never in component body or `useMemo`
- [x] No hydration mismatch on hard refresh of `/canvas/[boardId]`

### No Regressions

- [x] Existing `/decks` feature unaffected
- [x] "Blank board" and "Generate with AI" creation paths continue to work
- [x] Board title editor, canvas/document toggle, and pin-to-board work on PDF-sourced boards

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| Stream aborted on route navigation | Module-level AbortController via `useRef` + `useEffect` cleanup + `setActivePdfStream(null)` |
| `DocumentView` doesn't re-render as sections arrive | Pub/sub subscription via `subscribeToStream()` — event-driven, zero polling |
| `purgeStaleBoards()` deletes in-progress board | Sentinel card written to board-store before `router.push` |
| `saveBoardSection` has no `{ sync: true }` option | Use standard call; section debounce is acceptable (only cards need sync) |
| Hydration crash from localStorage reads | All store reads in `useEffect` — follow documented safe pattern |
| `saveBoard()` called after `router.push()` → redirect loop | `saveBoard()` + sentinel card must complete synchronously before `router.push()` — no await between them |
| `DOMException("AbortError")` shown as upload error to user | Check `e instanceof DOMException && e.name === "AbortError"` before setting error state |
| Gemini API key missing / DuckDB not initialized | Already handled by existing deck pipeline error path |

## References & Research

### Internal References

- Deck SSE event types: `src/lib/deck-upload.ts:9-14`
- Slide-to-cards conversion (adapt): `src/components/deck/deck-canvas.tsx:83-168`
- `buildFollowUpContext` (extract + reuse): `src/components/deck/deck-canvas.tsx:69-80`
- `silentContext` injection: `src/providers/chat-panel-provider.tsx:134`
- Board store CRUD: `src/lib/board-store.ts` — `saveBoard`, `saveBoardSection`, `saveBoardCard({ sync: true })`
- Board types: `src/lib/board-types.ts` — `Board`, `BoardSection`, `BoardCard`, `CardType`
- Singleton precedents: `src/lib/api-client.ts:1-30`, `src/components/canvas/canvas-events.ts`
- Pub/sub precedent: `src/lib/catalog-invalidation.ts`
- Canvas index page: `src/app/canvas/page.tsx`
- Board page: `src/app/canvas/[id]/page.tsx`
- DocumentView: `src/components/board/document-view.tsx`
- Existing card renderer: `src/components/board/card-renderer.tsx`
- Redirect guard: `src/hooks/use-canvas-board.ts:22-27`
- Entity catalog: `src/lib/entity-registry.ts`
- Existing PDF upload UI pattern: `src/app/decks/page.tsx:38-95`

### Institutional Learnings Applied

- Follow-up card UX: `docs/solutions/design-patterns/follow-up-actions-card-redesign.md` — cap at 3, persist dismiss state
- Hydration safety: `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usememo-PlaybookPage-20260224.md` (mandatory pattern)
- Hydration safety: `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usestate-Sidebar-20260218.md` (same bug class)
- SQL context function: `docs/solutions/logic-errors/deck-processing-wrong-sql-context-function.md` (pipeline unchanged, no risk)
- DuckDB connection leak: `docs/solutions/database-issues/duckdb-connection-leak-server-crash-System-20260219.md` (no new routes)
- ReactFlow provider: `docs/solutions/runtime-errors/reactflow-provider-missing-canvasflow-context.md` (not applicable — document view only)
- Chart rendering: `docs/solutions/best-practices/recharts-consistency-custom-tooltip-Forecasting-20260220.md` (ChartSpec type compatible)

## Implementation Order

1. [x] **`src/lib/deck-to-board.ts`** — pure utility + extract `buildFollowUpContext` from `deck-canvas.tsx`
2. [x] **`src/lib/deck-to-board-stream.ts`** — singleton + discriminated union + pub/sub
3. [x] **`src/hooks/use-deck-upload-to-board.ts`** — hook with full error handling, abort cleanup, sentinel card
4. [x] **`src/components/board/card-renderer.tsx`** — add follow-up case with 3-chip cap + dismiss persistence
5. [x] **`src/components/board/document-view.tsx`** — loading progress + skeleton sections + hydration-safe reads
6. [x] **`src/app/canvas/page.tsx`** — "Upload PDF deck" option with drag-target sub-area
7. [x] **`src/app/canvas/[id]/page.tsx`** — mount-time subscription + stream state prop + disabled buttons
8. [x] **`src/lib/entity-registry.ts`** — add board type to `buildEntityCatalog()`
9. **(Optional v1.1)** `GET /api/boards/[id]/cards` — agent access to follow-up context

Test manually: upload a known-good PDF with 3+ slides, verify sections appear progressively (not polling-lagged), verify follow-up chip pre-fills chat with correct `silentContext`, verify hard-refresh on `/canvas/[boardId]` does not hydration-crash.
