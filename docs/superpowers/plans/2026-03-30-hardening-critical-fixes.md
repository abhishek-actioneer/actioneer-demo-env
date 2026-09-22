# Hardening: Critical Fixes (Issues 1-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 4 critical stability issues: classify silent misroute, sendBeacon data loss, fire-and-forget server syncs, and localStorage version wipe.

**Architecture:** Issues 2 and 3 are coupled (unreliable persistence) and solved together: make debounced server writes the primary path with error surfacing, replace sendBeacon with sync localStorage writes on unload. Issue 1 is a standalone API fix. Issue 4 replaces hard version wipes with defensive parsing.

**Tech Stack:** Next.js API routes, sonner toasts, localStorage, existing store patterns

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/api/classify/route.ts` | Modify | Return HTTP 500 on error instead of fake success |
| `src/hooks/use-classify.ts` | Modify | Update fallback to use `direct` mode instead of `analytics` |
| `src/lib/sync-status.ts` | Create | Tiny pub/sub for sync status (synced/pending/error) |
| `src/components/sync-status-indicator.tsx` | Create | Visual indicator for sync state |
| `src/components/sidebar.tsx` | Modify | Mount SyncStatusIndicator |
| `src/lib/board-store.ts` | Modify | Surface server sync errors, replace sendBeacon with sync localStorage, defensive version parsing |
| `src/lib/playbook-store.ts` | Modify | Surface server sync errors, replace sendBeacon with sync localStorage, defensive version parsing |
| `src/lib/conversation-store.ts` | Modify | Surface server sync errors, replace sendBeacon with sync localStorage, defensive version parsing |
| `src/lib/folder-store.ts` | Modify | Defensive version parsing |
| `src/lib/credit-store.ts` | Modify | Defensive version parsing |

---

## Task 1: Fix `/api/classify` silent misroute

**Files:**
- Modify: `src/app/api/classify/route.ts:40-43`
- Modify: `src/hooks/use-classify.ts:37-39`

- [ ] **Step 1: Fix the API route to return 500 on error**

In `src/app/api/classify/route.ts`, replace the catch block that returns fake success:

```typescript
// REPLACE lines 40-43:
  } catch (err) {
    console.error("[classify] failed:", err instanceof Error ? err.message : err);
    return Response.json(
      { error: "classification failed" },
      { status: 500 }
    );
  }
```

- [ ] **Step 2: Update client fallback to use `direct` mode**

In `src/hooks/use-classify.ts`, the catch block at line 37-39 already shows a toast and falls back to analytics. Change the fallback to `direct` — it's safer because direct chat can answer anything, while analytics requires valid SQL generation:

```typescript
// REPLACE lines 37-41:
  } catch {
    toast("Falling back to direct chat.", { description: "Could not classify your question." });
    return { mode: "direct", metricId: null, actionType: null, extractedDescription: null, metricName: null };
  }
```

- [ ] **Step 3: Verify manually**

Run: `pnpm dev`

Test: Send a chat message. It should work normally. Then temporarily break the classify route (add `throw new Error("test")` at the top of the try block) and send a message — it should show a toast and fall back to direct chat response instead of trying to generate SQL.

Remove the temporary throw after testing.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/classify/route.ts src/hooks/use-classify.ts
git commit -m "fix: classify returns 500 on error, client falls back to direct chat

Previously returned { mode: 'analytics' } with status 200 on any error,
silently misrouting questions into the SQL pipeline. Now returns 500 and
the client falls back to direct chat mode with a toast notification."
```

---

## Task 2: Create sync status infrastructure

**Files:**
- Create: `src/lib/sync-status.ts`
- Create: `src/components/sync-status-indicator.tsx`
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1: Create the sync status pub/sub module**

Create `src/lib/sync-status.ts`:

