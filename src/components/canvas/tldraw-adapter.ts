/**
 * Adapter layer between board-store types and tldraw shapes/arrows.
 * Board-store is the source of truth — tldraw shapes are derived.
 */
import { createShapeId, type TLShapeId, type Editor } from "tldraw";
import type { BoardCard, CardConnection } from "@/lib/board-types";
import { saveBoardCard, getBoardCard, removeBoardCard, getBoardConnections, removeConnection } from "@/lib/board-store";

// ── Stable ID mapping: card UUID → tldraw ShapeId ──

const shapeIdCache = new Map<string, TLShapeId>();

export function cardIdToShapeId(cardId: string): TLShapeId {
  let id = shapeIdCache.get(cardId);
  if (!id) {
    id = createShapeId(cardId);
    shapeIdCache.set(cardId, id);
  }
  return id;
}

// ── BoardCard → tldraw shape partial ──

export function cardToShape(card: BoardCard) {
  return {
    id: cardIdToShapeId(card.id),
    type: "board-card" as const,
    x: card.position.x,
    y: card.position.y,
    props: {
      w: card.size.width,
      h: card.size.height,
      cardId: card.id,
      boardId: card.boardId,
    },
  };
}

// ── Arrow creation with bindings ──

export function createConnectionArrow(
  editor: Editor,
  conn: CardConnection
) {
  const arrowId = createShapeId(conn.id);
  const startId = cardIdToShapeId(conn.fromCardId);
  const endId = cardIdToShapeId(conn.toCardId);

  // Check both shapes exist before creating arrow
  if (!editor.getShape(startId) || !editor.getShape(endId)) return;

  editor.run(() => {
    editor.createShape({
      id: arrowId,
      type: "arrow",
      props: {
        color: "grey",
        start: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
      },
    });
    editor.createBindings([
      {
        fromId: arrowId,
        toId: startId,
        type: "arrow",
        props: {
          terminal: "start",
          normalizedAnchor: { x: 0.5, y: 1 },
          isExact: false,
          isPrecise: false,
        },
      },
      {
        fromId: arrowId,
        toId: endId,
        type: "arrow",
        props: {
          terminal: "end",
          normalizedAnchor: { x: 0.5, y: 0 },
          isExact: false,
          isPrecise: false,
        },
      },
    ]);
  });
}

// ── Sync tldraw geometry → board-store ──

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function syncTldrawToStore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry: any,
  boardId: string
) {
  // Handle deletions immediately (no debounce)
  for (const removed of Object.values(entry.changes.removed) as { typeName: string; type: string; props?: { cardId?: string } }[]) {
    if (removed.typeName !== "shape" || removed.type !== "board-card") continue;
    const cardId = removed.props?.cardId;
    if (!cardId) continue;
    // Remove connected edges from board-store
    const conns = getBoardConnections(boardId);
    for (const conn of conns) {
      if (conn.fromCardId === cardId || conn.toCardId === cardId) {
        removeConnection(boardId, conn.id);
      }
    }
    // Remove card from board-store (localStorage)
    removeBoardCard(boardId, cardId);
  }

  // Debounce position/size updates (drag, resize)
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    for (const [, to] of Object.values(entry.changes.updated) as [unknown, { typeName: string; type: string; id: string; x?: number; y?: number; props?: { w?: number; h?: number; cardId?: string; boardId?: string } }][]) {
      if (to.typeName !== "shape" || to.type !== "board-card") continue;
      const cardId = to.props?.cardId;
      if (!cardId) continue;
      const card = getBoardCard(boardId, cardId);
      if (!card) continue;
      const newPos = { x: to.x ?? card.position.x, y: to.y ?? card.position.y };
      const newSize = {
        width: to.props?.w ?? card.size.width,
        height: to.props?.h ?? card.size.height,
      };
      if (
        card.position.x !== newPos.x ||
        card.position.y !== newPos.y ||
        card.size.width !== newSize.width ||
        card.size.height !== newSize.height
      ) {
        saveBoardCard({ ...card, position: newPos, size: newSize });
      }
    }
  }, 300);
}

// ── Camera persistence ──

function getCameraKey(boardId: string) {
  return `baby-sentinel-canvas-camera-${boardId}`;
}

export function loadCamera(boardId: string) {
  try {
    const raw = localStorage.getItem(getCameraKey(boardId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveCamera(boardId: string, camera: { x: number; y: number; z: number }) {
  try {
    localStorage.setItem(getCameraKey(boardId), JSON.stringify(camera));
  } catch {
    // localStorage full — ignore
  }
}
