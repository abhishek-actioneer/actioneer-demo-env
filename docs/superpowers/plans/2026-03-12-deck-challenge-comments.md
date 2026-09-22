# Deck Challenge Comments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make challenge cards clickable (opens comment thread), add per-slide comment icons on hub cards, and add an "Update with comments" toolbar button that generates per-comment AI reply satellite cards.

**Architecture:** Reuse `CardCommentThread` component and the canvas event bridge (`onCanvasEvent`/`emitCanvasEvent`) already used by the canvas page. Wire the deck canvas to listen for `"open-comments"` events. Add a new API endpoint that processes all user comments across slides in one batch Gemini call. Reply cards are ephemeral `BoardCard` objects inserted into the board store after the batch runs.

**Tech Stack:** Next.js App Router · React · tldraw (`TldrawCanvas`) · board-store (in-memory + localStorage) · `@google/genai` (Gemini)

**Spec:** `docs/superpowers/specs/2026-03-12-deck-challenge-comments-design.md`

---

## Chunk 1: Foundation — CardType + ChallengeRenderer wiring

### Task 1: Add `"response"` to `CardType` and wire the missing `ChallengeRenderer`

**Pre-read:** `src/lib/board-types.ts`, `src/components/canvas/shapes/card-content.tsx`

**Note:** `ChallengeRenderer` exists at `src/components/canvas/card-renderers/challenge-renderer.tsx` but is NOT imported in `card-content.tsx`. Challenge cards currently fall through to `default: ChartRenderer`. This task fixes that AND adds `"response"`.

**Files:**
- Modify: `src/lib/board-types.ts`
- Modify: `src/components/canvas/shapes/card-content.tsx`

- [ ] **Step 1: Add `"response"` to the `CardType` union**

In `src/lib/board-types.ts`, change:
```typescript
export type CardType =
  | "chart"
  | "table"
  | "metric"
  | "sql"
  | "text"
  | "sticky"
  | "follow-up"
  | "report"
  | "parameter"
  | "segment"
  | "challenge";
```
to:
```typescript
export type CardType =
  | "chart"
  | "table"
  | "metric"
  | "sql"
  | "text"
  | "sticky"
  | "follow-up"
  | "report"
  | "parameter"
  | "segment"
  | "challenge"
  | "response";
```

- [ ] **Step 2: Import `ChallengeRenderer` in `card-content.tsx` and add both cases**

At the top of `src/components/canvas/shapes/card-content.tsx`, add the import after the existing renderer imports:
```typescript
import { ChallengeRenderer } from "../card-renderers/challenge-renderer";
```

In the switch statement, add two cases before `default`:
```typescript
    case "challenge":
      content = <ChallengeRenderer {...rendererProps} />;
      break;
    case "response":
      content = <TextRenderer {...rendererProps} />;
      break;
```

Update the `autoHeight` line to include `"response"` but NOT `"challenge"` (challenge cards are fixed 200px):
```typescript
const autoHeight = card.type === "text" || card.type === "report" || card.type === "response";
```

- [ ] **Step 3: Run the dev server and verify**

```bash
pnpm dev
```
Navigate to a deck that has challenge cards. Confirm they render the challenge text (title + summary) rather than a blank chart. No TypeScript errors in terminal.

- [ ] **Step 4: Commit**

```bash
git add src/lib/board-types.ts src/components/canvas/shapes/card-content.tsx
git commit -m "feat(deck): add response CardType, wire ChallengeRenderer in card-content"
```

---

### Task 2: Fix `ShapeToolbar` comment badge to only show for user-authored comments

**Why:** Challenge cards will be pre-populated with a system comment. Without this fix, the dot badge would appear on every challenge card immediately, misleading users.

**Files:**
- Modify: `src/components/canvas/card-renderers/shared.tsx`

- [ ] **Step 1: Update `hasComments` in `ShapeToolbar`**

In `src/components/canvas/card-renderers/shared.tsx`, find this block (around line 258):
```typescript
  const hasComments = boardId
    ? (getBoardCard(boardId, canvasItemId)?.comments?.length ?? 0) > 0
    : false;
```
Replace with:
```typescript
  const hasComments = boardId
    ? (getBoardCard(boardId, canvasItemId)?.comments?.filter(
        (c) => c.author === "user"
      ).length ?? 0) > 0
    : false;
```

