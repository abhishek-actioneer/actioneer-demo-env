import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { saveCampaign, listCampaigns, updateCampaignStatus } from "@/lib/voice-campaign-store";
import { enrichCampaignWithSuccessSignals } from "@/lib/voice-campaign-success-signals";
import { activeVoiceCallProvider } from "@/lib/voice-call-provider";
import { ensureCampaignCallConfig, seedPlannedVoiceCalls, startPlannedVoiceCalls } from "@/lib/voice-campaign-runner";
import { getPurpose } from "@/lib/purpose-store";
import { listSegments } from "@/lib/server/segment-repo";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { getDatasetForUser } from "@/lib/datasets";
import { VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS } from "@/lib/voice-campaign-studio-utils";
import { buildPlannedVoiceCallsWithCustomerContext, voiceCustomerContextErrorResponse } from "@/lib/server/voice-customer-context-repo";
import {
  normalizeVoiceCampaignExperimentSplit,
  successDefinitionWithExperimentBaseline,
} from "@/lib/voice-campaign-experiment";
import { canonicalizeCampaignVoice } from "@/lib/voice-campaign-voice-validation";
import { VoiceCampaignExperimentSplitSchema } from "@/lib/server/voice-campaign-experiment-schema";
import { VoiceCampaignSuccessDefinitionSchema } from "@/lib/server/voice-campaign-success-schema";
import { DEFAULT_GEMINI_VOICE } from "@/lib/gemini-voices";
import type { Purpose } from "@/lib/purpose-types";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";

