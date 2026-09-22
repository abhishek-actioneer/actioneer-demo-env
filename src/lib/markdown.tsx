"use client";

import React, { useState, useCallback } from "react";
import { ChevronRight, Download } from "lucide-react";
import { UnifiedChart } from "@/components/chart/unified-chart";
import { useChartRequery } from "@/hooks/use-chart-requery";
import type { ChartSpec } from "@/lib/chart-types";
import type { DetectableEntity } from "@/lib/entity-types";
import type { SubagentInfo } from "@/lib/types";
import { extractMarkdownHeadings } from "@/lib/markdown-headings";
import { DataActionsDropdown, type DataView } from "@/components/chart/chart-data-actions";
import { ChartDataTable } from "@/components/chart/chart-data-table";
import { downloadCSV } from "@/lib/csv-export";

/** Inline chart with optional requery support when spec.sql is present */
function InlineChart({
  initialSpec,
  renderActions,
}: {
  initialSpec: ChartSpec;
  renderActions?: (spec: ChartSpec) => React.ReactNode;
}) {
  const [spec, setSpec] = useState(() => normalizeInlineChartSpec(initialSpec));
  const { requery } = useChartRequery();
  const canRequery = !!spec.sql;

  const handleGrainChange = useCallback(
    async (grain: "daily" | "weekly" | "monthly") => {
      if (!spec.sql) return;
      const result = await requery({ sql: spec.sql, newGrain: grain, title: spec.title });
      if (result?.chartSpec) {
        setSpec((prev) => ({ ...prev, ...result.chartSpec!, type: prev.type }));
      }
    },
    [spec.sql, spec.title, requery],
  );

  const handleTimeRangeChange = useCallback(
    async (range: { start: string; end: string } | string) => {
      if (!spec.sql || typeof range === "string") return;
      const result = await requery({ sql: spec.sql, newDateRange: range, title: spec.title });
      if (result?.chartSpec) {
        setSpec((prev) => ({ ...prev, ...result.chartSpec!, type: prev.type }));
      }
    },
    [spec.sql, spec.title, requery],
  );

  if (isSingleValueBarSpec(spec)) {
    return (
      <div>
        <SingleValueSummary spec={spec} />
        {renderActions?.(spec)}
      </div>
    );
  }

  return (
    <div>
      <UnifiedChart
        spec={spec}
        variant={canRequery ? "normal" : "compact"}
        onGrainChange={canRequery ? handleGrainChange : undefined}
        onTimeRangeChange={canRequery ? handleTimeRangeChange : undefined}
      />
      {renderActions?.(spec)}
    </div>
  );
}

function normalizeInlineChartSpec(spec: ChartSpec): ChartSpec {
  if (spec.type !== "bar" || !spec.xKey) return spec;
  if (hasTimeLikeXAxis(spec)) return { ...spec, type: "line" };
  return spec;
}

function hasTimeLikeXAxis(spec: ChartSpec): boolean {
  const xKey = spec.xKey;
  if (!xKey) return false;
  if (/\b(date|month|week|day|year|time|period)\b/i.test(xKey)) return true;
  return spec.data.some((row) => isDateLikeValue(row[xKey]));
}

function isDateLikeValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}(-\d{2})?$/.test(value) || /^\d{4}-(Q[1-4]|W\d{1,2})$/i.test(value);
}

function isSingleValueBarSpec(spec: ChartSpec): boolean {
  return spec.type === "bar" && spec.data.length <= 1 && !!spec.yKeys?.length;
}

