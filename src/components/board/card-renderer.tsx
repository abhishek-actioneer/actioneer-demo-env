"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { BoardCard } from "@/lib/board-types";
import { saveDismissedChips, saveBoardCard } from "@/lib/board-store";
import { CardExplorerFooter } from "./card-explorer-footer";
import { apiFetch } from "@/lib/api-client";
import type { ExplorerConfig } from "@/lib/explorer-types";
import type { ExplorerResult } from "@/lib/explorer-types";
import { renderSimpleMarkdown } from "../canvas/card-renderers/text-renderer";
import type { DataPointClickPayload } from "../canvas/card-renderers/types";
import { X, ArrowRight, AlertTriangle, GripVertical } from "lucide-react";
import { useChatPanel } from "@/components/chat/chat-panel-provider";

// Renderers (reused from canvas card-renderers — they have no tldraw dependency)
import { ChartRenderer } from "../canvas/card-renderers/chart-renderer";
import { ReportRenderer } from "../canvas/card-renderers/report-renderer";
import { InsightRenderer } from "../canvas/card-renderers/insight-renderer";
import { TableRenderer } from "../canvas/card-renderers/table-renderer";
import { MetricRenderer } from "../canvas/card-renderers/metric-renderer";
import { SqlRenderer } from "../canvas/card-renderers/sql-renderer";
import { TextRenderer } from "../canvas/card-renderers/text-renderer";
import { StickyRenderer } from "../canvas/card-renderers/sticky-renderer";
import { ParameterRenderer } from "../canvas/card-renderers/parameter-renderer";
import { SegmentRenderer } from "../canvas/card-renderers/segment-renderer";
import { CompactMetricCard } from "./compact-metric-card";
import { ResizeHandle } from "./resize-handle";

