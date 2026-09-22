---
title: "feat: Add Follow-up Question FAB to Deck Canvas"
type: feat
date: 2026-03-12
brainstorm: docs/brainstorms/2026-03-12-deck-follow-up-questions-brainstorm.md
---

# feat: Add Follow-up Question FAB to Deck Canvas

## Overview

A floating action button (FAB) on the deck canvas lets users ask follow-up questions referencing any existing card. The system generates either a new chart or a markdown block and places it as a persisted card near the referenced card — entirely within the canvas, without routing through the sidebar chat.

---

## Problem Statement

The deck canvas has no way to ask new questions. The only interactive affordance is "Ask about this" per card, which injects pre-filled text into the sidebar chat — requiring the user to switch context, type, wait for a response, and manually relate it back to the deck. There is no path from a chat response back to a canvas card. This creates friction between insight discovery and visual annotation of the deck.

---

## Proposed Solution

A canvas-native FAB button opens an inline modal with:
- A card reference dropdown (showing existing chart + text cards by title)
- A text input for the question

On submit, a `POST /api/decks/[id]/ask` endpoint generates SQL + chart data or a markdown answer (depending on the question), and the client places a new `BoardCard` near the referenced card. The card is persisted in `deck-store` and survives navigation.

---

## Technical Approach

### Architecture

```
[FAB Button] → [Question Modal]
     ↓               ↓
  DeckCanvas    POST /api/decks/[id]/ask
                     ↓
          generateQueries("quick") → executeSQL → buildChartSpec
                     OR
          Gemini direct → markdown
                     ↓
              { cardType, chartSpec?, data?, content? }
                     ↓
          saveBoardCard() + deck-store.addFollowUpCard()
                     ↓
          editor.createShapes([cardToShape(newCard)])
```

### Critical Technical Notes

1. **Editor ref capture**: `DeckCanvas` must hold a `useRef<Editor>` and pass `onEditorReady` to `TldrawCanvas` — this is the only way to call `editor.createShapes()` after mount without a full re-render. The prop already exists in `TldrawCanvasProps` but is unused.

2. **Persistence gap**: `DeckCanvas.useEffect` calls `clearBoardCards(boardId)` on mount and rebuilds from slides. Follow-up cards stored only in `board-store` would be wiped on navigation. Solution: add `followUpCards?: BoardCard[]` to the `Deck` interface and emit them in the mount effect alongside slide cards.

3. **SQL context function**: Always use `buildTextToSqlPrompt(datasetId)` from `@/lib/prompts/sql` — **never** `getSystemContext()` (which causes hallucinated table names).

4. **Pointer events**: Any clickable button in a tldraw shape requires `onPointerDownCapture` + `editor.markEventAsHandled(e)`, not just `onClick`. Tldraw captures pointer events during the bubble phase; `onPointerDownCapture` fires first.

---

### Implementation Phases

#### Phase 1: API Route — `POST /api/decks/[id]/ask`

**File:** `src/app/api/decks/[id]/ask/route.ts` *(new)*

**Input** (JSON body, read via `apiFetch`):
```typescript
interface AskBody {
  question: string;
  referencedCardId: string;  // to build context
  datasetId: string;
}
```

**Flow:**
1. Read `referencedCardId` → look up `getBoardCard(referencedCardId)` from board-store (imported server-side)
2. Build `pageContext` string:
   - If `card.type === "chart"`: `Chart: ${title}\nSQL: ${sql}\nData sample: ${JSON.stringify(data?.slice(0, 8))}`
   - If `card.type === "text"`: `Analysis commentary: ${markdownContent?.slice(0, 600)}`
3. Call `generateQueries(question, "quick", datasetId, modelId, pageContext)` — returns 1 `SubagentQuery`
4. `executeSQL(subquery.sql, datasetId)` → `rows: Record<string, unknown>[]`
5. If SQL execution succeeds and returns rows → `buildChartSpec(subquery, rows)` → return `{ cardType: "chart", title, chartSpec, data: rows }`
6. If SQL generation throws or rows are empty → fall back to Gemini direct answer:
   - `generateText(question, { systemPrompt: getSystemContext(datasetId) + pageContext })` → return `{ cardType: "text", title: question, content: markdownAnswer }`

**Response** (non-streaming JSON for MVP):
```typescript
interface AskResponse {
  cardType: "chart" | "text";
  title: string;
  chartSpec?: ChartSpec;
  data?: Record<string, unknown>[];
  content?: string;
}
```

**Headers**: reads `x-dataset-id` and `x-model-id` (consistent with other routes).

**Error handling**: on any top-level failure return `{ cardType: "text", title: question, content: "Could not generate an answer. Please try again." }` — always return a card, never 500.

---

#### Phase 2: Deck Store — Persist Follow-up Cards

**File:** `src/lib/deck-store.ts` *(modify)*

**Changes:**
1. Add `followUpCards?: BoardCard[]` to the `Deck` interface
2. Add `addFollowUpCard(deckId: string, card: BoardCard): void`:
   ```typescript
   export function addFollowUpCard(deckId: string, card: BoardCard): void {
     const deck = getDeck(deckId);
     if (!deck) return;
     const existing = deck.followUpCards ?? [];
     saveDeck({ ...deck, followUpCards: [...existing, card] });
   }
   ```
