"use client";

import { Pin, Check } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveBoardCard, getBoardCards, getBoardSections, getBoard } from "@/lib/board-store";
import { invalidateCatalog } from "@/lib/catalog-invalidation";
import { findPackedPosition, GAP } from "@/lib/canvas-layout";
import { useDataset } from "@/lib/dataset-context";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { BoardPickerPopover } from "@/components/canvas/board-picker-popover";
import type { BoardCard, CardType } from "@/lib/board-types";
import type { ChartSpec } from "@/lib/chart-types";

/* ── Default sizes per card type ── */
const CARD_SIZES: Record<CardType, { width: number; height: number }> = {
  chart: { width: 450, height: 340 },
  table: { width: 540, height: 300 },
  metric: { width: 260, height: 160 },
  sql: { width: 480, height: 280 },
  text: { width: 400, height: 260 },
  sticky: { width: 240, height: 200 },
  "follow-up": { width: 360, height: 180 },
  report: { width: 480, height: 360 },
  parameter: { width: 300, height: 180 },
  segment: { width: 400, height: 400 },
  challenge: { width: 280, height: 200 },
  commentary: { width: 400, height: 200 },
};

export interface PinButtonProps {
  /** The type of card to create on the board */
  cardType: CardType;
  /** Display title for the card */
  title: string;
  // Type-specific payloads (only one set is expected per usage)
  chartSpec?: ChartSpec;
  sql?: string;
  data?: Record<string, unknown>[];
  markdownContent?: string;
  metricId?: string;
  segmentId?: string;
  // Provenance
  sourceConversationId?: string;
  /** Called after a successful pin */
  onPinned?: () => void;
  /** If true, renders only the pin icon with no label text (compact mode) */
  iconOnly?: boolean;
  /** When set, pin directly to this board (e.g. on board pages). Falls back to picker if board doesn't exist. */
  targetBoardId?: string;
}

export function PinButton({
  cardType,
  title,
  chartSpec,
  sql,
  data,
  markdownContent,
  metricId,
  segmentId,
  sourceConversationId,
  onPinned,
  iconOnly = false,
  targetBoardId,
}: PinButtonProps) {
  const { datasetId } = useDataset();
  const { pinTargetSectionId } = useChatPanel();
  const [pinned, setPinned] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const router = useRouter();

  function buildCard(boardId: string): BoardCard {
    const existingCards = getBoardCards(boardId);
    const sections = getBoardSections(boardId);
    const size = CARD_SIZES[cardType] ?? CARD_SIZES.text;

    // Use target section from follow-up context, fallback to last section
    const targetSection = pinTargetSectionId
      ? sections.find((s) => s.id === pinTargetSectionId)
      : null;
    const lastSection = sections.length > 0 ? sections[sections.length - 1] : null;
    const sectionId = (targetSection ?? lastSection)?.id;
    const sectionCards = sectionId
      ? existingCards.filter((c) => c.sectionId === sectionId)
      : existingCards.filter((c) => !c.sectionId);
    const orderInSection = sectionCards.length;

    // Compute non-overlapping canvas position for canvas view (getBoardSections returns sorted)
    const existingBounds = existingCards.map((c) => ({
      x: c.position.x,
      y: c.position.y,
      width: c.size.width,
      height: c.size.height,
    }));
    const position = findPackedPosition(existingBounds, size, GAP);

    return {
      id: crypto.randomUUID(),
      boardId,
      type: cardType,
      title,
      author: "user",
      position,
      size,
      refreshCadence: "manual",
      pinnedAt: new Date().toISOString(),
      lastRefreshed: new Date().toISOString(),
      // Type-specific payloads
      chartSpec,
      sql,
      data,
      markdownContent,
      metricId,
      segmentId,
      sourceConversationId,
      comments: [],
      sectionId,
      orderInSection,
    };
  }

  function pinToBoard(boardId: string) {
    const card = buildCard(boardId);
    const ok = saveBoardCard(card);
    if (!ok) {
      toast.error("Failed to pin to board");
      return;
    }

    // Auto-create an analysis card alongside chart pins (matching deck AnalysisPanel style)
    if (cardType === "chart" && markdownContent) {
      // Extract clean insight text — strip code blocks, JSON, and chart specs
      let cleanText = markdownContent
        .replace(/```[\s\S]*?```/g, "") // remove code blocks
        .replace(/\{[\s\S]*?"type"\s*:\s*"(line|bar|pie|area)"[\s\S]*?\}/g, "") // remove chart JSON
        .trim();

      // Try to extract follow-up questions from the text
      const followUps: string[] = [];
      const followUpMatch = cleanText.match(/(?:follow[- ]?up|suggested)[\s\S]*?questions?:?\s*\n([\s\S]*?)$/i);
      if (followUpMatch) {
        const questionsBlock = followUpMatch[1];
        cleanText = cleanText.slice(0, followUpMatch.index).trim();
        const lines = questionsBlock.split("\n").map(l => l.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
        followUps.push(...lines.slice(0, 3));
      }

      const insightCard: BoardCard = {
        ...card,
        id: crypto.randomUUID(),
        type: "text",
        title: "Analysis",
        markdownContent: cleanText || "Analysis pinned from chat.",
        followUpQuestions: followUps,
        silentContext: sql ? `Previous SQL: ${sql}` : undefined,
        chartSpec: undefined,
        data: undefined,
        orderInSection: (card.orderInSection ?? 0) + 1,
        size: CARD_SIZES.text,
        position: { x: card.position.x + card.size.width + GAP, y: card.position.y },
      };
      saveBoardCard(insightCard);
    }

    // Trigger re-read in document view
    invalidateCatalog();

    setPinned(true);
    onPinned?.();

    const board = getBoard(boardId);
    const boardName = board?.name ?? "board";
    const isOnTargetBoard = targetBoardId === boardId;

    toast.success(`Pinned to ${boardName}`, {
      description: title,
      ...(isOnTargetBoard
        ? {}
        : {
            action: {
              label: "View",
              onClick: () => router.push(`/canvas/${boardId}`),
            },
          }),
      duration: 5000,
    });
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();

    if (pinned) {
      toast.info("Already pinned", { description: `"${title}" is already on a board.` });
      return;
    }

    // If targetBoardId is provided (e.g. on board pages), pin directly if the board still exists
    if (targetBoardId) {
      const board = getBoard(targetBoardId);
      if (board) {
        pinToBoard(targetBoardId);
        return;
      }
      // Board was deleted — fall through to picker
    }

    // Non-board pages: always show picker for explicit board selection
    setPickerOpen(true);
  }

  const trigger = pinned ? (
    <button
      disabled
      className={`inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground/60 cursor-default ${
        iconOnly ? "p-1" : "px-2 py-1"
      }`}
      title="Pinned to board"
    >
      <Check className="w-3.5 h-3.5 text-foreground/40" />
      {!iconOnly && <span>Pinned</span>}
    </button>
  ) : (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors ${
        iconOnly ? "p-1" : "px-2.5 py-1"
      }`}
      title="Pin to Board"
    >
      <Pin className="w-3.5 h-3.5" />
      {!iconOnly && <span>Pin to Board</span>}
    </button>
  );

  return (
    <BoardPickerPopover
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      onSelect={pinToBoard}
    >
      {trigger}
    </BoardPickerPopover>
  );
}
