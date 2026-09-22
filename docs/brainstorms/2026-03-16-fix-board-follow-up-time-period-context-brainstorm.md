# Fix: Board Follow-Up Questions Missing Time-Period Context

**Date:** 2026-03-16
**Type:** Bug fix / regression
**Branch:** fix/board-follow-up-time-period-context

---

## What We're Building

When a user clicks a "Dig Deeper" follow-up question on a board card, the resulting chat message should carry the card's time-period context (the date range used in the card's SQL). Currently, the follow-up question is sent with no `silentContext`, so the LLM responds generically without knowing the date range the board was generated for.

This is a regression introduced when `use-document-stream.ts` was extracted as a new hook. The equivalent deck flow (`deck-canvas.ts`) already does this correctly via `buildFollowUpContext(slide)`.

---

## Why This Happened

`use-document-stream.ts` (new, untracked file) handles the `suggestions` SSE event from `/api/canvas-query` and writes `followUpQuestions` directly onto the `BoardCard`:

```typescript
// use-document-stream.ts line ~237
updateDocCard(nodeId, boardId, { followUpQuestions: event.questions });
```

It sets no `silentContext` on the card. When `card-renderer.tsx` renders the "Dig Deeper" chips and calls `injectText(q, silentContext)`, the `silentContext` is `undefined`, so the LLM gets no date-range or SQL context.

**Reference implementation that works:** `deck-canvas.ts` line 69 — `buildFollowUpContext(slide)` builds a context string from the slide's SQL, commentary, and data sample. The board doc view needs the same treatment.

---

## Key Decisions

### What context to include in `silentContext`

The parent card (at the time the `suggestions` event fires) has:
- `card.sql` — the SQL query that generated this card, which contains the date filter
- `card.content` — the analysis text/commentary

The `silentContext` string should include both, mirroring `buildFollowUpContext`:

```
[Board context]
The user is viewing a board card with the following analysis:
<card.content>

This analysis was generated from the following SQL query:
<card.sql>

Use this context to answer follow-up questions accurately, including the same time period.
```

### Where to build it

In `use-document-stream.ts`, when handling the `suggestions` event: look up the parent card from the current board state and build `silentContext` before writing `followUpQuestions`.

Specifically: when `updateDocCard` is called for `followUpQuestions`, also pass `silentContext` built from the parent card's SQL + content.

### What data is available at that moment

At the time `suggestions` fires, we have:
- `targetCardId` — the card that generated the questions
- `boardId` — the current board
- The card's data is already in the board store (it was written by earlier SSE events like `card` and `sql`)

So we can call `getBoard(datasetId, boardId)` and find the card by `targetCardId` to get its SQL and content.

---

## Approach

**Minimal targeted fix — update `use-document-stream.ts` only:**

1. In the `suggestions` event handler, after receiving `event.targetCardId`, look up the parent card from board state.
2. Build a `silentContext` string from `parentCard.sql` + `parentCard.content`.
3. Pass `silentContext` alongside `followUpQuestions` when calling `updateDocCard`.
4. Ensure `BoardCard` type has a `silentContext?: string` field (check if it already exists).
5. `card-renderer.tsx` already passes `card.silentContext` to `injectText` — no change needed there.

This is a 1-file fix (plus possibly a type tweak) and directly mirrors the working deck implementation.

---

## Open Questions

- Does `BoardCard` already have a `silentContext` field, or does `board-types.ts` need updating?
- Is `getBoard` / the board store accessible inside `use-document-stream.ts`, or does the card data need to be passed differently?

---

## Files Affected

| File | Change |
|---|---|
| `src/hooks/use-document-stream.ts` | Build `silentContext` from parent card when handling `suggestions` event |
| `src/lib/board-types.ts` | Add `silentContext?: string` to `BoardCard` if missing |
| `src/lib/board-store.ts` | No change (read-only access via `getBoard`) |
| `src/components/board/card-renderer.tsx` | No change needed |
