"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

// Adjacent rows sit exactly one VERTICAL_GAP apart handle-to-handle; anything
// beyond that is a skip edge crossing card rows.
const LONG_SPAN = 260;
// Skip-edge geometry: short stub below the source, side corridor clear of the
// down-left cascading spine, approach stub above the target.
const STUB = 40;
const CORRIDOR_OFFSET = 90;
const RIGHTWARD_MIN = 200;

// Handle-anchored orthogonal edge with sharp corners. Adjacent-row edges use
// the standard step path (label at the midpoint, which is always inside the
// row gap). Skip edges get a custom corridor route: the default step path put
// its horizontal run — and the condition label — in the middle of the span,
// straight across intermediate cards.
function VoiceStepEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  label,
}: EdgeProps) {
  let edgePath: string;
  let labelX: number;
  let labelY: number;
  // Corridor labels anchor their left edge at the corridor corner so wide
  // pills grow rightward into open space, clear of the spine edge's own label.
  let anchorLeft = false;
  // Adjacent-row labels stretch to cover the mid-gap horizontal jog, so the
  // edge reads as two clean verticals (the jog hides under the pill).
  let labelMinWidth: number | undefined;

  if (targetY - sourceY > LONG_SPAN) {
    const jogY = sourceY + STUB;
    const approachY = targetY - STUB;
    if (targetX >= sourceX + RIGHTWARD_MIN) {
      // Target already sits in the open right-hand space — drop, run right,
      // then descend straight into it.
      edgePath = `M ${sourceX},${sourceY} L ${sourceX},${jogY} L ${targetX},${jogY} L ${targetX},${targetY}`;
      labelX = (sourceX + targetX) / 2;
    } else {
      // Descend beside the spine: the cascade drifts every later card left,
      // so a corridor slightly right of the source stays clear of them.
      const corridorX = sourceX + CORRIDOR_OFFSET;
      edgePath =
        `M ${sourceX},${sourceY} L ${sourceX},${jogY} L ${corridorX},${jogY}` +
        ` L ${corridorX},${approachY} L ${targetX},${approachY} L ${targetX},${targetY}`;
      labelX = corridorX;
      anchorLeft = true;
    }
    labelY = jogY;
  } else if (Math.abs(targetX - sourceX) < 4) {
    // Aligned handles: a dead-straight drop, no step artifacts.
    edgePath = `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = (sourceY + targetY) / 2;
  } else {
    [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 0,
    });
    labelMinWidth = Math.min(Math.abs(targetX - sourceX) + 28, 240);
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: "color-mix(in srgb, var(--color-muted-foreground) 55%, transparent)",
          strokeWidth: 1.2,
          strokeDasharray: "4 4",
          ...style,
        }}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none rounded-md border border-border bg-background px-2 py-1 text-center text-[9.9px] font-medium text-foreground shadow-sm"
            style={{
              position: "absolute",
              transform: `translate(${anchorLeft ? "8px" : "-50%"}, -50%) translate(${labelX}px, ${labelY}px)`,
              minWidth: labelMinWidth,
              // Above the node layer — condition labels must never hide behind cards.
              zIndex: 10,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const VoiceStepEdge = memo(VoiceStepEdgeInner);
