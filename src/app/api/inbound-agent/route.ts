import { auth } from "@clerk/nextjs/server";
import { resolvePublicBaseUrl } from "@/lib/public-base-url";
import { getCampaign } from "@/lib/voice-campaign-store";
import {
  getInboundBinding,
  saveInboundBinding,
  type InboundBinding,
  type InboundMode,
} from "@/lib/inbound-agent-store";
import { ensureInboundApp, getNumberAppId, pointNumberToApp } from "@/lib/plivo-number-binding";
import { listPersistedKnowledge } from "@/lib/server/knowledge-repo";
import { KB_TOTAL_BUDGET_CHARS, KB_SELECTED_PER_ENTRY_CHARS } from "@/lib/inbound-agent-prompt";
import { getAgent, saveAgent } from "@/lib/agent-store";
import { agentIdForCampaign, syncAgentsFromCampaigns } from "@/lib/agent-backfill";

interface KnowledgeItem {
  id: string;
  title: string;
  priority: string;
  chars: number;
}

/** KB entries scoped to the bound agent's persona (user + dataset). */
function inventoryFor(campaign: { userId?: string; datasetId?: string } | undefined): {
  datasetId: string | null;
  knowledge: KnowledgeItem[];
} {
  if (!campaign?.userId || !campaign?.datasetId) return { datasetId: null, knowledge: [] };
  try {
    const knowledge = listPersistedKnowledge(campaign.userId, campaign.datasetId).map((e) => ({
      id: e.id,
      title: e.title || "(untitled)",
      priority: e.priority,
      chars: (e.content || "").length,
    }));
    return { datasetId: campaign.datasetId, knowledge };
  } catch {
    return { datasetId: campaign.datasetId, knowledge: [] };
  }
}

/**
 * Inbound-agent binding API for the Agent detail "Inbound" section.
 * GET → current binding + truthful live state (read-only Plivo check).
 * POST { action: "activate" | "deactivate", ... } → repoints the DID and persists.
 */

function defaultNumber(): string | undefined {
  return process.env.PLIVO_PHONE_NUMBER?.trim() || undefined;
}