Note: `getBoardCard` is called synchronously on every render — this is the existing pattern in this file and is intentional for reactivity. Do not add `useMemo` here.

- [ ] **Step 2: Verify no TypeScript errors**

```bash
pnpm build 2>&1 | grep -E "error TS" | head -20
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/canvas/card-renderers/shared.tsx
git commit -m "fix(canvas): comment badge only shows for user-authored comments"
```

---

## Chunk 2: Comment panel wiring in DeckCanvas

### Task 3: Pre-populate challenge card comments in `slideToCards()`

**Files:**
- Modify: `src/components/deck/deck-canvas.tsx`

- [ ] **Step 1: Update the challenge card in `slideToCards()` — inline approach**

In `slideToCards()`, find the challenge card block (around line 98):
```typescript
  if (slide.challengeCard) {
    cards.push({
      id: `${boardId}-slide-${slide.index}-challenge`,
      boardId,
      type: "challenge",
      title: slide.challengeStale ? "Challenge (stale)" : "Challenge",
      markdownContent: slide.challengeCard.summary,
      position: { x: baseX + SAT_OFFSET_X, y: baseY + satRow * (SAT_H + 16) },
      size: { width: SAT_W, height: 200 },
      author: "system",
      refreshCadence: "manual",
      pinnedAt: now,
      comments: [],
    });
  }
```

Replace with (note: declare `challengeId` as a `const` first so we can reference it in the comments seed):
```typescript
  if (slide.challengeCard) {
    const challengeId = `${boardId}-slide-${slide.index}-challenge`;
    cards.push({
      id: challengeId,
      boardId,
      type: "challenge",
      title: slide.challengeStale ? "Challenge (stale)" : "Challenge",
      markdownContent: slide.challengeCard.summary,
      position: { x: baseX + SAT_OFFSET_X, y: baseY + satRow * (SAT_H + 16) },
      size: { width: SAT_W, height: 200 },
      author: "system",
      refreshCadence: "manual",
      pinnedAt: now,
      comments: [
        {
          id: `${challengeId}-system-seed`,
          cardId: challengeId,
          author: "system" as const,
          content: slide.challengeCard.summary,
          timestamp: now,
        },
      ],
    });
  }
```

No new imports needed for this step — the `CardComment` type is inferred from the `comments: CardComment[]` field on `BoardCard`.

- [ ] **Step 2: Verify dev server — challenge cards still render, no console errors**

```bash
pnpm dev
```
Open a deck with challenge cards. They should render as before.

- [ ] **Step 3: Commit**

```bash
git add src/components/deck/deck-canvas.tsx
git commit -m "feat(deck): pre-populate challenge card comment with challenge summary"
```

---

### Task 4: Add comment panel state + event listener to `DeckCanvas`

**Files:**
- Modify: `src/components/deck/deck-canvas.tsx`

- [ ] **Step 1: Add imports**

Add to the imports in `deck-canvas.tsx`:
```typescript
import { onCanvasEvent } from "@/components/canvas/canvas-events";
import { CardCommentThread } from "@/components/canvas/card-comment-thread";
```

- [ ] **Step 2: Add `commentCardId` and `commentVersion` state**

Inside `DeckCanvas`, after the existing state declarations:
```typescript
const [commentCardId, setCommentCardId] = useState<string | null>(null);
// commentVersion increments when a comment is added, triggering re-evaluation of hasUserComments
const [commentVersion, setCommentVersion] = useState(0);
```

- [ ] **Step 3: Register the `open-comments` event listener**

Add a new `useEffect` after the existing deck-loading one. `onCanvasEvent` returns a cleanup function — return it so the handler is unregistered on unmount (prevents memory leaks across navigation):
```typescript
  useEffect(() => {
    return onCanvasEvent("open-comments", (cardId) => {
      setCommentCardId((prev) => (prev === cardId ? null : cardId));
    });
  }, []);
```

- [ ] **Step 4: Render `CardCommentThread` alongside the canvas**

