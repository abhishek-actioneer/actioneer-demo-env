// Grant/reject a derived capability request. The decision is the only thing
// persisted — requests themselves re-derive deterministically from the
// analysis payload. Grants freeze the proposed guardrails verbatim: the
// operator can decline, not enlarge (never-widen is structural).

import { auth } from "@clerk/nextjs/server";
import { loadVoiceCampaignInsights, safeVoiceInsightRunId } from "@/lib/voice-campaign-insights-loader";
import { deriveCapabilityRequests } from "@/lib/voice-campaign-capability";
import { appendEvents, readEvents, readProfiles } from "@/lib/voice-campaign-journey-store";
import { reduceCapabilityDecisions, type CapabilityEvent } from "@/lib/voice-campaign-journey-types";

export const runtime = "nodejs";

interface DecisionBody {
  runId?: string;
  requestId?: string;
  decision?: string;
  reason?: string;
  /** Client demo clock at decision time — the grant tick on the scrubber. */
  virtualAt?: string;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: DecisionBody;
  try {
    body = (await req.json()) as DecisionBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = safeVoiceInsightRunId(body.runId);
  if (!runId) return Response.json({ error: "Invalid runId" }, { status: 400 });

  if (body.decision !== "grant" && body.decision !== "reject") {
    return Response.json({ error: "Decision must be \"grant\" or \"reject\"" }, { status: 400 });
  }
  if (body.decision === "reject" && !body.reason?.trim()) {
    return Response.json({ error: "Rejection requires a reason" }, { status: 400 });
  }

  const payload = loadVoiceCampaignInsights(runId);
  if (!payload) return Response.json({ error: "Insight analysis run not found" }, { status: 404 });

  const request = deriveCapabilityRequests(payload, readProfiles(runId)).find(
    (candidate) => candidate.id === body.requestId,
  );
  if (!request) return Response.json({ error: "Capability request not found" }, { status: 404 });

  const events = readEvents(runId);
  const prior = reduceCapabilityDecisions(events).get(request.id);
  if (prior) {
    return Response.json(
      { error: "Request already decided", decidedAt: prior.at, decision: prior.type },
      { status: 409 },
    );
  }

  const at =
    body.virtualAt && Number.isFinite(Date.parse(body.virtualAt))
      ? new Date(Date.parse(body.virtualAt)).toISOString()
      : new Date().toISOString();

  const event: CapabilityEvent = {
    id: `evt_cap_${request.id}_0001`,
    runId,
    requestId: request.id,
    type: body.decision === "grant" ? "capability_granted" : "capability_rejected",
    ...(body.decision === "grant" ? { guardrails: request.proposedGuardrails } : {}),
    ...(body.decision === "reject" ? { reason: body.reason!.trim() } : {}),
    at,
  };
  appendEvents(runId, [event]);

  return Response.json({ event, request });
}
