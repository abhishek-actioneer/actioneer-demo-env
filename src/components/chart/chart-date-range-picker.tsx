"use client";

import { useState, useEffect } from "react";
import { CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";

// ── Presets ──

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 6 months", days: 180 },
  { label: "Last year", days: 365 },
  { label: "All time", days: 0 },
] as const;

function getPresetRange(days: number, datasetEnd?: string): DateRange {
  const to = datasetEnd ? new Date(datasetEnd) : new Date();
  if (days === 0) return { from: undefined, to: undefined };
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from, to };
}

function parseValue(value?: { start: string; end: string }): DateRange {
  return {
    from: value?.start ? new Date(value.start) : undefined,
    to: value?.end ? new Date(value.end) : undefined,
  };
}

// ── Props ──

export interface ChartDateRangePickerProps {
  value?: { start: string; end: string };
  datasetDateRange?: { start: string; end: string };
  onChange: (range: { start: string; end: string } | string) => void;
}

export function ChartDateRangePicker({ value, datasetDateRange, onChange }: ChartDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // Single local range state — tracks the full selection lifecycle.
  // react-day-picker calls onSelect on every click:
  //   click 1: { from: date, to: undefined }
  //   click 2: { from: date1, to: date2 }
  //   click 3 (after complete range): resets to { from: date3, to: undefined }
  const [selectedRange, setSelectedRange] = useState<DateRange>(parseValue(value));

  // Sync from parent when value prop changes (e.g. after requery)
  const valueStart = value?.start;
  const valueEnd = value?.end;
  useEffect(() => {
    setSelectedRange({
      from: valueStart ? new Date(valueStart) : undefined,
      to: valueEnd ? new Date(valueEnd) : undefined,
    });
  }, [valueStart, valueEnd]);

  // Dataset bounds for disabling out-of-range dates
  const datasetFrom = datasetDateRange?.start ? new Date(datasetDateRange.start) : undefined;
  const datasetTo = datasetDateRange?.end ? new Date(datasetDateRange.end) : undefined;

  const handlePreset = (preset: typeof PRESETS[number]) => {
    setActivePreset(preset.label);
    setPendingFrom(false);
    if (preset.days === 0) {
      setSelectedRange({ from: undefined, to: undefined });
      onChange("All");
      setOpen(false);
      return;
    }
    const range = getPresetRange(preset.days, datasetDateRange?.end);
    setSelectedRange(range);
    if (range.from && range.to) {
      onChange({
        start: format(range.from, "yyyy-MM-dd"),
        end: format(range.to, "yyyy-MM-dd"),
      });
    }
    setOpen(false);
  };

  // Track whether the user is mid-selection (picked from, waiting for to)
  const [pendingFrom, setPendingFrom] = useState(false);

  const handleCalendarSelect = (range: DateRange | undefined) => {
    if (!range) return;
    setActivePreset(null);
    setSelectedRange(range);

    if (!pendingFrom && range.from) {
      // First click — mark as pending, wait for second click
      setPendingFrom(true);
      return;
    }

    // Second click — complete range
    if (pendingFrom && range.from && range.to) {
      setPendingFrom(false);
      onChange({
        start: format(range.from, "yyyy-MM-dd"),
        end: format(range.to, "yyyy-MM-dd"),
      });
      setOpen(false);
    }
  };

  // Display label — show committed value (both dates) or "Select dates"
  const displayLabel = activePreset
    ? activePreset
    : selectedRange.from && selectedRange.to
      ? `${format(selectedRange.from, "MMM d")} to ${format(selectedRange.to, "MMM d, yyyy")}`
      : selectedRange.from
        ? `${format(selectedRange.from, "MMM d")} to …`
        : "Select dates";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Select date range"
          className="flex items-center gap-1.5 px-2.5 py-1 min-h-[28px] text-[9.9px] font-medium text-muted-foreground bg-muted/50 rounded-md transition-[color,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer hover:text-foreground hover:bg-muted active:scale-[0.97]"
        >
          <CalendarDays className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate max-w-[140px]">{displayLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" sideOffset={8}>
        <div className="flex">
          {/* Presets sidebar */}
          <div className="border-r border-border p-2 space-y-0.5 w-[140px] shrink-0">
            <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1">
              Presets
            </p>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`w-full text-left px-2 py-1.5 min-h-[28px] text-[9.9px] rounded transition-[color,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer active:scale-[0.97] ${
                  activePreset === preset.label
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                onClick={() => handlePreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="p-2">
            <Calendar
              mode="range"
              selected={selectedRange}
              onSelect={handleCalendarSelect}
              numberOfMonths={2}
              disabled={datasetFrom || datasetTo ? (date) => {
                if (datasetFrom && date < datasetFrom) return true;
                if (datasetTo && date > datasetTo) return true;
                return false;
              } : undefined}
              defaultMonth={selectedRange.from ?? new Date()}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