```typescript
/**
 * Lightweight pub/sub for store sync status.
 * Stores call markSyncError() / markSynced() on server write success/failure.
 * UI subscribes to show a visual indicator.
 */

type SyncState = "synced" | "pending" | "error";

let currentState: SyncState = "synced";
let errorCount = 0;
const listeners = new Set<(state: SyncState) => void>();

function notify() {
  for (const fn of listeners) fn(currentState);
}

export function markSyncPending(): void {
  if (currentState === "error") return; // don't downgrade from error
  currentState = "pending";
  notify();
}

export function markSynced(): void {
  errorCount = 0;
  currentState = "synced";
  notify();
}

export function markSyncError(): void {
  errorCount++;
  currentState = "error";
  notify();
}

export function getSyncState(): SyncState {
  return currentState;
}

export function getSyncErrorCount(): number {
  return errorCount;
}

export function subscribeSyncStatus(fn: (state: SyncState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
```

- [ ] **Step 2: Create the visual indicator component**

Create `src/components/sync-status-indicator.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { subscribeSyncStatus, getSyncState } from "@/lib/sync-status";
import { CloudOff } from "lucide-react";

export function SyncStatusIndicator() {
  const [state, setState] = useState(getSyncState);

  useEffect(() => {
    return subscribeSyncStatus(setState);
  }, []);

  if (state === "synced" || state === "pending") return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400">
      <CloudOff className="w-3 h-3" />
      <span>Unsaved changes</span>
    </div>
  );
}
```

- [ ] **Step 3: Mount indicator in sidebar**

In `src/components/sidebar.tsx`, import and render `SyncStatusIndicator` near the bottom of the sidebar, above the user/settings area. Find the appropriate spot (near the bottom of the sidebar content) and add:

```tsx
import { SyncStatusIndicator } from "@/components/sync-status-indicator";
```

Add `<SyncStatusIndicator />` just before the settings/account section at the bottom of the sidebar.

- [ ] **Step 4: Build check**

Run: `pnpm build`
Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync-status.ts src/components/sync-status-indicator.tsx src/components/sidebar.tsx
git commit -m "feat: sync status indicator — shows 'Unsaved changes' when server writes fail

Adds lightweight pub/sub (sync-status.ts) and a sidebar indicator.
Stores will call markSyncError/markSynced on server write outcomes."
```

---

## Task 3: Wire sync status into board-store server writes

**Files:**
- Modify: `src/lib/board-store.ts`

- [ ] **Step 1: Import sync status and add error surfacing to server writes**

At the top of `src/lib/board-store.ts`, add the import:

```typescript
import { markSyncPending, markSynced, markSyncError } from "@/lib/sync-status";
```

- [ ] **Step 2: Update `serverWriteBoard` (around line 520-526)**

Replace the fire-and-forget pattern with sync status tracking:

```typescript
function serverWriteBoard(board: Board) {
  markSyncPending();
  apiFetch("/api/boards", {
    method: "POST",
    body: { id: board.id, name: board.name, datasetId: board.datasetId, description: board.description, viewMode: board.viewMode, deckId: board.deckId },
    skipModel: true,
  })
    .then(() => markSynced())
    .catch(err => {
      console.warn("[board-store] server write board failed:", err);
      markSyncError();
    });
}
```

- [ ] **Step 3: Update `serverPatchBoard` (around line 528-534)**

Same pattern:

```typescript
function serverPatchBoard(board: Board) {
  markSyncPending();
  apiFetch(`/api/boards/${board.id}`, {
    method: "PATCH",
    body: { name: board.name, description: board.description, viewMode: board.viewMode, globalTimeRange: board.globalTimeRange, deckId: board.deckId, datasetId: board.datasetId },
    skipModel: true,
  })
    .then(() => markSynced())
    .catch(err => {
      console.warn("[board-store] server patch board failed:", err);
      markSyncError();
    });
}
```

- [ ] **Step 4: Update `serverDeleteBoard` (around line 536-546)**

```typescript
function serverDeleteBoard(boardId: string) {
  for (const key of Object.keys(serverDebounceTimers)) {
    if (key.startsWith(`board-${boardId}`)) {
      clearTimeout(serverDebounceTimers[key]);
      delete serverDebounceTimers[key];
    }
  }
  markSyncPending();
  apiFetch(`/api/boards/${boardId}`, { method: "DELETE", skipModel: true })
    .then(() => markSynced())
    .catch(err => {
      console.warn("[board-store] server delete board failed:", err);
      markSyncError();
    });
}
```

- [ ] **Step 5: Update the migration/hydration catch blocks (around line 119, 142)**

Replace `console.warn` with `markSyncError` calls:

Line ~119 (migration catch):
```typescript
  }).catch(err => {
    console.warn("[board-store] migration failed:", err);
    markSyncError();
  });
