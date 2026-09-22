"use client";

import { useCallback, useRef, useState } from "react";
import type { BoardCard } from "@/lib/board-types";
import type { CanvasCardPlan } from "@/lib/canvas-sse-types";
import { parseCanvasEvent } from "@/lib/canvas-sse-types";
import {
  saveBoardCard,
  getBoardCard,
  getBoardCards,
  flushPendingPersists,
} from "@/lib/board-store";
import { apiFetch } from "@/lib/api-client";
import { buildBoardFollowUpContext } from "@/lib/deck-to-board";

export interface UseDocumentStreamResult {
  /** Run a query and create/populate cards in a section */
  runQuery: (
    query: string,
    sectionId: string,
    opts?: { preferredType?: "chart" | "table" },
  ) => Promise<void>;
  /** Card IDs currently being streamed */
  loadingCardIds: Set<string>;
  /** Cancel all active streams */
  cancel: () => void;
}

export function useDocumentStream(
  boardId: string,
  datasetId: string,
  onUpdate: () => void,
): UseDocumentStreamResult {
  const [loadingCardIds, setLoadingCardIds] = useState<Set<string>>(new Set());
  const controllersRef = useRef<Set<AbortController>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedUpdate = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(onUpdate, 300);
  }, [onUpdate]);

  const cancel = useCallback(() => {
    for (const ctrl of controllersRef.current) {
      ctrl.abort();
    }
    controllersRef.current.clear();
    setLoadingCardIds(new Set());
  }, []);

  const runQuery = useCallback(
    async (
      query: string,
      sectionId: string,
      opts?: { preferredType?: "chart" | "table" },
    ) => {
      const controller = new AbortController();
      controllersRef.current.add(controller);

      // Maps server cardId -> actual card UUID
      const serverToNodeId = new Map<string, string>();
      const planMap = new Map<string, CanvasCardPlan>();
      // Suppressed cards -> their chart/table sibling
      const suppressedToTarget = new Map<string, string>();
      // Text accumulation
      const textAccum = new Map<string, string>();
      // Track card IDs created in this stream
      const streamCardIds = new Set<string>();

      const preferredType = opts?.preferredType ?? "chart";
      const now = new Date().toISOString();
      const optimisticNodeId = crypto.randomUUID();
      // Suppress everything except the preferred type — no auto-generated insight/text cards
      const suppressTypes =
        preferredType === "table"
          ? new Set(["sql", "chart", "text", "metric"])
          : new Set(["sql", "table", "text", "metric"]);

      // Create the requested card immediately so document view shows loading
      // state while the server is still decomposing/planning the query.
      const existingCards = getBoardCards(boardId).filter((c) => c.sectionId === sectionId);
      let nextOrder = existingCards.length;
      saveBoardCard(
        {
          id: optimisticNodeId,
          boardId,
          sectionId,
          type: preferredType,
          title: preferredType === "table" ? "Generating table..." : "Generating chart...",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          author: "system",
          refreshCadence: "manual",
          pinnedAt: now,
          comments: [],
          orderInSection: nextOrder++,
          colSpan: 1,
          data: [],
        },
        { sync: true },
      );
      streamCardIds.add(optimisticNodeId);
      setLoadingCardIds((prev) => new Set(prev).add(optimisticNodeId));
      debouncedUpdate();

      try {
        const res = await apiFetch("/api/canvas-query", {
          method: "POST",
          body: { query, datasetId },
          stream: true,
        });

        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let reusedOptimisticCard = false;

        while (true) {
          if (controller.signal.aborted) break;

          const { done, value } = await reader.read();
          if (!done) {
            buffer += decoder.decode(value, { stream: true });
          } else {
            buffer += decoder.decode();
          }
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          if (done && buffer.trim()) {
            lines.push(buffer);
            buffer = "";
          }

          for (const line of lines) {
            const event = parseCanvasEvent(line);
            if (!event) continue;

            if (event.type === "plan") {
              // Build reverse-adjacency to find chart/table descendants
              const childrenOf = new Map<string, string[]>();
              for (const card of event.cards) {
                planMap.set(card.cardId, card);
                for (const parentId of card.derivedFrom) {
                  if (!childrenOf.has(parentId))
                    childrenOf.set(parentId, []);
                  childrenOf.get(parentId)!.push(card.cardId);
                }
              }

              // Find nearest target-type descendant
              function findTargetDescendant(
                cardId: string,
              ): string | undefined {
                for (const childId of childrenOf.get(cardId) ?? []) {
                  const childType = planMap.get(childId)?.type;
                  if (childType === preferredType) return childId;
                  const found = findTargetDescendant(childId);
                  if (found) return found;
                }
                return undefined;
              }

              // Suppress sql/table (or sql/chart) cards that have the preferred type downstream
              for (const card of event.cards) {
                if (suppressTypes.has(card.type)) {
                  const targetId = findTargetDescendant(card.cardId);
                  if (targetId) {
                    suppressedToTarget.set(card.cardId, targetId);
                  }
                }
              }

              // Create placeholder cards for non-suppressed cards
              for (const card of event.cards) {
                const nodeId = !reusedOptimisticCard
                  && !suppressTypes.has(card.type)
                  && !suppressedToTarget.has(card.cardId)
                  ? optimisticNodeId
                  : crypto.randomUUID();
                serverToNodeId.set(card.cardId, nodeId);

                // For board document view we only persist the requested output card.
                // Summary text cards have no preferred-type descendant, so they must
                // be suppressed explicitly instead of relying on descendant mapping.
                if (suppressTypes.has(card.type) || suppressedToTarget.has(card.cardId)) continue;

                if (!reusedOptimisticCard && nodeId === optimisticNodeId) {
                  reusedOptimisticCard = true;
                  updateDocCard(nodeId, boardId, {
                    type: card.type,
                    title: card.title,
                    queryGroupId: event.queryGroupId,
                  });
                  continue;
                }

                const boardCard: BoardCard = {
                  id: nodeId,
                  boardId,
                  sectionId,
                  type: card.type,
                  title: card.title,
                  position: { x: 0, y: 0 },
                  size: { width: 400, height: 300 },
                  author: "system",
                  refreshCadence: "manual",
                  pinnedAt: now,
                  comments: [],
                  orderInSection: nextOrder++,
                  colSpan: 1,
                  data: [],
                  queryGroupId: event.queryGroupId,
                };

                saveBoardCard(boardCard, { sync: true });
                streamCardIds.add(nodeId);
              }

              setLoadingCardIds((prev) => {
                const next = new Set(prev);
                for (const id of streamCardIds) next.add(id);
                return next;
              });
              debouncedUpdate();
            }

            if (event.type === "card-data") {
              const nodeId = serverToNodeId.get(event.cardId);
              if (!nodeId) continue;

              if (event.cardType === "sql") {
                const targetServerId = suppressedToTarget.get(event.cardId);
                const targetNodeId = targetServerId
                  ? serverToNodeId.get(targetServerId)
                  : nodeId;
                if (!targetNodeId) continue;
                updateDocCard(targetNodeId, boardId, {
                  sql: event.sql,
                  ...(targetServerId
                    ? {}
                    : { title: event.description || undefined }),
                });
              }

              if (event.cardType === "query_result") {
                if (suppressedToTarget.has(event.cardId)) continue;
                updateDocCard(nodeId, boardId, {
                  data: event.rows,
                });
              }

              if (event.cardType === "chart") {
                updateDocCard(nodeId, boardId, {
                  chartSpec: event.chartSpec,
                  data: event.chartSpec.data as
                    | Record<string, unknown>[]
                    | undefined,
                });
              }

              if (event.cardType === "metric") {
                updateDocCard(nodeId, boardId, {
                  type: "metric",
                  markdownContent: `${event.value}`,
                  heroMetric: String(event.value),
                  heroLabel: String(event.label),
                  data: [{ label: event.label, value: event.value }],
                });
              }

              if (event.cardType === "text") {
                const prev = textAccum.get(event.cardId) ?? "";
                const newText = prev + event.delta;
                textAccum.set(event.cardId, newText);
                updateDocCard(nodeId, boardId, {
                  markdownContent: newText,
                });
              }

              debouncedUpdate();
            }

            if (event.type === "suggestions") {
              const nodeId = serverToNodeId.get(event.targetCardId);
              if (nodeId) {
                // Collect SQL from all parent chart/table nodes.
                // By this point all card-data events have been processed, so sql fields are written.
                // Handles both single-subquestion (1 SQL) and multi-subquestion (N SQLs) uniformly.
                const planEntry = planMap.get(event.targetCardId);
                const sqls: string[] = [];
                for (const parentServerId of planEntry?.derivedFrom ?? []) {
                  const parentNodeId = serverToNodeId.get(parentServerId);
                  if (parentNodeId) {
                    const parentCard = getBoardCard(boardId, parentNodeId);
                    if (parentCard?.sql) sqls.push(parentCard.sql);
                  }
                }
                const textCard = getBoardCard(boardId, nodeId);
                const silentContext = buildBoardFollowUpContext(
                  textCard?.title ?? "",
                  sqls,
                  textCard?.markdownContent,
                );
                updateDocCard(nodeId, boardId, {
                  followUpQuestions: event.questions,
                  silentContext,
                });
                debouncedUpdate();
              }
            }

            if (event.type === "done") {
              flushPendingPersists();
              setLoadingCardIds((prev) => {
                const next = new Set(prev);
                for (const id of streamCardIds) next.delete(id);
                return next;
              });
              // Clear debounce and fire immediate update
              if (debounceRef.current) clearTimeout(debounceRef.current);
              onUpdate();
            }

            if (event.type === "error") {
              if (event.cardId) {
                const nodeId = serverToNodeId.get(event.cardId);
                if (nodeId) {
                  updateDocCard(nodeId, boardId, {
                    markdownContent: `Error: ${event.message}`,
                  });
                }
              } else {
                // Global error — mark all stream cards with the error
                for (const id of streamCardIds) {
                  updateDocCard(id, boardId, {
                    markdownContent: `Error: ${event.message}`,
                  });
                }
              }
              setLoadingCardIds((prev) => {
                const next = new Set(prev);
                for (const id of streamCardIds) next.delete(id);
                return next;
              });
              if (debounceRef.current) clearTimeout(debounceRef.current);
              onUpdate();
            }
          }

          if (done) break;
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          for (const id of streamCardIds) {
            updateDocCard(id, boardId, {
              markdownContent: `Error: ${err instanceof Error ? err.message : "Query failed"}`,
            });
          }
          setLoadingCardIds((prev) => {
            const next = new Set(prev);
            for (const id of streamCardIds) next.delete(id);
            return next;
          });
          if (debounceRef.current) clearTimeout(debounceRef.current);
          onUpdate();
        }
      } finally {
        flushPendingPersists();
        controllersRef.current.delete(controller);
      }
    },
    [boardId, datasetId, onUpdate, debouncedUpdate],
  );

  return { runQuery, loadingCardIds, cancel };
}

/** Update a board card in the store (no tldraw — document view only). */
function updateDocCard(
  nodeId: string,
  boardId: string,
  updates: Partial<BoardCard> & Record<string, unknown>,
) {
  const existing = getBoardCard(boardId, nodeId);
  if (!existing) return;

  const cleanUpdates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) cleanUpdates[k] = v;
  }

  const updated = { ...existing, ...cleanUpdates } as BoardCard;
  saveBoardCard(updated, { sync: true });
}
