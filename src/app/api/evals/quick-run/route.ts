import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { listCampaigns } from "@/lib/voice-campaign-store";
import { enqueueVoiceEvalCall, listVoiceEvalWorkbenches } from "@/lib/server/voice-eval-repo";

const QuickRunSchema = z.object({
  workbenchId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
});

function datasetIdFromRequest(req: Request): string {
  const raw = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = QuickRunSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const datasetId = datasetIdFromRequest(req);
  const scope = { userId, datasetId };
  const workbench = listVoiceEvalWorkbenches(scope).find((item) => item.id === parsed.data.workbenchId);
  if (!workbench) return Response.json({ error: "Workbench not found" }, { status: 404 });

  const allowedCampaignIds = new Set(workbench.campaignIds);
  const calls = listCampaigns(scope)
    .filter((campaign) => allowedCampaignIds.size === 0 || allowedCampaignIds.has(campaign.id))
    .flatMap((campaign) => campaign.calls.map((call) => ({ campaignId: campaign.id, call })))
    .filter(({ call }) => call.status === "completed" || call.status === "failed" || call.status === "no_answer")
    .sort((a, b) => (b.call.endedAt ?? b.call.startedAt ?? "").localeCompare(a.call.endedAt ?? a.call.startedAt ?? ""))
    .slice(0, parsed.data.limit);

  const jobIds = calls.map(({ campaignId, call }) => enqueueVoiceEvalCall(
    { ...scope, campaignId, callId: call.id },
    { force: true, delayMs: 0 },
  ));
  return Response.json({ queued: jobIds.length, jobIds });
}
