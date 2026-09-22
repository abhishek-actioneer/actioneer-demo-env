"use client";

import { useMemo, useState } from "react";
import type { CohortVM, CohortStage } from "./voice-cohort-model";
import { STAGE_LABEL, STAGE_ORDER, formatPercentShare } from "./voice-cohort-model";

// ---------------------------------------------------------------------------
// Hand-rolled 3-column Sankey: All calls → lanes → stage buckets.
// No d3-sankey. Node y-positions are stacked per column; ribbon thickness in
// px is proportional to flow count over the usable height of the source column.
// ---------------------------------------------------------------------------

const VIEW_W = 960;
const VIEW_H = 460;
const PAD_Y = 28;
const NODE_W = 16;

const COL_X = {
  all: 36,
  laneIn: 320, // left edge of lane nodes
  stageIn: 760, // left edge of stage nodes
};

const USABLE_H = VIEW_H - PAD_Y * 2;

interface LaneNode {
  laneId: string;
  laneLabel: string;
  accent: string;
  count: number;
  cohortIds: string[];
  // per-stage breakdown of this lane's cohort.count
  stageCount: Record<CohortStage, number>;
  // sum of `completed` across this lane's cohorts (granted progressions)
  completedSum: number;
  y: number;
  h: number;
}

interface StageNode {
  stage: CohortStage;
  count: number;
  y: number;
  h: number;
}

/** Cubic-bezier filled ribbon between two vertical segments on adjacent columns. */
function ribbonPath(
  x0: number,
  yTop0: number,
  yBot0: number,
  x1: number,
  yTop1: number,
  yBot1: number,
): string {
  const mx = (x0 + x1) / 2;
  return [
    `M ${x0} ${yTop0}`,
    `C ${mx} ${yTop0}, ${mx} ${yTop1}, ${x1} ${yTop1}`,
    `L ${x1} ${yBot1}`,
    `C ${mx} ${yBot1}, ${mx} ${yBot0}, ${x0} ${yBot0}`,
    "Z",
  ].join(" ");
}

