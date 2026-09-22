import type { CardRendererProps } from "./types";
import { CARD_STYLE_TOKENS, ShapeToolbar } from "./shared";

const STICKY_BG = "var(--muted)";

export function StickyRenderer({ item, isSelected, isEditing }: CardRendererProps) {
  const content = item.markdownContent ?? item.title ?? "";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: STICKY_BG,
        borderRadius: CARD_STYLE_TOKENS.borderRadius,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header row — toolbar */}
      <div
        className={(isSelected || isEditing) ? "nodrag" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 8px 0",
          minHeight: 24,
          pointerEvents: isSelected || isEditing ? "all" : "none",
          gap: 4,
        }}
      >
        <span style={{ flex: 1 }} />
        {(isSelected || isEditing) && (
          <ShapeToolbar canvasItemId={item.id} boardId={item.boardId} chatOnly />
        )}
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          pointerEvents: "none",
          overflow: "hidden",
          padding: "4px 10px 10px",
          fontSize: 11.7,
          lineHeight: 1.5,
          color: "var(--muted-foreground)",
          fontWeight: 500,
        }}
      >
        {content}
      </div>
    </div>
  );
}
