---
title: "Feat: Persist conversations in localStorage (survive server restarts)"
type: feat
date: 2026-02-18
severity: medium
files_touched: 7
---

# Feat: Persist Conversations in localStorage

> **DEFERRED** — Conversations remain server-only in-memory (as of 2026-02-24). This plan describes localStorage persistence that has not been implemented. Revisit if server restarts become a user pain point.

## Overview

Conversations currently live in a server-side `Map<string, Conversation>` that resets on HMR/server restart. The canvas store already solved this with localStorage — conversations should follow the same pattern. This eliminates the stale-conversation-404 problem at its root instead of treating it with a toast.

## Problem Statement

**Root cause:** `conversation-store.ts` runs server-side. Server restart = all user conversations gone. The sidebar retains stale entries, clicks 404, and the toast we just added is a band-aid.

**What already works:** `canvas-store.ts` uses a client-side `Map` + debounced localStorage persistence + `STORAGE_VERSION` for schema migrations. It survives restarts, HMR, and page refreshes seamlessly.

**Goal:** Make conversations use the exact same pattern as canvas items — client-side localStorage with demo seeding on first visit.

## Proposed Solution

Migrate `conversation-store.ts` from a server-side in-memory Map to a client-side localStorage-backed store (identical architecture to `canvas-store.ts`). Replace all `fetch("/api/conversations/...")` calls with direct store imports. Delete the now-unused API routes.

### Phase 1: Create client-side conversation store

**File: `src/lib/conversation-store.ts` — rewrite in-place**

Follow `canvas-store.ts:1-185` exactly:

```typescript
import type { Conversation, ConversationSummary } from "./conversation-types";
import type { ChatMessage } from "@/lib/types";
import { PRESEEDED_CONVERSATIONS } from "./conversation-data";

const conversationMap = new Map<string, Conversation>();
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const STORAGE_KEY = "baby-sentinel-conversations";
const STORAGE_VERSION = 1;

function stripVolatileVariants(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(
    (m) => m.variant !== "gathering" && m.variant !== "streaming"
  );
}

/* ── Initialization ── */

function ensureInitialized() {
  // Version check BEFORE initialized guard (canvas-store pattern)
  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");
    if (storedVersion !== String(STORAGE_VERSION)) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY + "-version");
      conversationMap.clear();
      initialized = false;
      localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
    }
  }

  if (initialized) return;
  initialized = true;

  // Try restoring from localStorage first
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items: Conversation[] = JSON.parse(stored);
        items.forEach((conv) => conversationMap.set(conv.id, conv));
        return; // Don't seed demo if restore succeeds
      }
    } catch {
      // Fall through to demo seed
    }
  }

  // Seed with demo data
  PRESEEDED_CONVERSATIONS.forEach((conv) => conversationMap.set(conv.id, conv));
}

/* ── Persistence ── */

function persistToStorage() {
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      const items = Array.from(conversationMap.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // localStorage full or unavailable — silent
    }
  }, 300);
}

/** Synchronous write — use for unmount/navigation saves where the debounce timer may not fire. */
export function flushToStorage() {
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  try {
    const items = Array.from(conversationMap.values());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // silent
  }
}

/* ── Public API (unchanged signatures except updateConversationMessages) ── */

export function saveConversation(conv: Conversation): void { ... + persistToStorage() }
export function getConversation(id: string): Conversation | undefined { ... }
export function getAllConversations(): Conversation[] { ... }
export function getConversationSummaries(): ConversationSummary[] { ... }
export function updateConversationMessages(id, messages): boolean { ... + persistToStorage() }
export function deleteConversation(id: string): void { ... + persistToStorage() }
```

Key differences from the current server-side version:
- `STORAGE_KEY` + `STORAGE_VERSION` + `typeof window` guards
- `ensureInitialized()` reads localStorage before falling back to demo seed
- Every mutation calls `persistToStorage()` (debounced)
- New `flushToStorage()` for unmount paths (synchronous, no debounce)

### Phase 2: Replace API calls with direct store imports

**File: `src/app/page.tsx` — 4 call sites**

| Line | Current (fetch) | New (direct import) |
|------|----------------|---------------------|
| 165–171 | `saveMessages` does `fetch(PATCH)` | Call `updateConversationMessages(convId, msgs)` directly. Use `flushToStorage()` for switch/unmount paths. |
| 208 | `switchConversation` does `fetch(GET)` | `const conv = getConversation(id)` — synchronous, no await needed |
| 313 | `handleSend` does `fetch(POST)` to create | `saveConversation({ id, title, ... })` directly |
| 862 | `handlePlaybookCreate` does `fetch(POST)` to create | Same as above |

The `switchConversation` function simplifies significantly:

