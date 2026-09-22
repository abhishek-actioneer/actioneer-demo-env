import type { CardRendererProps } from "./types";
import {
  TYPE_ACCENT,
  AccentStrip,
  InnerContainer,
  CardHeader,
} from "./shared";
import { emitCanvasEvent } from "../canvas-events";
import { highlightSqlInline } from "@/lib/sql-highlight";

export function SqlRenderer({ item, isSelected, isEditing, onButtonPointerDown }: CardRendererProps) {
  const sql = item.sql ?? "";
  const data = item.data;
  const rowCount = data?.length;

  return (
    <>
      <AccentStrip color={TYPE_ACCENT.sql} />
      <InnerContainer>
        <CardHeader
          isInteractive={isSelected || isEditing}
          canvasItemId={item.id}
          boardId={item.boardId}
          showToolbar={isSelected || isEditing}
        >
          {/* Code icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
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
            {item.title}
          </span>
          {/* Run button */}
          <button
            className="nodrag"
            onClick={() => {
              emitCanvasEvent("run-sql", item.id);
            }}
            onPointerDownCapture={onButtonPointerDown}
            style={{
              padding: "2px 8px",
              fontSize: 9,
              fontWeight: 600,
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "var(--muted)",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              marginRight: 4,
              pointerEvents: "all",
            }}
          >
            Run
          </button>
        </CardHeader>

        {/* SQL code block */}
        <div
          style={{
            flex: 1,
            pointerEvents: "none",
            overflow: "hidden",
            padding: "6px 12px",
          }}
        >
          <pre
            style={{
              fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
              fontSize: 9.9,
              lineHeight: 1.5,
              color: "var(--card-foreground)",
              background: "var(--muted)",
              borderRadius: 6,
              padding: "8px 10px",
              overflow: "hidden",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              height: "100%",
              margin: 0,
            }}
          >
            {sql ? highlightSqlInline(sql) : <span style={{ color: "var(--muted-foreground)" }}>No SQL</span>}
          </pre>
        </div>

        {/* Footer with row count */}
        {data && (
          <div
            style={{
              padding: "4px 12px 6px",
              fontSize: 9,
              color: "var(--muted-foreground)",
              pointerEvents: "none",
              display: "flex",
              gap: 8,
            }}
          >
            {rowCount != null && (
              <span>{rowCount} row{rowCount !== 1 ? "s" : ""}</span>
            )}
          </div>
        )}
      </InnerContainer>
    </>
  );
}
