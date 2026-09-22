"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

/* ─────────────────────────────────────────────
   Types
   ───────────────────────────────────────────── */

export type ScheduleMode = "interval" | "daily" | "weekly";

export interface ScheduleState {
  mode: ScheduleMode;
  // interval
  intervalValue: number;
  intervalUnit: "minutes" | "hours";
  // daily + weekly
  hour: number;        // 1–12
  minute: number;      // 0 | 15 | 30 | 45
  meridiem: "AM" | "PM";
  // daily only
  weekdaysOnly: boolean;
  // weekly only
  days: number[];      // 0=Sun … 6=Sat
}

/* ─────────────────────────────────────────────
   Human-readable serializer
   ───────────────────────────────────────────── */

export function toHumanSchedule(s: ScheduleState): string {
  if (s.mode === "interval") {
    const unit = s.intervalValue === 1
      ? s.intervalUnit.replace(/s$/, "")
      : s.intervalUnit;
    return `Every ${s.intervalValue} ${unit}`;
  }
  const mm   = String(s.minute).padStart(2, "0");
  const time = `${s.hour}:${mm} ${s.meridiem}`;
  if (s.mode === "daily") {
    return s.weekdaysOnly ? `Weekdays at ${time}` : `Every day at ${time}`;
  }
  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayStr = [...s.days].sort((a, b) => a - b).map(d => DAY_SHORT[d]).join(", ");
  return `${dayStr} at ${time}`;
}

/* ─────────────────────────────────────────────
   Simple string → state parser (best-effort)
   ───────────────────────────────────────────── */

export function parseSchedule(s: string): ScheduleState {
  const base: ScheduleState = {
    mode: "interval", intervalValue: 1, intervalUnit: "hours",
    hour: 9, minute: 0, meridiem: "AM", weekdaysOnly: false, days: [1],
  };
  const lower = s.toLowerCase();
  // interval — minutes
  const minMatch = lower.match(/every\s+(\d+)\s+min/);
  if (minMatch) return { ...base, mode: "interval", intervalValue: +minMatch[1], intervalUnit: "minutes" };
  // interval — hours
  if (/every\s+hour/.test(lower)) return { ...base, mode: "interval", intervalValue: 1,  intervalUnit: "hours" };
  const hrMatch = lower.match(/every\s+(\d+)\s+hour/);
  if (hrMatch)  return { ...base, mode: "interval", intervalValue: +hrMatch[1], intervalUnit: "hours" };
  // time parser helper
  const timeMatch = lower.match(/(\d+):(\d+)\s*(am|pm)/);
  const h  = timeMatch ? +timeMatch[1] : 9;
  const m  = timeMatch ? +timeMatch[2] : 0;
  const mer = timeMatch ? (timeMatch[3].toUpperCase() as "AM" | "PM") : "AM";
  // weekdays
  if (/weekday/.test(lower)) return { ...base, mode: "daily", hour: h, minute: m, meridiem: mer, weekdaysOnly: true };
  // daily
  if (/every\s+day/.test(lower)) return { ...base, mode: "daily", hour: h, minute: m, meridiem: mer, weekdaysOnly: false };
  // weekly — try to parse day names
  const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const foundDays = Object.entries(dayMap).filter(([k]) => lower.includes(k)).map(([, v]) => v);
  if (foundDays.length > 0) return { ...base, mode: "weekly", days: foundDays, hour: h, minute: m, meridiem: mer };
  return base;
}

/* ─────────────────────────────────────────────
   Templates
   ───────────────────────────────────────────── */

export type TplConfig = Partial<ScheduleState>;

export const TEMPLATES: { label: string; config: TplConfig }[] = [
  { label: "Every 15 min",   config: { mode: "interval", intervalValue: 15, intervalUnit: "minutes" } },
  { label: "Every 30 min",   config: { mode: "interval", intervalValue: 30, intervalUnit: "minutes" } },
  { label: "Every hour",     config: { mode: "interval", intervalValue: 1,  intervalUnit: "hours"   } },
  { label: "Every 2 hours",  config: { mode: "interval", intervalValue: 2,  intervalUnit: "hours"   } },
  { label: "Every 6 hours",  config: { mode: "interval", intervalValue: 6,  intervalUnit: "hours"   } },
  { label: "Every 12 hours", config: { mode: "interval", intervalValue: 12, intervalUnit: "hours"   } },
  { label: "Daily midnight", config: { mode: "daily", hour: 12, minute: 0, meridiem: "AM", weekdaysOnly: false } },
  { label: "Daily 9:00 AM",  config: { mode: "daily", hour: 9,  minute: 0, meridiem: "AM", weekdaysOnly: false } },
  { label: "Weekdays 9 AM",  config: { mode: "daily", hour: 9,  minute: 0, meridiem: "AM", weekdaysOnly: true  } },
  { label: "Mon 9:00 AM",    config: { mode: "weekly", days: [1], hour: 9, minute: 0, meridiem: "AM" } },
];

export function isTemplateActive(state: ScheduleState, config: TplConfig): boolean {
  return Object.entries(config).every(([k, v]) => {
    if (k === "days") return JSON.stringify([...(state.days)].sort()) === JSON.stringify([...(v as number[])].sort());
    return (state as unknown as Record<string, unknown>)[k] === v;
  });
}

/* ─────────────────────────────────────────────
   Sub-components
   ───────────────────────────────────────────── */

export const SELECT_CLS =
  "w-fit text-sm border border-border rounded-lg pl-2.5 pr-6 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 text-foreground appearance-none bg-no-repeat bg-[right_8px_center]"
  + " [background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]";

