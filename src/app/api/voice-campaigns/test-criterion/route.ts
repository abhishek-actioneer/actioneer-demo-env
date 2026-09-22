import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getCampaign } from "@/lib/voice-campaign-store";
import { checkCriterion } from "@/lib/voice-response-analysis";
import { selectDisplayTranscript } from "@/lib/voice-transcript-display";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";

const BodySchema = z.object({
  criterion: z.string().trim().min(1).max(2000),
  campaignId: z.string().trim().min(1),
  callCount: z.number().int().min(1).max(20).default(5),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { criterion, campaignId, callCount } = parsed.data;

  const campaign = getCampaign(campaignId, { userId });
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });
  const datasetId = campaign.datasetId ?? DEFAULT_DATASET;

  const callsWithTranscripts = (Array.isArray(campaign.calls) ? campaign.calls : [])
    .filter((c) => c.transcript && c.transcript.length > 0)
    .slice(-callCount);

  if (callsWithTranscripts.length === 0) {
    return Response.json({ results: [], message: "No calls with transcripts found yet." });
  }

  const results = await Promise.all(
    callsWithTranscripts.map(async (call) => {
      const turns = selectDisplayTranscript(call);
      const { met, reason } = await checkCriterion(criterion, turns, datasetId);
      return {
        callId: call.id,
        summary: call.analysis?.summary ?? call.summary ?? "No summary available.",
        criterionMet: met,
        reason,
      };
    }),
  );

  return Response.json({ results });
}
