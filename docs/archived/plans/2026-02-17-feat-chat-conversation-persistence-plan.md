---
title: "feat: Chat Conversation Persistence"
type: feat
date: 2026-02-17
---

# Chat Conversation Persistence (US-1)

> **PARTIALLY IMPLEMENTED** — Server-side in-memory conversation store is live. localStorage persistence (to survive server restarts) was not implemented. Section on client-side persistence is aspirational.

## Overview

Move chat conversation state from React `useState`/`useRef` in `page.tsx` to an in-memory server Map + API routes, so conversations survive page navigation and browser refresh. Follows the `knowledge-store.ts` pattern exactly.

## Problem Statement

Chat conversations are stored entirely in React component state (`messages`, `chatList`, `activeConvId`, `savedChatsRef`). Navigating to `/segments` or any other page unmounts `page.tsx` and destroys all state. This is the only feature in the app that doesn't survive navigation — segments, knowledge, playbooks, and metrics all persist server-side.

## Proposed Solution

Three-file store pattern + REST API routes + chat page sync at save points.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ID generation | Client-generated (`createId()`) | Matches existing pattern. No async needed before UI update. |
| Conversation type | Full `ChatMessage[]` including `AgentInfo` | Preserves agent cards, queries, summaries on reload |
| Volatile field handling | Strip `gathering`/`streaming` variants before save | These render as spinning indicators if reloaded |
| Mount behavior (no activeId) | Show welcome screen | Simple. User picks a conversation from sidebar. |
| Preseeded conversations | Editable (appendable) | Consistent with knowledge/playbooks — all in-memory data resets on restart anyway |
| Navigation-away save | `useEffect` cleanup fires save | Good enough for demo. `sendBeacon` not needed. |
| Save failure handling | `console.error` only | Demo app. No user-facing error UI. |
| Panel state persistence | Out of scope | Sources/task panels are live streaming artifacts |
| `deepResearch` persistence | Out of scope | Resets to `true` on mount — acceptable |
| Sidebar initialization | Keep `INITIAL_CHATS` as fallback, replace with API data on mount | Brief flash of preseeded chats is acceptable |
| Max conversations | No limit | Demo app |

## Technical Approach

### New Files

#### `src/lib/conversation-types.ts`

```typescript
import type { ChatMessage } from "@/lib/types";

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
}
```

#### `src/lib/conversation-data.ts`

Moves `PRELOADED` from `page.tsx` and `INITIAL_CHATS` from `chat-data.ts` into a single `PRESEEDED_CONVERSATIONS: Conversation[]` array. Each entry has `id`, `title`, `messages` (the existing hardcoded message arrays), `createdAt`, and `updatedAt`.

#### `src/lib/conversation-store.ts`

```
Pattern: knowledge-store.ts (Map + ensureInitialized + PRESEEDED)

const conversationMap = new Map<string, Conversation>();
let initialized = false;

function ensureInitialized() { ... seed from PRESEEDED_CONVERSATIONS }

Exports:
  saveConversation(conv: Conversation): void
  getConversation(id: string): Conversation | undefined
  getAllConversations(): Conversation[]
  getConversationSummaries(): ConversationSummary[]  // for sidebar
  updateConversationMessages(id: string, messages: ChatMessage[]): void
  deleteConversation(id: string): void
```

`updateConversationMessages` strips volatile variants (`gathering`, `streaming`) before writing.

#### `src/app/api/conversations/route.ts`

```
GET  → getAllConversations() or getConversationSummaries() (query param ?summary=true)
POST → saveConversation({ id, title, messages: [] }) → 201
```

#### `src/app/api/conversations/[id]/route.ts`

```
GET    → getConversation(id) → 200 or 404
PATCH  → updateConversationMessages(id, messages) → 200
DELETE → deleteConversation(id) → 204
```

### Modified Files

#### `src/app/page.tsx`

**Remove:**
- `savedChatsRef` (replaced by server store)
- `chatList` local state (read from context, which reads from API)
- `PRELOADED` constant (moved to `conversation-data.ts`)
- Import of `INITIAL_CHATS` from `chat-data.ts`
- The 5 sync `useEffect`s that push state into SidebarContext

**Add:**
- `useEffect` on mount: `GET /api/conversations?summary=true` → update context's `chats`
- `useEffect` on mount: if `activeConvId` in context, `GET /api/conversations/{id}` → set `messages`
- Save function: `PATCH /api/conversations/{id}` with current messages (fire-and-forget)
- Call save at 5 save points:
  1. Streaming completes (`finally` block in `handleSend`)
  2. Streaming completes (`finally` block in `handlePlaybookCreate`)
  3. User switches conversations (`switchConversation`)
  4. User clicks New Chat (`handleNewChat`)
  5. Component unmount (`useEffect` cleanup)
