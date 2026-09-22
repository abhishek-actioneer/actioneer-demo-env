---
title: "feat: Deck document view with phased progressive upload"
type: feat
status: completed
date: 2026-03-16
origin: docs/brainstorms/2026-03-16-deck-document-view-brainstorm.md
---

# Deck Document View with Phased Progressive Upload

## Overview

Replace the tldraw canvas at `/decks/[id]` with a document view (reusing the existing board `DocumentView` component) and add a phased progressive reveal during PDF upload so users see instant navigation, labeled skeleton sections, and real-time progress instead of a dead "Processing..." button.

The deck upload already works via the board path (`useDeckUploadToBoard` → `DocumentView`). This plan enhances that path with: (1) instant navigation + phased skeleton UI, (2) deck-specific top bar (re-analyze, challenge, view toggle), (3) inline challenge callouts, and (4) granular server-side progress events.

## Problem Statement / Motivation

1. **Dead zone on upload:** After clicking upload, the user stares at "+ Processing..." for 30-60 seconds on the list page. No feedback, no navigation, no indication of progress. The server is busy (Gemini file upload → polling → extraction) but the client ignores all progress events.

2. **Canvas is wrong for decks:** The tldraw spatial layout destroys the sequential narrative of a business review deck. No reading order, cramped satellite cards, floating follow-up answers, zoom/pan friction. Decision makers review decks top-to-bottom, not spatially.

3. **Missing deck features on board path:** The current board-from-deck path (`useDeckUploadToBoard`) produces a plain board. It lacks re-analyze, challenge, and the deck identity (name, timestamp, slide mapping).

(See brainstorm: `docs/brainstorms/2026-03-16-deck-document-view-brainstorm.md`)

## Proposed Solution

### Architecture

Enhance the existing board-from-deck path rather than building a separate `/decks/[id]` document view. When a board originates from a deck upload, it gets deck-specific features.

```
Upload PDF → create Board (with deckId metadata) → navigate to /canvas/[boardId] instantly
  → DocumentView renders with phased skeleton → sections fill as slides complete
  → Deck top bar shows re-analyze, challenge, view toggle (when board.deckId is set)
```

### Implementation Phases

---

#### Phase 1: Granular server progress events

**Goal:** Eliminate the 30-60s silent extraction phase by sending events at every meaningful stage.

**File: `src/app/api/decks/process/route.ts`**

Add new progress stages throughout the extraction pipeline:

```typescript
// Current: only one "extracting" heartbeat every 15s
// New: granular stages

send({ type: "progress", stage: "uploading_file" });
const uploadedFile = await ai.files.upload({ ... });

send({ type: "progress", stage: "processing_file" });
await waitForFileActive(ai, geminiFileName);

send({ type: "progress", stage: "reading_slides" });
const extraction = await ai.models.generateContent({ ... });

// NEW EVENT: send extraction metadata before processing slides
send({
  type: "extraction_complete",
  count: slidesToProcess.length,
  deckTitle: deckName,
  slides: slidesToProcess.map(s => ({
    index: s.index,
    title: s.title,
    charts: s.charts.map(c => ({
      chartType: c.chartType,
      metric: c.metric,
    })),
  })),
});

// Then per-slide processing continues as before with slide_complete events
```

Update `DeckProcessEvent` type in `src/lib/deck-upload.ts` to include new event variants:

```typescript
| { type: "progress"; stage: "uploading_file" | "processing_file" | "reading_slides"; slideIndex?: number }
| { type: "extraction_complete"; count: number; deckTitle: string; slides: ExtractedSlidePreview[] }
```

**Acceptance criteria:**
- [ ] Server emits `uploading_file` after Gemini upload call starts
- [ ] Server emits `processing_file` while polling `waitForFileActive`
- [ ] Server emits `reading_slides` before extraction LLM call
- [ ] Server emits `extraction_complete` with slide metadata after extraction, before slide processing
- [ ] Existing `total`, `slide_complete`, `done`, `error` events unchanged (backward compatible)
- [ ] `DeckProcessEvent` type updated with new variants

---

#### Phase 2: Instant navigation + phased skeleton UI

**Goal:** Navigate to the board page immediately on upload click. Show a 3-phase progressive reveal.

