import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
// Only import what GET needs at module level — everything else is lazy-loaded inside PATCH/DELETE
// to avoid initialising DuckDB/SQLite/dataset modules on the first GET request.
import { deleteCampaign, getCampaign, saveCampaign, updateCampaign } from "@/lib/voice-campaign-store";
import { enrichCampaignWithSuccessSignals } from "@/lib/voice-campaign-success-signals";
import { DEFAULT_DATASET } from "@/lib/datasets/constants"; // lightweight, no DuckDB
import { VoiceCampaignExperimentSplitSchema } from "@/lib/server/voice-campaign-experiment-schema";
import { VoiceCampaignSuccessDefinitionSchema } from "@/lib/server/voice-campaign-success-schema";
import { VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS } from "@/lib/voice-campaign-studio-utils";
import type { Purpose } from "@/lib/purpose-types";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";
import type { VoiceFlowEdge, VoiceFlowNode } from "@/lib/voice-campaign-flow";

/**
 * When a save updates editableScript without a fresh systemPrompt, the stored
 * systemPrompt goes stale — the historical bug that forced the runtime to
 * distrust systemPrompt entirely (see buildCampaignRuntimePrompt). Recompile
 * from the merged campaign's workflow so systemPrompt stays coherent and can
 * be marked systemPromptSource:"compiled". Mirrors the compile-call shape of
 * buildPatchBody in use-campaign-actions.ts. Customer-agnostic on purpose:
 * placeholders like {{Customer Name}} stay unfilled here and are resolved at
 * dial time — never bake a sampled customer into the persisted prompt.
 * Returns undefined when the campaign has no workflow nodes (legacy
 * script-only campaigns keep their existing systemPrompt untouched).
 */
async function recompileSystemPromptFromWorkflow(
  merged: VoiceCampaign,
  editableScript: string,
): Promise<{ systemPrompt: string; systemPromptSource: "compiled" } | undefined> {
  const nodes = (merged.workflow?.nodes ?? []) as VoiceFlowNode[];
  if (nodes.length === 0) return undefined;
  const { compileVoiceCampaignScript, VOICE_CAMPAIGN_TEMPLATES } = await import("@/lib/voice-campaign-flow");
  const template =
    VOICE_CAMPAIGN_TEMPLATES.find((t) => t.id === merged.workflow?.templateId) ??
    VOICE_CAMPAIGN_TEMPLATES.find((t) => t.id === "blank")!;
  const compiled = compileVoiceCampaignScript({
    template,
    campaignName: merged.name,
    firstMessage: merged.firstMessage,
    nodes,
    edges: (merged.workflow?.edges ?? []) as VoiceFlowEdge[],
    dataset: {
      datasetId: merged.datasetId,
      label: merged.datasetLabel,
      companyName: merged.companyName,
      entityName: merged.entityName,
    },
    language: merged.language,
    voice: merged.voice,
    voiceName: merged.voiceName,
    agentName: merged.voiceName,
    companyName: merged.companyName,
    personaPrompt: merged.personaPrompt,
    guardrails: merged.successDefinition?.guardrails ?? [],
    operatorScript: editableScript,
    universalRoutes: merged.workflow?.universalRoutes,
  });
  return { systemPrompt: compiled.systemPrompt, systemPromptSource: "compiled" };
}

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";

const PurposeSchema = z.object({
  purposeId: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(120),
  tagline: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1200),
  valueProp: z.string().trim().min(1).max(500),
  priceDisplay: z.string().trim().min(1).max(240),
  cta: z.string().trim().min(1).max(300),
});

const WorkflowSchema = z.object({
  templateId: z.string().optional(),
  templateTitle: z.string().optional(),
  nodes: z.array(z.unknown()).optional(),
  edges: z.array(z.unknown()).optional(),
  universalRoutes: z.array(z.unknown()).optional(),
});

const PatchSchema = z.object({
  datasetId: z.string().min(1).max(64).optional(),
  datasetLabel: z.string().min(1).max(200).optional(),
  companyName: z.string().min(1).max(200).optional(),
  entityName: z.string().min(1).max(80).optional(),
  campaignName: z.string().trim().min(1).max(200).optional(),
  segmentId: z.string().min(1).optional(),
  purposeId: z.string().min(1).optional(),
  purpose: PurposeSchema.optional(),
  systemPrompt: z.string().min(1).optional(),
  firstMessage: z.string().optional(),
  scriptReasoning: z.string().optional(),
  editableScript: z.string().max(VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS).optional(),
  personaPrompt: z.string().max(8_000).optional(),
  voice: z.string().min(1).optional(),
  voiceName: z.string().trim().min(1).optional(),
  callProvider: z.enum(["plivo-gemini", "mulberry-pipecat"]).optional(),
  language: z.string().min(1).optional(),
  languageExplicit: z.boolean().optional(),
  phoneNumbers: z.array(z.string().min(1)).max(500).optional(),
  workflow: WorkflowSchema.optional(),
  successDefinition: VoiceCampaignSuccessDefinitionSchema.optional(),
  experimentSplit: VoiceCampaignExperimentSplitSchema.optional(),
});

