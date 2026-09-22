/**
 * Graph utilities for canvas card plans.
 *
 * Provides cycle detection, topological sorting, and plan validation
 * for the LLM-generated card graph before execution.
 */

import type { CanvasCardPlan } from "./canvas-sse-types";

// ── Cycle Detection (DFS) ──

export function hasCycle(cards: CanvasCardPlan[]): boolean {
  const adj = new Map<string, string[]>();
  for (const card of cards) {
    adj.set(card.cardId, card.derivedFrom);
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const card of cards) color.set(card.cardId, WHITE);

  function dfs(id: string): boolean {
    color.set(id, GRAY);
    for (const dep of adj.get(id) ?? []) {
      const c = color.get(dep) ?? BLACK; // unknown ref treated as visited
      if (c === GRAY) return true; // back edge = cycle
      if (c === WHITE && dfs(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  }

  for (const card of cards) {
    if (color.get(card.cardId) === WHITE && dfs(card.cardId)) return true;
  }
  return false;
}

// ── Topological Sort (Kahn's algorithm) ──

export function topologicalOrder(cards: CanvasCardPlan[]): CanvasCardPlan[] {
  const cardMap = new Map(cards.map((c) => [c.cardId, c]));

  // Build downstream adjacency: for each card, which cards depend on it?
  const downstream = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const card of cards) {
    downstream.set(card.cardId, []);
    inDegree.set(card.cardId, 0);
  }

  for (const card of cards) {
    // derivedFrom = upstream dependencies (edges point FROM upstream TO this card)
    const validDeps = card.derivedFrom.filter((id) => cardMap.has(id));
    inDegree.set(card.cardId, validDeps.length);
    for (const dep of validDeps) {
      downstream.get(dep)!.push(card.cardId);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: CanvasCardPlan[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(cardMap.get(id)!);
    for (const child of downstream.get(id) ?? []) {
      const newDeg = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  return sorted;
}

// ── Plan Validation ──

const VALID_CARD_TYPES = new Set([
  "sql",
  "table",
  "chart",
  "metric",
  "text",
  "report",
  "sticky",
  "segment",
  "parameter",
  "follow-up",
]);

export function validateGraphPlan(
  cards: CanvasCardPlan[]
): { valid: boolean; error?: string } {
  if (cards.length === 0) {
    return { valid: false, error: "Plan has no cards" };
  }
  if (cards.length > 12) {
    return { valid: false, error: "Plan exceeds maximum of 12 cards" };
  }

  // Check unique IDs
  const ids = new Set<string>();
  for (const card of cards) {
    if (ids.has(card.cardId)) {
      return { valid: false, error: `Duplicate cardId: ${card.cardId}` };
    }
    ids.add(card.cardId);
  }

  // Check valid types
  for (const card of cards) {
    if (!VALID_CARD_TYPES.has(card.type)) {
      return { valid: false, error: `Invalid card type: ${card.type}` };
    }
  }

  // Check derivedFrom references exist
  for (const card of cards) {
    for (const dep of card.derivedFrom) {
      if (!ids.has(dep)) {
        return {
          valid: false,
          error: `Card "${card.cardId}" references unknown dependency "${dep}"`,
        };
      }
    }
  }

  // Check for cycles
  if (hasCycle(cards)) {
    return { valid: false, error: "Plan contains a cycle" };
  }

  // Check at least one root (no dependencies)
  const hasRoot = cards.some((c) => c.derivedFrom.length === 0);
  if (!hasRoot) {
    return { valid: false, error: "Plan has no root cards (all have dependencies)" };
  }

  return { valid: true };
}

// ── Acyclicity check for manual edge drawing ──

/**
 * Check if adding a proposed edge would create a cycle in the existing connections.
 * Uses DFS reachability: if target can already reach source, adding source→target creates a cycle.
 */
export function wouldCreateCycle(
  connections: { fromCardId: string; toCardId: string }[],
  newFrom: string,
  newTo: string
): boolean {
  // Build adjacency list from existing connections + proposed edge
  const adj = new Map<string, string[]>();
  const allConns = [...connections, { fromCardId: newFrom, toCardId: newTo }];
  for (const conn of allConns) {
    const list = adj.get(conn.fromCardId) ?? [];
    list.push(conn.toCardId);
    adj.set(conn.fromCardId, list);
  }

  // DFS from newTo — if we can reach newFrom, there's a cycle
  const visited = new Set<string>();
  const stack = [newTo];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === newFrom) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of adj.get(id) ?? []) {
      stack.push(next);
    }
  }
  return false;
}
