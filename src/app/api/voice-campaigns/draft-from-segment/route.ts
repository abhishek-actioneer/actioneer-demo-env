import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { getDatasetForUser } from "@/lib/datasets";
import { listSegments } from "@/lib/server/segment-repo";
import { createVoiceCampaignDraftFromSegment } from "@/lib/server/voice-campaign-draft";

function datasetIdFromRequest(req: Request, bodyDatasetId?: string): string {
  const raw = bodyDatasetId || new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

const DraftFromSegmentSchema = z.object({
  datasetId: z.string().min(1).max(64).optional(),
  segmentId: z.string().min(1),
  purposeId: z.string().min(1).optional(),
  objective: z.string().max(1000).optional(),
  campaignName: z.string().max(200).optional(),
  language: z.string().min(1).max(80).optional(),
  voice: z.string().min(1).max(120).optional(),
  voiceName: z.string().min(1).max(120).optional(),
  phoneNumbers: z.array(z.string().min(1)).max(500).optional(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = DraftFromSegmentSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const datasetId = datasetIdFromRequest(req, parsed.data.datasetId);
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const segment = listSegments(userId, datasetId).find((item) => item.id === parsed.data.segmentId);
  if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

  try {
    const { campaign, template } = await createVoiceCampaignDraftFromSegment({
      userId,
      datasetId,
      dataset,
      segment,
      purposeId: parsed.data.purposeId,
      objective: parsed.data.objective,
      campaignName: parsed.data.campaignName,
      language: parsed.data.language,
      voice: parsed.data.voice,
      voiceName: parsed.data.voiceName,
      phoneNumbers: parsed.data.phoneNumbers,
    });

    return Response.json(
      {
        campaign,
        templateId: template.id,
        openUrl: `/voice-campaigns/new?campaignId=${encodeURIComponent(campaign.id)}`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed to create voice campaign draft" }, { status: 400 });
  }
}