function answerUrls(req: Request): { answerUrl: string; hangupUrl: string } {
  const base = resolvePublicBaseUrl(req);
  if (!base) throw new Error("Public base URL is not configured");
  return {
    answerUrl: `${base}/api/voice/plivo-answer-inbound`,
    hangupUrl: `${base}/api/voice/plivo-status`,
  };
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const number = new URL(req.url).searchParams.get("number") || defaultNumber();
  if (!number) return Response.json({ number: null, binding: null, live: false });

  const binding = getInboundBinding(number) ?? null;
  // Phase 1: persona + grounding come from the bound Agent entity when present;
  // otherwise fall back to the campaign persona (legacy bindings). The UI matches
  // the chip on the agent name (agents group many campaigns).
  const boundAgent = binding?.agentId ? getAgent(binding.agentId) : undefined;
  const boundCampaign = binding?.campaignId ? getCampaign(binding.campaignId) : undefined;
  const agentName = boundAgent?.name?.trim() || boundCampaign?.voiceName?.trim() || null;
  const groundingScope = boundAgent
    ? { userId: boundAgent.userId, datasetId: boundAgent.datasetId }
    : boundCampaign;
  const selectedKnowledgeIds = boundAgent
    ? boundAgent.knowledgeIds ?? null
    : binding?.knowledgeIds ?? null;

  let live = false;
  let currentAppId: string | undefined;
  try {
    currentAppId = await getNumberAppId(number);
    live = Boolean(binding?.appId && currentAppId === binding.appId);
  } catch {
    // Plivo unreachable — fall back to the persisted flag.
    live = Boolean(binding?.live);
  }

  const { datasetId, knowledge } = inventoryFor(groundingScope);
  return Response.json({
    number,
    binding,
    live,
    currentAppId,
    agentName,
    datasetId,
    knowledge,
    // null = auto (whole KB, priority-ordered + truncated); array = curated.
    selectedKnowledgeIds,
    context: { totalBudgetChars: KB_TOTAL_BUDGET_CHARS, perEntryChars: KB_SELECTED_PER_ENTRY_CHARS },
  });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    action?: string;
    campaignId?: string;
    number?: string;
    greeting?: string;
    companyName?: string;
    knowledgeIds?: string[] | null;
    script?: string | null;
    verificationRequired?: boolean;
    mode?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const number = body.number?.trim() || defaultNumber();
  if (!number) return Response.json({ error: "No number configured (PLIVO_PHONE_NUMBER)" }, { status: 400 });

  try {
    if (body.action === "set-context") {
      const existing = getInboundBinding(number);
      if (!existing) {
        return Response.json({ error: "Activate inbound before choosing its context." }, { status: 400 });
      }
      // null → auto (whole KB); array (incl. empty) → curated selection.
      const ids = Array.isArray(body.knowledgeIds)
        ? body.knowledgeIds.filter((x): x is string => typeof x === "string")
        : null;

      // Phase 1: knowledge selection lives on the Agent when the binding points
      // at one. Fall back to the binding for legacy (agent-less) bindings.
      const agent = existing.agentId ? getAgent(existing.agentId) : undefined;
      if (agent) {
        saveAgent({ ...agent, knowledgeIds: ids ?? undefined });
        return Response.json({ ok: true, selectedKnowledgeIds: ids });
      }
      const saved: InboundBinding = {
        ...existing,
        knowledgeIds: ids ?? undefined,
        updatedAt: new Date().toISOString(),
      };
      saveInboundBinding(saved);
      return Response.json({ ok: true, selectedKnowledgeIds: saved.knowledgeIds ?? null });
    }

    // Per-number talk-track. This is what makes two DIDs on one account behave
    // as two different agents (welcome line vs collections line); the script
    // lives on the binding, not the agent, because the agent may serve both.
    if (body.action === "set-script") {
      const existing = getInboundBinding(number);
      if (!existing) {
        return Response.json({ error: "Activate inbound before setting its script." }, { status: 400 });
      }
      // null / empty → clear the script and fall back to greet → discover → route.
      const script = typeof body.script === "string" ? body.script.trim() : "";
      const saved: InboundBinding = {
        ...existing,
        script: script || undefined,
        ...(typeof body.verificationRequired === "boolean"
          ? { verificationRequired: body.verificationRequired }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      saveInboundBinding(saved);
      return Response.json({
        ok: true,
        number: saved.number,
        script: saved.script ?? null,
        // Surfaced explicitly: turning this off lets the line discuss account
        // specifics without verifying who is calling.
        verificationRequired: saved.verificationRequired !== false,
      });
    }

    if (body.action === "deactivate") {
      const existing = getInboundBinding(number);
      if (existing?.rollbackAppId) await pointNumberToApp(number, existing.rollbackAppId);
      // Spread `existing` rather than re-listing fields: this branch used to
      // rebuild the record by hand and silently dropped agentId, knowledgeIds,
      // and now script/verificationRequired — so pausing a number and
      // reactivating it lost its configuration.
      const saved: InboundBinding = {
        ...existing,
        number,
        agentId: existing?.agentId,
        mode: existing?.mode,
        campaignId: existing?.campaignId ?? "",
        live: false,
        updatedAt: new Date().toISOString(),
      };
      saveInboundBinding(saved);
      return Response.json({ ok: true, live: false, binding: saved });
    }

    if (body.action === "activate") {
      const campaign = body.campaignId ? getCampaign(body.campaignId) : undefined;
      if (!campaign) {
        return Response.json({ error: "Unknown or missing campaignId (agent persona)" }, { status: 400 });
      }
      const mode: InboundMode = body.mode === "campaign-script" ? "campaign-script" : "inbound-agent";

      // Ensure a real Agent entity exists for this persona and bind the number to
      // it (Phase 1) — persona/knowledge now live on the agent, not the campaign.
      // In campaign-script mode the campaign is the brain, so no agent is bound.
      let agentId: string | undefined;
      if (mode === "inbound-agent") {
        syncAgentsFromCampaigns({ userId });
        agentId = agentIdForCampaign(campaign);
      }

      const { answerUrl, hangupUrl } = answerUrls(req);
      const appId = await ensureInboundApp(answerUrl, hangupUrl);
      // Capture rollback the first time we bind (the app the number pointed at,
      // unless it's already ours). Preserve any previously captured rollback.
      const existing = getInboundBinding(number);
      let rollbackAppId = existing?.rollbackAppId;
      if (!rollbackAppId) {
        const currentAppId = await getNumberAppId(number);
        if (currentAppId && currentAppId !== appId) rollbackAppId = currentAppId;
      }
      await pointNumberToApp(number, appId);
      const saved: InboundBinding = {
        number,
        agentId,
        mode,
        campaignId: campaign.id,
        greeting: body.greeting?.trim() || existing?.greeting,
        companyName: body.companyName?.trim() || existing?.companyName,
        // Preserve curated grounding / script / verification across reactivate —
        // dropping them silently reverted demo personas to the generic agent.
        knowledgeIds: existing?.knowledgeIds,
        script: existing?.script,
        verificationRequired: existing?.verificationRequired,
        appId,
        rollbackAppId,
        live: true,
        updatedAt: new Date().toISOString(),
      };
      saveInboundBinding(saved);

      // Public demo DID: keep a Gemini Live session warm so the next inbound
      // call does not pay a cold-start after connect.
      try {
        const { ensurePublicDemoStandbyPrewarm } = await import("@/lib/public-demo-prewarm");
        ensurePublicDemoStandbyPrewarm({
          voice: campaign.voice,
          voiceName: campaign.voiceName,
          language: campaign.language,
          campaignId: campaign.id,
          datasetId: campaign.datasetId,
          userId: campaign.userId,
        });
      } catch (err) {
        console.warn("[api/inbound-agent] demo standby prewarm skipped:", err);
      }

      return Response.json({ ok: true, live: true, binding: saved });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Inbound binding failed";
    console.error("[api/inbound-agent] binding error:", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
