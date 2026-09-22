/**
 * Stream a direct (non-analytics) LLM response.
 *
 * Used by use-analytics.ts for the "direct" classification path.
 */

import type { ChatMessage } from "@/lib/types";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

export async function streamDirectResponse(
  query: string,
  msgId: string,
  signal: AbortSignal,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  datasetId?: string,
  knowledgeContext?: string
) {
  const res = await apiFetch("/api/chat", {
    method: "POST",
    body: { query, knowledgeContext },
    datasetId,
    signal,
    stream: true,
  });
  if (!res.ok || !res.body) {
    toast.error("Failed to get a response. Please try again.");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done || signal.aborted) break;
    accumulated += decoder.decode(value, { stream: true });
    const content = accumulated;
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, content } : m))
    );
  }
}
