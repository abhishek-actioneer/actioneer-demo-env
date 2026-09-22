import { auth } from "@clerk/nextjs/server";
import { loadVoiceCampaignInsights, safeVoiceInsightRunId } from "@/lib/voice-campaign-insights-loader";
import { hashStringToSeed, mulberry32 } from "@/lib/seeded-random";
import { deriveCapabilityRequests } from "@/lib/voice-campaign-capability";
import { generateTimeline } from "@/lib/voice-campaign-journey-sim";
import { appendEvents, readDispatches, readEvents, readProfiles, saveDispatch } from "@/lib/voice-campaign-journey-store";
import {
  reduceCapabilityDecisions,
  reduceJourneyStates,
  type JourneyAction,
  type JourneyDispatch,
  type JourneyDispatchScope,
} from "@/lib/voice-campaign-journey-types";

export const runtime = "nodejs";

const ACTIONS = new Set<JourneyAction>(["send_kyc_link", "schedule_retry", "route_human", "suppress"]);

interface DispatchBody {
  runId?: string;
  scope?: { clusterId?: string; laneId?: string };
  action?: string;
  holdoutFraction?: number;
  /** 2 = grant-gated re-call wave; requires grantRequestId. Default 1. */
  wave?: number;
  grantRequestId?: string;
  /** Client demo clock — becomes the timeline t0 (the server has no clock of its own). */
  virtualAt?: string;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: DispatchBody;
  try {
    body = (await req.json()) as DispatchBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = safeVoiceInsightRunId(body.runId);
  if (!runId) return Response.json({ error: "Invalid runId" }, { status: 400 });

  const action = body.action as JourneyAction;
  if (!ACTIONS.has(action)) return Response.json({ error: "Invalid action" }, { status: 400 });

  const clusterId = body.scope?.clusterId;
  const laneId = body.scope?.laneId;
  if ((clusterId ? 1 : 0) + (laneId ? 1 : 0) !== 1) {
    return Response.json({ error: "Scope must name exactly one of clusterId or laneId" }, { status: 400 });
  }

  const payload = loadVoiceCampaignInsights(runId);
  if (!payload) return Response.json({ error: "Insight analysis run not found" }, { status: 404 });

  const scopedClusters = clusterId
    ? payload.clusters.filter((cluster) => cluster.id === clusterId)
    : payload.clusters.filter((cluster) => cluster.laneId === laneId);
  if (
    scopedClusters.length === 0 ||
    (laneId && !payload.lanes.some((lane) => lane.id === laneId))
  ) {
    return Response.json({ error: "Scope not found in this run" }, { status: 404 });
  }

  let callIds = [...new Set(scopedClusters.flatMap((cluster) => cluster.callIds))];
  if (callIds.length === 0) {
    return Response.json({ error: "Scope contains no calls" }, { status: 400 });
  }

  const wave: 1 | 2 = body.wave === 2 ? 2 : 1;
  const createdAt =
    body.virtualAt && Number.isFinite(Date.parse(body.virtualAt))
      ? new Date(Date.parse(body.virtualAt)).toISOString()
      : new Date().toISOString();

  const profiles = readProfiles(runId);
  const dispatches = readDispatches(runId);
  const events = readEvents(runId);

  if (wave === 2) {
    // A wave-2 dispatch executes a grant, exactly: same scope, same action,
    // one wave per grant. Grants never widen mid-campaign.
    if (!body.grantRequestId) {
      return Response.json({ error: "Wave 2 requires grantRequestId" }, { status: 400 });
    }
    const decision = reduceCapabilityDecisions(events).get(body.grantRequestId);
    if (decision?.type !== "capability_granted") {
      return Response.json({ error: "Capability not granted for this request" }, { status: 409 });
    }
    const request = deriveCapabilityRequests(payload, profiles).find(
      (candidate) => candidate.id === body.grantRequestId,
    );
    if (!request) {
      return Response.json({ error: "Granted request is no longer derivable" }, { status: 409 });
    }
    if (!clusterId || !("clusterId" in request.scope) || request.scope.clusterId !== clusterId) {
      return Response.json({ error: "Dispatch scope must equal the granted scope" }, { status: 400 });
    }
    if (action !== request.capability) {
      return Response.json({ error: "Dispatch action must equal the granted capability" }, { status: 400 });
    }
    const priorWave = dispatches.find((prior) => prior.grantRequestId === body.grantRequestId);
    if (priorWave) {
      return Response.json(
        { error: "This grant has already run its wave", conflictingDispatchId: priorWave.id },
        { status: 409 },
      );
    }
    // The grant covers the request's evidence — the unresolved calls — not
    // every call in the cluster. Of those, re-call only calls still open at
    // the demo clock: not completed, not suppressed.
    const evidence = new Set(request.evidence.callIds);
    const states = reduceJourneyStates(events.filter((event) => event.at <= createdAt));
    callIds = callIds.filter((id) => {
      if (!evidence.has(id)) return false;
      const state = states.get(id);
      return state !== "completed" && state !== "suppressed";
    });
    if (callIds.length === 0) {
      return Response.json({ error: "No open calls left in the granted scope" }, { status: 400 });
    }
  }

  if (action === "send_kyc_link") {
    const scoped = new Set(callIds);
    const conflict = dispatches.find(
      (prior) =>
        prior.action === "send_kyc_link" &&
        [...prior.callIds, ...prior.holdoutCallIds].some((id) => scoped.has(id))
    );
    if (conflict) {
      return Response.json(
        { error: "Calls in this scope already have a link dispatch", conflictingDispatchId: conflict.id },
        { status: 409 }
      );
    }
  }

  const id = `dsp_${String(dispatches.length + 1).padStart(3, "0")}`;
  const seed = hashStringToSeed(`${runId}:${id}`);
  const holdoutFraction =
    action === "send_kyc_link" ? Math.min(Math.max(body.holdoutFraction ?? 0.1, 0), 0.5) : 0;

  // Seeded Fisher-Yates; distinct seed from the timeline so draws don't correlate.
  const shuffled = [...callIds];
  const splitRandom = mulberry32(seed ^ 0x9e3779b9);
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(splitRandom() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const holdoutCount = Math.floor(shuffled.length * holdoutFraction);
  const holdoutCallIds = shuffled.slice(0, holdoutCount).sort();
  const treatedCallIds = shuffled.slice(holdoutCount).sort();

  const scope: JourneyDispatchScope = clusterId ? { clusterId } : { laneId: laneId as string };
  const dispatch: JourneyDispatch = {
    id,
    runId,
    scope,
    action,
    wave,
    ...(wave === 2 ? { grantRequestId: body.grantRequestId } : {}),
    callIds: treatedCallIds,
    holdoutCallIds,
    holdoutFraction,
    seed,
    createdAt,
  };

  const clusterIdByCallId: Record<string, string> = {};
  for (const cluster of payload.clusters) {
    for (const memberCallId of cluster.callIds) clusterIdByCallId[memberCallId] = cluster.id;
  }

  const timeline = generateTimeline(dispatch, profiles, clusterIdByCallId);
  saveDispatch(runId, dispatch);
  appendEvents(runId, timeline);

  return Response.json({ dispatch, eventCount: timeline.length });
}
