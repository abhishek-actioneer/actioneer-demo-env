# Brainstorm: Follow-up Questions & Charts on a Deck

**Date:** 2026-03-12
**Status:** Ready for planning

---

## What We're Building

A floating action button (FAB) on the deck canvas that lets users ask a follow-up question referencing any existing card. The response — a chart or markdown block — is generated and placed as a new, persisted card near the referenced card.

**User journey:**
1. User is exploring a deck and has a question about a specific chart or commentary block
2. They click the FAB ("+") button in a corner of the canvas
3. An inline modal appears with a reference picker (lists existing cards by title) and a text input
4. User selects a card, types their question, and clicks "Generate"
5. A loading placeholder card appears near the referenced card
6. The response renders as either a `chart` card (if SQL was generated) or a `text` card (markdown answer)
7. The new card is saved to the deck and persists across navigation

---

## Why This Approach

The system already has:
- The full SQL generation + execution pipeline (`buildTextToSqlPrompt`, `sql-executor.ts`)
- A `BoardCard` type system with `chart` and `text` card types
- A `deck-store` that can save cards alongside slides
- `slideToCards()` that places new cards on the canvas based on board-store data
- An existing "Ask about this" button per card that fires into the sidebar chat

The gap is: no path from sidebar chat response → new canvas card. Rather than routing through the sidebar, this feature builds a focused inline flow that keeps the user on the canvas.

---

## Approaches Considered

### Approach A: Canvas-native FAB + inline modal (Recommended)

A small "+" FAB button renders in the deck canvas overlay (via the `<Tldraw>` children slot, which already renders inside tldraw context). Clicking opens a compact `Dialog`/`Sheet` with:
- A card reference dropdown (populated from current `getBoardCards(boardId)`)
- A text input for the question

On submit, calls a new `POST /api/decks/[id]/ask` endpoint:
- Input: `{ question, referencedCardId, deckId }`
- Builds context from the referenced card (chart spec + data sample, or text content)
- Calls SQL generation if question implies data → returns `ChartSpec + data`
- Falls back to Gemini direct answer → returns markdown string
- Response: `{ cardType: "chart" | "text", chartSpec?, data?, content? }`

Client creates a `BoardCard`, calls `saveBoardCard()` + `updateSlide()` / `saveDeck()` to persist, then positions the shape near the referenced card on the canvas.

**Pros:** Clean UX, stays on canvas, composable with existing card infrastructure, SSE streaming possible for the generation phase
**Cons:** New API endpoint needed, new placement logic for "near card" positioning

---

### Approach B: Extend "Ask about this" → "Pin to deck" button

Reuse the existing sidebar chat flow. When user asks via sidebar and gets a response, a "Pin as card" button appears on the chat message. Clicking it packages the message into a `BoardCard` and places it on the deck.

**Pros:** Zero new API surface, reuses all existing chat infrastructure
**Cons:** Indirect UX (user must switch to sidebar, then pin back), no inline experience, harder to position near a referenced card, couples deck canvas to sidebar state more tightly

---

### Approach C: Question card type (inline editable)

Add a `question` card type. The FAB drops a new blank question card on the canvas. User double-clicks it, types their question, presses enter. Card transforms in-place into a chart or text card.

**Pros:** Very native canvas feel, no modal
**Cons:** Complex: requires new card type, in-place card mutation, positional logic before the question is even formed. Defer to future.

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Trigger point | Floating FAB button | Discoverable without cluttering each card |
| Input UX | Inline canvas modal | Keeps user focused on deck, not sidebar |
| Card reference | Dropdown picker | Simple, works with all card types |
| Response type | Auto-detected (chart vs markdown) | Matches existing SQL-gen heuristics |
| Placement | Near referenced card (offset right + down) | Spatial relationship preserved |
| Persistence | Saved to deck-store | Survives navigation, consistent with existing slides |
| Streaming | Yes (SSE or polling) | Matches existing deck processing UX (shimmer placeholder) |

---

## Components to Build/Modify

1. **FAB button** — new component rendered in `DeckCanvas` inside `<Tldraw>` children (or as a positioned overlay `div`)
2. **Question modal** — `Dialog` with card picker + textarea. Can reuse shadcn `Dialog` + `Select`
3. **`POST /api/decks/[id]/ask`** — new route: reads referenced card context, runs classify→SQL/direct, returns typed response
4. **Loading placeholder card** — a transient `BoardCard` with `cardType: "loading"` or a shimmer overlay while generating
5. **Placement helper** — utility that takes a referenced card's tldraw shape position and returns a nearby coordinate (e.g. `x + width + 20`, same `y`)
6. **`deck-store` extension** — may need `addFollowUpCard(deckId, card)` that persists independent of slides
7. **`DeckCanvas` wiring** — connect modal submit → API call → card creation → canvas placement

---

## Open Questions

- **Card grouping**: Should follow-up cards be visually associated with their source (e.g. a drawn connector arrow or coloring)? Or is proximity enough?
- **Re-generation**: Should follow-up cards have a "Regenerate" button? Currently only deck slides have re-analyze.
- **Context depth**: How much data do we pass from the referenced card to the API? Full `data[]` rows or just summary/schema?
- **Multiple references**: Scope to single-card reference for now. Multi-card could be a follow-up.
- **Deck persistence layer**: deck-store is in-memory today. Follow-up cards survive the session but not server restart — same limitation as existing slides.
