import { auth } from "@clerk/nextjs/server";
import { syncAgentsFromCampaigns } from "@/lib/agent-backfill";
import { listAgents, saveAgent } from "@/lib/agent-store";
import { listCampaigns } from "@/lib/voice-campaign-store";
import { isTestCall } from "@/lib/voice-campaign-analysis";
import type { Agent } from "@/lib/agent-types";

/**
 * Reusable Agents API (Phase 1). GET backfills agents from the user's campaigns
 * (idempotent), scopes them to the active dataset, and enriches each with live
 * call/workflow aggregates joined from its source campaigns — so the `/agents`
 * page reads a real entity instead of deriving one on the fly.
 */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id")?.trim() || undefined;
  syncAgentsFromCampaigns({ userId });

  const byId = new Map(listCampaigns({ userId }).map((c) => [c.id, c]));
  const agents = listAgents(userId)
    .filter((a) => !datasetId || a.datasetId === datasetId)
    .map((a) => {
      let callCount = 0;
      let workflowNodes = 0;
      for (const cid of a.sourceCampaignIds ?? []) {
        const c = byId.get(cid);
        if (!c) continue;
        callCount += (c.calls ?? []).filter((call) => !isTestCall(call)).length;
        workflowNodes += c.workflow?.nodes?.length ?? 0;
      }
      return { ...a, callCount, workflowNodes };
    });

  return Response.json({ agents });
}

/** Create a new reusable agent from scratch (not campaign-derived). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id")?.trim() || undefined;
  let body: { name?: string; role?: string; voice?: string; voiceName?: string; language?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  if (!name) return Response.json({ error: "Name is required" }, { status: 400 });

  const now = new Date().toISOString();
  const agent: Agent = {
    id: `agt_${crypto.randomUUID()}`,
    userId,
    datasetId,
    name,
    role: (body.role || "").trim() || "Voice Agent",
    voice: (body.voice || body.voiceName || "Aoede").trim(),
    voiceName: (body.voiceName || name).trim(),
    language: (body.language || "Hinglish").trim(),
    systemPrompt: "",
    firstMessage: "",
    source: "manual",
    campaignCount: 0,
    sourceCampaignIds: [],
    createdAt: now,
    updatedAt: now,
  };
  saveAgent(agent);
  return Response.json({ agent });
}
