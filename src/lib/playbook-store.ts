import type {
  Playbook,
  PlaybookSummary,
  PlaybookRunHistory,
  PlaybookChangelogEntry,
  PlaybookNode,
  NodeDetail,
  AnyPlaybook,
  PlaybookCellV2,
} from "./playbook-types";
import { isPlaybookV2, toPlaybookSummary } from "./playbook-types";
import { invalidateCatalog } from "./catalog-invalidation";
import { apiFetch } from "@/lib/api-client";
import { markSyncPending, markSynced, markSyncError } from "@/lib/sync-status";

/* ── Storage keys ── */

const STORAGE_KEY = "baby-sentinel-playbooks";
const VERSION_KEY = "baby-sentinel-playbooks-version";
const MIGRATED_KEY = "baby-sentinel-playbooks-migrated";
const STORAGE_VERSION = 2; // bumped for server migration

/* ── Module-level state ── */

const savedPlaybooks = new Map<string, AnyPlaybook>();
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Track which datasets have had auto-seeding attempted
const seededDatasets = new Set<string>();

// Server write-behind debounce
const serverDebounce = new Map<string, ReturnType<typeof setTimeout>>();
const SERVER_DEBOUNCE_MS = 1000;

/* ── JSON safety ── */

function safeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  return value;
}

function summarizePlaybookForLog(playbook: AnyPlaybook) {
  const isV2 = "schemaVersion" in playbook && playbook.schemaVersion === 2;
  const cells = isV2 ? (playbook.cells as PlaybookCellV2[]) : [];
  const sqlCells = cells.filter((cell) => cell.type === "sql");
  const llmCells = cells.filter((cell) => cell.type === "llm");
  return {
    id: playbook.id,
    name: playbook.name,
    schemaVersion: isV2 ? 2 : 1,
    datasetId: playbook.datasetId,
    cellCount: playbook.cells.length,
    sqlCount: isV2 ? sqlCells.length : undefined,
    llmCount: isV2 ? llmCells.length : undefined,
    missingSql: isV2 ? sqlCells.filter((cell) => !cell.sql?.trim()).map((cell) => cell.id) : undefined,
    runHistoryCount: playbook.runHistory.length,
  };
}

/* ── Initialization ── */

function ensureInitialized() {
  if (typeof window === "undefined") return;

  const storedVersion = localStorage.getItem(VERSION_KEY);
  if (storedVersion !== null && storedVersion !== String(STORAGE_VERSION)) {
    console.warn(`[playbook-store] version mismatch: stored="${storedVersion}" current="${STORAGE_VERSION}" — attempting to load anyway`);
  }

  if (initialized) return;
  initialized = true;

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

  localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION));
  hydrateFromServer();
}

function hydrateFromServer() {
  // Check if we need to migrate localStorage → server
  const alreadyMigrated = localStorage.getItem(MIGRATED_KEY);

  apiFetch<PlaybookSummary[]>("/api/playbooks", { skipModel: true })
    .then(async (serverSummaries) => {
      if (serverSummaries.length === 0 && savedPlaybooks.size > 0 && !alreadyMigrated) {
        // Server empty, local has data — migrate to server
        const allPlaybooks = Array.from(savedPlaybooks.values());
        await apiFetch("/api/playbooks", {
          method: "POST",
          body: { migrate: allPlaybooks },
          skipModel: true,
        }).catch((err) => {
          console.warn("[playbook-store] migration failed:", err);
          markSyncError();
        });
        localStorage.setItem(MIGRATED_KEY, "1");
      } else if (serverSummaries.length > 0) {
        // Server has data — fetch each playbook and replace local
        for (const summary of serverSummaries) {
          try {
            const full = await apiFetch<AnyPlaybook>(
              `/api/playbooks/${summary.id}`,
              { skipModel: true }
            );
            if (full && full.id) {
              savedPlaybooks.set(full.id, full);
            }
          } catch {
            /* skip failed playbook */
          }
        }
        localStorage.setItem(MIGRATED_KEY, "1");
        // Update localStorage cache with server data
        persistSync();
      }
    })
    .catch((err) => {
      console.warn("[playbook-store] server hydration failed:", err);
      markSyncError();
    });
}

/* ── Persistence ── */

function persistDebounced() {
  if (typeof window === "undefined") return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    persistSync();
  }, 300);
}