function SingleValueSummary({ spec }: { spec: ChartSpec }) {
  const yKey = spec.yKeys?.[0];
  const rawValue = yKey ? spec.data[0]?.[yKey] : undefined;
  const value = typeof rawValue === "number" ? formatSingleValue(rawValue, spec.format?.[yKey ?? ""], spec.currency) : String(rawValue ?? "0");
  const label = spec.yLabels?.[0] ?? yKey?.replace(/_/g, " ") ?? "Value";

  return (
    <div className="rounded-lg border border-border bg-background p-4 my-3">
      <div className="text-sm font-medium text-foreground">{spec.title}</div>
      <div className="mt-3 flex items-baseline gap-2">
        <div className="text-3xl font-semibold tracking-normal text-foreground">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function formatSingleValue(value: number, format?: "number" | "currency" | "percent", currency = "$"): string {
  if (format === "currency") return `${currency}${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (format === "percent") return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  return value.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 });
}

interface MarkdownContentProps {
  content: string;
  onCitationClick?: (agentId: string, queryIndex: number) => void;
  activeCitation?: string | null;
  /** Subagent data for citation badge hover tooltips */
  subagents?: SubagentInfo[];
  /** Render action buttons below each successfully parsed chart block */
  renderChartActions?: (spec: ChartSpec) => React.ReactNode;
  /** Render action buttons below each markdown table */
  renderTableActions?: (data: Record<string, unknown>[], title: string) => React.ReactNode;
  /** Lookup map for [[EntityName]] links (key = lowercase name) */
  entityLookup?: Map<string, DetectableEntity>;
  /** Click handler for [[EntityName]] links */
  onEntityClick?: (entity: DetectableEntity) => void;
  /** Optional prefix for heading IDs to avoid collisions in page-wide DOM */
  headingIdPrefix?: string;
}

export function MarkdownContent({ content, onCitationClick, activeCitation, subagents, renderChartActions, renderTableActions, entityLookup, onEntityClick, headingIdPrefix }: MarkdownContentProps) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const headings = extractMarkdownHeadings(content);
  let headingIdx = 0;

  const citationOpts: ParseInlineOptions | undefined =
    (onCitationClick || entityLookup)
      ? { onCitationClick, activeCitation, subagents, entityLookup, onEntityClick }
      : undefined;

  // Track whether the last element pushed was a table, so we can
  // wrap it in an accordion when a chart immediately follows.
  let lastElementIsTable = false;
  let lastHeading = "";

  while (i < lines.length) {
    const line = lines[i];

    // Chart block: ```chart ... ```
    if (line.trim() === "```chart") {
      i++;
      const jsonLines: string[] = [];
      let closedFence = false;
      while (i < lines.length) {
        if (lines[i].trim() === "```") {
          closedFence = true;
          i++; // skip closing ```
          break;
        }
        jsonLines.push(lines[i]);
        i++;
      }

      // Still streaming — block not closed yet, skip entirely
      if (!closedFence) {
        continue;
      }

      const jsonStr = jsonLines.join("\n");
      let chartNode: React.ReactNode = null;
      try {
        const spec = JSON.parse(jsonStr) as ChartSpec;
        if (spec.type && spec.data) {
          chartNode = (
            <InlineChart
              key={key++}
              initialSpec={spec}
              renderActions={renderChartActions}
            />
          );
        } else {
          throw new Error("Missing required fields");
        }
      } catch {
        chartNode = (
          <div
            key={key++}
            className="my-3 p-3 border border-amber-200 bg-amber-50 rounded-md"
          >
            <p className="text-xs text-amber-700">
              Chart could not be rendered
            </p>
          </div>
        );
      }

      // If the previous element was a table, wrap it in an accordion
      if (lastElementIsTable && elements.length > 0) {
        const tableNode = elements.pop();
        elements.push(
          <div key={key++} className="my-8">
            {chartNode}
            <TableAccordion>{tableNode}</TableAccordion>
          </div>
        );
      } else {
        elements.push(
          <div key={key++} className="my-8">{chartNode}</div>
        );
      }

      lastElementIsTable = false;
      continue;
    }

    // Generic code fence skip (non-chart)
    if (line.trim().startsWith("```")) {
      i++;
      while (i < lines.length && lines[i].trim() !== "```") {
        i++;
      }
      i++; // skip closing ```
      lastElementIsTable = false;
      continue;
    }

    // Table detection
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      lines[i + 1]?.match(/^\|[-|:\s]+\|$/)
    ) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<MarkdownTable key={key++} lines={tableLines} citationOpts={citationOpts} title={lastHeading || undefined} renderActions={renderTableActions} />);
      lastElementIsTable = true;
      continue;
    }

    // Headers (longest prefix first so ### doesn't match ##)
    if (line.startsWith("### ")) {
      lastHeading = line.slice(4).trim();
      const heading = headings[headingIdx++];
      const id = headingIdPrefix ? `${headingIdPrefix}-${heading?.id}` : heading?.id;
      elements.push(
        <h3 key={key++} id={id} data-report-heading="true" className="text-sm font-semibold mt-4 mb-2 scroll-mt-8">
          {parseInline(line.slice(4), citationOpts)}
        </h3>
      );
      i++;
      lastElementIsTable = false;
      continue;
    }
    if (line.startsWith("## ")) {
      lastHeading = line.slice(3).trim();
      const heading = headings[headingIdx++];
      const id = headingIdPrefix ? `${headingIdPrefix}-${heading?.id}` : heading?.id;
      elements.push(
        <h2 key={key++} id={id} data-report-heading="true" className="text-base font-semibold mt-4 mb-2 scroll-mt-8">
          {parseInline(line.slice(3), citationOpts)}
        </h2>
      );
      i++;
      lastElementIsTable = false;
      continue;
    }
    if (line.startsWith("# ")) {
      lastHeading = line.slice(2).trim();
      const heading = headings[headingIdx++];
      const id = headingIdPrefix ? `${headingIdPrefix}-${heading?.id}` : heading?.id;
      elements.push(
        <h1 key={key++} id={id} data-report-heading="true" className="text-lg font-semibold mt-5 mb-3 scroll-mt-8">
          {parseInline(line.slice(2), citationOpts)}
        </h1>
      );
      i++;
      lastElementIsTable = false;
      continue;
    }

    // Alert/callout (lines starting with >)
    if (line.startsWith("> ")) {
      const alertLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        alertLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <div
          key={key++}
          className="border-l-4 border-l-amber-400 bg-amber-50 px-3 py-2 my-3 rounded-r-md"
        >
          {alertLines.map((l, idx) => (
            <p key={idx} className="text-xs text-amber-900">
              {parseInline(l, citationOpts)}
            </p>
          ))}
        </div>
      );
      lastElementIsTable = false;
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={key++} className="list-decimal pl-5 space-y-1 my-2">
          {items.map((item, idx) => (
            <li key={idx}>{parseInline(item, citationOpts)}</li>
          ))}
        </ol>
      );
      lastElementIsTable = false;
      continue;
    }

    // Unordered list (- or *)
    if (line.match(/^[\-\*]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[\-\*]\s/)) {
        items.push(lines[i].replace(/^[\-\*]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={key++} className="list-disc pl-5 space-y-1 my-2">
          {items.map((item, idx) => (
            <li key={idx}>{parseInline(item, citationOpts)}</li>
          ))}
        </ul>
      );
      lastElementIsTable = false;
      continue;
    }

    // Empty line — don't reset lastElementIsTable so a chart
    // separated from its table by a blank line still collapses it
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={key++} className="my-1.5">
        {parseInline(line, citationOpts)}
      </p>
    );
    i++;
    lastElementIsTable = false;
  }

  return <>{elements}</>;
}

