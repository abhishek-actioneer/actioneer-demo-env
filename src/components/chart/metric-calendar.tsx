"use client";

import { useMemo, useState, useEffect } from "react";
import { formatValue } from "@/lib/format-utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MetricCalendarProps {
  data: { date: string; value: number }[];
  format?: "number" | "currency" | "percent";
  currency?: string;
  grain?: "daily" | "weekly" | "monthly";
  metricName?: string;
}

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function detectGrain(data: { date: string }[]): "daily" | "weekly" | "monthly" {
  if (data.length < 3) return "daily";
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const first = new Date(sorted[0].date + "T00:00:00");
  const last = new Date(sorted[sorted.length - 1].date + "T00:00:00");
  const daySpan = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24);
  const avgGap = daySpan / (sorted.length - 1);
  if (avgGap >= 25) return "monthly";
  if (avgGap >= 5) return "weekly";
  return "daily";
}

// ─── Monochrome intensity ───
// Uses foreground color at increasing opacity — no green/color heatmap

function buildIntensityFn(values: number[]): (value: number) => number {
  if (values.length === 0) return () => 2;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return (value: number): number => {
    if (max === min) return 2;
    const t = (value - min) / (max - min);
    return Math.min(Math.round(t * 4), 4);
  };
}

// Monochrome: foreground at increasing opacity
const INTENSITY_CLASSES = [
  "bg-foreground/[0.03]",
  "bg-foreground/[0.07]",
  "bg-foreground/[0.12]",
  "bg-foreground/[0.18]",
  "bg-foreground/[0.25]",
];

function Legend() {
  return (
    <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
      <span>Less</span>
      {INTENSITY_CLASSES.map((cls, i) => (
        <div key={i} className={`w-3 h-3 rounded-sm ${cls}`} />
      ))}
      <span>More</span>
    </div>
  );
}

// ─── Shared month nav ───

function MonthNav({ label, onPrev, onNext, hasPrev, hasNext }: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        className="p-2 rounded-md hover:bg-muted disabled:opacity-20 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
        disabled={!hasPrev}
        onClick={onPrev}
        aria-label="Previous month"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
      <button
        type="button"
        className="p-2 rounded-md hover:bg-muted disabled:opacity-20 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
        disabled={!hasNext}
        onClick={onNext}
        aria-label="Next month"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </div>
  );
}

// ─── Monthly: compact year grid ───

