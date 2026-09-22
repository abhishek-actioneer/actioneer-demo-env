"use client";

import { X } from "lucide-react";
import type { EventProperty } from "@/lib/explorer-types";

interface BreakdownPickerProps {
  value?: string;
  onChange: (breakdown: string | undefined) => void;
  properties: EventProperty[];
}

export function BreakdownPicker({
  value,
  onChange,
  properties,
}: BreakdownPickerProps) {
  const dimProps = properties.filter(
    (p) => p.type === "string" || p.type === "date",
  );

  if (value) {
    const prop = dimProps.find((p) => p.column === value);
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <span className="flex-1 font-medium">
          {prop?.displayName ?? value}
        </span>
        {prop?.cardinalityHint === "high" && (
          <span className="text-[9px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
            High cardinality
          </span>
        )}
        <button
          onClick={() => onChange(undefined)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <select
      value=""
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className="w-full appearance-none bg-transparent border rounded-md px-3 py-2 text-sm text-muted-foreground cursor-pointer focus:ring-1 focus:ring-border"
    >
      <option value="">+ Select Property</option>
      {dimProps.map((p) => (
        <option key={p.column} value={p.column}>
          {p.displayName}
          {p.cardinalityHint === "high" ? " (high cardinality)" : ""}
        </option>
      ))}
    </select>
  );
}
