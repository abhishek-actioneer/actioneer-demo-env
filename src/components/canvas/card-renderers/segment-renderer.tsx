import { useState, useEffect, useMemo } from "react";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import type { CardRendererProps } from "./types";
import {
  AccentStrip,
  InnerContainer,
  CardHeader,
} from "./shared";

/* Format a number compactly (e.g. 4933 → "4,933", 1234567 → "1.2M") */
function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

/* Extract the first numeric value from a data row */
function extractUserCount(data?: Record<string, unknown>[]): number | null {
  if (!data || data.length === 0) return null;
  const row = data[0];
  for (const v of Object.values(row)) {
    if (typeof v === "number") return v;
  }
  return null;
}

/* Truncate cell values for display */
function cellDisplay(val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "number") return val.toLocaleString();
  const s = String(val);
  return s.length > 24 ? s.slice(0, 22) + "…" : s;
}

export function SegmentRenderer({ item, isSelected, isEditing }: CardRendererProps) {
  const { dataset } = useDataset();
  const isInteractive = isSelected || isEditing;

  // Hero user count from pinned data
  const userCount = extractUserCount(item.data);

  // Fetch sample users on mount if we have a segmentId
  const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!item.segmentId) return;
    setPreviewLoading(true);
    apiFetch<{ userCount: number; preview?: Record<string, unknown>[] }>(
      `/api/segments/${item.segmentId}`,
      { skipModel: true },
    )
      .then((res) => {
        setPreview(res.preview ?? []);
      })
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false));
  }, [item.segmentId]);

  const columns = useMemo(() => {
    if (!preview || preview.length === 0) return [];
    return Object.keys(preview[0]).slice(0, 5); // cap at 5 columns for card space
  }, [preview]);

  return (
    <>
      <AccentStrip color="var(--muted-foreground)" />
      <InnerContainer>
        <CardHeader
          isInteractive={isInteractive}
          canvasItemId={item.id}
          boardId={item.boardId}
          showToolbar={isInteractive}
        >
          {/* Users icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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
        </CardHeader>

        {/* Body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "4px 12px 8px",
            overflow: "hidden",
            gap: 6,
          }}
        >
          {/* Hero: user count */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, pointerEvents: "none" }}>
            <span
              style={{
                fontSize: 25.2,
                fontWeight: 700,
                color: "var(--card-foreground)",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.1,
              }}
            >
              {userCount != null ? formatCount(userCount) : "—"}
            </span>
            <span style={{ fontSize: 9.9, color: "var(--muted-foreground)" }}>
              {dataset.entityName || "users"}
            </span>
          </div>

          {/* Sample users table */}
          <div
            className="nodrag nowheel"
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              pointerEvents: "all",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          >
            {previewLoading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 6 }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    border: "2px solid var(--muted)",
                    borderTop: "2px solid var(--muted-foreground)",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                <span style={{ fontSize: 9.9, color: "var(--muted-foreground)" }}>Loading sample…</span>
              </div>
            ) : preview && preview.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9 }}>
                <thead>
                  <tr style={{ position: "sticky", top: 0, background: "var(--muted)", zIndex: 1 }}>
                    {columns.map((col) => (
                      <th
                        key={col}
                        style={{
                          textAlign: "left",
                          padding: "4px 6px",
                          fontWeight: 600,
                          color: "var(--muted-foreground)",
                          whiteSpace: "nowrap",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 10).map((row, i) => (
                    <tr
                      key={i}
                      style={{ borderBottom: i < Math.min(preview.length, 10) - 1 ? "1px solid var(--border)" : undefined }}
                    >
                      {columns.map((col) => (
                        <td
                          key={col}
                          style={{
                            padding: "3px 6px",
                            color: "var(--card-foreground)",
                            whiteSpace: "nowrap",
                            maxWidth: 120,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {cellDisplay(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  fontSize: 9.9,
                  color: "var(--muted-foreground)",
                }}
              >
                {item.segmentId ? "No preview data" : "No segment linked"}
              </div>
            )}
          </div>

          {/* Footer: link to full workspace */}
          {item.segmentId && (
            <a
              href={`/segments/${item.segmentId}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 9.9,
                color: "var(--muted-foreground)",
                textDecoration: "none",
                pointerEvents: "all",
                paddingTop: 2,
              }}
              onMouseEnter={(e) => { (e.currentTarget.style.color = "var(--foreground)"); }}
              onMouseLeave={(e) => { (e.currentTarget.style.color = "var(--muted-foreground)"); }}
            >
              View full segment
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </a>
          )}
        </div>
      </InnerContainer>
    </>
  );
}
