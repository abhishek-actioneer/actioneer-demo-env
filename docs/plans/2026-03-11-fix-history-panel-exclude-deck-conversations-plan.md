---
title: "fix: Exclude deck-generated conversations from sidebar history"
type: fix
date: 2026-03-11
---

# fix: Exclude Deck-Generated Conversations from Sidebar History

The sidebar History panel currently shows all conversations, including those auto-created by the Decks feature (Commentary threads per slide, Challenge research threads, and slide chat threads). Users expect History to reflect only conversations they directly initiated.

## Problem Statement

When a user uploads a deck or runs "Challenge deck", the Decks pipeline creates conversations:
- **Commentary threads**: `"Commentary: <slide title>"` — one per slide, created in `deck-upload.ts`
- **Challenge threads**: `"Challenge: <deck name>"` — created in `deck-canvas.tsx`
- **Slide chat threads**: `"<slide title>"` (ambiguous title) — created when a user opens chart chat in `deck-canvas.tsx`

All three types land in the same `conversationMap` and are returned by `getConversationSummaries()`, which feeds the sidebar history list. With 18+ commentary threads from a single deck upload, the history panel is immediately dominated by deck entries — burying real user chats.

## Proposed Solution

Add an `origin` field to the `Conversation` type that tags who created the conversation. Filter `getConversationSummaries()` to exclude `origin: "deck"` entries. Bump `STORAGE_VERSION` to force a clean migration.

**Scope**: Sidebar History panel only. The `@` context picker and intersection cards intentionally keep deck conversations — they contain useful analytical data that can be referenced in user chats.

## Acceptance Criteria

- [ ] History panel shows only user-initiated conversations (no "Commentary:", "Challenge:", or slide chat entries)
- [ ] Deck conversations remain accessible via their existing access paths:
  - Slide chat: `loadConversation()` still works when clicking a chart card
  - Challenge: `window.open('/?conv=<id>')` still loads the conversation (sidebar won't highlight it, which is acceptable)
  - Commentary: accessible from deck canvas if a viewer is added in the future
- [ ] Existing localStorage is cleanly wiped via `STORAGE_VERSION` bump — no old deck conversations bleed through
- [ ] Pre-seeded demo conversations (`PRESEEDED_CONVERSATIONS`) are unaffected (none use deck title patterns)
- [ ] `getConversationSummaries()` used without the filter elsewhere still works (no regressions)

## Technical Approach

### Files to Change

#### 1. `src/lib/conversation-types.ts`

Add `origin` field to `Conversation` interface. Use `"user"` (explicit, default for backward compat) and `"deck"`:

```typescript
// src/lib/conversation-types.ts
export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  origin?: "user" | "deck"       // <-- add this
  sourceCanvasItemId?: string
  datasetId?: string
  tags?: ConversationTag[]
  pendingActions?: PendingAction[]
}
```

> **Why `origin`, not `source`**: `ConversationTag` in the same file already has a `source` field (`"agent" | "action" | "metric" | "keyword"`). Using `origin` avoids confusion and grep noise.

#### 2. `src/lib/conversation-store.ts`

- Bump `STORAGE_VERSION` from `1` to `2` — triggers wipe-and-reseed on next load, clearing old deck conversations that lack the `origin` field
- Update `getConversationSummaries()` to exclude `origin: "deck"` entries

```typescript
// src/lib/conversation-store.ts

// Change:
const STORAGE_VERSION = 1;
// To:
const STORAGE_VERSION = 2;

// In getConversationSummaries():
export function getConversationSummaries(filterDatasetId?: string): ConversationSummary[] {
  ensureInitialized();
  return Array.from(conversationMap.values())
    .filter((c) => c.origin !== "deck")          // <-- add this line
    .filter((c) => !filterDatasetId || c.datasetId === filterDatasetId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ id, title, datasetId }) => ({ id, title, datasetId }));
}
```

#### 3. `src/lib/deck-upload.ts` (line ~67)

Tag commentary conversations created during upload:

```typescript
// src/lib/deck-upload.ts
saveConversation({
  id: commentaryConvId,
  title: `Commentary: ${slide.title}`,
  messages: [...],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  datasetId,
  origin: "deck",   // <-- add this
});
```

#### 4. `src/components/deck/deck-canvas.tsx` (lines 184 and 232)

Tag both deck-canvas `saveConversation()` calls:

```typescript
// Challenge thread (line ~184)
saveConversation({
  id: challengeConvId,
  title: `Challenge: ${deck.name}`,
  messages: [...],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  datasetId,
  origin: "deck",   // <-- add this
});

// Slide chat thread (line ~232)
saveConversation({
  id: convId,
  title: slide.title,
  messages: [buildChartContextMessage(slide)],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  datasetId,
  origin: "deck",   // <-- add this
});
```

### What Remains Unchanged

- `getAllConversations()` — no filter added. Context picker (`context-picker.tsx`) and intersection cards (`intersection-cards.ts`) keep deck conversations in scope — they hold useful data for `@` references.
- `getConversation(id)` — no change. Direct ID lookups (e.g., `loadConversation()` for slide chat, `window.open` for challenge threads) still work.
- `suggested-actions.ts` — still scans all conversations for tag matching. Commentary threads contribute tags but this is an acceptable tradeoff for now (can scope to `origin: "user"` in a follow-up).
- `PRESEEDED_CONVERSATIONS` in `conversation-data.ts` — none use deck title patterns; no changes needed.

## Known Limitations

**Challenge thread sidebar desync**: When a user opens a challenge thread via "View research ↗" (`window.open('/?conv=<id>')`), the conversation loads into the main panel but won't be highlighted in the sidebar history list (it's filtered out). The conversation is fully functional — just no sidebar highlight. Acceptable UX tradeoff for now.

