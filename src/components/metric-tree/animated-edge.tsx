import { memo } from "react";
import {
  getBezierPath,
  useInternalNode,
  BaseEdge,
  type EdgeProps,
} from "@xyflow/react";
import { getEdgeParams } from "./floating-edge-utils";

function AnimatedEdgeInner({
  id,
  source,
  target,
  style,
  data,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) return null;

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode,
  );

  const [edgePath] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
    targetX: tx,
    targetY: ty,
  });

  const relType = (data as { relType?: string })?.relType;
  const isInfluence = relType === "influence";
  const color = "var(--color-muted-foreground)";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: color,
          strokeWidth: isInfluence ? 1 : 1.5,
          opacity: isInfluence ? 0.2 : 0.35,
          strokeDasharray: isInfluence ? "3 4" : "6 4",
        }}
      />
      {/* Moving arrow along the path */}
      <path
        d="M-4,-3.5 L4,0 L-4,3.5 Z"
        fill={color}
        opacity={isInfluence ? 0.25 : 0.45}
      >
        <animateMotion
          dur={isInfluence ? "8s" : "6s"}
          repeatCount="indefinite"
          path={edgePath}
          rotate="auto"
        />
      </path>
    </>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeInner);
