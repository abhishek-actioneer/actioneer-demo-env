import { auth } from "@clerk/nextjs/server";
import { loadVoiceCampaignInsights, safeVoiceInsightRunId } from "@/lib/voice-campaign-insights-loader";
import { deriveCapabilityRequests } from "@/lib/voice-campaign-capability";
import { readDispatches, readEvents, readProfiles, resetJourney } from "@/lib/voice-campaign-journey-store";
import { withCapabilityStatus } from "@/lib/voice-campaign-journey-types";

export const runtime = "nodejs";

function runIdFrom(req: Request): string | undefined {
  const params = new URL(req.url).searchParams;
  return safeVoiceInsightRunId(params.get("runId") ?? params.get("run"));
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const runId = runIdFrom(req);
  if (!runId) return Response.json({ error: "Invalid runId" }, { status: 400 });

  const profiles = readProfiles(runId);
  const events = readEvents(runId);
  // Requests are derived, not stored — same payload + profiles ⇒ same requests.
  const payload = loadVoiceCampaignInsights(runId);
  const requests = payload
    ? withCapabilityStatus(deriveCapabilityRequests(payload, profiles), events)
    : [];
  return Response.json(
    {
      dispatches: readDispatches(runId),
      events,
      requests,
      profile: { horizonHours: profiles.horizonHours },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const runId = runIdFrom(req);
  if (!runId) return Response.json({ error: "Invalid runId" }, { status: 400 });

  return Response.json({ ok: true, removed: resetJourney(runId) });
}