function persistSync() {
  if (typeof window === "undefined") return;
  try {
    const all = Array.from(savedPlaybooks.values());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all, safeReplacer));
  } catch (err) {
    console.warn("[playbook-store] failed to persist:", err);
  }
}

/* ── Server write-behind ── */

function serverUpsertPlaybook(playbook: AnyPlaybook) {
  const key = `pb-${playbook.id}`;
  const existing = serverDebounce.get(key);
  if (existing) clearTimeout(existing);
  console.log("[playbook-store] server upsert scheduled", summarizePlaybookForLog(playbook));

  serverDebounce.set(
    key,
    setTimeout(() => {
      serverDebounce.delete(key);
      markSyncPending();
      console.log("[playbook-store] server upsert start", summarizePlaybookForLog(playbook));
      apiFetch(`/api/playbooks/${playbook.id}`, {
        method: "PUT",
        body: playbook,
        skipModel: true,
      })
        .then(() => {
          console.log("[playbook-store] server upsert success", summarizePlaybookForLog(playbook));
          markSynced();
        })
        .catch((err) => {
          console.warn("[playbook-store] server upsert failed:", err);
          markSyncError();
        });
    }, SERVER_DEBOUNCE_MS)
  );
}

function serverDeletePlaybook(id: string) {
  // Cancel pending writes
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

/** Flush all pending server writes synchronously (localStorage on unload) */
export function flushPendingPlaybookPersists() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  persistSync();
}

// Register global handlers
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushPendingPlaybookPersists);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingPlaybookPersists();
    }
  });
}

/* ── Public API ── */

export function isDatasetSeeded(datasetId: string): boolean {
  return seededDatasets.has(datasetId);
}

export function markDatasetSeeded(datasetId: string): void {
  seededDatasets.add(datasetId);
}

