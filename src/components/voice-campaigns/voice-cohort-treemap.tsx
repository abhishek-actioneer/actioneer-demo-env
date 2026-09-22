"use client";

// Treemap view of voice-campaign cohorts. Outer rectangles are LANES (grouped by
// laneLabel + accent), inner rectangles are cohorts sized by `count`. Layout is a
// hand-rolled squarified treemap (no d3 / external treemap lib). Cohort cells are
// tinted with their lane accent; a bottom overlay shows the completed share.

import { useMemo } from "react";
import type { CohortVM } from "./voice-cohort-model";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const WIDTH = 1000; // virtual layout units; cells convert to % of container
const HEIGHT = 420;
const LANE_HEADER = 22; // reserved strip at top of each lane for its label
const LANE_GAP = 4;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PlacedCohort {
  cohort: CohortVM;
  rect: Rect;
}

interface PlacedLane {
  laneId: string;
  laneLabel: string;
  accent: string;
  total: number;
  rect: Rect;
  cohorts: PlacedCohort[];
}

interface LaneGroup {
  laneId: string;
  laneLabel: string;
  accent: string;
  total: number;
  cohorts: CohortVM[];
}

function groupByLane(cohorts: CohortVM[]): LaneGroup[] {
  const order: string[] = [];
  const map = new Map<string, LaneGroup>();
  for (const cohort of cohorts) {
    let group = map.get(cohort.laneId);
    if (!group) {
      group = {
        laneId: cohort.laneId,
        laneLabel: cohort.laneLabel,
        accent: cohort.accent,
        total: 0,
        cohorts: [],
      };
      map.set(cohort.laneId, group);
      order.push(cohort.laneId);
    }
    group.total += Math.max(0, cohort.count);
    group.cohorts.push(cohort);
  }
  return order
    .map((id) => map.get(id))
    .filter((g): g is LaneGroup => g !== undefined && g.total > 0);
}

// --- Squarified treemap (Bruls, Huizing, van Wijk) ---------------------------
// Lays out `items` (value-weighted) inside `rect`, returning one sub-rect each.

interface SquarifyItem<T> {
  value: number;
  data: T;
}

