import type { CardRendererProps } from "./types";
import {
  TYPE_ACCENT,
  AccentStrip,
  InnerContainer,
  CardHeader,
} from "./shared";
import { getBoardConnections } from "@/lib/board-store";

const TYPE_LABELS: Record<string, string> = {
  "date-range": "Date",
  dropdown: "Dropdown",
  text: "Text",
  number: "Number",
};

export function ParameterRenderer({ item, isSelected, isEditing }: CardRendererProps) {
  const config = item.parameterConfig;
  const label = config?.label ?? item.title;
  const inputType = config?.inputType ?? "text";
  const currentValue = config?.defaultValue ?? "--";

  // Count cards that this parameter feeds into (outgoing connections)
  const connections = getBoardConnections(item.boardId);
  const outgoingCount = connections.filter((c) => c.fromCardId === item.id).length;

  return (
    <>
      <AccentStrip color={TYPE_ACCENT.parameter} />
      <InnerContainer>
        <CardHeader
          isInteractive={isSelected || isEditing}
          canvasItemId={item.id}
          boardId={item.boardId}
          showToolbar={isSelected || isEditing}
        >
          {/* Sliders icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          <span
            style={{
              fontSize: 11.7,
              fontWeight: 600,
              color: "var(--card-foreground)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              marginLeft: 6,
            }}
          >
            {label}
          </span>
          {/* Type badge */}
          <span
            style={{
              fontSize: 9,
              color: "var(--muted-foreground)",
              padding: "2px 6px",
              background: "var(--muted)",
              borderRadius: 4,
              textTransform: "capitalize",
              marginRight: 4,
            }}
          >
            {TYPE_LABELS[inputType] ?? inputType}
          </span>
        </CardHeader>

        {/* Value display */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "8px 12px 12px",
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--card-foreground)",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.2,
              padding: "6px 10px",
              background: "var(--muted)",
              borderRadius: 6,
              border: "1px solid var(--border)",
              width: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {currentValue}
          </div>
          {outgoingCount > 0 && (
            <div
              style={{
                marginTop: 6,
                fontSize: 9,
                color: "var(--muted-foreground)",
                padding: "2px 7px",
                background: "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                alignSelf: "flex-start",
              }}
            >
              Connected to {outgoingCount} card{outgoingCount !== 1 ? "s" : ""}
            </div>
          )}
          {config?.options && config.options.length > 0 && (
            <div
              style={{
                marginTop: 6,
                fontSize: 9,
                color: "var(--muted-foreground)",
              }}
            >
              {config.options.length} option{config.options.length !== 1 ? "s" : ""} available
            </div>
          )}
        </div>
      </InnerContainer>
    </>
  );
}