function MonthlyCalendar({ data, format, currency, metricName }: MetricCalendarProps) {
  const monthMap = useMemo(() => {
    const m = new Map<string, { value: number; date: string }>();
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
    for (const d of sorted) {
      const key = d.date.slice(0, 7);
      m.set(key, { value: d.value, date: d.date });
    }
    return m;
  }, [data]);

  const years = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
    const first = new Date(sorted[0].date + "T00:00:00");
    const last = new Date(sorted[sorted.length - 1].date + "T00:00:00");
    const result: { year: number; months: number[]; getIntensity: (v: number) => number }[] = [];
    for (let y = first.getFullYear(); y <= last.getFullYear(); y++) {
      const startM = y === first.getFullYear() ? first.getMonth() : 0;
      const endM = y === last.getFullYear() ? last.getMonth() : 11;
      const months: number[] = [];
      const vals: number[] = [];
      for (let m = startM; m <= endM; m++) {
        months.push(m);
        const key = `${y}-${String(m + 1).padStart(2, "0")}`;
        const entry = monthMap.get(key);
        if (entry) vals.push(entry.value);
      }
      result.push({ year: y, months, getIntensity: buildIntensityFn(vals) });
    }
    return result;
  }, [data, monthMap]);

  const fmt = (val: number) => formatValue(val, format ?? "number", currency);

  return (
    <div className="space-y-5">
      {[...years].reverse().map(({ year, months, getIntensity }) => (
        <div key={year}>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">{year}</h3>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
            {months.map((m) => {
              const key = `${year}-${String(m + 1).padStart(2, "0")}`;
              const entry = monthMap.get(key);
              const level = entry ? getIntensity(entry.value) : -1;

              const cell = (
                <div
                  key={key}
                  className={`rounded-md p-2 min-h-[52px] min-w-0 flex flex-col justify-between cursor-default ${
                    entry ? INTENSITY_CLASSES[level] : ""
                  }`}
                >
                  <span className="text-[9px] text-muted-foreground">{MONTH_SHORT[m]}</span>
                  {entry && (
                    <span className="text-[9.9px] font-medium tabular-nums text-foreground mt-1 truncate">
                      {fmt(entry.value)}
                    </span>
                  )}
                </div>
              );

              if (!entry) return cell;

              return (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>{cell}</TooltipTrigger>
                  <TooltipContent side="top">
                    <div className="text-center">
                      {metricName && <p className="font-medium text-xs">{metricName}</p>}
                      <p className="text-xs text-muted-foreground">{MONTH_SHORT[m]} {year}: {fmt(entry.value)}</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex justify-end"><Legend /></div>
    </div>
  );
}

// ─── Daily: full calendar grid ───

function DailyCalendar({ data, format, currency, metricName }: MetricCalendarProps) {
  const dateMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data) m.set(d.date, d.value);
    return m;
  }, [data]);

  const months = useMemo(() => {
    if (!data.length) return [];
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
    const firstDate = new Date(sorted[0].date + "T00:00:00");
    const lastDate = new Date(sorted[sorted.length - 1].date + "T00:00:00");

    const allMonths: { label: string; weeks: { date: string; day: number; inMonth: boolean }[][] }[] = [];
    const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);

    while (cursor <= lastDate) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const label = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const startWd = (new Date(year, month, 1).getDay() + 6) % 7;
      const gridStart = new Date(year, month, 1 - startWd);
      const weeks: { date: string; day: number; inMonth: boolean }[][] = [];
      const weekCursor = new Date(gridStart);

      while (true) {
        const week: { date: string; day: number; inMonth: boolean }[] = [];
        for (let d = 0; d < 7; d++) {
          const iso = toIso(weekCursor);
          const inMonth = weekCursor.getMonth() === month && weekCursor.getFullYear() === year;
          week.push({ date: iso, day: weekCursor.getDate(), inMonth });
          weekCursor.setDate(weekCursor.getDate() + 1);
        }
        weeks.push(week);
        if (weekCursor.getMonth() !== month && weekCursor.getDay() === 1) break;
        if (weekCursor > new Date(year, month + 1, 6)) break;
      }

      allMonths.push({ label, weeks });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return allMonths;
  }, [data]);

  const [monthIndex, setMonthIndex] = useState(months.length - 1);

  useEffect(() => {
    setMonthIndex(months.length - 1);
  }, [months.length]);

  const current = months[Math.min(monthIndex, months.length - 1)];

  const getMonthIntensity = useMemo(() => {
    if (!current) return () => 2;
    const vals: number[] = [];
    for (const week of current.weeks) {
      for (const day of week) {
        if (day.inMonth) {
          const v = dateMap.get(day.date);
          if (v !== undefined) vals.push(v);
        }
      }
    }
    return buildIntensityFn(vals);
  }, [current, dateMap]);

  const fmt = (val: number) => formatValue(val, format ?? "number", currency);

  if (!months.length || !current) return null;

  return (
    <div className="space-y-3">
      <MonthNav
        label={current.label}
        onPrev={() => setMonthIndex((i) => i - 1)}
        onNext={() => setMonthIndex((i) => i + 1)}
        hasPrev={monthIndex > 0}
        hasNext={monthIndex < months.length - 1}
      />

      <div className="rounded-lg overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 mb-0.5">
          {DAY_HEADERS.map((d) => (
            <div key={d} className="px-1 py-1.5 text-[9px] text-muted-foreground/60 text-center font-medium">
              {d}
            </div>
          ))}
        </div>

        {/* Week rows */}
        <div className="grid gap-0.5">
          {current.weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-0.5">
              {week.map((day) => {
                const val = dateMap.get(day.date);
                const hasValue = val !== undefined && day.inMonth;
                const level = hasValue ? getMonthIntensity(val) : -1;

                const cell = (
                  <div
                    key={day.date}
                    className={`
                      relative min-h-[48px] p-1.5 rounded
                      ${!day.inMonth ? "opacity-0" : ""}
                      ${hasValue ? INTENSITY_CLASSES[level] : ""}
                      cursor-default
                    `}
                  >
                    <span className={`text-[9px] leading-none ${hasValue ? "text-muted-foreground" : "text-muted-foreground/30"}`}>
                      {day.inMonth ? day.day : ""}
                    </span>
                    {hasValue && (
                      <div className="mt-1 text-xs font-medium tabular-nums truncate text-foreground">
                        {fmt(val)}
                      </div>
                    )}
                  </div>
                );

                if (!hasValue) return cell;

                return (
                  <Tooltip key={day.date}>
                    <TooltipTrigger asChild>{cell}</TooltipTrigger>
                    <TooltipContent side="top">
                      <div className="text-center">
                        {metricName && <p className="font-medium text-xs">{metricName}</p>}
                        <p className="text-xs text-muted-foreground">{formatDateLabel(day.date)}: {fmt(val)}</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end"><Legend /></div>
    </div>
  );
}

// ─── Weekly: one month at a time, rows per week ───

function WeeklyCalendar({ data, format, currency, metricName }: MetricCalendarProps) {
  const months = useMemo(() => {
    if (!data.length) return [];
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

    const monthMap = new Map<string, { date: string; value: number; weekLabel: string }[]>();
    for (const d of sorted) {
      const dt = new Date(d.date + "T00:00:00");
      const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const weekEnd = new Date(dt);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const weekLabel = `${dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} to ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
      monthMap.get(monthKey)!.push({ date: d.date, value: d.value, weekLabel });
    }

    return Array.from(monthMap.entries()).map(([key, weeks]) => {
      const [y, m] = key.split("-").map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      return { key, label, weeks };
    });
  }, [data]);

  const [monthIndex, setMonthIndex] = useState(months.length - 1);

  useEffect(() => {
    setMonthIndex(months.length - 1);
  }, [months.length]);

  const current = months[Math.min(monthIndex, months.length - 1)];

  const getMonthIntensity = useMemo(() => {
    if (!current) return () => 2;
    return buildIntensityFn(current.weeks.map((w) => w.value));
  }, [current]);

  const fmt = (val: number) => formatValue(val, format ?? "number", currency);

  if (!months.length || !current) return null;

  return (
    <div className="space-y-3">
      <MonthNav
        label={current.label}
        onPrev={() => setMonthIndex((i) => i - 1)}
        onNext={() => setMonthIndex((i) => i + 1)}
        hasPrev={monthIndex > 0}
        hasNext={monthIndex < months.length - 1}
      />

      <div className="rounded-lg overflow-hidden">
        <div className="grid gap-0.5">
          {current.weeks.map((week) => {
            const level = getMonthIntensity(week.value);
            return (
              <Tooltip key={week.date}>
                <TooltipTrigger asChild>
                  <div
                    className={`flex items-center justify-between px-3 py-2.5 rounded cursor-default ${INTENSITY_CLASSES[level]}`}
                  >
                    <span className="text-xs text-muted-foreground">{week.weekLabel}</span>
                    <span className="text-sm font-medium tabular-nums text-foreground">{fmt(week.value)}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <div className="text-center">
                    {metricName && <p className="font-medium text-xs">{metricName}</p>}
                    <p className="text-xs text-muted-foreground">{week.weekLabel}: {fmt(week.value)}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end"><Legend /></div>
    </div>
  );
}

// ─── Entry point ───

export function MetricCalendar({ data, format, currency, grain: explicitGrain, metricName }: MetricCalendarProps) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
        No data
      </div>
    );
  }

  const grain = explicitGrain ?? detectGrain(data);

  let content: React.ReactNode;
  if (grain === "monthly") {
    content = <MonthlyCalendar data={data} format={format} currency={currency} metricName={metricName} />;
  } else if (grain === "weekly") {
    content = <WeeklyCalendar data={data} format={format} currency={currency} metricName={metricName} />;
  } else {
    content = <DailyCalendar data={data} format={format} currency={currency} metricName={metricName} />;
  }

  return <TooltipProvider delayDuration={200}>{content}</TooltipProvider>;
}
