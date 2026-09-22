/**
 * Intersection cards — surface connections between conversation history
 * and the current page. Three types:
 *   1. Provenance — entities created from conversations
 *   2. Pending — unacted follow-up actions relevant to current page
 *   3. Related — conversations thematically relevant to current page
 */

import { getAllConversations } from "@/lib/conversation-store";
import { getAllSavedPlaybooks } from "@/lib/playbook-store";
import { getAllEntries } from "@/lib/knowledge-store";
import { getAllBoards, getBoardCards } from "@/lib/board-store";
import type { PageContext } from "@/lib/page-context";
import type { PlaybookV2 } from "@/lib/playbook-types";

export interface IntersectionCard {
  id: string;
  type: "provenance" | "related" | "pending";
  title: string;
  description: string;
  action?: string;
  conversationId?: string;
  meta?: {
    agentCount?: number;
    queryCount?: number;
    timeAgo?: string;
    entityName?: string;
    actionType?: string;
    payload?: Record<string, unknown>;
    pendingActionId?: string;
  };
}

const ACTION_PAGE_MAP: Record<string, string[]> = {
  "create-segment": ["segments"],
  "create-segment-clevertap": ["segments"],
  "create-segment-firebase": ["segments"],
  "create-segment-bigquery": ["segments"],
  "view-in-store": ["store"],
};

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

/**
 * Get intersection cards for the current page context.
 */
