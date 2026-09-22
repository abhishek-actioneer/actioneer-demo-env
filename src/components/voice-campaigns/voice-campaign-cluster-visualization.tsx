"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Delaunay } from "d3-delaunay";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useVoiceJourney, type VoiceJourney } from "@/hooks/use-voice-journey";
import {
  isCallEvent,
  reduceJourneyStates,
  type JourneyState,
} from "@/lib/voice-campaign-journey-types";
import type {
  VoiceCampaignCallDetail,
  VoiceCampaignCallZone,
  VoiceCampaignInsightCluster,
  VoiceCampaignInsightLane,
  VoiceCampaignInsightsPayload,
} from "@/lib/voice-campaign-insights-types";
import {
  buildCohortVMs,
  type CohortRequestInfo,
  type CohortSource,
} from "./voice-cohort-model";
import {
  CohortViewBody,
  CohortViewSwitcher,
  type CohortView,
} from "./voice-cohort-views";
import { VoiceCallDeepDive } from "./voice-call-deepdive";

type LaneId = string;

interface LocalChartFrame {
  innerWidth: number;
  innerHeight: number;
  xScale: (date: Date) => number;
  yScale: (value: number) => number;
}

const LocalChartContext = createContext<LocalChartFrame | null>(null);

function useLocalChartStable(): LocalChartFrame {
  const value = useContext(LocalChartContext);
  if (!value) throw new Error("useLocalChartStable must be used inside SimpleScatterFrame");
  return value;
}

interface LaneConfig {
  id: LaneId;
  label: string;
  compactLabel: string;
  /** Accent hex used for SVG marks and tinted chip backgrounds. */
  accent: string;
  /** Tailwind classes for the tinted label chip (badge style on dark surface). */
  chip: string;
}

interface ClusterDatum {
  id: string;
  title: string;
  shortTitle: string;
  count: number;
  share: number;
  confidence: number;
  laneId: LaneId;
  /** Lane visuals, denormalized so render code never needs a lane lookup. */
  accent: string;
  chip: string;
  laneCompactLabel: string;
  laneIndex: number;
  laneOrder: number;
  plotDate: Date;
  plotValue: number;
  radius: number;
  description: string;
  evidenceQuotes: string[];
  recommendedChange: string;
  avgDurationSeconds: number;
  medianTurns: number;
  outcomeMix: Record<string, number>;
  sampleCallIds: string[];
  callIds: string[];
}

interface LaneModel extends LaneConfig {
  index: number;
  clusters: ClusterDatum[];
  total: number;
  share: number;
}

/**
 * Static accent palette — assigned to lanes by triage order. Colors are stable
 * within a run, not semantically pinned across runs (lanes are run-derived).
 */
