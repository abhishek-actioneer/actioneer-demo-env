import { auth } from "@clerk/nextjs/server";
import { getCampaign } from "@/lib/voice-campaign-store";
import {
  latestVoiceInsightRunId,
  loadVoiceCampaignInsights,
  safeVoiceInsightRunId,
} from "@/lib/voice-campaign-insights-loader";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";

export const runtime = "nodejs";

function runMatchesCampaign(runId: string, campaign: VoiceCampaign): boolean {
  if (!/\bkyc\b/i.test(runId)) return true;
  const campaignText = [
    campaign.name,
    campaign.segmentName,
    campaign.purposeName,
    campaign.systemPrompt,
    campaign.firstMessage,
    campaign.editableScript,
  ].join(" ");
  return /\bkyc\b|know your customer|verification/i.test(campaignText);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaign = getCampaign(id, { userId });
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });

  const requestedRunId = safeVoiceInsightRunId(new URL(req.url).searchParams.get("runId"));
  const runId = requestedRunId ?? safeVoiceInsightRunId(process.env.VOICE_INSIGHTS_RUN_ID) ?? latestVoiceInsightRunId();
  if (!runId) return Response.json({ error: "No insight analysis run found" }, { status: 404 });
  if (!runMatchesCampaign(runId, campaign)) {
    return Response.json({ error: "No matching insight analysis run found for this campaign" }, { status: 404 });
  }

  const payload = loadVoiceCampaignInsights(runId);
  if (!payload) return Response.json({ error: "Insight analysis run is incomplete" }, { status: 404 });

  return Response.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
