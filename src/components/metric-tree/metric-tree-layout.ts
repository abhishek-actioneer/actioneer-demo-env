import type { Node, Edge } from "@xyflow/react";
import type { Metric } from "@/lib/metric-types";

// ── Layout constants ──
export const NODE_W = 240;
export const NODE_H = 100;
const H_GAP = 40;
const V_GAP = 120;
const MAX_CHILDREN_PER_ROW = 3;

/**
 * Build a top-down hierarchical tree layout from metric relationships.
 *
 * The root sits at the top. Each parent is centered above its children.
 * Wide levels are kept readable by limiting children per row and using
 * subtree-width calculations for proper spacing.
 */
export function buildTreeLayout(
  metrics: Metric[],
  rootId?: string
): { nodes: Node[]; edges: Edge[] } {
  if (metrics.length === 0) return { nodes: [], edges: [] };

  const byId = new Map(metrics.map((m) => [m.id, m]));

  // Track edge relationship type for visual differentiation
  const edgeType = new Map<string, "component" | "influence">();

  // Build parent → children adjacency from "drives" relationships
  // If A drives B, then A is a child of B in the tree (B is the outcome/parent)
  // Root (e.g. Revenue) is at the top; metrics that drive it are below it
  const childrenMap = new Map<string, string[]>();
  for (const m of metrics) {
    for (const rel of m.relationships) {
      if (rel.direction === "drives" && byId.has(rel.metricId)) {
        // m drives rel.metricId → m is a child of rel.metricId
        const parentId = rel.metricId;
        const childId = m.id;
        const list = childrenMap.get(parentId) ?? [];
        if (!list.includes(childId)) {
          list.push(childId);
          childrenMap.set(parentId, list);
          edgeType.set(`${parentId}->${childId}`, rel.type);
        }
      }
      if (rel.direction === "driven_by" && byId.has(rel.metricId)) {
        // m is driven_by rel.metricId → rel.metricId is a child of m
        const parentId = m.id;
        const childId = rel.metricId;
        const list = childrenMap.get(parentId) ?? [];
        if (!list.includes(childId)) {
          list.push(childId);
          childrenMap.set(parentId, list);
          edgeType.set(`${parentId}->${childId}`, rel.type);
        }
      }
    }
  }

  // Find root: explicit rootId, or the node with the most children
  // (the metric that everything else feeds into)
  let root: string;
  if (rootId && byId.has(rootId)) {
    root = rootId;
  } else {
    let bestId: string | undefined;
    let bestCount = 0;
    for (const [id, kids] of childrenMap) {
      if (kids.length > bestCount) {
        bestCount = kids.length;
        bestId = id;
      }
    }
    root = bestId ?? metrics[0].id;
  }

  // Build a proper tree (each node has exactly one parent) via BFS
  // This avoids DAG issues where a node has multiple parents
  const treeChildren = new Map<string, string[]>();
  const visited = new Set<string>();
  const bfsQueue: string[] = [root];
  visited.add(root);

  while (bfsQueue.length > 0) {
    const parentId = bfsQueue.shift()!;
    const kids = childrenMap.get(parentId) ?? [];
    const treeKids: string[] = [];
    for (const kid of kids) {
      if (!visited.has(kid)) {
        visited.add(kid);
        treeKids.push(kid);
        bfsQueue.push(kid);
      }
    }
    if (treeKids.length > 0) {
      treeChildren.set(parentId, treeKids);
    }
  }

  // Orphans: metrics not reachable from root
  const orphans = metrics.filter((m) => !visited.has(m.id)).map((m) => m.id);
  for (const o of orphans) visited.add(o);

  // ── Subtree width calculation ──
  // Each node's width = max(its own width, sum of children widths + gaps)
  const subtreeWidth = new Map<string, number>();

  function calcWidth(id: string): number {
    const cached = subtreeWidth.get(id);
    if (cached !== undefined) return cached;

    const kids = treeChildren.get(id) ?? [];
    if (kids.length === 0) {
      subtreeWidth.set(id, NODE_W);
      return NODE_W;
    }

    // If too many children, arrange in rows
    const rows: string[][] = [];
    for (let i = 0; i < kids.length; i += MAX_CHILDREN_PER_ROW) {
      rows.push(kids.slice(i, i + MAX_CHILDREN_PER_ROW));
    }

    // Width = widest row
    let maxRowWidth = 0;
    for (const row of rows) {
      const rowWidth = row.reduce((sum, kid) => sum + calcWidth(kid), 0) +
        (row.length - 1) * H_GAP;
      maxRowWidth = Math.max(maxRowWidth, rowWidth);
    }

    const w = Math.max(NODE_W, maxRowWidth);
    subtreeWidth.set(id, w);
    return w;
  }

  calcWidth(root);
  for (const o of orphans) calcWidth(o);

  // ── Position nodes recursively ──
  const nodes: Node[] = [];
  const nodeDepth = new Map<string, number>();

  function positionSubtree(id: string, x: number, y: number) {
    const metric = byId.get(id)!;
    nodeDepth.set(id, y);

    nodes.push({
      id,
      type: "metricCard",
      position: {
        x: x - NODE_W / 2,
        y,
      },
      data: { metric, selected: false },
      draggable: true,
    });

    const kids = treeChildren.get(id) ?? [];
    if (kids.length === 0) return;

    // Split kids into rows if too many
    const rows: string[][] = [];
    for (let i = 0; i < kids.length; i += MAX_CHILDREN_PER_ROW) {
      rows.push(kids.slice(i, i + MAX_CHILDREN_PER_ROW));
    }

    let rowY = y + NODE_H + V_GAP;
    for (const row of rows) {
      const totalRowWidth = row.reduce((sum, kid) => sum + calcWidth(kid), 0) +
        (row.length - 1) * H_GAP;
      let cx = x - totalRowWidth / 2;

      for (const kid of row) {
        const kidW = calcWidth(kid);
        positionSubtree(kid, cx + kidW / 2, rowY);
        cx += kidW + H_GAP;
      }

      rowY += NODE_H + V_GAP;
    }
  }

  positionSubtree(root, 0, 0);

  // Position orphans below the tree in wrapped rows
  if (orphans.length > 0) {
    const maxY = nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.y)) : 0;
    let orphanY = maxY + NODE_H + V_GAP * 1.5;

    for (let i = 0; i < orphans.length; i += MAX_CHILDREN_PER_ROW) {
      const row = orphans.slice(i, i + MAX_CHILDREN_PER_ROW);
      const rowWidth = row.length * NODE_W + (row.length - 1) * H_GAP;
      let ox = -rowWidth / 2;
      for (const oId of row) {
        const metric = byId.get(oId)!;
        nodes.push({
          id: oId,
          type: "metricCard",
          position: { x: ox, y: orphanY },
          data: { metric, selected: false },
          draggable: true,
        });
        ox += NODE_W + H_GAP;
      }
      orphanY += NODE_H + V_GAP;
    }
  }

  // ── Build edges ──
  const edges: Edge[] = [];
  const edgeSet = new Set<string>();

  for (const m of metrics) {
    for (const rel of m.relationships) {
      if (!visited.has(rel.metricId) || !visited.has(m.id)) continue;

      let sourceId: string;
      let targetId: string;

      if (rel.direction === "drives") {
        sourceId = rel.metricId;
        targetId = m.id;
      } else {
        sourceId = m.id;
        targetId = rel.metricId;
      }

      const edgeId = `e-${sourceId}-${targetId}`;
      if (edgeSet.has(edgeId)) continue;
      edgeSet.add(edgeId);

      edges.push({
        id: edgeId,
        source: sourceId,
        target: targetId,
        type: "animatedArrow",
        data: { relType: edgeType.get(`${targetId}->${sourceId}`) ?? rel.type },
      });
    }
  }

  return { nodes, edges };
}