In the JSX, change the canvas wrapper from:
```typescript
      {/* Canvas */}
      <div className="flex-1 min-h-0">
        <DrilldownHandlerProvider handler={handleDeckDataPointClick}>
          <TldrawCanvas boardId={boardId} />
        </DrilldownHandlerProvider>
      </div>
```
to:
```typescript
      {/* Canvas + comment panel */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          <DrilldownHandlerProvider handler={handleDeckDataPointClick}>
            <TldrawCanvas boardId={boardId} />
          </DrilldownHandlerProvider>
        </div>
        {commentCardId && (
          <CardCommentThread
            boardId={boardId}
            cardId={commentCardId}
            onClose={() => setCommentCardId(null)}
            onCommentAdded={() => setCommentVersion((v) => v + 1)}
          />
        )}
      </div>
```

- [ ] **Step 5: Verify interaction**

```bash
pnpm dev
```
1. Open a deck with slides
2. Click a hub (chart) card to select it; click the comment icon in the toolbar → panel opens with empty thread
3. Click the icon again → panel closes
4. Run "Challenge deck" if not already done
5. Click a challenge card; click its comment icon → panel opens with the challenge summary as first message
6. Confirm no dot badge on the comment icon until you type and submit a user comment

- [ ] **Step 6: Commit**

```bash
git add src/components/deck/deck-canvas.tsx
git commit -m "feat(deck): wire comment panel — challenge + hub cards open CardCommentThread"
```

---

## Chunk 3: "Update with comments" — toolbar button + API

### Task 5: Add `handleUpdateWithComments` + toolbar button

**Files:**
- Modify: `src/components/deck/deck-canvas.tsx`

- [ ] **Step 1: Add required imports**

Add to imports at the top of `deck-canvas.tsx`:
```typescript
import { getBoardCards, saveBoardCard } from "@/lib/board-store";
import { apiFetch } from "@/lib/api-client";
```

- [ ] **Step 2: Add `updateInProgress` state**

```typescript
const [updateInProgress, setUpdateInProgress] = useState(false);
```

- [ ] **Step 3: Add `hasUserComments` derived value**

Add after the state declarations. Uses `commentVersion` (from Task 4 Step 2) as a dependency so it re-evaluates whenever a new comment is added:
```typescript
  const hasUserComments = React.useMemo(
    () =>
      deck
        ? getBoardCards(boardId).some((card) =>
            card.comments.some((c) => c.author === "user")
          )
        : false,
    // commentVersion is the reactivity hook — incremented by onCommentAdded
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deck, boardId, commentVersion]
  );
```

Note: `React` is already available since this file uses JSX. If `React` isn't explicitly imported, add `import React from "react"` or use `useMemo` directly (it's already destructured from `"react"` if the file uses `useState`/`useCallback`).

- [ ] **Step 4: Add `handleUpdateWithComments`**

Add after `handleChallenge`:

```typescript
  const handleUpdateWithComments = useCallback(async () => {
    if (!deck || updateInProgress) return;
    setUpdateInProgress(true);

    // Collect all board cards for this deck that have user-authored comments
    const allCards = getBoardCards(boardId);
    const commentedCards = allCards
      .map((card) => {
        const userComments = card.comments.filter((c) => c.author === "user");
        if (userComments.length === 0) return null;

        // Derive slideIndex from card ID: `${boardId}-slide-${index}-hub` or `-challenge`
        const match = card.id.match(/-slide-(\d+)-/);
        const slideIndex = match ? parseInt(match[1], 10) : -1;
        const slide = slideIndex >= 0 ? deck.slides[slideIndex] : undefined;
        if (!slide) return null;

        return {
          cardId: card.id,
          slideIndex,
          slideTitle: slide.title,
          slideCommentary: slide.commentary,
          sql: slide.sql,
          data: (slide.data as Record<string, string | number>[]).slice(0, 10),
          comments: userComments.map((c) => ({ id: c.id, content: c.content })),
        };
      })
      .filter(Boolean);

    if (commentedCards.length === 0) {
      setUpdateInProgress(false);
      return;
    }

    try {
      const { replies } = await apiFetch<{
        replies: Array<{
          cardId: string;
          commentId: string;
          commentText: string;
          responseText: string;
        }>;
      }>(`/api/decks/${deckId}/update-with-comments`, {
        method: "POST",
        body: { commentedCards },
      });

      const now = new Date().toISOString();

      // For each slide, track how many reply cards we've already inserted
      // so we can stack them below existing satellites.
      const replyCountBySlide: Record<number, number> = {};

      for (const reply of replies) {
        const match = reply.cardId.match(/-slide-(\d+)-/);
        if (!match) continue;
        const slideIndex = parseInt(match[1], 10);

        // Positioning: find the bottom edge of the last existing satellite for this slide,
        // then place the reply card below it.
        const slideCards = allCards.filter(
          (c) =>
            c.id.startsWith(`${boardId}-slide-${slideIndex}-`) &&
            !c.id.endsWith("-hub")
        );
        const maxBottom = slideCards.reduce(
          (max, c) => Math.max(max, c.position.y + c.size.height),
          (() => {
            // Fall back to hub card bottom if no satellites
            const colIdx = slideIndex % GRID_COLS;
            const rowIdx = Math.floor(slideIndex / GRID_COLS);
            return rowIdx * (CARD_H + ROW_GAP) + CARD_H;
          })()
        );

        const replyOffset = replyCountBySlide[slideIndex] ?? 0;
        replyCountBySlide[slideIndex] = replyOffset + 1;

        const colIdx = slideIndex % GRID_COLS;
        const replyY = maxBottom + 16 + replyOffset * (SAT_H + 16);
        const replyX = colIdx * (CARD_W + COL_GAP + SAT_W + 40) + SAT_OFFSET_X;

        saveBoardCard({
          id: `${boardId}-reply-${reply.commentId}`,
          boardId,
          type: "response",
          title: "Reply",
          markdownContent: `> ${reply.commentText}\n\n${reply.responseText}`,
          position: { x: replyX, y: replyY },
          size: { width: SAT_W, height: SAT_H },
          author: "system",
          refreshCadence: "manual",
          pinnedAt: now,
          comments: [],
        });
      }
    } catch (err) {
      console.error("[deck] update-with-comments failed", err);
    } finally {
      setUpdateInProgress(false);
    }
  }, [deck, deckId, boardId, updateInProgress]);
```

- [ ] **Step 5: Add the toolbar button**

In the top bar JSX, add after the Challenge button:
```typescript
        {hasUserComments && (
          <button
            onClick={handleUpdateWithComments}
            disabled={updateInProgress}
            className="text-xs px-3 py-1.5 border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 relative"
          >
            {updateInProgress ? "Updating..." : "Update with comments"}
            {updateInProgress && (
              <span
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "var(--foreground)",
                  animation: "accent-pulse 2s ease-in-out infinite",
                }}
              />
            )}
          </button>
        )}
```

- [ ] **Step 6: Verify build passes**

```bash
pnpm build 2>&1 | grep -E "error TS" | head -20
```
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/deck/deck-canvas.tsx
git commit -m "feat(deck): add Update with comments toolbar button and handler"
```

---

### Task 6: New `/api/decks/[id]/update-with-comments` route

**Note:** This route uses `getDeck()` from `deck-store` — an in-memory store populated server-side. This matches the pattern used by `challenge/route.ts` and `reanalyze/route.ts` in the same directory.

**Files:**
- Create: `src/app/api/decks/[id]/update-with-comments/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, createUserContent } from "@google/genai";
import { getDeck } from "@/lib/deck-store";

export const maxDuration = 120;
export const runtime = "nodejs";

const MAX_PROMPT_CHARS = 80_000;

interface CommentedCard {
  cardId: string;
  slideIndex: number;
  slideTitle: string;
  slideCommentary: string;
  sql: string;
  data: Record<string, string | number>[];
  comments: Array<{ id: string; content: string }>;
}

