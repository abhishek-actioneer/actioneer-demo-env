"use client";

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Search, CircleDot, Circle, Plus, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RowContextMenu } from "./row-context-menu";
import type { ForecastModel, ForecastRow, ResolvedTable, ResolvedCell, CellFormat, ResolvedColumn } from "@/lib/forecast-types";
import { getAllMetrics } from "@/lib/metric-store";
import { useDataset } from "@/lib/dataset-context";
import type { Metric } from "@/lib/metric-types";

interface ForecastTableProps {
  model: ForecastModel;
  resolved: ResolvedTable;
  onModelChange: React.Dispatch<React.SetStateAction<ForecastModel>>;
  onInspectRow: (rowId: string) => void;
  loadingRows?: Set<string>;
}

function formatCell(cell: ResolvedCell | undefined, format: CellFormat): string {
  if (!cell || cell.error) return cell?.error ?? "—";
  if (cell.value === null) return "—";
  const v = cell.value;
  const neg = v < 0;
  const abs = Math.abs(v);
  switch (format) {
    case "currency": {
      const formatted = abs >= 1000 ? `$${(abs / 1000).toFixed(0)}k` : `$${abs.toLocaleString()}`;
      return neg ? `(${formatted})` : formatted;
    }
    case "percent":
      return neg ? `(${abs.toFixed(1)}%)` : `${v.toFixed(1)}%`;
    case "number":
      return neg ? `(${abs.toLocaleString()})` : v.toLocaleString();
  }
}

/** Compact formula display — strips braces, truncates */
function formulaDisplay(row: ForecastRow): string | null {
  if (row.type !== "derived") return null;
  // Replace {Metric Name} with just the name
  return row.formula.replace(/\{([^}]+)\}/g, "$1");
}

/* ── Formula Cell (inline-editable) ───────────────────────── */

function FormulaCell({
  row, formulaWidth, formulaText, onFormulaEdit,
}: {
  row: ForecastRow;
  formulaWidth: number;
  formulaText: string | null;
  onFormulaEdit?: (rowId: string, formula: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    if (row.type === "derived") {
      setDraft(row.formula);
      setEditing(true);
    }
  };

  const commit = () => {
    setEditing(false);
    if (draft.trim() && onFormulaEdit) {
      onFormulaEdit(row.id, draft.trim());
    }
  };

  const cancel = () => {
    setEditing(false);
  };

  return (
    <td
      className="px-2 overflow-hidden"
      style={{
        height: 40,
        width: formulaWidth,
        minWidth: 60,
        fontSize: 9.9,
        fontFamily: "var(--font-geist-mono)",
        color: "var(--fc-text-secondary)",
        verticalAlign: "middle",
        cursor: row.type === "derived" ? "text" : undefined,
      }}
      onClick={!editing ? startEdit : undefined}
    >
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          className="w-full bg-transparent outline-none"
          style={{
            fontSize: 9.9,
            fontFamily: "var(--font-geist-mono)",
            color: "var(--fc-text-primary)",
          }}
        />
      ) : (
        formulaText ? (
          <span
            className="inline-block max-w-full truncate whitespace-nowrap"
            title={row.type === "derived" ? row.formula : undefined}
          >
            = {formulaText}
          </span>
        ) : null
      )}
    </td>
  );
}

/* ── Inline Metric Label (editable + autocomplete) ────────── */