const LANE_ACCENTS: Array<{ accent: string; chip: string }> = [
  { accent: "#60a5fa", chip: "bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300" },
  { accent: "#fb7185", chip: "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300" },
  { accent: "#fbbf24", chip: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200" },
  { accent: "#34d399", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300" },
  { accent: "#a78bfa", chip: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300" },
];

function toLaneConfigs(lanes: VoiceCampaignInsightLane[]): LaneConfig[] {
  return lanes
    .slice()
    .sort((a, b) => a.triageRank - b.triageRank)
    .map((lane, index) => ({
      id: lane.id,
      label: lane.label,
      compactLabel: lane.compactLabel,
      ...LANE_ACCENTS[index % LANE_ACCENTS.length],
    }));
}

function laneDateAt(index: number): Date {
  return new Date(2026, 0, 1 + index * 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function compactText(value: string | undefined, max = 72): string {
  const text = value?.replace(/^"+|"+$/g, "").replace(/\s+/g, " ").trim() ?? "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const percent = value <= 1 ? value * 100 : value;
  if (percent >= 10) return `${Math.round(percent)}%`;
  return `${Number(percent.toFixed(1))}%`;
}

function toClusterData(
  clusters: VoiceCampaignInsightCluster[],
  laneConfigs: LaneConfig[],
): ClusterDatum[] {
  const laneById = new Map(laneConfigs.map((lane) => [lane.id, lane]));
  const sorted = clusters
    .slice()
    .filter((cluster) => laneById.has(cluster.laneId))
    .sort((a, b) => b.count - a.count);

  // Lane positions are derived from lanes that actually have clusters, so the
  // plot always spans the full width even when a lane is empty for a run.
  const presentLaneIds = laneConfigs
    .filter((lane) => sorted.some((cluster) => cluster.laneId === lane.id))
    .map((lane) => lane.id);

  const laneOrders = new Map<LaneId, number>();
  const laneSizes = new Map<LaneId, number>();
  for (const cluster of sorted) {
    laneSizes.set(cluster.laneId, (laneSizes.get(cluster.laneId) ?? 0) + 1);
  }

  return sorted.map((cluster) => {
    const lane = laneById.get(cluster.laneId)!;
    const laneIndex = presentLaneIds.indexOf(cluster.laneId);
    const laneOrder = laneOrders.get(cluster.laneId) ?? 0;
    laneOrders.set(cluster.laneId, laneOrder + 1);

    const title = cluster.title.replace(/^"+|"+$/g, "");
    // Spread clusters symmetrically around the lane center so a busy lane
    // doesn't drift into its neighbor.
    const laneSize = laneSizes.get(cluster.laneId) ?? 1;
    const offsetWithinLane = (laneOrder - (laneSize - 1) / 2) * 0.9;
    const plotDate = new Date(laneDateAt(laneIndex).getTime() + offsetWithinLane * 24 * 60 * 60 * 1000);

    return {
      id: cluster.id,
      title,
      shortTitle: compactText(title, 44),
      count: cluster.count,
      share: cluster.share,
      confidence: cluster.confidence,
      laneId: cluster.laneId,
      accent: lane.accent,
      chip: lane.chip,
      laneCompactLabel: lane.compactLabel,
      laneIndex,
      laneOrder,
      plotDate,
      // Square-root position scale: keeps volume ordering while giving the
      // many small clusters enough vertical room for collision-free labels.
      plotValue: Math.sqrt(cluster.count),
      radius: clamp(4 + Math.sqrt(cluster.count) * 0.82, 7, 14),
      description: cluster.customerLanguagePattern || cluster.description,
      evidenceQuotes: cluster.evidenceQuotes ?? [],
      recommendedChange: cluster.recommendedChange,
      avgDurationSeconds: cluster.avgDurationSeconds,
      medianTurns: cluster.medianTurns,
      outcomeMix: cluster.outcomeMix ?? {},
      sampleCallIds: cluster.sampleCallIds ?? [],
      callIds: cluster.callIds ?? [],
    };
  });
}

function buildLanes(
  clusters: ClusterDatum[],
  totalCalls: number,
  laneConfigs: LaneConfig[],
): LaneModel[] {
  return laneConfigs
    .filter((config) => clusters.some((cluster) => cluster.laneId === config.id))
    .map((config, index) => {
      const laneClusters = clusters
        .filter((cluster) => cluster.laneId === config.id)
        .sort((a, b) => b.count - a.count);
      const total = laneClusters.reduce((sum, cluster) => sum + cluster.count, 0);

      return {
        ...config,
        index,
        clusters: laneClusters,
        total,
        share: total / Math.max(totalCalls, 1),
      };
    });
}

function labelAnchorForLane(laneIndex: number, laneCount: number): "start" | "end" {
  // Right-half columns label leftward; with 1-2 columns the first labels rightward
  // so it never extends past the left chart edge.
  return laneIndex >= laneCount / 2 ? "end" : "start";
}

/**
 * Per-cluster shade within a lane's accent family for the embedding map —
 * same hue, stepped toward white so clusters stay distinguishable on dark.
 */
function clusterShade(accent: string, index: number): string {
  if (index === 0) return accent;
  const accentShare = 100 - Math.min(index, 6) * 12;
  return `color-mix(in oklab, ${accent} ${accentShare}%, white)`;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[Math.min(base + 1, sorted.length - 1)];
  return sorted[base] + (next - sorted[base]) * rest;
}

/**
 * Sutherland–Hodgman clip of a polygon to the axis-aligned square around
 * (cx, cy) — bounds each Voronoi cell so territories don't claim empty space.
 */
function clipPolygonToSquare(
  polygon: Array<[number, number]>,
  cx: number,
  cy: number,
  radius: number,
): Array<[number, number]> {
  let output = polygon;
  const planes: Array<(point: [number, number]) => number> = [
    (point) => point[0] - (cx - radius),
    (point) => cx + radius - point[0],
    (point) => point[1] - (cy - radius),
    (point) => cy + radius - point[1],
  ];
  for (const distance of planes) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i += 1) {
      const a = input[i];
      const b = input[(i + 1) % input.length];
      const da = distance(a);
      const db = distance(b);
      if (da >= 0) output.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        output.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    if (output.length === 0) break;
  }
  return output;
}

function polygonPath(polygon: Array<[number, number]>): string {
  if (polygon.length === 0) return "";
  return `M ${polygon.map((point) => `${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(" L ")} Z`;
}

interface LabelBox {
  id: string;
  y: number;
  x0: number;
  x1: number;
}

/**
 * Places label rows top-down; a label is pushed below an already-placed label
 * only when their horizontal ranges actually intersect, so labels in separate
 * lanes never displace each other.
 */
function buildLabelYPositions(
  boxes: LabelBox[],
  minGap: number,
  minY: number,
  maxY: number,
): Map<string, number> {
  const sorted = boxes.slice().sort((a, b) => a.y - b.y);
  const placed: Array<{ x0: number; x1: number; y: number }> = [];
  const adjusted = new Map<string, number>();

  for (const box of sorted) {
    const collides = (y: number) =>
      placed.some(
        (other) => box.x0 < other.x1 && other.x0 < box.x1 && Math.abs(y - other.y) < minGap,
      );

    // Nearest free slot to the mark, alternating below/above, so leader
    // lines stay short even in a congested column.
    const base = clamp(box.y, minY, maxY);
    let y = base;
    for (let step = 1; collides(y) && step < 40; step += 1) {
      const direction = step % 2 === 1 ? 1 : -1;
      const candidate = base + Math.ceil(step / 2) * minGap * direction;
      if (candidate >= minY && candidate <= maxY) {
        y = candidate;
      }
    }

    placed.push({ x0: box.x0, x1: box.x1, y });
    adjusted.set(box.id, y);
  }

  return adjusted;
}

function SimpleScatterFrame({
  clusters,
  margin,
  children,
}: {
  clusters: ClusterDatum[];
  margin: { top: number; right: number; bottom: number; left: number };
  children: ReactNode;
}) {
  const width = 1120;
  const height = 480;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const times = clusters.map((cluster) => cluster.plotDate.getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const maxValue = Math.max(...clusters.map((cluster) => cluster.plotValue), 1);
  const context = useMemo<LocalChartFrame>(() => {
    const timeSpan = Math.max(maxTime - minTime, 1);
    return {
      innerWidth,
      innerHeight,
      xScale: (date: Date) => ((date.getTime() - minTime) / timeSpan) * innerWidth,
      yScale: (value: number) => innerHeight - (value / (maxValue * 1.08)) * innerHeight,
    };
  }, [innerHeight, innerWidth, maxTime, maxValue, minTime]);

  return (
    <LocalChartContext.Provider value={context}>
      <svg
        className="block h-auto w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <g transform={`translate(${margin.left} ${margin.top})`}>{children}</g>
      </svg>
    </LocalChartContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Journey (dispatch → outcome loop). Per-call state is a pure reduction over
// journey events up to the demo clock; everything below derives from it.
// ---------------------------------------------------------------------------

const STATE_RANK: Record<JourneyState, number> = {
  analyzed: 0,
  held_out: 1,
  suppressed: 1,
  retry_scheduled: 1,
  routed_human: 1,
  recalled: 2,
  dispatched: 3,
  delivered: 4,
  clicked: 5,
  completed: 6,
};

interface CallStateCounts {
  /** Cumulative link funnel over treated calls. */
  sent: number;
  delivered: number;
  clicked: number;
  completed: number;
  /** Re-called (wave 2) but not reached or no in-call send yet. */
  recalled: number;
  heldOut: number;
  completedHoldout: number;
  /** Suppressed / retry-scheduled / routed-to-human. */
  parked: number;
}

function countCallStates(
  callIds: string[],
  states: Map<string, JourneyState>,
  holdoutSet: Set<string>,
): CallStateCounts {
  const counts: CallStateCounts = {
    sent: 0,
    delivered: 0,
    clicked: 0,
    completed: 0,
    recalled: 0,
    heldOut: 0,
    completedHoldout: 0,
    parked: 0,
  };
  for (const callId of callIds) {
    const state = states.get(callId);
    if (!state) continue;
    if (holdoutSet.has(callId)) {
      counts.heldOut += 1;
      if (state === "completed") counts.completedHoldout += 1;
      continue;
    }
    if (state === "suppressed" || state === "retry_scheduled" || state === "routed_human") {
      counts.parked += 1;
      continue;
    }
    if (state === "recalled") counts.recalled += 1;
    const rank = STATE_RANK[state];
    if (rank >= 3) counts.sent += 1;
    if (rank >= 4) counts.delivered += 1;
    if (rank >= 5) counts.clicked += 1;
    if (rank >= 6) counts.completed += 1;
  }
  return counts;
}

interface JourneyAggregates {
  counts: CallStateCounts;
  treatedTotal: number;
  holdoutTotal: number;
  /** Percentage points of completion lift vs holdout; null until holdout is meaningful. */
  liftPts: number | null;
  treatedRate: number;
  holdoutRate: number;
  holdoutFraction: number;
  completedByCluster: Map<string, number>;
}

function computeJourneyAggregates(
  journey: VoiceJourney,
  states: Map<string, JourneyState>,
  clusters: ClusterDatum[],
): JourneyAggregates | null {
  if (!journey.active || journey.virtualNow === null) return null;
  const virtualNow = journey.virtualNow;
  const live = journey.dispatches.filter((dispatch) => Date.parse(dispatch.createdAt) <= virtualNow);
  if (live.length === 0) return null;

  const linkDispatches = live.filter((dispatch) => dispatch.action === "send_kyc_link");
  const holdoutSet = new Set(linkDispatches.flatMap((dispatch) => dispatch.holdoutCallIds));
  const touched = [...new Set(live.flatMap((dispatch) => [...dispatch.callIds, ...dispatch.holdoutCallIds]))];
  const counts = countCallStates(touched, states, holdoutSet);

  const treatedTotal = linkDispatches.reduce((sum, dispatch) => sum + dispatch.callIds.length, 0);
  const holdoutTotal = holdoutSet.size;
  const treatedRate = treatedTotal > 0 ? counts.completed / treatedTotal : 0;
  const holdoutRate = holdoutTotal > 0 ? counts.completedHoldout / holdoutTotal : 0;

  const completedByCluster = new Map<string, number>();
  for (const cluster of clusters) {
    const done = cluster.callIds.reduce(
      (sum, callId) => sum + (states.get(callId) === "completed" ? 1 : 0),
      0,
    );
    if (done > 0) completedByCluster.set(cluster.id, done);
  }

  return {
    counts,
    treatedTotal,
    holdoutTotal,
    // ≥5 keeps the lift line honest but lets it appear on a single-cluster
    // grant (52 calls → 5 holdout) — the demo's first wave.
    liftPts: holdoutTotal >= 5 ? (treatedRate - holdoutRate) * 100 : null,
    treatedRate,
    holdoutRate,
    holdoutFraction: linkDispatches[0]?.holdoutFraction ?? 0,
    completedByCluster,
  };
}

function formatVirtualOffset(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `T+${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function JourneyControlBar({
  journey,
  aggregates,
}: {
  journey: VoiceJourney;
  aggregates: JourneyAggregates;
}) {
  const { range, virtualNow } = journey;
  if (!range || virtualNow === null) return null;
  const atEnd = virtualNow >= range.end;
  const span = Math.max(range.end - range.start, 1);
  // Grant moments annotate the timeline — scrubbing past one shows the next
  // wave igniting.
  const grantTicks = journey.events
    .filter((event) => !isCallEvent(event) && event.type === "capability_granted")
    .map((event) => clamp((Date.parse(event.at) - range.start) / span, 0, 1));

  return (
    <section className="bg-background px-6 py-4 shadow-[inset_0_-1px_0_0_var(--border)]">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <div>
            <p className="text-[9.9px] font-medium uppercase text-muted-foreground">KYC completed</p>
            <p className="text-2xl font-semibold leading-tight tabular-nums">
              {aggregates.counts.completed}
            </p>
          </div>
          <div className="text-xs leading-relaxed text-muted-foreground tabular-nums">
            <p>
              <span className="font-semibold text-foreground">{aggregates.counts.sent}</span> links
              sent · {aggregates.counts.delivered} delivered · {aggregates.counts.clicked} clicked ·{" "}
              <span className="font-semibold text-foreground">{aggregates.counts.completed}</span>{" "}
              KYC done
              {aggregates.counts.recalled > 0 ? ` · ${aggregates.counts.recalled} re-calling` : ""}
              {aggregates.counts.parked > 0 ? ` · ${aggregates.counts.parked} parked` : ""}
            </p>
            <p>
              {aggregates.liftPts !== null
                ? `${formatPercent(aggregates.treatedRate)} completion vs ${formatPercent(aggregates.holdoutRate)} holdout (+${Math.round(aggregates.liftPts)} pts)`
                : "Holdout control accumulating…"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-full px-3 py-1 text-xs font-medium text-foreground shadow-[0_0_0_1px_var(--border)] transition-colors hover:bg-muted"
            onClick={() => (journey.playing ? journey.pause() : journey.play())}
            type="button"
          >
            {journey.playing ? "Pause" : atEnd ? "Replay" : "Play"}
          </button>
          <div className="relative">
            <input
              aria-label="Demo clock"
              className="w-44 accent-foreground"
              max={range.end}
              min={range.start}
              onChange={(event) => journey.scrub(Number(event.target.value))}
              step={60_000}
              type="range"
              value={virtualNow}
            />
            {grantTicks.map((fraction, index) => (
              <span
                className="pointer-events-none absolute -top-1 h-1.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
                key={index}
                style={{ left: `${fraction * 100}%` }}
              />
            ))}
          </div>
          <span className="w-24 text-xs text-muted-foreground tabular-nums">
            {formatVirtualOffset(virtualNow - range.start)}
          </span>
          <button
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={journey.jumpToEnd}
            type="button"
          >
            End
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                type="button"
              >
                Reset
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset the outcome loop?</AlertDialogTitle>
                <AlertDialogDescription>
                  Deletes every grant, dispatch, and simulated outcome for this run. The campaign
                  analysis itself is untouched; capability requests re-derive from it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void journey.reset()}>
                  Reset outcomes
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <p className="mt-2 text-[9.9px] text-muted-foreground">
        Simulated outcome feed (demo) · {Math.round(aggregates.holdoutFraction * 100)}% holdout
        control
      </p>
    </section>
  );
}

/** One vertical band of the triage map — a lane in overview, a cluster in focus mode. */
interface ColumnSpec {
  key: string;
  accent: string;
  footer: string;
  footerStyle: "accent" | "muted";
}

function CampaignTriageOverlay({
  clusters,
  columns,
  selectedId,
  onSelect,
  completedByCluster,
}: {
  clusters: ClusterDatum[];
  columns: ColumnSpec[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  completedByCluster: Map<string, number> | null;
}) {
  const { xScale, yScale, innerWidth, innerHeight } = useLocalChartStable();
  const laneCount = columns.length;

  const chartPoints = clusters.map((cluster) => ({
    cluster,
    x: xScale(cluster.plotDate) ?? 0,
    y: yScale(cluster.plotValue) ?? 0,
  }));

  const labelBoxes = chartPoints.map(({ cluster, x, y }) => {
    const anchor = labelAnchorForLane(cluster.laneIndex, laneCount);
    const labelX = x + (anchor === "end" ? -(cluster.radius + 14) : cluster.radius + 14);
    const estWidth = Math.max(compactText(cluster.shortTitle, 30).length, 18) * 6.4;
    return {
      id: cluster.id,
      y,
      x0: (anchor === "end" ? labelX - estWidth : labelX) - 10,
      x1: (anchor === "end" ? labelX : labelX + estWidth) + 10,
    };
  });
  const labelYById = buildLabelYPositions(labelBoxes, 34, 18, innerHeight - 18);

  return (
    <g>
      {columns.map((column, index) => {
        const previousCenter = index === 0 ? 0 : (xScale(laneDateAt(index - 1)) ?? 0);
        const currentCenter = xScale(laneDateAt(index)) ?? 0;
        const nextCenter = index === laneCount - 1 ? innerWidth : (xScale(laneDateAt(index + 1)) ?? innerWidth);
        const left = index === 0 ? 0 : (previousCenter + currentCenter) / 2;
        const right = index === laneCount - 1 ? innerWidth : (currentCenter + nextCenter) / 2;
        const footerWidth = column.footer.length * 6.4;
        const footerCenter = clamp(currentCenter, footerWidth / 2, innerWidth - footerWidth / 2);

        return (
          <g key={column.key}>
            <rect
              fill="var(--muted)"
              height={innerHeight}
              opacity={index % 2 === 0 ? 0.23 : 0.08}
              width={Math.max(0, right - left)}
              x={left}
              y={0}
            />
            {index > 0 ? (
              <line
                stroke="var(--border)"
                strokeDasharray="2 5"
                strokeWidth={1}
                x1={left}
                x2={left}
                y1={0}
                y2={innerHeight}
              />
            ) : null}
            <text
              fill={column.footerStyle === "accent" ? column.accent : "var(--muted-foreground)"}
              fontSize={11}
              fontWeight={column.footerStyle === "accent" ? 600 : 400}
              opacity={column.footerStyle === "accent" ? 0.9 : 1}
              textAnchor="middle"
              x={footerCenter}
              y={innerHeight + 28}
            >
              {column.footer}
            </text>
          </g>
        );
      })}

      <line
        stroke="var(--border)"
        strokeWidth={1}
        x1={0}
        x2={innerWidth}
        y1={innerHeight}
        y2={innerHeight}
      />

      {chartPoints.map(({ cluster, x, y }) => {
        const anchor = labelAnchorForLane(cluster.laneIndex, laneCount);
        const labelX = x + (anchor === "end" ? -(cluster.radius + 14) : cluster.radius + 14);
        const labelY = labelYById.get(cluster.id) ?? y;
        const selected = cluster.id === selectedId;
        const accent = cluster.accent;
        const done = completedByCluster?.get(cluster.id) ?? 0;

        return (
          <g
            className="cursor-pointer focus:outline-none"
            key={cluster.id}
            onClick={() => onSelect(cluster.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(cluster.id);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <line
              stroke="var(--border)"
              strokeWidth={selected ? 1.4 : 1}
              x1={x}
              x2={labelX + (anchor === "end" ? -4 : 4)}
              y1={y}
              y2={labelY - 7}
            />
            <circle
              cx={x}
              cy={y}
              fill="var(--background)"
              opacity={selected ? 1 : 0.82}
              r={cluster.radius + 4}
              stroke={accent}
              strokeOpacity={selected ? 0.9 : 0.55}
              strokeWidth={selected ? 1.5 : 1}
            />
            <circle
              cx={x}
              cy={y}
              fill={accent}
              opacity={selected ? 0.95 : 0.65}
              r={cluster.radius}
            />
            {done > 0 ? (
              // Bubble fills with completed KYCs — area-true: r ∝ √(done/count).
              <circle
                cx={x}
                cy={y}
                fill="var(--foreground)"
                opacity={0.92}
                pointerEvents="none"
                r={cluster.radius * Math.sqrt(Math.min(done / Math.max(cluster.count, 1), 1))}
              />
            ) : null}
            <text
              fill="var(--foreground)"
              fontSize={11}
              fontWeight={selected ? 700 : 600}
              textAnchor={anchor}
              x={labelX}
              y={labelY - 11}
            >
              {compactText(cluster.shortTitle, 30)}
            </text>
            <text
              fill="var(--muted-foreground)"
              fontSize={10}
              textAnchor={anchor}
              x={labelX}
              y={labelY + 4}
            >
              {cluster.count} calls · {formatPercent(cluster.share)}
              {done > 0 ? ` · ${done} done` : ""}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Focused lane view: every call plotted at its embedding position (UMAP over
 * signal embeddings), shaded by cluster, with cluster labels at centroids.
 */
function EmbeddingMapOverlay({
  lane,
  callMap,
  callZones,
  callDetails,
  totalCalls,
  selectedId,
  onSelect,
  activeCallId,
  onSelectCall,
  callStates,
}: {
  lane: LaneModel;
  callMap: Record<string, { x: number; y: number; zoneId: string | null; laneX: number | null; laneY: number | null }>;
  callZones: VoiceCampaignCallZone[];
  callDetails: Record<string, VoiceCampaignCallDetail>;
  totalCalls: number;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  activeCallId: string | null;
  onSelectCall: (callId: string, clusterId: string) => void;
  callStates: Map<string, JourneyState> | null;
}) {
  const { innerWidth, innerHeight } = useLocalChartStable();
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);

  // Zones for this lane's clusters; fall back to one pseudo-zone per cluster
  // when the run has no zone data.
  const laneClusterIds = new Set(lane.clusters.map((cluster) => cluster.id));
  const fileZones = callZones.filter((zone) => laneClusterIds.has(zone.clusterId));
  const zones: VoiceCampaignCallZone[] =
    fileZones.length > 0
      ? fileZones
      : lane.clusters.map((cluster) => ({
          id: cluster.id,
          clusterId: cluster.id,
          title: cluster.shortTitle,
          count: cluster.count,
        }));
  const shadeByZoneId = new Map(zones.map((zone, index) => [zone.id, clusterShade(lane.accent, index)]));

  const points = lane.clusters.flatMap((cluster) =>
    cluster.callIds
      .filter((callId) => callMap[callId])
      .map((callId) => {
        const entry = callMap[callId];
        const zoneId = entry.zoneId ?? cluster.id;
        return {
          callId,
          cluster,
          zoneId,
          shade: shadeByZoneId.get(zoneId) ?? lane.accent,
          // Lane-local projection when available — the global map packs each
          // lane into a sliver whose internal layout is projection noise.
          x: entry.laneX ?? entry.x,
          y: entry.laneY ?? entry.y,
        };
      }),
  );

  if (points.length === 0) {
    return (
      <text
        fill="var(--muted-foreground)"
        fontSize={13}
        textAnchor="middle"
        x={innerWidth / 2}
        y={innerHeight / 2}
      >
        No embedding map for this run — run scripts/embed-voice-campaign-calls.ts
      </text>
    );
  }

  // Linear rescale of the lane-local projection into the plot. Percentile
  // bounds keep one or two outliers from crushing the main mass.
  const PAD = 36;
  const sortedX = points.map((point) => point.x).sort((a, b) => a - b);
  const sortedY = points.map((point) => point.y).sort((a, b) => a - b);
  const minX = quantile(sortedX, 0.02);
  const maxX = quantile(sortedX, 0.98);
  const minY = quantile(sortedY, 0.02);
  const maxY = quantile(sortedY, 0.98);
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);

  const plotted = points.map((point) => ({
    ...point,
    px: PAD + clamp((point.x - minX) / spanX, 0, 1) * (innerWidth - PAD * 2),
    py: PAD + clamp((point.y - minY) / spanY, 0, 1) * (innerHeight - PAD * 2),
  }));

  const centroids = zones
    .map((zone) => {
      const own = plotted.filter((point) => point.zoneId === zone.id);
      if (own.length === 0) return null;
      // Anchor at the zone's median (densest area), just above the local bulk —
      // bounding-box tops drift toward outliers and detach labels from their dots.
      const ownX = own.map((point) => point.px).sort((a, b) => a - b);
      const ownY = own.map((point) => point.py).sort((a, b) => a - b);
      const estWidth = Math.max(compactText(zone.title, 34).length, 18) * 6.6;
      return {
        zone,
        count: own.length,
        clusterId: own[0].cluster.id,
        shade: shadeByZoneId.get(zone.id) ?? lane.accent,
        cx: clamp(quantile(ownX, 0.5), estWidth / 2 + 4, innerWidth - estWidth / 2 - 4),
        cy: Math.max(quantile(ownY, 0.2) - 20, 16),
      };
    })
    .filter((centroid): centroid is NonNullable<typeof centroid> => centroid !== null);

  const labelBoxes = centroids.map(({ zone, cx, cy }) => {
    const estWidth = Math.max(compactText(zone.title, 34).length, 18) * 6.6;
    return { id: zone.id, y: cy, x0: cx - estWidth / 2 - 10, x1: cx + estWidth / 2 + 10 };
  });
  const labelYById = buildLabelYPositions(labelBoxes, 36, 16, innerHeight - 20);

  // Voronoi mosaic: partition the plane by nearest call, clip each cell to a
  // bounded square around its dot, tint by zone — crisp geometric territories
  // that never overlap, while dot positions stay the real embedding layout.
  const delaunay = Delaunay.from(
    plotted,
    (point) => point.px,
    (point) => point.py,
  );
  const voronoi = delaunay.voronoi([4, 4, innerWidth - 4, innerHeight - 4]);
  const cells = plotted.map((point, index) => {
    const raw = voronoi.cellPolygon(index);
    const polygon = raw
      ? clipPolygonToSquare(raw.slice(0, -1) as Array<[number, number]>, point.px, point.py, 44)
      : [];
    return { point, path: polygonPath(polygon) };
  });

  return (
    <g>
      {cells.map(({ point, path }) => {
        if (!path) return null;
        const emphasized = hoveredZoneId === point.zoneId;
        const muted = hoveredZoneId !== null && !emphasized;
        return (
          <path
            className="cursor-pointer"
            d={path}
            fill={point.shade}
            fillOpacity={emphasized ? 0.18 : muted ? 0.03 : 0.08}
            key={point.callId}
            onClick={() => onSelect(point.cluster.id)}
            onMouseEnter={() => setHoveredZoneId(point.zoneId)}
            onMouseLeave={() => setHoveredZoneId(null)}
            stroke="var(--background)"
            strokeWidth={1.25}
          />
        );
      })}
      {plotted.map((point) => {
        const active = point.callId === activeCallId;
        const zoneHighlighted = hoveredZoneId !== null && point.zoneId === hoveredZoneId;
        const zoneMuted = hoveredZoneId !== null && point.zoneId !== hoveredZoneId;
        const dim = selectedId !== undefined && point.cluster.id !== selectedId;

        // Journey state lights the dot up: ring while in flight (re-call or
        // link delivered), solid foreground core once the KYC completes,
        // dashed for holdout, dimmed when parked (suppressed / retry / human).
        const state = callStates?.get(point.callId);
        const done = state === "completed";
        const clicked = state === "clicked";
        const inFlight = state === "dispatched" || state === "delivered" || state === "recalled";
        const heldOut = state === "held_out";
        const parked =
          state === "suppressed" || state === "retry_scheduled" || state === "routed_human";

        const baseOpacity = active || zoneHighlighted ? 1 : zoneMuted ? 0.15 : dim ? 0.45 : 0.8;
        const stateStroke = done
          ? point.shade
          : clicked
            ? "var(--foreground)"
            : inFlight || heldOut
              ? "var(--muted-foreground)"
              : "transparent";

        return (
          <circle
            className="cursor-pointer transition-opacity hover:opacity-100"
            cx={point.px}
            cy={point.py}
            fill={done ? "var(--foreground)" : point.shade}
            key={point.callId}
            onClick={() => onSelectCall(point.callId, point.cluster.id)}
            opacity={done ? Math.max(baseOpacity, 0.9) : parked ? Math.min(baseOpacity, 0.2) : baseOpacity}
            r={(active ? 6.5 : zoneHighlighted ? 5.5 : 4.5) + (done ? 1 : clicked ? 0.5 : 0)}
            stroke={active ? "var(--foreground)" : stateStroke}
            strokeDasharray={!active && heldOut ? "1.5 2" : undefined}
            strokeWidth={active ? 1.5 : done || clicked ? 1.25 : inFlight || heldOut ? 0.9 : 0}
          >
            <title>
              {(callDetails[point.callId]?.primarySignal ?? point.callId) +
                (state ? ` — ${state.replace(/_/g, " ")}` : "")}
            </title>
          </circle>
        );
      })}

      {centroids.map(({ zone, count, clusterId, shade, cx }) => {
        const labelY = labelYById.get(zone.id) ?? 0;
        const selected = clusterId === selectedId;
        return (
          <g
            className="cursor-pointer focus:outline-none"
            key={zone.id}
            onClick={() => onSelect(clusterId)}
            onMouseEnter={() => setHoveredZoneId(zone.id)}
            onMouseLeave={() => setHoveredZoneId(null)}
            role="button"
            tabIndex={0}
          >
            <text
              fill={shade}
              fontSize={12}
              fontWeight={selected ? 700 : 600}
              paintOrder="stroke"
              stroke="var(--background)"
              strokeWidth={4}
              textAnchor="middle"
              x={cx}
              y={labelY - 4}
            >
              {compactText(zone.title, 34)}
            </text>
            <text
              fill="var(--muted-foreground)"
              fontSize={10}
              paintOrder="stroke"
              stroke="var(--background)"
              strokeWidth={3}
              textAnchor="middle"
              x={cx}
              y={labelY + 11}
            >
              {count} calls · {formatPercent(count / Math.max(totalCalls, 1))}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function LaneStrip({
  lanes,
  focusedLaneId,
  onFocusLane,
}: {
  lanes: LaneModel[];
  focusedLaneId: LaneId | null;
  onFocusLane: (laneId: LaneId | null) => void;
}) {
  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {lanes.map((lane) => {
        const active = lane.id === focusedLaneId;
        const dimmed = focusedLaneId !== null && !active;
        return (
          <button
            className={`group min-w-0 py-1 text-left transition-opacity ${dimmed ? "opacity-40 hover:opacity-90" : ""}`}
            key={lane.id}
            onClick={() => onFocusLane(active ? null : lane.id)}
            type="button"
          >
            <span
              className={`inline-block rounded-full px-2.5 py-1 text-sm font-semibold transition-shadow group-hover:shadow-[0_0_0_1px_currentColor] ${lane.chip}`}
              style={active ? { boxShadow: `0 0 0 1px ${lane.accent}` } : undefined}
            >
              {lane.compactLabel}
            </span>
            <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
              {lane.total} calls · {formatPercent(lane.share)}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function SignalArchitecture({
  clusters,
  lanes,
  mapCaption,
  focusedLaneId,
  onFocusLane,
  callDetails,
  callMap,
  callZones,
  totalCalls,
  selectedId,
  onSelect,
  activeCallId,
  onSelectCall,
  callStates,
  completedByCluster,
}: {
  clusters: ClusterDatum[];
  lanes: LaneModel[];
  mapCaption: string;
  focusedLaneId: LaneId | null;
  onFocusLane: (laneId: LaneId | null) => void;
  callDetails: Record<string, VoiceCampaignCallDetail>;
  callMap: Record<string, { x: number; y: number; zoneId: string | null; laneX: number | null; laneY: number | null }>;
  callZones: VoiceCampaignCallZone[];
  totalCalls: number;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  activeCallId: string | null;
  onSelectCall: (callId: string, clusterId: string) => void;
  callStates: Map<string, JourneyState> | null;
  completedByCluster: Map<string, number> | null;
}) {
  const focusedLane = lanes.find((lane) => lane.id === focusedLaneId);
  const columns: ColumnSpec[] = lanes.map((lane) => ({
    key: lane.id,
    accent: lane.accent,
    footer: lane.compactLabel,
    footerStyle: "accent" as const,
  }));

  return (
    <section className="bg-background shadow-[inset_0_1px_0_0_var(--border),inset_0_-1px_0_0_var(--border)]">
      <div className="px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            {focusedLane ? (
              <div className="flex items-center gap-3">
                <button
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => onFocusLane(null)}
                  type="button"
                >
                  &larr; All Signals
                </button>
                <p className="text-sm font-semibold">{focusedLane.compactLabel}</p>
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold">Signal architecture</p>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {mapCaption || "Clusters are grouped into lanes discovered from this run's calls."}
                </p>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {focusedLane
              ? callStates
                ? "Dots light up as outcomes land: ring = in flight, solid = KYC done."
                : "Each dot is one call, positioned by signal similarity."
              : completedByCluster
                ? "Bubbles fill as KYC completions land."
                : "Size and position encode affected call volume."}
          </p>
        </div>

        <LaneStrip focusedLaneId={focusedLaneId} lanes={lanes} onFocusLane={onFocusLane} />

        <div className="mt-4 overflow-hidden">
          <SimpleScatterFrame clusters={clusters} margin={{ top: 34, right: 24, bottom: 52, left: 24 }}>
            {focusedLane ? (
              <EmbeddingMapOverlay
                activeCallId={activeCallId}
                callDetails={callDetails}
                callMap={callMap}
                callStates={callStates}
                callZones={callZones}
                lane={focusedLane}
                onSelect={onSelect}
                onSelectCall={onSelectCall}
                selectedId={selectedId}
                totalCalls={totalCalls}
              />
            ) : (
              <CampaignTriageOverlay
                clusters={clusters}
                columns={columns}
                completedByCluster={completedByCluster}
                onSelect={onSelect}
                selectedId={selectedId}
              />
            )}
          </SimpleScatterFrame>
        </div>
      </div>
    </section>
  );
}

export function VoiceCampaignClusterVisualization({
  insights,
  tableOnly = false,
}: {
  insights: VoiceCampaignInsightsPayload;
  tableOnly?: boolean;
}) {
  const laneConfigs = useMemo(() => toLaneConfigs(insights.lanes), [insights.lanes]);
  const clusters = useMemo(
    () => toClusterData(insights.clusters, laneConfigs),
    [insights.clusters, laneConfigs],
  );
  const lanes = useMemo(
    () => buildLanes(clusters, insights.calls, laneConfigs),
    [clusters, insights.calls, laneConfigs],
  );
  const [selectedId, setSelectedId] = useState(clusters[0]?.id);
  const [focusedLaneId, setFocusedLaneId] = useState<LaneId | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const selectedCluster = clusters.find((cluster) => cluster.id === selectedId) ?? clusters[0];

  const journey = useVoiceJourney(insights.runId);
  const visibleEvents = useMemo(() => {
    const virtualNow = journey.virtualNow;
    if (virtualNow === null) return [];
    return journey.events.filter((event) => Date.parse(event.at) <= virtualNow);
  }, [journey.events, journey.virtualNow]);
  const callStates = useMemo(() => reduceJourneyStates(visibleEvents), [visibleEvents]);
  const aggregates = useMemo(
    () => computeJourneyAggregates(journey, callStates, clusters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [journey.dispatches, journey.virtualNow, journey.active, journey.profile, callStates, clusters],
  );

  const [view, setView] = useState<CohortView>("table");

  useEffect(() => {
    setView("table");
  }, [insights.runId]);

  const cohortSources = useMemo<CohortSource[]>(
    () =>
      clusters.map((cluster) => ({
        id: cluster.id,
        title: cluster.title,
        shortTitle: cluster.shortTitle,
        laneId: cluster.laneId,
        laneLabel: cluster.laneCompactLabel,
        accent: cluster.accent,
        count: cluster.count,
        share: cluster.share,
        confidence: cluster.confidence,
        outcomeMix: cluster.outcomeMix,
        callIds: cluster.callIds,
        topQuote: cluster.evidenceQuotes[0],
      })),
    [clusters],
  );

  const cohortRequests = useMemo<CohortRequestInfo[]>(
    () =>
      journey.requests
        .filter((request) => "clusterId" in request.scope)
        .map((request) => ({
          clusterId: (request.scope as { clusterId: string }).clusterId,
          capability: request.capability,
          projectedMoved: request.evidence.projectedMoved,
          movedLabel: request.evidence.movedLabel,
          status: request.status,
        })),
    [journey.requests],
  );

  const cohortVMs = useMemo(
    () => buildCohortVMs(cohortSources, cohortRequests, callStates),
    [cohortSources, cohortRequests, callStates],
  );

  const handleFocusLane = (laneId: LaneId | null) => {
    setFocusedLaneId(laneId);
    setActiveCallId(null);
    if (!laneId) return;
    const lane = lanes.find((entry) => entry.id === laneId);
    if (lane && !lane.clusters.some((cluster) => cluster.id === selectedId)) {
      setSelectedId(lane.clusters[0]?.id);
    }
  };

  const handleSelectCall = (callId: string, clusterId: string) => {
    setActiveCallId(callId);
    setSelectedId(clusterId);
  };

  if (!selectedCluster) {
    // Legacy artifacts have no lane data — explain instead of rendering nothing.
    return (
      <div className="rounded-lg bg-background px-6 py-10 text-center shadow-[0_0_0_1px_var(--border)]">
        <p className="text-sm text-muted-foreground">
          This run predates lane discovery — re-run scripts/analyze-voice-campaign-logs.ts to
          generate lanes and clusters for this view.
        </p>
      </div>
    );
  }

  const activeCallDetail = activeCallId ? insights.callDetails[activeCallId] : undefined;
  const activeCallCluster = activeCallId
    ? clusters.find((cluster) => cluster.callIds.includes(activeCallId))
    : undefined;

  return (
    <div className="overflow-hidden rounded-lg bg-background shadow-[0_0_0_1px_var(--border)]">
      {aggregates ? <JourneyControlBar aggregates={aggregates} journey={journey} /> : null}
      <div className="bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
          <div>
            <p className="text-sm font-semibold">Cohort intelligence</p>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {insights.calls} calls · {clusters.length} cohorts · {lanes.length} lanes
            </p>
          </div>
          {tableOnly ? null : <CohortViewSwitcher onChange={setView} view={view} />}
        </div>
        {!tableOnly && view === "map" ? (
          <div className="mt-4">
            <SignalArchitecture
              activeCallId={activeCallId}
              callDetails={insights.callDetails}
              callMap={insights.callMap}
              callStates={aggregates ? callStates : null}
              callZones={insights.callZones}
              clusters={clusters}
              completedByCluster={aggregates ? aggregates.completedByCluster : null}
              totalCalls={insights.calls}
              focusedLaneId={focusedLaneId}
              lanes={lanes}
              mapCaption={insights.mapCaption}
              onFocusLane={handleFocusLane}
              onSelect={setSelectedId}
              onSelectCall={handleSelectCall}
              selectedId={selectedCluster.id}
            />
          </div>
        ) : (
          <div className="px-6 py-5">
            <CohortViewBody
              callDetails={insights.callDetails}
              cohorts={cohortVMs}
              onOpenCall={setActiveCallId}
              onSelect={setSelectedId}
              selectedId={selectedCluster.id}
              view={view === "map" ? "table" : view}
            />
          </div>
        )}
      </div>
      {activeCallId && activeCallCluster ? (
        <VoiceCallDeepDive
          callId={activeCallId}
          cohortTitle={activeCallCluster.title}
          detail={activeCallDetail}
          laneChip={activeCallCluster.chip}
          laneLabel={activeCallCluster.laneCompactLabel}
          onClose={() => setActiveCallId(null)}
          runId={insights.runId}
        />
      ) : null}
    </div>
  );
}
