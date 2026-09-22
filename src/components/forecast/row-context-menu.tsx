"use client";

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Indent, Outdent, Copy, Trash2 } from "lucide-react";
import type { ForecastModel, ForecastRow } from "@/lib/forecast-types";

interface RowContextMenuProps {
  row: ForecastRow;
  modelRows: ForecastRow[];
  onModelChange: React.Dispatch<React.SetStateAction<ForecastModel>>;
  children?: React.ReactNode;
}

export function RowContextMenu({ row, onModelChange, children }: RowContextMenuProps) {
  const insertRow = (position: "above" | "below") => {
    onModelChange((prev) => {
      const idx = prev.rows.findIndex((r) => r.id === row.id);
      const newRow: ForecastRow = {
        id: crypto.randomUUID(), label: "New Metric", type: "base", indent: 0, format: "number",
      };
      const rows = [...prev.rows];
      rows.splice(position === "above" ? idx : idx + 1, 0, newRow);
      return { ...prev, rows };
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          (children as React.ReactElement) ?? (
            <button
              onClick={(e) => e.stopPropagation()}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100"
              style={{ transition: "opacity 80ms ease", color: "var(--fc-text-tertiary)" }}
            />
          )
        }
      />
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onClick={() => insertRow("above")}>
          <Plus className="w-4 h-4 mr-2" /> Insert Above
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => insertRow("below")}>
          <Plus className="w-4 h-4 mr-2" /> Insert Below
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onModelChange((prev) => ({
            ...prev, rows: prev.rows.map((r) => r.id === row.id ? { ...r, indent: Math.min(3, r.indent + 1) } : r),
          }))}
          disabled={row.indent >= 3}
        >
          <Indent className="w-4 h-4 mr-2" /> Indent
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onModelChange((prev) => ({
            ...prev, rows: prev.rows.map((r) => r.id === row.id ? { ...r, indent: Math.max(0, r.indent - 1) } : r),
          }))}
          disabled={row.indent === 0}
        >
          <Outdent className="w-4 h-4 mr-2" /> Outdent
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onModelChange((prev) => {
          const idx = prev.rows.findIndex((r) => r.id === row.id);
          return {
            ...prev,
            rows: [...prev.rows.slice(0, idx + 1),
              { ...row, id: crypto.randomUUID(), label: `${row.label} (Copy)` },
              ...prev.rows.slice(idx + 1)],
          };
        })}>
          <Copy className="w-4 h-4 mr-2" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onModelChange((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== row.id) }))}
          className="text-foreground"
        >
          <Trash2 className="w-4 h-4 mr-2" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