3. `saveDeck` already calls `invalidateCatalog()` — no change needed there.

---

#### Phase 3: DeckCanvas — Editor Ref + Mount Effect + Follow-up Card Emission

**File:** `src/components/deck/deck-canvas.tsx` *(modify)*

**Changes:**

1. Add `editorRef`:
   ```typescript
   const editorRef = useRef<Editor | null>(null);
   ```

2. Pass to `TldrawCanvas`:
   ```typescript
   <TldrawCanvas
     boardId={boardId}
     onEditorReady={(editor) => { editorRef.current = editor; }}
     hideToolbar
   />
   ```

3. In the mount `useEffect`, after the slide cards loop, also emit follow-up cards:
   ```typescript
   for (const card of deck.followUpCards ?? []) {
     saveBoardCard(card);
   }
   ```

4. Add `handleFollowUpGenerated(card: BoardCard)` callback:
   ```typescript
   function handleFollowUpGenerated(card: BoardCard) {
     saveBoardCard(card);
     addFollowUpCard(deckId, card);
     editorRef.current?.createShapes([cardToShape(card)]);
   }
   ```

---

#### Phase 4: Placement Helper

**File:** `src/components/deck/follow-up-placement.ts` *(new)*

**Function:**
```typescript
export function placeNearCard(
  referencedCard: BoardCard,
  existingCards: BoardCard[],
  newCardSize: { width: number; height: number },
): { x: number; y: number }
```

**Logic:**
- First candidate: `{ x: referencedCard.position.x + referencedCard.size.width + 20, y: referencedCard.position.y }`
- Check if any existing card overlaps this position (within 40px tolerance)
- If overlap, try `y + (referencedCard.size.height + 20)` offset (stack below)
- If still overlapping, cascade: `x + (newCardSize.width + 20)` per existing follow-up at that x
- Fallback: place at `x + width + 20, y + (conflicts * (height + 20))`

---

#### Phase 5: FAB Button + Question Modal

**File:** `src/components/deck/deck-follow-up-fab.tsx` *(new)*

**Component:** `DeckFollowUpFab`

**Props:**
```typescript
interface DeckFollowUpFabProps {
  deckId: string;
  boardId: string;
  onCardGenerated: (card: BoardCard) => void;
}
```

**UI structure:**
```
<div className="absolute bottom-6 right-6 z-50">
  <Button size="icon" onClick={() => setOpen(true)}>+</Button>

  <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent>
      <DialogHeader>Ask a follow-up question</DialogHeader>

      <Select value={selectedCardId} onValueChange={setSelectedCardId}>
        {cards.filter(c => c.type === "chart" || c.type === "text").map(card => (
          <SelectItem value={card.id}>{card.title || card.type}</SelectItem>
        ))}
      </Select>

      <Textarea
        placeholder="What do you want to know?"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
      />

      <DialogFooter>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button onClick={handleGenerate} disabled={!selectedCardId || !question || loading}>
          {loading ? "Generating…" : "Generate"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</div>
```

**`handleGenerate` logic:**
1. Set `loading = true`, close modal
2. Create a placeholder `BoardCard` (`type: "text"`, `markdownContent: "⏳ Generating answer…"`, positioned via `placeNearCard()`) — call `onCardGenerated(placeholder)` immediately to show loading state on canvas
3. Call `apiFetch<AskResponse>(`/api/decks/${deckId}/ask`, { method: "POST", body: { question, referencedCardId: selectedCardId, datasetId } })`
4. Build the real `BoardCard` from the response
5. Remove placeholder from canvas: `editorRef.current?.deleteShapes([cardIdToShapeId(placeholder.id)])`; also remove from board-store
6. Call `onCardGenerated(realCard)`
7. Set `loading = false`

**Note:** The FAB renders outside `<Tldraw>` as a positioned overlay `div` in `DeckCanvas` (not inside tldraw children slot) — this avoids tldraw pointer event interference entirely and is simpler.

---

#### Phase 6: Wire Into DeckCanvas

**File:** `src/components/deck/deck-canvas.tsx` *(modify)*

```typescript
// Inside DeckCanvas return JSX:
<div className="relative w-full h-full">
  <TldrawCanvas
    boardId={boardId}
    onEditorReady={(editor) => { editorRef.current = editor; }}
    hideToolbar
  />
  <DeckFollowUpFab
    deckId={deckId}
    boardId={boardId}
    onCardGenerated={handleFollowUpGenerated}
  />
</div>
```

---

## Acceptance Criteria

### Functional Requirements

