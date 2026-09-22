---
title: "fix: Board follow-up questions missing time-period context"
type: fix
date: 2026-03-16
brainstorm: docs/brainstorms/2026-03-16-fix-board-follow-up-time-period-context-brainstorm.md
---

# fix: Board follow-up questions missing time-period context

## Overview

When a user clicks a "Dig Deeper" follow-up question on a board card, the chat message is sent with no `silentContext`. The LLM responds without knowing the date range, SQL, or analysis behind the card. This is a regression from extracting `use-document-stream.ts` as a new hook — the `suggestions` SSE handler was ported without the context-building logic that the deck flow has via `buildFollowUpContext`.

## Problem Statement

**Root cause:** `use-document-stream.ts` lines 237–244 handle the `suggestions` SSE event and write `followUpQuestions` to the `BoardCard`, but never set `silentContext`. When `card-renderer.tsx` renders the "Dig Deeper" chips and calls `injectText(q, card.silentContext)`, the context is `undefined`.

**Reference implementation (working):** `src/lib/deck-to-board.ts:10` exports `buildFollowUpContext(slide)` — builds context from `slide.sql`, `slide.commentary`, and a data sample. The board document view needs the same treatment.

**Secondary gap:** `src/components/canvas/card-renderers/text-renderer.tsx:249` calls `injectText(q)` without passing `silentContext`, meaning tldraw canvas follow-up chips also lose context even after `silentContext` is stored on the card.

**Pre-existing (no change needed):** `BoardCard.silentContext?: string` already exists at `board-types.ts:83`. No type change required.

## Technical Approach

### Data available at `suggestions` event time

By the time the `suggestions` event is received from the server, all prior `card-data` events have already been processed (the server emits them sequentially; the client processes them serially in the same `while(true)` loop). This means:

- `serverToNodeId` is fully populated
- `planMap` is fully populated with the `derivedFrom` graph
- Each chart/table node in board-store already has its `sql` written (from the earlier `card-data` sql event, which routes the SQL to the chart/table sibling via `suppressedToTarget`)
- Each text card already has `markdownContent` written (from `card-data` text delta events)

### Context-building algorithm for single and multi-subquestion queries