```typescript
const switchConversation = useCallback(
  (id: string) => {  // no longer async
    if (isProcessing) return;
    if (activeConvId && messages.length > 0) {
      updateConversationMessages(activeConvId, stripVolatileVariants(messages));
      flushToStorage();
    }
    const conv = getConversation(id);
    if (conv) {
      setMessages(conv.messages ?? []);
      setSourceCanvasItemId(conv.sourceCanvasItemId ?? null);
      const agentMsg = (conv.messages ?? []).find((m) => m.role === "agent");
      agentMsgIdRef.current = agentMsg?.id ?? "";
    } else {
      setMessages([]);
      setSourceCanvasItemId(null);
      toast.info("This conversation is no longer available.");
      refreshChats();
      return;
    }
    setActiveConvId(id);
    setPanel({ type: "closed" });
  },
  [isProcessing, activeConvId, messages, refreshChats]
);
```

The toast remains as a last-resort fallback — it fires only if a conversation ID exists in the sidebar but not in the store (e.g., manual localStorage clear). This should essentially never happen in normal use.

**File: `src/components/sidebar-context.tsx` — `refreshChats()`**

```typescript
// BEFORE: async fetch from API
const refreshChats = useCallback(async () => {
  try {
    const res = await fetch("/api/conversations?summary=true");
    if (res.ok) {
      const summaries: ChatEntry[] = await res.json();
      setChats(summaries);
    }
  } catch { ... }
}, []);

// AFTER: synchronous store read (keep async signature for caller compat)
const refreshChats = useCallback(async () => {
  setChats(getConversationSummaries());
}, []);
```

**File: `src/components/canvas/canvas-page.tsx` — line 400**

```typescript
// BEFORE: dual write (local saveConversation + fetch POST to server)
saveConversation(conv);
fetch("/api/conversations", { method: "POST", ... })
  .then(() => refreshChats())
  .catch(() => {});

// AFTER: single write (store handles persistence)
saveConversation(conv);
refreshChats();
```

### Phase 3: Delete server-side API routes

**Delete these files:**
- `src/app/api/conversations/route.ts`
- `src/app/api/conversations/[id]/route.ts`

**Keep:**
- `src/lib/conversation-store.ts` — rewritten to client-side
- `src/lib/conversation-types.ts` — unchanged
- `src/lib/conversation-data.ts` — unchanged (seed data)

### Phase 4: Simplify visibilitychange listener

The `visibilitychange` listener in `sidebar-context.tsx` was added for server-restart revalidation. With localStorage persistence, server restarts don't affect conversations. The listener becomes a no-op (reads the same in-memory Map). Remove it — it adds no value in the localStorage world.

```typescript
// DELETE this useEffect from sidebar-context.tsx
useEffect(() => {
  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      refreshChats();
    }
  };
  document.addEventListener("visibilitychange", handleVisibility);
  return () => document.removeEventListener("visibilitychange", handleVisibility);
}, [refreshChats]);
```

## Acceptance Criteria

- [x] Conversations survive server restart / HMR — no data loss, no toast
- [x] First visit seeds 6 demo conversations (from `PRESEEDED_CONVERSATIONS`)
- [x] Return visit restores all conversations from localStorage
- [x] Creating a new conversation persists immediately
- [x] Switching conversations loads messages from store (synchronous, no loading state)
- [x] Navigating to `/segments` and back preserves conversation state
- [x] `STORAGE_VERSION` bump clears stale data and reseeds
- [x] Unmount save uses `flushToStorage()` (no debounce) to prevent data loss on navigation
- [x] Toast only fires on truly missing conversations (manual localStorage clear)
- [x] No references to `/api/conversations` remain in source code
- [x] `pnpm build` passes cleanly

## Files Modified

| File | Change |
|------|--------|
| `src/lib/conversation-store.ts` | Rewrite: server Map → client localStorage (canvas-store pattern) |
| `src/app/page.tsx` | Replace 4 fetch calls with direct store imports; simplify `switchConversation` |
| `src/components/sidebar-context.tsx` | `refreshChats()` reads store directly; remove `visibilitychange` listener |
| `src/components/canvas/canvas-page.tsx` | Remove `fetch(POST)` to server; single store write |
| `src/app/api/conversations/route.ts` | **Delete** |
| `src/app/api/conversations/[id]/route.ts` | **Delete** |

## Edge Cases

1. **localStorage full:** Silent catch (matches canvas-store). Demo app unlikely to hit 5MB.
2. **Corrupted JSON in localStorage:** Falls through to demo seed, same as canvas-store.
3. **Multiple tabs:** Each tab has its own in-memory Map. Cross-tab sync not implemented (same as canvas-store). Acceptable for demo.
4. **SSR evaluation:** Store is only imported by `"use client"` files. `typeof window !== "undefined"` guards prevent server-side execution. Module instances are separate for server/client in Next.js bundling.
5. **Delete active conversation:** Pre-existing UX gap — sidebar removes entry, page retains stale messages until next navigation. Out of scope for this fix.
6. **`?conv=` URL param for missing ID:** Falls into the `if (!conv)` branch of `switchConversation` → toast + refreshChats (same as current 404 behavior).

## References

- Canvas store (reference implementation): `src/lib/canvas-store.ts:1-185`
- Chat persistence brainstorm: `docs/brainstorms/2026-02-17-chat-persistence-brainstorm.md`
- 404 fix plan (predecessor): `docs/plans/2026-02-18-fix-history-click-stale-conversation-404-plan.md`
- Conversation seed data: `src/lib/conversation-data.ts`
