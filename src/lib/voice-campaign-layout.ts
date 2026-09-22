import type { VoiceFlowEdge, VoiceFlowNode, VoiceFlowNodeKind } from "@/lib/voice-campaign-flow";

// Voice cards are 360px wide. Keeping the layout dimensions here in sync with
// voice-flow-node.tsx lets the pure layout function reserve real card space.
const NODE_WIDTH = 360;
const COLUMN_GAP = 140;
const COLUMN_STEP = NODE_WIDTH + COLUMN_GAP;

// Clear air between the bottom of one row's tallest card and the top of the
// next row — roughly one card height, enough for an edge-label pill to sit in
// open space without stretching adjacent connections into long empty runs.
const VERTICAL_GAP = 110;
// Each rank shifts this far left, turning linear scripts into a diagonal
// cascade instead of a dense single-file column.
const SPINE_DRIFT = 140;

// Card-height estimate mirroring voice-flow-node.tsx: tinted header band
// (icon, title, kind label, step chip), 12px body clamped to 2 lines, an
// optional Branches section when a node has 2+ labeled outgoing edges, and a
// footer strip on required end nodes. Layout runs before render — including
// on the server — so measured dimensions are unavailable; a systematic error
// here only stretches or shrinks the shared gap, never overlaps cards.
const CARD_HEADER_HEIGHT = 56;
const CARD_BODY_PADDING = 24;
const BODY_LINE_HEIGHT = 18;
const BODY_MAX_LINES = 2;
const BODY_CHARS_PER_LINE = 54;
const BRANCH_SECTION_BASE = 30;
const BRANCH_ROW_HEIGHT = 30;
const END_FOOTER_HEIGHT = 33;

function estimateNodeHeight(node: VoiceFlowNode, labeledBranches: number): number {
  const text = (node.data.body ?? "").trim() || (node.data.helper ?? "").trim();
  const lines = Math.min(BODY_MAX_LINES, Math.max(1, Math.ceil(text.length / BODY_CHARS_PER_LINE)));
  let height = CARD_HEADER_HEIGHT + CARD_BODY_PADDING + lines * BODY_LINE_HEIGHT;
  if (labeledBranches >= 2) height += BRANCH_SECTION_BASE + labeledBranches * BRANCH_ROW_HEIGHT;
  if (node.data.kind === "end" && node.data.required) height += END_FOOTER_HEIGHT;
  return height;
}

const KIND_ORDER: Record<VoiceFlowNodeKind, number> = {
  start: 0,
  prompt: 1,
  question: 2,
  condition: 3,
  action: 4,
  transfer: 5,
  end: 6,
};

function edgeLabel(edge: VoiceFlowEdge): string {
  return typeof edge.label === "string" ? edge.label.toLowerCase() : "";
}

function isNegativeBranch(edge: VoiceFlowEdge): boolean {
  const label = edgeLabel(edge);
  return /\b(no|not|busy|defer|decline|wrong|stop|later|unavailable)\b/.test(label) ||
    /नहीं|ना|व्यस्त|बाद|गलत|रोक/.test(label);
}

function isPositiveBranch(edge: VoiceFlowEdge): boolean {
  const label = edgeLabel(edge);
  return /\b(yes|receptive|interested|consent|value|explained|cause|ready|wants|positive)\b/.test(label) ||
    /हाँ|सहमत|रुचि|कारण|दिया|बताया|तैयार/.test(label);
}

