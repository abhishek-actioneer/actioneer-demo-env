"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  getBoardCards,
  getBoardSections,
  populateBoard,
  removeBoardCard,
  removeBoardSection,
  saveBoardCard,
  saveBoardSection,
  reorderCardsInSection,
  moveCardToSection,
  reorderSections,
} from "@/lib/board-store";
import { ChevronRight, Loader2, CheckCircle2 } from "lucide-react";
import { subscribeToStream, getActivePdfStream } from "@/lib/deck-to-board-stream";
import type { ActivePdfStream } from "@/lib/deck-to-board-stream";
import { apiFetch } from "@/lib/api-client";
import type { Metric } from "@/lib/metric-types";
import { subscribeCatalog } from "@/lib/catalog-invalidation";
import type { Board, BoardCard, BoardSection } from "@/lib/board-types";
import { BoardHeader } from "./board-header";
import { SectionRenderer } from "./section-renderer";
import { SectionCardGrid } from "./section-card-grid";
import { CARD_HEIGHTS } from "./section-card-grid";
import { AddSectionInput } from "./add-section-input";
import { GhostPlaceholder } from "./ghost-placeholder";
import { SortableSection } from "./sortable-section";
import { CardRenderer } from "./card-renderer";
import type { CardCreationPayload } from "./add-card-menu";
import { useDocumentStream } from "@/hooks/use-document-stream";

interface DocumentViewProps {
  board: Board;
  streamState?: ActivePdfStream | null;
}

function safePreviewStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v), 2);
}

