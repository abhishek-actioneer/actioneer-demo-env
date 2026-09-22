# Deck Challenge Cards & Human Comments — Design Spec

**Date:** 2026-03-12
**Status:** Draft

---

## Problem

Challenge cards on the deck canvas are currently read-only. Clicking them does nothing. There is also no way for humans to annotate slides with their own observations, and no mechanism for AI to respond to those annotations in context.

## Goal

1. Make challenge cards interactive — clicking opens a conversation thread for discussion.
2. Let humans annotate any hub card with comments.
3. Add an "Update with comments" pass that generates per-comment AI reply cards on the canvas.

---

## Interaction Design

### Comment icon on hub cards
- A small comment icon appears in the top-right corner of each hub (chart) card.
- A small dot badge appears on the icon when the card has `author: "user"` comments.
- Clicking the icon emits `canvasEvent("open-comments", cardId)`.
- `DeckCanvas` listens and opens `<CardCommentThread boardId={deckId} cardId={commentCardId} />` in a side panel.

### Challenge cards become clickable
- Clicking a challenge card emits the same `canvasEvent("open-comments", cardId)`.
- When `slideToCards()` builds a challenge card, it pre-populates `card.comments` with the challenge summary as a full `CardComment`: `{ id: createId(), cardId: card.id, author: "system", content: challengeCard.summary, timestamp: new Date().toISOString() }`. `CardCommentThread` reads comments from `board-store.getCardComments(boardId, cardId)` at open time — no component changes needed; the pre-populated system message appears as the first message in the thread.
- User can reply in the thread; AI responds via the existing `/api/canvas-comment` endpoint (POST, non-streaming, takes `{ cardId, boardId, comment, cardContext }`, returns a discriminated union `{ type: "response" | "update" | "note", text?: string, newCard?: ..., updatedFields?: ..., annotations?: ... }` — `CardCommentThread` already handles this contract).
- `BoardCard.comments: CardComment[]` already exists in `board-types.ts` — no schema change needed.

### Comment icons scope
- Comment icons appear on **hub cards and challenge cards only**. Analysis and follow-up satellite cards are not commentable.

### "Update with comments" toolbar button
- Appears in the deck toolbar alongside "Re-analyze" and "View research".
- **Enabled only** when at least one board card in this deck has at least one comment with `author: "user"` (the `CardComment.author` discriminator distinguishes user vs. pre-populated system messages).
- Shows a pulsing dot indicator while the update is running.
- On success: new REPLY satellite cards appear on the canvas.
- On error: pulsing dot stops; a brief inline error message appears in the toolbar ("Update failed — try again"). Partial results are not shown; the update is all-or-nothing.

---

## New Card Type: `"response"`

Reply cards are `BoardCard` objects of type `"response"` added to the board store (ephemeral — they do not persist to the deck store and are lost on page reload; no UI indicator of ephemerality is needed for now):

- **Content:** User's comment quoted as a blockquote, followed by the AI response in markdown.
- **Visual:** Uses existing monochrome design tokens only — `border` for card border, `muted` background, `muted-foreground` for the label. No color accents.
- **Positioning:** Added to the satellite column for their slide. Reply cards for a hub card's comments stack after the last existing satellite for that slide (challenge card if present, else follow-ups, else analysis), using the same `SAT_OFFSET_X` and incrementing `satRow`. If a hub card has 3 comments, 3 reply cards are stacked sequentially.

---

## New API Endpoint

`POST /api/decks/[id]/update-with-comments`

**Request:**
```typescript
{
  commentedCards: Array<{
    cardId: string;
    slideIndex: number;
    slideTitle: string;
    slideCommentary: string;
    sql: string;
    data: Record<string, string | number>[];  // first 10 rows only — consistent with other endpoints
    comments: Array<{ id: string; content: string }>;  // author: "user" comments only
  }>
}
```

**Response (success):**
```typescript
{
  replies: Array<{
    cardId: string;
    commentId: string;
    commentText: string;   // echoed for quoting in the reply card
    responseText: string;  // AI markdown response
  }>
}
```

**Error responses:**
- `404` — deck not found
- `422` — prompt context exceeds token limit
- `500` — Gemini call failed; client shows inline toolbar error

**Gemini prompt per comment:** slide title + commentary + SQL + first 10 data rows + user comment → focused 1–3 paragraph analyst response.
**Model:** `gemini-2.0-flash` (same as rest of app).

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/components/deck/deck-canvas.tsx` | Add comment icon to hub cards; handle challenge card click; listen for `open-comments` event; render `<CardCommentThread>`; add "Update with comments" button + handler; insert `"response"` `BoardCard` objects after API response; update `slideToCards()` to pre-populate challenge card system comment |
| `src/app/api/decks/[id]/update-with-comments/route.ts` | New endpoint — collect user comments, call Gemini per comment, return replies |
| `src/lib/board-types.ts` | Add `"response"` to the `CardType` union |

**Reused without changes:**
- `src/components/canvas/card-comment-thread.tsx` — comment panel component
- `src/lib/board-store.ts` — `addCardComment`, `getCardComments`, `saveBoard`
- `src/components/canvas/canvas-events.ts` — event bridge
- `src/app/api/canvas-comment/route.ts` — live AI reply in thread

---

## TODO (Future)

- Evaluate a stronger model (e.g. `gemini-2.5-pro`) for initial deck slide parsing in `/api/decks/[id]/analyze`.
- Consider persisting reply cards to the deck store so they survive page reload.
