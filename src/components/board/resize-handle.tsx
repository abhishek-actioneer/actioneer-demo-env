"use client";

import { useCallback } from "react";
import { saveBoardCard } from "@/lib/board-store";
import type { BoardCard } from "@/lib/board-types";

interface ResizeHandleProps {
  card: BoardCard;
  onResized: () => void;
}

/**
 * Bottom-right click handle for cycling card colSpan (1x → 2x → 3x → 1x).
 * Shows current span on hover. Click to cycle.
 */
export function ResizeHandle({ card, onResized }: ResizeHandleProps) {
  const currentSpan = card.colSpan ?? 1;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const nextSpan = currentSpan >= 3 ? 1 : ((currentSpan + 1) as 1 | 2 | 3);
      saveBoardCard({ ...card, colSpan: nextSpan });
      onResized();
    },
    [card, currentSpan, onResized]
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      className="absolute bottom-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded text-[9px] font-medium text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 opacity-0 group-hover/doccard:opacity-100 transition-all cursor-pointer"
      title={`Column span: ${currentSpan}x (click to cycle)`}
    >
      {currentSpan}x
    </button>
  );
}
