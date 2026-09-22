import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";

import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { getDatasetForUser } from "@/lib/datasets";
import { generateText, parseJsonResponse } from "@/lib/llm";
import { getPurpose } from "@/lib/purpose-store";
import {
  buildCandidateVoiceCampaignScriptPrompt,
  DEFAULT_CANDIDATE_GENERATOR_PROMPT,
  type PromptBenchCustomerContext,
} from "@/features/prompts/voice/campaign-bench";
import {
  buildVoiceCampaignScriptPrompt,
  type GeneratedVoiceWorkflow,
  type GeneratedVoiceWorkflowNode,
  type ScriptPromptResult,
} from "@/features/prompts/voice/campaign-script";
import { listSegments } from "@/lib/server/segment-repo";
import {
  getPromptBenchRun,
  savePromptBenchRun,
} from "@/lib/server/voice-campaign-prompt-bench-runs";
import type { Purpose } from "@/lib/purpose-types";
import type {
  PromptBenchRunPayload,
  PromptBenchVariantKey,
  PromptBenchVariantResult,
} from "@/lib/voice-campaign-prompt-bench-types";
import { VoiceCampaignExperimentSplitSchema } from "@/lib/server/voice-campaign-experiment-schema";
import { VoiceCampaignSuccessDefinitionSchema } from "@/lib/server/voice-campaign-success-schema";
import {
  normalizeVoiceCampaignExperimentSplit,
  successDefinitionWithExperimentBaseline,
} from "@/lib/voice-campaign-experiment";

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

const MAX_PROMPT_VARIANTS = 12;

const PromptVariantSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(100).max(30_000),
});

