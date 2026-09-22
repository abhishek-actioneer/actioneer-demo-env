# Board from PDF Deck — Brainstorm

**Date:** 2026-03-15
**Status:** Design approved, ready for planning

---

## What We're Building

A native "Board from PDF" creation pathway inside the boards interface (`/canvas`). Users upload a PDF business review deck from the boards UI, the existing deck processing pipeline extracts slides + runs SQL + generates analysis, and the result materializes as a board in document view — one section per slide, chart and analysis side by side. Follow-up suggestions on each slide card pre-fill the sidebar chat. No changes to the existing `/decks` feature.

---

## Why This Approach

**Reuse the deck processing pipeline.** `POST /api/decks/process` already handles PDF extraction, SQL generation, DuckDB execution, and Gemini commentary. We don't duplicate it — we add a thin translation layer that maps the resulting `Deck` + `Slides` into `Board` + `BoardSection` + `BoardCard` objects.

The deck entity created in `deck-store` is an ephemeral side effect (in-memory only, no persistence) and is harmless. The board is the output that users interact with.

---

## Key Decisions

### Entry Point — Boards List Page (`/canvas`)

The "New board" action gets a dropdown with 3 options:
- **Blank board** (existing)
- **Generate with AI** (existing `board-generate` route)
- **From PDF deck** ← new

A file picker opens on "From PDF deck" selection. No separate upload page — the flow initiates inline.

### Processing State — Stream into Board

After upload begins:
1. Navigate immediately to the new board at `/canvas/[boardId]`
2. Show a "Analyzing PDF..." loading state at the top of the board
3. As slides complete (`slide_complete` SSE events), each section populates progressively — users see the board build in real time. Skeleton cards are shown for in-flight slides so the layout doesn't jump.
4. Board title auto-set from PDF filename (e.g. `weekly-business-review.pdf` → "Weekly Business Review") — editable inline after creation via the existing board title editor

The deck pipeline processes up to 3 slides concurrently, so sections appear in near-real-time batches rather than one-by-one.

### Board Layout — Per Slide Section

Each slide becomes one `BoardSection`:
- **Section title**: slide title
- **Layout**: `grid-2` (left: chart card, right: AI analysis text card)
- **Follow-up chips**: rendered below the analysis card as a third card of type `follow-up` with `silentContext` carrying slide context

This maps directly onto existing `BoardSection` + `BoardCard` types with no schema changes.

### Follow-Up Interaction

Follow-up suggestion chips appear as muted clickable pills on each slide's analysis card. On click:
- The "Ask Sentinel" sidebar chat panel opens
- The question is pre-filled in the chat input (not auto-sent — user can edit before sending)
- The chip carries `silentContext` with the slide's data summary so Sentinel has context

This reuses the existing `silentContext` mechanism already present in `DeckCanvas`.

### Pin to Board

Chat responses can be pinned to the board via the existing "add to board" mechanic already in the chat system. No new functionality needed here.

---

## Data Flow

```
User selects PDF in /canvas
  → POST /api/decks/process (existing, streaming NDJSON)
  → On 'total' event: create Board in board-store, navigate to /canvas/[boardId]
  → On each 'slide_complete' event: create BoardSection + BoardCards
    - chart card (from slide.chartSpecs[0])
    - text card (from slide.commentary)
    - follow-up card (from slide.followUps, carries silentContext)
  → On 'done' event: remove loading state, show final board
```

The conversion logic lives in a new utility `src/lib/deck-to-board.ts` — a pure function `deckSlideToSection(slide) → { section, cards }`.

---

## Files Touched

| File | Change |
|------|--------|
| `src/app/canvas/page.tsx` | Add "From PDF deck" option to new board creation |
| `src/lib/deck-to-board.ts` | New utility: converts slide → board section + cards |
| `src/app/canvas/[id]/page.tsx` | Handle `source: "pdf"` board streaming state |
| `src/hooks/use-deck-upload-to-board.ts` | New hook: drives the upload → stream → board creation flow |

No changes to: `/api/decks/process`, `deck-store`, `deck-canvas`, existing board components.

---

## Feature Comparison vs. Existing Decks

The board version trades some deck-specific tools for a cleaner layout and native chat integration. The `/decks` feature is unchanged — users who need the following can still use it.

| Feature | `/decks` | Board from PDF (v1) |
|---|---|---|
| Re-analyze all slides | ✓ | ✗ (boards have per-card refresh) |
| Challenge deck (critical analysis) | ✓ | ✗ |
| Tldraw freeform canvas | ✓ | ✗ (document view only) |
| Follow-up per slide | ✓ | ✓ |
| Pin responses to canvas | via deck flow | ✓ native board pin |
| Sidebar chat integration | ✗ | ✓ |
| Inline board renaming | ✗ | ✓ |

---

## Open Questions

- Should the follow-up chips be their own card row below the analysis card, or embedded within the analysis card itself?
- Should the board default to `viewMode: "document"` or allow switching to canvas view immediately?
- What happens when the user re-uploads the same PDF — create a new board or overwrite?
