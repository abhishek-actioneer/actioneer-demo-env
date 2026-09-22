/**
 * Hook for canvas card CRUD operations: add, remove, refresh, suggestions,
 * comment annotations, and chat-to-canvas bridge.
 */
import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "tldraw";
import type { BoardCard, CardConnection, CardType } from "@/lib/board-types";
import {
  getBoardCards,
  getBoardCard,
  saveBoardCard,
  removeBoardCard,
  getBoardConnections,
} from "@/lib/board-store";
import { useSidebarContext } from "@/components/sidebar-context";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";
import { getSuggestion } from "@/lib/canvas-suggestions";
import { executeCanvasDataflow } from "@/lib/canvas-executor";
import { onCanvasEvent } from "./canvas-events";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { cardToShape, cardIdToShapeId } from "./tldraw-adapter";
import { useCanvasStream } from "./use-canvas-stream";

export function useCanvasActions(
  resolvedBoardId: string | null,
  editorRef: React.RefObject<Editor | null>
) {
  const { datasetId } = useDataset();
  const { injectText, injectQuotedContext } = useChatPanel();
  const {
    notifyCanvasChanged,
    segments,
  } = useSidebarContext();

  const datasetIdRef = useRef(datasetId);
  const notifyCanvasChangedRef = useRef(notifyCanvasChanged);
  useEffect(() => { datasetIdRef.current = datasetId; }, [datasetId]);
  useEffect(() => { notifyCanvasChangedRef.current = notifyCanvasChanged; }, [notifyCanvasChanged]);

  // ── Suggestion toast ──
  const showSuggestion = useCallback(
    (sourceCard: BoardCard) => {
      const suggestion = getSuggestion(sourceCard, segments, datasetId);
      if (!suggestion) return;

      const toastId = toast(`Add "${suggestion.label}" too?`, {
        duration: 5000,
        action: {
          label: "Add",
          onClick: () => {
            toast.dismiss(toastId);
            if (!resolvedBoardId) return;

            const partial = suggestion.cardPayload;
            const size = partial.size ?? { width: 420, height: 280 };
            const GAP = 24;
            const position = {
              x: sourceCard.position.x + sourceCard.size.width + GAP,
              y: sourceCard.position.y,
            };
            const id = crypto.randomUUID();
            const now = new Date().toISOString();

            const newCard: BoardCard = {
              id,
              boardId: resolvedBoardId,
              type: partial.type ?? "metric",
              title: partial.title ?? "Card",
              position,
              size,
              author: "user",
              refreshCadence: "manual",
              pinnedAt: now,
              comments: [],
              ...(partial.metricId ? { metricId: partial.metricId } : {}),
              ...(partial.segmentId ? { segmentId: partial.segmentId } : {}),
            };

            saveBoardCard(newCard);
            editorRef.current?.createShapes([cardToShape(newCard)]);
            notifyCanvasChanged();
          },
        },
      });
    },
    [segments, resolvedBoardId, notifyCanvasChanged, editorRef, datasetId]
  );

  // ── Unified canvas stream processor ──
  const { processStream, isStreaming: streamActive } = useCanvasStream(
    resolvedBoardId ?? "",
    editorRef
  );

  // ── Add card ──
  const handleAddCard = useCallback(
    (type: CardType, position: { x: number; y: number }) => {
      if (!resolvedBoardId) return;

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      let size: { width: number; height: number };
      let cardPartial: Partial<BoardCard>;

      switch (type) {
        case "sticky":
          size = { width: 200, height: 150 };
          cardPartial = { markdownContent: "" };
          break;
        case "sql":
          size = { width: 420, height: 240 };
          cardPartial = { sql: "" };
          break;
        case "text":
          size = { width: 420, height: 260 };
          cardPartial = { markdownContent: "" };
          break;
        case "parameter":
          size = { width: 320, height: 200 };
          cardPartial = {
            parameterConfig: {
              inputType: "date-range",
              label: "Date Range",
            },
          };
          break;
        case "chart":
        default:
          size = { width: 480, height: 360 };
          cardPartial = { chartSpec: { type: "line", title: "Chart", data: [] } };
          break;
      }

      const centeredPosition = {
        x: position.x - size.width / 2,
        y: position.y - size.height / 2,
      };

      const card: BoardCard = {
        id,
        boardId: resolvedBoardId,
        type,
        title:
          type === "sticky"
            ? "Note"
            : type === "sql"
            ? "SQL Block"
            : type === "text"
            ? "Text"
            : type === "parameter"
            ? "Parameter"
            : "Chart",
        position: centeredPosition,
        size,
        author: "user",
        refreshCadence: "manual",
        pinnedAt: now,
        comments: [],
        ...cardPartial,
      };

      saveBoardCard(card);
      editorRef.current?.createShapes([cardToShape(card)]);
      notifyCanvasChanged();
      showSuggestion(card);

      return id;
    },
    [resolvedBoardId, editorRef, notifyCanvasChanged, showSuggestion]
  );

  // ── Config panel: update card size in tldraw after config changes ──
  const handleItemUpdated = useCallback(
    (configItemId: string) => {
      if (!resolvedBoardId) return;
      const card = getBoardCard(resolvedBoardId, configItemId);
      if (!card) return;

      const editor = editorRef.current;
      if (!editor) return;

      const shapeId = cardIdToShapeId(configItemId);
      const shape = editor.getShape(shapeId);
      if (shape) {
        editor.updateShape({
          id: shapeId,
          type: "board-card",
          props: {
            w: card.size.width,
            h: card.size.height,
            version: ((shape.props as { version?: number }).version ?? 0) + 1,
          },
        });
      }
      notifyCanvasChanged();
    },
    [resolvedBoardId, editorRef, notifyCanvasChanged]
  );

  // ── Remove card ──
  const handleRemove = useCallback(
    (itemId: string) => {
      const editor = editorRef.current;
      if (editor) {
        const shapeId = cardIdToShapeId(itemId);
        if (editor.getShape(shapeId)) {
          editor.deleteShapes([shapeId]);
        }
      }
      if (resolvedBoardId) {
        removeBoardCard(resolvedBoardId, itemId);
      }
      notifyCanvasChanged();
    },
    [resolvedBoardId, editorRef, notifyCanvasChanged]
  );

  // ── Comment annotations → sticky cards ──
  const handleCommentAnnotations = useCallback(
    (annotations: Array<{ text: string; relatedCardId: string; severity?: string }>, sourceCard: BoardCard) => {
      if (!resolvedBoardId) return;

      const newShapes: ReturnType<typeof cardToShape>[] = [];
      annotations.forEach((ann) => {
        const stickySize = { width: 200, height: 120 };
        const pos = {
          x: sourceCard.position.x + sourceCard.size.width + 20,
          y: sourceCard.position.y + 20,
        };

        const id = crypto.randomUUID();
        const stickyCard: BoardCard = {
          id,
          boardId: resolvedBoardId,
          type: "sticky",
          title: "Note",
          markdownContent: ann.text,
          position: pos,
          size: stickySize,
          author: "system",
          refreshCadence: "manual",
          pinnedAt: new Date().toISOString(),
          comments: [],
        };

        saveBoardCard(stickyCard);
        newShapes.push(cardToShape(stickyCard));
      });

      if (newShapes.length > 0) {
        editorRef.current?.createShapes(newShapes);
        notifyCanvasChanged();
      }
    },
    [resolvedBoardId, editorRef, notifyCanvasChanged]
  );

  // ── Ask about this — inject card context into sidebar chat ──
  const handleAskAboutThis = useCallback(
    (itemId: string) => {
      if (!resolvedBoardId) return;
      const card = getBoardCard(resolvedBoardId, itemId);
      if (!card) return;

      const body = card.markdownContent?.trim();
      if (body) {
        injectQuotedContext(body);
      } else {
        injectText(card.title);
      }
    },
    [resolvedBoardId, injectText, injectQuotedContext]
  );

  // ── Single-card refresh ──
  const handleRefreshCard = useCallback(
    async (itemId: string) => {
      if (!resolvedBoardId) return;
      const card = getBoardCard(resolvedBoardId, itemId);
      if (!card?.sql) return;

      try {
        const res = await apiFetch<{
          results: Array<{
            cardId: string;
            data: Record<string, unknown>[];
            executionTimeMs: number;
            error?: string;
          }>;
        }>("/api/canvas-refresh", {
          method: "POST",
          body: { cards: [{ id: card.id, sql: card.sql }], datasetId },
        });

        const result = res.results[0];
        if (!result) return;

        const updatedCard = {
          ...card,
          lastData: card.data,
          data: result.error ? card.data : result.data,
          lastRefreshed: new Date().toISOString(),
        };

        saveBoardCard(updatedCard);

        if (result.error) {
          toast.error(`Refresh failed: ${result.error}`);
        } else {
          // Bump version to force tldraw re-render
          const editor = editorRef.current;
          if (editor) {
            const shapeId = cardIdToShapeId(itemId);
            const shape = editor.getShape(shapeId);
            if (shape) {
              editor.updateShape({
                id: shapeId,
                type: "board-card",
                props: {
                  version: ((shape.props as { version?: number }).version ?? 0) + 1,
                },
              });
            }
          }
          notifyCanvasChanged();

          const allCards = getBoardCards(resolvedBoardId).map((c) =>
            c.id === updatedCard.id ? updatedCard : c
          );
          const conns = getBoardConnections(resolvedBoardId);
          executeCanvasDataflow(allCards, conns, card.id, datasetId)
            .then((updated) => {
              if (updated.size > 0) notifyCanvasChanged();
            })
            .catch((err) => {
              console.error("[canvas-executor] post-refresh dataflow error:", err);
            });
        }
      } catch (err) {
        console.error("[canvas-refresh] error:", err);
        toast.error("Failed to refresh card");
      }
    },
    [resolvedBoardId, datasetId, editorRef, notifyCanvasChanged]
  );

  // ── Batch refresh ──
  const handleRefreshAll = useCallback(
    async (cards: Array<{ id: string; sql: string }>) => {
      if (!resolvedBoardId || cards.length === 0) return;

      try {
        const res = await apiFetch<{
          results: Array<{
            cardId: string;
            data: Record<string, unknown>[];
            executionTimeMs: number;
            error?: string;
          }>;
        }>("/api/canvas-refresh", {
          method: "POST",
          body: { cards, datasetId },
        });

        let successCount = 0;
        let errorCount = 0;

        for (const result of res.results) {
          const card = getBoardCard(resolvedBoardId, result.cardId);
          if (!card) continue;

          if (result.error) {
            errorCount++;
          } else {
            successCount++;
            saveBoardCard({
              ...card,
              lastData: card.data,
              data: result.data,
              lastRefreshed: new Date().toISOString(),
            });
          }
        }

        if (successCount > 0) {
          notifyCanvasChanged();
          toast.success(
            `Refreshed ${successCount} card${successCount !== 1 ? "s" : ""}${errorCount > 0 ? ` (${errorCount} failed)` : ""}`
          );
        } else if (errorCount > 0) {
          toast.error(
            `All ${errorCount} card refresh${errorCount !== 1 ? "es" : ""} failed`
          );
        }
      } catch (err) {
        console.error("[canvas-refresh-all] error:", err);
        toast.error("Failed to refresh cards");
      }
    },
    [resolvedBoardId, datasetId, notifyCanvasChanged]
  );

  // ── Canvas event listeners ──
  useEffect(() => {
    const offConfig = onCanvasEvent("open-config", () => {}); // handled by parent via setter
    const offAsk = onCanvasEvent("ask-about", (id) => handleAskAboutThis(id));
    const offRefresh = onCanvasEvent("refresh-card", (id) => handleRefreshCard(id));
    const offComments = onCanvasEvent("open-comments", () => {}); // handled by parent
    const offRunSql = onCanvasEvent("run-sql", (id) => handleRefreshCard(id));
    return () => {
      offConfig();
      offAsk();
      offRefresh();
      offComments();
      offRunSql();
    };
  }, [handleAskAboutThis, handleRefreshCard]);

  // ── Connection creation → dataflow execution ──
  const handleConnect = useCallback(
    (conn: CardConnection) => {
      if (!resolvedBoardId) return;
      const allCards = getBoardCards(resolvedBoardId);
      const updatedConns = getBoardConnections(resolvedBoardId);
      executeCanvasDataflow(
        allCards,
        updatedConns,
        conn.toCardId,
        datasetIdRef.current
      )
        .then((updated) => {
          if (updated.size > 0) notifyCanvasChangedRef.current();
        })
        .catch((err) => {
          console.error("[canvas-executor] connect dataflow error:", err);
        });
    },
    [resolvedBoardId]
  );

  // ── Drag-from-sidebar drop handler ──
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!resolvedBoardId) return;

      const raw = e.dataTransfer.getData("application/x-actioneer-entity");
      if (!raw) return;

      let payload: { type: string; id: string; title: string; sql?: string; userCount?: number };
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }

      const editor = editorRef.current;
      if (!editor) return;

      const pagePos = editor.screenToPage({ x: e.clientX, y: e.clientY });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      let card: BoardCard;

      if (payload.type === "metric") {
        const size = { width: 280, height: 160 };
        card = {
          id,
          boardId: resolvedBoardId,
          type: "metric",
          title: payload.title,
          metricId: payload.id,
          position: {
            x: pagePos.x - size.width / 2,
            y: pagePos.y - size.height / 2,
          },
          size,
          author: "user",
          refreshCadence: "manual",
          pinnedAt: now,
          comments: [],
        };
      } else if (payload.type === "segment") {
        const size = { width: 400, height: 400 };
        card = {
          id,
          boardId: resolvedBoardId,
          type: "segment",
          title: payload.title,
          segmentId: payload.id,
          sql: payload.sql,
          data: payload.userCount != null ? [{ user_count: payload.userCount }] : undefined,
          position: {
            x: pagePos.x - size.width / 2,
            y: pagePos.y - size.height / 2,
          },
          size,
          author: "user",
          refreshCadence: "manual",
          pinnedAt: now,
          comments: [],
        };
      } else {
        return;
      }

      saveBoardCard(card);
      editor.createShapes([cardToShape(card)]);
      notifyCanvasChanged();
      showSuggestion(card);
    },
    [resolvedBoardId, editorRef, notifyCanvasChanged, showSuggestion]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes("application/x-actioneer-entity")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  return {
    handleAddCard,
    handleItemUpdated,
    handleRemove,
    handleCommentAnnotations,
    handleRefreshAll,
    handleConnect,
    handleDrop,
    handleDragOver,
    processStream,
    streamActive,
    showSuggestion,
  };
}
