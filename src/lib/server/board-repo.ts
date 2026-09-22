import { getDb, stmts } from "@/lib/meta-db";
import type { Board, BoardCard, BoardSection, CardConnection, BoardFrame, BoardSummary } from "@/lib/board-types";

// userId is now passed as a parameter from API routes via Clerk auth().

/** Max rows per card's data field to persist */
const MAX_PERSISTED_ROWS = 30;

/** Coerce BigInt to Number for JSON serialization */
function safeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  return value;
}

/** Trim card data before serialization */
function trimCardForStorage(card: BoardCard): BoardCard {
  let trimmed = card;
  if (trimmed.data && Array.isArray(trimmed.data) && trimmed.data.length > MAX_PERSISTED_ROWS) {
    trimmed = { ...trimmed, data: trimmed.data.slice(0, MAX_PERSISTED_ROWS) };
  }
  if (trimmed.chartSpec) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec = trimmed.chartSpec as any;
    if (Array.isArray(spec.data) && spec.data.length > MAX_PERSISTED_ROWS) {
      trimmed = { ...trimmed, chartSpec: { ...spec, data: spec.data.slice(0, MAX_PERSISTED_ROWS) } };
    }
  }
  return trimmed;
}

function cardToJson(card: BoardCard): string {
  return JSON.stringify(trimCardForStorage(card), safeReplacer);
}

// ── Board CRUD ──

export function listBoardSummaries(userId: string, datasetId: string): BoardSummary[] {
  const s = stmts();
  const rows = s.boardListByUserDataset.all(userId, datasetId) as Array<{
    id: string; name: string; dataset_id: string; updated_at: string; card_count: number;
  }>;
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    cardCount: r.card_count,
    updatedAt: r.updated_at,
  }));
}

export function getFullBoard(userId: string, boardId: string): {
  board: Board;
  cards: BoardCard[];
  sections: BoardSection[];
  connections: CardConnection[];
  frames: BoardFrame[];
} | null {
  const s = stmts();
  const row = s.boardGetById.get(boardId, userId) as Record<string, unknown> | undefined;
  if (!row) return null;

  const board: Board = {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    datasetId: row.dataset_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    viewMode: (row.view_mode as Board["viewMode"]) || "document",
    globalTimeRange: row.global_time_range ? JSON.parse(row.global_time_range as string) : undefined,
    deckId: row.deck_id as string | undefined,
  };

  const cardRows = s.cardGetByBoard.all(boardId) as Array<{ id: string; data: string }>;
  const cards = cardRows.map(r => JSON.parse(r.data) as BoardCard);

  const sectionRows = s.sectionGetByBoard.all(boardId) as Array<{ id: string; data: string }>;
  const sections = sectionRows.map(r => JSON.parse(r.data) as BoardSection);

  const connRows = s.connGetByBoard.all(boardId) as Array<{ id: string; data: string }>;
  const connections = connRows.map(r => JSON.parse(r.data) as CardConnection);

  const frameRows = s.frameGetByBoard.all(boardId) as Array<{ id: string; data: string }>;
  const frames = frameRows.map(r => JSON.parse(r.data) as BoardFrame);

  return { board, cards, sections, connections, frames };
}

export function upsertBoard(userId: string, board: Board): void {
  const s = stmts();
  s.boardUpsert.run({
    id: board.id,
    user_id: userId,
    dataset_id: board.datasetId,
    name: board.name,
    description: board.description || null,
    view_mode: board.viewMode || "document",
    global_time_range: board.globalTimeRange ? JSON.stringify(board.globalTimeRange) : null,
    deck_id: board.deckId || null,
    created_at: board.createdAt,
    updated_at: board.updatedAt,
  });
}

export function deleteBoard(userId: string, boardId: string): boolean {
  const s = stmts();
  const result = s.boardDelete.run(boardId, userId);
  return result.changes > 0;
}

// ── Card CRUD ──

export function upsertCard(boardId: string, card: BoardCard): void {
  const s = stmts();
  s.cardUpsert.run({ board_id: boardId, id: card.id, data: cardToJson(card) });
}

