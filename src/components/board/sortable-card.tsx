"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardCard } from "@/lib/board-types";
import { CardRenderer } from "./card-renderer";
import { CARD_HEIGHTS } from "./section-card-grid";

interface SortableCardProps {
  card: BoardCard;
  colCount?: number;
  onDeleteCard?: (card: BoardCard) => void;
  onCardResized?: () => void;
  isLoading?: boolean;
}

function clampSpan(span: number, maxCols: number): number {
  return Math.min(Math.max(span, 1), maxCols);
}

export function SortableCard({
  card,
  colCount = 3,
  onDeleteCard,
  onCardResized,
  isLoading,
}: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { type: "card", sectionId: card.sectionId } });

  const h = CARD_HEIGHTS[card.type] ?? 300;
  const span = clampSpan(card.colSpan ?? 1, colCount);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridColumn: `span ${span}`,
    height: h,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} data-col-span={span} className="rounded-md relative group/card">
      <CardRenderer
        card={card}
        width={0}
        height={h}
        context="document"
        onDelete={onDeleteCard}
        onResized={onCardResized}
        dragHandleProps={{ ...attributes, ...listeners }}
        isLoading={isLoading}
      />
    </div>
  );
}
