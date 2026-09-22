import type { CardRendererProps } from "./types";
import {
  AccentStrip,
  FollowUpChip,
  InnerContainer,
  ShapeToolbar,
} from "./shared";
import { useChatPanel } from "@/components/chat/chat-panel-provider";

export function InsightRenderer({ item, isSelected, isEditing, onButtonPointerDown }: CardRendererProps) {
  const rawItem = item as unknown as Record<string, unknown>;
  const severity = (rawItem.severity as string) ?? "info";
  const insightText = (rawItem.insightText as string) ?? item.markdownContent ?? item.reportMarkdown ?? "";
  const silentContext = rawItem.silentContext as string | undefined;
  const { injectText } = useChatPanel();

  const isFollowUp = item.type === "follow-up";

  // Parse follow-up questions from the joined markdownContent
  const questions = isFollowUp
    ? insightText
        .split(/\n\n+/)
        .map((q) => q.replace(/^[-*•\d.]\s*/, "").trim())
        .filter(Boolean)
    : [];

  return (
    <>
      <AccentStrip color="var(--muted-foreground)" />
      <InnerContainer>
        {/* Header row */}
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
              gap: 4,
              padding: "2px 8px",
              fontSize: 9,
              fontWeight: 700,
              borderRadius: 4,
              background: "var(--muted)",
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--muted-foreground)",
              }}
            />
            {isFollowUp ? "follow-ups" : severity}
          </span>
          <span style={{ flex: 1 }} />
          {(isSelected || isEditing) && (
            <ShapeToolbar canvasItemId={item.id} boardId={item.boardId} chatOnly />
          )}
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "8px 12px 10px",
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          {!isFollowUp && (
            <span
              style={{
                fontSize: 11.7,
                fontWeight: 600,
                lineHeight: 1.3,
                color: "var(--card-foreground)",
              }}
            >
              {item.title}
            </span>
          )}

          {isFollowUp ? (
            /* Interactive question chips — always clickable, not gated on selection */
            <div
              className="nodrag nopan nowheel"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                pointerEvents: "all",
                flex: 1,
                overflow: "hidden",
              }}
            >
              {questions.map((q, i) => (
                <FollowUpChip key={i} question={q} onAsk={(q) => injectText(q, silentContext)} onButtonPointerDown={onButtonPointerDown} />
              ))}
            </div>
          ) : (
            <>
              <div
                style={{
                  fontSize: 9.9,
                  color: "var(--muted-foreground)",
                  lineHeight: 1.5,
                  overflow: "hidden",
                  flex: 1,
                }}
              >
                {insightText}
              </div>
              {/* Challenge chip — always clickable, not gated on selection */}
              <div
                className="nodrag nopan nowheel"
                style={{ pointerEvents: "all" }}
              >
                <FollowUpChip
                  question={`Challenge this: ${item.title}`}
                  onAsk={(q) => injectText(q, silentContext)}
                  onButtonPointerDown={onButtonPointerDown}
                />
              </div>
            </>
          )}

          {!isFollowUp && (
            <div style={{ fontSize: 9, color: "var(--muted-foreground)" }}>
              {new Date(item.pinnedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </InnerContainer>
    </>
  );
}

