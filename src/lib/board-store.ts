import type {
  Board,
  BoardCard,
  BoardSection,
  CardConnection,
  BoardFrame,
  CardComment,
  BoardSummary,
} from "./board-types";
import { apiFetch } from "@/lib/api-client";
import { markSyncPending, markSynced, markSyncError } from "@/lib/sync-status";

/* ── Storage keys ── */

const STORAGE_PREFIX = "baby-sentinel-boards";
const CARDS_PREFIX = "baby-sentinel-board-cards";
const CONNECTIONS_PREFIX = "baby-sentinel-board-connections";
const FRAMES_PREFIX = "baby-sentinel-board-frames";
const SECTIONS_PREFIX = "baby-sentinel-board-sections";
const STORAGE_VERSION = 13;

/* ── Module-level state ── */

const boardsMap = new Map<string, Board>();
const cardsMap = new Map<string, Map<string, BoardCard>>(); // boardId → cardId → card
const connectionsMap = new Map<string, CardConnection[]>(); // boardId → connections
const framesMap = new Map<string, BoardFrame[]>(); // boardId → frames
const sectionsMap = new Map<string, BoardSection[]>(); // boardId → sections
let initialized = false;
const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};



/* ── Initialization ── */

function ensureInitialized(datasetId?: string) {
  // Version check — runs BEFORE initialized guard to handle version mismatch
  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_PREFIX + "-version");
    // Only warn/clear if there WAS a stored version that is now mismatched;
    // null means first load (no prior storage) — no warning needed.
    if (storedVersion !== null && storedVersion !== String(STORAGE_VERSION)) {
      console.warn(`[board-store] version mismatch: stored="${storedVersion}" current="${STORAGE_VERSION}" — attempting to load anyway`);
    }
  }

  if (initialized) return;
  initialized = true;

  // Try restoring from localStorage first
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
        // Auto-cleanup: purge stale boards and legacy stores to prevent quota issues
        purgeStaleBoards();
        clearLegacyStorage();
      } else {
        console.log("[board-store] init: no boards in localStorage — starting empty");
      }
      // Stamp the current version so future version bumps can detect and clear stale data
      localStorage.setItem(STORAGE_PREFIX + "-version", String(STORAGE_VERSION));
    } catch (err) {
      console.warn("[board-store] init: failed to parse boards — clearing corrupt data:", err);
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

    // Background: hydrate from server (replaces localStorage data with server truth).
    // Pass datasetId explicitly so this call works even before DatasetProvider's
    // useEffect has fired setActiveDatasetId() (race condition on first mount).
    if (!datasetId) return;
    apiFetch<Array<{ id: string; name: string; cardCount: number; updatedAt: string }>>("/api/boards", { skipModel: true, datasetId })
      .then(async (serverSummaries) => {
        if (serverSummaries.length === 0 && boardsMap.size > 0) {
          // Server empty, local has data — trigger migration
          const boardsToMigrate = Array.from(boardsMap.keys()).map(boardId => ({
            board: boardsMap.get(boardId)!,
            cards: Array.from(cardsMap.get(boardId)?.values() ?? []),
            sections: sectionsMap.get(boardId) ?? [],
            connections: connectionsMap.get(boardId) ?? [],
            frames: framesMap.get(boardId) ?? [],
          }));
          await apiFetch("/api/boards/migrate", {
            method: "POST",
            body: { boards: boardsToMigrate },
            skipModel: true,
          }).catch(err => { markSyncError(); console.warn("[board-store] migration failed:", err); });
        } else if (serverSummaries.length > 0) {
          // Server has data — fetch each board's full data and replace local
          for (const summary of serverSummaries) {
            try {
              const full = await apiFetch<{
                board: Board;
                cards: BoardCard[];
                sections: BoardSection[];
                connections: CardConnection[];
                frames: BoardFrame[];
              }>(`/api/boards/${summary.id}`, { skipModel: true });
              boardsMap.set(full.board.id, full.board);
              const cardMap = new Map<string, BoardCard>();
              full.cards.forEach(c => cardMap.set(c.id, c));
              cardsMap.set(full.board.id, cardMap);
              sectionsMap.set(full.board.id, full.sections);
              connectionsMap.set(full.board.id, full.connections);
              framesMap.set(full.board.id, full.frames);
            } catch { /* skip failed board */ }
          }
        }
      })
      .catch(err => { markSyncError(); console.warn("[board-store] server hydration failed:", err); });
  }
}