export function DocumentView({ board, streamState }: DocumentViewProps) {
  const boardId = board.id;

  const [refreshKey, setRefreshKey] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const { runQuery, loadingCardIds } = useDocumentStream(boardId, board.datasetId, () =>
    setRefreshKey((k) => k + 1),
  );
  const [insightLoading, setInsightLoading] = useState<string | null>(null); // sectionId being generated

  // Hydration-safe board-store reads — always in useEffect, never in body/useMemo/useState init
  const [liveSections, setLiveSections] = useState<BoardSection[]>([]);
  const [allCards, setAllCards] = useState<BoardCard[]>([]);

  useEffect(() => {
    setLiveSections(getBoardSections(boardId));
    setAllCards(getBoardCards(boardId));
  }, [boardId, refreshKey]);

  // Re-read store whenever stream state changes (processing, slide_complete, done)
  useEffect(() => {
    if (!streamState) return;
    if (streamState.status === "processing" || streamState.status === "done") {
      setLiveSections(getBoardSections(boardId));
      setAllCards(getBoardCards(boardId));
    }
  }, [boardId, streamState]);

  // Subscribe directly to stream singleton —
  // ensures re-reads even if React batches the parent's state updates
  useEffect(() => {
    const unsubscribe = subscribeToStream(() => {
      const s = getActivePdfStream();
      if (s?.boardId === boardId && (s.status === "processing" || s.status === "done")) {
        setLiveSections(getBoardSections(boardId));
        setAllCards(getBoardCards(boardId));
      }
    });
    return unsubscribe;
  }, [boardId]);

  // Re-read store when catalog is invalidated (e.g. pin-to-board from chat)
  useEffect(() => {
    return subscribeCatalog(() => {
      setLiveSections(getBoardSections(boardId));
      setAllCards(getBoardCards(boardId));
    });
  }, [boardId]);

  // Ephemeral placeholder state — lost on refresh/navigation (deletions are real)
  const [deletedCards, setDeletedCards] = useState<
    Map<string, { height: number; sectionId: string }>
  >(new Map());
  const [deletedSections, setDeletedSections] = useState<Set<string>>(
    new Set()
  );
  const [deletedProse, setDeletedProse] = useState<Set<string>>(new Set());

  // Drag state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<"card" | "section" | null>(null);

  // Accumulate all ever-seen section IDs (for deleted-section placeholder rendering).
  // useMemo runs during render so the ref is current before sectionOrder is derived.
  const sectionOrderRef = useRef<string[]>([]);
  useMemo(() => {
    const known = new Set(sectionOrderRef.current);
    const toAdd = liveSections.map((s) => s.id).filter((id) => !known.has(id));
    if (toAdd.length > 0) {
      sectionOrderRef.current = [...sectionOrderRef.current, ...toAdd];
    }
  }, [liveSections]);

  // Build a stable section map for quick lookup
  const sectionMap = useMemo(
    () => new Map(liveSections.map((s) => [s.id, s])),
    [liveSections]
  );

  // Derive section order from live state (always current) + any ref-only IDs for deleted placeholders.
  // Using useMemo instead of reading sectionOrderRef.current directly ensures re-renders pick up
  // new sections immediately — reading a ref in render body is always stale after the first section.
  const sectionOrder = useMemo(() => {
    const liveSet = new Set(liveSections.map((s) => s.id));
    const deletedPlaceholders = sectionOrderRef.current.filter((id) => !liveSet.has(id));
    return [...liveSections.map((s) => s.id), ...deletedPlaceholders];
  }, [liveSections]);

  // Sensors: distance threshold prevents accidental drags on click
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  // Guard against double-invocation (React 18 Strict Mode remounts in dev)
  const generatingRef = useRef(false);

  // Auto-generate board content (works for demo board and template boards)
  const generateBoard = useCallback(async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setGenError(null);
    try {
      const body: Record<string, string> = {};
      if (board.templateId) body.templateId = board.templateId;

      const data = await apiFetch<{
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
      }>("/api/board-generate", { method: "POST", body });

      populateBoard(boardId, data);
      setRefreshKey((k) => k + 1); // force re-render
    } catch (err) {
      console.error("[document-view] Board generation failed:", err);
      setGenError(err instanceof Error ? err.message : "Failed to generate board");
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [boardId, board.templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const isTemplateEmpty = !!board.templateId && getBoardCards(boardId).length === 0 && getBoardSections(boardId).length === 0;
    if (isTemplateEmpty) {
      generateBoard();
    }
  }, [boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Delete handlers ---

  const handleDeleteCard = useCallback(
    (card: BoardCard) => {
      const height = CARD_HEIGHTS[card.type] ?? 300;
      setDeletedCards(
        (prev) =>
          new Map(prev).set(card.id, {
            height,
            sectionId: card.sectionId ?? "",
          })
      );
      removeBoardCard(boardId, card.id);
      setRefreshKey((k) => k + 1);
    },
    [boardId]
  );

  const handleDeleteSection = useCallback(
    (sectionId: string) => {
      setDeletedSections((prev) => new Set(prev).add(sectionId));
      removeBoardSection(boardId, sectionId);
      setRefreshKey((k) => k + 1);
    },
    [boardId]
  );

  const handleDeleteProse = useCallback(
    (sectionId: string) => {
      setDeletedProse((prev) => new Set(prev).add(sectionId));
      const section = liveSections.find((s) => s.id === sectionId);
      if (section) saveBoardSection({ ...section, prose: "" });
    },
    [liveSections]
  );

  // Group cards by sectionId for fast lookup
  const cardsBySection = useMemo(() => {
    const map = new Map<string, BoardCard[]>();
    for (const card of allCards) {
      if (!card.sectionId) continue;
      const list = map.get(card.sectionId) ?? [];
      list.push(card);
      map.set(card.sectionId, list);
    }
    // Sort each group by orderInSection
    for (const [, cards] of map) {
      cards.sort((a, b) => (a.orderInSection ?? 0) - (b.orderInSection ?? 0));
    }
    return map;
  }, [allCards]);

  // Cards without a section (unsectioned) — show at the bottom
  const unsectionedCards = useMemo(
    () => allCards.filter((c) => !c.sectionId && !c.id.endsWith("-sentinel")),
    [allCards]
  );

  // --- Add card handler ---

  const handleAddCard = useCallback(
    (payload: CardCreationPayload, sectionId: string) => {
      const sectionCards = cardsBySection.get(sectionId) ?? [];
      const nextOrder = sectionCards.length;
      const { type, value, metricName, sourceCardId } = payload;

      const baseCard: BoardCard = {
        id: crypto.randomUUID(),
        boardId,
        sectionId,
        type: type === "insight" ? "text" : type === "commentary" ? "commentary" : type,
        title: "",
        position: { x: 0, y: 0 },
        size: { width: 400, height: 300 },
        author: "user",
        refreshCadence: "manual",
        pinnedAt: new Date().toISOString(),
        comments: [],
        orderInSection: nextOrder,
        colSpan: 1,
        data: [],
      };

      switch (type) {
        case "chart":
          // Delegate to the stream — it creates cards with SQL populated
          runQuery(value ?? "", sectionId, { preferredType: "chart" });
          return;
        case "table":
          // If metricName is set, this came from the metric list — create table card directly
          if (metricName && value) {
            (async () => {
              try {
                const res = await apiFetch<{ metrics: Metric[] }>(
                  `/api/metrics?datasetId=${board.datasetId}`,
                );
                const metric = res.metrics?.find((m) => m.id === value);
                if (!metric?.table || !metric?.column) {
                  runQuery(`Show ${metricName} as a data table`, sectionId, { preferredType: "table" });
                  return;
                }
                // Build a time-series + dimension breakdown SQL from metric definition
                const agg = metric.aggregation === "count" ? "COUNT(*)"
                  : metric.aggregation === "unique_count" ? `COUNT(DISTINCT "${metric.column}")`
                  : `${metric.aggregation.toUpperCase()}("${metric.column}")`;
                const dims = metric.dimensions?.length
                  ? metric.dimensions.map((d) => `"${d}"`).join(", ") + ", "
                  : "";
                const timeCol = metric.timeColumn || "created_at";
                const tableSql = `SELECT DATE_TRUNC('day', "${timeCol}"::TIMESTAMP) AS period, ${dims}${agg} AS value FROM "${metric.table}" GROUP BY period${dims ? ", " + metric.dimensions.map((d) => `"${d}"`).join(", ") : ""} ORDER BY period DESC LIMIT 500`;

                const queryRes = await apiFetch<{ data: Record<string, unknown>[]; columns: string[] }>(
                  "/api/chart-requery",
                  { method: "POST", body: { sql: tableSql, title: metricName } },
                );
                const tableCard: BoardCard = {
                  ...baseCard,
                  type: "table",
                  title: metricName,
                  data: queryRes.data ?? [],
                  sql: tableSql,
                };
                saveBoardCard(tableCard);
                setRefreshKey((k) => k + 1);
              } catch {
                runQuery(`Show ${metricName} as a data table`, sectionId, { preferredType: "table" });
              }
            })();
            return;
          }
          // Free-text: delegate to stream
          runQuery(value ?? "", sectionId, { preferredType: "table" });
          return;
        case "metric":
          // Generate a chart for this metric via the query stream
          runQuery(
            `Show me the trend for ${metricName ?? "this metric"} over time as a line chart`,
            sectionId,
            { preferredType: "chart" },
          );
          return;
        case "insight": {
          if (insightLoading) return; // prevent double-click
          const sourceCard = sectionCards.find((c) => c.id === sourceCardId);
          if (!sourceCard) return;

          const insertOrder = (sourceCard.orderInSection ?? 0) + 1;
          for (const card of sectionCards) {
            if ((card.orderInSection ?? 0) >= insertOrder) {
              saveBoardCard({ ...card, orderInSection: (card.orderInSection ?? 0) + 1 });
            }
          }

          const sourcePreview = sourceCard.data?.slice(0, 10);
          const contextParts = [
            `Source card title: ${sourceCard.title || "Untitled"}`,
            `Source card type: ${sourceCard.type}`,
          ];
          if (sourceCard.sql) contextParts.push(`SQL:\n${sourceCard.sql}`);
          if (sourceCard.markdownContent) contextParts.push(`Content:\n${sourceCard.markdownContent}`);
          if (sourcePreview && sourcePreview.length > 0) {
            contextParts.push(`Data sample:\n${safePreviewStringify(sourcePreview)}`);
          }
          if (sourceCard.heroMetric) contextParts.push(`Hero metric: ${sourceCard.heroMetric}`);
          const context = contextParts.join("\n\n");

          // Create placeholder card immediately for feedback — use "text" type so AnalysisPanel renders it
          const insightCardId = baseCard.id;
          baseCard.type = "text";
          baseCard.title = sourceCard.title ? `${sourceCard.title} Insight` : "Analysis";
          baseCard.markdownContent = "Generating insight...";
          baseCard.followUpQuestions = [];
          baseCard.sourceCardId = sourceCard.id;
          baseCard.orderInSection = insertOrder;
          saveBoardCard(baseCard);
          setRefreshKey((k) => k + 1);
          setInsightLoading(sectionId);

          // Generate via chat API (text-only, no SQL)
          (async () => {
            try {
              const prompt = `You are given a single analytics card from a board. Return a JSON object with exactly two fields:
- "insight": one actionable insight about THIS card only (2-3 sentences). Be specific. No headers.
- "followUps": array of 2-3 short follow-up questions about this same card.

Return ONLY valid JSON, nothing else.

Card context:
${context}`;
              const res = await apiFetch<{ text: string }>("/api/chat", {
                method: "POST",
                body: { query: prompt },
                stream: true,
              });
              const reader = (res as unknown as Response).body!.getReader();
              const decoder = new TextDecoder();
              let raw = "";
              while (true) {
                const { done, value: chunk } = await reader.read();
                if (done) break;
                raw += decoder.decode(chunk, { stream: true });
              }

              // Parse JSON response, fallback to raw text
              let insightText = raw.trim();
              let followUps: string[] = [];
              try {
                const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
                const parsed = JSON.parse(cleaned);
                if (parsed.insight) insightText = parsed.insight;
                if (Array.isArray(parsed.followUps)) followUps = parsed.followUps.map(String).slice(0, 3);
              } catch {
                // If JSON parse fails, try to split on "Follow-up:" manually
                const parts = raw.split(/follow[- ]?up[s]?:/i);
                if (parts.length > 1) {
                  insightText = parts[0].trim();
                  followUps = parts[1].split(/\n/).map(s => s.replace(/^\d+\.\s*/, "").trim()).filter(Boolean).slice(0, 3);
                }
              }

              // Build silentContext from the selected source card only
              const silentCtx = [
                sourceCard.title ? `Source card: ${sourceCard.title}` : "",
                sourceCard.sql ? `Previous SQL: ${sourceCard.sql}` : "",
              ].filter(Boolean).join("\n");

              saveBoardCard({
                ...baseCard,
                id: insightCardId,
                type: "text",
                title: sourceCard.title ? `${sourceCard.title} Insight` : "Analysis",
                markdownContent: insightText || "No insight generated.",
                followUpQuestions: followUps,
                silentContext: silentCtx || undefined,
                sourceCardId: sourceCard.id,
              });
            } catch {
              saveBoardCard({ ...baseCard, id: insightCardId, markdownContent: "Failed to generate insight." });
            } finally {
              setInsightLoading(null);
              setRefreshKey((k) => k + 1);
            }
          })();
          return;
        }
        case "commentary":
          baseCard.title = "Note";
          baseCard.markdownContent = "";
          baseCard.colSpan = 2;
          break;
      }

      saveBoardCard(baseCard);
      setRefreshKey((k) => k + 1);
    },
    [boardId, board.datasetId, cardsBySection, insightLoading, runQuery]
  );

  // --- Drag handlers ---

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const type = active.data.current?.type as "card" | "section" | undefined;
    setActiveDragId(active.id as string);
    setActiveDragType(type ?? null);
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // Could add visual feedback here in the future
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragId(null);
      setActiveDragType(null);

      if (!over || active.id === over.id) return;

      const activeType = active.data.current?.type;

      if (activeType === "section") {
        const oldIdx = sectionOrder.indexOf(active.id as string);
        const newIdx = sectionOrder.indexOf(over.id as string);
        if (oldIdx === -1 || newIdx === -1) return;

        const newOrder = [...sectionOrder];
        const [moved] = newOrder.splice(oldIdx, 1);
        newOrder.splice(newIdx, 0, moved);
        sectionOrderRef.current = newOrder;
        reorderSections(boardId, newOrder);
        setRefreshKey((k) => k + 1);
        return;
      }

      if (activeType === "card") {
        const activeSectionId = active.data.current?.sectionId as string;
        const overType = over.data.current?.type;

        if (overType === "card") {
          const overSectionId = over.data.current?.sectionId as string;

          if (activeSectionId === overSectionId) {
            // Same section reorder
            const sectionCards = cardsBySection.get(activeSectionId) ?? [];
            const ids = sectionCards.map((c) => c.id);
            const oldIdx = ids.indexOf(active.id as string);
            const newIdx = ids.indexOf(over.id as string);
            if (oldIdx === -1 || newIdx === -1) return;

            const newIds = [...ids];
            const [movedId] = newIds.splice(oldIdx, 1);
            newIds.splice(newIdx, 0, movedId);
            reorderCardsInSection(boardId, activeSectionId, newIds);
          } else {
            // Cross-section move
            const targetCards = cardsBySection.get(overSectionId) ?? [];
            const insertIdx = targetCards.findIndex((c) => c.id === (over.id as string));
            moveCardToSection(boardId, active.id as string, overSectionId, insertIdx >= 0 ? insertIdx : targetCards.length);
          }
        } else if (overType === "section") {
          const targetSectionId = over.data.current?.sectionId as string;
          if (targetSectionId !== activeSectionId) {
            moveCardToSection(boardId, active.id as string, targetSectionId, 0);
          }
        }

        setRefreshKey((k) => k + 1);
      }
    },
    [boardId, sectionOrder, cardsBySection]
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setActiveDragType(null);
  }, []);

  const isUploading = streamState?.status === "uploading";
  const isProcessing = streamState?.status === "processing";
  const isStreamError = streamState?.status === "error";

  const hasSections = sectionOrder.length > 0;
  const hasUnsectioned = unsectionedCards.length > 0;

  // Collect deleted card placeholders per section
  const deletedCardsBySection = new Map<string, { id: string; height: number }[]>();
  for (const [cardId, info] of deletedCards) {
    const list = deletedCardsBySection.get(info.sectionId) ?? [];
    list.push({ id: cardId, height: info.height });
    deletedCardsBySection.set(info.sectionId, list);
  }

  // Find the active card for drag overlay
  const activeCard = activeDragType === "card" && activeDragId
    ? allCards.find((c) => c.id === activeDragId)
    : null;

  // Live section IDs for sortable context (exclude deleted)
  const liveSectionIds = sectionOrder.filter((id) => !deletedSections.has(id) && sectionMap.has(id));

  // How many skeleton sections to show (pending slides not yet complete)
  const skeletonCount =
    isProcessing
      ? Math.max(0, streamState.totalSlides - streamState.completedSlides - sectionOrder.length)
      : 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-8 pt-6 pb-8">
        <BoardHeader board={board} />

        {/* Streaming progress — emerald progress bar matching research timeline style */}
        {(isUploading || isProcessing) && (() => {
          const hasContent = sectionOrder.length > 0;
          const completed = isProcessing ? streamState.completedSlides : 0;
          const total = isProcessing ? streamState.totalSlides : 0;
          const percent = total > 0 ? (completed / total) * 100 : 0;

          const statusText = isUploading
            ? (() => {
                const stage = streamState.stage;
                if (stage === "reading_slides") return "Reading slides from PDF...";
                if (stage === "processing_file") return "Processing file...";
                return "Uploading PDF...";
              })()
            : total > 0
              ? `Analyzing slides · ${completed} of ${total} complete`
              : "Preparing slides...";

          const progressBar = (
            <div className="relative rounded-lg border border-border/60 bg-card overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                {total > 0 && completed === total ? (
                  <CheckCircle2 className="h-4 w-4 text-foreground shrink-0" />
                ) : (
                  <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
                )}
                <p className="text-[11.7px] text-foreground">{statusText}</p>
                {total > 0 && (
                  <span className="text-[9.9px] text-muted-foreground/60 ml-auto tabular-nums">{Math.round(percent)}%</span>
                )}
              </div>
              {/* Emerald progress bar at bottom */}
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-border/20">
                <div
                  className="h-full bg-foreground transition-[width] duration-400 ease-out"
                  style={{ width: total > 0 ? `${percent}%` : isUploading ? "15%" : "0%" }}
                />
              </div>
            </div>
          );

          // Centered layout when no sections have loaded yet
          if (!hasContent) {
            return (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="w-full max-w-sm">
                  {progressBar}
                </div>
              </div>
            );
          }

          // Inline when sections are visible
          return <div className="mb-6">{progressBar}</div>;
        })()}

        {/* Stream error */}
        {isStreamError && (
          <div className="rounded-md border border-border bg-card p-4 mb-6 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{streamState.error}</p>
          </div>
        )}



        {/* Full-page skeleton when processing but no sections yet */}
        {isProcessing && sectionOrder.length === 0 && (
          <div className="space-y-8">
            {(streamState.extractedSlides ?? Array.from({ length: Math.max(3, streamState.totalSlides) })).map((slide, i) => {
              const preview = slide && typeof slide === "object" && "title" in slide ? slide : null;
              const chart = preview?.charts?.[0];
              return (
                <div key={preview?.index ?? i} className="mb-2">
                  {preview ? (
                    <h3 className="text-sm font-medium text-foreground mb-3">{preview.title}</h3>
                  ) : (
                    <div className="h-4 w-48 bg-muted/40 rounded mb-3 animate-pulse" />
                  )}
                  <div className="rounded-lg border border-border/50 bg-muted/10 h-56 flex items-center justify-center animate-pulse">
                    {chart ? (
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground/70">
                          Generating {chart.chartType} chart
                        </p>
                        <p className="text-xs text-muted-foreground/50 mt-0.5">
                          for &ldquo;{chart.metric}&rdquo;
                        </p>
                      </div>
                    ) : (
                      <div className="h-4 w-32 bg-muted/30 rounded" />
                    )}
                  </div>
                  <div className="mt-3 space-y-2">
                    <p className="text-[9.9px] font-medium text-muted-foreground/50 uppercase tracking-wider">AI Analysis</p>
                    <div className="h-3 w-3/4 bg-muted/30 rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-muted/20 rounded animate-pulse" />
                  </div>
                  <div className="mt-3">
                    <p className="text-[9.9px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">Follow-up questions</p>
                    <div className="flex gap-2">
                      <div className="h-6 w-28 bg-muted/20 rounded-full animate-pulse" />
                      <div className="h-6 w-24 bg-muted/20 rounded-full animate-pulse" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {/* Sections */}
          {hasSections ? (
            <SortableContext items={liveSectionIds} strategy={verticalListSortingStrategy}>
              {sectionOrder.map((sectionId) => {
                if (deletedSections.has(sectionId)) {
                  return (
                    <div key={sectionId} className="mb-10">
                      <GhostPlaceholder height={80} />
                    </div>
                  );
                }
                const section = sectionMap.get(sectionId);
                if (!section) return null;
                const sectionCards = cardsBySection.get(sectionId) ?? [];
                const isEmptyDuringStream = sectionCards.length === 0 && (isUploading || isProcessing);

                // Show shimmer skeleton when section exists but cards haven't arrived yet
                if (isEmptyDuringStream) {
                  const slidePreview = isProcessing
                    ? streamState.extractedSlides?.find((s) => `${boardId}-section-${s.index}` === sectionId)
                    : null;
                  const chart = slidePreview?.charts?.[0];
                  return (
                    <div key={sectionId} className="mb-10">
                      <div className="flex items-center gap-2 mb-3">
                        <ChevronRight className="h-4 w-4 text-muted-foreground rotate-90" />
                        <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Chart skeleton */}
                        <div className="rounded-lg border border-border/50 overflow-hidden" style={{ gridRow: "span 2" }}>
                          <div className="px-4 pt-3 pb-2 border-b border-border/30">
                            <div className="h-3 w-24 bg-muted/40 rounded animate-pulse" />
                          </div>
                          <div className="p-4 h-56 flex flex-col justify-end gap-1">
                            {chart && (
                              <p className="text-[9.9px] text-muted-foreground/40 text-center mb-auto mt-8">
                                Generating {chart.chartType} chart for &ldquo;{chart.metric}&rdquo;
                              </p>
                            )}
                            <div className="flex items-end gap-2 h-28">
                              {[40, 65, 50, 80, 35, 70, 55].map((h, i) => (
                                <div
                                  key={i}
                                  className="flex-1 bg-muted/30 rounded-t animate-pulse"
                                  style={{ height: `${h}%`, animationDelay: `${i * 100}ms` }}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                        {/* Analysis skeleton */}
                        <div className="rounded-lg border border-border/50 overflow-hidden">
                          <div className="px-4 pt-3.5 pb-2">
                            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/50">
                              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                              <span className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-wider">Analysis</span>
                            </div>
                          </div>
                          <div className="px-4 pt-2 pb-4 space-y-2.5">
                            <div className="h-3 w-full bg-muted/30 rounded animate-pulse" />
                            <div className="h-3 w-5/6 bg-muted/25 rounded animate-pulse" style={{ animationDelay: "100ms" }} />
                            <div className="h-3 w-4/6 bg-muted/20 rounded animate-pulse" style={{ animationDelay: "200ms" }} />
                          </div>
                          <div className="px-4 pb-3.5 pt-2 border-t border-border/30">
                            <span className="text-[9px] font-semibold text-muted-foreground/30 uppercase tracking-wider">Dig deeper</span>
                            <div className="flex flex-col gap-2 mt-2">
                              <div className="h-8 w-full bg-muted/20 rounded-md animate-pulse" style={{ animationDelay: "300ms" }} />
                              <div className="h-8 w-5/6 bg-muted/15 rounded-md animate-pulse" style={{ animationDelay: "400ms" }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <SortableSection key={sectionId} id={sectionId}>
                    <SectionRenderer
                      section={section}
                      cards={sectionCards}
                      onDeleteSection={handleDeleteSection}
                      onDeleteProse={handleDeleteProse}
                      proseDeleted={deletedProse.has(sectionId)}
                      onDeleteCard={handleDeleteCard}
                      deletedCards={deletedCardsBySection.get(sectionId) ?? []}
                      onCardResized={() => setRefreshKey((k) => k + 1)}
                      onAddCard={handleAddCard}
                      loadingCardIds={loadingCardIds}
                    />
                  </SortableSection>
                );
              })}

              {/* Skeleton rows for slides not yet complete */}
              {Array.from({ length: skeletonCount }).map((_, i) => {
                // Try to find matching extraction metadata for this skeleton
                const skeletonIdx = sectionOrder.length + i;
                const preview = isProcessing && streamState.extractedSlides?.[skeletonIdx];
                const chart = preview ? preview.charts?.[0] : null;
                return (
                  <div key={`skeleton-${i}`} className="mb-10">
                    {preview ? (
                      <h3 className="text-sm font-medium text-foreground/60 mb-3">{preview.title}</h3>
                    ) : (
                      <div className="h-4 w-48 bg-muted/40 rounded mb-4 animate-pulse" />
                    )}
                    <div className="rounded-lg border border-border/50 bg-muted/10 h-56 flex items-center justify-center animate-pulse">
                      {chart ? (
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground/70">Generating {chart.chartType} chart</p>
                          <p className="text-xs text-muted-foreground/50 mt-0.5">for &ldquo;{chart.metric}&rdquo;</p>
                        </div>
                      ) : (
                        <div className="h-4 w-32 bg-muted/30 rounded" />
                      )}
                    </div>
                  </div>
                );
              })}
            </SortableContext>
          ) : generating ? (
            <div className="space-y-8 animate-pulse">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-3">
                  <div className="h-4 w-48 rounded bg-muted" />
                  <div className="h-3 w-72 rounded bg-muted/60" />
                  <div className="grid grid-cols-2 gap-4">
                    <div className="h-[200px] rounded-lg bg-muted/40" />
                    {i % 2 === 0 && <div className="h-[200px] rounded-lg bg-muted/40" />}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Generating board...</span>
              </div>
            </div>
          ) : !hasUnsectioned && !isProcessing && !isUploading ? (
            <div className="rounded-md border border-dashed border-border p-12 text-center">
              {genError ? (
                <>
                  <p className="text-sm text-muted-foreground mb-2">{genError}</p>
                  <button
                    onClick={generateBoard}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                  >
                    Retry
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-2">
                    This board has no sections yet
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Add a section below or switch to canvas view to start building.
                  </p>
                </>
              )}
            </div>
          ) : null}

          {/* Unsectioned cards (canvas-created cards without a section) — hidden during streaming */}
          {hasUnsectioned && !isUploading && !isProcessing && (
            <div className="mb-10">
              <h2 className="text-lg font-semibold text-foreground mb-3">
                Unsectioned
              </h2>
              <SectionCardGrid
                cards={unsectionedCards}
                sectionId=""
                onDeleteCard={handleDeleteCard}
                deletedCards={deletedCardsBySection.get("") ?? []}
                onCardResized={() => setRefreshKey((k) => k + 1)}
                onAddCard={handleAddCard}
                loadingCardIds={loadingCardIds}
              />
            </div>
          )}

          {/* Drag overlay for cards */}
          <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.25, 1, 0.5, 1)" }}>
            {activeCard ? (
              <div
                style={{
                  width: 300,
                  height: CARD_HEIGHTS[activeCard.type] ?? 300,
                  opacity: 0.9,
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  overflow: "hidden",
                }}
              >
                <CardRenderer
                  card={activeCard}
                  width={300}
                  height={CARD_HEIGHTS[activeCard.type] ?? 300}
                  context="document"
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Add section — suppressed while PDF is uploading/processing */}
        {!isUploading && !isProcessing && (
          <div className="border-t border-border pt-4 mt-4">
            <AddSectionInput
              onSubmit={(title) => {
                const section: BoardSection = {
                  id: crypto.randomUUID(),
                  boardId,
                  title,
                  prose: "",
                  order: liveSections.length,
                  collapsed: false,
                };
                saveBoardSection(section);
                // Immediately update local state so the section appears without waiting for useEffect
                setLiveSections((prev) => [...prev, section]);
                setRefreshKey((k) => k + 1);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
