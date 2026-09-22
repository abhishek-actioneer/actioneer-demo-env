"use client";

import { useCallback } from "react";
import type { BoardCard } from "@/lib/board-types";
import type { DataPointClickPayload } from "../card-renderers/types";
import { useDrilldownHandler } from "../drilldown-context";
import { CARD_STYLE_TOKENS } from "../card-renderers/shared";
import { useInteractiveTldrawButton } from "../use-interactive-tldraw-button";
import { saveBoardCard } from "@/lib/board-store";

// Renderers
import { ChartRenderer } from "../card-renderers/chart-renderer";
import { ReportRenderer } from "../card-renderers/report-renderer";
import { InsightRenderer } from "../card-renderers/insight-renderer";
import { ChallengeRenderer } from "../card-renderers/challenge-renderer";
import { TableRenderer } from "../card-renderers/table-renderer";
import { MetricRenderer } from "../card-renderers/metric-renderer";
import { SqlRenderer } from "../card-renderers/sql-renderer";
import { TextRenderer } from "../card-renderers/text-renderer";
import { StickyRenderer } from "../card-renderers/sticky-renderer";
import { ParameterRenderer } from "../card-renderers/parameter-renderer";
import { SegmentRenderer } from "../card-renderers/segment-renderer";

interface CardContentProps {
  card: BoardCard;
  width: number;
  height: number;
  isEditing: boolean;
  isSelected: boolean;
}

export function CardContent({
  card,
  width,
  height,
  isEditing,
  isSelected,
}: CardContentProps) {
  const drilldownHandler = useDrilldownHandler();
  const handleButtonPointerDown = useInteractiveTldrawButton();

  const handleDataPointClick = useCallback(
    (payload: DataPointClickPayload) => {
      drilldownHandler?.(card.id, payload);
    },
    [drilldownHandler, card.id]
  );

  const handleUpdateCard = useCallback(
    (updates: Partial<BoardCard>) => {
      saveBoardCard({ ...card, ...updates });
    },
    [card]
  );

  const rendererProps = {
    item: card,
    width,
    height,
    isSelected,
    isEditing,
    comparisonData: undefined as Record<string, unknown>[] | undefined,
    onButtonPointerDown: handleButtonPointerDown,
    onUpdateCard: handleUpdateCard,
  };

  let content: React.ReactNode = null;
  switch (card.type as string) {
    case "chart":
      content = (
        <ChartRenderer
          {...rendererProps}
          onDataPointClick={
            drilldownHandler ? handleDataPointClick : undefined
          }
        />
      );
      break;
    case "report":
      content = <ReportRenderer {...rendererProps} />;
      break;
    case "insight":
    case "follow-up":
      content = <InsightRenderer {...rendererProps} />;
      break;
    case "challenge":
      content = <ChallengeRenderer {...rendererProps} />;
      break;
    case "table":
      content = <TableRenderer {...rendererProps} />;
      break;
    case "metric":
      content = <MetricRenderer {...rendererProps} />;
      break;
    case "sql":
      content = <SqlRenderer {...rendererProps} />;
      break;
    case "text":
      content = <TextRenderer {...rendererProps} />;
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
    default:
      content = <ChartRenderer {...rendererProps} />;
      break;
  }

  const autoHeight = card.type === "text" || card.type === "report";

  return (
    <div
      style={{
        width: "100%",
        height: autoHeight ? "auto" : "100%",
        minHeight: autoHeight ? "100%" : undefined,
        ...CARD_STYLE_TOKENS,
        overflow: autoHeight ? "visible" : "hidden",
        position: "relative",
        border: isSelected
          ? "1px solid var(--foreground)"
          : "1px solid var(--border)",
        boxShadow: isSelected
          ? "0 0 0 2px color-mix(in srgb, var(--foreground) 15%, transparent)"
          : "var(--canvas-card-shadow)",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {content}
    </div>
  );
}