export function CohortSankey({
  cohorts,
  selectedId,
  onSelect,
}: {
  cohorts: CohortVM[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [hoverLane, setHoverLane] = useState<string | null>(null);

  const model = useMemo(() => {
    const totalCount = cohorts.reduce((sum, c) => sum + c.count, 0) || 1;

    // --- Group cohorts into lanes (preserve first-seen order) ---
    const laneOrder: string[] = [];
    const laneMap = new Map<string, LaneNode>();
    for (const c of cohorts) {
      let lane = laneMap.get(c.laneId);
      if (!lane) {
        lane = {
          laneId: c.laneId,
          laneLabel: c.laneLabel,
          accent: c.accent,
          count: 0,
          cohortIds: [],
          stageCount: { no_contact: 0, stuck: 0, dead_end: 0, completed: 0 },
          completedSum: 0,
          y: 0,
          h: 0,
        };
        laneMap.set(c.laneId, lane);
        laneOrder.push(c.laneId);
      }
      lane.count += c.count;
      lane.cohortIds.push(c.id);
      lane.stageCount[c.stage] += c.count;
      lane.completedSum += c.completed;
    }
    const lanes = laneOrder.map((id) => laneMap.get(id)!);

    // --- Stage node sizing ---
    // no_contact / stuck / dead_end height ∝ total cohort.count with that stage;
    // completed height ∝ sum of `completed` across all cohorts.
    const stageCount: Record<CohortStage, number> = {
      no_contact: 0,
      stuck: 0,
      dead_end: 0,
      completed: 0,
    };
    for (const c of cohorts) {
      if (c.stage !== "completed") stageCount[c.stage] += c.count;
    }
    stageCount.completed = cohorts.reduce((sum, c) => sum + c.completed, 0);

    // --- Vertical stacking helper ---
    function stack(
      entries: Array<{ count: number }>,
    ): Array<{ y: number; h: number }> {
      const denom = entries.reduce((s, e) => s + e.count, 0) || 1;
      const gapCount = Math.max(entries.length - 1, 0);
      const gapPx = 8;
      const drawH = USABLE_H - gapPx * gapCount;
      const out: Array<{ y: number; h: number }> = [];
      let cursor = PAD_Y;
      for (const e of entries) {
        const h = Math.max((e.count / denom) * drawH, 2);
        out.push({ y: cursor, h });
        cursor += h + gapPx;
      }
      return out;
    }

    // Lane column stacks by lane.count (== usable height total of all lanes).
    const laneLayout = stack(lanes.map((l) => ({ count: l.count })));
    lanes.forEach((l, i) => {
      l.y = laneLayout[i].y;
      l.h = laneLayout[i].h;
    });

    // Stage column stacks by stage node count.
    const stages: StageNode[] = STAGE_ORDER.map((stage) => ({
      stage,
      count: stageCount[stage],
      y: 0,
      h: 0,
    }));
    const stageLayout = stack(stages.map((s) => ({ count: s.count })));
    stages.forEach((s, i) => {
      s.y = stageLayout[i].y;
      s.h = stageLayout[i].h;
    });

    return { totalCount, lanes, stages };
  }, [cohorts]);

  const { totalCount, lanes, stages } = model;

  // "All calls" node spans the full usable height.
  const allY = PAD_Y;
  const allH = USABLE_H;

  // Map stage → its node for cursor lookups when laying flows.
  const stageById = new Map(stages.map((s) => [s.stage, s]));

  // Build All→lane ribbons. Track a cursor down the right edge of the All node.
  const allFlows: Array<{ laneId: string; accent: string; path: string }> = [];
  let allCursor = allY;
  for (const lane of lanes) {
    const thickness = (lane.count / totalCount) * allH;
    const yTop0 = allCursor;
    const yBot0 = allCursor + thickness;
    allCursor = yBot0;
    allFlows.push({
      laneId: lane.laneId,
      accent: lane.accent,
      path: ribbonPath(
        COL_X.all + NODE_W,
        yTop0,
        yBot0,
        COL_X.laneIn,
        lane.y,
        lane.y + lane.h,
      ),
    });
  }

  // Build lane→stage ribbons. Each lane distributes its height across stages by
  // stageCount; the completed slice is sized by the lane's completedSum.
  // Track a cursor down each stage node's left edge.
  const stageCursor: Record<CohortStage, number> = {
    no_contact: stageById.get("no_contact")!.y,
    stuck: stageById.get("stuck")!.y,
    dead_end: stageById.get("dead_end")!.y,
    completed: stageById.get("completed")!.y,
  };

  type LaneStageFlow = {
    laneId: string;
    stage: CohortStage;
    accent: string;
    path: string;
  };
  const laneStageFlows: LaneStageFlow[] = [];

  for (const lane of lanes) {
    // Cursor down the lane's right edge.
    let laneCursor = lane.y;
    const laneRight = COL_X.laneIn + NODE_W;

    // Outgoing slices: the three non-completed stage buckets sized by share of
    // lane.count, plus a completed slice sized by completedSum.
    const slices: Array<{ stage: CohortStage; count: number }> = [];
    for (const stage of STAGE_ORDER) {
      if (stage === "completed") {
        if (lane.completedSum > 0) slices.push({ stage, count: lane.completedSum });
      } else if (lane.stageCount[stage] > 0) {
        slices.push({ stage, count: lane.stageCount[stage] });
      }
    }
    // Total flow leaving the lane (may differ from lane.count because completed
    // is an overlay sized by live granting). Scale slices to lane height.
    const sliceTotal = slices.reduce((s, sl) => s + sl.count, 0) || 1;

    for (const slice of slices) {
      const thickness = (slice.count / sliceTotal) * lane.h;
      const yTop0 = laneCursor;
      const yBot0 = laneCursor + thickness;
      laneCursor = yBot0;

      // Thickness on the stage side proportional to share of that stage node.
      const stageNode = stageById.get(slice.stage)!;
      const stageThickness =
        stageNode.count > 0 ? (slice.count / stageNode.count) * stageNode.h : 2;
      const yTop1 = stageCursor[slice.stage];
      const yBot1 = yTop1 + stageThickness;
      stageCursor[slice.stage] = yBot1;

      laneStageFlows.push({
        laneId: lane.laneId,
        stage: slice.stage,
        accent: lane.accent,
        path: ribbonPath(laneRight, yTop0, yBot0, COL_X.stageIn, yTop1, yBot1),
      });
    }
  }

  const isLaneActive = (laneId: string) =>
    hoverLane === null || hoverLane === laneId;

  const selectedLaneId = useMemo(() => {
    if (!selectedId) return null;
    const c = cohorts.find((cohort) => cohort.id === selectedId);
    return c?.laneId ?? null;
  }, [selectedId, cohorts]);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      height={VIEW_H}
      role="img"
      aria-label="Cohort flow from all calls through lanes to stage outcomes"
      style={{ display: "block" }}
    >
      {/* All → lane ribbons */}
      {allFlows.map((flow) => (
        <path
          key={`all-${flow.laneId}`}
          d={flow.path}
          fill={flow.accent}
          fillOpacity={isLaneActive(flow.laneId) ? 0.25 : 0.06}
          style={{ transition: "fill-opacity 120ms ease" }}
        />
      ))}

      {/* Lane → stage ribbons */}
      {laneStageFlows.map((flow, i) => (
        <path
          key={`ls-${flow.laneId}-${flow.stage}-${i}`}
          d={flow.path}
          fill={flow.accent}
          fillOpacity={
            flow.stage === "completed"
              ? isLaneActive(flow.laneId)
                ? 0.18
                : 0.05
              : isLaneActive(flow.laneId)
                ? 0.25
                : 0.06
          }
          style={{ transition: "fill-opacity 120ms ease" }}
        />
      ))}

      {/* All calls node */}
      <rect
        x={COL_X.all}
        y={allY}
        width={NODE_W}
        height={allH}
        rx={3}
        fill="var(--foreground)"
        fillOpacity={0.7}
      />
      <text
        x={COL_X.all}
        y={allY - 8}
        fontSize={12}
        fill="var(--foreground)"
        stroke="var(--background)"
        strokeWidth={3}
        paintOrder="stroke"
        fontWeight={600}
      >
        All calls
      </text>
      <text
        x={COL_X.all}
        y={allY + allH + 16}
        fontSize={11}
        fill="var(--muted-foreground)"
        stroke="var(--background)"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {totalCount.toLocaleString()}
      </text>

      {/* Lane nodes */}
      {lanes.map((lane) => {
        const active = isLaneActive(lane.laneId);
        const selected = selectedLaneId === lane.laneId;
        const firstCohort = lane.cohortIds[0];
        return (
          <g
            key={`lane-${lane.laneId}`}
            style={{ cursor: firstCohort ? "pointer" : "default" }}
            onMouseEnter={() => setHoverLane(lane.laneId)}
            onMouseLeave={() => setHoverLane(null)}
            onClick={() => {
              if (firstCohort) onSelect(firstCohort);
            }}
          >
            <rect
              x={COL_X.laneIn}
              y={lane.y}
              width={NODE_W}
              height={lane.h}
              rx={3}
              fill={lane.accent}
              fillOpacity={active ? 0.7 : 0.3}
              stroke={selected ? "var(--foreground)" : "transparent"}
              strokeWidth={selected ? 1.5 : 0}
            />
            <text
              x={COL_X.laneIn + NODE_W + 8}
              y={lane.y + lane.h / 2 - 2}
              fontSize={12}
              fill="var(--foreground)"
              stroke="var(--background)"
              strokeWidth={3}
              paintOrder="stroke"
              fontWeight={selected ? 600 : 500}
              dominantBaseline="middle"
            >
              {lane.laneLabel}
            </text>
            <text
              x={COL_X.laneIn + NODE_W + 8}
              y={lane.y + lane.h / 2 + 13}
              fontSize={11}
              fill="var(--muted-foreground)"
              stroke="var(--background)"
              strokeWidth={3}
              paintOrder="stroke"
              dominantBaseline="middle"
            >
              {lane.count.toLocaleString()} ·{" "}
              {formatPercentShare(lane.count / totalCount)}
            </text>
          </g>
        );
      })}

      {/* Stage nodes */}
      {stages.map((stageNode) => (
        <g key={`stage-${stageNode.stage}`}>
          <rect
            x={COL_X.stageIn}
            y={stageNode.y}
            width={NODE_W}
            height={stageNode.h}
            rx={3}
            fill="var(--foreground)"
            fillOpacity={0.7}
          />
          <text
            x={COL_X.stageIn - 8}
            y={stageNode.y + stageNode.h / 2 - 2}
            fontSize={12}
            fill="var(--foreground)"
            stroke="var(--background)"
            strokeWidth={3}
            paintOrder="stroke"
            textAnchor="end"
            dominantBaseline="middle"
            fontWeight={500}
          >
            {STAGE_LABEL[stageNode.stage]}
          </text>
          <text
            x={COL_X.stageIn - 8}
            y={stageNode.y + stageNode.h / 2 + 13}
            fontSize={11}
            fill="var(--muted-foreground)"
            stroke="var(--background)"
            strokeWidth={3}
            paintOrder="stroke"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {stageNode.count.toLocaleString()}
          </text>
        </g>
      ))}
    </svg>
  );
}
