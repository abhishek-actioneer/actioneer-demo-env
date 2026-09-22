"use client";

// Marimekko / mosaic view of voice-campaign cohorts.
// Cohorts are grouped by lane: each lane is a vertical column whose WIDTH is
// proportional to the lane's total call count. Within a lane, cohorts stack
// vertically with HEIGHT proportional to their share of the lane, and each
// cohort block is filled by its outcome mix as a horizontal mini stacked bar —
// so you read lane volume (width), cohort volume (height), and outcome
// composition (fill) at once.

import React from "react";
import type { CohortVM } from "./voice-cohort-model";
import { outcomeShade, sortedMix } from "./voice-cohort-model";

interface Lane {
  laneId: string;
  laneLabel: string;
  accent: string;
  total: number;
  cohorts: CohortVM[];
}

function groupByLane(cohorts: CohortVM[]): Lane[] {
  const byLane = new Map<string, Lane>();
  for (const cohort of cohorts) {
    let lane = byLane.get(cohort.laneId);
    if (!lane) {
      lane = {
        laneId: cohort.laneId,
        laneLabel: cohort.laneLabel,
        accent: cohort.accent,
        total: 0,
        cohorts: [],
      };
      byLane.set(cohort.laneId, lane);
    }
    lane.total += cohort.count;
    lane.cohorts.push(cohort);
  }
  const lanes = Array.from(byLane.values());
  for (const lane of lanes) {
    lane.cohorts.sort((a, b) => b.count - a.count);
  }
  lanes.sort((a, b) => b.total - a.total);
  return lanes;
}

const CHART_HEIGHT = 440;
const HEADER_HEIGHT = 40;
/** Below this block height (px) we hide the inline label to avoid clutter. */
const LABEL_MIN_HEIGHT = 28;

/** Distinct outcomes present across all cohorts, brightest-first, for legend. */
function legendOutcomes(cohorts: CohortVM[]): string[] {
  const seen = new Set<string>();
  for (const cohort of cohorts) {
    for (const [outcome] of sortedMix(cohort.outcomeMix)) {
      seen.add(outcome);
    }
  }
  const rank = (o: string) =>
    ["positive", "neutral", "busy", "no_answer", "negative", "failed", "wrong_number"].indexOf(o);
  return Array.from(seen).sort((a, b) => rank(a) - rank(b));
}

function outcomeLabel(outcome: string): string {
  return outcome.replace(/_/g, " ");
}

function CohortBlock({
  cohort,
  laneTotal,
  selected,
  onSelect,
}: {
  cohort: CohortVM;
  laneTotal: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const heightPct = laneTotal > 0 ? (cohort.count / laneTotal) * 100 : 0;
  // Approximate pixel height of this block to decide whether to show the label.
  const blockPx = (heightPct / 100) * (CHART_HEIGHT - HEADER_HEIGHT);
  const showLabel = blockPx >= LABEL_MIN_HEIGHT;

  const mix = sortedMix(cohort.outcomeMix);
  const mixTotal = mix.reduce((sum, [, count]) => sum + count, 0);

  const handleSelect = () => onSelect(cohort.id);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(cohort.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${cohort.shortTitle}, ${cohort.count} calls`}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      title={`${cohort.title} · ${cohort.count} calls`}
      className="relative flex w-full cursor-pointer overflow-hidden transition-[outline] focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--foreground)]"
      style={{
        height: `${heightPct}%`,
        border: "1px solid var(--border)",
        outline: selected ? "2px solid var(--foreground)" : "1px solid transparent",
        outlineOffset: selected ? "-2px" : "0",
      }}
    >
      {/* Outcome-mix fill: horizontal mini stacked bar = block background. */}
      <div className="absolute inset-0 flex" aria-hidden>
        {mixTotal > 0 ? (
          mix.map(([outcome, count]) => (
            <div
              key={outcome}
              style={{
                width: `${(count / mixTotal) * 100}%`,
                backgroundColor: outcomeShade(outcome),
              }}
            />
          ))
        ) : (
          <div className="w-full" style={{ backgroundColor: "var(--muted)" }} />
        )}
      </div>

      {showLabel && (
        <div className="relative z-10 flex w-full items-start justify-between gap-2 px-2 py-1">
          <span
            className="truncate text-[9.9px] font-medium leading-tight"
            style={{
              color: "var(--background)",
              mixBlendMode: "difference",
            }}
          >
            {cohort.shortTitle}
          </span>
          <span
            className="shrink-0 text-[9.9px] tabular-nums leading-tight"
            style={{
              color: "var(--background)",
              mixBlendMode: "difference",
            }}
          >
            {cohort.count}
          </span>
        </div>
      )}
    </div>
  );
}

export function CohortMarimekko({
  cohorts,
  selectedId,
  onSelect,
}: {
  cohorts: CohortVM[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const lanes = groupByLane(cohorts);
  const grandTotal = lanes.reduce((sum, lane) => sum + lane.total, 0);
  const legend = legendOutcomes(cohorts);

  if (lanes.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border text-sm text-[var(--muted-foreground)]"
        style={{ height: CHART_HEIGHT, borderColor: "var(--border)" }}
      >
        No cohorts to display.
      </div>
    );
  }

  return (
    <div className="w-full">
      <div
        className="flex w-full gap-[2px]"
        style={{ height: CHART_HEIGHT, background: "var(--background)" }}
      >
        {lanes.map((lane) => {
          const widthPct = grandTotal > 0 ? (lane.total / grandTotal) * 100 : 0;
          return (
            <div
              key={lane.laneId}
              className="flex min-w-0 flex-col"
              style={{ flexBasis: `${widthPct}%`, width: `${widthPct}%` }}
            >
              {/* Lane header */}
              <div
                className="flex flex-col justify-end gap-1 pb-1"
                style={{ height: HEADER_HEIGHT }}
              >
                <div className="flex min-w-0 items-baseline justify-between gap-1">
                  <span className="truncate text-[9.9px] font-medium text-[var(--foreground)]">
                    {lane.laneLabel}
                  </span>
                  <span className="shrink-0 text-[9.9px] tabular-nums text-[var(--muted-foreground)]">
                    {lane.total}
                  </span>
                </div>
                <div
                  className="h-[3px] w-full rounded-full"
                  style={{ backgroundColor: lane.accent }}
                />
              </div>

              {/* Stacked cohorts */}
              <div className="flex min-h-0 flex-1 flex-col gap-[2px]">
                {lane.cohorts.map((cohort) => (
                  <CohortBlock
                    key={cohort.id}
                    cohort={cohort}
                    laneTotal={lane.total}
                    selected={selectedId === cohort.id}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Outcome legend */}
      {legend.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {legend.map((outcome) => (
            <div key={outcome} className="flex items-center gap-1.5">
              <span
                className="inline-block size-3 rounded-[2px]"
                style={{
                  backgroundColor: outcomeShade(outcome),
                  border: "1px solid var(--border)",
                }}
                aria-hidden
              />
              <span className="text-[9.9px] capitalize text-[var(--muted-foreground)]">
                {outcomeLabel(outcome)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
