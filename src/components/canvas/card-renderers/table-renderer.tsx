import type { CardRendererProps } from "./types";
import {
  AccentStrip,
  InnerContainer,
  CardHeader,
} from "./shared";
import { ChartDataTable } from "@/components/chart/chart-data-table";

export function TableRenderer({ item, isSelected, isEditing }: CardRendererProps) {
  const data = (item.data ?? []) as Record<string, unknown>[];

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
          <span
            style={{
              fontSize: 11.7,
              fontWeight: 600,
              color: "var(--card-foreground)",
              flex: 1,
            }}
          >
            {item.title}
          </span>
        </CardHeader>

        <div
          className="nodrag nowheel"
          style={{
            flex: 1,
            minHeight: 0,
            pointerEvents: "all",
            overflow: "hidden",
          }}
        >
          {data.length === 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                fontSize: 10.8,
                color: "var(--muted-foreground)",
              }}
            >
              No data
            </div>
          ) : (
            <ChartDataTable data={data} pageSize={20} />
          )}
        </div>
      </InnerContainer>
    </>
  );
}