function loadBoardData(boardId: string) {
  if (typeof window === "undefined") return;

  // Load cards
  try {
    const cardsRaw = localStorage.getItem(`${CARDS_PREFIX}-${boardId}`);
    if (cardsRaw) {
      const cards: BoardCard[] = JSON.parse(cardsRaw);
      const cardMap = new Map<string, BoardCard>();
      cards.forEach((c) => cardMap.set(c.id, c));
      cardsMap.set(boardId, cardMap);
      console.log(`[board-store] loaded ${cards.length} cards for board "${boardId}" — content fields:`,
        cards.map(c => ({
          id: c.id.slice(0, 8),
          type: c.type,
          hasChartSpec: !!c.chartSpec,
          hasData: !!(c.data && c.data.length > 0),
          hasMarkdown: !!c.markdownContent,
          hasSql: !!c.sql,
        }))
      );
    } else {
      console.log(`[board-store] no cards in localStorage for board "${boardId}"`);
    }
  } catch (err) {
    console.warn(`[board-store] failed to load cards for board "${boardId}":`, err);
  }

  // Load connections
  try {
    const connsRaw = localStorage.getItem(
      `${CONNECTIONS_PREFIX}-${boardId}`
    );
    if (connsRaw) {
      connectionsMap.set(boardId, JSON.parse(connsRaw));
    }
  } catch {
    // ignore
  }

  // Load frames
  try {
    const framesRaw = localStorage.getItem(`${FRAMES_PREFIX}-${boardId}`);
    if (framesRaw) {
      framesMap.set(boardId, JSON.parse(framesRaw));
    }
  } catch {
    // ignore
  }

  // Load sections
  try {
    const sectionsRaw = localStorage.getItem(`${SECTIONS_PREFIX}-${boardId}`);
    if (sectionsRaw) {
      sectionsMap.set(boardId, JSON.parse(sectionsRaw));
    }
  } catch {
    // ignore
  }
}

/* ── Persistence ── */

/** Max rows to persist per card's `data` field (enough for table/chart display) */
const MAX_PERSISTED_ROWS = 30;

/** JSON replacer: coerce BigInt to Number to prevent serialization errors */
function safeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  return value;
}

/** Trim card data before serialization to keep localStorage usage bounded */
function trimCardForStorage(card: BoardCard): BoardCard {
  let trimmed = card;

  // Trim top-level data array
  if (trimmed.data && Array.isArray(trimmed.data) && trimmed.data.length > MAX_PERSISTED_ROWS) {
    trimmed = { ...trimmed, data: trimmed.data.slice(0, MAX_PERSISTED_ROWS) };
  }

  // Trim data nested inside chartSpec
  if (trimmed.chartSpec) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec = trimmed.chartSpec as any;
    if (Array.isArray(spec.data) && spec.data.length > MAX_PERSISTED_ROWS) {
      trimmed = {
        ...trimmed,
        chartSpec: { ...spec, data: spec.data.slice(0, MAX_PERSISTED_ROWS) },
      };
    }
  }

  return trimmed;
}

/**
 * Purge stale boards (0 cards, no localStorage entry) to free quota.
 * Keeps the demo board and any board with actual card data.
 */
function purgeStaleBoards(): number {
  if (typeof window === "undefined") return 0;
  let purged = 0;
  const staleIds: string[] = [];

  for (const [boardId] of boardsMap) {
    const cardMap = cardsMap.get(boardId);
    const hasCards = cardMap && cardMap.size > 0;
    if (!hasCards) {
      staleIds.push(boardId);
    }
  }

  for (const id of staleIds) {
    boardsMap.delete(id);
    cardsMap.delete(id);
    connectionsMap.delete(id);
    framesMap.delete(id);
    sectionsMap.delete(id);
    removeBoardStorage(id);
    purged++;
  }

  if (purged > 0) {
    console.log(`[board-store] purged ${purged} stale boards to free storage`);
    // Persist the trimmed boards list immediately
    try {
      const boards = Array.from(boardsMap.values());
      localStorage.setItem(STORAGE_PREFIX, JSON.stringify(boards, safeReplacer));
    } catch {
      // If even this fails, we're in deep trouble — clear everything
      console.warn("[board-store] failed to persist after purge — clearing all board storage");
      clearAllBoardStorage();
    }
  }

  return purged;
}