**File: `src/hooks/use-deck-upload-to-board.ts`**

Change the flow:

1. **On upload click (before fetch):** Create board + sentinel card → set stream to `"uploading"` → navigate immediately
2. **On `progress` events:** Update stream state with current stage string
3. **On `extraction_complete`:** Save skeleton sections (titles only, no cards yet) → update stream with extracted metadata
4. **On `slide_complete`:** Replace skeleton section's cards with real cards (existing behavior)
5. **On `done`:** Remove sentinel, clear stream (existing behavior)

```typescript
// Move board creation + navigation BEFORE fetch
const boardId = crypto.randomUUID();
saveBoard({ id: boardId, name: file.name, datasetId, viewMode: "document" });
saveBoardCard(sentinelCard);
setActivePdfStream({ boardId, status: "uploading", stage: "uploading_file" });
router.push(`/canvas/${boardId}`);

// Then start fetch...
const res = await fetch("/api/decks/process", { ... });
```

Handle `extraction_complete` event — create skeleton sections:

```typescript
if (event.type === "extraction_complete") {
  // Create sections with titles from extraction (no cards yet — those come with slide_complete)
  for (const slide of event.slides) {
    saveBoardSection({
      id: `${boardId}-section-${slide.index}`,
      boardId,
      title: slide.title,
      prose: "",
      order: slide.index,
    });
  }
  setActivePdfStream({
    boardId,
    status: "processing",
    completedSlides: 0,
    totalSlides: event.count,
    extractedSlides: event.slides, // NEW: carry metadata for skeleton rendering
  });
}
```

**File: `src/lib/deck-to-board-stream.ts`**

Extend `ActivePdfStream` type:

```typescript
type ActivePdfStream =
  | { boardId: string; status: "uploading"; stage?: string }
  | { boardId: string; status: "processing"; completedSlides: number; totalSlides: number;
      stage?: string; extractedSlides?: ExtractedSlidePreview[] }
  | { boardId: string; status: "done"; completedSlides: number; totalSlides: number }
  | { boardId: string; status: "error"; error: string; completedSlides: number };
```

**Acceptance criteria:**
- [ ] Board created and navigation happens within ~100ms of upload click (before server response)
- [ ] `ActivePdfStream` carries `stage` and `extractedSlides` metadata
- [ ] `extraction_complete` creates skeleton sections in board-store
- [ ] `slide_complete` populates sections with real cards (existing behavior preserved)
- [ ] Abort/cleanup on unmount still works correctly

---

#### Phase 3: Document view skeleton rendering

**Goal:** DocumentView shows a rich skeleton experience during upload instead of bare pulse rectangles.

**File: `src/components/board/document-view.tsx`**

**Phase 0 skeleton (status: "uploading", no sections yet):**

Show a centered loading state with the 3-step explainer:

```
  Uploading your deck...

  We'll break each slide into a section with
  live charts, AI analysis, and follow-up
  questions you can explore.

  ● Uploading
  ○ Reading slides
  ○ Generating charts & analysis
```

The active step updates as `stage` changes in `streamState`.

**Phase 1 skeleton (status: "processing", sections exist but cards loading):**

Sections already exist from `extraction_complete`. For sections that have no cards yet, render a labeled skeleton inside `SectionRenderer` or as a fallback in the section card area:

```
▼ Revenue Overview
┌─────────────────────────────────────────────┐
│  ░░░ Generating line chart                  │
│  ░░░ for "Daily Revenue"                    │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└─────────────────────────────────────────────┘

AI Analysis
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

Follow-up questions
[░░░░░░░░░░░░] [░░░░░░░░░░░░]
```

The chart type and metric come from `streamState.extractedSlides[i]`. These labeled placeholders teach the user what each area will contain.

**Phase 2 transition (slide_complete arrives):**

Section re-reads from board-store and gets real cards. The skeleton disappears, real chart + analysis fade in. Progress bar at top advances.

**Implementation approach:** Add a `renderSectionSkeleton(slidePreview)` function that takes extracted slide metadata and returns the labeled skeleton. DocumentView checks: if a section has 0 cards AND `streamState.extractedSlides` has metadata for it → render skeleton. Otherwise render cards normally.

