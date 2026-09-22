import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getCampaign, upsertCall } from "@/lib/voice-campaign-store";
import {
  analyzeVoiceCallResponse,
  voiceCallNeedsAnalysis,
} from "@/lib/voice-response-analysis";

export const runtime = "nodejs";

const AnalyzeResponsesSchema = z.object({
  force: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = AnalyzeResponsesSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const campaign = getCampaign(id, { userId });
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });

  let analyzed = 0;
  let skipped = 0;
  for (const call of campaign.calls ?? []) {
    if (!voiceCallNeedsAnalysis(call, parsed.data.force ?? false)) {
      skipped += 1;
      continue;
    }

    const analysis = await analyzeVoiceCallResponse(campaign, call);
    upsertCall(campaign.id, {
      id: call.id,
      analysis,
      summary: analysis.summary,
    });
    analyzed += 1;
  }

  return Response.json(
    { ok: true, analyzed, skipped, campaign: getCampaign(id, { userId }) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
