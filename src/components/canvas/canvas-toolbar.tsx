"use client";

import { useCallback, useState } from "react";
import type { Editor } from "tldraw";
import type { CardType } from "@/lib/board-types";
import { getBoardCards } from "@/lib/board-store";

// ── Card type options ──

const CARD_TYPE_OPTIONS: Array<{ type: CardType; label: string }> = [
  { type: "sticky", label: "Sticky" },
  { type: "sql", label: "SQL" },
  { type: "text", label: "Text" },
  { type: "chart", label: "Chart" },
  { type: "parameter", label: "Parameter" },
];

// ── RefreshAll button ──

export function RefreshAllButton({
  boardId,
  onRefreshAll,
}: {
  boardId: string;
  onRefreshAll: (cards: Array<{ id: string; sql: string }>) => void;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleClick = useCallback(() => {
    if (isRefreshing) return;

    const cards = getBoardCards(boardId);
    const sqlCards = cards
      .filter((c) => !!c.sql)
      .map((c) => ({ id: c.id, sql: c.sql! }));

    if (sqlCards.length === 0) return;

    setIsRefreshing(true);
    onRefreshAll(sqlCards);
    setTimeout(() => setIsRefreshing(false), 3000);
  }, [isRefreshing, boardId, onRefreshAll]);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(calc(-50% - 100px))",
        zIndex: 60,
      }}
    >
      <button
        title="Refresh all SQL cards"
        onClick={handleClick}
        disabled={isRefreshing}
        style={{
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 9999,
          border: "1px solid var(--border)",
          background: "var(--card)",
          color: isRefreshing ? "var(--muted-foreground)" : "var(--foreground)",
          cursor: isRefreshing ? "default" : "pointer",
          boxShadow: "var(--canvas-card-shadow)",
          opacity: isRefreshing ? 0.6 : 1,
          transition: "background 0.15s, opacity 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!isRefreshing) e.currentTarget.style.background = "var(--muted)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--card)";
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={isRefreshing ? { animation: "spin 1s linear infinite" } : undefined}
        >
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M16 16h5v5" />
        </svg>
      </button>
    </div>
  );
}

// ── AddCard toolbar ──

export function AddCardToolbar({
  editorRef,
  onAddCard,
  onOpenPrompt,
}: {
  editorRef: React.RefObject<Editor | null>;
  onAddCard: (type: CardType, position: { x: number; y: number }) => void;
  onOpenPrompt?: (screenPos: { x: number; y: number }, pagePos: { x: number; y: number }) => void;
}) {
  const [open, setOpen] = useState(false);

  const getCenter = useCallback((): { screen: { x: number; y: number }; page: { x: number; y: number } } => {
    const editor = editorRef.current;
    if (!editor) {
      return { screen: { x: window.innerWidth / 2, y: window.innerHeight / 2 }, page: { x: 0, y: 0 } };
    }
    const bounds = editor.getViewportScreenBounds();
    const screenX = bounds.x + bounds.width / 2;
    const screenY = bounds.y + bounds.height / 2;
    const pagePos = editor.screenToPage({ x: screenX, y: screenY });
    return { screen: { x: bounds.width / 2, y: bounds.height / 2 }, page: pagePos };
  }, [editorRef]);

  return (
    <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 60 }}>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: 44,
            right: 0,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "var(--canvas-card-shadow)",
            padding: "4px 0",
            minWidth: 140,
          }}
        >
          <button
            onClick={() => {
              const { screen, page } = getCenter();
              onOpenPrompt?.(screen, page);
              setOpen(false);
            }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "6px 12px",
              fontSize: 11.7,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--foreground)",
            }}
          >
            Ask a question
          </button>
          <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
          {CARD_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              onClick={() => {
                const { page } = getCenter();
                onAddCard(opt.type, page);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 12px",
                fontSize: 11.7,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--foreground)",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      <button
        title="Add card"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 36,
          height: 36,
          borderRadius: 9999,
          border: "1px solid var(--border)",
          background: "var(--card)",
          color: "var(--foreground)",
          cursor: "pointer",
          fontSize: 19.8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "var(--canvas-card-shadow)",
        }}
      >
        +
      </button>
    </div>
  );
}