**Acceptance criteria:**
- [ ] Phase 0 loading shows 3-step progress with active step indicator
- [ ] Phase 1 shows labeled skeleton sections with chart type + metric name from extraction
- [ ] Phase 2 transitions smoothly — skeleton replaced by real content
- [ ] Progress bar shows "X of Y slides analyzed"
- [ ] No flash/jump when skeleton → real content transition happens

---

#### Phase 4: Deck-specific top bar + features

**Goal:** When a board originated from a deck, show deck-specific controls.

**File: `src/lib/board-types.ts`**

Add deck metadata to Board type:

```typescript
interface Board {
  // ... existing fields
  deckId?: string;           // Links to deck-store
  deckUploadedAt?: number;   // For "analyzed X ago" display
}
```

**File: `src/components/board/canvas-top-bar.tsx` (or new `deck-top-bar.tsx`)**

When `board.deckId` is set, render deck-specific controls alongside the existing view toggle:

```
← Back    Weekly Business Review    analyzed 5 min ago    [Board ⬛ | Canvas ☐]    [↻ Re-analyze] [Challenge deck]
```

- **Re-analyze:** calls `POST /api/decks/${deckId}/reanalyze`, streams `slide_complete` events that update sections in-place. Reuses the same `ActivePdfStream` mechanism — set status to `"processing"`, sections update via board-store.
- **Challenge:** calls `POST /api/decks/${deckId}/challenge`, returns per-slide findings. Findings stored on the analysis text card (new field or via `silentContext`-like mechanism). Triggers challenge callout rendering.
- **View toggle:** existing Board/Canvas segmented control (already works in `CanvasPage`).

**File: `src/hooks/use-deck-upload-to-board.ts`**

When creating the board on upload, set `deckId` and `deckUploadedAt`:

```typescript
saveBoard({
  id: boardId,
  name: boardTitle,
  datasetId,
  viewMode: "document",
  deckId,                    // NEW
  deckUploadedAt: Date.now(), // NEW
});
```

**File: `src/components/canvas/canvas-page.tsx`**

Pass `board.deckId` to the top bar component so it can conditionally render deck controls.

**Acceptance criteria:**
- [ ] Board created from deck upload carries `deckId` metadata
- [ ] Top bar shows re-analyze + challenge buttons when `board.deckId` is set
- [ ] Re-analyze streams updates into existing sections
- [ ] Challenge creates inline callouts (Phase 5)
- [ ] "analyzed X ago" timestamp from `deckUploadedAt`
- [ ] View toggle works (document ↔ canvas)

---

#### Phase 5: Inline challenge callouts

**Goal:** Challenge findings render as inline callouts below analysis text, not as separate cards.

**File: `src/components/board/card-renderer.tsx`**

Extend `AnalysisPanel` to render a challenge callout when present:

```tsx
{card.challengeFindings && (
  <div className="mt-3 pt-3 border-t border-border">
    <div className="flex items-center gap-1.5 mb-1">
      <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs font-medium text-muted-foreground">Challenge</span>
    </div>
    <p className="text-sm text-muted-foreground leading-relaxed">
      {card.challengeFindings}
    </p>
  </div>
)}
```

**File: `src/lib/board-types.ts`**

Add `challengeFindings?: string` to `BoardCard` type.

**File: deck top bar challenge handler**

When challenge API returns findings, update the analysis text card in each section:

```typescript
for (const finding of response.findings) {
  const card = getAnalysisCardForSlide(boardId, finding.slideIndex);
  if (card) {
    saveBoardCard({ ...card, challengeFindings: finding.summary });
  }
}
```

**Acceptance criteria:**
- [ ] Challenge callout renders inline below analysis text in `AnalysisPanel`
- [ ] Monochrome styling (muted foreground, no color)
- [ ] Callout appears after challenge API completes, without page refresh
- [ ] Challenge findings persist on the card in board-store

---

#### Phase 6: Follow-up chips with silentContext

**Goal:** Follow-up chips in each section inject the slide's SQL + data context into sidebar chat.

This **already works** via `deckSlideToSection()` which sets `silentContext` from `buildFollowUpContext(slide)` on the analysis text card. The `AnalysisPanel` in `card-renderer.tsx` already calls `injectText(question, card.silentContext)` when a chip is clicked.

