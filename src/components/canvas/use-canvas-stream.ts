/**
 * Unified stream processor for canvas queries.
 *
 * Handles NDJSON parsing, graph plan processing, DAG layout computation,
 * placeholder shape creation, data filling, and arrow wiring.
 *
 * Uses tldraw Editor directly instead of React Flow.
 */

import { useCallback, useRef, useState } from "react";
import type { Editor } from "tldraw";
import type { BoardCard, CardConnection } from "@/lib/board-types";
import type { CanvasCardPlan } from "@/lib/canvas-sse-types";
import { parseCanvasEvent } from "@/lib/canvas-sse-types";
import { computeDAGLayout } from "@/lib/canvas-layout";
import { cardToShape, createConnectionArrow, cardIdToShapeId } from "./tldraw-adapter";
import {
  saveBoardCard,
  getBoardCard,
  addConnection,
  flushPendingPersists,
} from "@/lib/board-store";
import { apiFetch } from "@/lib/api-client";

// ── Edge label inference ──

function inferEdgeLabel(
  sourceType: string,
  targetType: string
): string | undefined {
  if (sourceType === "sql" && (targetType === "table" || targetType === "metric")) return "data";
  if (sourceType === "sql" && targetType === "chart") return "data";
  if (sourceType === "table" && targetType === "chart") return "visualization";
  if (targetType === "text") return "analysis";
  if (targetType === "sticky") return undefined; // no label for annotation edges
  return undefined;
}

// ── Hook ──

/** Optional context from a parent card (for drill-down flows) */
export interface ParentCardContext {
  /** ID of the parent card to connect FROM */
  parentCardId: string;
  /** Edge label (e.g., the clicked value like "Koramangala Hub") */
  edgeLabel?: string;
  /** Parent card's SQL for LLM context */
  parentSql?: string;
  /** Filter condition to inject (e.g., "hub_name = 'Koramangala Hub'") */
  filterHint?: string;
}

export interface CanvasStreamResult {
  processStream: (
    query: string,
    anchor: { x: number; y: number },
    datasetId: string,
    onStatus?: (status: CanvasStreamStatus) => void,
    parentContext?: ParentCardContext
  ) => Promise<void>;
  isStreaming: boolean;
  cancel: () => void;
  currentQueryGroupId: string | null;
}

export interface CanvasStreamStatus {
  phase: "planning" | "executing" | "done" | "error";
  message?: string;
  cardTitles?: string[];
}

