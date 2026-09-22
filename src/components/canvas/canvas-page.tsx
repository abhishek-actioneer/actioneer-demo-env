"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";
import type { Editor } from "tldraw";
import { getBoardCard, getBoardConnections, saveBoard, flushPendingPersists } from "@/lib/board-store";
import { startRefreshScheduler } from "@/lib/board-refresh-scheduler";
import {
  getActivePdfStream,
  subscribeToStream,
} from "@/lib/deck-to-board-stream";
import type { ActivePdfStream } from "@/lib/deck-to-board-stream";
import { CanvasConfigPanel } from "./canvas-config-panel";
import { CardCommentThread } from "./card-comment-thread";
import { PromptToCardInput } from "./prompt-to-card-input";
import { onCanvasEvent } from "./canvas-events";
import { TldrawCanvas } from "./tldraw-canvas";
import { DrilldownPopover, type DrilldownContext } from "./drilldown-popover";
import { DrilldownHandlerProvider } from "./drilldown-context";
import type { DataPointClickPayload } from "./card-renderers/types";
import { RefreshAllButton } from "./canvas-toolbar";
import { useCanvasBoard } from "./use-canvas-board";
import { useCanvasActions } from "./use-canvas-actions";
import { DocumentView } from "../board/document-view";
import { CanvasTopBar } from "../board/canvas-top-bar";

