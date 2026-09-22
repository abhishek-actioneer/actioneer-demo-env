import type { Conversation, ConversationSummary, PendingAction } from "./conversation-types";
import type { ChatMessage } from "@/lib/types";
import { deriveConversationTags } from "@/lib/conversation-tagger";
import { apiFetch } from "@/lib/api-client";
import { markSyncPending, markSynced, markSyncError } from "@/lib/sync-status";

// ── In-memory cache ──
const conversationMap = new Map<string, Conversation>();
let initialized = false;
let initPromise: Promise<void> | null = null;

const STORAGE_KEY = "baby-sentinel-conversations";
const STORAGE_VERSION = 3;
const MIGRATED_KEY = "baby-sentinel-conversations-migrated";

// Debounce timers for server writes per conversation
const serverDebounce = new Map<string, ReturnType<typeof setTimeout>>();
const SERVER_DEBOUNCE_MS = 2000;

function stripVolatileVariants(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(
    (m) => m.variant !== "gathering" && m.variant !== "streaming"
  );
}

function extractPendingActions(
  messages: ChatMessage[],
  existing?: PendingAction[]
): PendingAction[] {
  const existingMap = new Map((existing || []).map((a) => [a.id, a]));

  for (const msg of messages) {
    if (!msg.followUpActions) continue;
    for (const action of msg.followUpActions) {
      if (action.type === "follow-up-question") continue;
      const key = `${msg.id}-${action.id}`;
      if (!existingMap.has(key)) {
        existingMap.set(key, {
          id: key,
          type: action.type,
          label: action.label,
          messageId: msg.id,
          createdAt: msg.timestamp,
          payload: action.payload,
        });
      }
    }
  }

  return Array.from(existingMap.values());
}

function sanitizeStoredConversation(candidate: unknown): Conversation | null {
  if (!candidate || typeof candidate !== "object") return null;
  const c = candidate as Partial<Conversation>;

  if (typeof c.id !== "string" || typeof c.title !== "string" || !Array.isArray(c.messages)) {
    return null;
  }

  return {
    id: c.id,
    title: c.title,
    messages: c.messages as ChatMessage[],
    createdAt: Number(c.createdAt ?? Date.now()),
    updatedAt: Number(c.updatedAt ?? c.createdAt ?? Date.now()),
    origin: c.origin,
    sourceCanvasItemId: c.sourceCanvasItemId,
    datasetId: c.datasetId,
    tags: Array.isArray(c.tags) ? c.tags : [],
    pendingActions: Array.isArray(c.pendingActions) ? c.pendingActions : [],
    folderId: c.folderId,
  };
}

// ── localStorage helpers (fallback/cache) ──

function readLocalStorage(): Conversation[] {
  if (typeof window === "undefined") return [];

  try {
    const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");

    // v1→v2 migration: strip deck-generated conversations from local cache
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed)
      ? parsed
          .map((item) => sanitizeStoredConversation(item))
          .filter((item): item is Conversation => Boolean(item))
      : [];

    if (storedVersion !== String(STORAGE_VERSION)) {
      // Cache schema changed — drop the stale cache entirely so the server stays
      // the source of truth. Without this, chats deleted on the server resurrect
      // from this local cache and the sidebar never syncs to an empty workspace.
      localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // best effort
      }
      return [];
    }

    return items;
  } catch {
    return [];
  }
}

/** Cap localStorage to the 20 most recent conversations (server has all) */
const MAX_LOCAL_CONVERSATIONS = 20;

function writeLocalStorage() {
  if (typeof window === "undefined") return;

  try {
    const items = Array.from(conversationMap.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_LOCAL_CONVERSATIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
  } catch {
    // localStorage full or unavailable — silent
  }
}

// ── Server communication ──

type ConversationSummaryRow = {
  id: string;
  title: string;
  dataset_id?: string | null;
  folder_id?: string | null;
  updated_at?: number;
  origin?: "user" | "deck";
};

type ConversationSummaryFromServer = ConversationSummary & {
  updatedAt: number;
  createdAt: number;
  origin?: "user" | "deck";
};

// Returns the server's conversations, or `null` if the server is unreachable.
// An empty array means "the server has no conversations" (authoritative), which
// is different from a fetch failure — so a cleared workspace doesn't resurrect
// from the local cache.
async function fetchSummariesFromServer(): Promise<ConversationSummaryFromServer[] | null> {
  try {
    const rows = await apiFetch<ConversationSummaryRow[]>("/api/conversations", {
      skipModel: true,
      skipDataset: true,
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      datasetId: row.dataset_id || undefined,
      folderId: row.folder_id || undefined,
      updatedAt: row.updated_at ?? Date.now(),
      createdAt: row.updated_at ?? Date.now(),
      origin: row.origin,
      // origin is intentionally excluded from the public summary shape
    }));
  } catch {
    return null;
  }
}

async function fetchConversationFromServer(id: string): Promise<Conversation | null> {
  try {
    return await apiFetch<Conversation>(`/api/conversations/${id}`, {
      skipModel: true,
      skipDataset: true,
    });
  } catch {
    return null;
  }
}

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

function debouncedPatchOnServer(id: string, data: Record<string, unknown>): void {
  const existing = serverDebounce.get(id);
  if (existing) clearTimeout(existing);

  serverDebounce.set(
    id,
    setTimeout(() => {
      serverDebounce.delete(id);
      patchOnServer(id, data);
    }, SERVER_DEBOUNCE_MS)
  );
}


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