```

Line ~142 (hydration catch):
```typescript
  .catch(err => {
    console.warn("[board-store] server hydration failed:", err);
    markSyncError();
  });
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/board-store.ts
git commit -m "fix: board-store surfaces server sync errors via sync-status indicator"
```

---

## Task 4: Wire sync status into playbook-store and conversation-store

**Files:**
- Modify: `src/lib/playbook-store.ts`
- Modify: `src/lib/conversation-store.ts`

- [ ] **Step 1: Update playbook-store server writes**

At the top of `src/lib/playbook-store.ts`, add:

```typescript
import { markSyncPending, markSynced, markSyncError } from "@/lib/sync-status";
```

Update `serverUpsertPlaybook` (around line 141-158):

```typescript
function serverUpsertPlaybook(playbook: AnyPlaybook) {
  const key = `pb-${playbook.id}`;
  const existing = serverDebounce.get(key);
  if (existing) clearTimeout(existing);

  serverDebounce.set(
    key,
    setTimeout(() => {
      serverDebounce.delete(key);
      markSyncPending();
      apiFetch(`/api/playbooks/${playbook.id}`, {
        method: "PUT",
        body: playbook,
        skipModel: true,
      })
        .then(() => markSynced())
        .catch((err) => {
          console.warn("[playbook-store] server upsert failed:", err);
          markSyncError();
        });
    }, SERVER_DEBOUNCE_MS)
  );
}
```

Update `serverDeletePlaybook` (around line 161-175):

```typescript
function serverDeletePlaybook(id: string) {
  const key = `pb-${id}`;
  const existing = serverDebounce.get(key);
  if (existing) {
    clearTimeout(existing);
    serverDebounce.delete(key);
  }
  markSyncPending();
  apiFetch(`/api/playbooks/${id}`, {
    method: "DELETE",
    skipModel: true,
  })
    .then(() => markSynced())
    .catch((err) => {
      console.warn("[playbook-store] server delete failed:", err);
      markSyncError();
    });
}
```

Update hydration catch (around line 90-92 and 114-116):

```typescript
  // migration catch (~line 90):
  }).catch((err) => {
    console.warn("[playbook-store] migration failed:", err);
    markSyncError();
  });

  // hydration catch (~line 114):
  .catch((err) => {
    console.warn("[playbook-store] server hydration failed:", err);
    markSyncError();
  });
