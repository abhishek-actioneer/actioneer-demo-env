import { useState, useCallback, useEffect, useMemo } from "react";
import type { ChatMessage } from "@/lib/types";

export type PanelState =
  | { type: "closed" }
  | { type: "task"; agentMsgId: string; subagentId: string | null }
  | { type: "sources"; highlightedQuery?: string };

export function usePanel(messages: ChatMessage[], agentMsgIdRef: React.RefObject<string>) {
  const [panel, setPanel] = useState<PanelState>({ type: "closed" });
  const [activeCitation, setActiveCitation] = useState<string | null>(null);

  // Escape key closes panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panel.type !== "closed") {
        setPanel({ type: "closed" });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [panel.type]);

  const handleViewTask = useCallback(() => {
    setPanel((prev) =>
      prev.type === "task" && prev.subagentId === null
        ? { type: "closed" }
        : { type: "task", agentMsgId: agentMsgIdRef.current, subagentId: null }
    );
  }, [agentMsgIdRef]);

  const handleSubagentClick = useCallback((subagentId: string) => {
    setPanel((prev) =>
      prev.type === "task" && prev.subagentId === subagentId
        ? { type: "closed" }
        : { type: "task", agentMsgId: agentMsgIdRef.current, subagentId }
    );
  }, [agentMsgIdRef]);

  const handleClosePanel = useCallback(() => {
    setPanel({ type: "closed" });
    setActiveCitation(null);
  }, []);

  const handleCitationClick = useCallback((agentId: string, queryIndex: number) => {
    const citationKey = `${agentId}:Q${queryIndex}`;
    setActiveCitation(citationKey);
    setPanel({ type: "sources", highlightedQuery: citationKey });
  }, []);

  const sourcesAgents = useMemo(() => {
    // Live session: use ref to find the exact agent message for the current query
    const agentMsg = messages.find((m) => m.id === agentMsgIdRef.current);
    if (agentMsg?.agent?.subagents?.length) return agentMsg.agent.subagents;

    // Reload fallback: find the most recent agent message with subagents
    // (covers conversations loaded from localStorage where agentMsgIdRef is "")
    const anyAgentMsg = [...messages]
      .reverse()
      .find((m) => m.role === "agent" && m.agent?.subagents?.length);
    return anyAgentMsg?.agent?.subagents ?? [];
  }, [messages, agentMsgIdRef]);

  return {
    panel,
    setPanel,
    activeCitation,
    handleViewTask,
    handleSubagentClick,
    handleClosePanel,
    handleCitationClick,
    sourcesAgents,
  };
}