/** Nuclear option: clear ALL board-related localStorage */
function clearAllBoardStorage() {
  if (typeof window === "undefined") return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key &&
      (key.startsWith(CARDS_PREFIX) ||
        key.startsWith(CONNECTIONS_PREFIX) ||
        key.startsWith(FRAMES_PREFIX) ||
        key.startsWith(SECTIONS_PREFIX) ||
        key === STORAGE_PREFIX)
    ) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

/**
 * Aggressively free localStorage by clearing legacy/non-essential stores.
 * Called when stale board purge alone isn't enough.
 */
function clearLegacyStorage(): number {
  if (typeof window === "undefined") return 0;
  const legacyKeys = [
    "baby-sentinel-canvas-items",         // legacy canvas store (pre board-store)
    "baby-sentinel-canvas-items-version",
    "baby-sentinel-conversations",         // conversation history (rebuildable)
    "baby-sentinel-conversations-version",
  ];
  let freed = 0;
  for (const key of legacyKeys) {
    const raw = localStorage.getItem(key);
    if (raw) {
      freed += raw.length;
      localStorage.removeItem(key);
    }
  }
  // Also clear camera keys for deleted boards
  const cameraKeysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("baby-sentinel-canvas-camera-")) {
      const boardId = key.replace("baby-sentinel-canvas-camera-", "");
      if (!boardsMap.has(boardId)) {
        cameraKeysToRemove.push(key);
      }
    }
  }
  cameraKeysToRemove.forEach((k) => localStorage.removeItem(k));
  if (freed > 0) {
    console.log(`[board-store] cleared ~${Math.round(freed / 1024)}KB of legacy/non-essential storage`);
  }
  return freed;
}

/**
 * Pending persist functions keyed by debounce key.
 * Allows synchronous flush on page unload / visibility change.
 */
const pendingPersists = new Map<string, () => void>();

function debouncedPersist(key: string, fn: () => void) {
  if (typeof window === "undefined") return;
  if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
  // Store the persist function so it can be flushed synchronously
  pendingPersists.set(key, fn);
  debounceTimers[key] = setTimeout(() => {
    delete debounceTimers[key];
    pendingPersists.delete(key);
    try {
      fn();
    } catch (err) {
      console.warn(`[board-store] persist failed for "${key}":`, err);
    }
  }, 300);
}

/**
 * Flush all pending debounced persists synchronously.
 * Called on beforeunload / visibilitychange to prevent data loss.
 */
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

// Register global handlers to flush on page unload and tab hide
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushPendingPersists);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingPersists();
    }
  });
}

function persistBoards() {
  debouncedPersist("boards", () => {
    const boards = Array.from(boardsMap.values());
    localStorage.setItem(STORAGE_PREFIX, JSON.stringify(boards, safeReplacer));
  });
}

function persistBoardCards(boardId: string) {
  debouncedPersist(`cards-${boardId}`, () => {
    const cardMap = cardsMap.get(boardId);
    const cards = cardMap ? Array.from(cardMap.values()).map(trimCardForStorage) : [];
    localStorage.setItem(
      `${CARDS_PREFIX}-${boardId}`,
      JSON.stringify(cards, safeReplacer)
    );
  });
}

/** Synchronous version — writes to localStorage immediately (no debounce) */
function persistBoardCardsSync(boardId: string) {
  if (typeof window === "undefined") return;
  // Cancel any pending debounced write for this board's cards
  const key = `cards-${boardId}`;
  if (debounceTimers[key]) {
    clearTimeout(debounceTimers[key]);
    delete debounceTimers[key];
    pendingPersists.delete(key);
  }
  const cardMap = cardsMap.get(boardId);
  const cards = cardMap ? Array.from(cardMap.values()).map(trimCardForStorage) : [];
  const payload = JSON.stringify(cards, safeReplacer);
  try {
    localStorage.setItem(`${CARDS_PREFIX}-${boardId}`, payload);
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      // Free space: purge stale boards + clear legacy stores, then retry
      console.warn(`[board-store] QuotaExceededError — freeing storage and retrying`);
      purgeStaleBoards();
      clearLegacyStorage();
      try {
        localStorage.setItem(`${CARDS_PREFIX}-${boardId}`, payload);
        console.log(`[board-store] retry succeeded after cleanup`);
      } catch (retryErr) {
        console.warn(`[board-store] retry still failed for board "${boardId}":`, retryErr);
      }
    } else {
      console.warn(`[board-store] sync persist cards failed for board "${boardId}":`, err);
    }
  }
}