- [x] A "+" FAB button is visible on the deck canvas at all times (bottom-right corner)
- [x] Clicking the FAB opens a modal with a card reference picker and question text input
- [x] The reference picker lists all `chart` and `text` cards on the current deck by title
- [x] Submitting the form (with a card selected and a non-empty question) closes the modal
- [x] A loading placeholder card ("⏳ Generating…") appears immediately near the referenced card on the canvas
- [x] After generation, the placeholder is replaced by a real `chart` or `text` card
- [x] Chart cards render with the correct `ChartSpec` and data (using existing `ChartRenderer`)
- [x] Text/markdown cards render the generated answer (using existing `TextRenderer`)
- [x] Generated cards are persisted to `deck-store` and survive navigation (go to `/decks`, return to deck — cards are still there)
- [x] Multiple follow-up cards from the same source are stacked below each other (no overlap)
- [x] If SQL generation fails, the fallback produces a `text` card with a markdown answer
- [x] Empty question or no card selected disables the Generate button

### Non-Functional Requirements

- [x] API response time ≤ 10s for a typical chart question (matches existing analyze endpoint)
- [x] FAB button does not interfere with tldraw pan/zoom (overlay div, not inside tldraw canvas)
- [x] No console errors or TypeScript errors introduced
- [x] `buildTextToSqlPrompt` is used for all SQL generation — not `getSystemContext`

### Edge Cases

- [x] Deck has no cards yet (still processing): FAB is visible but reference picker shows "No cards yet" placeholder and Generate is disabled
- [x] SQL generates but returns 0 rows: fallback to Gemini text answer with a message like "No data found for this question"
- [x] User navigates away mid-generation: no error; card just won't appear (in-flight fetch is abandoned)
- [x] User asks a question whose answer is already in the commentary: system still generates a new card (no deduplication)

---

## Dependencies & Prerequisites

- `src/lib/board-store.ts` — `getBoardCard(id)` must be importable server-side in the API route (it is, already in-memory)
- `src/lib/sql-generator.ts` — `generateQueries(query, "quick", datasetId)` for single-query mode
- `src/lib/sql-executor.ts` — `executeSQL(sql, datasetId)`
- `src/lib/chart-types.ts` — `buildChartSpec()` or equivalent
- `src/components/ui/dialog` — already added via shadcn
- `src/components/ui/select` — already added via shadcn
- `src/components/ui/textarea` — check if added; add via `npx shadcn add textarea` if not

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `clearBoardCards` wipes follow-up cards on re-mount | High (guaranteed without fix) | High | Store follow-up cards in `deck-store.followUpCards` and re-emit in mount effect |
| SQL context function confusion (`getSystemContext` vs `buildTextToSqlPrompt`) | Medium | High | Code review check + comment in API route |
| Placement overlap for many follow-up cards | Medium | Low | Cascade placement logic; proximity is enough for MVP |
| `editor.createShapes` called before `onEditorReady` fires | Low | Medium | Guard with `if (!editorRef.current) return` |
| Placeholder card left dangling if API fails | Low | Medium | Wrap in try/finally; always remove placeholder |

---

## Files Changed / Created

| File | Action | Purpose |
|---|---|---|
| `src/app/api/decks/[id]/ask/route.ts` | **Create** | New API endpoint for follow-up questions |
| `src/lib/deck-store.ts` | **Modify** | Add `followUpCards` to `Deck` + `addFollowUpCard()` |
| `src/components/deck/deck-canvas.tsx` | **Modify** | Editor ref, follow-up card emission in mount, wire FAB |
| `src/components/deck/deck-follow-up-fab.tsx` | **Create** | FAB button + question modal component |
| `src/components/deck/follow-up-placement.ts` | **Create** | Placement helper (near-card positioning logic) |

---

## Future Considerations

- **Streaming response**: Replace the non-streaming API with SSE (reuse `AnalyzeSSEEvent` patterns from `src/lib/sse-types.ts`) to show token-by-token text generation for markdown answers
- **Regenerate button**: Add a "↻" button to generated follow-up cards to re-run the question (already present on deck slides via `/api/decks/[id]/reanalyze` pattern)
- **Visual association**: Draw a tldraw arrow between the referenced card and the follow-up card using `editor.createShape({ type: "arrow", ... })`
- **Multi-card reference**: Allow the user to select 2-3 cards as context for cross-slide questions
- **Follow-up on follow-up**: Recursively reference a generated card to ask another question

---

## References

### Internal

- Brainstorm: `docs/brainstorms/2026-03-12-deck-follow-up-questions-brainstorm.md`
- tldraw shape patterns: `docs/solutions/design-patterns/tldraw-custom-shapes-canvas-rendering.md`
- Pointer event gotcha: `docs/solutions/ui-bugs/tldraw-interactive-html-buttons-not-clickable.md`
- Three-zone pointer model: `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`
- SQL context function bug: `docs/solutions/logic-errors/deck-processing-wrong-sql-context-function.md`

### Key Source Files

- `src/components/deck/deck-canvas.tsx` — slideToCards, mount effect, useChatPanel wiring
- `src/lib/board-types.ts` — BoardCard interface, CardType union
- `src/lib/deck-store.ts` — Deck/Slide store, mutation functions
- `src/app/api/decks/process/route.ts` — SQL generation pattern for deck context
- `src/components/canvas/tldraw-canvas.tsx` — cardToShape, onEditorReady prop
- `src/lib/sql-generator.ts` — generateQueries() signature