**Suggested actions noise**: `suggested-actions.ts` still reads `getAllConversations()` which includes deck conversations. Commentary threads may occasionally suggest their initial system message content as a follow-up action. Low-frequency issue; can be addressed in a separate cleanup pass.

**Orphaned conversations on re-analyze**: `reanalyze` resets `commentaryThreadId: null` on each slide and creates new commentary threads on next upload, leaving old ones in localStorage. These are now invisible in the sidebar (filtered out), but accumulate in localStorage over time. Cleanup is a separate concern.

## Implementation Checklist

- [x] Add `origin?: "user" | "deck"` to `Conversation` in `src/lib/conversation-types.ts`
- [x] Bump `STORAGE_VERSION` to `2` in `src/lib/conversation-store.ts`
- [x] Add `.filter((c) => c.origin !== "deck")` to `getConversationSummaries()` in `src/lib/conversation-store.ts`
- [x] Add `origin: "deck"` to `saveConversation()` in `src/lib/deck-upload.ts` (~line 67)
- [x] Add `origin: "deck"` to challenge thread `saveConversation()` in `src/components/deck/deck-canvas.tsx` (~line 184)
- [x] Add `origin: "deck"` to slide chat `saveConversation()` in `src/components/deck/deck-canvas.tsx` (~line 232)
- [ ] Verify: fresh session shows only pre-seeded demo conversations in History
- [ ] Verify: uploading a deck does NOT add new entries to History panel
- [ ] Verify: clicking a chart card on deck canvas still opens the slide chat panel correctly
- [ ] Verify: "View research ↗" still loads the challenge thread (even without sidebar highlight)

## References

- Conversation type: `src/lib/conversation-types.ts`
- Conversation store: `src/lib/conversation-store.ts`
- Deck upload pipeline: `src/lib/deck-upload.ts`
- Deck canvas (challenge + slide chat): `src/components/deck/deck-canvas.tsx:184,232`
- Sidebar history rendering: `src/components/sidebar/panels.tsx:39-83`
- Sidebar context (refreshChats): `src/components/sidebar-context.tsx:95-97`
- Context picker (uses `getAllConversations`): `src/components/chat/context-picker.tsx:256,265`
