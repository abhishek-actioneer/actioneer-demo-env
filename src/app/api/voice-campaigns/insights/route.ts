import { auth } from "@clerk/nextjs/server";
import {
  latestVoiceInsightRunId,
  loadVoiceCampaignInsights,
  safeVoiceInsightRunId,
} from "@/lib/voice-campaign-insights-loader";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestedRunId = safeVoiceInsightRunId(new URL(req.url).searchParams.get("runId"));
  const runId = requestedRunId ?? safeVoiceInsightRunId(process.env.VOICE_INSIGHTS_RUN_ID) ?? latestVoiceInsightRunId();
  if (!runId) return Response.json({ error: "No insight analysis run found" }, { status: 404 });

  const payload = loadVoiceCampaignInsights(runId);
  if (!payload) return Response.json({ error: "Insight analysis run is incomplete" }, { status: 404 });

  return Response.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
