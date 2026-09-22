"use client";

import type { ChatMessage } from "@/lib/types";
import { MainAgentPanel } from "./main-agent-panel";
import { SubagentDetailPanel } from "./subagent-detail-panel";

export interface TaskPanelProps {
  agentMsgId: string;
  selectedSubagentId: string | null;
  messages: ChatMessage[];
  onClose: () => void;
  onSubagentClick: (subagentId: string) => void;
}

export function TaskPanel({
  agentMsgId,
  selectedSubagentId,
  messages,
  onClose,
  onSubagentClick,
}: TaskPanelProps) {
  const agentMsg = messages.find((m) => m.id === agentMsgId);
  const agent = agentMsg?.agent;

  if (selectedSubagentId) {
    const subagent = agent?.subagents.find((s) => s.id === selectedSubagentId);
    if (subagent) {
      return (
        <SubagentDetailPanel
          subagent={subagent}
          onClose={onClose}
        />
      );
    }
  }

  return (
    <MainAgentPanel
      agent={agent ?? undefined}
      messages={messages}
      onClose={onClose}
      onSubagentClick={onSubagentClick}
    />
  );
}