const PromptBenchSchema = z.object({
  datasetId: z.string().trim().min(1).max(64).optional(),
  segmentId: z.string().trim().min(1),
  purposeId: z.string().trim().min(1),
  purpose: PurposeSchema.optional(),
  language: z.string().trim().min(1).max(80).default("Hinglish"),
  brief: z.string().trim().min(12).max(2_000),
  agentName: z.string().trim().min(1).max(80).optional(),
  voiceGender: z.enum(["female", "male", "unknown"]).optional(),
  candidatePrompt: z.string().trim().min(100).max(30_000).optional(),
  promptVariants: z.array(PromptVariantSchema).max(MAX_PROMPT_VARIANTS).optional(),
  customerContext: z.object({
    name: z.string().trim().max(120).optional(),
    attributes: z.string().trim().max(2_000).optional(),
    lastEvent: z.string().trim().max(1_000).optional(),
  }).optional(),
  includeSimulations: z.boolean().optional(),
  simulationUtterances: z.array(z.string().trim().min(1).max(500)).max(8).optional(),
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

const VOICE_CAMPAIGN_SCRIPT_SCHEMA = {
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
};

const DEFAULT_SIMULATION_UTTERANCES = [
  "Why are you calling?",
  "I am busy right now.",
  "Not interested.",
  "Transfer me to a human.",
  "My KYC is stuck and I do not know what to do.",
];

function datasetIdFromRequest(req: Request, bodyDatasetId?: string): string {
  const raw = bodyDatasetId || new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

function cleanText(value: unknown, fallback: string, maxLength = 900): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return fallback;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function cleanLongText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/\n{4,}/g, "\n\n\n").trim() : "";
  return text || fallback;
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

function schemaSafeName(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return safe || "variant";
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
        body: cleanText(candidate.body, "Handle this part of the call naturally.", 900),
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

function editableScriptFromWorkflow(workflow: GeneratedVoiceWorkflow): string {
  const sections = [
    "Conversation script:",
    ...workflow.nodes.flatMap((node, index) => [
      "",
      `${index + 1}. ${node.title}`,
      node.body.trim() || "(Write what the agent should say or do at this step.)",
      node.helper ? `Note: ${node.helper}` : "",
    ]).filter((line) => line !== ""),
  ];

  const routeLines = workflow.edges.map((edge) => {
    const source = workflow.nodes.find((node) => node.id === edge.source)?.title ?? edge.source;
    const target = workflow.nodes.find((node) => node.id === edge.target)?.title ?? edge.target;
    const label = typeof edge.label === "string" && edge.label.trim() ? ` when ${edge.label}` : "";
    return `- ${source} -> ${target}${label}`;
  });

  if (routeLines.length > 0) {
    sections.push("", "Routing notes:", ...routeLines);
  }

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function runVariant({
  key,
  label,
  system,
  user,
  datasetId,
  segmentName,
  brief,
  renderedCandidatePrompt,
}: {
  key: PromptBenchVariantKey;
  label: string;
  system: string;
  user: string;
  datasetId: string;
  segmentName: string;
  brief: string;
  renderedCandidatePrompt?: string;
}): Promise<PromptBenchVariantResult> {
  try {
    const safeKey = schemaSafeName(key);
    const raw = await generateText({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      jsonSchema: {
        name: `voice_campaign_prompt_bench_${safeKey}`,
        schema: VOICE_CAMPAIGN_SCRIPT_SCHEMA,
        strict: true,
      },
      feature: `voice-campaigns.prompt-bench.${safeKey}`,
      label: `voice campaign prompt bench ${label}`,
      datasetId,
      timeoutMs: 120_000,
    });
    const result = parseJsonResponse<ScriptPromptResult>(raw);
    const workflow = sanitizeWorkflow(result.workflow, brief, segmentName);
    return {
      key,
      label,
      campaignName: cleanText(result.campaignName, `${segmentName} campaign`, 80),
      firstMessage: cleanText(result.firstMessage, "Namaste, calling from the team. Ek minute baat ho payegi?", 180),
      reasoning: cleanText(result.reasoning, "Generated from the selected audience, purpose, and brief.", 700),
      systemPrompt: cleanLongText(result.systemPrompt, "No system prompt returned."),
      workflow,
      editableScript: editableScriptFromWorkflow(workflow),
      promptMessages: { system, user, renderedCandidatePrompt },
    };
  } catch (err) {
    return {
      key,
      label,
      error: err instanceof Error ? err.message : "Prompt bench generation failed",
      promptMessages: { system, user, renderedCandidatePrompt },
    };
  }
}

async function simulateVariant({
  variant,
  utterance,
  datasetId,
}: {
  variant: PromptBenchVariantResult;
  utterance: string;
  datasetId: string;
}): Promise<{ variantKey: PromptBenchVariantKey; label: string; response: string; error?: string }> {
  if (!variant.systemPrompt) {
    return { variantKey: variant.key, label: variant.label, response: "", error: variant.error || "No system prompt available" };
  }
  try {
    const safeKey = schemaSafeName(variant.key);
    const response = await generateText({
      messages: [
        {
          role: "system",
          content: `${variant.systemPrompt}

Benchmark instruction: return only the next spoken response to the customer. Do not include labels, JSON, markdown, or analysis.`,
        },
        { role: "user", content: `The customer just said: "${utterance}"` },
      ],
      feature: `voice-campaigns.prompt-bench.simulate.${safeKey}`,
      label: `voice campaign prompt bench simulation ${variant.label}`,
      datasetId,
      timeoutMs: 60_000,
      maxOutputTokens: 700,
    });
    return { variantKey: variant.key, label: variant.label, response: response.trim() };
  } catch (err) {
    return {
      variantKey: variant.key,
      label: variant.label,
      response: "",
      error: err instanceof Error ? err.message : "Simulation failed",
    };
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PromptBenchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const datasetId = datasetIdFromRequest(req, parsed.data.datasetId);
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const segment = listSegments(userId, datasetId).find((item) => item.id === parsed.data.segmentId);
  if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

  const inlinePurpose = parsed.data.purpose?.purposeId === parsed.data.purposeId ? parsed.data.purpose as Purpose : undefined;
  const purpose = getPurpose(parsed.data.purposeId, datasetId, userId) ?? inlinePurpose;
  if (!purpose) return Response.json({ error: "Purpose not found" }, { status: 404 });

  const measurementAwareBrief = campaignBriefWithMeasurementContext({
    brief: parsed.data.brief,
    successDefinition: parsed.data.successDefinition,
    experimentSplit: parsed.data.experimentSplit,
  });
  const datasetContext = {
    id: dataset.id,
    label: dataset.label,
    companyName: dataset.companyName,
    entityName: dataset.entityName,
    systemContext: dataset.systemContext,
    domainHints: dataset.domainHints,
    reportMeta: dataset.reportMeta,
  };

  const current = buildVoiceCampaignScriptPrompt(
    segment,
    purpose,
    parsed.data.language,
    datasetContext,
    measurementAwareBrief,
    parsed.data.agentName,
    parsed.data.voiceGender,
  );

  const promptVariants = parsed.data.promptVariants?.length
    ? parsed.data.promptVariants
    : [{
        id: "candidate-1",
        label: "Candidate prompt",
        prompt: parsed.data.candidatePrompt || DEFAULT_CANDIDATE_GENERATOR_PROMPT,
      }];
  const seenVariantKeys = new Set<string>(["current"]);
  const candidateRuns = promptVariants.map((promptVariant, index) => {
    const fallbackKey = `candidate-${index + 1}`;
    let key = cleanId(promptVariant.id || promptVariant.label, fallbackKey);
    if (key === "current") key = fallbackKey;
    if (seenVariantKeys.has(key)) key = `${key}-${index + 1}`;
    seenVariantKeys.add(key);

    const built = buildCandidateVoiceCampaignScriptPrompt({
      segment,
      purpose,
      language: parsed.data.language,
      dataset: datasetContext,
      campaignBrief: measurementAwareBrief,
      agentName: parsed.data.agentName,
      agentGender: parsed.data.voiceGender,
      candidatePrompt: promptVariant.prompt,
      customerContext: parsed.data.customerContext as PromptBenchCustomerContext | undefined,
    });
    return {
      key,
      label: promptVariant.label || `Candidate ${index + 1}`,
      ...built,
    };
  });

  const variants = await Promise.all([
    runVariant({
      key: "current",
      label: "Current prompt",
      system: current.system,
      user: current.user,
      datasetId,
      segmentName: segment.name,
      brief: measurementAwareBrief,
    }),
    ...candidateRuns.map((candidate) => runVariant({
      key: candidate.key,
      label: candidate.label,
      system: candidate.system,
      user: candidate.user,
      datasetId,
      segmentName: segment.name,
      brief: measurementAwareBrief,
      renderedCandidatePrompt: candidate.renderedCandidatePrompt,
    })),
  ]);

  const utterances = (parsed.data.simulationUtterances?.length ? parsed.data.simulationUtterances : DEFAULT_SIMULATION_UTTERANCES)
    .map((item) => item.trim())
    .filter(Boolean);
  const simulations = parsed.data.includeSimulations
    ? await Promise.all(utterances.map(async (utterance) => {
        const responses = await Promise.all(
          variants.map((variant) => simulateVariant({ variant, utterance, datasetId })),
        );
        return { utterance, responses };
      }))
    : [];

  const payload: PromptBenchRunPayload = {
    dataset: {
      id: dataset.id,
      label: dataset.label,
      companyName: dataset.companyName,
      entityName: dataset.entityName,
    },
    segment,
    purpose,
    inputs: {
      language: parsed.data.language,
      brief: parsed.data.brief,
      measurementAwareBrief,
      agentName: parsed.data.agentName,
      voiceGender: parsed.data.voiceGender,
      customerContext: parsed.data.customerContext,
    },
    variants,
    simulations,
  };

  const run = savePromptBenchRun(userId, payload);
  return Response.json(run);
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const runId = new URL(req.url).searchParams.get("runId")?.trim();
  if (!runId) return Response.json({ error: "runId is required" }, { status: 400 });

  const run = getPromptBenchRun(userId, runId);
  if (!run) return Response.json({ error: "Prompt bench run not found" }, { status: 404 });
  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}
