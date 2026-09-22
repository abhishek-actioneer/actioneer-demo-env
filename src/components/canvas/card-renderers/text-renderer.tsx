import type { CardRendererProps } from "./types";
import {
  TYPE_ACCENT,
  AccentStrip,
  FollowUpChip,
  InnerContainer,
  CardHeader,
} from "./shared";
import { useChatPanel } from "@/components/chat/chat-panel-provider";

/** Simple inline markdown renderer using inline styles */
export function renderSimpleMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;
  let i = 0;
  // Track the first non-header body paragraph so we can give it visual prominence
  let firstBodyLine = true;

  while (i < lines.length) {
    const line = lines[i];

    // Detect markdown table: current line has |, next line is separator (|---|)
    if (line.includes("|") && i + 1 < lines.length && /^\|?\s*[-:]+[-|:\s]+$/.test(lines[i + 1])) {
      const tableLines: string[] = [];
      // Collect all contiguous table lines
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(renderTable(tableLines, key++));
      continue;
    }

    // Headers
    if (line.startsWith("### ")) {
      elements.push(
        <div key={key++} style={{ fontSize: 10.8, fontWeight: 700, marginTop: 8, marginBottom: 4, color: "var(--card-foreground)" }}>
          {renderInlineBold(line.slice(4))}
        </div>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <div key={key++} style={{ fontSize: 11.7, fontWeight: 700, marginTop: 8, marginBottom: 4, color: "var(--card-foreground)" }}>
          {renderInlineBold(line.slice(3))}
        </div>
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <div key={key++} style={{ fontSize: 12.6, fontWeight: 700, marginTop: 8, marginBottom: 4, color: "var(--card-foreground)" }}>
          {renderInlineBold(line.slice(2))}
        </div>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={key++} style={{ paddingLeft: 12, position: "relative", marginBottom: 2 }}>
          <span style={{ position: "absolute", left: 2 }}>&bull;</span>
          {renderInlineBold(line.slice(2))}
        </div>
      );
    } else if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      if (match) {
        elements.push(
          <div key={key++} style={{ paddingLeft: 16, position: "relative", marginBottom: 2 }}>
            <span style={{ position: "absolute", left: 0 }}>{match[1]}.</span>
            {renderInlineBold(match[2])}
          </div>
        );
      }
    } else if (line.trim() === "") {
      elements.push(<div key={key++} style={{ height: 4 }} />);
    } else {
      // First body paragraph gets visual prominence — heavier weight, full foreground color
      const isLede = firstBodyLine;
      if (isLede) firstBodyLine = false;
      elements.push(
        <div
          key={key++}
          style={{
            marginBottom: isLede ? 6 : 2,
            fontWeight: isLede ? 600 : 400,
            fontSize: isLede ? 12 : 11,
            lineHeight: isLede ? 1.45 : 1.5,
            color: isLede ? "var(--card-foreground)" : "var(--muted-foreground)",
          }}
        >
          {renderInlineBold(line)}
        </div>
      );
    }
    i++;
  }

  return elements;
}

/** Parse markdown table lines into a styled <table> */
function renderTable(lines: string[], key: number): React.ReactNode {
  const parseCells = (row: string) =>
    row
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  // First line = header, second = separator (skip), rest = body rows
  const headerCells = parseCells(lines[0]);
  const bodyRows = lines
    .slice(2) // skip header + separator
    .filter((l) => l.trim() !== "")
    .map(parseCells);

  const cellStyle: React.CSSProperties = {
    padding: "3px 8px",
    fontSize: 9,
    whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border)",
  };

  return (
    <div key={key} style={{ overflowX: "auto", margin: "6px 0" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 9,
        }}
      >
        <thead>
          <tr>
            {headerCells.map((cell, i) => (
              <th
                key={i}
                style={{
                  ...cellStyle,
                  fontWeight: 600,
                  textAlign: "left",
                  color: "var(--muted-foreground)",
                  background: "var(--muted)",
                }}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={cellStyle}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Render **bold** inline */
function renderInlineBold(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let match;
  let k = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    parts.push(<strong key={k++} style={{ fontWeight: 600 }}>{match[1]}</strong>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

export function TextRenderer({ item, isSelected, isEditing, onButtonPointerDown }: CardRendererProps) {
  const content = item.markdownContent ?? "";
  const followUps = item.followUpQuestions ?? [];
  const { injectText } = useChatPanel();

  return (
    <>
      <AccentStrip color={TYPE_ACCENT.text} />
      <InnerContainer>
        <CardHeader
          isInteractive={isSelected || isEditing}
          canvasItemId={item.id}
          boardId={item.boardId}
          showToolbar={isSelected || isEditing}
          chatOnly
        >
          <span
            style={{
              fontSize: 11.7,
              fontWeight: 600,
              color: "var(--card-foreground)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {item.title}
          </span>
        </CardHeader>

        {/* Text content */}
        <div
          style={{
            flex: 1,
            pointerEvents: "none",
            overflow: "visible",
            padding: "6px 12px 10px",
            fontSize: 9.9,
            lineHeight: 1.5,
            color: "var(--card-foreground)",
          }}
        >
          {content ? renderSimpleMarkdown(content) : (
            <span style={{ color: "var(--muted-foreground)" }}>Empty</span>
          )}
        </div>

        {/* Follow-up question chips */}
        {followUps.length > 0 && (
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
            {followUps.map((q, i) => (
              <FollowUpChip
                key={i}
                question={q}
                onAsk={(q) => injectText(q, item.silentContext)}
                onButtonPointerDown={onButtonPointerDown}
              />
            ))}
          </div>
        )}
      </InnerContainer>
    </>
  );
}