// ── Initialization ──

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      conversationMap.clear();

      // Try server first
      const serverSummaries = await fetchSummariesFromServer();

      if (serverSummaries === null) {
        // Server unreachable — fall back to the local cache so the app still
        // works offline. (Does NOT push anything back to the server.)
        readLocalStorage().forEach((c) => conversationMap.set(c.id, c));
        initialized = true;
        return;
      }

      if (serverSummaries.length > 0) {
        // Server has data — populate cache with summaries (messages loaded lazily)
        for (const s of serverSummaries) {
          if (conversationMap.has(s.id)) continue;
          conversationMap.set(s.id, {
            id: s.id,
            title: s.title,
            datasetId: s.datasetId,
            folderId: s.folderId,
            origin: s.origin as "user" | "deck" | undefined,
            messages: [],
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          });
        }
        writeLocalStorage();
      } else {
        // Server reachable and EMPTY — it is the source of truth. Migrate any
        // legacy local-only chats exactly once; after that, never resurrect, so
        // a cleared workspace stays cleared and the sidebar syncs to empty.
        const localConvs = readLocalStorage();
        const alreadyMigrated =
          typeof window !== "undefined" && localStorage.getItem(MIGRATED_KEY) === "true";

        if (localConvs.length > 0 && !alreadyMigrated) {
          localConvs.forEach((c) => {
            conversationMap.set(c.id, c);
          });
          await migrateFromLocalStorage(localConvs);
          writeLocalStorage();
        } else {
          // Nothing anywhere — start with clean slate
          writeLocalStorage();
        }
      }

      initialized = true;
    } finally {
      initPromise = null;
      if (!initialized) {
        // Ensure partial init isn't stuck in limbo
        initialized = conversationMap.size > 0;
      }
    }
  })();

  return initPromise;
}

// ── Public API ──

export async function saveConversation(conv: Conversation): Promise<void> {
  await ensureInitialized();

  const tags = deriveConversationTags(conv.messages);
  const pendingActions = extractPendingActions(conv.messages, conv.pendingActions);
  const full = { ...conv, tags, pendingActions };

  await createOnServer({
    id: conv.id,
    title: conv.title,
    datasetId: conv.datasetId,
    origin: conv.origin,
  });

  conversationMap.set(conv.id, full);
  writeLocalStorage();

  patchOnServer(conv.id, {
    messages: stripVolatileVariants(conv.messages),
    tags,
    pendingActions,
  });
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  await ensureInitialized();

  const cached = conversationMap.get(id);
  if (cached && cached.messages.length > 0) return cached;

  const fromServer = await fetchConversationFromServer(id);
  if (fromServer) {
    conversationMap.set(id, fromServer);
    writeLocalStorage();
    return fromServer;
  }

  return cached;
}

export async function getAllConversations(): Promise<Conversation[]> {
  await ensureInitialized();
  return Array.from(conversationMap.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
}

export async function getConversationSummaries(filterDatasetId?: string): Promise<ConversationSummary[]> {
  await ensureInitialized();

  let items = Array.from(conversationMap.values()).filter(
    (c) => c.origin !== "deck"
  );
  if (filterDatasetId) {
    // Strict per-workspace scoping: a conversation only belongs to the workspace
    // it was created in. (Previously conversations without a datasetId leaked
    // into every workspace.)
    items = items.filter((c) => c.datasetId === filterDatasetId);
  }

  return items
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ id, title, datasetId, folderId }) => ({ id, title, datasetId, folderId }));
}

export async function getUncategorizedChats(datasetId?: string): Promise<ConversationSummary[]> {
  return (await getConversationSummaries(datasetId)).filter((c) => !c.folderId);
}

export async function setConversationFolder(
  conversationId: string,
  folderId: string | undefined
): Promise<boolean> {
  await ensureInitialized();

  const conv = conversationMap.get(conversationId);
  if (!conv) return false;

  conversationMap.set(conversationId, {
    ...conv,
    folderId,
  });
  writeLocalStorage();

  patchOnServer(conversationId, { folderId: folderId || null });
  return true;
}

export async function updateConversationMessages(
  id: string,
  messages: ChatMessage[]
): Promise<boolean> {
  await ensureInitialized();

  const existing = conversationMap.get(id);
  if (!existing) return false;

  const strippedMessages = stripVolatileVariants(messages);
  const tags = deriveConversationTags(strippedMessages);
  const pendingActions = extractPendingActions(strippedMessages, existing.pendingActions);

  conversationMap.set(id, {
    ...existing,
    messages: strippedMessages,
    tags,
    pendingActions,
    updatedAt: Date.now(),
  });
  writeLocalStorage();

  debouncedPatchOnServer(id, {
    messages: strippedMessages,
    tags,
    pendingActions,
    title: existing.title,
    datasetId: existing.datasetId,
  });

  return true;
}

export async function deleteConversation(id: string): Promise<void> {
  await ensureInitialized();

  conversationMap.delete(id);
  writeLocalStorage();

  await deleteOnServer(id);
}

/** Synchronous localStorage write — for beforeunload where async is unreliable */
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

export async function markPendingAction(
  conversationId: string,
  actionId: string,
  status: "completed" | "dismissed"
): Promise<boolean> {
  const conv = conversationMap.get(conversationId);
  if (!conv?.pendingActions) return false;

  const action = conv.pendingActions.find((a) => a.id === actionId);
  if (!action) return false;

  if (status === "completed") {
    action.completedAt = Date.now();
  } else {
    action.dismissedAt = Date.now();
  }

  writeLocalStorage();
  patchOnServer(conversationId, { pendingActions: conv.pendingActions });
  return true;
}
