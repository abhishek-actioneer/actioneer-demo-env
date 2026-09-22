import React, { useState, useCallback, useEffect, useRef } from "react";
import { emitCanvasEvent } from "../canvas-events";
import { useInteractiveTldrawButton } from "../use-interactive-tldraw-button";
import { isStale } from "@/lib/board-refresh-scheduler";
import { getBoardCard, saveBoardCard } from "@/lib/board-store";

/* ── Design tokens ── */
export const CARD_STYLE_TOKENS = {
  background: "var(--card)",
  borderRadius: 10,
};

/* Monochrome — no colored accent strips */
export const TYPE_ACCENT: Record<string, string> = {
  chart: "var(--muted-foreground)",
  report: "var(--muted-foreground)",
  table: "var(--muted-foreground)",
  metric: "var(--muted-foreground)",
  sql: "var(--muted-foreground)",
  text: "var(--muted-foreground)",
  sticky: "transparent",
  parameter: "var(--muted-foreground)",
  segment: "var(--muted-foreground)",
};

export const SEVERITY_ACCENT: Record<string, string> = {
  critical: "var(--foreground)",
  warning: "var(--muted-foreground)",
  info: "var(--muted-foreground)",
};

export const ACCENT_STRIP = {
  width: 0,
  borderRadius: "10px 0 0 10px",
};

/* ── Minimum heights per card type ── */
export const MIN_CARD_HEIGHT: Record<string, number> = {
  chart: 476,
  report: 300,
  table: 400,
  metric: 180,
  sql: 220,
  text: 200,
  sticky: 120,
  parameter: 180,
  segment: 380,
  insight: 200,
  "follow-up": 200,
  challenge: 200,
};

/* ── Shared layout helpers ── */

export function AccentStrip({
  color,
  pulse,
}: {
  color: string;
  pulse?: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: ACCENT_STRIP.width,
        background: color,
        borderRadius: ACCENT_STRIP.borderRadius,
        pointerEvents: "none",
        opacity: 0.4,
        ...(pulse ? { animation: "accent-pulse 2s ease-in-out infinite" } : {}),
      }}
    />
  );
}

/* ── Author chip ── */

function AuthorChip({
  authorChip,
  canvasItemId,
  boardId,
  isInteractive,
}: {
  authorChip?: string;
  canvasItemId: string;
  boardId: string;
  isInteractive: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const handlePointerDown = useInteractiveTldrawButton();

  const saveChip = (value: string) => {
    const card = getBoardCard(boardId, canvasItemId);
    if (!card) return;
    const trimmed = value.trim();
    saveBoardCard({ ...card, authorChip: trimmed || undefined });
    setIsEditing(false);
  };

  const removeChip = () => {
    const card = getBoardCard(boardId, canvasItemId);
    if (!card) return;
    saveBoardCard({ ...card, authorChip: undefined });
  };

  if (isEditing) {
    return (
      <input
        autoFocus
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") saveChip(inputValue);
          if (e.key === "Escape") setIsEditing(false);
        }}
        onBlur={() => saveChip(inputValue)}
        placeholder="Author…"
        style={{
          border: "1px solid var(--border)",
          background: "var(--muted)",
          borderRadius: 4,
          fontSize: 9,
          padding: "1px 6px",
          width: 80,
          outline: "none",
          color: "var(--foreground)",
        }}
      />
    );
  }

  if (authorChip) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          border: "1px solid var(--border)",
          background: "var(--muted)",
          borderRadius: 9999,
          padding: "1px 8px",
          fontSize: 9,
          color: "var(--muted-foreground)",
          cursor: isInteractive ? "pointer" : "default",
        }}
        onClick={
          isInteractive
            ? () => {
                setInputValue(authorChip);
                setIsEditing(true);
              }
            : undefined
        }
        onPointerDownCapture={isInteractive ? (e) => e.stopPropagation() : undefined}
      >
        {authorChip}
        {isInteractive && (
          <button
            aria-label="Remove author"
            onPointerDownCapture={handlePointerDown}
            onClick={(e) => {
              e.stopPropagation();
              removeChip();
            }}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
              fontSize: 9,
              display: "flex",
              alignItems: "center",
            }}
          >
            ×
          </button>
        )}
      </span>
    );
  }

  if (!isInteractive) return null;

  return (
    <button
      title="Add author"
      onPointerDownCapture={handlePointerDown}
      onClick={() => {
        setInputValue("");
        setIsEditing(true);
      }}
      style={{
        width: 24,
        height: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        border: "none",
        background: "transparent",
        color: "var(--muted-foreground)",
        cursor: "pointer",
        fontSize: 12.6,
        lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget.style.background = "var(--muted)");
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      +
    </button>
  );
}