function datasetIdFromRequest(req: Request, bodyDatasetId?: string): string {
  const raw = bodyDatasetId || new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

function isRoleplayTrainingCampaign(campaign: VoiceCampaign): boolean {
  return campaign.segmentId.startsWith("training-") || campaign.purposeId.startsWith("roleplay-");
}

const CreateSchema = z.object({
  datasetId: z.string().min(1).max(64).optional(),
  datasetLabel: z.string().min(1).max(200).optional(),
  companyName: z.string().min(1).max(200).optional(),
  entityName: z.string().min(1).max(80).optional(),
  campaignName: z.string().trim().min(1).max(200).optional(),
  segmentId: z.string().min(1).optional(),
  purposeId: z.string().min(1).optional(),
  purpose: z.object({
    purposeId: z.string().trim().min(1).max(120),
    sku: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(120),
    tagline: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(1200),
    valueProp: z.string().trim().min(1).max(500),
    priceDisplay: z.string().trim().min(1).max(240),
    cta: z.string().trim().min(1).max(300),
  }).optional(),
  systemPrompt: z.string().min(1).optional(),
  firstMessage: z.string().optional(),
  scriptReasoning: z.string().default(""),
  editableScript: z.string().max(VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS).optional(),
  personaPrompt: z.string().max(8_000).optional(),
  voice: z.string().min(1).optional(),
  voiceName: z.string().trim().min(1).optional(),
  callProvider: z.enum(["plivo-gemini", "mulberry-pipecat"]).optional(),
  language: z.string().default("Hinglish"),
  languageExplicit: z.boolean().optional(),
  phoneNumbers: z.array(z.string().min(1)).max(500).default([]),
  successDefinition: VoiceCampaignSuccessDefinitionSchema.optional(),
  experimentSplit: VoiceCampaignExperimentSplitSchema.optional(),
  launch: z.boolean().default(true),
  draftOnly: z.boolean().default(false),
  workflow: z.object({
    templateId: z.string().optional(),
    templateTitle: z.string().optional(),
    nodes: z.array(z.unknown()).optional(),
    edges: z.array(z.unknown()).optional(),
    universalRoutes: z.array(z.unknown()).optional(),
  }).optional(),
});

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const datasetId = datasetIdFromRequest(req);
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });
  return Response.json(
    {
      campaigns: listCampaigns({ userId, datasetId })
        .filter((campaign) => !isRoleplayTrainingCampaign(campaign))
        .map(enrichCampaignWithSuccessSignals),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const {
    datasetLabel,
    companyName,
    entityName,
    campaignName,
    segmentId,
    purposeId,
    systemPrompt,
    firstMessage,
    scriptReasoning,
    editableScript,
    personaPrompt,
    voice,
    voiceName,
    callProvider: rawCallProvider,
    language,
    phoneNumbers,
    launch,
    draftOnly,
    workflow,
  } = parsed.data;
  const datasetId = datasetIdFromRequest(req, parsed.data.datasetId);
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const id = `vc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const callProvider = activeVoiceCallProvider(rawCallProvider);
  const resolvedVoice = voice ?? DEFAULT_GEMINI_VOICE;
  const resolvedLanguage = language || "Hinglish";
  const resolvedPhoneNumbers = phoneNumbers ?? [];

  let canonicalVoice: string;
  try {
    canonicalVoice = canonicalizeCampaignVoice(resolvedVoice, callProvider);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  if (draftOnly) {
    const name = campaignName?.trim() || "Untitled campaign";
    const campaign: VoiceCampaign = {
      id,
      userId,
      name,
      datasetId,
      datasetLabel: datasetLabel || dataset.label,
      companyName: companyName || dataset.companyName,
      entityName: entityName || dataset.entityName,
      segmentId: segmentId ?? "",
      segmentName: "",
      purposeId: purposeId ?? "",
      purposeName: "",
      systemPrompt: systemPrompt ?? "",
      // At create time the client compiled systemPrompt from these same
      // workflow nodes in the same tick, so it cannot lag the script the way
      // a later Script-tab autosave can — trust it when a workflow exists.
      ...(systemPrompt && (workflow as VoiceCampaign["workflow"])?.nodes?.length
        ? { systemPromptSource: "compiled" as const }
        : {}),
      firstMessage: firstMessage ?? "",
      scriptReasoning,
      editableScript,
      agentId: REALTIME_MODEL,
      voice: canonicalVoice,
      voiceName,
      callProvider,
      voiceProvider: "gemini-live",
      language: resolvedLanguage,
      languageExplicit: parsed.data.languageExplicit ?? true,
      workflow: workflow as VoiceCampaign["workflow"],
      phoneNumbers: resolvedPhoneNumbers,
      status: "draft",
      calls: [],
      createdAt: new Date().toISOString(),
      successDefinition: successDefinitionWithExperimentBaseline(parsed.data.successDefinition, parsed.data.experimentSplit),
      experimentSplit: normalizeVoiceCampaignExperimentSplit(parsed.data.experimentSplit),
    };
    saveCampaign(campaign);
    return Response.json(
      { id, name, agentId: REALTIME_MODEL, callProvider, campaign },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!segmentId || !purposeId || !systemPrompt || !voice) {
    return Response.json(
      { error: "segmentId, purposeId, systemPrompt, and voice are required unless draftOnly is true" },
      { status: 400 },
    );
  }

  const segment = listSegments(userId, datasetId).find((item) => item.id === segmentId);
  // Allow missing segment/purpose when systemPrompt is provided directly (minimal test campaigns)
  if (!segment && !systemPrompt) return Response.json({ error: "Segment not found" }, { status: 404 });

  const inlinePurpose = parsed.data.purpose?.purposeId === purposeId ? parsed.data.purpose as Purpose : undefined;
  const purpose = getPurpose(purposeId, datasetId, userId) ?? inlinePurpose;
  if (!purpose && !systemPrompt) return Response.json({ error: "Purpose not found" }, { status: 404 });

  const name = campaignName?.trim() || (purpose && segment ? `${purpose.name} · ${segment.name}` : campaignName || "Draft");
  const launchRoute = "/api/voice-campaigns";

  if (launch && resolvedPhoneNumbers.length === 0) {
    return Response.json({ error: "At least one phone number is required to launch" }, { status: 400 });
  }

  const campaign: VoiceCampaign = {
    id,
    userId,
    name,
    datasetId,
    datasetLabel: datasetLabel || dataset.label,
    companyName: companyName || dataset.companyName,
    entityName: entityName || dataset.entityName,
    segmentId,
    segmentName: segment?.name ?? segmentId,
    purposeId,
    purposeName: purpose?.name ?? purposeId,
    systemPrompt,
    firstMessage: firstMessage ?? "",
    scriptReasoning,
    editableScript,
    personaPrompt,
    agentId: REALTIME_MODEL,
    voice: canonicalVoice,
    voiceName,
    callProvider,
    voiceProvider: "gemini-live",
    language: resolvedLanguage,
    languageExplicit: parsed.data.languageExplicit ?? true,
    workflow: workflow as VoiceCampaign["workflow"],
    phoneNumbers: resolvedPhoneNumbers,
    status: launch ? "launching" : "draft",
    calls: [],
    createdAt: new Date().toISOString(),
    successDefinition: successDefinitionWithExperimentBaseline(parsed.data.successDefinition, parsed.data.experimentSplit),
    experimentSplit: normalizeVoiceCampaignExperimentSplit(parsed.data.experimentSplit),
  };

  if (!launch) {
    saveCampaign(campaign);
    return Response.json(
      { id, name, agentId: REALTIME_MODEL, callProvider, campaign },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    ensureCampaignCallConfig(callProvider);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  saveCampaign(campaign);

  let plannedCalls;
  try {
    plannedCalls = await buildPlannedVoiceCallsWithCustomerContext({
      campaign,
      phoneNumbers: resolvedPhoneNumbers,
      segmentSql: segment?.sql ?? "",
      callConfigIdForIndex: (index) => `${id}_${index}_${Math.random().toString(36).slice(2, 8)}`,
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

  // Fire calls sequentially (rate-limit friendly); don't await all to avoid request timeout.
  void startPlannedVoiceCalls(campaign, plannedCalls, { route: launchRoute, callTags: ["test call"] });

  return Response.json(
    { id, name, agentId: REALTIME_MODEL, callProvider },
    { headers: { "Cache-Control": "no-store" } },
  );
}
