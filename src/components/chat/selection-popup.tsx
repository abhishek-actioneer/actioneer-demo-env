"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface SelectionPopupProps {
  containerRef: React.RefObject<HTMLElement | null>;
  onAddToFollowUp: (text: string) => void;
  onAddToKnowledge: (text: string) => void;
}

export function SelectionPopup({
  containerRef,
  onAddToFollowUp,
  onAddToKnowledge,
}: SelectionPopupProps) {
  const [selected, setSelected] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const selectedRef = useRef<typeof selected>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const updateSelected = useCallback((next: typeof selected) => {
    const prev = selectedRef.current;
    const same =
      prev === next ||
      (!!prev &&
        !!next &&
        prev.text === next.text &&
        Math.abs(prev.x - next.x) < 0.5 &&
        Math.abs(prev.y - next.y) < 0.5);
    if (same) return;
    selectedRef.current = next;
    setSelected(next);
  }, []);

  const handleMouseUp = useCallback(() => {
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 3) {
        updateSelected(null);
        return;
      }

      if (
        !sel?.rangeCount ||
        !containerRef.current?.contains(sel.anchorNode)
      ) {
        updateSelected(null);
        return;
      }

      const range = sel.getRangeAt(0);
      const container = containerRef.current!;
      const containerRect = container.getBoundingClientRect();

      // Get the topmost rect from the selection (first visible line)
      const rects = range.getClientRects();
      let topRect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
      for (let i = 1; i < rects.length; i++) {
        if (rects[i].top < topRect.top) topRect = rects[i];
      }

      // Use fixed viewport coordinates — no scroll math needed
      const centerX = containerRect.left + containerRect.width / 2;
      const topY = topRect.top;

      updateSelected({
        text,
        x: centerX,
        y: topY - 8,
      });
    });
  }, [containerRef, updateSelected]);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return;
      updateSelected(null);
    },
    [updateSelected]
  );

  const handleScroll = useCallback(() => {
    updateSelected(null);
  }, [updateSelected]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("scroll", handleScroll);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [containerRef, handleMouseUp, handleMouseDown, handleScroll]);

  if (!selected) return null;

  return (
    <div
      ref={popupRef}
      className="fixed z-50 flex items-center gap-0.5 bg-background border border-border rounded-lg shadow-lg py-1 px-1 animate-selection-popup-in"
      style={{
        left: `${selected.x}px`,
        top: `${selected.y}px`,
        transform: "translate(-50%, -100%)",
      }}
    >
      <button
        onClick={() => {
          onAddToFollowUp(selected.text);
          updateSelected(null);
          window.getSelection()?.removeAllRanges();
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:text-foreground hover:bg-muted rounded-md transition-colors whitespace-nowrap"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <polyline points="15 14 20 9 15 4" />
          <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
        </svg>
        Add to Follow Up
      </button>
      <div className="w-px h-4 bg-border" />
      <button
        onClick={() => {
          onAddToKnowledge(selected.text);
          updateSelected(null);
          window.getSelection()?.removeAllRanges();
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:text-foreground hover:bg-muted rounded-md transition-colors whitespace-nowrap"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
        Add to Knowledge
      </button>
    </div>
  );
}
