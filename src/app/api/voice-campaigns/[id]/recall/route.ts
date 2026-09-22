import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getCampaign, updateCampaign, updateCampaignStatus } from "@/lib/voice-campaign-store";
import { activeVoiceCallProvider } from "@/lib/voice-call-provider";
import { ensureCampaignCallConfig, seedPlannedVoiceCalls, startPlannedVoiceCalls } from "@/lib/voice-campaign-runner";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { listSegments } from "@/lib/server/segment-repo";
import { VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS } from "@/lib/voice-campaign-studio-utils";
import { buildPlannedVoiceCallsWithCustomerContext, voiceCustomerContextErrorResponse } from "@/lib/server/voice-customer-context-repo";
import {
  normalizeVoiceCampaignExperimentSplit,
  successDefinitionWithExperimentBaseline,
} from "@/lib/voice-campaign-experiment";
import { VoiceCampaignExperimentSplitSchema } from "@/lib/server/voice-campaign-experiment-schema";
import { VoiceCampaignSuccessDefinitionSchema } from "@/lib/server/voice-campaign-success-schema";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";

const RecallSchema = z.object({
  campaignName: z.string().trim().min(1).max(200).optional(),
  voice: z.string().trim().min(1).optional(),
  voiceName: z.string().trim().min(1).optional(),
  callProvider: z.literal("plivo-gemini").optional(),
  language: z.string().trim().min(1).optional(),
  languageExplicit: z.boolean().optional(),
  phoneNumbers: z.array(z.string().trim().min(1)).min(1).max(500).optional(),
  systemPrompt: z.string().trim().min(1).optional(),
  firstMessage: z.string().trim().min(1).optional(),
  scriptReasoning: z.string().optional(),
  editableScript: z.string().max(VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS).optional(),
  workflow: z.object({
    templateId: z.string().optional(),
    templateTitle: z.string().optional(),
    nodes: z.array(z.unknown()).optional(),
    edges: z.array(z.unknown()).optional(),
  }).optional(),
  successDefinition: VoiceCampaignSuccessDefinitionSchema.optional(),
  experimentSplit: VoiceCampaignExperimentSplitSchema.optional(),
});

function datasetIdFromRequest(req: Request): string {
  const raw = new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const requestedDatasetId = datasetIdFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const parsed = RecallSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  let campaign = getCampaign(id, { userId });
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });
  const datasetId = campaign.datasetId || requestedDatasetId;
  const patch = parsed.data;
  if (
    patch.phoneNumbers ||
    patch.campaignName ||
    patch.voice ||
    patch.voiceName ||
    patch.callProvider ||
    patch.language ||
    patch.languageExplicit !== undefined ||
    patch.systemPrompt ||
    patch.firstMessage ||
    patch.scriptReasoning !== undefined ||
    patch.editableScript !== undefined ||
    patch.workflow ||
    patch.successDefinition !== undefined ||
    patch.experimentSplit !== undefined
  ) {
    campaign = updateCampaign(id, {
      ...(patch.phoneNumbers ? { phoneNumbers: patch.phoneNumbers } : {}),
      ...(patch.campaignName ? { name: patch.campaignName } : {}),
      ...(patch.voice ? { voice: patch.voice } : {}),
      ...(patch.voiceName ? { voiceName: patch.voiceName } : {}),
      ...(patch.callProvider ? { callProvider: patch.callProvider } : {}),
      ...(patch.language ? { language: patch.language } : {}),
      ...(patch.language || patch.languageExplicit !== undefined ? { languageExplicit: patch.languageExplicit ?? true } : {}),
      ...(patch.systemPrompt ? { systemPrompt: patch.systemPrompt } : {}),
      ...(patch.firstMessage ? { firstMessage: patch.firstMessage } : {}),
      ...(patch.scriptReasoning !== undefined ? { scriptReasoning: patch.scriptReasoning } : {}),
      ...(patch.editableScript !== undefined ? { editableScript: patch.editableScript } : {}),
      ...(patch.workflow ? { workflow: patch.workflow as VoiceCampaign["workflow"] } : {}),
      ...(patch.successDefinition !== undefined
        ? { successDefinition: successDefinitionWithExperimentBaseline(patch.successDefinition, patch.experimentSplit ?? campaign.experimentSplit) }
        : {}),
      ...(patch.experimentSplit !== undefined
        ? { experimentSplit: normalizeVoiceCampaignExperimentSplit(patch.experimentSplit) }
        : {}),
    }, { userId, datasetId });
    if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (campaign.phoneNumbers.length === 0) {
    return Response.json({ error: "At least one phone number is required to call again" }, { status: 400 });
  }

  const callProvider = activeVoiceCallProvider(campaign.callProvider);
  const launchRoute = "/api/voice-campaigns/[id]/recall";

  try {
    ensureCampaignCallConfig(callProvider);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const segment = listSegments(userId, datasetId).find((item) => item.id === campaign.segmentId);
  let plannedCalls;
  try {
    plannedCalls = await buildPlannedVoiceCallsWithCustomerContext({
      campaign,
      phoneNumbers: campaign.phoneNumbers,
      segmentSql: segment?.sql,
      callConfigIdForIndex: (index) => `${id}_recall_${index}_${Math.random().toString(36).slice(2, 8)}`,
    });
  } catch (err) {
    const response = voiceCustomerContextErrorResponse(err);
    if (response) return response;
    throw err;
  }

  updateCampaignStatus(id, "in_progress", { userId, datasetId });

  console.info("[voice/campaigns]", {
    event: "launch.request.accepted",
    route: launchRoute,
    campaignId: id,
    callProvider,
    calls: plannedCalls.length,
  });

  seedPlannedVoiceCalls(campaign, plannedCalls, { route: launchRoute, callTags: ["test call"] });

  void startPlannedVoiceCalls(campaign, plannedCalls, { route: launchRoute, callTags: ["test call"] });

  return Response.json({ ok: true, callProvider });
}
