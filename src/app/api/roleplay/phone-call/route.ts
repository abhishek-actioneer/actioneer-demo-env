import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import {
  coachOpeningRoadmap,
  composeActorPrompt,
  composeCoachPrompt,
  type RoleplayScenario,
} from "@/features/roleplay/roleplay-scenario";
import { buildInstructorDeliveryRules, type VoiceGender } from "@/features/roleplay/roleplay-call-script";
import { getCampaign, saveCampaign } from "@/lib/voice-campaign-store";
import { seedPlannedVoiceCalls, startPlannedVoiceCalls } from "@/lib/voice-campaign-runner";
import { normalizeAgentGenderedPhrases } from "@/lib/voice-campaign-flow";
import { geminiVoiceDisplayName, geminiVoiceGender } from "@/lib/gemini-voices";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";

export const runtime = "nodejs";
export const maxDuration = 60;

type TrainingCallMode = "learn" | "practice" | "assessment" | "certification";

const DEFAULT_VOICE = "Sulafat";

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  return digits ? `+${digits}` : raw.trim();
}

function cleanId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "scenario";
}

function normalizeMode(value: unknown): TrainingCallMode {
  if (value === "learn") return "learn";
  if (value === "practice") return "practice";
  if (value === "certification") return "certification";
  return "assessment";
}

function ensureInstructorDeliveryRules(
  systemPrompt: string,
  gender: VoiceGender,
  openingRoadmap?: string,
): string {
  if (systemPrompt.includes("HOW TO RUN THIS TRAINING CALL")) return systemPrompt;
  return `${buildInstructorDeliveryRules(gender, openingRoadmap ? { openingRoadmap } : undefined)}\n\n${systemPrompt}`;
}

function buildTrainingCampaign(params: {
  userId: string;
  datasetId: string;
  scenario: RoleplayScenario;
  mode: TrainingCallMode;
  phone: string;
  systemPrompt: string;
  firstMessage: string;
  voice: string;
}): VoiceCampaign {
  const now = new Date().toISOString();
  const role = params.scenario.roleModule.role;
  const campaignId = `training-${cleanId(params.scenario.id)}-${randomUUID().slice(0, 8)}`;
  const modeLabel = params.mode === "learn" ? "Coach" : params.mode === "practice" ? "Practice" : "Assessment";

  return {
    id: campaignId,
    userId: params.userId,
    datasetId: params.datasetId,
    datasetLabel: "Life Insurance",
    companyName: "ABSLI",
    entityName: "trainees",
    name: `${params.scenario.spine.productLabel} ${role} ${modeLabel}`,
    segmentId: `training-${role.toLowerCase()}`,
    segmentName: `${role} trainees`,
    purposeId: `roleplay-${params.mode}`,
    purposeName: `${role} ${modeLabel} training`,
    systemPrompt: params.systemPrompt,
    firstMessage: params.firstMessage,
    scriptReasoning: "Phone-based roleplay training call generated from an approved scenario pack.",
    editableScript: params.systemPrompt,
    agentId: "gemini-live-training",
    voice: params.voice,
    voiceName: geminiVoiceDisplayName(params.voice),
    callProvider: "plivo-gemini",
    voiceProvider: "gemini-live",
    language: params.scenario.persona.language || "Hinglish",
    languageExplicit: true,
    phoneNumbers: [params.phone],
    status: "in_progress",
    calls: [],
    createdAt: now,
    launchedAt: now,
    audienceLaunchedAt: now,
  };
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return Response.json({ error: "Roleplay training is not available for this dataset" }, { status: 403 });
  }

  let body: {
    scenario?: RoleplayScenario;
    phoneNumber?: unknown;
    mode?: unknown;
    voice?: unknown;
    systemPrompt?: unknown;
    firstMessage?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const scenario = body.scenario;
  if (!scenario?.spine || !scenario.roleModule || !scenario.persona) {
    return Response.json({ error: "Missing or malformed scenario." }, { status: 400 });
  }

  const rawPhone = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  if (!rawPhone) return Response.json({ error: "phoneNumber is required" }, { status: 400 });

  const phone = normalizePhone(rawPhone);
  if (phone.replace(/\D/g, "").length < 10) {
    return Response.json({ error: "Enter a valid trainee phone number." }, { status: 400 });
  }

  const mode = normalizeMode(body.mode);
  const voice = typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : DEFAULT_VOICE;
  const voiceGender = geminiVoiceGender(voice);
  const openingRoadmap = mode === "learn"
    ? normalizeAgentGenderedPhrases(coachOpeningRoadmap(scenario), voiceGender)
    : undefined;
  const composed = mode === "learn" ? composeCoachPrompt(scenario) : composeActorPrompt(scenario);

  // A trainer-edited script from the Phone-calls tab overrides the composed
  // prompt; fall back to the composed prompt when the override is blank.
  const rawSystemPrompt = typeof body.systemPrompt === "string" && body.systemPrompt.trim()
    ? body.systemPrompt.trim()
    : composed.systemPrompt;
  const overrideSystemPrompt = mode === "learn"
    ? ensureInstructorDeliveryRules(rawSystemPrompt, voiceGender, openingRoadmap)
    : rawSystemPrompt;
  const rawFirstMessage = typeof body.firstMessage === "string" && body.firstMessage.trim()
    ? body.firstMessage.trim()
    : composed.firstMessage;
  // Match the opening line's first-person grammar to the selected voice's
  // gender (the script body is already gendered at generation time).
  const overrideFirstMessage = normalizeAgentGenderedPhrases(rawFirstMessage, voiceGender);

  const campaign = buildTrainingCampaign({
    userId,
    datasetId,
    scenario,
    mode,
    phone,
    systemPrompt: overrideSystemPrompt,
    firstMessage: overrideFirstMessage,
    voice,
  });
  const callConfigId = `training-call-${randomUUID().slice(0, 12)}`;

  try {
    saveCampaign(campaign);
    seedPlannedVoiceCalls(
      campaign,
      [{ num: phone, callConfigId }],
      { route: "/api/roleplay/phone-call", callTags: ["training", mode, scenario.roleModule.role] },
    );
    await startPlannedVoiceCalls(
      campaign,
      [{ num: phone, callConfigId }],
      { route: "/api/roleplay/phone-call", callTags: ["training", mode, scenario.roleModule.role] },
    );
  } catch (err) {
    console.error("[roleplay/phone-call] failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not start training call." },
      { status: 502 },
    );
  }

  const saved = getCampaign(campaign.id, { userId, datasetId });
  const call = saved?.calls.find((item) => item.callConfigId === callConfigId || item.id === callConfigId);
  if (call?.status === "failed") {
    return Response.json(
      {
        error: call.summary || "Could not start training call.",
        campaignId: campaign.id,
        callId: call.id,
        callConfigId,
        status: call.status,
      },
      { status: 502 },
    );
  }

  return Response.json({
    campaignId: campaign.id,
    callId: call?.id ?? callConfigId,
    callConfigId,
    providerRequestId: call?.providerRequestId,
    toNumber: phone,
    status: call?.status ?? "calling",
    mode,
  });
}