/** Synchronous version of persistBoards */
function persistBoardsSync() {
  if (typeof window === "undefined") return;
  const key = "boards";
  if (debounceTimers[key]) {
    clearTimeout(debounceTimers[key]);
    delete debounceTimers[key];
    pendingPersists.delete(key);
  }
  try {
    const boards = Array.from(boardsMap.values());
    localStorage.setItem(STORAGE_PREFIX, JSON.stringify(boards, safeReplacer));
  } catch (err) {
    console.warn("[board-store] sync persist boards failed:", err);
  }
}

function persistBoardConnections(boardId: string) {
  debouncedPersist(`conns-${boardId}`, () => {
    const conns = connectionsMap.get(boardId) ?? [];
    localStorage.setItem(
      `${CONNECTIONS_PREFIX}-${boardId}`,
      JSON.stringify(conns, safeReplacer)
    );
  });
}

function persistBoardFrames(boardId: string) {
  debouncedPersist(`frames-${boardId}`, () => {
    const frames = framesMap.get(boardId) ?? [];
    localStorage.setItem(
      `${FRAMES_PREFIX}-${boardId}`,
      JSON.stringify(frames, safeReplacer)
    );
  });
}

function persistBoardSections(boardId: string) {
  debouncedPersist(`sections-${boardId}`, () => {
    const sections = sectionsMap.get(boardId) ?? [];
    localStorage.setItem(
      `${SECTIONS_PREFIX}-${boardId}`,
      JSON.stringify(sections, safeReplacer)
    );
  });
}

function removeBoardStorage(boardId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`${CARDS_PREFIX}-${boardId}`);
  localStorage.removeItem(`${CONNECTIONS_PREFIX}-${boardId}`);
  localStorage.removeItem(`${FRAMES_PREFIX}-${boardId}`);
  localStorage.removeItem(`${SECTIONS_PREFIX}-${boardId}`);
}

// ── Server write-behind ──

const SERVER_DEBOUNCE_MS = 1000;
const serverDebounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function serverWriteBoard(board: Board) {
  markSyncPending();
  apiFetch("/api/boards", {
    method: "POST",
    body: { id: board.id, name: board.name, datasetId: board.datasetId, description: board.description, viewMode: board.viewMode, deckId: board.deckId },
    skipModel: true,
  }).then(() => markSynced()).catch(err => { markSyncError(); console.warn("[board-store] server write board failed:", err); });
}

function serverPatchBoard(board: Board) {
  markSyncPending();
  apiFetch(`/api/boards/${board.id}`, {
    method: "PATCH",
    body: { name: board.name, description: board.description, viewMode: board.viewMode, globalTimeRange: board.globalTimeRange, deckId: board.deckId, datasetId: board.datasetId },
    skipModel: true,
  }).then(() => markSynced()).catch(err => { markSyncError(); console.warn("[board-store] server patch board failed:", err); });
}

function serverDeleteBoard(boardId: string) {
  // Cancel any pending server writes for this board
  for (const key of Object.keys(serverDebounceTimers)) {
    if (key.startsWith(`board-${boardId}`)) {
      clearTimeout(serverDebounceTimers[key]);
      delete serverDebounceTimers[key];
    }
  }
  markSyncPending();
  apiFetch(`/api/boards/${boardId}`, { method: "DELETE", skipModel: true })
    .then(() => markSynced())
    .catch(err => { markSyncError(); console.warn("[board-store] server delete board failed:", err); });
}

