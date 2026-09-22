import { Position, type InternalNode } from "@xyflow/react";

function getNodeIntersection(intersectionNode: InternalNode, targetNode: InternalNode) {
  const { width: iw = 0, height: ih = 0 } = intersectionNode.measured;
  const iPos = intersectionNode.internals.positionAbsolute;
  const tPos = targetNode.internals.positionAbsolute;
  const { width: tw = 0, height: th = 0 } = targetNode.measured;

  const w = iw / 2;
  const h = ih / 2;

  const x2 = iPos.x + w;
  const y2 = iPos.y + h;
  const x1 = tPos.x + tw / 2;
  const y1 = tPos.y + th / 2;

  const xx1 = (x1 - x2) / (2 * w || 1) - (y1 - y2) / (2 * h || 1);
  const yy1 = (x1 - x2) / (2 * w || 1) + (y1 - y2) / (2 * h || 1);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  const x = w * (xx3 + yy3) + x2;
  const y = h * (-xx3 + yy3) + y2;

  return { x, y };
}

function getEdgePosition(node: InternalNode, intersectionPoint: { x: number; y: number }) {
  const n = node.internals.positionAbsolute;
  const { width: nw = 0, height: nh = 0 } = node.measured;
  const nx = Math.round(n.x);
  const ny = Math.round(n.y);
  const px = Math.round(intersectionPoint.x);
  const py = Math.round(intersectionPoint.y);

  if (px <= nx + 1) return Position.Left;
  if (px >= nx + nw - 1) return Position.Right;
  if (py <= ny + 1) return Position.Top;
  if (py >= ny + nh - 1) return Position.Bottom;

  return Position.Top;
}

export function getEdgeParams(source: InternalNode, target: InternalNode) {
  const sourceIntersectionPoint = getNodeIntersection(source, target);
  const targetIntersectionPoint = getNodeIntersection(target, source);

  const sourcePos = getEdgePosition(source, sourceIntersectionPoint);
  const targetPos = getEdgePosition(target, targetIntersectionPoint);

  return {
    sx: sourceIntersectionPoint.x,
    sy: sourceIntersectionPoint.y,
    tx: targetIntersectionPoint.x,
    ty: targetIntersectionPoint.y,
    sourcePos,
    targetPos,
  };
}
