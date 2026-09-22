"use client";

import { BarChart3, TrendingUp, AreaChartIcon, PieChart, ScatterChart } from "lucide-react";
import type { ChartSpec } from "@/lib/chart-types";

// Shared button styles — 44px min touch target via min-h + relative positioning for pseudo-element hit expansion
const segmentBtn = "relative px-2.5 py-1 text-[9.9px] font-medium rounded transition-[color,background-color] duration-150 ease-out cursor-pointer motion-reduce:transition-none touch-action-manipulation";
const segmentActive = "bg-background text-foreground shadow-sm";
const segmentInactive = "text-muted-foreground @media(hover:hover){hover:text-foreground}";

// ── Time Picker ──

const TIME_PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "6m", days: 180 },
  { label: "1y", days: 365 },
  { label: "All", days: 0 },
] as const;

export function TimePicker({
  active,
  onChange,
}: {
  active?: string;
  onChange: (preset: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5" role="group" aria-label="Time range">
      {TIME_PRESETS.map((p) => (
        <button
          key={p.label}
          type="button"
          aria-pressed={active === p.label}
          className={`${segmentBtn} min-h-[28px] ${
            active === p.label ? segmentActive : segmentInactive
          } active:scale-[0.97]`}
          onClick={() => onChange(p.label)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── Grain Picker ──

const GRAINS = [
  { label: "Day", value: "daily" as const },
  { label: "Week", value: "weekly" as const },
  { label: "Month", value: "monthly" as const },
] as const;

export function GrainPicker({
  active,
  onChange,
}: {
  active?: "daily" | "weekly" | "monthly";
  onChange: (grain: "daily" | "weekly" | "monthly") => void;
}) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5" role="group" aria-label="Granularity">
      {GRAINS.map((g) => (
        <button
          key={g.value}
          type="button"
          aria-pressed={active === g.value}
          className={`${segmentBtn} min-h-[28px] ${
            active === g.value ? segmentActive : segmentInactive
          } active:scale-[0.97]`}
          onClick={() => onChange(g.value)}
        >
          {g.label}
        </button>
      ))}
    </div>
  );
}

// ── Chart Type Switcher (custom dropdown) ──

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

const CHART_TYPES = [
  { type: "line" as const, icon: TrendingUp, label: "Line" },
  { type: "bar" as const, icon: BarChart3, label: "Bar" },
  { type: "area" as const, icon: AreaChartIcon, label: "Area" },
  { type: "pie" as const, icon: PieChart, label: "Pie" },
  { type: "scatter" as const, icon: ScatterChart, label: "Scatter" },
] as const;

export function ChartTypeSwitcher({
  active,
  onChange,
  hasPieData,
  hasScatterData,
}: {
  active: ChartSpec["type"];
  onChange: (type: ChartSpec["type"]) => void;
  hasPieData?: boolean;
  hasScatterData?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const available = CHART_TYPES.filter((t) => {
    if (t.type === "pie" && !hasPieData) return false;
    if (t.type === "scatter" && !hasScatterData) return false;
    return true;
  });

  const current = CHART_TYPES.find((t) => t.type === active) ?? CHART_TYPES[0];
  const ActiveIcon = current.icon;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={`Chart type: ${current.label}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 px-2 py-1 min-h-[28px] text-[9.9px] font-medium text-muted-foreground bg-muted/50 rounded-md transition-[color,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer hover:text-foreground hover:bg-muted active:scale-[0.97]"
        onClick={() => setOpen((o) => !o)}
      >
        <ActiveIcon className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{current.label}</span>
        <ChevronDown
          className="w-3 h-3 transition-transform duration-150 ease-out motion-reduce:transition-none"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Chart type"
          className="absolute top-full left-0 mt-1 z-50 min-w-[140px] bg-popover border border-border rounded-lg shadow-md py-1 animate-in fade-in-0 zoom-in-95 duration-150"
        >
          {available.map((ct) => {
            const Icon = ct.icon;
            const isActive = active === ct.type;
            return (
              <button
                key={ct.type}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 min-h-[32px] text-[9.9px] transition-[color,background-color] duration-100 ease-out motion-reduce:transition-none cursor-pointer active:scale-[0.98] ${
                  isActive
                    ? "text-foreground font-medium bg-muted/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                }`}
                onClick={() => {
                  onChange(ct.type);
                  setOpen(false);
                }}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{ct.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Stacked Toggle ──

export function StackedToggle({
  active,
  onChange,
  disabled,
}: {
  active: boolean;
  onChange: (stacked: boolean) => void;
  disabled?: boolean;
}) {
  if (disabled) return null;
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`${segmentBtn} min-h-[28px] active:scale-[0.97] ${
        active ? segmentActive : "bg-muted/50 " + segmentInactive
      }`}
      onClick={() => onChange(!active)}
    >
      Stacked
    </button>
  );
}
