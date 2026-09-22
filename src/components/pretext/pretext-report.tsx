"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { AlignLeft, AlignRight, Maximize2 } from "lucide-react";
import { UnifiedChart } from "@/components/chart/unified-chart";
import type { ChartSpec } from "@/lib/chart-types";

type FloatPosition = "right" | "left" | "full";

// ── Types ──

type LayoutMode = "magazine" | "two-column";

interface BlockBase {
  type: string;
  key: number;
}

interface TextBlock extends BlockBase {
  type: "text";
  rawText: string;
  tag: "p" | "h1" | "h2" | "h3";
}

interface ChartBlock extends BlockBase {
  type: "chart";
  spec: ChartSpec;
}

interface TableBlock extends BlockBase {
  type: "table";
  headers: string[];
  rows: string[][];
}

interface ListGroupBlock extends BlockBase {
  type: "list-group";
  listType: "ul" | "ol";
  items: string[];
}

type Block = TextBlock | ChartBlock | TableBlock | ListGroupBlock;

// ── Markdown → Block parser ──

function parseMarkdownToBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "```chart") {
      i++;
      const jsonLines: string[] = [];
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim() === "```") {
          closed = true;
          i++;
          break;
        }
        jsonLines.push(lines[i]);
        i++;
      }
      if (closed) {
        try {
          const spec = JSON.parse(jsonLines.join("\n")) as ChartSpec;
          if (spec.type && spec.data) {
            blocks.push({ type: "chart", spec, key: key++ });
          }
        } catch {
          // skip invalid chart
        }
      }
      continue;
    }

    if (line.trim().startsWith("```")) {
      i++;
      while (i < lines.length && lines[i].trim() !== "```") i++;
      i++;
      continue;
    }

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
      const parseRow = (l: string) =>
        l.split("|").map((c) => c.trim()).filter(Boolean);
      const headers = parseRow(tableLines[0]);
      const rows = tableLines.slice(2).map(parseRow);
      blocks.push({ type: "table", headers, rows, key: key++ });
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push({ type: "text", rawText: line.slice(4).trim(), tag: "h3", key: key++ });
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ type: "text", rawText: line.slice(3).trim(), tag: "h2", key: key++ });
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({ type: "text", rawText: line.slice(2).trim(), tag: "h1", key: key++ });
      i++;
      continue;
    }

    if (line.match(/^[-*]\s/) || line.match(/^\d+\.\s/)) {
      const isOrdered = !!line.match(/^\d+\.\s/);
      const items: string[] = [];
      const pattern = isOrdered ? /^\d+\.\s/ : /^[-*]\s/;
      while (i < lines.length && lines[i].match(pattern)) {
        items.push(lines[i].replace(pattern, "").trim());
        i++;
      }
      blocks.push({ type: "list-group", listType: isOrdered ? "ol" : "ul", items, key: key++ });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (line.startsWith("> ")) {
      blocks.push({ type: "text", rawText: line.slice(2).trim(), tag: "p", key: key++ });
      i++;
      continue;
    }

    blocks.push({ type: "text", rawText: line.trim(), tag: "p", key: key++ });
    i++;
  }

  return blocks;
}

// ── Inline markdown renderer ──

