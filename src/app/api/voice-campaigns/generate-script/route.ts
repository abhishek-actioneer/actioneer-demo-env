import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { generateText, parseJsonResponse } from "@/lib/llm";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { getDatasetForUser } from "@/lib/datasets";
import { listSegments } from "@/lib/server/segment-repo";
import { getPurpose } from "@/lib/purpose-store";
import type { Purpose } from "@/lib/purpose-types";
import { buildVoiceCampaignScriptPrompt } from "@/features/prompts/voice/campaign-script";
import {
  buildVoiceIntakePrompt,
  VOICE_INTAKE_SCHEMA,
  type VoiceIntakeResult,
} from "@/features/prompts/voice/intake";
import { getVoiceArchetype, listVoiceArchetypes } from "@/lib/voice-archetypes";
import { applyFactLedgerToWorkflow } from "@/lib/voice-fact-ledger";
import { VoiceCampaignExperimentSplitSchema } from "@/lib/server/voice-campaign-experiment-schema";
import { VoiceCampaignSuccessDefinitionSchema } from "@/lib/server/voice-campaign-success-schema";
import {
  normalizeVoiceCampaignExperimentSplit,
  successDefinitionWithExperimentBaseline,
} from "@/lib/voice-campaign-experiment";
import type {
  GeneratedVoiceWorkflow,
  GeneratedVoiceWorkflowNode,
  ScriptPromptResult,
} from "@/features/prompts/voice/campaign-script";

const Schema = z.object({
  datasetId: z.string().min(1).max(64).optional(),
  segmentId: z.string().min(1),
  purposeId: z.string().min(1),
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
  language: z.string().default("Hinglish"),
  brief: z.string().trim().min(12).max(2000),
  agentName: z.string().trim().min(1).max(80).optional(),
  voiceGender: z.enum(["female", "male", "unknown"]).optional(),
  successDefinition: VoiceCampaignSuccessDefinitionSchema.optional(),
  experimentSplit: VoiceCampaignExperimentSplitSchema.optional(),
});

const NODE_KINDS = new Set<GeneratedVoiceWorkflowNode["kind"]>([
  "start",
  "prompt",
  "question",
  "condition",
  "action",
  "transfer",
  "end",
]);

function cleanText(value: unknown, fallback: string, maxLength = 900): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return fallback;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function cleanId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value : fallback;
  const id = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return id || fallback;
}

function campaignBriefWithMeasurementContext({
  brief,
  successDefinition,
  experimentSplit,
}: {
  brief: string;
  successDefinition?: z.infer<typeof VoiceCampaignSuccessDefinitionSchema>;
  experimentSplit?: z.infer<typeof VoiceCampaignExperimentSplitSchema>;
}): string {
  const split = normalizeVoiceCampaignExperimentSplit(experimentSplit, { defaultEnabled: true });
  const success = successDefinitionWithExperimentBaseline(successDefinition, split);
  const splitLine = split.enabled
    ? `${split.testPercent}% test arm receives this campaign; ${split.controlPercent}% control holdout does not receive calls. Randomize by ${split.randomizationUnit}.`
    : "No control holdout; full selected audience receives the campaign.";
  const successLine = `Primary success: ${success.primary.label} (${success.primary.type}${success.primary.outcome ? `:${success.primary.outcome}` : ""}) within ${success.attributionWindowDays} days. Baseline: ${success.baseline.label ?? success.baseline.source}.`;

  return `${brief.trim()}

Experiment design:
- ${splitLine}
- This script is for the test arm only; do not mention the experiment, holdout, control group, or split to the customer.
- Make the call path measurable against the holdout. Avoid vague closes that cannot be attributed.
- ${successLine}`;
}

/** Pass 0 intake — failure-tolerant: any error means "no archetype", never a failed request. */
async function runIntake(input: {
  brief: string;
  datasetLabel?: string;
  segmentName?: string;
}): Promise<VoiceIntakeResult | null> {
  try {
    const { system, user } = buildVoiceIntakePrompt({
      brief: input.brief,
      datasetLabel: input.datasetLabel,
      segmentName: input.segmentName,
      archetypeCatalog: listVoiceArchetypes().map((archetype) => ({
        id: archetype.id,
        label: archetype.label,
        sector: archetype.sector,
        description: archetype.description,
      })),
    });
    const raw = await generateText({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      jsonSchema: VOICE_INTAKE_SCHEMA,
      feature: "voice-campaigns.intake",
      label: "voice campaign intake",
      timeoutMs: 60_000,
    });
    return parseJsonResponse<VoiceIntakeResult>(raw);
  } catch {
    return null;
  }
}