- When creating a new conversation: `POST /api/conversations` then proceed

**Keep unchanged:**
- All streaming logic, message state updates, agent card handling
- `messages` stays as local `useState` (real-time streaming needs it)
- Panel state, segment modal, search modal — all unchanged

#### `src/components/sidebar-context.tsx`

**Change:**
- Remove `INITIAL_CHATS` import
- Initialize `chats` as empty array `[]` instead of `INITIAL_CHATS`
- Add `refreshChats` method that fetches `GET /api/conversations?summary=true` and updates `chats`
- Keep callback ref pattern (`onNewChatRef`, `onSelectRef`) unchanged

#### `src/lib/chat-data.ts`

**Remove or gut** — `INITIAL_CHATS` moves to `conversation-data.ts`. If nothing else imports from this file, delete it. If the sidebar `ChatEntry` type import chain depends on it, keep a re-export.

#### `src/components/sidebar.tsx`

**Change:** `ChatEntry` type definition — either keep here or move to `conversation-types.ts` as `ConversationSummary`. The `ConversationSummary` type is identical to `ChatEntry` (`{ id, title }`), so this is just a rename/alias decision.

Pragmatic choice: keep `ChatEntry` as-is in sidebar.tsx, and have `getConversationSummaries()` return objects matching `ChatEntry` shape. No type migration needed.

## Implementation Phases

### Phase 1: Store + API (backend)

- [x] Create `src/lib/conversation-types.ts` — `Conversation` and `ConversationSummary` types
- [x] Create `src/lib/conversation-data.ts` — move `PRELOADED` + `INITIAL_CHATS` into `PRESEEDED_CONVERSATIONS`
- [x] Create `src/lib/conversation-store.ts` — Map + CRUD following `knowledge-store.ts` pattern
- [x] Create `src/app/api/conversations/route.ts` — GET (list/summaries) + POST (create)
- [x] Create `src/app/api/conversations/[id]/route.ts` — GET + PATCH + DELETE

### Phase 2: Wire chat page to API (frontend)

- [x] Remove `savedChatsRef`, `chatList` local state, `PRELOADED` import from `page.tsx`
- [x] Add mount effect: fetch conversation summaries → update context `chats`
- [x] Add mount effect: if `activeConvId`, fetch full conversation → set `messages`
- [x] Add save function that PATCHes messages to server (strips volatile variants)
- [x] Wire save at all 5 save points (streaming complete ×2, switch, new chat, unmount)
- [x] Wire conversation creation: POST on first message, then proceed as before

### Phase 3: Update SidebarContext

- [x] Remove `INITIAL_CHATS` dependency from `SidebarProvider`
- [x] Initialize `chats` as `[]`
- [x] Add `refreshChats()` method to context
- [x] Chat page calls `refreshChats()` on mount and after creating a new conversation

### Phase 4: Cleanup + verify

- [x] Remove or update `src/lib/chat-data.ts` (no longer imported — can be deleted)
- [x] Verify `pnpm build` passes
- [ ] Manual test: send message → navigate to /segments → return → messages preserved
- [ ] Manual test: refresh page → sidebar shows conversation list → click to load
- [ ] Manual test: preseeded conversations load correctly
- [ ] Manual test: switch conversations → both preserved

## Acceptance Criteria

- [ ] Navigate away from chat to any page and return — messages still there
- [ ] New conversations created during the session appear in sidebar history
- [ ] Active conversation ID is preserved across navigation
- [ ] Page refresh reloads conversation list from server store
- [ ] Preseeded conversations (funnel, revenue, brands, etc.) load correctly
- [ ] Streaming works identically to current behavior (no UX regression)
- [ ] `pnpm build` passes with no errors

## Edge Cases (Acknowledged, Not Addressed)

- **Server restart** loses all conversations (same as knowledge/playbooks — acceptable for demo)
- **Race condition** on rapid switch+save — last-write-wins, no locking (acceptable for demo)
- **React 19 Strict Mode** double-mount may double-fetch on dev — harmless
- **`connector-required` variant** mid-stream — saved as-is, callbacks won't work on reload (acceptable)

## References

- Pattern source: `src/lib/knowledge-store.ts` (Map + ensureInitialized + PRESEEDED)
- Pattern source: `src/lib/playbook-store.ts` (getSavedPlaybookSummaries derived view)
- API pattern: `src/app/api/segments/route.ts` (REST conventions, response shapes)
- Brainstorm: `docs/brainstorms/2026-02-17-chat-persistence-brainstorm.md`
- Learnings: `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md` (callback ref pattern)
- Learnings: `docs/solutions/design-patterns/split-panel-to-sidebar-three-tier-consolidation.md` (sync-read constraint)
