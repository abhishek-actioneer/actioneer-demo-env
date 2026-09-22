import { setConversationFolder, getConversationSummaries } from "./conversation-store";
import type { ConversationSummary } from "./conversation-types";
import { apiFetch } from "./api-client";

/* ── Types ── */

export interface Folder {
  id: string;
  name: string;
  datasetId: string;
  createdAt: number;
}

/* ── State ── */

const folderMap = new Map<string, Folder>();
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let serverSynced = false;

const STORAGE_KEY = "baby-sentinel-folders";
const STORAGE_VERSION = 2; // bumped for server migration

/* ── Initialization ── */

function ensureInitialized() {
  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");
    if (storedVersion !== null && storedVersion !== String(STORAGE_VERSION)) {
      console.warn(`[folder-store] version mismatch: stored="${storedVersion}" current="${STORAGE_VERSION}" — attempting to load anyway`);
    }
  }

  if (initialized) return;
  initialized = true;

  // Step 1: Restore from localStorage (fast)
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

    // Step 2: Background server hydration
    if (!serverSynced) {
      serverSynced = true;
      hydrateFromServer();
    }
  }
}

/* ── Server communication ── */

async function hydrateFromServer() {
  try {
    const serverFolders = await apiFetch<{ id: string; name: string; datasetId?: string; createdAt: string }[]>(
      "/api/folders",
      { skipModel: true },
    );
    if (serverFolders.length > 0) {
      // Server is source of truth — replace local
      folderMap.clear();
      for (const f of serverFolders) {
        folderMap.set(f.id, {
          id: f.id,
          name: f.name,
          datasetId: f.datasetId ?? "",
          createdAt: new Date(f.createdAt).getTime(),
        });
      }
      writeLocalStorage();
    } else if (folderMap.size > 0) {
      // Server empty, local has data — migrate
      for (const folder of folderMap.values()) {
        serverUpsertFolder(folder);
      }
    }
  } catch {
    // Server unavailable — localStorage is fallback
  }
}

const serverDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function serverUpsertFolder(folder: Folder) {
  const key = folder.id;
  const existing = serverDebounceTimers.get(key);
  if (existing) clearTimeout(existing);
  serverDebounceTimers.set(
    key,
    setTimeout(() => {
      serverDebounceTimers.delete(key);
      apiFetch("/api/folders", {
        method: "POST",
        body: {
          id: folder.id,
          name: folder.name,
          datasetId: folder.datasetId,
          createdAt: new Date(folder.createdAt).toISOString(),
        },
        skipModel: true,
      }).catch(() => {});
    }, 1000),
  );
}

function serverDeleteFolder(id: string) {
  const existing = serverDebounceTimers.get(id);
  if (existing) clearTimeout(existing);
  serverDebounceTimers.delete(id);
  apiFetch(`/api/folders?id=${id}`, { method: "DELETE", skipModel: true }).catch(() => {});
}

/* ── localStorage persistence ── */

function writeLocalStorage() {
  if (typeof window === "undefined") return;
  try {
    const items = Array.from(folderMap.values());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // silent
  }
}

function persistToStorage() {
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    writeLocalStorage();
  }, 300);
}

function flushToStorage() {
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  writeLocalStorage();
}

/* ── Public API ── */

/** Create a new folder. Returns the created folder. */
export function createFolder(name: string, datasetId: string): Folder {
  ensureInitialized();
  const trimmed = name.trim().slice(0, 50);
  if (!trimmed) throw new Error("Folder name cannot be empty");
  const folder: Folder = {
    id: crypto.randomUUID(),
    name: trimmed,
    datasetId,
    createdAt: Date.now(),
  };
  folderMap.set(folder.id, folder);
  flushToStorage();
  serverUpsertFolder(folder);
  return folder;
}

/** Rename an existing folder. */
export function renameFolder(id: string, name: string): boolean {
  ensureInitialized();
  const folder = folderMap.get(id);
  if (!folder) return false;
  const trimmed = name.trim().slice(0, 50);
  if (!trimmed) return false;
  const updated = { ...folder, name: trimmed };
  folderMap.set(id, updated);
  persistToStorage();
  serverUpsertFolder(updated);
  return true;
}

/** Delete a folder. All conversations in it become uncategorized. */
export async function deleteFolder(id: string): Promise<boolean> {
  ensureInitialized();
  if (!folderMap.has(id)) return false;
  const summaries = await getConversationSummaries();
  for (const s of summaries) {
    if (s.folderId === id) {
      await setConversationFolder(s.id, undefined);
    }
  }
  folderMap.delete(id);
  flushToStorage();
  serverDeleteFolder(id);
  return true;
}

/** Get all folders for a dataset, sorted by createdAt descending (newest first). */
export function getFolders(datasetId: string): Folder[] {
  ensureInitialized();
  return Array.from(folderMap.values())
    .filter((f) => f.datasetId === datasetId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Get a single folder by ID. */
export function getFolder(id: string): Folder | undefined {
  ensureInitialized();
  return folderMap.get(id);
}

/** Add a chat to a folder (moves it if already in another folder). */
export async function addChatToFolder(conversationId: string, folderId: string): Promise<boolean> {
  ensureInitialized();
  if (!folderMap.has(folderId)) return false;
  return await setConversationFolder(conversationId, folderId);
}

/** Remove a chat from its folder (becomes uncategorized). */
export async function removeChatFromFolder(conversationId: string): Promise<boolean> {
  return setConversationFolder(conversationId, undefined);
}

/** Get all chats in a specific folder. */
export async function getChatsInFolder(folderId: string): Promise<ConversationSummary[]> {
  ensureInitialized();
  const summaries = await getConversationSummaries();
  return summaries.filter((c) => c.folderId === folderId);
}