function datasetIdFromRequest(req: Request, bodyDatasetId?: string): string {
  const raw = bodyDatasetId || new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaign = getCampaign(id, { userId });
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json(enrichCampaignWithSuccessSignals(campaign), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Lazy imports — kept out of module scope so GET doesn't trigger these on cold start
  const [
    { getDatasetForUser },
    { getPurpose },
    { listSegments },
    { activeVoiceCallProvider },
    { normalizeVoiceCampaignExperimentSplit, successDefinitionWithExperimentBaseline },
    { canonicalizeCampaignVoice },
  ] = await Promise.all([
    import("@/lib/datasets"),
    import("@/lib/purpose-store"),
    import("@/lib/server/segment-repo"),
    import("@/lib/voice-call-provider"),
    import("@/lib/voice-campaign-experiment"),
    import("@/lib/voice-campaign-voice-validation"),
  ]);

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const { id } = await params;
  const patch = parsed.data;
  const requestedDatasetId = datasetIdFromRequest(req, patch.datasetId);
  const existing = getCampaign(id, { userId });

  if (existing) {
    const updateScope = existing.datasetId
      ? { userId, datasetId: existing.datasetId }
      : { userId };
    const nextCallProvider = activeVoiceCallProvider(patch.callProvider ?? existing.callProvider);
    const shouldValidateVoice = patch.voice !== undefined || patch.callProvider !== undefined;
    let normalizedVoice: string | undefined;
    if (shouldValidateVoice) {
      try {
        normalizedVoice = canonicalizeCampaignVoice(
          patch.voice ?? existing.voice,
          nextCallProvider,
        );
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 400 });
      }
    }

    const campaignPatch: Partial<Omit<VoiceCampaign, "id" | "userId" | "datasetId" | "createdAt">> = {
      ...(patch.datasetLabel !== undefined ? { datasetLabel: patch.datasetLabel } : {}),
      ...(patch.companyName !== undefined ? { companyName: patch.companyName } : {}),
      ...(patch.entityName !== undefined ? { entityName: patch.entityName } : {}),
      ...(patch.campaignName !== undefined ? { name: patch.campaignName } : {}),
      ...(patch.segmentId !== undefined ? { segmentId: patch.segmentId } : {}),
      ...(patch.purposeId !== undefined ? { purposeId: patch.purposeId } : {}),
      ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
      ...(patch.firstMessage !== undefined ? { firstMessage: patch.firstMessage } : {}),
      ...(patch.scriptReasoning !== undefined ? { scriptReasoning: patch.scriptReasoning } : {}),
      ...(patch.editableScript !== undefined ? { editableScript: patch.editableScript } : {}),
      ...(patch.personaPrompt !== undefined ? { personaPrompt: patch.personaPrompt } : {}),
      ...(normalizedVoice !== undefined
        ? { voice: normalizedVoice }
        : patch.voice !== undefined
          ? { voice: patch.voice }
          : {}),
      ...(patch.voiceName !== undefined ? { voiceName: patch.voiceName } : {}),
      ...(patch.callProvider !== undefined ? { callProvider: nextCallProvider } : {}),
      ...(patch.language !== undefined ? { language: patch.language } : {}),
      ...(patch.languageExplicit !== undefined ? { languageExplicit: patch.languageExplicit } : {}),
      ...(patch.phoneNumbers !== undefined ? { phoneNumbers: patch.phoneNumbers } : {}),
      ...(patch.workflow !== undefined ? { workflow: patch.workflow as VoiceCampaign["workflow"] } : {}),
      ...(patch.successDefinition !== undefined
        ? { successDefinition: successDefinitionWithExperimentBaseline(patch.successDefinition, patch.experimentSplit ?? existing.experimentSplit) }
        : {}),
      ...(patch.experimentSplit !== undefined
        ? { experimentSplit: normalizeVoiceCampaignExperimentSplit(patch.experimentSplit) }
        : {}),
    };

    // Prompt-source contract (see buildCampaignRuntimePrompt):
    // - A save that carries a fresh workflow (Save/Launch via buildPatchBody)
    //   is recompiled server-side from that workflow + script and marked
    //   "compiled" — the runtime may trust systemPrompt directly.
    // - A save that touches only editableScript/systemPrompt (the Script-tab
    //   autosave) is DOWNGRADED to "legacy": the stored workflow may lag the
    //   script the operator just wrote, and recompiling from stale nodes would
    //   freeze the old wording into a prompt the runtime trusts. Legacy makes
    //   the runtime compile from editableScript at call time — the proven path.
    const promptTouched =
      patch.editableScript !== undefined ||
      patch.systemPrompt !== undefined ||
      patch.workflow !== undefined;
    if (promptTouched) {
      const merged: VoiceCampaign = { ...existing, ...campaignPatch };
      const mergedScript = patch.editableScript ?? existing.editableScript ?? "";
      const workflowFresh =
        patch.workflow !== undefined && ((merged.workflow?.nodes?.length ?? 0) > 0);
      const recompiled = workflowFresh
        ? await recompileSystemPromptFromWorkflow(merged, mergedScript)
        : undefined;
      if (recompiled) {
        campaignPatch.systemPrompt = recompiled.systemPrompt;
        campaignPatch.systemPromptSource = recompiled.systemPromptSource;
      } else {
        campaignPatch.systemPromptSource = "legacy";
      }
    }

    const updated = updateCampaign(id, campaignPatch, updateScope);
    if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(updated, { headers: { "Cache-Control": "no-store" } });
  }

  const datasetId = requestedDatasetId;
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });
  if (
    !patch.segmentId ||
    !patch.purposeId ||
    !patch.systemPrompt ||
    !patch.firstMessage ||
    !patch.voice ||
    !patch.language ||
    !patch.phoneNumbers?.length
  ) {
    return Response.json({ error: "Campaign not found and patch did not include enough fields to recreate it" }, { status: 400 });
  }

  const segment = listSegments(userId, datasetId).find((item) => item.id === patch.segmentId);
  if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

  const inlinePurpose = patch.purpose?.purposeId === patch.purposeId ? patch.purpose as Purpose : undefined;
  const purpose = getPurpose(patch.purposeId, datasetId, userId) ?? inlinePurpose;
  if (!purpose) return Response.json({ error: "Purpose not found" }, { status: 404 });
  const recreatedCallProvider = activeVoiceCallProvider(patch.callProvider);
  let recreatedVoice: string;
  try {
    recreatedVoice = canonicalizeCampaignVoice(patch.voice, recreatedCallProvider);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  const campaign: VoiceCampaign = {
    id,
    userId,
    name: patch.campaignName?.trim() || `${purpose.name} · ${segment.name}`,
    datasetId,
    datasetLabel: patch.datasetLabel || dataset.label,
    companyName: patch.companyName || dataset.companyName,
    entityName: patch.entityName || dataset.entityName,
    segmentId: patch.segmentId,
    segmentName: segment.name,
    purposeId: patch.purposeId,
    purposeName: purpose.name,
    systemPrompt: patch.systemPrompt,
    firstMessage: patch.firstMessage,
    scriptReasoning: patch.scriptReasoning ?? "",
    editableScript: patch.editableScript,
    personaPrompt: patch.personaPrompt,
    agentId: REALTIME_MODEL,
    voice: recreatedVoice,
    voiceName: patch.voiceName,
    callProvider: recreatedCallProvider,
    voiceProvider: "gemini-live",
    language: patch.language,
    languageExplicit: patch.languageExplicit ?? true,
    workflow: patch.workflow as VoiceCampaign["workflow"],
    phoneNumbers: patch.phoneNumbers,
    status: "draft",
    calls: [],
    createdAt: new Date().toISOString(),
    successDefinition: successDefinitionWithExperimentBaseline(patch.successDefinition, patch.experimentSplit),
    experimentSplit: normalizeVoiceCampaignExperimentSplit(patch.experimentSplit),
  };

  // Recreate path: the client-sent systemPrompt may lag the editableScript it
  // arrived with. When the recreated campaign has workflow nodes, recompile
  // server-side so the persisted prompt is trustworthy and marked "compiled".
  // (POST /api/voice-campaigns is left alone deliberately: its callers always
  // send editableScript and systemPrompt from the same client-side compile, so
  // there is no divergence to fix there, and stamping "compiled" on a prompt
  // we did not compile would overclaim.)
  if (patch.editableScript !== undefined) {
    const recompiled = await recompileSystemPromptFromWorkflow(campaign, patch.editableScript);
    if (recompiled) {
      campaign.systemPrompt = recompiled.systemPrompt;
      campaign.systemPromptSource = recompiled.systemPromptSource;
    }
  }

  saveCampaign(campaign);
  return Response.json(campaign, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = getCampaign(id, { userId });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  const deleted = deleteCampaign(id, existing.datasetId
    ? { userId, datasetId: existing.datasetId }
    : { userId });
  if (!deleted) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ ok: true });
}
