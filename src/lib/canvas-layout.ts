/* ── Canvas layout utilities (pure functions) ── */

import type { CanvasCardPlan } from "./canvas-sse-types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/* ── Preset sizes ── */
export const PRESETS: Size[] = [
  { width: 360, height: 200 },  // Small
  { width: 450, height: 340 },  // Medium
  { width: 640, height: 460 },  // Large
];

export const DEFAULT_SIZE: Record<string, Size> = {
  chart:   { width: 480, height: 360 },
  report:  { width: 480, height: 340 },
  insight: { width: 400, height: 220 },
  sql:     { width: 420, height: 240 },
  table:   { width: 520, height: 420 },
  text:    { width: 420, height: 260 },
  metric:  { width: 380, height: 200 },
  segment: { width: 400, height: 220 },
  parameter: { width: 320, height: 200 },
  sticky:  { width: 200, height: 150 },
};

export const GAP = 10;

/** Snap a size to the nearest preset by Euclidean distance. */
export function snapToPreset(current: Size): Size {
  let best = PRESETS[0];
  let bestDist = Infinity;
  for (const p of PRESETS) {
    const d = Math.hypot(current.width - p.width, current.height - p.height);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** Check if two rects overlap (with optional gap padding). */
function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/** Check if a candidate rect overlaps ANY existing rect. */
function overlapsAny(candidate: Rect, existing: Rect[], gap: number): boolean {
  return existing.some((r) => rectsOverlap(candidate, r, gap));
}

/**
 * Find a packed position for a new card near existing cards.
 * Tries right/bottom edges of each existing shape, then below/right of cluster.
 */
export function findPackedPosition(
  existingBounds: Rect[],
  newSize: Size,
  gap: number = GAP
): Point {
  // Empty canvas — place at top-left with padding
  if (existingBounds.length === 0) {
    return { x: gap, y: gap };
  }

  // Compute cluster bounding box
  let clusterLeft = Infinity, clusterTop = Infinity;
  let clusterRight = -Infinity, clusterBottom = -Infinity;
  for (const r of existingBounds) {
    clusterLeft = Math.min(clusterLeft, r.x);
    clusterTop = Math.min(clusterTop, r.y);
    clusterRight = Math.max(clusterRight, r.x + r.width);
    clusterBottom = Math.max(clusterBottom, r.y + r.height);
  }
  const clusterCenterX = (clusterLeft + clusterRight) / 2;
  const clusterCenterY = (clusterTop + clusterBottom) / 2;

  // Generate candidate positions
  const candidates: Point[] = [];

  for (const r of existingBounds) {
    // Right of this shape (aligned to its top)
    candidates.push({ x: r.x + r.width + gap, y: r.y });
    // Below this shape (aligned to its left)
    candidates.push({ x: r.x, y: r.y + r.height + gap });
  }

  // Below the entire cluster (left-aligned)
  candidates.push({ x: clusterLeft, y: clusterBottom + gap });
  // Right of the entire cluster (top-aligned)
  candidates.push({ x: clusterRight + gap, y: clusterTop });

  // Filter valid candidates (no overlap) and pick closest to cluster center
  let bestPoint: Point | null = null;
  let bestDist = Infinity;

  for (const pt of candidates) {
    const candidateRect: Rect = { ...pt, ...newSize };
    if (!overlapsAny(candidateRect, existingBounds, gap)) {
      const dist = Math.hypot(
        pt.x + newSize.width / 2 - clusterCenterX,
        pt.y + newSize.height / 2 - clusterCenterY
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = pt;
      }
    }
  }

  // Fallback: below the cluster, left-aligned
  return bestPoint ?? { x: clusterLeft, y: clusterBottom + gap };
}

/**
 * Resolve overlap for a dropped shape by computing minimum translation.
 * Returns new position, or null if no overlap exists.
 * Uses 1 retry with fallback to findPackedPosition.
 */
export function resolveCollision(
  shapeBounds: Rect,
  allBounds: Rect[],
  gap: number = GAP
): Point | null {
  // Filter out the shape itself (by position identity)
  const others = allBounds.filter(
    (r) =>
      !(r.x === shapeBounds.x && r.y === shapeBounds.y &&
        r.width === shapeBounds.width && r.height === shapeBounds.height)
  );

  const resolve = (bounds: Rect): Point | null => {
    const overlapping = others.filter((r) => rectsOverlap(bounds, r, 0));
    if (overlapping.length === 0) return null;

    // Compute combined minimum translation vector
    let dx = 0;
    let dy = 0;
    for (const other of overlapping) {
      // Four possible escape directions
      const pushLeft = other.x - (bounds.x + bounds.width) - gap;
      const pushRight = other.x + other.width + gap - bounds.x;
      const pushUp = other.y - (bounds.y + bounds.height) - gap;
      const pushDown = other.y + other.height + gap - bounds.y;

      // Pick the smallest absolute push in each axis
      const horizontal = Math.abs(pushLeft) < Math.abs(pushRight) ? pushLeft : pushRight;
      const vertical = Math.abs(pushUp) < Math.abs(pushDown) ? pushUp : pushDown;

      // Use the axis with the smaller displacement
      if (Math.abs(horizontal) < Math.abs(vertical)) {
        dx += horizontal;
      } else {
        dy += vertical;
      }
    }

    return { x: bounds.x + dx, y: bounds.y + dy };
  };

  // First attempt
  const firstResult = resolve(shapeBounds);
  if (!firstResult) return null;

  // Check if resolved position is also clear
  const resolvedBounds: Rect = {
    x: firstResult.x,
    y: firstResult.y,
    width: shapeBounds.width,
    height: shapeBounds.height,
  };

  const secondResult = resolve(resolvedBounds);
  if (!secondResult) return firstResult; // First resolution worked

  // Still overlapping after retry — use packing as fallback
  const packed = findPackedPosition(others, {
    width: shapeBounds.width,
    height: shapeBounds.height,
  }, gap);
  return packed;
}

// ── DAG Layout ──

const V_GAP = 50;
const H_GAP = 40;

/**
 * Compute a layered DAG layout from a graph plan.
 *
 * Algorithm (simplified Sugiyama):
 * 1. Layer assignment: each card's layer = longest path from any root
 * 2. Within each layer, order by parent position (barycenter heuristic)
 * 3. Position: center each layer horizontally, stack vertically
 *
 * Returns a Map of cardId → Rect (position + size).
 */
export function computeDAGLayout(
  plan: CanvasCardPlan[],
  anchor: Point
): Map<string, Rect> {
  if (plan.length === 0) return new Map();

  const cardMap = new Map(plan.map((c) => [c.cardId, c]));

  // Step 1: Assign layers (longest path from any root)
  const layerOf = new Map<string, number>();

  function computeLayer(id: string, visited: Set<string>): number {
    if (layerOf.has(id)) return layerOf.get(id)!;
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);

    const card = cardMap.get(id);
    if (!card || card.derivedFrom.length === 0) {
      layerOf.set(id, 0);
      return 0;
    }

    let maxParentLayer = 0;
    for (const parentId of card.derivedFrom) {
      maxParentLayer = Math.max(
        maxParentLayer,
        computeLayer(parentId, visited) + 1
      );
    }
    layerOf.set(id, maxParentLayer);
    return maxParentLayer;
  }

  for (const card of plan) {
    computeLayer(card.cardId, new Set());
  }

  // Step 2: Group cards by layer
  const layers = new Map<number, CanvasCardPlan[]>();
  let maxLayer = 0;
  for (const card of plan) {
    const layer = layerOf.get(card.cardId) ?? 0;
    maxLayer = Math.max(maxLayer, layer);
    const arr = layers.get(layer) ?? [];
    arr.push(card);
    layers.set(layer, arr);
  }

  // Step 3: Order within layers using barycenter heuristic
  // For layer 0 (roots): keep original plan order
  // For subsequent layers: sort by average x-position of parents
  const positions = new Map<string, Rect>();

  // First pass: compute sizes
  const sizeOf = (card: CanvasCardPlan): Size =>
    DEFAULT_SIZE[card.type] ?? { width: 400, height: 260 };

  for (let layer = 0; layer <= maxLayer; layer++) {
    const cards = layers.get(layer) ?? [];

    if (layer > 0) {
      // Sort by barycenter of parents
      cards.sort((a, b) => {
        const aCenter = avgParentX(a, positions);
        const bCenter = avgParentX(b, positions);
        return aCenter - bCenter;
      });
    }

    // Compute total width of this layer
    let totalWidth = 0;
    for (const card of cards) {
      totalWidth += sizeOf(card).width;
    }
    totalWidth += H_GAP * Math.max(0, cards.length - 1);

    // Compute Y for this layer: max bottom of previous layer + V_GAP
    let layerY = 0;
    if (layer === 0) {
      layerY = 0;
    } else {
      let maxBottom = 0;
      for (const prevCard of layers.get(layer - 1) ?? []) {
        const rect = positions.get(prevCard.cardId);
        if (rect) maxBottom = Math.max(maxBottom, rect.y + rect.height);
      }
      layerY = maxBottom + V_GAP;
    }

    // Place cards centered
    let currentX = -totalWidth / 2;
    for (const card of cards) {
      const size = sizeOf(card);
      positions.set(card.cardId, {
        x: currentX,
        y: layerY,
        width: size.width,
        height: size.height,
      });
      currentX += size.width + H_GAP;
    }
  }

  // Step 4: Translate to anchor point
  // Find the bounding box center and offset
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const rect of positions.values()) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  const centerX = (minX + maxX) / 2;
  const offsetX = anchor.x - centerX;
  const offsetY = anchor.y - minY;

  const result = new Map<string, Rect>();
  for (const [id, rect] of positions) {
    result.set(id, {
      x: rect.x + offsetX,
      y: rect.y + offsetY,
      width: rect.width,
      height: rect.height,
    });
  }

  return result;
}

function avgParentX(
  card: CanvasCardPlan,
  positions: Map<string, Rect>
): number {
  if (card.derivedFrom.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (const parentId of card.derivedFrom) {
    const rect = positions.get(parentId);
    if (rect) {
      sum += rect.x + rect.width / 2;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}
