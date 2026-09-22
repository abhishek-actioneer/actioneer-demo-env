"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { BoardCard } from "@/lib/board-types";
import { SortableCard } from "./sortable-card";
import { GhostPlaceholder } from "./ghost-placeholder";
import { AddCardButton } from "./add-card-button";
import type { CardCreationPayload } from "./add-card-menu";

/**
 * Backward compat: merge standalone follow-up cards into their preceding
 * text/insight card so they render as a single unified analysis panel.
 * Mutates nothing — returns a new array with follow-up data folded in.
 */
function mergeFollowUpsIntoText(cards: BoardCard[]): BoardCard[] {
  const sorted = [...cards].sort(
    (a, b) => (a.orderInSection ?? 0) - (b.orderInSection ?? 0),
  );
  const result: BoardCard[] = [];
  const skip = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const card = sorted[i];
    if (skip.has(card.id)) continue;

    // If this is a text/insight card, look ahead for a follow-up card
    if (
      (card.type === "text" || card.type === "report") &&
      i + 1 < sorted.length &&
      sorted[i + 1].type === "follow-up"
    ) {
      const followUpCard = sorted[i + 1];
      const questions = (followUpCard.markdownContent ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      // Merge: attach follow-ups to the text card
      result.push({
        ...card,
        followUpQuestions:
          card.followUpQuestions && card.followUpQuestions.length > 0
            ? card.followUpQuestions
            : questions,
        silentContext: card.silentContext || followUpCard.silentContext,
      });
      skip.add(followUpCard.id);
    } else {
      result.push(card);
    }
  }

  return result;
}

interface SectionCardGridProps {
  cards: BoardCard[];
  sectionId?: string;
  onDeleteCard?: (card: BoardCard) => void;
  deletedCards?: { id: string; height: number }[];
  onCardResized?: () => void;
  onAddCard?: (payload: CardCreationPayload, sectionId: string) => void;
  loadingCardIds?: Set<string>;
}

export const CARD_HEIGHTS: Record<string, number> = {
  chart: 440,
  metric: 440,
  table: 440,
  report: 440,
  text: 440,
  sql: 440,
  sticky: 440,
  parameter: 440,
  segment: 440,
  "follow-up": 440,
  commentary: 440,
};

const GRID_DENSE_STYLE: React.CSSProperties = {
  gridAutoFlow: "dense",
  alignItems: "start",
};

export function SectionCardGrid({
  cards,
  sectionId,
  onDeleteCard,
  deletedCards,
  onCardResized,
  onAddCard,
  loadingCardIds,
}: SectionCardGridProps) {
  // Merge standalone follow-up cards into their preceding text card
  const mergedCards = mergeFollowUpsIntoText(cards);
  const hasCards = mergedCards.length > 0;
  const hasPlaceholders = deletedCards && deletedCards.length > 0;
  const gridRef = useRef<HTMLDivElement>(null);
  const [colCount, setColCount] = useState(2);

  // Track actual column count via ResizeObserver
  const updateColCount = useCallback(() => {
    const el = gridRef.current;
    if (!el) return;
    const cols = getComputedStyle(el).gridTemplateColumns.split(" ").length;
    setColCount(cols);
    el.style.setProperty("--col-count", String(cols));
  }, []);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateColCount);
    observer.observe(el);
    updateColCount();
    return () => observer.disconnect();
  }, [updateColCount]);

  // Make section droppable so cards can be dragged into it
  const { setNodeRef, isOver } = useDroppable({
    id: `section-drop-${sectionId ?? "unsectioned"}`,
    data: { type: "section", sectionId: sectionId ?? "" },
  });

  // Combine refs: droppable + our grid ref
  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      (gridRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [setNodeRef],
  );

  const sid = sectionId ?? "";

  if (!hasCards && !hasPlaceholders) {
    return (
      <div
        ref={combinedRef}
        className={`rounded-md transition-colors ${isOver ? "ring-1 ring-foreground/20" : ""}`}
      >
        {onAddCard && (
          <AddCardButton
            onSelect={(payload) => onAddCard(payload, sid)}
            availableCards={mergedCards}
          />
        )}
      </div>
    );
  }

  return (
    <SortableContext items={mergedCards.map((c) => c.id)} strategy={rectSortingStrategy}>
      <div
        ref={combinedRef}
        style={{ ...GRID_DENSE_STYLE, alignItems: "start" }}
        className={`grid grid-cols-1 md:grid-cols-2 gap-4 rounded-md transition-colors ${
          isOver ? "ring-1 ring-foreground/20" : ""
        }`}
      >
        {mergedCards.map((card) => (
          <SortableCard
            key={card.id}
            card={card}
            colCount={colCount}
            onDeleteCard={onDeleteCard}
            onCardResized={onCardResized}
            isLoading={loadingCardIds?.has(card.id)}
          />
        ))}
      </div>
      {onAddCard && (
        <div className="mt-4">
          <AddCardButton
            onSelect={(payload) => onAddCard(payload, sid)}
            availableCards={mergedCards}
          />
        </div>
      )}
    </SortableContext>
  );
}