```

- [ ] **Step 2: Update conversation-store server writes**

At the top of `src/lib/conversation-store.ts`, add:

```typescript
import { markSyncPending, markSynced, markSyncError } from "@/lib/sync-status";
```

Update `patchOnServer` (around line 192-202):

```typescript
function patchOnServer(id: string, data: Record<string, unknown>): void {
  markSyncPending();
  apiFetch(`/api/conversations/${id}`, {
    method: "PATCH",
    body: data,
    skipModel: true,
    skipDataset: true,
  })
    .then(() => markSynced())
    .catch((err) => {
      console.warn("[conversation-store] server patch failed:", err);
      markSyncError();
    });
}
```

Update `createOnServer` (around line 174-190):

```typescript
async function createOnServer(conv: {
  id: string;
  title: string;
  datasetId?: string;
  origin?: string;
}): Promise<void> {
  markSyncPending();
  try {
    await apiFetch("/api/conversations", {
      method: "POST",
      body: conv,
      skipModel: true,
      skipDataset: true,
    });
    markSynced();
  } catch (err) {
    console.warn("[conversation-store] server create failed:", err);
    markSyncError();
  }
}
```

Update `deleteOnServer` (around line 218-228):

```typescript
async function deleteOnServer(id: string): Promise<void> {
  markSyncPending();
  try {
    await apiFetch(`/api/conversations/${id}`, {
      method: "DELETE",
      skipModel: true,
      skipDataset: true,
    });
    markSynced();
  } catch (err) {
    console.warn("[conversation-store] server delete failed:", err);
    markSyncError();
  }
}
```

Update `migrateFromLocalStorage` (around line 230-244):

```typescript
async function migrateFromLocalStorage(localConvs: Conversation[]): Promise<void> {
  markSyncPending();
  try {
    await apiFetch("/api/conversations/migrate", {
      method: "POST",
      body: { conversations: localConvs },
      skipModel: true,
      skipDataset: true,
    });
    markSynced();
    if (typeof window !== "undefined") {
      localStorage.setItem(MIGRATED_KEY, "true");
    }
  } catch (err) {
    console.warn("[conversation-store] migration failed:", err);
    markSyncError();
  }
}
```

- [ ] **Step 3: Build check**

Run: `pnpm build`
Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/playbook-store.ts src/lib/conversation-store.ts
git commit -m "fix: playbook + conversation stores surface sync errors via status indicator"
```

---

## Task 5: Replace sendBeacon with sync localStorage writes

**Files:**
- Modify: `src/lib/board-store.ts`
- Modify: `src/lib/playbook-store.ts`
- Modify: `src/lib/conversation-store.ts`

The core idea: on `beforeunload`/`visibilitychange`, flush pending debounced writes to localStorage synchronously (which is guaranteed to work). Remove sendBeacon calls entirely — the debounced server writes (now with error surfacing from Task 3-4) are the primary server persistence mechanism. localStorage is the safety net.

- [ ] **Step 1: Update board-store `flushPendingPersists`**

In `src/lib/board-store.ts`, the `flushPendingPersists` function (around line 369-397) currently flushes debounced localStorage writes AND fires sendBeacon. Remove the sendBeacon block entirely — the debounced localStorage writes that `flushPendingPersists` already executes are sufficient:

```typescript
export function flushPendingPersists() {
  for (const [key, fn] of pendingPersists) {
    if (debounceTimers[key]) {
      clearTimeout(debounceTimers[key]);
      delete debounceTimers[key];
    }
    try {
      fn();
    } catch (err) {
      console.warn(`[board-store] flush persist failed for "${key}":`, err);
    }
  }
  pendingPersists.clear();
}
```

This removes the entire sendBeacon block (lines ~383-396). The debounced server writes from Task 3 handle server persistence during normal operation; localStorage (flushed here synchronously) is the safety net on tab close.

- [ ] **Step 2: Update playbook-store `flushPendingPlaybookPersists`**

In `src/lib/playbook-store.ts`, replace `flushPendingPlaybookPersists` (around line 178-191) to just do a sync localStorage write instead of sendBeacon:

```typescript
export function flushPendingPlaybookPersists() {
  // Flush any pending debounced localStorage write
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  persistSync();
}
```

- [ ] **Step 3: Update conversation-store `flushToStorage`**

In `src/lib/conversation-store.ts`, the `flushToStorage` function (around line 463-493) currently flushes debounced server writes via sendBeacon. Replace with just a sync localStorage write:

```typescript
export function flushToStorage() {
  if (typeof window === "undefined") return;

  // Cancel any pending debounced server writes — they'll sync on next page load
  for (const [id, timer] of serverDebounce) {
    clearTimeout(timer);
    serverDebounce.delete(id);
  }

  // Sync write to localStorage — guaranteed to complete before unload
  writeLocalStorage();
}
```

- [ ] **Step 4: Build check**

Run: `pnpm build`
Expected: No TypeScript errors. No references to `sendBeacon` remain in these three store files.

