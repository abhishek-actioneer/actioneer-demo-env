import type { CardRendererProps } from "./types";
import {
  AccentStrip,
  InnerContainer,
  CardHeader,
  DeltaBadge,
} from "./shared";

export function ReportRenderer({ item, isSelected, isEditing }: CardRendererProps) {

  // 1-line summary: first non-empty, non-header line from markdown
  const summaryLine = item.reportMarkdown
    ?.split("\n")
    .find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("**Period"))
    ?.replace(/^[-*]\s*/, "")
    .slice(0, 80) ?? "";

  // Fallback: truncated markdown preview if no heroMetric
  const fallbackPreview = item.reportMarkdown
    ? item.reportMarkdown.split("\n").slice(0, 6).join("\n")
    : "No content";

  return (
    <>
      <AccentStrip color="var(--muted-foreground)" />
      <InnerContainer>
        <CardHeader
          isInteractive={isSelected || isEditing}
          canvasItemId={item.id}
          boardId={item.boardId}
          showToolbar={isSelected || isEditing}
        >
          {/* Document icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span
            style={{
              fontSize: 11.7,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              color: "var(--card-foreground)",
              marginLeft: 6,
            }}
          >
            {item.title}
          </span>
        </CardHeader>

        {/* Body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "8px 12px 10px",
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          {item.heroMetric ? (
            <>
              <div
                style={{
                  fontSize: 25.2,
                  fontWeight: 700,
                  color: "var(--card-foreground)",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.2,
                  marginTop: 4,
                }}
              >
                {item.heroMetric}
              </div>
              {item.heroDelta && (
                <div style={{ marginTop: 6 }}>
                  <DeltaBadge delta={item.heroDelta} />
                </div>
              )}
              {summaryLine && (
                <div
                  style={{
                    fontSize: 9.9,
                    color: "var(--muted-foreground)",
                    marginTop: 8,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {summaryLine}
                </div>
              )}
              <div style={{ marginTop: "auto", fontSize: 9, color: "var(--muted-foreground)" }}>
                {new Date(item.pinnedAt).toLocaleDateString()}
              </div>
            </>
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
                {fallbackPreview}
              </div>
              <div style={{ fontSize: 9, color: "var(--muted-foreground)", marginTop: 4 }}>
                Pinned {new Date(item.pinnedAt).toLocaleDateString()}
              </div>
            </>
          )}
        </div>
      </InnerContainer>
    </>
  );
}
