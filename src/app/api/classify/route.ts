import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { getMetricSummariesForDataset } from "@/lib/metric-store-server";
import { buildClassifyPrompt } from "@/lib/prompts/classify";
import { getDataset, getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { z } from "zod/v4";
import { isVoiceAgentGenerationRequest } from "@/lib/voice-agent-generation-types";

const ClassifySchema = z.object({
  query: z.string().min(1).max(8000),
  metricEntityContext: z.string().max(2000).optional(),
  playbookEntityContext: z.string().max(4000).optional(),
  segmentEntityContext: z.string().max(2000).optional(),
});

function buildMetricList(datasetId?: string): string {
  const summaries = getMetricSummariesForDataset(datasetId || DEFAULT_DATASET);
  return summaries.map((m) => `${m.id} | ${m.name}`).join("\n");
}

function isDataLookupRequest(query: string): boolean {
  const normalized = query.toLowerCase().trim();
  const startsWithLookup =
    /^(find|show|list|which|who|count|analyze|compare|break down|breakdown)\b/.test(normalized) ||
    /^how many\b/.test(normalized) ||
    /^what (are|is|were|was)\b/.test(normalized);
  if (!startsWithLookup) return false;
  const hasDataSubject = /\b(users?|customers?|investors?|members?|cohorts?|segments?|accounts?|events?|transactions?|orders?|bookings?|records?|revenue|conversion|retention|churn)\b/.test(normalized);
  return hasDataSubject;
}

export async function POST(req: Request) {
  const parsed = ClassifySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { query, metricEntityContext, playbookEntityContext, segmentEntityContext } = parsed.data;
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
  const datasetId = req.headers.get("x-dataset-id") ?? undefined;
  const resolvedDatasetId = datasetId || DEFAULT_DATASET;
  if (!getDatasetForUser(resolvedDatasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const metricList = buildMetricList(datasetId);
  const ds = getDataset(datasetId || DEFAULT_DATASET);
  const systemPrompt = buildClassifyPrompt(metricList, ds.suggestedPrompts, metricEntityContext, playbookEntityContext, segmentEntityContext);

  if (isVoiceAgentGenerationRequest(query)) {
    return Response.json({
      mode: "voice_agent_generation",
      complexity: "simple",
      complexityReason: null,
      metricId: null,
      actionType: null,
      extractedDescription: query,
      metricName: null,
      campaignChannel: null,
      campaignTargetDescription: null,
      voiceAgentTargetDescription: null,
    });
  }

  if (isDataLookupRequest(query)) {
    return Response.json({
      mode: "analytics",
      complexity: "simple",
      complexityReason: null,
      metricId: null,
      actionType: null,
      extractedDescription: null,
      metricName: null,
      campaignChannel: null,
      campaignTargetDescription: null,
      voiceAgentTargetDescription: null,
    });
  }

  try {
    const text = await generateText(query, { modelId, systemPrompt, jsonMode: true });
    const cleaned = text.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
    const result = JSON.parse(cleaned);
    const mode = result.mode === "playbook_modify" ? "playbook_modify" : result.mode === "metric_create" ? "metric_create" : result.mode === "metric_update" ? "metric_update" : result.mode === "action" ? "action" : result.mode === "analytics" ? "analytics" : result.mode === "policy_create" ? "policy_create" : result.mode === "campaign_create" ? "campaign_create" : result.mode === "voice_agent_generation" ? "voice_agent_generation" : "direct";
    const metricId = typeof result.metricId === "string" ? result.metricId : null;
    const actionType = mode === "action" && typeof result.actionType === "string" ? result.actionType : null;
    const extractedDescription = (mode === "action" || mode === "metric_create" || mode === "policy_create" || mode === "campaign_create" || mode === "voice_agent_generation") && typeof result.extractedDescription === "string" ? result.extractedDescription : null;
    const metricName = mode === "metric_create" && typeof result.metricName === "string" ? result.metricName : null;
    const rawCampaignChannel = typeof result.campaignChannel === "string" ? result.campaignChannel : null;
    const campaignChannel = mode === "campaign_create" && ["email", "push", "sms", "webpush", "whatsapp", "voice"].includes(rawCampaignChannel ?? "")
      ? rawCampaignChannel
      : null;
    const campaignTargetDescription = mode === "campaign_create" && typeof result.campaignTargetDescription === "string" && result.campaignTargetDescription.trim()
      ? result.campaignTargetDescription.trim().slice(0, 1000)
      : null;
    const voiceAgentTargetDescription = mode === "voice_agent_generation" && typeof result.voiceAgentTargetDescription === "string" && result.voiceAgentTargetDescription.trim()
      ? result.voiceAgentTargetDescription.trim().slice(0, 1000)
      : null;
    // Complexity is only meaningful for analytics — coerce to "simple" for other modes
    const rawComplexity = result.complexity === "complex" ? "complex" : "simple";
    const complexity = mode === "analytics" ? rawComplexity : "simple";
    const complexityReason = complexity === "complex" && typeof result.complexityReason === "string" && result.complexityReason.trim().length > 0
      ? result.complexityReason.trim().slice(0, 120)
      : null;
    return Response.json({ mode, complexity, complexityReason, metricId, actionType, extractedDescription, metricName, campaignChannel, campaignTargetDescription, voiceAgentTargetDescription });
  } catch (err) {
    console.error("[classify] failed:", err instanceof Error ? err.message : err);
    return Response.json(
      { error: "classification failed" },
      { status: 500 }
    );
  }
}