/** Populate any board with LLM-generated sections and cards (used by template boards) */
export function populateBoard(
  boardId: string,
  data: {
    name: string;
    description: string;
    sections: Array<{
      id: string;
      boardId: string;
      title: string;
      prose: string;
      order: number;
      collapsed: boolean;
    }>;
    cards: Array<BoardCard>;
  }
): void {
  ensureInitialized();
  const board = boardsMap.get(boardId);
  if (!board) return;

  // Update board metadata
  board.name = data.name;
  board.description = data.description;
  board.updatedAt = new Date().toISOString();
  boardsMap.set(boardId, board);

  // Set sections
  const sections: BoardSection[] = data.sections.map((s) => ({
    ...s,
    boardId,
  }));
  sectionsMap.set(boardId, sections);

  // Set cards
  const cardMap = new Map<string, BoardCard>();
  for (const card of data.cards) {
    const c = { ...card, boardId };
    cardMap.set(c.id, c);
  }
  cardsMap.set(boardId, cardMap);

  // Persist
  persistBoards();
  persistBoardCards(boardId);
  persistBoardSections(boardId);
}

function serverUpsertCard(boardId: string, card: BoardCard, immediate = false) {
  const key = `board-${boardId}-card-${card.id}`;
  if (serverDebounceTimers[key]) { clearTimeout(serverDebounceTimers[key]); delete serverDebounceTimers[key]; }

  const doWrite = () => {
    delete serverDebounceTimers[key];
    apiFetch(`/api/boards/${boardId}/cards/${card.id}`, {
      method: "PUT",
      body: card,
      skipModel: true,
    }).catch(err => console.warn("[board-store] server upsert card failed:", err));
  };

  if (immediate) { doWrite(); } else { serverDebounceTimers[key] = setTimeout(doWrite, SERVER_DEBOUNCE_MS); }
}

function serverDeleteCard(boardId: string, cardId: string) {
  const key = `board-${boardId}-card-${cardId}`;
  if (serverDebounceTimers[key]) { clearTimeout(serverDebounceTimers[key]); delete serverDebounceTimers[key]; }
  apiFetch(`/api/boards/${boardId}/cards/${cardId}`, { method: "DELETE", skipModel: true })
    .catch(err => console.warn("[board-store] server delete card failed:", err));
}

function serverUpsertSection(boardId: string, section: BoardSection) {
  apiFetch(`/api/boards/${boardId}/sections/${section.id}`, {
    method: "PUT", body: section, skipModel: true,
  }).catch(err => console.warn("[board-store] server upsert section failed:", err));
}

function serverDeleteSection(boardId: string, sectionId: string) {
  apiFetch(`/api/boards/${boardId}/sections/${sectionId}`, {
    method: "DELETE", skipModel: true,
  }).catch(err => console.warn("[board-store] server delete section failed:", err));
}

function serverUpsertConnection(boardId: string, conn: CardConnection) {
  apiFetch(`/api/boards/${boardId}/connections/${conn.id}`, {
    method: "PUT", body: conn, skipModel: true,
  }).catch(err => console.warn("[board-store] server upsert connection failed:", err));
}

function serverDeleteConnection(boardId: string, connId: string) {
  apiFetch(`/api/boards/${boardId}/connections/${connId}`, {
    method: "DELETE", skipModel: true,
  }).catch(err => console.warn("[board-store] server delete connection failed:", err));
}

function serverUpsertFrame(boardId: string, frame: BoardFrame) {
  apiFetch(`/api/boards/${boardId}/frames/${frame.id}`, {
    method: "PUT", body: frame, skipModel: true,
  }).catch(err => console.warn("[board-store] server upsert frame failed:", err));
}

function serverDeleteFrame(boardId: string, frameId: string) {
  apiFetch(`/api/boards/${boardId}/frames/${frameId}`, {
    method: "DELETE", skipModel: true,
  }).catch(err => console.warn("[board-store] server delete frame failed:", err));
}


/* ── Board CRUD ── */

export function getAllBoards(datasetId: string): Board[] {
  ensureInitialized();
  return Array.from(boardsMap.values()).filter(
    (b) => b.datasetId === datasetId
  );
}

/** Returns all boards regardless of dataset — used by entity-registry for @ picker. */
export function getAllBoardsAll(): Board[] {
  ensureInitialized();
  return Array.from(boardsMap.values());
}

export function getBoard(id: string): Board | undefined {
  ensureInitialized();
  return boardsMap.get(id);
}