function choosePrimaryTarget(
  sourceId: string,
  outgoing: Map<string, VoiceFlowEdge[]>,
  nodeById: Map<string, VoiceFlowNode>,
  visited: Set<string>,
): string | null {
  const candidates = (outgoing.get(sourceId) ?? [])
    .filter((edge) => nodeById.has(edge.target) && !visited.has(edge.target));
  if (candidates.length === 0) return null;

  const scored = candidates
    .map((edge, index) => {
      const target = nodeById.get(edge.target)!;
      let score = 0;
      if (isNegativeBranch(edge)) score -= 100;
      if (isPositiveBranch(edge)) score += 20;
      if (target.data.kind === "end") score -= 80;
      if (target.data.kind === "transfer") score -= 15;
      score -= index;
      score += 10 - KIND_ORDER[target.data.kind];
      return { edge, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.edge.target ?? null;
}

function primaryPath(
  nodes: VoiceFlowNode[],
  outgoing: Map<string, VoiceFlowEdge[]>,
): string[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const start = nodes.find((node) => node.data.kind === "start") ?? nodes[0];
  if (!start) return [];

  const path = [start.id];
  const visited = new Set(path);
  let current = start.id;
  while (true) {
    const next = choosePrimaryTarget(current, outgoing, nodeById, visited);
    if (!next) break;
    path.push(next);
    visited.add(next);
    current = next;
    if (nodeById.get(next)?.data.kind === "end") break;
  }
  return path;
}

function insertBySourceOrder(queue: string[], nodeId: string, nodeIndex: Map<string, number>) {
  const index = nodeIndex.get(nodeId) ?? Number.MAX_SAFE_INTEGER;
  const insertAt = queue.findIndex((queued) => (nodeIndex.get(queued) ?? Number.MAX_SAFE_INTEGER) > index);
  if (insertAt === -1) queue.push(nodeId);
  else queue.splice(insertAt, 0, nodeId);
}

/**
 * Assign every node a top-down rank. Longest-parent depth is important here:
 * a shared outcome can never be placed above (or on top of) one of its parents.
 */
function assignRanks(
  nodes: VoiceFlowNode[],
  outgoing: Map<string, VoiceFlowEdge[]>,
  incoming: Map<string, VoiceFlowEdge[]>,
  nodeIndex: Map<string, number>,
): Map<string, number> {
  const indegree = new Map(nodes.map((node) => [node.id, incoming.get(node.id)?.length ?? 0]));
  const queue: string[] = [];
  const ranks = new Map<string, number>();

  for (const node of nodes) {
    if ((indegree.get(node.id) ?? 0) === 0) {
      insertBySourceOrder(queue, node.id, nodeIndex);
      ranks.set(node.id, 0);
    }
  }

  const processed = new Set<string>();
  while (queue.length > 0) {
    const sourceId = queue.shift()!;
    processed.add(sourceId);
    const sourceRank = ranks.get(sourceId) ?? 0;

    for (const edge of outgoing.get(sourceId) ?? []) {
      ranks.set(edge.target, Math.max(ranks.get(edge.target) ?? 0, sourceRank + 1));
      const nextIndegree = (indegree.get(edge.target) ?? 1) - 1;
      indegree.set(edge.target, nextIndegree);
      if (nextIndegree === 0) insertBySourceOrder(queue, edge.target, nodeIndex);
    }
  }

  // Generated workflows are expected to be DAGs, but malformed saved drafts
  // should still render safely. Put cyclic/unreachable nodes on separate rows.
  let fallbackRank = Math.max(-1, ...ranks.values()) + 1;
  for (const node of nodes) {
    if (processed.has(node.id)) continue;
    const resolvedParentRanks = (incoming.get(node.id) ?? [])
      .map((edge) => ranks.get(edge.source))
      .filter((rank): rank is number => rank !== undefined);
    const afterParents = resolvedParentRanks.length > 0
      ? Math.max(...resolvedParentRanks) + 1
      : fallbackRank;
    ranks.set(node.id, Math.max(fallbackRank, afterParents));
    fallbackRank = (ranks.get(node.id) ?? fallbackRank) + 1;
  }

  return ranks;
}

// Branch nodes only ever move right: the spine cascades down-left, so the
// left side of every row belongs to upcoming spine cards. Keeping branches
// (and therefore their condition labels) in the open right-hand space stops
// edge labels from landing behind cards.
function nearestFreeColumnRight(preferred: number, occupied: Set<number>): number {
  let column = Math.max(1, Math.round(preferred));
  while (occupied.has(column)) column += 1;
  return column;
}

/**
 * Arrange a voice workflow as a readable, layered graph.
 *
 * - every dependency moves downward to a later row
 * - every row owns distinct columns, so cards cannot overlap
 * - row pitch follows card content, so tall cards keep the same visual gap
 * - the primary conversation cascades diagonally down-left; branches always
 *   move to the right-hand side, keeping condition labels in open space
 */
export function layoutVoiceWorkflow(nodes: VoiceFlowNode[], edges: VoiceFlowEdge[]): VoiceFlowNode[] {
  if (nodes.length === 0) return nodes;

  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, VoiceFlowEdge[]>();
  const incoming = new Map<string, VoiceFlowEdge[]>();

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target) || edge.source === edge.target) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }

  const path = primaryPath(nodes, outgoing);
  const pathIndex = new Map(path.map((nodeId, index) => [nodeId, index]));
  const ranks = assignRanks(nodes, outgoing, incoming, nodeIndex);
  const layers = new Map<number, VoiceFlowNode[]>();
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0;
    layers.set(rank, [...(layers.get(rank) ?? []), node]);
  }

  const columns = new Map<string, number>();
  const maxRank = Math.max(0, ...layers.keys());

  for (let rank = 0; rank <= maxRank; rank += 1) {
    const layer = layers.get(rank) ?? [];
    if (layer.length === 0) continue;

    const preferences = new Map<string, number>();
    for (const node of layer) {
      if (pathIndex.has(node.id)) {
        preferences.set(node.id, 0);
        continue;
      }

      const parentPreferences = (incoming.get(node.id) ?? []).flatMap((edge) => {
        const parentColumn = columns.get(edge.source);
        if (parentColumn === undefined) return [];
        const siblings = (outgoing.get(edge.source) ?? []).filter((candidate) => {
          const target = nodeById.get(candidate.target);
          return target && !pathIndex.has(target.id);
        });
        const siblingIndex = Math.max(0, siblings.findIndex((candidate) => candidate.id === edge.id));
        return [parentColumn + siblingIndex + 1];
      });

      if (parentPreferences.length === 0) {
        preferences.set(node.id, 1);
      } else {
        preferences.set(
          node.id,
          parentPreferences.reduce((sum, item) => sum + item, 0) / parentPreferences.length,
        );
      }
    }

    const occupied = new Set<number>();
    const primaryNode = layer.find((node) => pathIndex.has(node.id));
    if (primaryNode) {
      columns.set(primaryNode.id, 0);
      occupied.add(0);
    }

    const remaining = layer
      .filter((node) => node.id !== primaryNode?.id)
      .sort((a, b) => {
        const aPreference = preferences.get(a.id) ?? 0;
        const bPreference = preferences.get(b.id) ?? 0;
        return aPreference - bPreference || (nodeIndex.get(a.id) ?? 0) - (nodeIndex.get(b.id) ?? 0);
      });

    for (const node of remaining) {
      const column = nearestFreeColumnRight(preferences.get(node.id) ?? 1, occupied);
      columns.set(node.id, column);
      occupied.add(column);
    }
  }

  // Content-aware vertical pitch: each row starts below the tallest card of
  // the previous row plus a fixed visual gap, so dense imported stages get the
  // same breathing room as short generated ones.
  const rowY = new Map<number, number>();
  let nextY = 0;
  for (let rank = 0; rank <= maxRank; rank += 1) {
    const layer = layers.get(rank) ?? [];
    if (layer.length === 0) continue;
    rowY.set(rank, nextY);
    const rowHeight = Math.max(
      ...layer.map((node) => {
        const labeledBranches = (outgoing.get(node.id) ?? []).filter(
          (edge) => typeof edge.label === "string" && edge.label.trim(),
        ).length;
        return estimateNodeHeight(node, labeledBranches);
      }),
    );
    nextY += rowHeight + VERTICAL_GAP;
  }

  return nodes.map((node) => {
    const rank = ranks.get(node.id) ?? 0;
    return {
      ...node,
      position: {
        x: Math.round((columns.get(node.id) ?? 0) * COLUMN_STEP - rank * SPINE_DRIFT - NODE_WIDTH / 2),
        y: Math.round(rowY.get(rank) ?? rank * (VERTICAL_GAP + CARD_HEADER_HEIGHT)),
      },
    };
  });
}
