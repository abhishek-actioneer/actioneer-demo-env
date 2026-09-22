"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { ChartAnnotation } from "@/lib/chart-types";

export interface ChartAnnotationsProps {
  annotations: ChartAnnotation[];
  onAdd?: (annotation: ChartAnnotation) => void;
  onRemove?: (id: string) => void;
  readOnly?: boolean;
}

export function ChartAnnotationsEditor({ annotations, onAdd, onRemove, readOnly }: ChartAnnotationsProps) {
  const [adding, setAdding] = useState(false);
  const [xValue, setXValue] = useState("");
  const [label, setLabel] = useState("");

  const handleAdd = () => {
    if (!xValue.trim() || !label.trim() || !onAdd) return;
    onAdd({
      id: `ann-${Date.now()}`,
      x: xValue.trim(),
      label: label.trim(),
      type: "line",
    });
    setXValue("");
    setLabel("");
    setAdding(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
          Annotations
        </span>
        {!readOnly && onAdd && (
          <button
            type="button"
            aria-label={adding ? "Cancel adding annotation" : "Add annotation"}
            className="relative flex items-center gap-1 px-2 py-1 min-h-[28px] text-[9px] text-muted-foreground rounded transition-[color,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer hover:text-foreground hover:bg-muted/50 active:scale-[0.97]"
            onClick={() => setAdding(!adding)}
          >
            <Plus className="w-3 h-3" aria-hidden="true" />
            Add
          </button>
        )}
      </div>

      {adding && (
        <div className="flex items-center gap-2">
          <input
            className="flex-1 px-2 py-1.5 text-base bg-muted/50 border border-border rounded focus:outline-none focus:ring-1 focus:ring-border"
            placeholder="X value (date or label)"
            value={xValue}
            onChange={(e) => setXValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            aria-label="Annotation x-axis value"
          />
          <input
            className="flex-1 px-2 py-1.5 text-base bg-muted/50 border border-border rounded focus:outline-none focus:ring-1 focus:ring-border"
            placeholder="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            aria-label="Annotation label"
          />
          <button
            type="button"
            className="px-3 py-1.5 min-h-[32px] text-[9.9px] bg-foreground text-background rounded font-medium cursor-pointer active:scale-[0.97] transition-opacity duration-150 ease-out motion-reduce:transition-none hover:opacity-90"
            onClick={handleAdd}
          >
            Add
          </button>
        </div>
      )}

      {annotations.length === 0 && !adding && (
        <p className="text-[9px] text-muted-foreground/60">No annotations</p>
      )}

      {annotations.map((ann) => (
        <div
          key={ann.id}
          className="flex items-center justify-between px-2 py-1.5 rounded bg-muted/30 border border-border/40"
        >
          <div className="flex items-center gap-2 text-[9.9px]">
            <span className="text-muted-foreground tabular-nums">{String(ann.x)}</span>
            <span className="text-foreground">{ann.label}</span>
          </div>
          {!readOnly && onRemove && (
            <button
              type="button"
              aria-label={`Remove annotation: ${ann.label}`}
              className="relative p-1.5 min-w-[28px] min-h-[28px] flex items-center justify-center text-muted-foreground rounded transition-[color,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer hover:text-foreground hover:bg-muted/50 active:scale-[0.97]"
              onClick={() => onRemove(ann.id)}
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