export function CardHeader({
  isInteractive,
  children,
  style,
  canvasItemId,
  boardId,
  showToolbar,
  chatOnly,
}: {
  isInteractive: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  canvasItemId: string;
  boardId?: string;
  showToolbar: boolean;
  chatOnly?: boolean;
}) {
  return (
    <div
      className={isInteractive ? "nodrag" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px 4px",
        minHeight: 32,
        pointerEvents: isInteractive ? "all" : "none",
        ...style,
      }}
    >
      {children}
      {boardId && (
        <AuthorChip
          authorChip={getBoardCard(boardId, canvasItemId)?.authorChip}
          canvasItemId={canvasItemId}
          boardId={boardId}
          isInteractive={isInteractive}
        />
      )}
      {showToolbar && <ShapeToolbar canvasItemId={canvasItemId} boardId={boardId} chatOnly={chatOnly} />}
    </div>
  );
}

export function CardBody({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        pointerEvents: "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function InnerContainer({
  children,
  paddingLeft,
}: {
  children: React.ReactNode;
  paddingLeft?: number;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: CARD_STYLE_TOKENS.borderRadius,
        display: "flex",
        flexDirection: "column",
        paddingLeft: paddingLeft ?? ACCENT_STRIP.width,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Subtle stale indicator shown when a card's data has not been refreshed
 * within its configured cadence interval.
 */
export function StaleIndicator({
  refreshCadence,
  lastRefreshed,
}: {
  refreshCadence: string;
  lastRefreshed?: string;
}) {
  if (refreshCadence === "manual") return null;
  if (!isStale(refreshCadence, lastRefreshed)) return null;

  return (
    <span
      title={`Data may be stale. Last refreshed ${lastRefreshed ? new Date(lastRefreshed).toLocaleString() : "never"}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 8.1,
        color: "var(--muted-foreground)",
        opacity: 0.65,
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      stale
    </span>
  );
}

/* ── Delta badge for comparison mode — monochrome ── */
export function DeltaBadge({ delta }: { delta: string }) {
  const isPositive = delta.startsWith("+") || delta.startsWith("↑");
  const isNegative = delta.startsWith("-") || delta.startsWith("↓");
  const sign = isPositive ? 1 : isNegative ? -1 : 0;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        fontSize: 9.9,
        fontWeight: 600,
        borderRadius: 9999,
        background: "var(--muted)",
        color: sign > 0 ? "var(--delta-up)" : sign < 0 ? "var(--delta-down)" : "var(--muted-foreground)",
        whiteSpace: "nowrap",
      }}
    >
      {delta}
    </span>
  );
}

/* ── Shape toolbar overlay ── */
export function ShapeToolbar({
  canvasItemId,
  boardId,
  chatOnly,
}: {
  canvasItemId: string;
  boardId?: string;
  chatOnly?: boolean;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the spinner timer on unmount to prevent state updates on dead components
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const hasComments = boardId
    ? (getBoardCard(boardId, canvasItemId)?.comments?.length ?? 0) > 0
    : false;

  const handleRefresh = useCallback(
    (_e: React.MouseEvent) => {
      if (isRefreshing) return;
      setIsRefreshing(true);
      emitCanvasEvent("refresh-card", canvasItemId);
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        setIsRefreshing(false);
      }, 3000);
    },
    [isRefreshing, canvasItemId]
  );

  const handleAsk = useCallback(
    (_e: React.MouseEvent) => {
      emitCanvasEvent("ask-about", canvasItemId);
    },
    [canvasItemId]
  );

  const handleSettings = useCallback(
    (_e: React.MouseEvent) => {
      emitCanvasEvent("open-config", canvasItemId);
    },
    [canvasItemId]
  );

  const handleComments = useCallback(
    (_e: React.MouseEvent) => {
      emitCanvasEvent("open-comments", canvasItemId);
    },
    [canvasItemId]
  );

  if (chatOnly) {
    return (
      <div className="nodrag" style={{ display: "flex", gap: 2, pointerEvents: "all" }}>
        <ToolbarBtn title="Chat with this card" onClick={handleAsk}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </ToolbarBtn>
      </div>
    );
  }

  return (
    <div
      className="nodrag"
      style={{
        display: "flex",
        gap: 2,
        pointerEvents: "all",
      }}
    >
      <ToolbarBtn
        title="Refresh data"
        onClick={handleRefresh}
        disabled={isRefreshing}
      >
        <svg
          width="13"
          height="13"
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
      </ToolbarBtn>
      <ToolbarBtn title="Ask about this" onClick={handleAsk}>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </ToolbarBtn>
      <div style={{ position: "relative" }}>
        <ToolbarBtn title="Comments" onClick={handleComments}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <line x1="9" y1="10" x2="15" y2="10" />
            <line x1="9" y1="14" x2="13" y2="14" />
          </svg>
        </ToolbarBtn>
        {hasComments && (
          <div
            style={{
              position: "absolute",
              top: 3,
              right: 3,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--foreground)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      <ToolbarBtn title="Settings" onClick={handleSettings}>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </ToolbarBtn>
    </div>
  );
}

/* ── Placeholder card for loading state ── */

const TYPE_ICONS: Record<string, string> = {
  sql: "{}",
  table: "⊞",
  chart: "◩",
  metric: "#",
  text: "≡",
  report: "⊟",
  sticky: "▤",
};

export function CardPlaceholder({
  cardType,
  title,
  phase,
}: {
  cardType: string;
  title: string;
  phase?: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: CARD_STYLE_TOKENS.background,
        borderRadius: CARD_STYLE_TOKENS.borderRadius,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontSize: 18,
          color: "var(--muted-foreground)",
          opacity: 0.4,
        }}
      >
        {TYPE_ICONS[cardType] ?? "◻"}
      </span>
      <span
        style={{
          fontSize: 9.9,
          fontWeight: 600,
          color: "var(--muted-foreground)",
          textAlign: "center",
          padding: "0 12px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
        }}
      >
        {title}
      </span>
      {phase && (
        <span
          style={{
            fontSize: 8.1,
            color: "var(--muted-foreground)",
            opacity: 0.6,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {phase}...
        </span>
      )}
      <div
        style={{
          width: 24,
          height: 2,
          borderRadius: 1,
          background: "var(--muted-foreground)",
          opacity: 0.2,
          animation: "accent-pulse 2s ease-in-out infinite",
        }}
      />
    </div>
  );
}

/* ── Follow-up question chip ── */

export function FollowUpChip({
  question,
  onAsk,
  onButtonPointerDown,
}: {
  question: string;
  onAsk: (text: string) => void;
  onButtonPointerDown?: (e: React.PointerEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onAsk(question);
      }}
      onPointerDownCapture={onButtonPointerDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "5px 9px",
        borderRadius: 6,
        border: `1px solid ${hovered ? "var(--foreground)" : "var(--border)"}`,
        background: hovered ? "var(--muted)" : "transparent",
        color: hovered ? "var(--card-foreground)" : "var(--muted-foreground)",
        fontSize: 9,
        lineHeight: 1.4,
        cursor: "pointer",
        transition: "border-color 0.12s ease, background 0.12s ease, color 0.12s ease",
        whiteSpace: "normal",
        wordBreak: "break-word",
      }}
    >
      {question}
    </button>
  );
}

function ToolbarBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
}) {
  const handlePointerDown = useInteractiveTldrawButton();

  return (
    <button
      title={title}
      // Use aria-disabled instead of the native disabled attribute.
      // Native disabled silences ALL pointer events (including onPointerDownCapture),
      // which lets tldraw steal the pointer and start an accidental drag when the
      // user clicks a spinning Refresh button. aria-disabled keeps the button
      // alive for pointer events while communicating disabled state accessibly.
      // Clicks are no-ops because the parent handler guards with `if (isRefreshing) return`.
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onPointerDownCapture={handlePointerDown}
      style={{
        width: 24,
        height: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        border: "none",
        background: "transparent",
        color: "var(--muted-foreground)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget.style.background = "var(--muted)");
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}
