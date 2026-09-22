/**
 * Derive suggested actions from real conversation history and dataset prompts.
 * No hardcoded prompts — everything comes from actual user data.
 */

import { getAllConversations } from "@/lib/conversation-store";
import type { PageContext, SuggestedAction } from "@/lib/page-context";

const MAX_ACTIONS = 4;

/**
 * Get suggested actions for the chat panel based on:
 * 1. Past user queries relevant to the current page (via conversation tags)
 * 2. Dataset-provided suggested prompts as fallback
 */
export async function getSuggestedActions(
  pageContext: PageContext,
  datasetPrompts?: string[]
): Promise<SuggestedAction[]> {
  const actions: SuggestedAction[] = [];
  const { pageType } = pageContext;

  if (pageType === "general") return toActions(datasetPrompts);

  // Pull from conversation history — past queries relevant to this page
  try {
    const conversations = await getAllConversations();

    for (const conv of conversations) {
      if (actions.length >= MAX_ACTIONS) break;

      const isRelevant = conv.tags?.some(
        (t) => t.domain === pageType && t.weight >= 0.5
      );
      if (!isRelevant) continue;

      const userMsg = conv.messages?.find((m) => m.role === "user");
      if (!userMsg?.content) continue;

      const query = userMsg.content;
      if (actions.some((a) => a.prompt === query)) continue;

      actions.push({
        id: `hist-${conv.id}`,
        label: conv.title,
        description: truncate(query, 80),
        prompt: query,
      });
    }
  } catch {
    // Store not initialized
  }

  // Fill remaining slots with dataset prompts
  if (actions.length < MAX_ACTIONS && datasetPrompts?.length) {
    const existing = new Set(actions.map((a) => a.prompt));
    for (const prompt of datasetPrompts) {
      if (actions.length >= MAX_ACTIONS) break;
      if (existing.has(prompt)) continue;
      actions.push({
        id: `ds-${actions.length}`,
        label: truncate(prompt, 40),
        description: prompt,
        prompt,
      });
    }
  }

  return actions;
}

function toActions(prompts?: string[]): SuggestedAction[] {
  if (!prompts?.length) return [];
  return prompts.slice(0, MAX_ACTIONS).map((prompt, i) => ({
    id: `ds-${i}`,
    label: truncate(prompt, 40),
    description: prompt,
    prompt,
  }));
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}
