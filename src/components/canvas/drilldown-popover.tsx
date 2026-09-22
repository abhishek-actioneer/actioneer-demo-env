"use client";

import { useEffect, useRef, useState } from "react";
import type { ChartSpec } from "@/lib/chart-types";
import { apiFetch } from "@/lib/api-client";
import { useDataset } from "@/lib/dataset-context";

export interface DrilldownContext {
  /** ID of the chart card that was clicked */
  parentCardId: string;
  /** The SQL query behind the parent chart */
  parentSql: string;
  /** The chart spec of the parent chart */
  parentChartSpec: ChartSpec;
  /** The column name that was clicked (xKey or nameKey) */
  clickedColumn: string;
  /** The value that was clicked (e.g., "Koramangala Hub") */
  clickedValue: string;
  /** The measure value (e.g., 4200000) */
  clickedMeasure: number | null;
  /** The measure key (e.g., "revenue") */
  clickedMeasureKey: string | null;
}

export interface DrilldownPopoverProps {
  /** Screen-space position where the popover should appear */
  position: { x: number; y: number };
  /** Context about what was clicked */
  context: DrilldownContext;
  /** Called when user selects a suggestion or submits custom query */
  onSubmit: (query: string, context: DrilldownContext) => void;
  /** Called when popover is dismissed */
  onCancel: () => void;
  /** Whether a stream is already active (disables submit) */
  isLoading: boolean;
}

interface Suggestion {
  label: string;
  query: string;
}

function formatMeasure(value: number | null, format?: "number" | "currency" | "percent", currencySymbol = "$"): string {
  if (value == null) return "";
  const abs = Math.abs(value);
  const prefix = format === "currency" ? currencySymbol : "";
  const suffix = format === "percent" ? "%" : "";
  if (suffix === "%") return `${value.toLocaleString()}%`;
  if (abs >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${prefix}${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${prefix}${value.toLocaleString()}`;
}

export function DrilldownPopover({
  position,
  context,
  onSubmit,
  onCancel,
  isLoading,
}: DrilldownPopoverProps) {
  const { dataset } = useDataset();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [customQuery, setCustomQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch suggestions on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingSuggestions(true);
    apiFetch<{ suggestions: Suggestion[] }>("/api/canvas-drilldown", {
      method: "POST",
      body: {
        parentSql: context.parentSql,
        clickedColumn: context.clickedColumn,
        clickedValue: context.clickedValue,
        chartType: context.parentChartSpec.type,
      },
    })
      .then((data) => {
        if (!cancelled) setSuggestions(data.suggestions ?? []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSuggestions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [context.parentSql, context.clickedColumn, context.clickedValue, context.parentChartSpec.type]);

  // Auto-focus the input once suggestions load
  useEffect(() => {
    if (!loadingSuggestions) {
      inputRef.current?.focus();
    }
  }, [loadingSuggestions]);

  // Escape key handler on the container
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    }
    const el = containerRef.current;
    el?.addEventListener("keydown", handleKeyDown);
    return () => el?.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const trimmed = customQuery.trim();
      if (trimmed && !isLoading) {
        onSubmit(trimmed, context);
      }
    }
  }

  const formatKey = context.clickedMeasureKey
    ? context.parentChartSpec.format?.[context.clickedMeasureKey]
    : undefined;
  const currencySymbol = dataset.currency || "$";
  const formattedMeasure = formatMeasure(context.clickedMeasure, formatKey, currencySymbol);
  const header = formattedMeasure
    ? `${context.clickedValue}: ${formattedMeasure}`
    : context.clickedValue;

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        left: isNaN(position.x) ? 100 : position.x,
        top: isNaN(position.y) ? 100 : position.y,
        zIndex: 100,
        transform: "translate(0, 8px)",
        pointerEvents: "all",
      }}
    >
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "var(--canvas-card-shadow, 0 4px 24px rgba(0,0,0,0.12))",
          minWidth: 240,
          maxWidth: 320,
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <span
            className="text-xs font-medium leading-snug"
            style={{ color: "var(--foreground)" }}
          >
            {header}
          </span>
          <button
            onClick={onCancel}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              border: "none",
              background: "transparent",
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--muted-foreground)",
              padding: 0,
              flexShrink: 0,
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--muted)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
            title="Dismiss (Esc)"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Suggestions */}
        <div className="flex flex-col gap-0.5">
          {loadingSuggestions ? (
            <>
              <ShimmerLine width="90%" />
              <ShimmerLine width="75%" />
              <ShimmerLine width="82%" />
            </>
          ) : suggestions.length > 0 ? (
            suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => !isLoading && onSubmit(s.query, context)}
                disabled={isLoading}
                className="text-xs text-left w-full rounded-md py-1.5 px-2.5 hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--foreground)",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {s.label}
              </button>
            ))
          ) : (
            <span
              className="text-xs px-2.5 py-1"
              style={{ color: "var(--muted-foreground)" }}
            >
              No suggestions available
            </span>
          )}
        </div>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: "var(--border)",
            margin: "0 -12px",
            width: "calc(100% + 24px)",
          }}
        />

        {/* Custom query input */}
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={customQuery}
            onChange={(e) => setCustomQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            disabled={isLoading}
            placeholder={`Ask about ${context.clickedValue}...`}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 10.8,
              color: "var(--foreground)",
              fontFamily: "inherit",
            }}
          />
          <kbd
            style={{
              fontSize: 9,
              color: "var(--muted-foreground)",
              background: "var(--muted)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "1px 4px",
              lineHeight: "16px",
              flexShrink: 0,
            }}
          >
            ↵
          </kbd>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes shimmer {
          0% { background-position: -200px 0; }
          100% { background-position: 200px 0; }
        }
      ` }} />
    </div>
  );
}

function ShimmerLine({ width }: { width: string }) {
  return (
    <div
      style={{
        height: 12,
        width,
        borderRadius: 4,
        margin: "4px 10px",
        background:
          "linear-gradient(90deg, var(--muted) 25%, var(--border) 50%, var(--muted) 75%)",
        backgroundSize: "400px 100%",
        animation: "shimmer 1.5s infinite linear",
      }}
    />
  );
}
