"use client";

import type { MeasureType } from "@/lib/explorer-types";

interface MeasureTypePickerProps {
  value: MeasureType;
  onChange: (type: MeasureType) => void;
}

const MEASURE_OPTIONS: { type: MeasureType; label: string }[] = [
  { type: "uniques", label: "Uniques" },
  { type: "event_totals", label: "Event Totals" },
  { type: "active_pct", label: "Active %" },
  { type: "average", label: "Average" },
  { type: "frequency", label: "Frequency" },
  { type: "sum", label: "Sum" },
];

export function MeasureTypePicker({ value, onChange }: MeasureTypePickerProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MEASURE_OPTIONS.map((opt) => (
        <button
          key={opt.type}
          onClick={() => onChange(opt.type)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            value === opt.type
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
