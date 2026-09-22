# Deck Document View — Brainstorm

**Date:** 2026-03-16
**Status:** Design approved

## What We're Building

Replace the tldraw spatial canvas in `/decks/[id]` with a **document view** — a scrollable, section-per-slide layout that matches how decision makers actually review business decks: sequentially, with inline analysis, and conversational drill-down via sidebar chat.

The existing board `DocumentView` component is reused (slides converted to `BoardSection` + `BoardCard[]` at mount time via `deckSlideToSection()`), wrapped in a `DeckDocumentView` shell that adds deck-specific controls (re-analyze, challenge, streaming upload).

## Why This Approach

**Canvas is wrong for decks.** A deck has inherent narrative order (revenue → acquisition → retention). The tldraw canvas destroys this by scattering slides spatially with no reading flow. Satellite cards (analysis, follow-ups, challenge) are cramped at 280×220. Follow-up answers float as disconnected cards. Zoom/pan friction to read analysis text.

**Document view matches the use case.** Decision makers scan slides top-to-bottom, stop on problem areas, ask follow-up questions, and want answers in context. Scrolling is natural. Charts get full width. Analysis gets breathing room. Challenge findings sit right next to what they're critiquing.

**Reuse over rebuild.** The board `DocumentView` already handles sections, card grids, drag-and-drop, card renderers, resize handles, and streaming. `deckSlideToSection()` already converts slides to board data structures. We wrap, not rewrite.

## Key Decisions

### 1. Section ordering: Allow reordering
Users can drag-and-drop sections (slides) and cards within sections, same as boards. Preserves flexibility for decision makers who want to group related slides together.

### 2. Follow-up interaction: Sidebar chat
Follow-up answers stream into the sidebar chat, not inline in the document. Keeps the document clean as the canonical "deck view" and the chat as the "conversation about the deck."

**Follow-up chips DO appear in each section** (below analysis text). Clicking a chip injects the question into sidebar chat input with the slide's context (title, SQL, sample data) as `silentContext`. This provides guided discovery without cluttering the document with generated cards.

### 3. Challenge findings: Inline callout
Per-slide challenge findings render as a subtle callout block below the analysis text within each section — like a code review comment. Not a separate card, not a collapsible banner. Always visible when challenge has been run.

```
┌─────────────────────────────────┐
│ 📊 Chart                        │
├─────────────────────────────────┤
│ Analysis text...                │
├─────────────────────────────────┤
│ ⚠ Challenge                     │
│ Critique text here...           │
└─────────────────────────────────┘
│ [Why did ARPU drop?] [Which...] │  ← follow-up chips
```

### 4. Architecture: Reuse DocumentView
- Convert `Deck.slides[]` → `BoardSection[]` + `BoardCard[]` via enhanced `deckSlideToSection()`
- Create `DeckDocumentView` wrapper component that:
  - Manages deck state (load from `deck-store`, handle re-analyze/challenge)
  - Renders deck-specific top bar (name, timestamp, re-analyze, challenge buttons)
  - Passes synthetic `Board` + stream state to `DocumentView`
  - Handles follow-up chip clicks → inject into sidebar chat
- Challenge callout: new card type or inline rendering within `AnalysisPanel` in `card-renderer.tsx`

### 5. Upload UX: Phased progressive reveal
Navigate to board page **instantly** on upload click (before server responds). Three-phase reveal:

**Phase 0 — Instant (0s):** Full-page loading state with filename + 3-step progress explainer ("We'll break each slide into a section with live charts, AI analysis, and follow-up questions"). Teaches the user what to expect.

**Phase 1 — After extraction (~30s):** Server sends new `extraction_complete` event with all slide titles, chart types, and metric names. Client populates the full document skeleton with real section titles and labeled chart placeholders ("Generating line chart for Daily Revenue..."). Each skeleton section shows where the chart, AI analysis, and follow-up questions will go.

**Phase 2 — Per slide_complete:** Skeleton sections replace with real charts and AI analysis as each completes. Progress bar advances. Brief highlight/fade-in on newly completed sections.

**Phase 3 — Done:** Progress bar disappears. All sections have real content.

Server changes: new `extraction_complete` event type + granular progress stages (`uploading_file` → `processing_file` → `reading_slides` → `extraction_complete` → per-slide `analyzing`).

Client changes: `useDeckUploadToBoard` creates board + navigates immediately, handles progress events (not no-op), `ActivePdfStream` carries stage info + extracted slide metadata for skeleton rendering.

### 6. Chart interaction: Data-point click → sidebar chat
Clicking a data point on a chart injects that chart's context into sidebar chat (existing `handleDeckDataPointClick` behavior, preserved).

## Section Layout Per Slide

Each slide becomes one `BoardSection` containing:

1. **Chart card** — full-width or half-width, live data from SQL execution. `colSpan: 2` for prominence.
2. **Analysis text card** — AI commentary, rendered via `AnalysisPanel`. Contains:
   - Commentary markdown
   - Challenge callout (if challenge has been run) — inline below commentary
   - Follow-up chips at the bottom — click injects into sidebar chat
3. **Additional charts** — if a slide has multiple `chartSpecs`, each gets its own card in the grid.

## Deck-Specific Top Bar

```
← Back to Decks    Weekly Business Review Jan 16-22    analyzed 5 min ago    [↻ Re-analyze] [Challenge deck]
```

- **Re-analyze**: same API flow, streams `slide_complete` events, sections update in place
- **Challenge deck**: same API flow, challenge callouts appear inline in each section after completion
- **"View research ↗"**: replaces Challenge button after challenge is run, opens challenge conversation

## What Changes

| Component | Change |
|-----------|--------|
| `/decks/[id]/page.tsx` | Import `DeckDocumentView` instead of `DeckCanvas` |
| New: `deck-document-view.tsx` | Wrapper: deck state + top bar + DocumentView composition |
| `deck-to-board.ts` | Enhance `deckSlideToSection()` to include challenge callout data, follow-up chips with `silentContext` |
| `card-renderer.tsx` | Add challenge callout rendering inside `AnalysisPanel` (or as inline block below text cards) |
| `deck-canvas.tsx` | Preserved but no longer default. Could be removed later or kept as alternative view. |
| `deck-upload.ts` | Adapt to navigate immediately + stream into document view |

## What Stays the Same

- 3 of 4 API routes (`/ask`, `/challenge`, `/reanalyze`) — no changes
- `/api/decks/process` — adds new `extraction_complete` event + granular progress stages (backward-compatible, additive)
- `deck-store.ts` — same data model
- Sidebar chat integration — follow-up chips inject context, chart clicks inject context
- Conversation auto-creation for commentary threads

## Resolved Questions

1. **Sticky TOC / minimap for slide navigation?** Yes, but deferred. Not in the initial build. Will add a nav rail later if scrolling through many slides becomes a pain point.

2. **Remove tldraw canvas or keep as toggle?** Keep as toggle. Deck detail page will have a document/canvas view switch (like boards). Document view is the default. Canvas remains as an alternative spatial exploration mode.
