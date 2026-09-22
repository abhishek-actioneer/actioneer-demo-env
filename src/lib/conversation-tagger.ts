import type { ChatMessage } from "@/lib/types";
import type { ConversationTag } from "@/lib/conversation-types";

const AGENT_DOMAIN_MAP: Record<string, string[]> = {
  "data-quality": ["data-catalog"],
  "daily-metrics": ["metrics", "forecasting"],
  "cohort-retention": ["segments", "metrics"],
  "rev-opt": ["store", "metrics"],
  "user-segmentation": ["segments"],
  "geographic": ["store"],
  "research": ["knowledge"],
  "data-analysis": ["metrics", "forecasting"],
  "marketing-optimization": ["store", "segments"],
  "critique": [],
};

const ACTION_DOMAIN_MAP: Record<string, string[]> = {
  "create-segment": ["segments"],
  "create-segment-clevertap": ["segments", "connectors"],
  "create-segment-firebase": ["segments", "connectors"],
  "create-segment-bigquery": ["segments"],
  "view-in-store": ["store"],
  "follow-up-question": [],
};

/**
 * Derive thematic tags from conversation messages.
 * Called at save time — no LLM, purely heuristic.
 */
export function deriveConversationTags(messages: ChatMessage[]): ConversationTag[] {
  const tagMap = new Map<string, ConversationTag>();

  const addTag = (domain: string, source: ConversationTag["source"], weight: number) => {
    const existing = tagMap.get(domain);
    if (!existing || weight > existing.weight) {
      tagMap.set(domain, { domain, source, weight });
    }
  };

  for (const msg of messages) {
    if (msg.agent?.subagents) {
      for (const sub of msg.agent.subagents) {
        const domains = AGENT_DOMAIN_MAP[sub.id];
        if (domains) {
          for (const d of domains) addTag(d, "agent", 0.8);
        }
      }
    }

    if (msg.followUpActions) {
      for (const action of msg.followUpActions) {
        const domains = ACTION_DOMAIN_MAP[action.type];
        if (domains) {
          for (const d of domains) addTag(d, "action", 1.0);
        }
      }
    }

    if (msg.metricContext?.metricId) {
      addTag("metrics", "metric", 1.0);
    }

    if (msg.connectorInfo) {
      addTag("connectors", "keyword", 0.7);
    }
  }

  return Array.from(tagMap.values());
}