export function savePlaybook(playbook: AnyPlaybook): boolean {
  try {
    ensureInitialized();
    console.log("[playbook-store] savePlaybook", summarizePlaybookForLog(playbook));
    savedPlaybooks.set(playbook.id, playbook);
    invalidateCatalog();
    persistDebounced();
    serverUpsertPlaybook(playbook);
    return true;
  } catch (err) {
    console.warn("[playbook-store] savePlaybook failed", {
      summary: summarizePlaybookForLog(playbook),
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function getPlaybook(id: string): AnyPlaybook | undefined {
  ensureInitialized();
  return savedPlaybooks.get(id);
}

export function updatePlaybook(
  id: string,
  changes: Partial<AnyPlaybook>
): boolean {
  ensureInitialized();
  const pb = savedPlaybooks.get(id);
  if (!pb) return false;
  Object.assign(pb, changes);
  persistDebounced();
  serverUpsertPlaybook(pb);
  return true;
}

// ── V2 Cell Operations ──

export function updateCellV2(
  playbookId: string,
  cellId: string,
  changes: Partial<PlaybookCellV2>
): boolean {
  ensureInitialized();
  const pb = savedPlaybooks.get(playbookId);
  if (!pb || !isPlaybookV2(pb)) return false;
  const cell = pb.cells.find((c) => c.id === cellId);
  if (!cell) return false;
  Object.assign(cell, changes);
  persistDebounced();
  serverUpsertPlaybook(pb);
  return true;
}

export function addCellV2(playbookId: string, cell: PlaybookCellV2): boolean {
  ensureInitialized();
  const pb = savedPlaybooks.get(playbookId);
  if (!pb || !isPlaybookV2(pb)) return false;
  pb.cells.push(cell);
  persistDebounced();
  serverUpsertPlaybook(pb);
  return true;
}

export function removeCellV2(playbookId: string, cellId: string): boolean {
  ensureInitialized();
  const pb = savedPlaybooks.get(playbookId);
  if (!pb || !isPlaybookV2(pb)) return false;
  pb.cells = pb.cells.filter((c) => c.id !== cellId);
  for (const cell of pb.cells) {
    cell.dependsOn = cell.dependsOn.filter((dep) => dep !== cellId);
  }
  persistDebounced();
  serverUpsertPlaybook(pb);
  return true;
}

// ── V1 Operations (backward compat) ──

/** @deprecated Use updateCellV2 for V2 playbooks */
export function updateNodeDetail(
  playbookId: string,
  nodeId: string,
  changes: Partial<NodeDetail>
): boolean {
  ensureInitialized();
  const pb = savedPlaybooks.get(playbookId);
  if (!pb || isPlaybookV2(pb)) return false;
  const v1 = pb as Playbook;
  const node = v1.nodeDetails.find((n) => n.id === nodeId);
  if (!node) return false;
  Object.assign(node, changes);

  const sqlGroup = v1.cells.find((c) => c.type === "sql-group");
  if (sqlGroup?.nodes) {
    const cellNode = sqlGroup.nodes.find((n) => n.id === nodeId);
    if (cellNode) {
      if (changes.label) cellNode.label = changes.label;
      if (changes.description) cellNode.description = changes.description;
      if (changes.code) cellNode.sql = changes.code;
    }
  }

  persistDebounced();
  serverUpsertPlaybook(pb);
  return true;
}

/** @deprecated Use addCellV2 for V2 playbooks */
export function addSqlNode(
  playbookId: string,
  node: PlaybookNode,
  detail: NodeDetail
): boolean {
  ensureInitialized();
  const pb = savedPlaybooks.get(playbookId);
  if (!pb || isPlaybookV2(pb)) return false;
  const v1 = pb as Playbook;

  const sqlGroup = v1.cells.find((c) => c.type === "sql-group");
  if (!sqlGroup) return false;
  if (!sqlGroup.nodes) sqlGroup.nodes = [];

  sqlGroup.nodes.push(node);
  sqlGroup.label = `SQL Queries · ${sqlGroup.nodes.length} Parallel`;
  v1.nodeDetails.push(detail);
  persistDebounced();
  serverUpsertPlaybook(pb);
  return true;
}

/** @deprecated Use removeCellV2 for V2 playbooks */
export function removeSqlNode(playbookId: string, nodeId: string): boolean {
  ensureInitialized();
  const pb = savedPlaybooks.get(playbookId);
  if (!pb || isPlaybookV2(pb)) return false;
  const v1 = pb as Playbook;

  const sqlGroup = v1.cells.find((c) => c.type === "sql-group");
  if (!sqlGroup?.nodes) return false;

  sqlGroup.nodes = sqlGroup.nodes.filter((n) => n.id !== nodeId);
  sqlGroup.label = `SQL Queries · ${sqlGroup.nodes.length} Parallel`;
  v1.nodeDetails = v1.nodeDetails.filter((n) => n.id !== nodeId);
  persistDebounced();
  serverUpsertPlaybook(pb);
  return true;
}

export function deletePlaybook(id: string): boolean {
  ensureInitialized();
  const result = savedPlaybooks.delete(id);
  if (result) {
    invalidateCatalog();
    persistDebounced();
    serverDeletePlaybook(id);
  }
  return result;
}

export function addChangelog(
  id: string,
  entry: PlaybookChangelogEntry
): boolean {
  try {
    ensureInitialized();
    const pb = savedPlaybooks.get(id);
    if (pb && isPlaybookV2(pb)) {
      if (!pb.changelog) pb.changelog = [];
      pb.changelog = [entry, ...pb.changelog];
      persistDebounced();
      serverUpsertPlaybook(pb);
    }
    return true;
  } catch {
    return false;
  }
}

export function addRunHistory(id: string, run: PlaybookRunHistory): boolean {
  try {
    ensureInitialized();
    const pb = savedPlaybooks.get(id);
    if (!pb) return false;
    if (!pb.runHistory) pb.runHistory = [];
    pb.runHistory = [run, ...pb.runHistory].slice(0, 50);
    persistDebounced();
    serverUpsertPlaybook(pb);
    return true;
  } catch {
    return false;
  }
}

export function getSavedPlaybookSummaries(): PlaybookSummary[] {
  ensureInitialized();
  return Array.from(savedPlaybooks.values()).map(toPlaybookSummary);
}

export function getAllSavedPlaybooks(): AnyPlaybook[] {
  ensureInitialized();
  return Array.from(savedPlaybooks.values());
}

/**
 * Returns saved playbook summaries, optionally filtered by dataset.
 * Playbooks without a datasetId are included for backward compatibility.
 */
export function getAllPlaybookSummariesMerged(
  datasetId?: string
): PlaybookSummary[] {
  ensureInitialized();
  let saved = Array.from(savedPlaybooks.values());
  if (datasetId) {
    saved = saved.filter((pb) => !pb.datasetId || pb.datasetId === datasetId);
  }
  return saved.map(toPlaybookSummary);
}