function squarify<T>(items: SquarifyItem<T>[], rect: Rect): Array<{ data: T; rect: Rect }> {
  const out: Array<{ data: T; rect: Rect }> = [];
  const total = items.reduce((sum, it) => sum + it.value, 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out;

  // Normalise values to area of the rect.
  const scale = (rect.w * rect.h) / total;
  const scaled = items.map((it) => ({ data: it.data, area: it.value * scale }));

  let free: Rect = { ...rect };
  let row: Array<{ data: T; area: number }> = [];

  const shortSide = (r: Rect) => Math.min(r.w, r.h);

  // Worst aspect ratio of a row laid along the short side of `free`.
  function worst(rowItems: Array<{ area: number }>, side: number): number {
    if (rowItems.length === 0) return Infinity;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const it of rowItems) {
      sum += it.area;
      if (it.area < min) min = it.area;
      if (it.area > max) max = it.area;
    }
    const side2 = side * side;
    const sum2 = sum * sum;
    return Math.max((side2 * max) / sum2, sum2 / (side2 * min));
  }

  function layoutRow(rowItems: Array<{ data: T; area: number }>) {
    const side = shortSide(free);
    const rowArea = rowItems.reduce((s, it) => s + it.area, 0);
    if (rowArea <= 0 || side <= 0) return;
    const thickness = rowArea / side;

    if (free.w >= free.h) {
      // Row is a vertical column on the left of `free`.
      let cursorY = free.y;
      for (const it of rowItems) {
        const h = (it.area / rowArea) * side;
        out.push({ data: it.data, rect: { x: free.x, y: cursorY, w: thickness, h } });
        cursorY += h;
      }
      free = { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h };
    } else {
      // Row is a horizontal strip along the top of `free`.
      let cursorX = free.x;
      for (const it of rowItems) {
        const w = (it.area / rowArea) * side;
        out.push({ data: it.data, rect: { x: cursorX, y: free.y, w, h: thickness } });
        cursorX += w;
      }
      free = { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
    }
  }

  for (const item of scaled) {
    const side = shortSide(free);
    const next = [...row, item];
    if (row.length === 0 || worst(next, side) <= worst(row, side)) {
      row = next;
    } else {
      layoutRow(row);
      row = [item];
    }
  }
  if (row.length > 0) layoutRow(row);

  return out;
}

function layoutTreemap(cohorts: CohortVM[]): PlacedLane[] {
  const lanes = groupByLane(cohorts);
  if (lanes.length === 0) return [];

  const laneRects = squarify(
    lanes.map((lane) => ({ value: lane.total, data: lane })),
    { x: 0, y: 0, w: WIDTH, h: HEIGHT },
  );

  return laneRects.map(({ data: lane, rect }) => {
    const inner: Rect = {
      x: rect.x + LANE_GAP,
      y: rect.y + LANE_HEADER,
      w: Math.max(0, rect.w - LANE_GAP * 2),
      h: Math.max(0, rect.h - LANE_HEADER - LANE_GAP),
    };
    const cohortRects = squarify(
      lane.cohorts
        .filter((c) => c.count > 0)
        .map((c) => ({ value: c.count, data: c })),
      inner,
    );
    return {
      laneId: lane.laneId,
      laneLabel: lane.laneLabel,
      accent: lane.accent,
      total: lane.total,
      rect,
      cohorts: cohortRects.map(({ data, rect: r }) => ({ cohort: data, rect: r })),
    };
  });
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

/** Convert a #rrggbb hex into an rgba() string at the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) {
    // Fall back to a neutral tint if the accent isn't a clean hex.
    return `rgba(127,127,127,${alpha})`;
  }
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pct(value: number, axis: number): string {
  return `${(value / axis) * 100}%`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CohortTreemap({
  cohorts,
  selectedId,
  onSelect,
}: {
  cohorts: CohortVM[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const lanes = useMemo(() => layoutTreemap(cohorts), [cohorts]);

  const legend = useMemo(() => groupByLane(cohorts), [cohorts]);

  if (lanes.length === 0) {
    return (
      <div className="flex h-[420px] w-full items-center justify-center rounded-md border border-border text-sm text-muted-foreground">
        No cohorts to display
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Lane legend */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {legend.map((lane) => (
          <div key={lane.laneId} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: lane.accent }}
            />
            <span className="text-xs text-foreground">{lane.laneLabel}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{lane.total}</span>
          </div>
        ))}
      </div>

      {/* Treemap */}
      <div
        className="relative w-full overflow-hidden rounded-md border border-border bg-background"
        style={{ height: HEIGHT }}
      >
        {lanes.map((lane) => (
          <div key={lane.laneId} className="contents">
            {/* Lane label sits in the reserved header strip. */}
            <div
              className="pointer-events-none absolute flex items-center gap-1.5 px-1"
              style={{
                left: pct(lane.rect.x, WIDTH),
                top: pct(lane.rect.y, HEIGHT),
                width: pct(lane.rect.w, WIDTH),
                height: pct(LANE_HEADER, HEIGHT),
              }}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: lane.accent }}
              />
              <span className="truncate text-[9.9px] font-medium text-foreground">
                {lane.laneLabel}
              </span>
              <span className="shrink-0 text-[9.9px] tabular-nums text-muted-foreground">
                {lane.total}
              </span>
            </div>

            {/* Cohort cells */}
            {lane.cohorts.map(({ cohort, rect }) => {
              const selected = selectedId === cohort.id;
              const area = rect.w * rect.h;
              const showLabel = rect.w > 64 && rect.h > 34;
              const completedFrac =
                cohort.count > 0 ? Math.min(1, cohort.completed / cohort.count) : 0;

              return (
                <div
                  key={cohort.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`${cohort.shortTitle}, ${cohort.count} calls`}
                  onClick={() => onSelect(cohort.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(cohort.id);
                    }
                  }}
                  className="group absolute cursor-pointer overflow-hidden outline-none transition-[box-shadow] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-foreground"
                  style={{
                    left: pct(rect.x, WIDTH),
                    top: pct(rect.y, HEIGHT),
                    width: pct(rect.w, WIDTH),
                    height: pct(rect.h, HEIGHT),
                    backgroundColor: hexToRgba(cohort.accent, selected ? 0.32 : 0.14),
                    border: `1px solid ${selected ? "var(--foreground)" : "var(--border)"}`,
                    boxShadow: selected ? "inset 0 0 0 1px var(--foreground)" : undefined,
                    zIndex: selected ? 5 : 1,
                  }}
                  title={`${cohort.title} — ${cohort.count} calls, ${cohort.completed} completed`}
                >
                  {/* Completed-share overlay, filled from the bottom up. */}
                  {completedFrac > 0 && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0"
                      style={{
                        height: `${completedFrac * 100}%`,
                        backgroundColor: "var(--foreground)",
                        opacity: 0.85,
                      }}
                    />
                  )}

                  {showLabel && (
                    <div className="relative flex h-full flex-col justify-between p-1.5">
                      <span
                        className="line-clamp-2 text-[9.9px] font-medium leading-tight text-foreground"
                        style={{
                          mixBlendMode: completedFrac > 0.6 ? "difference" : undefined,
                        }}
                      >
                        {cohort.shortTitle}
                      </span>
                      <span
                        className="text-[9.9px] tabular-nums text-muted-foreground"
                        style={{
                          mixBlendMode: completedFrac > 0.85 ? "difference" : undefined,
                        }}
                      >
                        {cohort.count}
                      </span>
                    </div>
                  )}

                  {/* Tiny cells get just a dot so they remain legible. */}
                  {!showLabel && area > 220 && (
                    <span
                      aria-hidden
                      className="absolute left-1 top-1 size-1.5 rounded-full"
                      style={{ backgroundColor: cohort.accent }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
