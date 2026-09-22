import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getCampaign, updateCampaign, updateCampaignStatus } from "@/lib/voice-campaign-store";
import { activeVoiceCallProvider } from "@/lib/voice-call-provider";
import { ensureCampaignCallConfig, seedPlannedVoiceCalls, startPlannedVoiceCalls } from "@/lib/voice-campaign-runner";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { listSegments } from "@/lib/server/segment-repo";
import { buildPlannedVoiceCallsWithCustomerContext, voiceCustomerContextErrorResponse } from "@/lib/server/voice-customer-context-repo";
import { normalizeVoiceCampaignExperimentSplit } from "@/lib/voice-campaign-experiment";
import { canonicalizeCampaignVoice } from "@/lib/voice-campaign-voice-validation";
import { VoiceCampaignExperimentSplitSchema } from "@/lib/server/voice-campaign-experiment-schema";
import type { VoiceCampaignExperimentSplit } from "@/lib/voice-campaign-types";

function datasetIdFromRequest(req: Request): string {
  const raw = new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

const LaunchSchema = z.object({
  campaignName: z.string().trim().min(1).max(200).optional(),
  phoneNumbers: z.array(z.string().min(1)).min(1).max(500).optional(),
  voice: z.string().min(1).max(120).optional(),
  voiceName: z.string().min(1).max(120).optional(),
  callProvider: z.enum(["plivo-gemini", "mulberry-pipecat"]).optional(),
  language: z.string().min(1).max(80).optional(),
  languageExplicit: z.boolean().optional(),
  experimentSplit: VoiceCampaignExperimentSplitSchema.optional(),
});

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function selectExperimentTestPhoneNumbers(
  phoneNumbers: string[],
  campaignId: string,
  split: VoiceCampaignExperimentSplit,
): string[] {
  if (!split.enabled) return phoneNumbers;
  const targetCount = Math.max(1, Math.min(phoneNumbers.length, Math.round((phoneNumbers.length * split.testPercent) / 100)));
  return phoneNumbers
    .map((phoneNumber, index) => ({
      phoneNumber,
      rank: hashString(`${campaignId}:${split.testPercent}:${phoneNumber}:${index}`),
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, targetCount)
    .map((item) => item.phoneNumber);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const requestedDatasetId = datasetIdFromRequest(req);
  let campaign = getCampaign(id, { userId });
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });
  const datasetId = campaign.datasetId || requestedDatasetId;
  if (campaign.status !== "launching" && campaign.status !== "draft") {
    return Response.json({ error: "Campaign already launched" }, { status: 409 });
  }

  const rawBody = await req.json().catch(() => ({}));
  const parsed = LaunchSchema.safeParse(rawBody);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const patch = parsed.data;
  const nextCallProvider = activeVoiceCallProvider(patch.callProvider ?? campaign.callProvider);
  const shouldValidateVoice = patch.voice !== undefined || patch.callProvider !== undefined;
  let normalizedVoice: string | undefined;
  if (shouldValidateVoice) {
    try {
      normalizedVoice = canonicalizeCampaignVoice(patch.voice ?? campaign.voice, nextCallProvider);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  if (
    patch.campaignName ||
    patch.phoneNumbers ||
    patch.voice ||
    patch.voiceName ||
    patch.callProvider ||
    patch.language ||
    patch.languageExplicit !== undefined ||
    patch.experimentSplit !== undefined
  ) {
    campaign = updateCampaign(id, {
      ...(patch.campaignName ? { name: patch.campaignName } : {}),
      ...(patch.phoneNumbers ? { phoneNumbers: patch.phoneNumbers } : {}),
      ...(normalizedVoice !== undefined
        ? { voice: normalizedVoice }
        : patch.voice
          ? { voice: patch.voice }
          : {}),
      ...(patch.voiceName ? { voiceName: patch.voiceName } : {}),
      ...(patch.callProvider ? { callProvider: nextCallProvider } : {}),
      ...(patch.language ? { language: patch.language } : {}),
      ...(patch.language || patch.languageExplicit !== undefined ? { languageExplicit: patch.languageExplicit ?? true } : {}),
      ...(patch.experimentSplit !== undefined
        ? { experimentSplit: normalizeVoiceCampaignExperimentSplit(patch.experimentSplit) }
        : {}),
    }, { userId, datasetId });
    if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (campaign.phoneNumbers.length === 0) {
    return Response.json({ error: "At least one phone number is required to launch" }, { status: 400 });
  }
  if (!campaign.systemPrompt.trim()) {
    return Response.json({ error: "Campaign script is required to launch" }, { status: 400 });
  }

  const activeCampaign = campaign;
  const callProvider = activeVoiceCallProvider(activeCampaign.callProvider);
  const launchRoute = "/api/voice-campaigns/[id]/launch";

  try {
    ensureCampaignCallConfig(callProvider);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const experimentSplit = normalizeVoiceCampaignExperimentSplit(activeCampaign.experimentSplit);
  const launchPhoneNumbers = selectExperimentTestPhoneNumbers(activeCampaign.phoneNumbers, activeCampaign.id, experimentSplit);
  const segment = listSegments(userId, datasetId).find((item) => item.id === activeCampaign.segmentId);
  let plannedCalls;
  try {
    plannedCalls = await buildPlannedVoiceCallsWithCustomerContext({
      campaign: activeCampaign,
      phoneNumbers: launchPhoneNumbers,
      segmentSql: segment?.sql,
      callConfigIdForIndex: (index) => `${id}_launch_${index}_${Math.random().toString(36).slice(2, 8)}`,
    });
  } catch (err) {
    const response = voiceCustomerContextErrorResponse(err);
    if (response) return response;
    throw err;
  }

  updateCampaignStatus(id, "in_progress", { userId, datasetId });
  campaign = updateCampaign(id, {
    audienceLaunchedAt: activeCampaign.audienceLaunchedAt ?? new Date().toISOString(),
  }, { userId, datasetId }) ?? activeCampaign;

  console.info("[voice/campaigns]", {
    event: "launch.request.accepted",
    route: launchRoute,
    campaignId: id,
    callProvider,
    calls: plannedCalls.length,
    baseAudience: campaign.phoneNumbers.length,
    testPercent: experimentSplit.enabled ? experimentSplit.testPercent : 100,
    controlPercent: experimentSplit.enabled ? experimentSplit.controlPercent : 0,
  });

  seedPlannedVoiceCalls(campaign, plannedCalls, { route: launchRoute, callTags: experimentSplit.enabled ? ["campaign", "test-arm"] : ["campaign"] });

  void startPlannedVoiceCalls(campaign, plannedCalls, { route: launchRoute, callTags: experimentSplit.enabled ? ["campaign", "test-arm"] : ["campaign"] });

  return Response.json({ ok: true, callProvider });
}