**Verify and fix if needed:**
- [ ] `deckSlideToSection()` sets `silentContext` on the text card (it does — confirmed in research)
- [ ] `AnalysisPanel` passes `silentContext` to `injectText()` (it does — confirmed)
- [ ] `silentContext` includes slide title, SQL, and sample data rows
- [ ] Chart data-point click injects context into sidebar chat (wire `onDataPointClick` through `CardRenderer`)

**File: `src/components/canvas/canvas-page.tsx`**

Wire `onDataPointClick` handler when `board.deckId` is set — injects chart context chip into sidebar chat via `injectChartContext` from `useChatPanel()`.

---

## Technical Considerations

### State flow
- Deck metadata lives in `deck-store` (in-memory). Board data lives in `board-store` (localStorage). The `board.deckId` field bridges them.
- `ActivePdfStream` singleton carries upload progress. `DocumentView` subscribes via `streamState` prop.
- Challenge findings stored directly on `BoardCard.challengeFindings` in board-store (persists via localStorage).

### Backward compatibility
- All new server events are additive. Old clients that don't handle `extraction_complete` will ignore it and still work via `total` + `slide_complete`.
- `Board.deckId` is optional — existing boards unaffected.
- `BoardCard.challengeFindings` is optional — existing cards unaffected.

### Card renderer safety
- Card renderers must remain tldraw-context-free (no `useEditor()` calls). The same renderers are used in both document and canvas views (see learning: `docs/solutions/runtime-errors/tldraw-useeditor-crash-outside-canvas-context-20260315.md`).

### Performance
- Skeleton sections created from extraction metadata are lightweight (title only, no cards).
- `slide_complete` handler saves 2-3 cards per section — same as current behavior.
- No additional API calls during upload — just better use of existing events.

## Acceptance Criteria

### Functional Requirements
- [ ] Upload click navigates to board page within ~100ms (before server response)
- [ ] 3-step progress explainer shown during initial upload phase
- [ ] Labeled skeleton sections appear after extraction with real slide titles + chart types
- [ ] Sections fill progressively as slides complete
- [ ] Progress bar shows "X of Y slides analyzed"
- [ ] Deck top bar with re-analyze, challenge, view toggle when board has `deckId`
- [ ] Challenge findings render as inline callouts in analysis sections
- [ ] Follow-up chips inject questions + silentContext into sidebar chat
- [ ] Chart data-point clicks inject context into sidebar chat
- [ ] Document ↔ Canvas view toggle works

### Non-Functional Requirements
- [ ] No regression in existing board creation/viewing
- [ ] No tldraw hooks in card renderers (document view safety)
- [ ] Monochrome UI (no colorful accents)

## Dependencies & Risks

- **Gemini File API latency** — the upload + polling + extraction phase is inherently slow (~30-60s). We can't speed it up, but we can make it feel fast with instant navigation + progressive feedback.
- **`deck-store` is in-memory** — if the server restarts during processing, deck state is lost. Re-analyze and challenge need the deck in memory. This is a known limitation, not addressed in this plan.
- **Board-store localStorage limits** — large decks with many charts could approach localStorage quota. Existing quota handling in board-store applies.

## Sources & References

### Origin
- **Brainstorm document:** [docs/brainstorms/2026-03-16-deck-document-view-brainstorm.md](../brainstorms/2026-03-16-deck-document-view-brainstorm.md) — Key decisions: reuse DocumentView, allow reordering, sidebar chat for follow-ups, inline challenge callouts, phased progressive upload reveal.

### Internal References
- `src/hooks/use-deck-upload-to-board.ts` — existing board-from-deck upload flow
- `src/components/board/document-view.tsx` — DocumentView component
- `src/components/board/card-renderer.tsx:AnalysisPanel` — analysis + follow-up chip rendering
- `src/lib/deck-to-board.ts:deckSlideToSection()` — slide → section/card conversion
- `src/lib/deck-to-board-stream.ts` — ActivePdfStream singleton
- `src/app/api/decks/process/route.ts` — PDF processing pipeline
- `src/components/board/canvas-top-bar.tsx` — existing view toggle
- `docs/solutions/runtime-errors/tldraw-useeditor-crash-outside-canvas-context-20260315.md` — card renderer safety