export function TimePicker({
  state,
  patch,
}: {
  state: ScheduleState;
  patch: (p: Partial<ScheduleState>) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">At</span>
      <select value={state.hour} onChange={e => patch({ hour: +e.target.value })} className={SELECT_CLS}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="text-muted-foreground text-sm">:</span>
      <select value={state.minute} onChange={e => patch({ minute: +e.target.value })} className={SELECT_CLS}>
        {[0, 15, 30, 45].map(m => (
          <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
        ))}
      </select>
      <select value={state.meridiem} onChange={e => patch({ meridiem: e.target.value as "AM" | "PM" })} className={SELECT_CLS}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_FULL   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DayPicker({
  days,
  onChange,
}: {
  days: number[];
  onChange: (days: number[]) => void;
}) {
  function toggle(d: number) {
    const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
    if (next.length > 0) onChange(next);
  }
  return (
    <div className="flex items-center gap-1.5">
      {DAY_LABELS.map((label, d) => (
        <button
          key={d}
          type="button"
          title={DAY_FULL[d]}
          onClick={() => toggle(d)}
          className={`w-8 h-8 rounded-full text-[10.8px] font-medium transition-colors ${
            days.includes(d)
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Modal
   ───────────────────────────────────────────── */

interface SchedulerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  currentSchedule: string;
  onSave: (human: string) => void;
}

export function SchedulerModal({
  open,
  onOpenChange,
  agentName,
  currentSchedule,
  onSave,
}: SchedulerModalProps) {
  const [state, setState] = useState<ScheduleState>(() => parseSchedule(currentSchedule));

  // Re-parse when a new agent is opened
  const [lastSchedule, setLastSchedule] = useState(currentSchedule);
  if (currentSchedule !== lastSchedule) {
    setLastSchedule(currentSchedule);
    setState(parseSchedule(currentSchedule));
  }

  function patch(partial: Partial<ScheduleState>) {
    setState(prev => ({ ...prev, ...partial }));
  }

  const preview = toHumanSchedule(state);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/60 backdrop-blur-[2px]"
          onClick={e => { if (e.target === e.currentTarget) onOpenChange(false); }}
        >
          <motion.div
            className="relative bg-background border border-border rounded-2xl shadow-xl w-full max-w-md mx-4 h-[480px] flex flex-col overflow-hidden"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 shrink-0">
          <p className="text-sm font-medium text-foreground">
            Schedule · <span className="text-muted-foreground font-normal">{agentName}</span>
          </p>
        </div>

        <div className="flex flex-col flex-1 min-h-0 px-6 pb-5">
        <div className="flex-1 overflow-y-auto space-y-5 pr-1">

          {/* ── Quick pick ── */}
          <div>
            <span className="text-[9.9px] font-semibold text-muted-foreground uppercase tracking-wider">
              Quick pick
            </span>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {TEMPLATES.map(t => {
                const active = isTemplateActive(state, t.config);
                return (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setState(prev => ({ ...prev, ...t.config }))}
                    className={`px-2.5 py-1 text-[10.8px] font-medium rounded-lg border transition-colors ${
                      active
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background text-foreground border-border hover:bg-muted/50"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Custom builder ── */}
          <div>
            <span className="text-[9.9px] font-semibold text-muted-foreground uppercase tracking-wider">
              Custom
            </span>

            {/* Mode selector */}
            <div className="flex items-center gap-0.5 mt-2.5 p-0.5 rounded-lg w-fit" style={{ background: "var(--connector-surface)", border: "1px solid var(--connector-border)" }}>
              {(["interval", "daily", "weekly"] as ScheduleMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => patch({ mode: m })}
                  className={`px-3 py-1.5 text-[10.8px] font-medium rounded-md transition-colors capitalize ${
                    state.mode === m
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Builder body */}
            <div className="mt-4">
              {state.mode === "interval" && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Every</span>
                  <input
                    type="number"
                    min={1}
                    max={59}
                    value={state.intervalValue}
                    onChange={e => patch({ intervalValue: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="w-16 text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background text-center focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                  <select
                    value={state.intervalUnit}
                    onChange={e => patch({ intervalUnit: e.target.value as "minutes" | "hours" })}
                    className={SELECT_CLS}
                  >
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                  </select>
                </div>
              )}

              {state.mode === "daily" && (
                <div className="space-y-3">
                  <TimePicker state={state} patch={patch} />
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={state.weekdaysOnly}
                      onChange={e => patch({ weekdaysOnly: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-muted-foreground">Weekdays only (Mon-Fri)</span>
                  </label>
                </div>
              )}

              {state.mode === "weekly" && (
                <div className="space-y-3">
                  <DayPicker days={state.days} onChange={days => patch({ days })} />
                  <TimePicker state={state} patch={patch} />
                </div>
              )}
            </div>
          </div>

        </div>

        {/* ── Preview + Save — pinned footer ── */}
        <div className="flex items-center justify-between pt-3 mt-3 border-t border-border shrink-0">
          <span className="text-sm text-muted-foreground tabular-nums">{preview}</span>
          <button
            type="button"
            onClick={() => { onSave(preview); onOpenChange(false); }}
            className="px-4 py-1.5 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
            style={{ transition: "transform 0.15s ease" }}
            onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.98)")}
            onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
            onPointerDown={e => (e.currentTarget.style.transform = "scale(0.96)")}
            onPointerUp={e => (e.currentTarget.style.transform = "scale(0.98)")}
          >
            Save
          </button>
        </div>
        </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
