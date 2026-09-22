import type { KnowledgeEntry, KnowledgePriority } from "./knowledge-types";

const PRIORITY_ORDER: Record<KnowledgePriority, number> = {
  Critical: 0,
  High: 1,
  "Good to have": 2,
};

/**
 * Build knowledge context string from entries.
 * When called client-side with a datasetId, loads entries from the store.
 * When called server-side, pass entries from the request body.
 */
export function buildKnowledgeContext(providedEntries?: KnowledgeEntry[], datasetId?: string): string {
  let entries: KnowledgeEntry[];
  if (providedEntries) {
    entries = providedEntries;
  } else if (datasetId) {
    // Dynamic import guard — only works client-side
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const store = require("./knowledge-store");
      entries = store.getAllEntries(datasetId);
    } catch {
      return "";
    }
  } else {
    return "";
  }

  if (entries.length === 0) return "";

  const global = entries
    .filter((e) => e.level === "global")
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  const user = entries
    .filter((e) => e.level === "user")
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  let context = "\n\n## Knowledge Base Context\n\n";
  context +=
    "Use the following knowledge when answering questions. Higher priority entries are more important.\n\n";

  if (global.length > 0) {
    context += "### Global Knowledge:\n";
    for (const entry of global) {
      context += `- [${entry.priority.toUpperCase()}] ${entry.content}\n`;
    }
  }

  if (user.length > 0) {
    context += "\n### User Preferences:\n";
    for (const entry of user) {
      context += `- [${entry.priority.toUpperCase()}] ${entry.content}\n`;
    }
  }

  return context;
}
