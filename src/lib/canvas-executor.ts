/**
 * Canvas Dataflow Execution Engine
 *
 * Executes a topological dataflow across connected BoardCards. When a card
 * changes (e.g. a SQL card refreshes or a new connection is drawn), this
 * propagates the update downstream through the graph:
 *
 *   SQL card → Chart/Table cards  (data flows)
 *   SQL card → Text (LLM) cards   (data summarized by OpenAI)
 *   Parameter card → downstream   (value substituted, handled by caller)
 */

import type { BoardCard, CardConnection } from "./board-types";
import { saveBoardCard } from "./board-store";
import { apiFetch } from "./api-client";
import { substituteParams } from "./playbook-params";

/* ── Types ── */

interface CanvasRefreshResult {
  cardId: string;
  data: Record<string, unknown>[];
  executionTimeMs: number;
  error?: string;
}

interface CanvasSynthesizeResult {
  summary: string;
  error?: string;
}

/* ── Graph helpers ── */

/**
 * Build a map of cardId → set of cards that directly depend on it
 * (i.e. the adjacency list going forward / downstream).
 */
function buildDownstreamAdj(
  connections: CardConnection[]
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const conn of connections) {
    const set = adj.get(conn.fromCardId) ?? new Set<string>();
    set.add(conn.toCardId);
    adj.set(conn.fromCardId, set);
  }
  return adj;
}

/**
 * Build a map of cardId → set of cards it directly depends on
 * (i.e. the adjacency list going backward / upstream).
 */
function buildUpstreamAdj(
  connections: CardConnection[]
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const conn of connections) {
    const set = adj.get(conn.toCardId) ?? new Set<string>();
    set.add(conn.fromCardId);
    adj.set(conn.toCardId, set);
  }
  return adj;
}

/**
 * Collect all cards downstream of `startCardId` (BFS, inclusive of the
 * start card itself so that we can refresh it as the seed).
 */
function collectDownstreamIds(
  startCardId: string,
  downstreamAdj: Map<string, Set<string>>
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [startCardId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const child of downstreamAdj.get(id) ?? []) {
      queue.push(child);
    }
  }
  return visited;
}

/**
 * Topological sort (Kahn's algorithm) over a subset of cards.
 * Returns cards in execution order (roots first).
 */