export function deleteCard(boardId: string, cardId: string): boolean {
  const s = stmts();
  return s.cardDeleteOne.run(boardId, cardId).changes > 0;
}

export function bulkUpsertCards(boardId: string, cards: BoardCard[]): void {
  const db = getDb();
  const s = stmts();
  const tx = db.transaction((items: BoardCard[]) => {
    for (const card of items) {
      s.cardUpsert.run({ board_id: boardId, id: card.id, data: cardToJson(card) });
    }
  });
  tx(cards);
}

// ── Section CRUD ──

export function upsertSection(boardId: string, section: BoardSection): void {
  const s = stmts();
  s.sectionUpsert.run({ board_id: boardId, id: section.id, data: JSON.stringify(section, safeReplacer) });
}

export function deleteSection(boardId: string, sectionId: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    db.prepare(
      `DELETE FROM board_cards WHERE board_id = ? AND json_extract(data, '$.sectionId') = ?`
    ).run(boardId, sectionId);
    const result = db.prepare(
      `DELETE FROM board_sections WHERE board_id = ? AND id = ?`
    ).run(boardId, sectionId);
    return result.changes > 0;
  })();
}

// ── Connection CRUD ──

export function upsertConnection(boardId: string, conn: CardConnection): void {
  const s = stmts();
  s.connUpsert.run({ board_id: boardId, id: conn.id, data: JSON.stringify(conn, safeReplacer) });
}

export function deleteConnection(boardId: string, connId: string): boolean {
  const s = stmts();
  return s.connDeleteOne.run(boardId, connId).changes > 0;
}

// ── Frame CRUD ──

export function upsertFrame(boardId: string, frame: BoardFrame): void {
  const s = stmts();
  s.frameUpsert.run({ board_id: boardId, id: frame.id, data: JSON.stringify(frame, safeReplacer) });
}

export function deleteFrame(boardId: string, frameId: string): boolean {
  const s = stmts();
  return s.frameDeleteOne.run(boardId, frameId).changes > 0;
}

// ── Migration ──

export function migrateBoardsFromLocalStorage(userId: string, boards: Array<{
  board: Board;
  cards: BoardCard[];
  sections: BoardSection[];
  connections: CardConnection[];
  frames: BoardFrame[];
}>): { imported: number; skipped: number } {
  const db = getDb();
  const s = stmts();
  let imported = 0;
  let skipped = 0;

  const BATCH = 10;
  for (let i = 0; i < boards.length; i += BATCH) {
    const batch = boards.slice(i, i + BATCH);
    const tx = db.transaction((items: typeof batch) => {
      for (const { board, cards, sections, connections, frames } of items) {
        const result = s.boardInsertIgnore.run({
          id: board.id,
          user_id: userId,
          dataset_id: board.datasetId,
          name: board.name,
          description: board.description || null,
          view_mode: board.viewMode || "document",
          global_time_range: board.globalTimeRange ? JSON.stringify(board.globalTimeRange) : null,
          deck_id: board.deckId || null,
          created_at: board.createdAt,
          updated_at: board.updatedAt,
        });
        if (result.changes === 0) { skipped++; continue; }
        imported++;
        for (const card of cards) s.cardUpsert.run({ board_id: board.id, id: card.id, data: cardToJson(card) });
        for (const sec of sections) s.sectionUpsert.run({ board_id: board.id, id: sec.id, data: JSON.stringify(sec, safeReplacer) });
        for (const conn of connections) s.connUpsert.run({ board_id: board.id, id: conn.id, data: JSON.stringify(conn, safeReplacer) });
        for (const frame of frames) s.frameUpsert.run({ board_id: board.id, id: frame.id, data: JSON.stringify(frame, safeReplacer) });
      }
    });
    tx(batch);
  }

  return { imported, skipped };
}

/** Get a single card by board + card ID (used by decks API) */
export function getCard(boardId: string, cardId: string): BoardCard | null {
  const s = stmts();
  const row = s.cardGetOne.get(boardId, cardId) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as BoardCard;
}
