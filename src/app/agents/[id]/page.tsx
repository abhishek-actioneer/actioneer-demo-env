"use client";

import { use } from "react";
import { AgentEditor } from "@/components/agents/agent-editor";

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="h-full min-w-0">
      <AgentEditor id={id} />
    </div>
  );
}
