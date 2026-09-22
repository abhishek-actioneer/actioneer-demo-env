import type { CardRendererProps } from "./types";
import {
  TYPE_ACCENT,
  AccentStrip,
  InnerContainer,
  CardHeader,
  DeltaBadge,
} from "./shared";

/* Extract first numeric value from a data row */
function extractNumericValue(
  row: Record<string, unknown>
): { key: string; value: number } | null {
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "number") return { key: k, value: v };
  }
  return null;
}

/* Format a numeric value compactly (e.g. 1234567 → "1.23M") */
function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function MetricRenderer({
  item,
  isSelected,
  isEditing,
  comparisonData,
}: CardRendererProps) {
  // Extract the hero value from heroMetric or first numeric value in data
  let heroValue = item.heroMetric ?? "";
  if (!heroValue && item.data && item.data.length > 0) {
    const firstRow = item.data[0];
    const numericEntry = Object.entries(firstRow).find(
      ([, v]) =>
        typeof v === "number" ||
        (typeof v === "string" && /^[\d$,.]+%?$/.test(v))
    );
    if (numericEntry) heroValue = String(numericEntry[1]);
  }

  // Compute delta — prefer comparison data over lastData
  let delta: string | null = item.heroDelta ?? null;
  const compareRows = comparisonData ?? item.lastData;
  if (
    !delta &&
    compareRows &&
    compareRows.length > 0 &&
    item.data &&
    item.data.length > 0
  ) {
    const currentRow = item.data[0];
    const compareRow = compareRows[0];
    const numEntry = extractNumericValue(currentRow);
    if (numEntry) {
      const prevVal = compareRow[numEntry.key];
      if (typeof prevVal === "number" && prevVal !== 0) {
        const pctChange =
          ((numEntry.value - prevVal) / Math.abs(prevVal)) * 100;
        delta = `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%`;
      }
    }
  }

  // Comparison value to show below the main value
  let comparisonValue: string | null = null;
  if (comparisonData && comparisonData.length > 0 && item.data && item.data.length > 0) {
    const currentRow = item.data[0];
    const numEntry = extractNumericValue(currentRow);
    if (numEntry) {
      const compRow = comparisonData[0];
      const compVal = compRow[numEntry.key];
      if (typeof compVal === "number") {
        comparisonValue = formatCompact(compVal);
      }
    }
  }

  return (
    <>
      <AccentStrip color={TYPE_ACCENT.metric} />
      <InnerContainer>
        <CardHeader
          isInteractive={isSelected || isEditing}
          canvasItemId={item.id}
          boardId={item.boardId}
          showToolbar={isSelected || isEditing}
        >
          <span
            style={{
              fontSize: 10.8,
              fontWeight: 500,
              color: "var(--muted-foreground)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
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
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "8px 12px 12px",
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: 32.4,
              fontWeight: 700,
              color: "var(--card-foreground)",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
            }}
          >
            {heroValue || "--"}
          </div>

          {/* Comparison value (smaller, below hero) */}
          {comparisonValue && (
            <div
              style={{
                marginTop: 2,
                fontSize: 10.8,
                color: "var(--muted-foreground)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              vs. {comparisonValue}
            </div>
          )}

          {delta && (
            <div style={{ marginTop: 6 }}>
              <DeltaBadge delta={delta} />
            </div>
          )}
        </div>
      </InnerContainer>
    </>
  );
}
