import { useState } from "react";
import type { CardRendererProps } from "./types";
import { AccentStrip, InnerContainer, ShapeToolbar } from "./shared";
import { useChatPanel } from "@/components/chat/chat-panel-provider";

const RESPONSE_CHIPS = [
  "Explain further",
  "Show the data",
  "I agree with this",
];

export function ChallengeRenderer({ item, isSelected, isEditing, onButtonPointerDown }: CardRendererProps) {
  const { injectText } = useChatPanel();

  return (
    <>
      <AccentStrip color="var(--muted-foreground)" />
      <InnerContainer>
        <div
          className={(isSelected || isEditing) ? "nodrag" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 12px 0",
            pointerEvents: isSelected || isEditing ? "all" : "none",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              fontSize: 9,
              fontWeight: 700,
              borderRadius: 4,
              background: "var(--muted)",
              color: "var(--muted-foreground)",
              textTransform: "uppercase" as const,
              letterSpacing: "0.05em",
            }}
          >
            CHALLENGE
          </span>
          <span style={{ flex: 1 }} />
          {(isSelected || isEditing) && (
            <ShapeToolbar canvasItemId={item.id} boardId={item.boardId} chatOnly />
          )}
        </div>
        <div
          style={{
            flex: 1,
            padding: "8px 12px 6px",
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              fontSize: 11.7,
              fontWeight: 600,
              lineHeight: 1.3,
              color: "var(--card-foreground)",
              display: "block",
              marginBottom: 6,
            }}
          >
            {item.title}
          </span>
          <div
            style={{
              fontSize: 9.9,
              color: "var(--muted-foreground)",
              lineHeight: 1.55,
              overflow: "hidden",
            }}
          >
            {item.markdownContent}
          </div>
        </div>
        {/* Response chips — always clickable, not gated on selection */}
        <div
          className="nodrag nopan nowheel"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "0 12px 10px",
            pointerEvents: "all",
          }}
        >
          {RESPONSE_CHIPS.map((label) => (
            <ChallengeResponseChip
              key={label}
              label={label}
              context={item.title}
              onAsk={injectText}
              onButtonPointerDown={onButtonPointerDown}
            />
          ))}
        </div>
      </InnerContainer>
    </>
  );
}

function ChallengeResponseChip({
  label,
  context,
  onAsk,
  onButtonPointerDown,
}: {
  label: string;
  context: string;
  onAsk: (text: string) => void;
  onButtonPointerDown?: (e: React.PointerEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onAsk(`${label}: ${context}`);
      }}
      onPointerDownCapture={onButtonPointerDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "4px 8px",
        borderRadius: 6,
        border: `1px solid ${hovered ? "var(--foreground)" : "var(--border)"}`,
        background: hovered ? "var(--muted)" : "transparent",
        color: hovered ? "var(--card-foreground)" : "var(--muted-foreground)",
        fontSize: 9,
        lineHeight: 1.4,
        cursor: "pointer",
        transition: "border-color 0.12s ease, background 0.12s ease, color 0.12s ease",
      }}
    >
      {label}
    </button>
  );
}
