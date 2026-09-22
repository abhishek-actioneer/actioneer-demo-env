import type { KnowledgeEntry } from "./knowledge-types";
import { invalidateCatalog } from "./catalog-invalidation";

const stores = new Map<string, Map<string, KnowledgeEntry>>();
const initialized = new Set<string>();

function ensureInitialized(datasetId: string) {
  if (initialized.has(datasetId)) return;
  initialized.add(datasetId);

  const map = new Map<string, KnowledgeEntry>();
  stores.set(datasetId, map);
}

function getStore(datasetId: string): Map<string, KnowledgeEntry> {
  ensureInitialized(datasetId);
  return stores.get(datasetId)!;
}

export function saveKnowledgeEntry(datasetId: string, entry: KnowledgeEntry): boolean {
  try {
    getStore(datasetId).set(entry.id, entry);
    invalidateCatalog();
    return true;
  } catch {
    return false;
  }
}

export function getKnowledgeEntry(datasetId: string, id: string): KnowledgeEntry | undefined {
  return getStore(datasetId).get(id);
}

export function deleteKnowledgeEntry(datasetId: string, id: string): boolean {
  try {
    getStore(datasetId).delete(id);
    invalidateCatalog();
    return true;
  } catch {
    return false;
  }
}

export function updateKnowledgeEntry(
  datasetId: string,
  id: string,
  updates: Partial<Omit<KnowledgeEntry, "id">>
): boolean {
  try {
    const store = getStore(datasetId);
    const existing = store.get(id);
    if (existing) {
      store.set(id, { ...existing, ...updates });
    }
    return true;
  } catch {
    return false;
  }
}

/** Bulk-load entries into the client-side store (e.g. from API response) */
export function bulkLoadEntries(datasetId: string, entries: KnowledgeEntry[]): void {
  const store = getStore(datasetId);
  for (const entry of entries) {
    store.set(entry.id, entry);
  }
  invalidateCatalog();
}

export function getAllEntries(datasetId: string): KnowledgeEntry[] {
  return Array.from(getStore(datasetId).values());
}

export function getGlobalEntries(datasetId: string): KnowledgeEntry[] {
  return Array.from(getStore(datasetId).values()).filter((e) => e.level === "global");
}

export function getUserEntries(datasetId: string): KnowledgeEntry[] {
  return Array.from(getStore(datasetId).values()).filter((e) => e.level === "user");
}
