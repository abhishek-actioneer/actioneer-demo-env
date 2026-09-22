import { auth } from "@clerk/nextjs/server";
import { getAgent, saveAgent } from "@/lib/agent-store";
import { syncAgentsFromCampaigns } from "@/lib/agent-backfill";
import { listPersistedKnowledge } from "@/lib/server/knowledge-repo";
import type { Agent } from "@/lib/agent-types";

interface KnowledgeItem {
  id: string;
  title: string;
  priority: string;
  chars: number;
}

function knowledgeInventory(agent: Agent): KnowledgeItem[] {
  if (!agent.userId || !agent.datasetId) return [];
  try {
    return listPersistedKnowledge(agent.userId, agent.datasetId).map((e) => ({
      id: e.id,
      title: e.title || "(untitled)",
      priority: e.priority,
      chars: (e.content || "").length,
    }));
  } catch {
    return [];
  }
}

/** Single reusable Agent — read for the editor, PATCH to persist edits. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let agent = getAgent(id);
  if (!agent) {
    // Self-heal: the agent may not be backfilled yet.
    syncAgentsFromCampaigns({ userId });
    agent = getAgent(id);
  }
  if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });

  return Response.json({ agent, knowledge: knowledgeInventory(agent) });
}

const EDITABLE_STRING_FIELDS = ["name", "avatarSeed", "role", "voice", "voiceName", "language", "systemPrompt", "firstMessage"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });
  if (agent.userId && agent.userId !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Partial<Agent> = {};
  for (const field of EDITABLE_STRING_FIELDS) {
    if (typeof body[field] === "string") patch[field] = body[field] as string;
  }
  if (Array.isArray(body.knowledgeIds)) {
    patch.knowledgeIds = (body.knowledgeIds as unknown[]).filter((x): x is string => typeof x === "string");
  } else if (body.knowledgeIds === null) {
    patch.knowledgeIds = undefined;
  }
  if (Array.isArray(body.guardrails)) {
    patch.guardrails = (body.guardrails as unknown[]).filter((x): x is string => typeof x === "string");
  }

  saveAgent({ ...agent, ...patch });
  return Response.json({ ok: true, agent: getAgent(id) });
}