function FollowUpChipsRenderer({ card }: { card: BoardCard }) {
  const { injectText } = useChatPanel();
  const [dismissed, setDismissed] = useState<Set<number>>(
    new Set(card.dismissedChips ?? []),
  );

  const chips = (card.markdownContent ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  function dismiss(idx: number) {
    const next = new Set(dismissed).add(idx);
    setDismissed(next);
    saveDismissedChips(card.boardId, card.id, Array.from(next));
  }

  const visible = chips.filter((_, idx) => !dismissed.has(idx));

  if (visible.length === 0) return null;

  return (
    <div className="p-3 flex flex-col gap-2">
      {chips.map((chip, idx) => {
        if (dismissed.has(idx)) return null;
        return (
          <div key={idx} className="flex items-center gap-1 group/chip">
            <button
              type="button"
              onClick={() => injectText(chip, card.silentContext ?? "")}
              className="flex-1 flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-left"
            >
              <span className="flex-1">{chip}</span>
              <ArrowRight size={12} className="shrink-0 text-muted-foreground/50" />
            </button>
            <button
              type="button"
              onClick={() => dismiss(idx)}
              className="opacity-0 group-hover/chip:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted/50 text-muted-foreground"
              aria-label="Dismiss"
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Unified analysis panel — renders insight/text content with inline
 * follow-up question chips in a single cohesive card.
 */
function AnalysisPanel({ card }: { card: BoardCard }) {
  const { injectText } = useChatPanel();
  const followUps = card.followUpQuestions ?? [];
  const silentContext = card.silentContext ?? "";

  return (
    <div className="flex flex-col h-full max-h-[420px]">
      {/* Analysis header */}
      <div className="px-4 pt-3.5 pb-0 shrink-0">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-bold rounded bg-muted text-muted-foreground uppercase tracking-wider"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          Analysis
        </span>
      </div>

      {/* Analysis body */}
      <div className="px-5 pt-3 pb-4 text-card-foreground flex-1 overflow-y-auto analysis-body">
        {card.markdownContent ? renderSimpleMarkdown(card.markdownContent) : card.title}
      </div>

      {/* Challenge callout */}
      {card.challengeFindings && (
        <div className="mx-4 mb-2 rounded-md border border-border bg-muted/30 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Challenge</span>
          </div>
          <p className="text-[11.7px] leading-relaxed text-muted-foreground">
            {card.challengeFindings}
          </p>
        </div>
      )}

      {/* Divider + follow-ups */}
      {followUps.length > 0 && (
        <div className="border-t border-border/50 mx-4" />
      )}
      {followUps.length > 0 && (
        <div className="px-4 pt-2.5 pb-3.5 flex flex-col gap-2">
          <span className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
            Dig deeper
          </span>
          {followUps.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => injectText(q, silentContext, card.sectionId)}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border/60 text-[11.7px] text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-muted/40 transition-colors text-left group/q"
            >
              <span className="flex-1 line-clamp-2">{q}</span>
              <ArrowRight
                size={13}
                className="shrink-0 text-muted-foreground/30 group-hover/q:text-foreground/50 transition-colors"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentaryEditor({ card }: { card: BoardCard }) {
  const [editing, setEditing] = useState(!card.markdownContent);
  const [text, setText] = useState(card.markdownContent ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  function save() {
    saveBoardCard({ ...card, markdownContent: text });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="p-4 h-full">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
            if (e.key === "Escape") { setText(card.markdownContent ?? ""); setEditing(false); }
          }}
          placeholder="Write a note... (Cmd+Enter to save)"
          className="w-full h-full min-h-[60px] text-sm bg-transparent outline-none resize-none placeholder:text-muted-foreground/50"
        />
      </div>
    );
  }

  return (
    <div
      className="p-4 cursor-text min-h-[60px]"
      onClick={() => setEditing(true)}
    >
      {text ? (
        <div className="text-sm leading-relaxed">{renderSimpleMarkdown(text)}</div>
      ) : (
        <p className="text-sm text-muted-foreground/50">Click to add a note...</p>
      )}
    </div>
  );
}

interface CardRendererProps {
  card: BoardCard;
  width: number;
  height: number;
  context: "canvas" | "document";
  onDataPointClick?: (cardId: string, payload: DataPointClickPayload) => void;
  onDelete?: (card: BoardCard) => void;
  onResized?: () => void;
  dragHandleProps?: Record<string, unknown>;
  isLoading?: boolean;
}

export function CardRenderer({
  card,
  width,
  height,
  context,
  onDataPointClick,
  onDelete,
  onResized,
  dragHandleProps,
  isLoading,
}: CardRendererProps) {
  const isDocument = context === "document";

  const [localCard, setLocalCard] = useState(card);
  useEffect(() => { setLocalCard(card); }, [card]);

  const handleUpdateCard = useCallback(
    (updates: Partial<BoardCard>) => {
      const updated = { ...localCard, ...updates };
      setLocalCard(updated);
      saveBoardCard(updated);
    },
    [localCard],
  );

  const rendererProps = {
    item: localCard,
    width,
    height,
    // Keep isSelected false in document mode — we don't want canvas toolbars
    isSelected: false,
    isEditing: false,
    comparisonData: undefined as Record<string, unknown>[] | undefined,
    onUpdateCard: isDocument ? handleUpdateCard : undefined,
  };

  let content: React.ReactNode = null;
  switch (card.type as string) {
    case "chart":
      content = (
        <ChartRenderer
          {...rendererProps}
          onDataPointClick={
            onDataPointClick
              ? (payload: DataPointClickPayload) =>
                  onDataPointClick(card.id, payload)
              : undefined
          }
        />
      );
      break;
    case "report":
      content = <ReportRenderer {...rendererProps} />;
      break;
    case "insight":
      content = <InsightRenderer {...rendererProps} />;
      break;
    case "follow-up":
      content = <FollowUpChipsRenderer card={card} />;
      break;
    case "table":
      content = <TableRenderer {...rendererProps} />;
      break;
    case "metric":
      if (isDocument) {
        // Extract sparkline values from card data rows
        const sparkVals = card.data
          ?.map((row) => {
            const num = Object.values(row).find((v) => typeof v === "number");
            return typeof num === "number" ? num : undefined;
          })
          .filter((v): v is number => v !== undefined);
        content = (
          <CompactMetricCard
            title={card.title}
            value={card.heroMetric ?? "—"}
            delta={card.heroDelta}
            sparklineValues={sparkVals && sparkVals.length > 1 ? sparkVals : undefined}
          />
        );
        break;
      }
      content = <MetricRenderer {...rendererProps} />;
      break;
    case "sql":
      content = <SqlRenderer {...rendererProps} />;
      break;
    case "text":
      // In document view, all text cards render as analysis panels for consistent styling
      if (isDocument) {
        content = <AnalysisPanel card={card} />;
      } else {
        content = <TextRenderer {...rendererProps} />;
      }
      break;
    case "sticky":
      content = <StickyRenderer {...rendererProps} />;
      break;
    case "parameter":
      content = <ParameterRenderer {...rendererProps} />;
      break;
    case "segment":
      content = <SegmentRenderer {...rendererProps} />;
      break;
    case "commentary":
      if (isDocument) {
        content = <CommentaryEditor card={card} />;
      } else {
        content = <TextRenderer {...rendererProps} />;
      }
      break;
    default:
      content = <ChartRenderer {...rendererProps} />;
      break;
  }

  // Don't render the card shell if content is null (e.g. all follow-up chips dismissed)
  if (content === null) return null;

  const autoHeight = false;
  const showFloatingDelete = isDocument && !!onDelete;
  const showFloatingDragHandle = isDocument && !!dragHandleProps;

  return (
    <div
      className={`${isDocument ? "doc-card-interactive" : ""} ${isDocument ? "group/doccard relative" : ""}`}
      style={{
        width: "100%",
        height: autoHeight ? "auto" : "100%",
        minHeight: autoHeight ? "100%" : undefined,
        overflow: (autoHeight || isDocument) ? "visible" : "hidden",
        position: "relative",
        borderRadius: "var(--radius)",
        background: isDocument ? "var(--card)" : "var(--background)",
        border: "1px solid var(--border)",
      }}
    >
      {showFloatingDragHandle && (
        <button
          type="button"
          className="absolute left-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none opacity-0 group-hover/doccard:opacity-100 transition-opacity"
          {...dragHandleProps}
        >
          <GripVertical size={14} />
        </button>
      )}
      {showFloatingDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(card);
          }}
          className="absolute right-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/30 hover:text-muted-foreground opacity-0 group-hover/doccard:opacity-100 transition-opacity"
        >
          <X size={14} />
        </button>
      )}
      {content}
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-card/80 backdrop-blur-[2px] rounded-[var(--radius)]">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin text-muted-foreground" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" className="opacity-20" />
              <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="text-xs text-muted-foreground">Generating...</span>
          </div>
        </div>
      )}
      {isDocument && card.explorerConfig && card.type === "chart" && (
        <CardExplorerFooter
          config={card.explorerConfig}
          onConfigChange={async (newConfig: ExplorerConfig) => {
            try {
              const res = await apiFetch<ExplorerResult>("/api/explorer", {
                method: "POST",
                body: { config: newConfig },
              });
              if (!res.error && res.chartSpec) {
                saveBoardCard({
                  ...card,
                  explorerConfig: newConfig,
                  chartSpec: res.chartSpec,
                  data: res.data,
                  sql: res.sql,
                }, { sync: true });
              }
            } catch {
              // Silently fail — card stays at previous state
            }
          }}
          availableBreakdowns={[]}
        />
      )}
      {isDocument && onResized && (
        <ResizeHandle card={card} onResized={onResized} />
      )}
    </div>
  );
}