export function useCanvasStream(
  boardId: string,
  editorRef: React.RefObject<Editor | null>
): CanvasStreamResult {
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentQueryGroupId, setCurrentQueryGroupId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const processStream = useCallback(
    async (
      query: string,
      anchor: { x: number; y: number },
      datasetId: string,
      onStatus?: (status: CanvasStreamStatus) => void,
      parentContext?: ParentCardContext
    ) => {
      if (isStreaming) return; // Queue protection

      const editor = editorRef.current;
      if (!editor) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      onStatus?.({ phase: "planning" });

      // Maps server cardId → actual card UUID (used in board-store + tldraw)
      const serverToNodeId = new Map<string, string>();
      // Map server cardId → plan entry for type lookup
      const planMap = new Map<string, CanvasCardPlan>();
      // Suppressed sql/table server cardIds → their chart sibling's server cardId
      const suppressedToChart = new Map<string, string>();
      // Accumulated text deltas per card
      const textAccum = new Map<string, string>();
      // Track created card titles for status
      const cardTitles: string[] = [];
      // Track whether parent edge has been created (for drill-down flows)
      let parentEdgeCreated = false;

      try {
        const apiBody: Record<string, unknown> = { query, datasetId };
        if (parentContext?.parentSql) {
          apiBody.parentSql = parentContext.parentSql;
          apiBody.filterHint = parentContext.filterHint;
        }

        const res = await apiFetch("/api/canvas-query", {
          method: "POST",
          body: apiBody,
          stream: true,
        });

        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          if (controller.signal.aborted) break;

          const { done, value } = await reader.read();
          if (!done) {
            buffer += decoder.decode(value, { stream: true });
          } else {
            // Flush decoder on stream end
            buffer += decoder.decode();
          }
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          if (done && buffer.trim()) {
            // Process any remaining unflushed line
            lines.push(buffer);
            buffer = "";
          }

          for (const line of lines) {
            const event = parseCanvasEvent(line);
            if (!event) {
              if (line.trim()) console.warn("[canvas-stream] unparseable line:", line.slice(0, 100));
              continue;
            }

            if (event.type === "plan") {
              // ── Graph plan received: compute layout, create placeholder shapes + arrows ──
              setCurrentQueryGroupId(event.queryGroupId);
              onStatus?.({ phase: "executing" });

              // Build reverse-adjacency map (childrenOf) to find chart descendants
              const childrenOf = new Map<string, string[]>();
              for (const card of event.cards) {
                planMap.set(card.cardId, card);
                for (const parentId of card.derivedFrom) {
                  if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
                  childrenOf.get(parentId)!.push(card.cardId);
                }
              }

              // DFS: find nearest chart descendant of a card
              function findChartDescendant(cardId: string): string | undefined {
                for (const childId of childrenOf.get(cardId) ?? []) {
                  if (planMap.get(childId)?.type === "chart") return childId;
                  const found = findChartDescendant(childId);
                  if (found) return found;
                }
                return undefined;
              }

              // Suppress sql + table cards that have a chart sibling downstream
              for (const card of event.cards) {
                if (card.type === "sql" || card.type === "table") {
                  const chartServerId = findChartDescendant(card.cardId);
                  if (chartServerId) {
                    suppressedToChart.set(card.cardId, chartServerId);
                  }
                }
              }

              const layout = computeDAGLayout(event.cards, anchor);

              // Create placeholder shapes
              const now = new Date().toISOString();
              const newShapes: ReturnType<typeof cardToShape>[] = [];

              for (const card of event.cards) {
                // Register all cards in planMap (already done above)
                const nodeId = crypto.randomUUID();
                serverToNodeId.set(card.cardId, nodeId);

                // Skip creating shapes for suppressed cards
                if (suppressedToChart.has(card.cardId)) continue;

                const rect = layout.get(card.cardId) ?? {
                  x: anchor.x,
                  y: anchor.y,
                  width: 400,
                  height: 260,
                };

                // Create a placeholder BoardCard
                const boardCard: BoardCard = {
                  id: nodeId,
                  boardId,
                  type: card.type,
                  title: card.title,
                  position: { x: rect.x, y: rect.y },
                  size: { width: rect.width, height: rect.height },
                  author: "system",
                  refreshCadence: "manual",
                  pinnedAt: now,
                  comments: [],
                  queryGroupId: event.queryGroupId,
                };

                saveBoardCard(boardCard, { sync: true });
                newShapes.push(cardToShape(boardCard));
                cardTitles.push(card.title);
              }

              editor.createShapes(newShapes);

              // Create all arrows from derivedFrom (skip suppressed endpoints)
              for (const card of event.cards) {
                if (suppressedToChart.has(card.cardId)) continue;
                for (const sourceServerId of card.derivedFrom) {
                  if (suppressedToChart.has(sourceServerId)) continue;
                  const fromNodeId = serverToNodeId.get(sourceServerId);
                  const toNodeId = serverToNodeId.get(card.cardId);
                  if (!fromNodeId || !toNodeId) continue;

                  const sourceCard = planMap.get(sourceServerId);
                  const label = sourceCard
                    ? inferEdgeLabel(sourceCard.type, card.type)
                    : undefined;

                  const conn: CardConnection = {
                    id: crypto.randomUUID(),
                    boardId,
                    fromCardId: fromNodeId,
                    toCardId: toNodeId,
                    label,
                  };
                  addConnection(conn);
                  createConnectionArrow(editor, conn);
                }
              }

              // Create parent-to-child arrow for drill-down flows
              if (parentContext?.parentCardId && !parentEdgeCreated) {
                // Use first non-suppressed card as the target
                const firstNonSuppressed = event.cards.find(
                  (c) => !suppressedToChart.has(c.cardId)
                );
                const firstServerCardId = firstNonSuppressed?.cardId;
                const firstNodeId = firstServerCardId
                  ? serverToNodeId.get(firstServerCardId)
                  : undefined;
                if (firstNodeId) {
                  const parentConn: CardConnection = {
                    id: crypto.randomUUID(),
                    boardId,
                    fromCardId: parentContext.parentCardId,
                    toCardId: firstNodeId,
                    label: parentContext.edgeLabel,
                  };
                  addConnection(parentConn);
                  createConnectionArrow(editor, parentConn);
                  parentEdgeCreated = true;
                }
              }
            }

            if (event.type === "card-data") {
              const nodeId = serverToNodeId.get(event.cardId);
              if (!nodeId) continue;

              if (event.cardType === "sql") {
                // If this sql card is suppressed, route its sql to the chart card instead
                const chartServerId = suppressedToChart.get(event.cardId);
                const targetNodeId = chartServerId
                  ? serverToNodeId.get(chartServerId)
                  : nodeId;
                if (!targetNodeId) continue;
                updateBoardCardTldraw(targetNodeId, boardId, editor, {
                  sql: event.sql,
                  // Only update title on non-suppressed cards (don't overwrite chart title)
                  ...(chartServerId ? {} : { title: event.description || undefined }),
                });
              }

              if (event.cardType === "query_result") {
                // Skip suppressed table cards — chart card already gets data from its chartSpec event
                if (suppressedToChart.has(event.cardId)) continue;
                updateBoardCardTldraw(nodeId, boardId, editor, {
                  data: event.rows,
                  sql: undefined,
                });
              }

              if (event.cardType === "chart") {
                updateBoardCardTldraw(nodeId, boardId, editor, {
                  chartSpec: event.chartSpec,
                  data: event.chartSpec.data as Record<string, unknown>[] | undefined,
                });
              }

              if (event.cardType === "metric") {
                updateBoardCardTldraw(nodeId, boardId, editor, {
                  markdownContent: `${event.value}`,
                  data: [{ label: event.label, value: event.value }],
                });
              }

              if (event.cardType === "text") {
                const prev = textAccum.get(event.cardId) ?? "";
                const newText = prev + event.delta;
                textAccum.set(event.cardId, newText);
                updateBoardCardTldraw(nodeId, boardId, editor, {
                  markdownContent: newText,
                });
              }

              if (event.cardType === "annotation") {
                updateBoardCardTldraw(nodeId, boardId, editor, {
                  markdownContent: event.text,
                  author: "system",
                });
              }
            }

            if (event.type === "card-complete") {
              // Card finished loading — could trigger UI updates if needed
            }

            if (event.type === "annotations") {
              // Create sticky notes positioned near their target cards
              const now = new Date().toISOString();
              const STICKY_W = 200;
              const STICKY_H = 130;

              const newStickyShapes: ReturnType<typeof cardToShape>[] = [];
              let stickyIndex = 0;
              for (const item of event.items) {
                const targetNodeId = serverToNodeId.get(item.targetCardId);
                if (!targetNodeId) continue;

                const targetCard = getBoardCard(boardId, targetNodeId);
                if (!targetCard) continue;

                // Place sticky to the right of the entire DAG cluster
                const allPositions = Array.from(serverToNodeId.values())
                  .map((nid) => getBoardCard(boardId, nid))
                  .filter(Boolean) as BoardCard[];
                const maxRight = Math.max(
                  ...allPositions.map((c) => c.position.x + c.size.width)
                );

                const stickyId = crypto.randomUUID();
                const stickyCard: BoardCard = {
                  id: stickyId,
                  boardId,
                  type: "sticky",
                  title: "",
                  markdownContent: item.text,
                  position: {
                    x: maxRight + 60,
                    y: targetCard.position.y + stickyIndex * (STICKY_H + 20),
                  },
                  size: { width: STICKY_W, height: STICKY_H },
                  author: "system",
                  refreshCadence: "manual",
                  pinnedAt: now,
                  comments: [],
                  queryGroupId: event.queryGroupId,
                };

                saveBoardCard(stickyCard, { sync: true });
                newStickyShapes.push(cardToShape(stickyCard));

                const conn: CardConnection = {
                  id: crypto.randomUUID(),
                  boardId,
                  fromCardId: targetNodeId,
                  toCardId: stickyId,
                };
                addConnection(conn);
                // Arrow will be created after shapes exist
                setTimeout(() => {
                  if (editorRef.current) {
                    createConnectionArrow(editorRef.current, conn);
                  }
                }, 0);
                stickyIndex++;
              }

              if (newStickyShapes.length > 0) {
                editor.createShapes(newStickyShapes);
              }
            }

            if (event.type === "suggestions") {
              const nodeId = serverToNodeId.get(event.targetCardId);
              if (nodeId) {
                updateBoardCardTldraw(nodeId, boardId, editor, {
                  followUpQuestions: event.questions,
                });
              }
            }

            if (event.type === "done") {
              flushPendingPersists();
              onStatus?.({ phase: "done", cardTitles });
            }

            if (event.type === "error") {
              if (event.cardId) {
                const nodeId = serverToNodeId.get(event.cardId);
                if (nodeId) {
                  updateBoardCardTldraw(nodeId, boardId, editor, {
                    markdownContent: `Error: ${event.message}`,
                  });
                }
              }
              if (!event.cardId) {
                onStatus?.({ phase: "error", message: event.message });
              }
            }
          }

          if (done) break;
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          onStatus?.({
            phase: "error",
            message: err instanceof Error ? err.message : "Query failed",
          });
        }
      } finally {
        flushPendingPersists();
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [boardId, isStreaming, editorRef]
  );

  return { processStream, isStreaming, cancel, currentQueryGroupId };
}

// ── Helpers ──

/**
 * Update a board card in the store and bump the tldraw shape version
 * to trigger re-render. The CardShapeUtil reads card data from board-store,
 * so we just need to tell tldraw "this shape changed" via the version prop.
 */
function updateBoardCardTldraw(
  nodeId: string,
  boardId: string,
  editor: Editor,
  updates: Partial<BoardCard> & Record<string, unknown>
) {
  const existing = getBoardCard(boardId, nodeId);
  if (!existing) return;

  // Filter out undefined values to avoid overwriting existing fields
  const cleanUpdates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) cleanUpdates[k] = v;
  }

  const updated = { ...existing, ...cleanUpdates } as BoardCard;
  saveBoardCard(updated, { sync: true });

  // Bump version prop on the tldraw shape to force re-render
  const shapeId = cardIdToShapeId(nodeId);
  const shape = editor.getShape(shapeId);
  if (shape && shape.type === "board-card") {
    editor.updateShape({
      id: shapeId,
      type: "board-card",
      props: {
        version: ((shape.props as { version?: number }).version ?? 0) + 1,
      },
    });
  }
}
