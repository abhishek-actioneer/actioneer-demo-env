import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { getDatasetForUser } from "@/lib/datasets";
import { listSegments } from "@/lib/server/segment-repo";
import { createVoiceCampaignDraftFromSegment } from "@/lib/server/voice-campaign-draft";
import type { VoiceAgentGenerationEvent, VoiceAgentGenerationResult } from "@/lib/voice-agent-generation-types";

const GenerateVoiceAgentSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  goal: z.string().trim().min(1).max(2000),
  segmentId: z.string().trim().min(1).max(200),
  language: z.string().trim().min(1).max(80).optional(),
  voice: z.string().trim().min(1).max(120).optional(),
  voiceName: z.string().trim().min(1).max(120).optional(),
});

function datasetIdFromRequest(req: Request): string {
  const raw = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = GenerateVoiceAgentSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const datasetId = datasetIdFromRequest(req);
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const segment = listSegments(userId, datasetId).find((candidate) => candidate.id === parsed.data.segmentId);
  if (!segment) return Response.json({ error: "Selected segment not found" }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: VoiceAgentGenerationEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void (async () => {
        try {
          const { campaign, generationSummary } = await createVoiceCampaignDraftFromSegment({
            userId,
            datasetId,
            dataset,
            segment,
            objective: parsed.data.goal,
            language: parsed.data.language,
            voice: parsed.data.voice,
            voiceName: parsed.data.voiceName,
            generationRequestId: parsed.data.requestId,
            onStatus: (status) => send({ type: "status", status }),
            onBuildEvent: (event) => send({ type: "build", event }),
          });
          const normalRouteCount = campaign.workflow?.edges?.length ?? 0;
          const universalRoutes = campaign.workflow?.universalRoutes ?? [];
          const result: VoiceAgentGenerationResult = {
            campaignId: campaign.id,
            openUrl: `/voice-campaigns/new?campaignId=${encodeURIComponent(campaign.id)}`,
            agentName: campaign.name,
            segment: {
              id: segment.id,
              name: segment.name,
              userCount: segment.userCount,
            },
            workflow: {
              nodeCount: campaign.workflow?.nodes?.length ?? 0,
              routeCount: normalRouteCount + universalRoutes.length,
              universalRouteCount: universalRoutes.length,
            },
            language: campaign.language,
            voice: campaign.voice,
            voiceName: campaign.voiceName,
            summary: generationSummary,
            universalRoutes,
          };
          send({ type: "result", result });
        } catch (error) {
          send({ type: "error", error: error instanceof Error ? error.message : "Voice agent generation failed" });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