function InlineMarkdown({ text }: { text: string }) {
  const cleaned = text
    .replace(/\[([a-z][\w-]*):Q(\d+)\]/g, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .trim();

  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match;
  let k = 0;

  while ((match = regex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      parts.push(cleaned.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={k++}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(
        <code key={k++} className="px-1 py-0.5 bg-muted rounded text-[0.9em] font-mono">
          {match[3]}
        </code>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < cleaned.length) {
    parts.push(cleaned.slice(lastIndex));
  }

  return <>{parts.length > 0 ? parts : cleaned}</>;
}

// ── Reorder blocks for CSS float rendering ──

// ── Reorder blocks for CSS float rendering ──

function reorderForFloats(blocks: Block[]): { ordered: Block[]; floatKeys: Set<number> } {
  const result: Block[] = [];
  const emitted = new Set<number>();
  const floatKeys = new Set<number>();

  for (let i = 0; i < blocks.length; i++) {
    if (emitted.has(blocks[i].key)) continue;

    const block = blocks[i];

    // For paragraphs and lists, look ahead for charts/tables to pull before.
    // Skip past other text/list blocks — stop at headings (section boundary).
    if (
      (block.type === "text" && block.tag === "p") ||
      block.type === "list-group"
    ) {
      for (let j = i + 1; j < blocks.length; j++) {
        const ahead = blocks[j];
        if (ahead.type === "text" && (ahead as TextBlock).tag.startsWith("h")) break;
        if ((ahead.type === "chart" || ahead.type === "table") && !emitted.has(ahead.key)) {
          result.push(ahead);
          emitted.add(ahead.key);
          floatKeys.add(ahead.key);
        }
      }
    }

    result.push(block);
    emitted.add(block.key);
  }

  return { ordered: result, floatKeys };
}

// ── Resize drag handle ──

function ResizeHandle({
  onResizeStart,
  side = "right",
}: {
  onResizeStart: (e: React.MouseEvent) => void;
  side?: "right" | "left";
}) {
  // For right-floated: handle on left edge. For left-floated: handle on right edge.
  const isLeft = side === "right";
  return (
    <div
      onMouseDown={onResizeStart}
      className={`absolute top-0 bottom-0 w-2 cursor-col-resize z-10 group/handle ${isLeft ? "left-0" : "right-0"}`}
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
      <div className={`absolute top-1/2 -translate-y-1/2 w-0.5 h-8 rounded-full bg-foreground/0 group-hover/handle:bg-foreground/20 transition-colors ${isLeft ? "left-0.5" : "right-0.5"}`} />
    </div>
  );
}

// ── Float position toggle ──

function FloatPositionToggle({
  position,
  onChange,
}: {
  position: FloatPosition;
  onChange: (pos: FloatPosition) => void;
}) {
  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-md bg-background/80 backdrop-blur-sm border border-border/50 p-0.5 opacity-0 group-hover/float:opacity-100 transition-opacity">
      <button
        onClick={() => onChange("left")}
        className={`p-1 rounded ${position === "left" ? "bg-muted" : "hover:bg-muted/50"}`}
        title="Float left"
      >
        <AlignLeft className="w-3 h-3" />
      </button>
      <button
        onClick={() => onChange("full")}
        className={`p-1 rounded ${position === "full" ? "bg-muted" : "hover:bg-muted/50"}`}
        title="Full width"
      >
        <Maximize2 className="w-3 h-3" />
      </button>
      <button
        onClick={() => onChange("right")}
        className={`p-1 rounded ${position === "right" ? "bg-muted" : "hover:bg-muted/50"}`}
        title="Float right"
      >
        <AlignRight className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Block renderers ──

function RenderTextBlock({ block }: { block: TextBlock }) {
  const Tag = block.tag;
  const styles: Record<string, string> = {
    h1: "text-[25.2px] font-bold leading-[1.3] mt-8 mb-3 clear-both",
    h2: "text-[19.8px] font-semibold leading-[1.3] mt-10 mb-3 clear-both",
    h3: "text-[16.2px] font-semibold leading-[1.3] mt-6 mb-2",
    p: "text-base leading-[1.65] mb-4",
  };
  return (
    <Tag className={styles[block.tag]}>
      <InlineMarkdown text={block.rawText} />
    </Tag>
  );
}

function floatClassName(pos: FloatPosition): string {
  if (pos === "right") return "float-right ml-6 mb-4 clear-right";
  if (pos === "left") return "float-left mr-6 mb-4 clear-left";
  return "mb-6 clear-both"; // full width
}

function RenderChartBlock({
  block,
  float,
  widthPercent,
  position,
  onResizeStart,
  onPositionChange,
}: {
  block: ChartBlock;
  float: boolean;
  widthPercent: number;
  position: FloatPosition;
  onResizeStart?: (e: React.MouseEvent) => void;
  onPositionChange?: (pos: FloatPosition) => void;
}) {
  const isFloating = float && position !== "full";
  return (
    <div
      className={`relative group/float ${float ? floatClassName(position) : "mb-6"}`}
      style={isFloating ? { width: `${widthPercent}%` } : undefined}
    >
      <UnifiedChart spec={block.spec} variant="compact" />
      {float && onPositionChange && (
        <FloatPositionToggle position={position} onChange={onPositionChange} />
      )}
      {isFloating && onResizeStart && (
        <ResizeHandle onResizeStart={onResizeStart} side={position} />
      )}
    </div>
  );
}

function RenderTableBlock({
  block,
  float,
  widthPercent,
  position,
  onResizeStart,
  onPositionChange,
}: {
  block: TableBlock;
  float: boolean;
  widthPercent: number;
  position: FloatPosition;
  onResizeStart?: (e: React.MouseEvent) => void;
  onPositionChange?: (pos: FloatPosition) => void;
}) {
  const isFloating = float && position !== "full";
  return (
    <div
      className={`rounded-xl border border-border/50 bg-card overflow-hidden relative group/float ${
        float ? floatClassName(position) : "mb-6"
      }`}
      style={isFloating ? { width: `${widthPercent}%` } : undefined}
    >
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            {block.headers.map((h, i) => (
              <th key={i} className="py-2.5 px-3 font-normal text-muted-foreground text-left text-xs">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/30 last:border-0">
              {row.map((cell, ci) => (
                <td key={ci} className="py-2 px-3 text-xs">
                  <InlineMarkdown text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {float && onPositionChange && (
        <FloatPositionToggle position={position} onChange={onPositionChange} />
      )}
      {isFloating && onResizeStart && (
        <ResizeHandle onResizeStart={onResizeStart} side={position} />
      )}
    </div>
  );
}

function RenderListGroupBlock({ block }: { block: ListGroupBlock }) {
  const Tag = block.listType === "ol" ? "ol" : "ul";
  return (
    <Tag
      className={`${
        block.listType === "ol" ? "list-decimal" : "list-disc"
      } pl-6 space-y-1 mb-4 text-base leading-[1.65]`}
    >
      {block.items.map((text, i) => (
        <li key={i}>
          <InlineMarkdown text={text} />
        </li>
      ))}
    </Tag>
  );
}

// ── Two-column layout ──

function TwoColumnLayout({
  blocks,
  widths,
  onResizeStart,
}: {
  blocks: Block[];
  widths?: Record<number, number>;
  onResizeStart?: (e: React.MouseEvent, blockKey: number) => void;
}) {
  const textBlocks: Block[] = [];
  const asideBlocks: Block[] = [];
  const noOp = useCallback(() => {}, []);
  const noOpPos = useCallback(() => {}, []);
  const resolvedWidths = widths ?? {};
  const resolvedResize = onResizeStart ?? noOp;

  for (const block of blocks) {
    if (block.type === "chart" || block.type === "table") {
      asideBlocks.push(block);
    } else {
      textBlocks.push(block);
    }
  }

  return (
    <div className="grid gap-8" style={{ gridTemplateColumns: "55% 1fr" }}>
      <div>
        {textBlocks.map((block) => (
          <RenderBlock key={block.key} block={block} float={false} widths={resolvedWidths} positions={{}} onResizeStart={resolvedResize} onPositionChange={noOpPos} />
        ))}
      </div>
      <div className="space-y-6">
        {asideBlocks.map((block) => (
          <RenderBlock key={block.key} block={block} float={false} widths={resolvedWidths} positions={{}} onResizeStart={resolvedResize} onPositionChange={noOpPos} />
        ))}
      </div>
    </div>
  );
}

// ── Generic block renderer ──

function RenderBlock({
  block,
  float,
  widths,
  positions,
  onResizeStart,
  onPositionChange,
}: {
  block: Block;
  float: boolean;
  widths: Record<number, number>;
  positions: Record<number, FloatPosition>;
  onResizeStart: (e: React.MouseEvent, blockKey: number) => void;
  onPositionChange: (blockKey: number, pos: FloatPosition) => void;
}) {
  const pos = positions[block.key] ?? "right";
  const width = widths[block.key] ?? 42;

  if (block.type === "text") return <RenderTextBlock block={block} />;
  if (block.type === "chart") {
    return (
      <RenderChartBlock
        block={block}
        float={float}
        widthPercent={width}
        position={pos}
        onResizeStart={float ? (e) => onResizeStart(e, block.key) : undefined}
        onPositionChange={float ? (p) => onPositionChange(block.key, p) : undefined}
      />
    );
  }
  if (block.type === "table") {
    return (
      <RenderTableBlock
        block={block}
        float={float}
        widthPercent={width}
        position={pos}
        onResizeStart={float ? (e) => onResizeStart(e, block.key) : undefined}
        onPositionChange={float ? (p) => onPositionChange(block.key, p) : undefined}
      />
    );
  }
  if (block.type === "list-group") return <RenderListGroupBlock block={block} />;
  return null;
}

// ── Main component ──

interface PretextReportProps {
  content: string;
  className?: string;
  /** Hide the layout mode toggle */
  hideControls?: boolean;
}

export function PretextReport({ content, className, hideControls }: PretextReportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<LayoutMode>("magazine");
  const [floatWidths, setFloatWidths] = useState<Record<number, number>>({});
  const [floatPositions, setFloatPositions] = useState<Record<number, FloatPosition>>({});

  const blocks = useMemo(() => parseMarkdownToBlocks(content), [content]);
  const { ordered: orderedBlocks, floatKeys } = useMemo(
    () =>
      mode === "magazine"
        ? reorderForFloats(blocks)
        : { ordered: blocks, floatKeys: new Set<number>() },
    [blocks, mode]
  );

  const handlePositionChange = useCallback((blockKey: number, pos: FloatPosition) => {
    setFloatPositions((prev) => ({ ...prev, [blockKey]: pos }));
  }, []);

  // Drag-to-resize float elements
  const handleResizeStart = useCallback((e: React.MouseEvent, blockKey: number) => {
    e.preventDefault();
    const startX = e.clientX;
    const containerW = containerRef.current?.clientWidth ?? 1;
    const currentPercent = floatWidths[blockKey] ?? 42;
    const startPx = (currentPercent / 100) * containerW;
    const pos = floatPositions[blockKey] ?? "right";

    const onMove = (ev: MouseEvent) => {
      // Right float: drag left = wider. Left float: drag right = wider.
      const delta = pos === "right" ? startX - ev.clientX : ev.clientX - startX;
      const newPx = Math.min(containerW * 0.7, Math.max(containerW * 0.25, startPx + delta));
      setFloatWidths((prev) => ({ ...prev, [blockKey]: (newPx / containerW) * 100 }));
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [floatWidths, floatPositions]);

  return (
    <div className={className} ref={containerRef}>
      {/* Mode toggle */}
      {!hideControls && (
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs text-muted-foreground font-medium">Layout:</span>
          <button
            onClick={() => setMode("magazine")}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === "magazine"
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            Magazine
          </button>
          <button
            onClick={() => setMode("two-column")}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === "two-column"
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            Two Column
          </button>
        </div>
      )}

      {/* Content */}
      {mode === "two-column" ? (
        <TwoColumnLayout blocks={blocks} widths={floatWidths} onResizeStart={handleResizeStart} />
      ) : (
        <div>
          {orderedBlocks.map((block) => (
            <RenderBlock
              key={block.key}
              block={block}
              float={floatKeys.has(block.key)}
              widths={floatWidths}
              positions={floatPositions}
              onResizeStart={handleResizeStart}
              onPositionChange={handlePositionChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