The summary text card (the one that receives follow-up questions) has `derivedFrom: [chartServerId, ...]` — one entry per subquestion. Each chart node has `sql` stored on it (written by the suppressed sql-card's `card-data` event).

```
text card (targetCardId)
  └─ derivedFrom: [chartServerId1, chartServerId2?, ...]
       each chart node has .sql written
```

At `suggestions` time, look up the parent chart nodes and collect their SQL:
1. `planEntry = planMap.get(event.targetCardId)`
2. For each `parentServerId` in `planEntry.derivedFrom`:
   - `nodeId = serverToNodeId.get(parentServerId)`
   - `card = getBoardCard(boardId, nodeId)`
   - collect `card.sql` (if present)
3. Get the text card's analysis: `getBoardCard(boardId, targetNodeId).markdownContent`
4. Build `silentContext` from collected SQLs + analysis text

This handles both single-subquestion (1 SQL) and multi-subquestion (N SQLs) queries uniformly.

### Shared utility function

Rather than inlining the context string in `use-document-stream.ts`, extract a board-specific builder to avoid a third divergent copy of this pattern.

Add to `src/lib/deck-to-board.ts`:

```typescript
/** Build silent LLM context for board document view follow-up chips. */
export function buildBoardFollowUpContext(
  title: string,
  sqls: string[],
  markdownContent: string | undefined,
): string {
  const parts: string[] = [];
  parts.push(`[CHART CONTEXT — user is asking a follow-up about this specific board card]`);
  parts.push(`Card: ${title}`);
  for (const sql of sqls) {
    parts.push(`Previous SQL: ${sql}`);
  }
  if (markdownContent) parts.push(`Previous analysis: ${markdownContent}`);
  parts.push(
    `[IMPORTANT: This is background context only. You have full access to the underlying events database. ALWAYS run new SQL queries to answer the follow-up question completely — do NOT answer based solely on the sample data above.]`,
  );
  return parts.join("\n");
}
```

Note: Does not include data sample rows (unlike the deck flow) because the board text card does not hold raw row data — those are on the chart sibling. This is acceptable; the SQL provides sufficient grounding for the LLM to regenerate queries with the correct date range.

## Implementation Steps

### Step 1 — Add `buildBoardFollowUpContext` to `src/lib/deck-to-board.ts`

Add the function after the existing `buildFollowUpContext`. Export it.

### Step 2 — Update `use-document-stream.ts` `suggestions` handler

Replace lines 237–244:

```typescript
// BEFORE
if (event.type === "suggestions") {
  const nodeId = serverToNodeId.get(event.targetCardId);
  if (nodeId) {
    updateDocCard(nodeId, boardId, {
      followUpQuestions: event.questions,
    });
    debouncedUpdate();
  }
}
```

```typescript
// AFTER
if (event.type === "suggestions") {
  const nodeId = serverToNodeId.get(event.targetCardId);
  if (nodeId) {
    // Collect SQL from all parent chart/table nodes (handles single + multi-subquestion)
    const planEntry = planMap.get(event.targetCardId);
    const sqls: string[] = [];
    for (const parentServerId of planEntry?.derivedFrom ?? []) {
      const parentNodeId = serverToNodeId.get(parentServerId);
      if (parentNodeId) {
        const parentCard = getBoardCard(boardId, parentNodeId);
        if (parentCard?.sql) sqls.push(parentCard.sql);
      }
    }
    const textCard = getBoardCard(boardId, nodeId);
    const silentContext = buildBoardFollowUpContext(
      textCard?.title ?? "",
      sqls,
      textCard?.markdownContent,
    );
    updateDocCard(nodeId, boardId, {
      followUpQuestions: event.questions,
      silentContext,
    });
    debouncedUpdate();
  }
}
```

Add import: `import { buildBoardFollowUpContext } from "@/lib/deck-to-board";`

### Step 3 — Fix `text-renderer.tsx` line 249 (canvas/tldraw view)

One-line change to pass `silentContext` when injecting follow-up questions in the tldraw canvas view:

```typescript
// BEFORE
onAsk={(q) => injectText(q)}

// AFTER
onAsk={(q) => injectText(q, item.silentContext)}
```

## Acceptance Criteria

- [x] Clicking a "Dig Deeper" question on a board card (document view) sends a message with the card's SQL (and its date filter) in `silentContext`
- [x] The LLM response to a follow-up question references the correct date range from the parent card's SQL
- [x] Multi-subquestion cards (those derived from N parent chart cards) include all N SQL queries in `silentContext`
- [x] Single-subquestion cards (common case) work correctly
- [x] Follow-up chips in the tldraw canvas view also pass `silentContext` (text-renderer.tsx fix)
- [x] No TypeScript errors (`BoardCard.silentContext` already typed — no new type changes)
- [x] Deck flow follow-up chips remain unaffected (no changes to `deck-canvas.tsx` or `deckSlideToSection`)

## Files Changed

| File | Change |
|---|---|
| `src/lib/deck-to-board.ts` | Add `buildBoardFollowUpContext(title, sqls, markdownContent)` export |
| `src/hooks/use-document-stream.ts` | Build `silentContext` from parent chart nodes in `suggestions` handler |
| `src/components/canvas/card-renderers/text-renderer.tsx` | Pass `item.silentContext` to `injectText` at line 249 |

**Not changing:**
- `src/lib/board-types.ts` — `silentContext` field already exists at line 83
- `src/components/board/card-renderer.tsx` — already passes `card.silentContext` to `injectText` correctly
- `src/app/api/canvas-query/route.ts` — server-side unchanged

## References

- Brainstorm: `docs/brainstorms/2026-03-16-fix-board-follow-up-time-period-context-brainstorm.md`
- Reference implementation: `src/lib/deck-to-board.ts:10` (`buildFollowUpContext`)
- Bug location: `src/hooks/use-document-stream.ts:237`
- Canvas gap: `src/components/canvas/card-renderers/text-renderer.tsx:249`
- `BoardCard.silentContext`: `src/lib/board-types.ts:83`