export default function CanvasPage({ boardId }: { boardId?: string }) {
  const editorRef = useRef<Editor | null>(null);

  const {
    resolvedBoardId,
    resolvedBoard,
    datasetId,
  } = useCanvasBoard(boardId);

  const [viewMode, setViewMode] = useState<"document" | "canvas">(
    resolvedBoard?.viewMode ?? "document"
  );

  // Subscribe to PDF stream singleton so DocumentView gets live updates
  const [streamState, setStreamState] = useState<ActivePdfStream | null>(() => {
    const s = getActivePdfStream();
    return s?.boardId === boardId && s?.status !== "done" ? s : null;
  });

  useEffect(() => {
    // Check initial state (handles the case where stream started before mount)
    const initial = getActivePdfStream();
    if (initial?.boardId === boardId && initial?.status !== "done") {
      setStreamState(initial);
    }
    const unsubscribe = subscribeToStream(() => {
      const s = getActivePdfStream();
      if (s && s.boardId === boardId) {
        setStreamState(s.status === "done" ? null : s);
      } else {
        setStreamState(null);
      }
    });
    return unsubscribe;
  }, [boardId]);

  useBreadcrumbTitle(resolvedBoard?.name ?? "");

  // Sync viewMode when board changes
  useEffect(() => {
    if (resolvedBoard?.viewMode) {
      setViewMode(resolvedBoard.viewMode);
    }
  }, [resolvedBoard?.viewMode]);

  const handleViewModeChange = useCallback(
    (mode: "document" | "canvas") => {
      setViewMode(mode);
      if (resolvedBoard) {
        saveBoard({ ...resolvedBoard, viewMode: mode, updatedAt: new Date().toISOString() });
      }
    },
    [resolvedBoard]
  );

  const {
    handleItemUpdated,
    handleRemove,
    handleCommentAnnotations,
    handleRefreshAll,
    handleDrop,
    handleDragOver,
    processStream,
    streamActive,
  } = useCanvasActions(resolvedBoardId, editorRef);

  const [configItemId, setConfigItemId] = useState<string | null>(null);
  const [commentCardId, setCommentCardId] = useState<string | null>(null);

  // ── Prompt-to-card state ──
  const [promptPosition, setPromptPosition] = useState<{ x: number; y: number } | null>(null);
  const promptPagePositionRef = useRef<{ x: number; y: number } | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);

  // ── Chart drill-down state ──
  const [drilldownPosition, setDrilldownPosition] = useState<{ x: number; y: number } | null>(null);
  const [drilldownContext, setDrilldownContext] = useState<DrilldownContext | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Flush pending board-store writes when leaving the canvas
  useEffect(() => {
    return () => flushPendingPersists();
  }, []);

  // ── Canvas event listeners (config panel + comments) ──
  useEffect(() => {
    const offConfig = onCanvasEvent("open-config", (id) => setConfigItemId(id));
    const offComments = onCanvasEvent("open-comments", (id) => {
      setCommentCardId((prev) => (prev === id ? null : id));
      setConfigItemId(null);
    });
    return () => {
      offConfig();
      offComments();
    };
  }, []);

  // ── Auto-refresh scheduler ──
  useEffect(() => {
    if (!resolvedBoardId) return;
    const stopScheduler = startRefreshScheduler(resolvedBoardId, datasetId);
    return stopScheduler;
  }, [resolvedBoardId, datasetId]);

  // ── Prompt-to-card: show input on canvas double-click ──
  const handleCanvasDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!resolvedBoardId) return;
      const editor = editorRef.current;
      if (!editor) return;

      // Don't trigger if clicking on a tldraw shape
      const target = e.target as HTMLElement;
      if (target.closest("[data-shape-type]") || target.closest(".tl-shape")) return;

      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const pagePos = editor.screenToPage({ x: e.clientX, y: e.clientY });
      promptPagePositionRef.current = pagePos;
      setPromptPosition({ x: screenX, y: screenY });
    },
    [resolvedBoardId]
  );

  const handlePromptCancel = useCallback(() => {
    setPromptPosition(null);
    promptPagePositionRef.current = null;
  }, []);

  const handlePromptSubmit = useCallback(
    async (query: string) => {
      if (!resolvedBoardId) return;

      const basePos = promptPagePositionRef.current ?? { x: 0, y: 0 };
      setPromptLoading(true);

      try {
        await processStream(query, basePos, datasetId);
      } finally {
        setPromptLoading(false);
        setPromptPosition(null);
        promptPagePositionRef.current = null;
      }
    },
    [resolvedBoardId, datasetId, processStream]
  );

  // ── Chart drill-down handler ──
  const handleDataPointClick = useCallback(
    (cardId: string, payload: DataPointClickPayload) => {
      if (!resolvedBoardId) return;
      const card = getBoardCard(resolvedBoardId, cardId);
      if (!card || !card.chartSpec) return;

      // Find upstream SQL
      let parentSql = card.sql ?? "";
      if (!parentSql) {
        const conns = getBoardConnections(resolvedBoardId);
        const visited = new Set<string>();
        const queue = [cardId];
        while (queue.length > 0 && !parentSql) {
          const current = queue.shift()!;
          if (visited.has(current)) continue;
          visited.add(current);
          for (const conn of conns) {
            if (conn.toCardId === current) {
              const upstream = getBoardCard(resolvedBoardId, conn.fromCardId);
              if (upstream?.sql) {
                parentSql = upstream.sql;
                break;
              }
              queue.push(conn.fromCardId);
            }
          }
        }
      }

      const containerRect = canvasContainerRef.current?.getBoundingClientRect();
      const offsetX = containerRect?.left ?? 0;
      const offsetY = containerRect?.top ?? 0;

      setDrilldownPosition({
        x: payload.screenX - offsetX,
        y: payload.screenY - offsetY,
      });
      setDrilldownContext({
        parentCardId: cardId,
        parentSql,
        parentChartSpec: card.chartSpec,
        clickedColumn: payload.column,
        clickedValue: payload.value,
        clickedMeasure: payload.measure,
        clickedMeasureKey: payload.measureKey,
      });
    },
    [resolvedBoardId]
  );

  const handleDrilldownSubmit = useCallback(
    async (query: string, ctx: DrilldownContext) => {
      if (!resolvedBoardId) return;

      const parentCard = getBoardCard(resolvedBoardId, ctx.parentCardId);
      const anchor = parentCard
        ? {
            x: parentCard.position.x + parentCard.size.width + 80,
            y: parentCard.position.y,
          }
        : { x: 0, y: 0 };

      setDrilldownPosition(null);
      setDrilldownContext(null);
      setDrilldownLoading(true);

      try {
        await processStream(query, anchor, datasetId, () => {}, {
          parentCardId: ctx.parentCardId,
          edgeLabel: ctx.clickedValue,
          parentSql: ctx.parentSql,
          filterHint: `${ctx.clickedColumn} = '${ctx.clickedValue}'`,
        });
      } finally {
        setDrilldownLoading(false);
      }
    },
    [resolvedBoardId, datasetId, processStream]
  );

  const handleDrilldownCancel = useCallback(() => {
    setDrilldownPosition(null);
    setDrilldownContext(null);
  }, []);


  // ── Editor ready callback ──
  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
  }, []);

  // If board isn't resolved yet but a stream is active for this boardId,
  // show a minimal loading state that matches the document view layout
  // to prevent a jarring flash before the board resolves.
  if (!resolvedBoardId) {
    const activeStream = boardId ? getActivePdfStream() : null;
    const isStreamingThisBoard = activeStream?.boardId === boardId;

    return (
      <div className="flex flex-col h-full min-w-0">
        {isStreamingThisBoard ? (
          <div className="h-full overflow-y-auto">
            <div className="mx-6 mt-2 mb-6 px-10 py-10 rounded-xl bg-background border border-border/50 min-h-[calc(100%-48px)]">
              <div className="flex items-center gap-2 mb-6">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-foreground/40 border-t-foreground" />
                <p className="text-xs text-muted-foreground">Uploading PDF...</p>
              </div>
            </div>
          </div>
        ) : (
          <main className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading canvas...</p>
          </main>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-w-0" key={resolvedBoardId}>
      {/* Top bar with board name + view toggle */}
      <CanvasTopBar
        boardId={resolvedBoardId}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      />

      {viewMode === "document" ? (
        <DocumentView board={resolvedBoard!} streamState={streamState} />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div
            ref={canvasContainerRef}
            className="flex-1 relative"
            onDoubleClick={handleCanvasDoubleClick}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <DrilldownHandlerProvider handler={handleDataPointClick}>
              <TldrawCanvas
                boardId={resolvedBoardId}
                onEditorReady={handleEditorReady}
              />
            </DrilldownHandlerProvider>

            {/* Refresh All button */}
            <RefreshAllButton
              boardId={resolvedBoardId}
              onRefreshAll={handleRefreshAll}
            />

            {/* NL prompt input (shown on double-click) */}
            {promptPosition && (
              <PromptToCardInput
                position={promptPosition}
                onSubmit={handlePromptSubmit}
                onCancel={handlePromptCancel}
                isLoading={promptLoading}
              />
            )}

            {/* Chart drill-down popover */}
            {drilldownPosition && drilldownContext && (
              <DrilldownPopover
                position={drilldownPosition}
                context={drilldownContext}
                onSubmit={handleDrilldownSubmit}
                onCancel={handleDrilldownCancel}
                isLoading={drilldownLoading || streamActive}
              />
            )}
          </div>

          {/* Config panel */}
          {configItemId && resolvedBoardId && (
            <CanvasConfigPanel
              itemId={configItemId}
              boardId={resolvedBoardId}
              onClose={() => setConfigItemId(null)}
              onRemove={(id) => {
                handleRemove(id);
                setConfigItemId(null);
              }}
              onItemUpdated={() => handleItemUpdated(configItemId)}
            />
          )}

          {/* Comment thread panel */}
          {commentCardId && resolvedBoardId && (
            <CardCommentThread
              cardId={commentCardId}
              boardId={resolvedBoardId}
              onClose={() => setCommentCardId(null)}
              onCommentAdded={() => {}}
              onAnnotations={handleCommentAnnotations}
            />
          )}
        </div>
      )}
    </div>
  );
}