- [ ] **Step 5: Verify no sendBeacon references remain in stores**

Run: `grep -n "sendBeacon" src/lib/board-store.ts src/lib/playbook-store.ts src/lib/conversation-store.ts`
Expected: No matches.

- [ ] **Step 6: Commit**

```bash
git add src/lib/board-store.ts src/lib/playbook-store.ts src/lib/conversation-store.ts
git commit -m "fix: replace sendBeacon with sync localStorage writes on page unload

sendBeacon silently fails on payloads >64KB (boards with 50+ cards).
Now: debounced server writes are the primary persistence path (with
error surfacing from previous commits). On page close, pending
localStorage writes are flushed synchronously as a safety net."
```

---

## Task 6: Defensive localStorage version parsing (replace hard wipe)

**Files:**
- Modify: `src/lib/board-store.ts`
- Modify: `src/lib/playbook-store.ts`
- Modify: `src/lib/conversation-store.ts`
- Modify: `src/lib/folder-store.ts`
- Modify: `src/lib/credit-store.ts`

The core idea: instead of `if (version !== CURRENT) { deleteAll() }`, try to parse the stored data. If it parses, use it and stamp the new version. Only wipe if completely unparseable.

- [ ] **Step 1: Update board-store `ensureInitialized`**

In `src/lib/board-store.ts`, replace the version-mismatch block in `ensureInitialized` (around lines 37-71). Instead of wiping on mismatch, just log a warning and stamp the new version. The existing `try/catch` around `JSON.parse` (line 82-98) already handles corrupt data:

```typescript
function ensureInitialized(datasetId?: string) {
  // Version stamp — log mismatch but don't wipe data.
  // The JSON.parse below handles corrupt data gracefully.
  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_PREFIX + "-version");
    if (storedVersion !== null && storedVersion !== String(STORAGE_VERSION)) {
      console.warn(`[board-store] version mismatch: stored="${storedVersion}" current="${STORAGE_VERSION}" — attempting to load anyway`);
    }
  }

  if (initialized) return;
  initialized = true;

  // Try restoring from localStorage
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX);
      if (stored) {
        const boards: Board[] = JSON.parse(stored);
        console.log(`[board-store] init: found ${boards.length} boards in localStorage`);
        boards.forEach((board) => {
          boardsMap.set(board.id, board);
          loadBoardData(board.id);
        });
        purgeStaleBoards();
        clearLegacyStorage();
      } else {
        console.log("[board-store] init: no boards in localStorage — starting empty");
      }
      // Stamp current version
      localStorage.setItem(STORAGE_PREFIX + "-version", String(STORAGE_VERSION));
    } catch (err) {
      console.warn("[board-store] init: failed to parse boards — clearing corrupt data:", err);
      // Only wipe on actual parse failure
      localStorage.removeItem(STORAGE_PREFIX);
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith(CARDS_PREFIX) ||
            key.startsWith(CONNECTIONS_PREFIX) ||
            key.startsWith(FRAMES_PREFIX) ||
            key.startsWith(SECTIONS_PREFIX))
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(STORAGE_PREFIX + "-version", String(STORAGE_VERSION));
    }

    // Background: hydrate from server
    if (!datasetId) return;
    // ... rest of hydration code stays the same
```

Note: keep the existing server hydration code (lines 104-143) unchanged.

- [ ] **Step 2: Update playbook-store `ensureInitialized`**

In `src/lib/playbook-store.ts`, replace the version check block (around lines 44-57):

```typescript
function ensureInitialized() {
  if (typeof window === "undefined") return;

  // Version stamp — don't wipe on mismatch, just try to parse
  const storedVersion = localStorage.getItem(VERSION_KEY);
  if (storedVersion !== null && storedVersion !== String(STORAGE_VERSION)) {
    console.warn(`[playbook-store] version mismatch: stored="${storedVersion}" current="${STORAGE_VERSION}" — attempting to load anyway`);
  }

  if (initialized) return;
  initialized = true;

  // Restore from localStorage
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const playbooks: AnyPlaybook[] = JSON.parse(stored);
      playbooks.forEach((pb) => savedPlaybooks.set(pb.id, pb));
    }
  } catch (err) {
    console.warn("[playbook-store] corrupt localStorage data — clearing:", err);
    localStorage.removeItem(STORAGE_KEY);
  }

  // Stamp current version
  localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION));

  // Background: hydrate from server (source of truth)
  hydrateFromServer();
}
```

