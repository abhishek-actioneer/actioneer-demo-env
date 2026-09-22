---
title: "Fix: History sidebar click shows empty conversation after server restart"
type: fix
date: 2026-02-18
severity: high
files_touched: 4
---

# Fix: History Sidebar Click Shows Empty Conversation After Server Restart

## Overview

Clicking a conversation in the History sidebar highlights the item but shows the welcome screen instead of the conversation content. This occurs because the server-side in-memory conversation store (`Map`) loses user-created conversations on HMR/server restart, while the sidebar retains stale entries in React client state. The `switchConversation` function silently clears messages on 404 with no user feedback and no sidebar re-sync.

## Problem Statement

**Root cause:** `conversation-store.ts` uses a server-side `Map<string, Conversation>` that resets to only 6 preseeded conversations on every module re-evaluation (HMR, server restart). The sidebar's `chats` state in `SidebarProvider` is populated on mount and never re-synced after a restart.

**Symptoms:**
1. Sidebar shows conversations that no longer exist on the server
2. Clicking one calls `GET /api/conversations/${id}` → returns 404
3. `switchConversation` silently sets `messages = []` → welcome screen
4. `setActiveConvId(id)` is called unconditionally → item highlights despite failure
5. No toast, no sidebar refresh, no user feedback

**Secondary issues discovered during investigation:**
- `PATCH /api/conversations/:id` returns `{ ok: true }` even when the conversation doesn't exist (silent write failure)
- No in-flight guard on `switchConversation` — rapid clicks cause race conditions
- No tab-focus revalidation — stale sidebar persists until next mount

## Proposed Solution

Three-layer fix: handle the 404 gracefully, prevent stale sidebar state proactively, and fix the silent write failure.

### Phase 1: Handle 404 in `switchConversation` (core fix)

**File: `src/app/page.tsx` — `switchConversation` function (lines 199–227)**

```typescript
// BEFORE (current — silent failure)
} else {
  setMessages([]);
  setSourceCanvasItemId(null);
}
// ...
setActiveConvId(id);  // unconditional — highlights stale item

// AFTER (with fix)
} else {
  setMessages([]);
  setSourceCanvasItemId(null);
  toast.info("This conversation is no longer available.");
  refreshChats();  // re-sync sidebar from server
  return;          // early return — do NOT set activeConvId
}
// ...catch block gets same treatment...
setActiveConvId(id);  // only reached on success
```

Key changes:
- Add `toast.info()` on 404 (sonner already imported at `page.tsx:18`)
- Call `refreshChats()` to prune stale entries from sidebar (already destructured at line 161)
- **Early return** before `setActiveConvId(id)` — prevents highlighting a dead conversation
- Move `setPanel({ type: "closed" })` into the success path only

**File: `src/app/page.tsx` — add `refreshChats` to `switchConversation` dependency array (line 226)**

### Phase 2: Fix silent PATCH failure

**File: `src/lib/conversation-store.ts` — `updateConversationMessages` (lines 54–67)**

```typescript
// BEFORE
export function updateConversationMessages(id: string, messages: ChatMessage[]): void {
  ensureInitialized();
  const existing = conversationMap.get(id);
  if (existing) { /* update */ }
  // silent no-op if not found
}

// AFTER — return boolean
export function updateConversationMessages(id: string, messages: ChatMessage[]): boolean {
  ensureInitialized();
  const existing = conversationMap.get(id);
  if (!existing) return false;
  conversationMap.set(id, { ...existing, messages: stripVolatileVariants(messages), updatedAt: Date.now() });
  return true;
}
```

**File: `src/app/api/conversations/[id]/route.ts` — PATCH handler (lines 19–36)**

```typescript
// AFTER — return 404 when conversation doesn't exist
const updated = updateConversationMessages(id, messages as ChatMessage[]);
if (!updated) {
  return Response.json({ error: "Not found" }, { status: 404 });
}
return Response.json({ ok: true });
```

This enables `saveMessages` callers to detect stale writes in the future if needed.

### Phase 3: Proactive sidebar revalidation on tab focus

**File: `src/components/sidebar-context.tsx` — new `useEffect` in `SidebarProvider`**

```typescript
// Re-sync sidebar when tab regains focus (catches server restarts while backgrounded)
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

This removes stale entries before the user clicks, preventing the 404 path entirely in the common "alt-tab back to browser" scenario.

## Acceptance Criteria

- [x] Clicking a stale history item shows a toast ("This conversation is no longer available") and does NOT highlight the item
- [x] Sidebar automatically removes stale entries after a failed click (via `refreshChats`)
- [x] Clicking a preseeded conversation still works normally after server restart
- [x] Creating a new conversation, switching away, and switching back loads messages correctly (no regression)
- [x] Returning to the browser tab after server restart automatically refreshes the sidebar list
- [x] `PATCH /api/conversations/:id` returns 404 when the conversation doesn't exist
- [x] No race condition on rapid conversation switching (active conversation matches the last click)

## Files Modified

| File | Change | Lines |
|------|--------|-------|
| `src/app/page.tsx` | Handle 404 with toast + refreshChats + early return | ~199–227 |
| `src/lib/conversation-store.ts` | `updateConversationMessages` returns boolean | ~54–67 |
| `src/app/api/conversations/[id]/route.ts` | PATCH returns 404 on missing conv | ~19–36 |
| `src/components/sidebar-context.tsx` | Add `visibilitychange` listener for refreshChats | new effect |

## Edge Cases Considered

1. **Rapid double-click on different items:** Currently a race condition (no abort). Out of scope for this fix — noted for future improvement with `switchingRef` guard.
2. **Click same active conversation:** Redundant fetch. Pre-existing behavior, not affected by this fix.
3. **`?conv=` URL param path:** Goes through same `switchConversation` — fix applies automatically.
4. **`refreshChats()` itself fails (server offline):** Sidebar retains stale entries. Existing silent catch behavior is acceptable — the toast from the 404 still provides feedback.
5. **`saveMessages` PATCH to stale ID:** Will now return 404 instead of silent success. `saveMessages` is fire-and-forget (`.catch(console.error)`), so the error is logged but not surfaced — acceptable for demo.

## References

- Original persistence plan: `docs/plans/2026-02-17-feat-chat-conversation-persistence-plan.md`
- Brainstorm: `docs/brainstorms/2026-02-17-chat-persistence-brainstorm.md` — deliberately chose in-memory Map over DuckDB
- Canvas store (reference for localStorage pattern): `src/lib/canvas-store.ts:139–185`
- Sidebar context lift pattern: `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md`