function topologicalSort(
  subset: Set<string>,
  upstreamAdj: Map<string, Set<string>>,
  downstreamAdj: Map<string, Set<string>>
): string[] {
  // In-degree within the subset
  const inDegree = new Map<string, number>();
  for (const id of subset) {
    const ups = upstreamAdj.get(id) ?? new Set();
    const inSubset = [...ups].filter((u) => subset.has(u));
    inDegree.set(id, inSubset.length);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const child of downstreamAdj.get(id) ?? []) {
      if (!subset.has(child)) continue;
      const newDeg = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  return sorted;
}

/* ── LLM summarization ── */

/**
 * Build a compact text description of a card's data for LLM context.
 */
function formatCardDataForLLM(card: BoardCard): string {
  const header = `Card: "${card.title}" (type: ${card.type})`;

  if (card.sql) {
    const rowCount = card.data?.length ?? 0;
    const sample = (card.data ?? []).slice(0, 20);
    const sampleStr = sample.length > 0 ? JSON.stringify(sample, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2) : "(no data)";
    return `${header}\nSQL: ${card.sql}\nRows: ${rowCount}\nSample:\n${sampleStr}`;
  }

  if (card.markdownContent) {
    return `${header}\nContent: ${card.markdownContent.slice(0, 500)}`;
  }

  if (card.reportMarkdown) {
    return `${header}\nReport: ${card.reportMarkdown.slice(0, 500)}`;
  }

  return `${header}\n(no data available)`;
}

/**
 * Call `/api/canvas-synthesize` to generate an LLM summary for a text card
 * given its upstream source cards' data. Falls back to `/api/canvas-comment`
 * with a synthetic "summarize" comment if the synthesize endpoint doesn't
 * exist yet (graceful degradation).
 */
async function synthesizeTextCard(
  card: BoardCard,
  sourceCards: BoardCard[],
  datasetId: string
): Promise<string> {
  const contextBlocks = sourceCards.map(formatCardDataForLLM).join("\n\n---\n\n");

  const prompt = `You are an analytics assistant. The following data card(s) provide context for a summary card titled "${card.title}".

${contextBlocks}

Generate a concise, insightful summary (2-4 sentences or a short bullet list) that synthesizes the key findings from the upstream data. Be specific — cite actual numbers where available. Use markdown formatting. Do not repeat the card title.`;

  try {
    const res = await apiFetch<CanvasSynthesizeResult>("/api/canvas-synthesize", {
      method: "POST",
      datasetId,
      body: {
        cardTitle: card.title,
        prompt,
      },
    });
    if (res.summary) return res.summary;
  } catch {
    // Synthesize endpoint may not exist yet — fall through to comment API
  }

  // Fallback: use canvas-comment with a "summarize" instruction
  try {
    const commentRes = await apiFetch<{
      type: string;
      text?: string;
    }>("/api/canvas-comment", {
      method: "POST",
      datasetId,
      body: {
        cardId: card.id,
        boardId: card.boardId,
        comment: `Summarize the upstream data for this card: "${card.title}"`,
        cardContext: {
          type: card.type,
          title: card.title,
          markdownContent: contextBlocks.slice(0, 1000),
        },
      },
    });
    if (commentRes.text) return commentRes.text;
  } catch {
    // ignore
  }

  return "(Unable to generate summary — upstream data may be unavailable)";
}

/* ── Main executor ── */

/**
 * Execute the canvas dataflow starting from `changedCardId`.
 *
 * 1. Build dependency graph from `connections`
 * 2. Find all cards downstream of `changedCardId`
 * 3. Topologically sort the downstream set
 * 4. Execute in order:
 *    - SQL cards: refresh via `/api/canvas-refresh`, store result in card.data
 *    - Chart/Table/Metric cards with incoming connection: copy data from source
 *    - Text (LLM) cards with incoming connections: call LLM to synthesize summary
 *    - Parameter cards: value flows downstream (caller sets card.data upstream)
 *
 * Updated cards are written back to the board store via `saveBoardCard`.
 * Returns a Map<cardId, updatedCard> of every card that was touched.
 *
 * Execution is intentionally non-throwing — errors per card are recorded
 * in the returned card's `data` field as `[{ __error: "..." }]`.
 */
export async function executeCanvasDataflow(
  cards: BoardCard[],
  connections: CardConnection[],
  changedCardId: string,
  datasetId: string
): Promise<Map<string, BoardCard>> {
  const cardMap = new Map<string, BoardCard>(cards.map((c) => [c.id, c]));
  const downstreamAdj = buildDownstreamAdj(connections);
  const upstreamAdj = buildUpstreamAdj(connections);

  // Find all cards downstream of (and including) the changed card
  const downstreamIds = collectDownstreamIds(changedCardId, downstreamAdj);

  // Topological order within the downstream set
  const executionOrder = topologicalSort(downstreamIds, upstreamAdj, downstreamAdj);

  // Live card state during execution (updated as each card completes)
  const liveCards = new Map<string, BoardCard>(cardMap);
  const updatedCards = new Map<string, BoardCard>();

  for (const cardId of executionOrder) {
    const card = liveCards.get(cardId);
    if (!card) continue;

    const upstreamCardIds = [...(upstreamAdj.get(cardId) ?? [])];
    const upstreamCards = upstreamCardIds
      .map((id) => liveCards.get(id))
      .filter((c): c is BoardCard => c !== undefined);
    const hasIncoming = upstreamCards.length > 0;

    try {
      let updated: BoardCard | null = null;

      if (card.type === "sql" && card.sql) {
        // SQL cards: apply parameter substitution from upstream parameter cards,
        // then execute the query and store result rows in card.data.
        const paramCards = upstreamCards.filter((c) => c.type === "parameter");
        let resolvedSql = card.sql;
        if (paramCards.length > 0) {
          // Build a label→value map from all upstream parameter cards.
          // The label is used as the placeholder key ({{label}}).
          const paramMap: Record<string, string> = {};
          for (const pc of paramCards) {
            const label = pc.parameterConfig?.label ?? pc.title;
            const value = pc.parameterConfig?.defaultValue ?? "";
            if (label) paramMap[label] = value;
          }
          resolvedSql = substituteParams(card.sql, paramMap);
        }

        const res = await apiFetch<{
          results: CanvasRefreshResult[];
        }>("/api/canvas-refresh", {
          method: "POST",
          datasetId,
          body: { cards: [{ id: card.id, sql: resolvedSql }], datasetId },
        });

        const result = res.results[0];
        if (result) {
          updated = {
            ...card,
            lastData: card.data,
            data: result.error ? card.data : result.data,
            lastRefreshed: new Date().toISOString(),
          };
        }
      } else if ((card.type === "chart" || card.type === "table" || card.type === "metric") && hasIncoming) {
        // Visualization cards: inherit data from the first upstream source that has data
        const sourceData = upstreamCards.find((c) => c.data && c.data.length > 0)?.data;
        if (sourceData !== undefined) {
          updated = {
            ...card,
            data: sourceData,
            lastRefreshed: new Date().toISOString(),
          };
        }
      } else if (card.type === "text" && hasIncoming) {
        // Text (LLM) cards: synthesize a summary from all upstream source cards
        const summary = await synthesizeTextCard(card, upstreamCards, datasetId);
        updated = {
          ...card,
          markdownContent: summary,
          lastRefreshed: new Date().toISOString(),
        };
      } else if (card.type === "parameter" && hasIncoming) {
        // Parameter cards: value already set by the upstream card — no additional
        // execution needed here. We still propagate the live card so downstream
        // nodes can pick up its current value.
        updated = { ...card };
      }
      // sticky, follow-up, report, segment: no dataflow execution

      if (updated) {
        liveCards.set(cardId, updated);
        updatedCards.set(cardId, updated);
        saveBoardCard(updated);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Execution failed";
      console.error(`[canvas-executor] card ${cardId} failed:`, errorMsg);
      // Record error in card data so the UI can surface it
      const errCard: BoardCard = {
        ...card,
        data: [{ __error: errorMsg }],
        lastRefreshed: new Date().toISOString(),
      };
      liveCards.set(cardId, errCard);
      updatedCards.set(cardId, errCard);
      saveBoardCard(errCard);
    }
  }

  return updatedCards;
}