- [ ] **Step 3: Update conversation-store `readLocalStorage`**

In `src/lib/conversation-store.ts`, the `readLocalStorage` function (around lines 78-109) already has defensive parsing via `sanitizeStoredConversation`. The version check at line 95-104 filters out `deck` conversations on v1→v2 migration, which is valid. Leave this one mostly as-is but prevent the wipe behavior. Replace the version mismatch block:

```typescript
    if (storedVersion !== String(STORAGE_VERSION)) {
      // v1→v2 migration: strip deck-generated conversations
      const migrated = items.filter((c) => c.origin !== "deck");
      localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      } catch {
        // best effort
      }
      return migrated;
    }
```

This already doesn't wipe — it migrates. The `sanitizeStoredConversation` function handles schema changes gracefully by providing defaults. No change needed here beyond verifying it works correctly.

- [ ] **Step 4: Update folder-store `ensureInitialized`**

In `src/lib/folder-store.ts`, replace lines 24-34:

```typescript
function ensureInitialized() {
  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");
    if (storedVersion !== null && storedVersion !== String(STORAGE_VERSION)) {
      console.warn(`[folder-store] version mismatch: stored="${storedVersion}" current="${STORAGE_VERSION}" — attempting to load anyway`);
    }
  }

  if (initialized) return;
  initialized = true;

  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items: Folder[] = JSON.parse(stored);
        items.forEach((f) => folderMap.set(f.id, f));
      }
    } catch {
      console.warn("[folder-store] corrupt localStorage data — clearing");
      localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
  }
}
```

- [ ] **Step 5: Update credit-store `ensureInitialized`**

In `src/lib/credit-store.ts`, replace lines 18-29:

```typescript
function ensureInitialized() {
  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");
    if (storedVersion !== null && storedVersion !== String(STORAGE_VERSION)) {
      console.warn(`[credit-store] version mismatch: stored="${storedVersion}" current="${STORAGE_VERSION}" — attempting to load anyway`);
    }
  }

  if (initialized) return;
  initialized = true;

  // Try restoring from localStorage
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items: OrgCreditState[] = JSON.parse(stored);
        items.forEach((org) => creditMap.set(org.orgId, org));
        localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
        return;
      }
    } catch {
      console.warn("[credit-store] corrupt localStorage data — clearing");
      localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
  }

  // ... rest of seed logic stays unchanged
```

- [ ] **Step 6: Build check**

Run: `pnpm build`
Expected: No TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/board-store.ts src/lib/playbook-store.ts src/lib/conversation-store.ts src/lib/folder-store.ts src/lib/credit-store.ts
git commit -m "fix: defensive localStorage parsing — no more data wipe on version bump

Previously, any STORAGE_VERSION change triggered localStorage.removeItem()
which deleted all user data. Now: try to parse stored data regardless of
version. Only wipe if JSON.parse fails (actual corruption). Stamp new
version after successful load."
```

---

## Task 7: Final verification

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: Clean build, no errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: No new lint errors.

- [ ] **Step 3: Manual smoke test checklist**

Run: `pnpm dev`

1. Send a chat message — should classify and respond normally
2. Create a board with 2-3 cards — should persist after refresh
3. Check browser console for `[board-store]`, `[playbook-store]`, `[conversation-store]` logs — no errors
4. If sync fails (disconnect network briefly), sidebar should show "Unsaved changes" indicator
5. Close and reopen tab — data should survive (localStorage safety net)

- [ ] **Step 4: Commit any remaining fixes if needed**