interface Reply {
  cardId: string;
  commentId: string;
  commentText: string;
  responseText: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: deckId } = await params;

  const deck = getDeck(deckId);
  if (!deck) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const body = (await req.json()) as { commentedCards: CommentedCard[] };
  const { commentedCards } = body;

  if (!Array.isArray(commentedCards) || commentedCards.length === 0) {
    return NextResponse.json({ replies: [] });
  }

  const apiKey = process.env.GEMINI_API_KEY!;
  const ai = new GoogleGenAI({ apiKey });
  const modelId = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

  const replies: Reply[] = [];

  for (const card of commentedCards) {
    for (const comment of card.comments) {
      const prompt = `You are a senior data analyst reviewing a business intelligence slide.

Slide: ${card.slideTitle}
Analysis: ${card.slideCommentary.slice(0, 400)}
SQL: ${card.sql.slice(0, 200)}
Sample data (first 10 rows): ${JSON.stringify(card.data.slice(0, 10))}

Analyst comment: "${comment.content}"

Respond to the analyst's comment with 1–3 focused paragraphs. Reference the data directly where relevant. Be concise and specific.`;

      if (prompt.length > MAX_PROMPT_CHARS) {
        return NextResponse.json(
          { error: "Deck context too large to process (exceeds limit)" },
          { status: 422 }
        );
      }

      try {
        const result = await ai.models.generateContent({
          model: modelId,
          contents: createUserContent([prompt]),
        });
        replies.push({
          cardId: card.cardId,
          commentId: comment.id,
          commentText: comment.content,
          responseText: result.text ?? "No response generated.",
        });
      } catch (err) {
        console.error("[update-with-comments] Gemini error for comment", comment.id, err);
        return NextResponse.json(
          { error: "AI processing failed" },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({ replies });
}
```

- [ ] **Step 2: Run build to check types**

```bash
pnpm build 2>&1 | grep -E "error TS" | head -20
```
Expected: no errors in the new route.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/decks/[id]/update-with-comments/route.ts
git commit -m "feat(deck): add update-with-comments API endpoint"
```

---

## Chunk 4: End-to-End Verification

### Task 7: Full manual verification

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Verify comment panel on hub cards**

1. Open any deck that has slides
2. Click a hub (chart) card to select it — `ShapeToolbar` appears
3. Click the comment icon → `CardCommentThread` panel opens on the right
4. Type a comment, press Enter → comment appears in thread
5. Close panel; re-select card → dot badge appears on the comment icon
6. Badge does NOT appear before any user comments are added

- [ ] **Step 3: Verify comment panel on challenge cards**

1. Run "Challenge deck" to generate challenge cards if not already present
2. Click a challenge card to select it
3. Click its comment icon → panel opens with the challenge summary as the first system message
4. Confirm **no dot badge** before you add a user comment
5. Add a user comment → dot badge appears on subsequent selection

- [ ] **Step 4: Verify "Update with comments" and reply card positioning**

1. With user comments on at least one card, confirm "Update with comments" button appears
2. Click it → button shows "Updating..." with pulsing dot
3. After completion → new REPLY cards appear below the last satellite for each commented slide
4. Each reply card shows the original comment quoted (as `> comment text`) + AI response below
5. No existing cards were modified
6. Reload the page → reply cards are gone (ephemeral, as expected)

- [ ] **Step 5: Verify lint passes**

```bash
pnpm lint
```
Expected: 0 errors.

- [ ] **Step 6: Final commit if anything remains staged**

```bash
git status
```

---

## File Summary

| File | Action |
|------|--------|
| `src/lib/board-types.ts` | Add `"response"` to `CardType` union |
| `src/components/canvas/shapes/card-content.tsx` | Import `ChallengeRenderer`; add `"challenge"` and `"response"` cases; `"response"` added to `autoHeight` |
| `src/components/canvas/card-renderers/shared.tsx` | Filter `ShapeToolbar` comment badge to `author === "user"` only |
| `src/components/deck/deck-canvas.tsx` | Pre-populate challenge card comments inline; add comment panel state + listener; render `CardCommentThread`; add `commentVersion` for reactivity; add "Update with comments" button + handler |
| `src/app/api/decks/[id]/update-with-comments/route.ts` | New endpoint — per-comment Gemini calls, return reply cards |

**Reused without changes:** `card-comment-thread.tsx` · `board-store.ts` · `canvas-events.ts` · `canvas-comment` route