function sanitizeWorkflow(value: unknown, brief: string, segmentName: string): GeneratedVoiceWorkflow {
  const source = typeof value === "object" && value !== null
    ? value as Partial<GeneratedVoiceWorkflow>
    : {};
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const seen = new Set<string>();
  const nodes = rawNodes
    .slice(0, 8)
    .map((raw, index): GeneratedVoiceWorkflowNode => {
      const candidate = typeof raw === "object" && raw !== null
        ? raw as Partial<GeneratedVoiceWorkflowNode>
        : {};
      const fallbackId = index === 0 ? "start" : `step-${index + 1}`;
      let id = cleanId(candidate.id, fallbackId);
      if (seen.has(id)) id = `${id}-${index + 1}`;
      seen.add(id);

      const requestedKind = candidate.kind;
      const kind = requestedKind && NODE_KINDS.has(requestedKind) ? requestedKind : "prompt";
      return {
        id,
        kind,
        title: cleanText(candidate.title, `Step ${index + 1}`, 80),
        body: cleanText(candidate.body, "Handle this part of the call naturally.", 800),
        helper: candidate.helper ? cleanText(candidate.helper, "", 160) : null,
      };
    });

  let hasStart = false;
  for (const node of nodes) {
    if (node.kind !== "start") continue;
    if (hasStart) node.kind = "prompt";
    hasStart = true;
  }

  if (!nodes.some((node) => node.kind === "start")) {
    nodes.unshift({
      id: "start",
      kind: "start",
      title: "Call Connect",
      body: "Use only the configured opening line, then wait for permission before explaining the call purpose.",
      helper: null,
    });
  }
  if (!nodes.some((node) => node.kind === "end")) {
    nodes.push({
      id: "end",
      kind: "end",
      title: "Close Call",
      body: "Thank them and close politely without pressure.",
      helper: null,
    });
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawEdges = Array.isArray(source.edges) ? source.edges : [];
  const edges = rawEdges
    .map((raw) => {
      const candidate = typeof raw === "object" && raw !== null
        ? raw as { source?: unknown; target?: unknown; label?: unknown }
        : {};
      const sourceId = typeof candidate.source === "string" ? cleanId(candidate.source, "") : "";
      const targetId = typeof candidate.target === "string" ? cleanId(candidate.target, "") : "";
      if (!sourceId || !targetId || !nodeIds.has(sourceId) || !nodeIds.has(targetId) || sourceId === targetId) return null;
      return {
        source: sourceId,
        target: targetId,
        label: typeof candidate.label === "string" && candidate.label.trim()
          ? cleanText(candidate.label, "", 80)
          : null,
      };
    })
    .filter((edge): edge is GeneratedVoiceWorkflow["edges"][number] => Boolean(edge));

  if (edges.length === 0) {
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edges.push({ source: nodes[index].id, target: nodes[index + 1].id, label: null });
    }
  }

  return {
    title: cleanText(source.title, "Generated Campaign Workflow", 80),
    description: cleanText(source.description, "Generated from the campaign brief.", 180),
    objective: cleanText(source.objective, brief, 500),
    audienceHint: cleanText(source.audienceHint, segmentName, 220),
    nodes,
    edges,
  };
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const { segmentId, purposeId, language, brief, agentName, voiceGender } = parsed.data;
  const rawDatasetId = parsed.data.datasetId ||
    new URL(req.url).searchParams.get("datasetId") ||
    req.headers.get("x-dataset-id") ||
    DEFAULT_DATASET;
  const datasetId = /^[a-z0-9_-]+$/.test(rawDatasetId) && rawDatasetId.length <= 64
    ? rawDatasetId
    : DEFAULT_DATASET;
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const segment = listSegments(userId, datasetId).find((item) => item.id === segmentId);
  if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

  const inlinePurpose = parsed.data.purpose?.purposeId === purposeId ? parsed.data.purpose as Purpose : undefined;
  const purpose = getPurpose(purposeId, datasetId, userId) ?? inlinePurpose;
  if (!purpose) return Response.json({ error: "Purpose not found" }, { status: 404 });

  const measurementAwareBrief = campaignBriefWithMeasurementContext({
    brief,
    successDefinition: parsed.data.successDefinition,
    experimentSplit: parsed.data.experimentSplit,
  });

  const intake = await runIntake({
    brief,
    datasetLabel: dataset.label,
    segmentName: segment.name,
  });
  const archetype = intake?.archetypeId ? getVoiceArchetype(intake.archetypeId) : null;
  const knownFacts = (intake?.knownFacts ?? []).filter((fact) => typeof fact === "string" && fact.trim());

  const { system, user } = buildVoiceCampaignScriptPrompt(
    segment,
    purpose,
    language,
    {
      id: dataset.id,
      label: dataset.label,
      companyName: dataset.companyName,
      entityName: dataset.entityName,
      systemContext: dataset.systemContext,
      domainHints: dataset.domainHints,
      reportMeta: dataset.reportMeta,
    },
    measurementAwareBrief,
    agentName,
    voiceGender,
    { archetype: archetype ?? undefined, knownFacts },
  );

  const raw = await generateText({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    jsonSchema: {
      name: "voice_campaign_script",
      schema: {
        type: "object",
        properties: {
          campaignName: { type: "string" },
          systemPrompt: { type: "string" },
          firstMessage: { type: "string" },
          reasoning: { type: "string" },
          workflow: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              objective: { type: "string" },
              audienceHint: { type: "string" },
              nodes: {
                type: "array",
                minItems: 5,
                maxItems: 8,
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    kind: { type: "string", enum: ["start", "prompt", "question", "condition", "action", "transfer", "end"] },
                    title: { type: "string" },
                    body: { type: "string" },
                    helper: { type: ["string", "null"] },
                  },
                  required: ["id", "kind", "title", "body", "helper"],
                  additionalProperties: false,
                },
              },
              edges: {
                type: "array",
                minItems: 4,
                maxItems: 12,
                items: {
                  type: "object",
                  properties: {
                    source: { type: "string" },
                    target: { type: "string" },
                    label: { type: ["string", "null"] },
                  },
                  required: ["source", "target", "label"],
                  additionalProperties: false,
                },
              },
            },
            required: ["title", "description", "objective", "audienceHint", "nodes", "edges"],
            additionalProperties: false,
          },
        },
        required: ["campaignName", "systemPrompt", "firstMessage", "reasoning", "workflow"],
        additionalProperties: false,
      },
      strict: true,
    },
    feature: "voice-campaigns.generate-script",
    label: "voice campaign script generation",
    timeoutMs: 120_000,
  });

  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let result: ScriptPromptResult;
  try {
    result = JSON.parse(clean) as ScriptPromptResult;
  } catch {
    return Response.json({ error: "Script generation produced invalid JSON" }, { status: 500 });
  }
  const workflow = sanitizeWorkflow(result.workflow, measurementAwareBrief, segment.name);
  for (const node of workflow.nodes) node.provenance = "generated";
  const ledger = applyFactLedgerToWorkflow(workflow, {
    brief: measurementAwareBrief,
    purposeText: JSON.stringify({
      name: purpose.name,
      category: purpose.category,
      tagline: purpose.tagline,
      description: purpose.description,
      valueProp: purpose.valueProp,
      priceDisplay: purpose.priceDisplay,
      cta: purpose.cta,
    }),
    archetypeSafeDefaults: archetype?.safeDefaultFacts,
    datasetColumns: [],
  });
  const rewrittenBodies = new Map(ledger.rewrittenNodes.map((node) => [node.id, node.body]));
  for (const node of workflow.nodes) {
    const rewritten = rewrittenBodies.get(node.id);
    if (rewritten !== undefined) node.body = rewritten;
  }

  // Generated drafts inherit the archetype's default universal routes —
  // platform wording, replaced word-for-word whenever a client doc later
  // supplies its own approved lines via import route-binding.
  const workflowWithRoutes = archetype
    ? { ...workflow, universalRoutes: archetype.defaultUniversalRoutes }
    : workflow;

  return Response.json({
    ...result,
    campaignName: cleanText(result.campaignName, `${segment.name} campaign`, 80),
    firstMessage: cleanText(result.firstMessage, "Namaste, calling from the team. Ek minute baat ho payegi?", 180),
    reasoning: cleanText(result.reasoning, "Generated from the selected audience, purpose, and brief.", 500),
    workflow: workflowWithRoutes,
    diagnostics: ledger.diagnostics,
    archetypeId: intake?.archetypeId ?? null,
  });
}