function MetricLabelCell({
  row, isTopLevel, onRename,
}: {
  row: ForecastRow;
  isTopLevel: boolean;
  onRename: (rowId: string, label: string, metricId?: string) => void;
}) {
  const { datasetId } = useDataset();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<Metric[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(row.label);
    setSuggestions([]);
    setSelectedIdx(-1);
    setEditing(true);
  };

  const commit = (label?: string, metricId?: string) => {
    setEditing(false);
    setSuggestions([]);
    const finalLabel = (label ?? draft).trim();
    if (finalLabel && finalLabel !== row.label) {
      onRename(row.id, finalLabel, metricId);
    }
  };

  const cancel = () => {
    setEditing(false);
    setSuggestions([]);
  };

  const handleChange = (value: string) => {
    setDraft(value);
    setSelectedIdx(-1);
    if (value.trim().length > 0) {
      const q = value.toLowerCase();
      const matches = getAllMetrics(datasetId)
        .filter((m) => m.name.toLowerCase().includes(q))
        .slice(0, 6);
      setSuggestions(matches);
    } else {
      setSuggestions([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { cancel(); return; }
    if (e.key === "Enter") {
      if (selectedIdx >= 0 && suggestions[selectedIdx]) {
        const m = suggestions[selectedIdx];
        commit(m.name, m.id);
      } else {
        commit();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, -1));
      return;
    }
  };

  // Position the portal dropdown relative to the input
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (editing && suggestions.length > 0 && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    } else {
      setDropdownPos(null);
    }
  }, [editing, suggestions]);

  if (editing) {
    return (
      <div ref={wrapperRef} className="relative flex-1 min-w-0">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => {
            // Delay to allow click on suggestion
            setTimeout(() => {
              if (editing) commit();
            }, 150);
          }}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent outline-none"
          style={{
            fontSize: 11.7, fontWeight: isTopLevel ? 600 : 400,
            color: "var(--fc-text-primary)",
            caretColor: "var(--fc-accent)",
          }}
        />
        {suggestions.length > 0 && dropdownPos && createPortal(
          <div
            ref={listRef}
            className="fixed rounded-md py-1 shadow-lg"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              zIndex: 9999,
              background: "var(--fc-surface)",
              border: "1px solid var(--fc-border)",
              minWidth: 220,
              maxWidth: 300,
            }}
          >
            <div className="px-2 py-1" style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", color: "var(--fc-text-tertiary)", textTransform: "uppercase" }}>
              Metric tree
            </div>
            {suggestions.map((m, i) => (
              <button
                key={m.id}
                className="w-full text-left px-2 py-1.5 flex items-center gap-2"
                style={{
                  fontSize: 10.8,
                  background: i === selectedIdx ? "var(--fc-surface-raised)" : "transparent",
                  color: "var(--fc-text-primary)",
                  transition: "background 60ms ease",
                }}
                onMouseEnter={() => setSelectedIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur
                  commit(m.name, m.id);
                }}
              >
                <span className="truncate">{m.name}</span>
                <span
                  className="shrink-0 rounded px-1 py-0.5"
                  style={{ fontSize: 9, background: "var(--fc-surface-raised)", color: "var(--fc-text-tertiary)" }}
                >
                  {m.category}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    );
  }

  return (
    <span
      className="whitespace-nowrap truncate"
      style={{
        fontSize: 11.7, fontWeight: isTopLevel ? 600 : 400,
        color: "var(--fc-text-primary)",
        cursor: "text",
      }}
      title={row.label}
      onDoubleClick={startEdit}
    >
      {row.label}
    </span>
  );
}

/* ── Sortable Row ─────────────────────────────────────────── */

interface SortableRowProps {
  row: ForecastRow;
  cells: Record<string, ResolvedCell> | undefined;
  columns: ResolvedColumn[];
  firstForecastKey: string | undefined;
  activeCell: { rowId: string; colKey: string } | null;
  editingCell: { rowId: string; colKey: string; value: string } | null;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  onCellClick: (rowId: string, colKey: string) => void;
  onCellDoubleClick: (rowId: string, colKey: string, currentValue: number | null) => void;
  onCellChange: (value: string) => void;
  onCellSave: () => void;
  onCellKeyDown: (e: React.KeyboardEvent) => void;
  onModelChange: React.Dispatch<React.SetStateAction<ForecastModel>>;
  onInspectRow: (rowId: string) => void;
  modelRows: ForecastRow[];
  metricWidth: number;
  formulaWidth: number;
  isDragOverlay?: boolean;
  onFormulaEdit?: (rowId: string, formula: string) => void;
  onRename?: (rowId: string, label: string, metricId?: string) => void;
  isLoading?: boolean;
}

function SortableRow({
  row, cells, columns, firstForecastKey,
  activeCell, editingCell, editInputRef,
  onCellClick, onCellDoubleClick, onCellChange, onCellSave, onCellKeyDown,
  onModelChange, onInspectRow, modelRows,
  metricWidth, formulaWidth,
  isDragOverlay, onFormulaEdit, onRename, isLoading,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    borderBottom: "1px solid var(--fc-border)",
    opacity: isDragging ? 0.4 : 1,
    ...(isDragOverlay ? {
      background: "var(--fc-surface)",
      boxShadow: "0 4px 16px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)",
      borderRadius: 6,
      border: "1px solid var(--fc-border-strong)",
      opacity: 1,
    } : {}),
  };

  const isTopLevel = row.indent === 0;
  const formulaText = formulaDisplay(row);

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="group"
      onMouseEnter={(e) => { if (!isDragOverlay) (e.currentTarget as HTMLElement).style.background = "var(--fc-surface-raised)"; }}
      onMouseLeave={(e) => { if (!isDragOverlay) (e.currentTarget as HTMLElement).style.background = ""; }}
    >
      {/* Sticky metric label */}
      <td
        className="sticky left-0 z-10"
        style={{
          background: "var(--fc-surface)",
          height: 40,
          width: metricWidth,
          minWidth: 120,
          paddingLeft: 8,
          paddingRight: 12,
          verticalAlign: "middle",
          willChange: "transform",
        }}
      >
        <div className="flex items-center gap-1">
          {/* Chart toggle — extreme left, always aligned regardless of indent */}
          <button
            className={`p-0.5 rounded shrink-0 ${row.showOnChart ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            style={{ transition: "opacity 80ms ease" }}
            onClick={() => {
              onModelChange((prev) => ({
                ...prev,
                rows: prev.rows.map((r) =>
                  r.id === row.id ? { ...r, showOnChart: !r.showOnChart } : r
                ),
              }));
            }}
            title={row.showOnChart ? "Hide from chart" : "Show on chart"}
          >
            {row.showOnChart
              ? <CircleDot className="w-3 h-3" style={{ color: "var(--fc-accent)" }} />
              : <Circle className="w-3 h-3" style={{ color: "var(--fc-text-tertiary)" }} />
            }
          </button>
          {/* Drag handle + context menu (unified) */}
          <RowContextMenu row={row} onModelChange={onModelChange} modelRows={modelRows}>
            <button
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing touch-none shrink-0"
              style={{ transition: "opacity 80ms ease", color: "var(--fc-text-tertiary)" }}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>
          </RowContextMenu>
          {/* Indent spacer — only affects label, not the toggle/handle */}
          {row.indent > 0 && <span style={{ width: row.indent * 20 }} className="shrink-0" />}
          <MetricLabelCell
            row={row}
            isTopLevel={isTopLevel}
            onRename={onRename ?? (() => {})}
          />
          {/* Inspect */}
          <button
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 shrink-0"
            style={{ transition: "opacity 80ms ease" }}
            onClick={() => onInspectRow(row.id)}
            title="Inspect metric"
          >
            <Search className="w-3 h-3" style={{ color: "var(--fc-text-tertiary)" }} />
          </button>
        </div>
      </td>

      {/* Formula / type column — click to edit */}
      <FormulaCell
        row={row}
        formulaWidth={formulaWidth}
        formulaText={formulaText}
        onFormulaEdit={onFormulaEdit}
      />

      {/* Data cells */}
      {columns.map((col) => {
        const cell = cells?.[col.key];
        const isActive = activeCell?.rowId === row.id && activeCell?.colKey === col.key;
        const isEditing = editingCell?.rowId === row.id && editingCell?.colKey === col.key;

        return (
          <td
            key={col.key}
            className="px-3 text-right cursor-pointer"
            style={{
              height: 40,
              color: col.isForecast ? "var(--fc-accent)" : "var(--fc-text-primary)",
              fontFamily: "var(--font-geist-mono)",
              fontSize: 11.7, fontVariantNumeric: "tabular-nums lining-nums",
              verticalAlign: "middle",
              boxShadow: isActive ? "inset 0 0 0 1.5px var(--fc-accent)" : undefined,
              borderLeft: col.key === firstForecastKey ? "2px solid var(--fc-accent)" : undefined,
            }}
            onClick={() => onCellClick(row.id, col.key)}
            onDoubleClick={() => onCellDoubleClick(row.id, col.key, cell?.value ?? null)}
          >
            {isEditing ? (
              <input
                ref={editInputRef}
                type="text"
                value={editingCell.value}
                onChange={(e) => onCellChange(e.target.value)}
                onBlur={onCellSave}
                onKeyDown={onCellKeyDown}
                className="w-full bg-transparent text-right outline-none"
                style={{ fontSize: 11.7, fontFamily: "var(--font-geist-mono)" }}
              />
            ) : isLoading && (!cell || cell.value === null) && !cell?.error ? (
              <span
                className="inline-block rounded animate-pulse"
                style={{ width: 48, height: 14, background: "var(--fc-surface-raised)" }}
              />
            ) : (
              <span className="relative inline-block w-full">
                {cell?.error ? (
                  <span style={{ color: "var(--fc-text-tertiary)", fontSize: 9.9, fontFamily: "var(--font-geist-mono)" }}>{cell.error}</span>
                ) : (
                  formatCell(cell, row.format)
                )}
                {cell?.isOverride && (
                  <button
                    className="absolute -top-0.5 -right-1.5 w-2.5 h-2.5 rounded-full flex items-center justify-center"
                    style={{ background: "var(--fc-accent)", cursor: "pointer" }}
                    title="Reset to calculated value"
                    onClick={(e) => {
                      e.stopPropagation();
                      onModelChange((prev) => ({
                        ...prev,
                        rows: prev.rows.map((r) => {
                          if (r.id !== row.id) return r;
                          const overrides = { ...r.overrides };
                          delete overrides[`week:${col.key}`];
                          return { ...r, overrides };
                        }),
                      }));
                    }}
                  />
                )}
              </span>
            )}
          </td>
        );
      })}

    </tr>
  );
}

/* ── Resize Handle ────────────────────────────────────────── */

function ResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const startXRef = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startXRef.current = e.clientX;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startXRef.current;
      startXRef.current = ev.clientX;
      onResize(delta);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }, [onResize]);

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20 opacity-0 hover:opacity-100"
      style={{ background: "var(--fc-border-strong)" }}
      onPointerDown={onPointerDown}
    />
  );
}

/* ── Main Table ───────────────────────────────────────────── */

export function ForecastTable({ model, resolved, onModelChange, onInspectRow, loadingRows }: ForecastTableProps) {
  const { datasetId } = useDataset();
  const [activeCell, setActiveCell] = useState<{ rowId: string; colKey: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; colKey: string; value: string } | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [metricWidth, setMetricWidth] = useState(280);
  const [formulaWidth, setFormulaWidth] = useState(180);
  const cancelledRef = useRef(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // distance: 5 means user must move 5px before drag starts — allows click for context menu
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const handleCellDoubleClick = (rowId: string, colKey: string, currentValue: number | null) => {
    setEditingCell({ rowId, colKey, value: currentValue?.toString() ?? "" });
  };

  const handleCellSave = () => {
    if (cancelledRef.current) { cancelledRef.current = false; return; }
    if (!editingCell) return;
    const numValue = parseFloat(editingCell.value);
    if (!isNaN(numValue)) {
      const overrideKey = `week:${editingCell.colKey}`;
      onModelChange((prev) => ({
        ...prev,
        rows: prev.rows.map((r) =>
          r.id === editingCell.rowId
            ? { ...r, overrides: { ...r.overrides, [overrideKey]: numValue } }
            : r
        ),
      }));
    }
    setEditingCell(null);
  };

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCellSave();
    if (e.key === "Escape") { cancelledRef.current = true; setEditingCell(null); }
  };

  const handleCellChange = useCallback((value: string) => {
    setEditingCell((prev) => prev ? { ...prev, value } : null);
  }, []);

  // Ref-based focus instead of autoFocus
  useEffect(() => {
    editInputRef.current?.focus();
  }, [editingCell?.rowId, editingCell?.colKey]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    onModelChange((prev) => {
      const oldIndex = prev.rows.findIndex((r) => r.id === active.id);
      const newIndex = prev.rows.findIndex((r) => r.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;

      const rows = [...prev.rows];
      const [moved] = rows.splice(oldIndex, 1);
      rows.splice(newIndex, 0, moved);
      return { ...prev, rows };
    });
  }, [onModelChange]);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  const handleFormulaEdit = useCallback((rowId: string, formula: string) => {
    onModelChange((prev) => ({
      ...prev,
      rows: prev.rows.map((r) => {
        if (r.id !== rowId) return r;
        // If editing a formula on a base row, convert it to derived
        return { ...r, type: "derived" as const, formula } as ForecastRow;
      }),
    }));
  }, [onModelChange]);

  const handleRename = useCallback((rowId: string, label: string, metricId?: string) => {
    onModelChange((prev) => ({
      ...prev,
      rows: prev.rows.map((r) => {
        if (r.id !== rowId) return r;
        const updates: Partial<ForecastRow> = { label };
        if (metricId) {
          // Link to metric tree — pull in source metadata
          const metric = getAllMetrics(datasetId).find((m) => m.id === metricId);
          if (metric) {
            updates.metricId = metricId;
            updates.sourceTable = metric.table;
            updates.sourceQuery = metric.sql;
          }
        }
        return { ...r, ...updates } as ForecastRow;
      }),
    }));
  }, [onModelChange, datasetId]);

  const firstForecastKey = resolved.columns.find((c) => c.isForecast)?.key;
  const dragRow = activeDragId ? model.rows.find((r) => r.id === activeDragId) : null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--fc-border)", background: "var(--fc-surface)" }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="overflow-x-auto fc-scroll">
          <table className="w-full border-collapse" tabIndex={0}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--fc-border)" }}>
                <th
                  className="sticky left-0 z-10 px-3 text-left relative"
                  style={{
                    background: "var(--fc-surface)", width: metricWidth, minWidth: 120, height: 36,
                    fontSize: 9.9, fontWeight: 500, letterSpacing: "0.04em",
                    color: "var(--fc-text-secondary)", fontFamily: "var(--font-geist-mono)",
                    willChange: "transform",
                  }}
                >
                  Metric
                  <ResizeHandle onResize={(d) => setMetricWidth((w) => Math.max(120, w + d))} />
                </th>
                <th
                  className="px-2 text-left relative"
                  style={{
                    height: 36, fontSize: 9.9, fontWeight: 500, letterSpacing: "0.04em",
                    color: "var(--fc-text-tertiary)", fontFamily: "var(--font-geist-mono)",
                    width: formulaWidth, minWidth: 60,
                  }}
                >
                  Formula
                  <ResizeHandle onResize={(d) => setFormulaWidth((w) => Math.max(60, w + d))} />
                </th>
                {resolved.columns.map((col) => (
                  <th
                    key={col.key}
                    className="px-3 text-right whitespace-nowrap"
                    style={{
                      height: 36, fontSize: 9.9, fontWeight: 500,
                      letterSpacing: "0.04em", minWidth: 100,
                      color: col.isForecast ? "var(--fc-accent)" : "var(--fc-text-secondary)",
                      fontFamily: "var(--font-geist-mono)",
                      borderLeft: col.key === firstForecastKey ? "2px solid var(--fc-accent)" : undefined,
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <SortableContext items={model.rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <tbody>
                {model.rows.map((row) => (
                  <SortableRow
                    key={row.id}
                    row={row}
                    cells={resolved.rows[row.id]}
                    columns={resolved.columns}
                    firstForecastKey={firstForecastKey}
                    activeCell={activeCell}
                    editingCell={editingCell}
                    editInputRef={editInputRef}
                    onCellClick={(rowId, colKey) => setActiveCell({ rowId, colKey })}
                    onCellDoubleClick={handleCellDoubleClick}
                    onCellChange={handleCellChange}
                    onCellSave={handleCellSave}
                    onCellKeyDown={handleCellKeyDown}
                    onModelChange={onModelChange}
                    onInspectRow={onInspectRow}
                    modelRows={model.rows}
                    metricWidth={metricWidth}
                    formulaWidth={formulaWidth}
                    onFormulaEdit={handleFormulaEdit}
                    onRename={handleRename}
                    isLoading={loadingRows?.has(row.id)}
                  />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </div>

        {/* Drag overlay — rendered outside the table for proper layering */}
        <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.25, 1, 0.5, 1)" }}>
          {dragRow ? (
            <table className="w-full border-collapse" style={{ background: "var(--fc-surface)" }}>
              <tbody>
                <SortableRow
                  row={dragRow}
                  cells={resolved.rows[dragRow.id]}
                  columns={resolved.columns}
                  firstForecastKey={firstForecastKey}
                  activeCell={null}
                  editingCell={null}
                  editInputRef={editInputRef}
                  onCellClick={() => {}}
                  onCellDoubleClick={() => {}}
                  onCellChange={() => {}}
                  onCellSave={() => {}}
                  onCellKeyDown={() => {}}
                  onModelChange={onModelChange}
                  onInspectRow={() => {}}
                  modelRows={model.rows}
                  metricWidth={metricWidth}
                  formulaWidth={formulaWidth}
                  isDragOverlay
                />
              </tbody>
            </table>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Add Metric button */}
      <div className="px-4 py-3" style={{ borderTop: "1px solid var(--fc-border)" }}>
        <button
          onClick={() => {
            onModelChange((prev) => ({
              ...prev,
              rows: [...prev.rows, {
                id: crypto.randomUUID(),
                label: `New Metric ${prev.rows.length + 1}`,
                type: "base" as const,
                indent: 0,
                format: "number" as const,
              }],
            }));
          }}
          className="flex items-center gap-1.5"
          style={{ fontSize: 11.7, color: "var(--fc-text-tertiary)", transition: "color 80ms ease" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--fc-text-primary)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--fc-text-tertiary)"; }}
        >
          <Plus className="w-4 h-4" /> Add Metric
        </button>
      </div>
    </div>
  );
}