// ── Accordion for tables that have a chart ──

function TableAccordion({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="my-1 border border-border/60 rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[9.9px] text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <ChevronRight
          className={`w-3 h-3 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        View underlying data
      </button>
      {open && <div className="px-1 pb-2">{children}</div>}
    </div>
  );
}

// ── Citation hover tooltip ──

function CitationBadge({
  citationKey,
  isActive,
  onClick,
}: {
  citationKey: string;
  isActive: boolean;
  agentName?: string;
  query?: { description: string; sql: string; rowCount?: number; executionTimeMs?: number };
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-mono font-medium transition-colors cursor-pointer align-baseline ${
        isActive
          ? "bg-foreground/15 text-foreground ring-1 ring-foreground/20"
          : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
      }`}
    >
      {citationKey}
    </button>
  );
}


// ── Inline formatting ──

interface ParseInlineOptions {
  onCitationClick?: (agentId: string, queryIndex: number) => void;
  activeCitation?: string | null;
  subagents?: SubagentInfo[];
  entityLookup?: Map<string, DetectableEntity>;
  onEntityClick?: (entity: DetectableEntity) => void;
}

export function parseInline(text: string, opts?: ParseInlineOptions): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Match bold, inline code, internal markdown links, citation markers [agent-id:Q#], and entity links [[Name]]
  const regex = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((\/[^)\s]+)\)|\[([a-z][\w-]*):Q(\d+)\]|\[\[([^\]]+)\]\]/g;
  let lastIdx = 0;
  let match;
  let k = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    if (match[1]) {
      parts.push(
        <strong key={k++} className="font-semibold">
          {match[1]}
        </strong>
      );
    } else if (match[2]) {
      parts.push(
        <code
          key={k++}
          className="px-1 py-0.5 rounded bg-muted font-mono text-[0.85em]"
        >
          {match[2]}
        </code>
      );
    } else if (match[3] && match[4]) {
      parts.push(
        <a
          key={k++}
          href={match[4]}
          className="font-semibold text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground"
        >
          {match[3]}
        </a>
      );
    } else if (match[5] && match[6]) {
      // Citation marker: [agent-id:Q#]
      const agentId = match[5];
      const queryIdx = parseInt(match[6], 10);
      const citationKey = `${agentId}:Q${queryIdx}`;
      const isActive = opts?.activeCitation === citationKey;

      // Look up query data from subagents — only show citation if query has real SQL
      const subagent = opts?.subagents?.find((s) => s.id === agentId);
      const query = subagent?.queries?.[queryIdx - 1]; // Q1 = index 0

      if (query?.sql) {
        parts.push(
          <CitationBadge
            key={k++}
            citationKey={citationKey}
            isActive={isActive}
            agentName={subagent?.name}
            query={query}
            onClick={() => opts?.onCitationClick?.(agentId, queryIdx)}
          />
        );
      }
      // No SQL → silently drop the citation marker from rendered text
    } else if (match[7]) {
      // Entity link: [[EntityName]]
      const entityName = match[7];
      const entity = opts?.entityLookup?.get(entityName.toLowerCase());
      if (entity && opts?.onEntityClick) {
        parts.push(
          <button
            key={k++}
            onClick={(e) => {
              e.stopPropagation();
              opts.onEntityClick!(entity);
            }}
            className="inline font-semibold text-foreground border-b border-dotted border-foreground/40 hover:border-foreground/70 transition-colors cursor-pointer"
          >
            {entityName}
          </button>
        );
      } else {
        // Fallback: render as bold if entity not found
        parts.push(
          <strong key={k++} className="font-semibold">
            {entityName}
          </strong>
        );
      }
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

// ── Table ──

function isNumericish(val: string): boolean {
  // Matches numbers, currency ($1,234), percentages (12.5%), negative, etc.
  return /^[\s$-]*[\d,]+\.?\d*\s*[%KMBkmb]?\s*$/.test(val.trim());
}

function MarkdownTable({ lines, citationOpts, title, renderActions }: { lines: string[]; citationOpts?: ParseInlineOptions; title?: string; renderActions?: (data: Record<string, unknown>[], title: string) => React.ReactNode }) {
  const [dataView, setDataView] = useState<DataView>("chart");

  const parseRow = (line: string) => {
    const cells: string[] = [];
    let cell = "";
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === "\\" && line[i + 1] === "|") {
        cell += "|";
        i++;
        continue;
      }
      if (char === "|") {
        cells.push(cell.trim());
        cell = "";
        continue;
      }
      cell += char;
    }
    cells.push(cell.trim());
    if (cells[0] === "") cells.shift();
    if (cells[cells.length - 1] === "") cells.pop();
    return cells;
  };
  const stripMd = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1").trim();

  const headers = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);

  // Detect which columns are numeric (right-align them) — first column always left-aligned as row label
  const numericCols = headers.map((_, ci) => {
    if (ci === 0) return false;
    if (rows.length === 0) return false;
    const nonEmpty = rows.filter((r) => r[ci]?.trim());
    if (nonEmpty.length === 0) return false;
    return nonEmpty.every((r) => isNumericish(r[ci] ?? ""));
  });

  // Structured data for ChartDataTable and export
  const structuredData: Record<string, unknown>[] = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, ci) => {
      const raw = stripMd(row[ci]?.trim() ?? "");
      const num = Number(raw.replace(/[,%$₹]/g, ""));
      obj[stripMd(h)] = !isNaN(num) && raw !== "" ? num : raw;
    });
    return obj;
  });

  const displayTitle = title || stripMd(headers[0]) || "Table";

  return (
    <div className="my-5 overflow-hidden bg-card border border-border/50 rounded-xl">
      {/* Header — mirrors ChartShell layout */}
      <div className="px-5 pt-4 pb-2 shrink-0 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground truncate">{displayTitle}</p>
        <div className="flex items-center gap-1 shrink-0">
          {renderActions?.(structuredData, displayTitle)}
          <DataActionsDropdown active={dataView} onChange={setDataView} hasSql={false} />
        </div>
      </div>

      {/* Content */}
      {dataView === "export" ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <p className="text-xs text-muted-foreground tabular-nums">
            Download as CSV ({rows.length} rows)
          </p>
          <button
            type="button"
            className="flex items-center gap-2 px-4 py-2 min-h-[36px] text-xs font-medium bg-foreground text-background rounded-md transition-opacity duration-150 ease-out motion-reduce:transition-none cursor-pointer active:scale-[0.97] hover:opacity-90"
            onClick={() => {
              const filename = `${displayTitle.replace(/[^a-zA-Z0-9]/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
              downloadCSV(structuredData, filename);
              setDataView("chart");
            }}
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Download CSV
          </button>
        </div>
      ) : dataView === "data" ? (
        <ChartDataTable data={structuredData} pageSize={20} />
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              {headers.map((h, i) => (
                <th
                  key={i}
                  className={`py-3 px-4 font-normal text-muted-foreground ${
                    numericCols[i] ? "text-right" : "text-left"
                  }`}
                >
                  {parseInline(h, citationOpts)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className={`border-b border-border/40 ${
                  ri % 2 === 0 ? "bg-muted/30" : ""
                }`}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`py-3 px-4 ${
                      ci === 0 ? "font-medium" : ""
                    } ${numericCols[ci] ? "text-right tabular-nums" : ""}`}
                  >
                    {parseInline(cell, citationOpts)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