export async function getIntersectionCards(pageContext: PageContext, datasetId: string): Promise<IntersectionCard[]> {
  const cards: IntersectionCard[] = [];
  const { pageType } = pageContext;

  if (pageType === "general") return [];

  let conversations;
  try {
    conversations = await getAllConversations();
  } catch {
    return [];
  }

  if (conversations.length === 0) return [];

  const seenConvIds = new Set<string>();

  // ── Pending actions — unacted follow-ups relevant to this page ──
  for (const conv of conversations) {
    if (!conv.pendingActions?.length) continue;
    for (const pa of conv.pendingActions) {
      if (pa.completedAt || pa.dismissedAt) continue;

      const targetPages = ACTION_PAGE_MAP[pa.type];
      if (!targetPages?.includes(pageType)) continue;

      seenConvIds.add(conv.id);
      cards.push({
        id: `pending-${pa.id}`,
        type: "pending",
        title: pa.label,
        description: `From "${conv.title}"`,
        action: pa.type.includes("segment") ? "Create" : "View",
        conversationId: conv.id,
        meta: {
          timeAgo: timeAgo(pa.createdAt),
          actionType: pa.type,
          payload: pa.payload,
          pendingActionId: pa.id,
        },
      });
    }
  }

  // ── Provenance — entities on this page created from conversations ──

  if (pageType === "playbooks") {
    try {
      const playbooks = getAllSavedPlaybooks();
      for (const pb of playbooks) {
        const v2 = pb as PlaybookV2;
        if (!v2.sourceConversationId) continue;
        if (seenConvIds.has(v2.sourceConversationId)) continue;

        const conv = conversations.find((c) => c.id === v2.sourceConversationId);
        if (!conv) continue;

        seenConvIds.add(conv.id);
        cards.push({
          id: `provenance-playbook-${pb.id}`,
          type: "provenance",
          title: pb.name,
          description: `Built from "${conv.title}"`,
          action: "See research",
          conversationId: conv.id,
          meta: { timeAgo: timeAgo(conv.updatedAt) },
        });
      }
    } catch { /* store may not be initialized */ }
  }

  if (pageType === "canvas") {
    try {
      const boards = getAllBoards(datasetId);
      for (const board of boards) {
        const boardCards = getBoardCards(board.id);
        for (const card of boardCards) {
          if (!card.sourceConversationId) continue;
          if (seenConvIds.has(card.sourceConversationId)) continue;

          const conv = conversations.find((c) => c.id === card.sourceConversationId);
          if (!conv) continue;

          seenConvIds.add(conv.id);
          cards.push({
            id: `provenance-canvas-${card.id}`,
            type: "provenance",
            title: card.title,
            description: `Pinned from "${conv.title}"`,
            action: "See research",
            conversationId: conv.id,
            meta: { timeAgo: timeAgo(conv.updatedAt) },
          });
        }
      }
    } catch { /* store may not be initialized */ }
  }

  if (pageType === "knowledge") {
    try {
      const entries = getAllEntries(datasetId);
      for (const entry of entries) {
        if (!entry.sourceConversationId) continue;
        if (seenConvIds.has(entry.sourceConversationId)) continue;

        const conv = conversations.find((c) => c.id === entry.sourceConversationId);
        if (!conv) continue;

        seenConvIds.add(conv.id);
        cards.push({
          id: `provenance-knowledge-${entry.id}`,
          type: "provenance",
          title: entry.content.slice(0, 60) + (entry.content.length > 60 ? "..." : ""),
          description: `Saved from "${conv.title}"`,
          action: "See in context",
          conversationId: conv.id,
          meta: { timeAgo: timeAgo(conv.updatedAt) },
        });
      }
    } catch { /* store may not be initialized */ }
  }

  // Entity-level provenance for detail pages
  if (pageContext.entity?.type === "metric") {
    for (const conv of conversations) {
      if (seenConvIds.has(conv.id)) continue;
      const mentionsMetric = conv.messages?.some(
        (m) => m.metricContext?.metricId === pageContext.entity!.id
      );
      if (mentionsMetric) {
        seenConvIds.add(conv.id);
        cards.push({
          id: `provenance-metric-${conv.id}`,
          type: "provenance",
          title: conv.title,
          description: `Referenced "${pageContext.entity.name}" in analysis`,
          action: "Open",
          conversationId: conv.id,
          meta: { timeAgo: timeAgo(conv.updatedAt) },
        });
      }
    }
  }

  // ── Thematic relevance — conversations tagged with this page's domain ──
  for (const conv of conversations) {
    if (seenConvIds.has(conv.id)) continue;

    // Use tags if available
    if (conv.tags?.length) {
      const matchingTag = conv.tags.find((t) => t.domain === pageType);
      if (matchingTag && matchingTag.weight >= 0.5) {
        const agentMsg = conv.messages?.find((m) => m.role === "agent" && m.agent);
        const queryCount = agentMsg?.agent?.subagents.reduce(
          (sum, s) => sum + (s.queries?.length || 0), 0
        ) || 0;
        const agentCount = agentMsg?.agent?.subagents.length || 0;

        seenConvIds.add(conv.id);
        cards.push({
          id: `related-${conv.id}`,
          type: "related",
          title: conv.title,
          description: queryCount > 0
            ? `${queryCount} queries, ${agentCount} agents`
            : "Related research",
          action: "Open",
          conversationId: conv.id,
          meta: { queryCount, agentCount, timeAgo: timeAgo(conv.updatedAt) },
        });
      }
      continue;
    }

    // Fallback: agent ID heuristic for pre-tagged conversations
    if (!conv.messages?.length) continue;
    const agentMsgs = conv.messages.filter(
      (m) => m.role === "agent" && m.agent?.subagents?.length
    );
    const AGENT_PAGE_MAP: Record<string, string[]> = {
      "data-quality": ["data-catalog"],
      "daily-metrics": ["metrics", "forecasting"],
      "cohort-retention": ["segments"],
      "rev-opt": ["store"],
      "user-segmentation": ["segments"],
      "geographic": ["store"],
      "research": ["knowledge"],
      "data-analysis": ["metrics", "forecasting"],
      "marketing-optimization": ["store", "segments"],
    };
    for (const agentMsg of agentMsgs) {
      const subagentIds = agentMsg.agent!.subagents.map((s) => s.id);
      const matching = subagentIds.filter((id) => AGENT_PAGE_MAP[id]?.includes(pageType));
      if (matching.length > 0) {
        const queryCount = agentMsg.agent!.subagents.reduce(
          (sum, s) => sum + (s.queries?.length || 0), 0
        );
        seenConvIds.add(conv.id);
        cards.push({
          id: `related-${conv.id}`,
          type: "related",
          title: conv.title,
          description: `${queryCount} queries across ${subagentIds.length} agents`,
          action: "Open",
          conversationId: conv.id,
          meta: {
            queryCount,
            agentCount: subagentIds.length,
            timeAgo: timeAgo(conv.updatedAt),
          },
        });
        break;
      }
    }
  }

  // ── Connectors page: conversations blocked by missing connectors ──
  if (pageType === "connectors") {
    const blockedByConnector = new Map<string, string[]>();

    for (const conv of conversations) {
      if (!conv.messages?.length) continue;
      for (const msg of conv.messages) {
        if (msg.connectorInfo?.missing?.length) {
          for (const m of msg.connectorInfo.missing) {
            const name = m.description;
            const titles = blockedByConnector.get(name) || [];
            if (!titles.includes(conv.title)) {
              titles.push(conv.title);
              blockedByConnector.set(name, titles);
            }
          }
        }
      }
    }

    for (const [connectorName, titles] of blockedByConnector) {
      cards.push({
        id: `pending-connector-${connectorName}`,
        type: "pending",
        title: `Connect ${connectorName}`,
        description: `${titles.length} conversation${titles.length > 1 ? "s" : ""} limited by missing data`,
        action: "Connect",
        meta: {
          actionType: "connect",
          entityName: connectorName,
        },
      });
    }
  }

  // Prioritize: pending > provenance > related
  const priority: Record<string, number> = { pending: 0, provenance: 1, related: 2 };
  cards.sort((a, b) => priority[a.type] - priority[b.type]);

  return cards.slice(0, 5);
}
