"use client";

import { useState, useRef, useEffect } from "react";
import { X, Plus } from "lucide-react";

interface SegmentInfo {
  id: string;
  name: string;
}

interface SegmentFilterBuilderProps {
  selectedIds: string[];
  segments: SegmentInfo[];
  onChange: (ids: string[]) => void;
  compareMode?: boolean;
  onCompareModeChange?: (compare: boolean) => void;
  emptyLabel?: string;
  addLabel?: string;
}

export function SegmentFilterBuilder({
  selectedIds,
  segments,
  onChange,
  compareMode,
  onCompareModeChange,
  emptyLabel = "All Users",
  addLabel = "Add Segment",
}: SegmentFilterBuilderProps) {
  const available = segments.filter(
    (s) => !selectedIds.includes(s.id),
  );
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="space-y-2">
      {selectedIds.map((id) => {
        const seg = segments.find((s) => s.id === id);
        return (
          <div
            key={id}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <span className="flex-1 truncate font-medium">
              {seg?.name ?? id}
            </span>
            <button
              onClick={() => onChange(selectedIds.filter((s) => s !== id))}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      {selectedIds.length === 0 && (
        <p className="text-xs text-muted-foreground py-1">
          {emptyLabel}
        </p>
      )}

      {selectedIds.length >= 2 && onCompareModeChange && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer py-1">
          <input
            type="checkbox"
            checked={compareMode ?? false}
            onChange={(e) => onCompareModeChange(e.target.checked)}
            className="rounded border-border"
          />
          Compare segments
        </label>
      )}

      {available.length > 0 && (
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </button>
          {open && (
            <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
              {available.map((seg) => (
                <button
                  key={seg.id}
                  onClick={() => {
                    onChange([...selectedIds, seg.id]);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors first:rounded-t-md last:rounded-b-md"
                >
                  {seg.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