export function saveBoard(board: Board): boolean {
  try {
    ensureInitialized();
    boardsMap.set(board.id, board);
    persistBoards();
    serverWriteBoard(board);
    return true;
  } catch {
    return false;
  }
}

export function removeBoard(id: string): boolean {
  try {
    ensureInitialized();
    boardsMap.delete(id);
    cardsMap.delete(id);
    connectionsMap.delete(id);
    framesMap.delete(id);
    sectionsMap.delete(id);
    removeBoardStorage(id);
    persistBoards();
    serverDeleteBoard(id);
    return true;
  } catch {
    return false;
  }
}

export function getBoardSummaries(datasetId: string): BoardSummary[] {
  ensureInitialized(datasetId);
  return Array.from(boardsMap.values())
    .filter((b) => b.datasetId === datasetId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((board) => ({
      id: board.id,
      name: board.name,
      cardCount: cardsMap.get(board.id)?.size ?? 0,
      updatedAt: board.updatedAt,
    }));
}

/* ── Card CRUD (scoped to board) ── */

export function getBoardCards(boardId: string): BoardCard[] {
  ensureInitialized();
  const cardMap = cardsMap.get(boardId);
  return cardMap ? Array.from(cardMap.values()) : [];
}

export function getBoardCard(
  boardId: string,
  cardId: string
): BoardCard | undefined {
  ensureInitialized();
  return cardsMap.get(boardId)?.get(cardId);
}

export function getCardsByQueryGroup(
  boardId: string,
  queryGroupId: string
): BoardCard[] {
  ensureInitialized();
  const cardMap = cardsMap.get(boardId);
  if (!cardMap) return [];
  return Array.from(cardMap.values()).filter(
    (c) => c.queryGroupId === queryGroupId
  );
}

export function saveBoardCard(card: BoardCard, options?: { sync?: boolean }): boolean {
  try {
    ensureInitialized();
    let cardMap = cardsMap.get(card.boardId);
    if (!cardMap) {
      cardMap = new Map<string, BoardCard>();
      cardsMap.set(card.boardId, cardMap);
    }
    cardMap.set(card.id, card);

    // Sync mode: write to localStorage immediately (no debounce).
    // Used for content updates from SSE stream where data loss is critical.
    if (options?.sync) {
      persistBoardCardsSync(card.boardId);
    } else {
      persistBoardCards(card.boardId);
    }

    serverUpsertCard(card.boardId, card, !!options?.sync);

    // Touch board updatedAt
    const board = boardsMap.get(card.boardId);
    if (board) {
      board.updatedAt = new Date().toISOString();
      if (options?.sync) {
        persistBoardsSync();
      } else {
        persistBoards();
      }
    }

    return true;
  } catch (err) {
    console.warn("[board-store] saveBoardCard failed:", err);
    return false;
  }
}

export function clearBoardCards(boardId: string): void {
  ensureInitialized();
  cardsMap.set(boardId, new Map<string, BoardCard>());
  persistBoardCards(boardId);
  // TODO: server bulk delete cards
}

export function removeBoardCard(boardId: string, cardId: string): boolean {
  try {
    ensureInitialized();
    const cardMap = cardsMap.get(boardId);
    if (cardMap) {
      cardMap.delete(cardId);
      persistBoardCards(boardId);
    }

    serverDeleteCard(boardId, cardId);

    // Also remove any connections involving this card
    const conns = connectionsMap.get(boardId);
    if (conns) {
      const filtered = conns.filter(
        (c) => c.fromCardId !== cardId && c.toCardId !== cardId
      );
      connectionsMap.set(boardId, filtered);
      persistBoardConnections(boardId);
    }

    // Touch board updatedAt
    const board = boardsMap.get(boardId);
    if (board) {
      board.updatedAt = new Date().toISOString();
      persistBoards();
    }

    return true;
  } catch {
    return false;
  }
}

/* ── Comments (stored on card) ── */

export function addCardComment(
  boardId: string,
  cardId: string,
  comment: CardComment
): boolean {
  try {
    ensureInitialized();
    const card = cardsMap.get(boardId)?.get(cardId);
    if (!card) return false;
    card.comments.push(comment);
    persistBoardCards(boardId);
    serverUpsertCard(boardId, card, false);
    return true;
  } catch {
    return false;
  }
}

export function getCardComments(
  boardId: string,
  cardId: string
): CardComment[] {
  ensureInitialized();
  const card = cardsMap.get(boardId)?.get(cardId);
  return card?.comments ?? [];
}

/* ── Connections ── */

export function getBoardConnections(boardId: string): CardConnection[] {
  ensureInitialized();
  return connectionsMap.get(boardId) ?? [];
}

export function addConnection(conn: CardConnection): boolean {
  try {
    ensureInitialized();
    const conns = connectionsMap.get(conn.boardId) ?? [];
    conns.push(conn);
    connectionsMap.set(conn.boardId, conns);
    persistBoardConnections(conn.boardId);
    serverUpsertConnection(conn.boardId, conn);
    return true;
  } catch {
    return false;
  }
}

export function removeConnection(
  boardId: string,
  connectionId: string
): boolean {
  try {
    ensureInitialized();
    const conns = connectionsMap.get(boardId) ?? [];
    const filtered = conns.filter((c) => c.id !== connectionId);
    connectionsMap.set(boardId, filtered);
    persistBoardConnections(boardId);
    serverDeleteConnection(boardId, connectionId);
    return true;
  } catch {
    return false;
  }
}

/* ── Frames ── */

export function getBoardFrames(boardId: string): BoardFrame[] {
  ensureInitialized();
  return framesMap.get(boardId) ?? [];
}

export function saveFrame(frame: BoardFrame): boolean {
  try {
    ensureInitialized();
    const frames = framesMap.get(frame.boardId) ?? [];
    const idx = frames.findIndex((f) => f.id === frame.id);
    if (idx >= 0) {
      frames[idx] = frame;
    } else {
      frames.push(frame);
    }
    framesMap.set(frame.boardId, frames);
    persistBoardFrames(frame.boardId);
    serverUpsertFrame(frame.boardId, frame);
    return true;
  } catch {
    return false;
  }
}

/* ── Sections ── */

export function getBoardSections(boardId: string): BoardSection[] {
  ensureInitialized();
  return (sectionsMap.get(boardId) ?? []).sort((a, b) => a.order - b.order);
}

export function saveBoardSection(section: BoardSection): boolean {
  try {
    ensureInitialized();
    const sections = sectionsMap.get(section.boardId) ?? [];
    const idx = sections.findIndex((s) => s.id === section.id);
    if (idx >= 0) {
      sections[idx] = section;
    } else {
      sections.push(section);
    }
    sectionsMap.set(section.boardId, sections);
    persistBoardSections(section.boardId);
    serverUpsertSection(section.boardId, section);

    // Touch board updatedAt
    const board = boardsMap.get(section.boardId);
    if (board) {
      board.updatedAt = new Date().toISOString();
      persistBoards();
    }
    return true;
  } catch {
    return false;
  }
}

export function removeBoardSection(boardId: string, sectionId: string): boolean {
  try {
    ensureInitialized();

    // Cascade-delete all cards belonging to this section
    const cardMap = cardsMap.get(boardId);
    if (cardMap) {
      for (const [cardId, card] of cardMap) {
        if (card.sectionId === sectionId) {
          cardMap.delete(cardId);
        }
      }
      persistBoardCards(boardId);
    }

    const sections = sectionsMap.get(boardId) ?? [];
    const filtered = sections.filter((s) => s.id !== sectionId);
    sectionsMap.set(boardId, filtered);
    persistBoardSections(boardId);
    serverDeleteSection(boardId, sectionId);
    return true;
  } catch {
    return false;
  }
}

export function reorderCardsInSection(
  boardId: string,
  sectionId: string,
  cardIds: string[]
): void {
  ensureInitialized();
  const cardMap = cardsMap.get(boardId);
  if (!cardMap) return;
  cardIds.forEach((id, i) => {
    const card = cardMap.get(id);
    if (card) {
      const updatedCard = { ...card, sectionId, orderInSection: i };
      cardMap.set(id, updatedCard);
      serverUpsertCard(boardId, updatedCard, false);
    }
  });
  persistBoardCards(boardId);
}

export function moveCardToSection(
  boardId: string,
  cardId: string,
  targetSectionId: string,
  insertIndex: number
): void {
  ensureInitialized();
  const cardMap = cardsMap.get(boardId);
  if (!cardMap) return;

  const card = cardMap.get(cardId);
  if (!card) return;

  // Get current cards in target section, sorted
  const targetCards = Array.from(cardMap.values())
    .filter((c) => c.sectionId === targetSectionId && c.id !== cardId)
    .sort((a, b) => (a.orderInSection ?? 0) - (b.orderInSection ?? 0));

  // Insert at position
  targetCards.splice(insertIndex, 0, card);

  // Update all cards in target section
  targetCards.forEach((c, i) => {
    const updatedCard = { ...c, sectionId: targetSectionId, orderInSection: i };
    cardMap.set(c.id, updatedCard);
    serverUpsertCard(boardId, updatedCard, false);
  });

  // Re-index source section if card moved between sections
  if (card.sectionId !== targetSectionId) {
    const sourceCards = Array.from(cardMap.values())
      .filter((c) => c.sectionId === card.sectionId && c.id !== cardId)
      .sort((a, b) => (a.orderInSection ?? 0) - (b.orderInSection ?? 0));
    sourceCards.forEach((c, i) => {
      const updatedCard = { ...c, orderInSection: i };
      cardMap.set(c.id, updatedCard);
      serverUpsertCard(boardId, updatedCard, false);
    });
  }

  persistBoardCards(boardId);
}

export function reorderSections(boardId: string, sectionIds: string[]): void {
  ensureInitialized();
  const sections = sectionsMap.get(boardId) ?? [];
  const byId = new Map(sections.map((s) => [s.id, s]));
  const reordered: BoardSection[] = [];
  sectionIds.forEach((id, i) => {
    const s = byId.get(id);
    if (s) {
      const reorderedSection = { ...s, order: i };
      reordered.push(reorderedSection);
      serverUpsertSection(boardId, reorderedSection);
    }
  });
  // Append any sections not in the provided list (safety net)
  sections.forEach((s) => {
    if (!sectionIds.includes(s.id)) {
      const reorderedSection = { ...s, order: reordered.length };
      reordered.push(reorderedSection);
      serverUpsertSection(boardId, reorderedSection);
    }
  });
  sectionsMap.set(boardId, reordered);
  persistBoardSections(boardId);
}

/* ── Debug: expose on window for console inspection ── */
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__boardStoreDebug = () => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("baby-sentinel-board") || k.startsWith("baby-sentinel-boards"))) {
        const raw = localStorage.getItem(k);
        keys.push(`  ${k}: ${raw ? `${raw.length} chars` : "null"}`);
      }
    }
    console.log(`[board-store debug] localStorage keys:\n${keys.join("\n") || "  (none)"}`);
    console.log(`[board-store debug] in-memory: ${boardsMap.size} boards, ${Array.from(cardsMap.values()).reduce((a, m) => a + m.size, 0)} cards`);
    for (const [bid, cmap] of cardsMap) {
      console.log(`  board "${bid}": ${cmap.size} cards —`, Array.from(cmap.values()).map(c => ({
        id: c.id.slice(0, 8),
        type: c.type,
        hasChart: !!c.chartSpec,
        hasData: !!(c.data?.length),
        hasText: !!c.markdownContent,
        hasSql: !!c.sql,
      })));
    }
  };
}

/** Persist the set of dismissed chip indices for a follow-up card. */
export function saveDismissedChips(boardId: string, cardId: string, dismissedIndices: number[]): boolean {
  try {
    ensureInitialized();
    const card = cardsMap.get(boardId)?.get(cardId);
    if (!card) return false;
    const updated = { ...card, dismissedChips: dismissedIndices };
    cardsMap.get(boardId)!.set(cardId, updated);
    persistBoardCards(boardId);
    serverUpsertCard(boardId, updated, false);
    return true;
  } catch {
    return false;
  }
}

export function removeFrame(boardId: string, frameId: string): boolean {
  try {
    ensureInitialized();
    const frames = framesMap.get(boardId) ?? [];
    const filtered = frames.filter((f) => f.id !== frameId);
    framesMap.set(boardId, filtered);
    persistBoardFrames(boardId);
    serverDeleteFrame(boardId, frameId);
    return true;
  } catch {
    return false;
  }
}
