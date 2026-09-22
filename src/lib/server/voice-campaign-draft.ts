import { createHash, randomUUID } from "crypto";
import type { DatasetConfig } from "@/lib/datasets/types";
import { DEFAULT_GEMINI_VOICE, geminiVoiceGender } from "@/lib/gemini-voices";
import { generateText, generateTextStream, parseJsonResponse } from "@/lib/llm";
import { listPurposes } from "@/lib/purpose-store";
import { buildVoiceCampaignScriptPrompt } from "@/features/prompts/voice/campaign-script";
import {
  buildVoiceIntakePrompt,
  VOICE_INTAKE_SCHEMA,
  type VoiceIntakeResult,
} from "@/features/prompts/voice/intake";
import {
  getVoiceArchetype,
  listVoiceArchetypes,
  type VoiceCampaignArchetype,
} from "@/lib/voice-archetypes";
import type { CampaignDiagnostic } from "@/lib/voice-diagnostics";
import { applyFactLedgerToWorkflow } from "@/lib/voice-fact-ledger";
import { layoutVoiceWorkflow } from "@/lib/voice-campaign-layout";
import type {
  GeneratedVoiceAgentNarrative,
  GeneratedVoiceWorkflow,
  GeneratedVoiceWorkflowNode,
  ScriptPromptResult,
} from "@/features/prompts/voice/campaign-script";
import {
  compileVoiceCampaignScript,
  defaultAgentName,
  defaultVoiceCampaignPersonaPrompt,
  type VoiceCampaignTemplate,
  type VoiceFlowEdge,
  type VoiceFlowNode,
  type VoiceUniversalRoute,
  type VoiceUniversalRouteKind,
} from "@/lib/voice-campaign-flow";
import { buildEditableCallScript } from "@/lib/voice-campaign-studio-utils";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";
import { getCampaign, saveCampaign } from "@/lib/voice-campaign-store";
import {
  defaultVoiceCampaignExperimentSplit,
  successDefinitionWithExperimentBaseline,
} from "@/lib/voice-campaign-experiment";
import { defaultVoiceCampaignSuccessDefinition } from "@/lib/voice-campaign-success";
import type { Segment } from "@/lib/types";
import { resolveVoiceCampaignPurpose } from "@/lib/voice-campaign-purpose";
import {
  REQUIRED_UNIVERSAL_ROUTE_KINDS,
  type VoiceAgentBuildArtifactEvent,
  type VoiceAgentBuildEvent,
  type VoiceAgentGenerationStatus,
} from "@/lib/voice-agent-generation-types";
import { validateVoiceCampaignWorkflow } from "@/lib/voice-campaign-workflow-validation";

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";

export interface CreateVoiceCampaignDraftInput {
  userId: string;
  datasetId: string;
  dataset: DatasetConfig;
  segment: Segment;
  purposeId?: string;
  objective?: string;
  campaignName?: string;
  language?: string;
  voice?: string;
  voiceName?: string;
  phoneNumbers?: string[];
  generationRequestId?: string;
  onStatus?: (status: VoiceAgentGenerationStatus) => void;
  onBuildEvent?: (event: VoiceAgentBuildEvent) => void;
}

export interface VoiceCampaignDraftResult {
  campaign: VoiceCampaign;
  template: VoiceCampaignTemplate;
  generationSummary: string;
  diagnostics?: CampaignDiagnostic[];
}

interface GeneratedAgentDraft {
  generation: GeneratedVoiceAgentNarrative;
  campaignName: string;
  systemPrompt: string;
  firstMessage: string;
  reasoning: string;
  workflow: GeneratedVoiceWorkflow;
  successCriteria: { primary: string; secondary: string[] };
  guardrails: string[];
}

const NODE_KINDS = new Set<GeneratedVoiceWorkflowNode["kind"]>([
  "start",
  "prompt",
  "question",
  "condition",
  "action",
  "transfer",
  "end",
]);
const UNIVERSAL_ROUTE_KINDS = new Set<VoiceUniversalRouteKind>(REQUIRED_UNIVERSAL_ROUTE_KINDS);

const VOICE_CAMPAIGN_SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    generation: {
      type: "object",
      properties: {
        opening: {
          type: "object",
          properties: {
            title: { type: "string" },
            detail: { type: "string" },
          },
          required: ["title", "detail"],
          additionalProperties: false,
        },
        steps: {
          type: "array",
          minItems: 4,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              detail: { type: "string" },
            },
            required: ["id", "title", "detail"],
            additionalProperties: false,
          },
        },
        designRationale: { type: "string" },
        workflowPlanSummary: { type: "string" },
        edgeRationale: { type: "string" },
        routeRationale: { type: "string" },
        validationPassed: { type: "string" },
        completion: { type: "string" },
      },
      required: [
        "opening",
        "steps",
        "designRationale",
        "workflowPlanSummary",
        "edgeRationale",
        "routeRationale",
        "validationPassed",
        "completion",
      ],
      additionalProperties: false,
    },
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
          minItems: 7,
          maxItems: 12,
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
          maxItems: 24,
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
        universalRoutes: {
          type: "array",
          minItems: 10,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...REQUIRED_UNIVERSAL_ROUTE_KINDS] },
              label: { type: "string" },
              trigger: { type: "string" },
              behavior: { type: "string" },
              targetNodeId: { type: ["string", "null"] },
              terminal: { type: "boolean" },
            },
            required: ["kind", "label", "trigger", "behavior", "targetNodeId", "terminal"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "description", "objective", "audienceHint", "nodes", "edges", "universalRoutes"],
      additionalProperties: false,
    },
    successCriteria: {
      type: "object",
      properties: {
        primary: { type: "string" },
        secondary: { type: "array", maxItems: 5, items: { type: "string" } },
      },
      required: ["primary", "secondary"],
      additionalProperties: false,
    },
    guardrails: { type: "array", minItems: 3, maxItems: 12, items: { type: "string" } },
  },
  required: ["generation", "campaignName", "systemPrompt", "firstMessage", "reasoning", "workflow", "successCriteria", "guardrails"],
  additionalProperties: false,
};

function cleanText(value: unknown, fallback: string, maxLength = 900): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return fallback;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function cleanLongText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
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

function requiredGeneratedText(value: unknown, field: string, maxLength = 900): string {
  const text = cleanText(value, "", maxLength);
  if (!text) throw new Error(`Voice agent generation omitted ${field}`);
  return text;
}

function sanitizeGenerationNarrative(value: unknown): GeneratedVoiceAgentNarrative {
  if (!value || typeof value !== "object") {
    throw new Error("Voice agent generation omitted its build narrative");
  }
  const source = value as Partial<GeneratedVoiceAgentNarrative>;
  const opening = source.opening;
  const steps = Array.isArray(source.steps) ? source.steps : [];
  if (!opening || steps.length === 0) {
    throw new Error("Voice agent generation returned an incomplete build narrative");
  }
  return {
    opening: {
      title: requiredGeneratedText(opening.title, "generation.opening.title", 100),
      detail: requiredGeneratedText(opening.detail, "generation.opening.detail", 500),
    },
    steps: steps.slice(0, 8).map((step, index) => ({
      id: cleanId(step.id, `generated-step-${index + 1}`),
      title: requiredGeneratedText(step.title, `generation.steps[${index}].title`, 100),
      detail: requiredGeneratedText(step.detail, `generation.steps[${index}].detail`, 500),
    })),
    designRationale: requiredGeneratedText(source.designRationale, "generation.designRationale", 700),
    workflowPlanSummary: requiredGeneratedText(source.workflowPlanSummary, "generation.workflowPlanSummary", 700),
    edgeRationale: requiredGeneratedText(source.edgeRationale, "generation.edgeRationale", 700),
    routeRationale: requiredGeneratedText(source.routeRationale, "generation.routeRationale", 700),
    validationPassed: requiredGeneratedText(source.validationPassed, "generation.validationPassed", 700),
    completion: requiredGeneratedText(source.completion, "generation.completion", 700),
  };
}

function jsonStringEnd(text: string, start: number): number {
  if (text[start] !== '"') return -1;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') return index;
  }
  return -1;
}

function jsonPropertyValueStart(text: string, property: string): number {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '"') continue;
    const end = jsonStringEnd(text, index);
    if (end < 0) return -1;
    let key: string | undefined;
    try {
      key = JSON.parse(text.slice(index, end + 1)) as string;
    } catch {
      index = end;
      continue;
    }
    let cursor = end + 1;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (key === property && text[cursor] === ":") {
      cursor += 1;
      while (/\s/.test(text[cursor] ?? "")) cursor += 1;
      return cursor;
    }
    index = end;
  }
  return -1;
}

function extractCompletedStringProperty(text: string, property: string): string | undefined {
  const start = jsonPropertyValueStart(text, property);
  if (start < 0 || text[start] !== '"') return undefined;
  const end = jsonStringEnd(text, start);
  if (end < 0) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as string;
  } catch {
    return undefined;
  }
}

function extractCompletedArrayObjects<T>(text: string, property: string): T[] {
  const arrayStart = jsonPropertyValueStart(text, property);
  if (arrayStart < 0 || text[arrayStart] !== "[") return [];
  const results: T[] = [];
  let inString = false;
  let escaped = false;
  let objectDepth = 0;
  let objectStart = -1;
  for (let index = arrayStart + 1; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (objectDepth === 0) objectStart = index;
      objectDepth += 1;
      continue;
    }
    if (character === "}" && objectDepth > 0) {
      objectDepth -= 1;
      if (objectDepth === 0 && objectStart >= 0) {
        try {
          results.push(JSON.parse(text.slice(objectStart, index + 1)) as T);
        } catch {
          // The next stream chunk will retry once the object is complete.
        }
        objectStart = -1;
      }
      continue;
    }
    if (character === "]" && objectDepth === 0) break;
  }
  return results;
}

function fallbackFirstMessage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized === "english") return "Hello, this is a quick call from the team. Is this a good time?";
  if (normalized === "hinglish") return "Namaste, team se call kar rahi hoon. Ek minute baat ho payegi?";
  return "Namaste, team se call kar rahi hoon. Ek minute baat ho payegi?";
}

function selectPurpose(
  datasetId: string,
  userId: string,
  requestedPurposeId: string | undefined,
  campaignBrief: string,
) {
  return resolveVoiceCampaignPurpose({
    purposeId: requestedPurposeId,
    purposes: listPurposes(datasetId, userId),
    campaignBrief,
  });
}

function sanitizeWorkflow(value: unknown, brief: string, segmentName: string): GeneratedVoiceWorkflow {
  const source = typeof value === "object" && value !== null
    ? value as Partial<GeneratedVoiceWorkflow>
    : {};
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const nodes = rawNodes
    .slice(0, 12)
    .map((raw, index): GeneratedVoiceWorkflowNode => {
      const candidate = typeof raw === "object" && raw !== null
        ? raw as Partial<GeneratedVoiceWorkflowNode>
        : {};
      const fallbackId = index === 0 ? "start" : `step-${index + 1}`;
      const requestedKind = candidate.kind;
      const kind = requestedKind && NODE_KINDS.has(requestedKind) ? requestedKind : "prompt";
      return {
        id: cleanId(candidate.id, fallbackId),
        kind,
        title: cleanText(candidate.title, `Step ${index + 1}`, 80),
        body: cleanText(candidate.body, "Handle this part of the call naturally.", 800),
        helper: candidate.helper ? cleanText(candidate.helper, "", 160) : null,
      };
    });
  const rawEdges = Array.isArray(source.edges) ? source.edges : [];
  const edges = rawEdges
    .slice(0, 24)
    .map((raw) => {
      const candidate = typeof raw === "object" && raw !== null
        ? raw as { source?: unknown; target?: unknown; label?: unknown }
        : {};
      const sourceId = typeof candidate.source === "string" ? cleanId(candidate.source, "") : "";
      const targetId = typeof candidate.target === "string" ? cleanId(candidate.target, "") : "";
      if (!sourceId || !targetId) return null;
      return {
        source: sourceId,
        target: targetId,
        label: typeof candidate.label === "string" && candidate.label.trim()
          ? cleanText(candidate.label, "", 80)
          : null,
      };
    })
    .filter((edge): edge is GeneratedVoiceWorkflow["edges"][number] => Boolean(edge));
  const rawUniversalRoutes = Array.isArray(source.universalRoutes) ? source.universalRoutes : [];
  const universalRoutes = rawUniversalRoutes.slice(0, 12).flatMap((raw): VoiceUniversalRoute[] => {
    const candidate = typeof raw === "object" && raw !== null
      ? raw as unknown as Record<string, unknown>
      : {};
    if (typeof candidate.kind !== "string" || !UNIVERSAL_ROUTE_KINDS.has(candidate.kind as VoiceUniversalRouteKind)) {
      return [];
    }
    const targetNodeId = typeof candidate.targetNodeId === "string" && candidate.targetNodeId.trim()
      ? cleanId(candidate.targetNodeId, "")
      : undefined;
    return [{
      kind: candidate.kind as VoiceUniversalRouteKind,
      label: cleanText(candidate.label, candidate.kind.replace(/_/g, " "), 80),
      trigger: cleanText(candidate.trigger, `Customer signals ${candidate.kind.replace(/_/g, " ")}`, 240),
      behavior: cleanText(candidate.behavior, "Acknowledge the request and respond safely.", 500),
      ...(targetNodeId ? { targetNodeId } : {}),
      terminal: candidate.terminal === true,
    }];
  });

  return {
    title: cleanText(source.title, "Generated Campaign Workflow", 80),
    description: cleanText(source.description, "Generated from the campaign brief.", 180),
    objective: cleanText(source.objective, brief, 500),
    audienceHint: cleanText(source.audienceHint, segmentName, 220),
    nodes,
    edges,
    universalRoutes,
  };
}

function workflowToTemplate(
  workflow: GeneratedVoiceWorkflow,
  campaignName: string,
  firstMessage: string,
): VoiceCampaignTemplate {
  const nodes: VoiceFlowNode[] = workflow.nodes.map((n, index) => ({
    id: n.id,
    type: "voiceNode",
    position: { x: 0, y: index * 170 },
    data: {
      kind: n.kind,
      title: n.title,
      body: n.body,
      helper: n.helper ?? undefined,
      required: n.kind === "start" || n.kind === "end",
      ...(n.provenance ? { provenance: n.provenance } : {}),
    },
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: VoiceFlowEdge[] = workflow.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({
      id: `e-${e.source}-${e.target}-${e.label ?? "next"}`.replace(/\s+/g, "-").toLowerCase(),
      source: e.source,
      target: e.target,
      label: e.label ?? undefined,
      type: "smoothstep",
    }));
  const layoutNodes = layoutVoiceWorkflow(nodes, edges);

  return {
    id: `llm-${Date.now()}`,
    title: workflow.title,
    description: workflow.description,
    objective: workflow.objective,
    audienceHint: workflow.audienceHint,
    defaultCampaignName: campaignName,
    recommendedOfferId: undefined,
    firstMessage,
    nodes: layoutNodes,
    edges,
  };
}

function runtimeGuardrails({
  systemPrompt,
  firstMessage,
  language,
}: {
  systemPrompt: string;
  firstMessage: string;
  language: string;
}): string {
  return `${systemPrompt.trim()}

Runtime guardrails:
- The launch code speaks this opening line as the first turn: "${firstMessage}"
- The first turn must contain only that opening line.
- After the opening line, wait for the customer.
- Do not reveal the campaign purpose before the customer permits the conversation to continue.
- Follow the validated workflow and let the customer's latest intent override the normal path.
- Never invent facts, policies, promises, eligibility, pricing, or outcomes that are not present in the workflow.
- Handle ordinary questions and confusion in-call when the workflow provides enough information.
- Transfer only when the issue remains unresolved, is disputed, or requires information or authority the agent does not have.
- Respect end-call, do-not-call, wrong-person, language-change, voicemail, and callback requests immediately.
- If private customer context is appended to the prompt, use it silently after permission. Mention at most one relevant fact and ask one diagnostic question before any transfer.
- Do not sound clipped. Most useful replies should be 1 to 3 short spoken sentences, about 25 to 55 words total. Simple confirmations can be shorter.
- Stay in ${language}.
- Return only the next spoken line.`;
}

/** Pass 0 intake — failure-tolerant: any error means "no archetype", never a failed build. */
async function runDraftIntake({
  brief,
  dataset,
  segment,
  datasetId,
}: {
  brief: string;
  dataset: DatasetConfig;
  segment: Segment;
  datasetId: string;
}): Promise<VoiceIntakeResult | null> {
  try {
    const { system, user } = buildVoiceIntakePrompt({
      brief,
      datasetLabel: dataset.label,
      segmentName: segment.name,
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
      datasetId,
      timeoutMs: 60_000,
    });
    return parseJsonResponse<VoiceIntakeResult>(raw);
  } catch {
    return null;
  }
}

async function generateSegmentSpecificScript({
  datasetId,
  dataset,
  segment,
  offer,
  objective,
  language,
  agentName,
  archetype,
  knownFacts,
  validationFeedback,
  onPartial,
}: {
  datasetId: string;
  dataset: DatasetConfig;
  segment: Segment;
  offer: NonNullable<ReturnType<typeof selectPurpose>>;
  objective?: string;
  language: string;
  agentName: string;
  archetype?: VoiceCampaignArchetype;
  knownFacts?: string[];
  validationFeedback?: string[];
  onPartial?: (partialJson: string) => void;
}): Promise<GeneratedAgentDraft> {
  const brief = objective?.trim() ||
    `Create a useful outbound voice campaign for the "${segment.name}" segment.`;
  const { system, user } = buildVoiceCampaignScriptPrompt(
    segment,
    offer,
    language,
    {
      id: dataset.id,
      label: dataset.label,
      companyName: dataset.companyName,
      entityName: dataset.entityName,
    },
    brief,
    agentName,
    undefined,
    { fullAgent: true, archetype, knownFacts },
  );
  const repairInstruction = validationFeedback?.length
    ? `\n\nThe previous workflow failed validation. Return a corrected complete workflow that fixes every issue:\n${validationFeedback.map((issue) => `- ${issue}`).join("\n")}`
    : "";

  const outputStream = await generateTextStream({
    messages: [
      { role: "system", content: system },
      { role: "user", content: `${user}${repairInstruction}` },
    ],
    jsonSchema: {
      name: "voice_campaign_script",
      schema: VOICE_CAMPAIGN_SCRIPT_SCHEMA,
      strict: true,
    },
    feature: "voice-campaigns.draft-from-segment",
    label: "voice campaign draft from segment",
    datasetId,
    timeoutMs: 240_000,
    maxOutputTokens: 9000,
  });
  let raw = "";
  let lastPartialLength = 0;
  for await (const delta of outputStream) {
    raw += delta;
    if (raw.length - lastPartialLength >= 600) {
      lastPartialLength = raw.length;
      onPartial?.(raw);
    }
  }
  onPartial?.(raw);
  const result = parseJsonResponse<ScriptPromptResult>(raw);
  const generation = sanitizeGenerationNarrative(result.generation);
  const campaignName = cleanText(result.campaignName, `${segment.name} campaign`, 80);
  const firstMessage = cleanText(result.firstMessage, fallbackFirstMessage(language), 180);
  const systemPrompt = cleanLongText(result.systemPrompt, `You are ${agentName}, a phone advisor.`);
  return {
    generation,
    campaignName,
    firstMessage,
    systemPrompt: runtimeGuardrails({ systemPrompt, firstMessage, language }),
    reasoning: cleanText(result.reasoning, "Generated from the selected audience, offer, and use case.", 700),
    workflow: sanitizeWorkflow(result.workflow, brief, segment.name),
    successCriteria: {
      primary: cleanText(result.successCriteria?.primary, "Customer completes the requested conversation outcome", 240),
      secondary: (result.successCriteria?.secondary ?? [])
        .map((criterion) => cleanText(criterion, "", 240))
        .filter(Boolean)
        .slice(0, 5),
    },
    guardrails: (result.guardrails ?? [])
      .map((guardrail) => cleanText(guardrail, "", 240))
      .filter(Boolean)
      .slice(0, 12),
  };
}

function deterministicCampaignId(userId: string, datasetId: string, requestId: string): string {
  const digest = createHash("sha256").update(`${userId}:${datasetId}:${requestId}`).digest("hex").slice(0, 20);
  return `vc_gen_${digest}`;
}

function templateFromCampaign(campaign: VoiceCampaign): VoiceCampaignTemplate {
  return {
    id: campaign.workflow?.templateId || `existing-${campaign.id}`,
    title: campaign.workflow?.templateTitle || campaign.name,
    description: campaign.scriptReasoning,
    objective: campaign.scriptReasoning,
    audienceHint: campaign.segmentName,
    defaultCampaignName: campaign.name,
    firstMessage: campaign.firstMessage,
    nodes: campaign.workflow?.nodes ?? [],
    edges: campaign.workflow?.edges ?? [],
  };
}

function artifactEvent(
  id: string,
  kind: VoiceAgentBuildArtifactEvent["kind"],
  path: string,
  title: string,
  content: string,
): VoiceAgentBuildArtifactEvent {
  return {
    type: "artifact",
    id,
    kind,
    path,
    title,
    content,
    change: "added",
    additions: Math.max(1, content.split("\n").length),
  };
}

function createPartialBuildEmitter(
  segmentName: string,
  onStatus?: (status: VoiceAgentGenerationStatus) => void,
  onBuildEvent?: (event: VoiceAgentBuildEvent) => void,
): (partialJson: string) => void {
  const emittedGenerationSteps = new Set<string>();
  const emittedNodeIds = new Set<string>();
  const emittedEdgeIds = new Set<string>();
  const emittedUniversalKinds = new Set<string>();
  let emittedGlobalPrompt = false;
  let emittedReasoning = false;
  let emittedOpening = false;
  let emittedDesignRationale = false;
  let emittedEdgeRationale = false;
  let emittedRouteRationale = false;
  let plannedNodeCount = 0;

  return (partialJson) => {
    if (!onBuildEvent && !onStatus) return;
    const openingTitle = extractCompletedStringProperty(partialJson, "title");
    const openingDetail = extractCompletedStringProperty(partialJson, "detail");
    if (openingTitle && openingDetail && !emittedOpening) {
      emittedOpening = true;
      const status = {
        id: "generated-opening",
        title: cleanText(openingTitle, "", 100),
        detail: cleanText(openingDetail, "", 500),
      };
      onStatus?.(status);
      onBuildEvent?.({ type: "narrative", id: status.id, content: status.detail });
    }

    const generationSteps = extractCompletedArrayObjects<{ id?: unknown; title?: unknown; detail?: unknown }>(partialJson, "steps");
    for (const [index, step] of generationSteps.entries()) {
      if (typeof step.title !== "string" || typeof step.detail !== "string") continue;
      const id = cleanId(step.id, `generated-step-${index + 1}`);
      if (emittedGenerationSteps.has(id)) continue;
      emittedGenerationSteps.add(id);
      const title = cleanText(step.title, "", 100);
      const detail = cleanText(step.detail, "", 500);
      onStatus?.({ id, title, detail });
      onBuildEvent?.({ type: "activity", id: `generated-activity-${id}`, label: title, status: "completed" });
      onBuildEvent?.({ type: "narrative", id: `generated-detail-${id}`, content: detail });
    }

    const designRationale = extractCompletedStringProperty(partialJson, "designRationale");
    if (designRationale && !emittedDesignRationale) {
      emittedDesignRationale = true;
      onBuildEvent?.({ type: "narrative", id: "generated-design-rationale", content: cleanText(designRationale, "", 700) });
    }
    const edgeRationale = extractCompletedStringProperty(partialJson, "edgeRationale");
    if (edgeRationale && !emittedEdgeRationale) {
      emittedEdgeRationale = true;
      onBuildEvent?.({ type: "narrative", id: "generated-edge-rationale", content: cleanText(edgeRationale, "", 700) });
    }
    const routeRationale = extractCompletedStringProperty(partialJson, "routeRationale");
    if (routeRationale && !emittedRouteRationale) {
      emittedRouteRationale = true;
      onBuildEvent?.({ type: "narrative", id: "generated-route-rationale", content: cleanText(routeRationale, "", 700) });
    }

    const campaignName = cleanText(
      extractCompletedStringProperty(partialJson, "campaignName"),
      `${segmentName} voice agent`,
      80,
    );
    const systemPrompt = extractCompletedStringProperty(partialJson, "systemPrompt");
    if (systemPrompt && !emittedGlobalPrompt) {
      emittedGlobalPrompt = true;
      onBuildEvent?.(artifactEvent(
        "artifact-global-prompt",
        "global_prompt",
        ".agent/global_prompt.md",
        "Global prompt",
        systemPrompt,
      ));
    }

    const reasoning = extractCompletedStringProperty(partialJson, "reasoning");
    if (reasoning && !emittedReasoning) {
      emittedReasoning = true;
      onBuildEvent?.({
        type: "narrative",
        id: "design-rationale",
        content: cleanText(reasoning, "", 700),
      });
    }

    const nodes = extractCompletedArrayObjects<Partial<GeneratedVoiceWorkflowNode>>(partialJson, "nodes")
      .filter((node): node is GeneratedVoiceWorkflowNode =>
        typeof node.id === "string" && typeof node.title === "string" && typeof node.body === "string" && typeof node.kind === "string"
      );
    if (nodes.length > 0 && nodes.length !== plannedNodeCount) {
      plannedNodeCount = nodes.length;
      const workflowPlanSummary = extractCompletedStringProperty(partialJson, "workflowPlanSummary");
      onBuildEvent?.({
        type: "plan",
        id: "workflow-plan",
        summary: cleanText(workflowPlanSummary, campaignName, 700),
        nodes: nodes.map((node) => ({
          id: cleanId(node.id, `step-${nodes.indexOf(node) + 1}`),
          title: cleanText(node.title, "Workflow step", 80),
          kind: node.kind,
          summary: cleanText(node.body.split(/\n|\./)[0], node.title, 180),
        })),
      });
    }
    for (const node of nodes) {
      const id = cleanId(node.id, `step-${emittedNodeIds.size + 1}`);
      if (emittedNodeIds.has(id)) continue;
      emittedNodeIds.add(id);
      onBuildEvent?.(artifactEvent(
        `artifact-node-${id}`,
        "node",
        `nodes/${id}/node.md`,
        cleanText(node.title, "Workflow step", 80),
        `Kind: ${node.kind}\n\n${cleanLongText(node.body, "Handle this workflow step naturally.")}${node.helper ? `\n\nOperator note: ${node.helper}` : ""}`,
      ));
    }

    const edges = extractCompletedArrayObjects<{ source?: unknown; target?: unknown; label?: unknown }>(partialJson, "edges");
    for (const [index, edge] of edges.entries()) {
      if (typeof edge.source !== "string" || typeof edge.target !== "string") continue;
      const source = cleanId(edge.source, "source");
      const target = cleanId(edge.target, "target");
      const id = `artifact-edge-${index}-${source}-${target}`;
      if (emittedEdgeIds.has(id)) continue;
      emittedEdgeIds.add(id);
      onBuildEvent?.(artifactEvent(
        id,
        "edge",
        `routes/${source}-to-${target}.md`,
        `${source} → ${target}`,
        cleanText(edge.label, "Continue when the current step is complete.", 240),
      ));
    }

    const universalRoutes = extractCompletedArrayObjects<Record<string, unknown>>(partialJson, "universalRoutes");
    for (const route of universalRoutes) {
      if (typeof route.kind !== "string" || emittedUniversalKinds.has(route.kind)) continue;
      emittedUniversalKinds.add(route.kind);
      const target = typeof route.targetNodeId === "string" && route.targetNodeId.trim()
        ? cleanId(route.targetNodeId, "current-workflow")
        : "current workflow";
      onBuildEvent?.(artifactEvent(
        `artifact-universal-${route.kind}`,
        "universal_route",
        `routes/universal/${route.kind}.md`,
        cleanText(route.label, route.kind.replace(/_/g, " "), 80),
        `Trigger: ${cleanText(route.trigger, "Customer signals this intent.", 240)}\n\nBehavior: ${cleanText(route.behavior, "Respond safely and follow the route.", 500)}\n\nTarget: ${target}\nTerminal: ${route.terminal === true ? "yes" : "no"}`,
      ));
    }
  };
}

function emitBuildPlan(
  generated: GeneratedAgentDraft,
  onBuildEvent?: (event: VoiceAgentBuildEvent) => void,
) {
  onBuildEvent?.({
    type: "plan",
    id: "workflow-plan",
    summary: generated.generation.workflowPlanSummary,
    nodes: generated.workflow.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      kind: node.kind,
      summary: node.body.split(/\n|\./)[0]?.trim() || node.title,
    })),
  });
}

function emitCompiledBuildTranscript({
  generated,
  onBuildEvent,
}: {
  generated: GeneratedAgentDraft;
  onBuildEvent?: (event: VoiceAgentBuildEvent) => void;
}) {
  if (!onBuildEvent) return;
  const workflow = generated.workflow;
  const nodeTitle = new Map(workflow.nodes.map((node) => [node.id, node.title]));

  onBuildEvent(artifactEvent(
    "artifact-global-prompt",
    "global_prompt",
    ".agent/global_prompt.md",
    "Global prompt",
    generated.systemPrompt,
  ));

  for (const node of workflow.nodes) {
    onBuildEvent(artifactEvent(
      `artifact-node-${node.id}`,
      "node",
      `nodes/${node.id}/node.md`,
      node.title,
      `Kind: ${node.kind}\n\n${node.body}${node.helper ? `\n\nOperator note: ${node.helper}` : ""}`,
    ));
    const outgoing = workflow.edges.filter((edge) => edge.source === node.id);
    const conditionContent = node.kind === "end"
      ? "Terminal node. End the call after completing this step."
      : outgoing.length > 0
        ? outgoing.map((edge) => `- ${edge.label || "Continue"} → ${nodeTitle.get(edge.target) || edge.target}`).join("\n")
        : "No ordinary transition configured. Universal interruption routes still apply.";
    onBuildEvent(artifactEvent(
      `artifact-condition-${node.id}`,
      "condition",
      `nodes/${node.id}/condition.md`,
      `${node.title} conditions`,
      conditionContent,
    ));
  }

  for (const [index, edge] of workflow.edges.entries()) {
    const source = nodeTitle.get(edge.source) || edge.source;
    const target = nodeTitle.get(edge.target) || edge.target;
    onBuildEvent(artifactEvent(
      `artifact-edge-${index}-${edge.source}-${edge.target}`,
      "edge",
      `routes/${edge.source}-to-${edge.target}.md`,
      `${source} → ${target}`,
      edge.label || "Continue when the current step is complete.",
    ));
  }

  for (const route of workflow.universalRoutes ?? []) {
    const target = route.targetNodeId ? nodeTitle.get(route.targetNodeId) || route.targetNodeId : "current workflow";
    onBuildEvent(artifactEvent(
      `artifact-universal-${route.kind}`,
      "universal_route",
      `routes/universal/${route.kind}.md`,
      route.label,
      `Trigger: ${route.trigger}\n\nBehavior: ${route.behavior}\n\nTarget: ${target}\nTerminal: ${route.terminal ? "yes" : "no"}`,
    ));
  }

  onBuildEvent(artifactEvent(
    "artifact-success-criteria",
    "success_criteria",
    ".agent/success_criteria.md",
    "Success criteria",
    [`Primary: ${generated.successCriteria.primary}`, ...generated.successCriteria.secondary.map((criterion) => `- ${criterion}`)].join("\n"),
  ));
  onBuildEvent(artifactEvent(
    "artifact-guardrails",
    "guardrails",
    ".agent/guardrails.md",
    "Guardrails",
    generated.guardrails.map((guardrail) => `- ${guardrail}`).join("\n"),
  ));

  const searchableText = [
    generated.systemPrompt,
    ...workflow.nodes.flatMap((node) => [node.body, node.helper || ""]),
  ].join("\n");
  const placeholders = [...new Set(searchableText.match(/\{\{[^}]+\}\}|\[[A-Z][^\]]+\]/g) ?? [])];
  for (const [index, placeholder] of placeholders.entries()) {
    onBuildEvent({
      type: "review",
      id: `review-placeholder-${index}`,
      label: `Resolve ${placeholder}`,
      description: "Provide the runtime value or map it from recipient context before dispatch.",
      severity: "required",
    });
  }
  if (workflow.nodes.some((node) => node.kind === "transfer")) {
    onBuildEvent({
      type: "review",
      id: "review-transfer-destination",
      label: "Configure transfer destination",
      description: "Add the approved phone number or queue for the escalation route before dispatch.",
      severity: "required",
    });
  }
}

export async function createVoiceCampaignDraftFromSegment({
  userId,
  datasetId,
  dataset,
  segment,
  purposeId,
  objective,
  campaignName,
  language = process.env.DEFAULT_VOICE_CAMPAIGN_LANGUAGE || "Hinglish",
  voice = DEFAULT_GEMINI_VOICE,
  voiceName,
  phoneNumbers = [],
  generationRequestId,
  onStatus,
  onBuildEvent,
}: CreateVoiceCampaignDraftInput): Promise<VoiceCampaignDraftResult> {
  const campaignId = generationRequestId
    ? deterministicCampaignId(userId, datasetId, generationRequestId)
    : `vc_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const existing = getCampaign(campaignId, { userId, datasetId });
  if (existing) {
    return {
      campaign: existing,
      template: templateFromCampaign(existing),
      generationSummary: existing.scriptReasoning,
    };
  }

  const campaignBrief = objective?.trim() ||
    `Create a useful outbound voice campaign for the "${segment.name}" segment.`;
  const purpose = selectPurpose(datasetId, userId, purposeId, campaignBrief);

  onStatus?.({
    id: "intake",
    title: "Reading the brief",
    detail: "Classifying the campaign against the archetype library and extracting the facts it supplies.",
  });
  // Intake runs once; the validation-repair regeneration below reuses the same result.
  const intake = await runDraftIntake({ brief: campaignBrief, dataset, segment, datasetId });
  const archetype = intake?.archetypeId ? getVoiceArchetype(intake.archetypeId) ?? undefined : undefined;
  const knownFacts = (intake?.knownFacts ?? []).filter((fact) => typeof fact === "string" && fact.trim());

  const agentName = voiceName || defaultAgentName(voice);
  const emitPartialBuild = createPartialBuildEmitter(segment.name, onStatus, onBuildEvent);
  let generated = await generateSegmentSpecificScript({
    datasetId,
    dataset,
    segment,
    offer: purpose,
    objective: campaignBrief,
    language,
    agentName,
    archetype,
    knownFacts,
    onPartial: emitPartialBuild,
  });
  const resolvedCampaignName = campaignName?.trim() || generated.campaignName || `${purpose.name} · ${segment.name}`;
  emitBuildPlan(generated, onBuildEvent);
  let template = workflowToTemplate(generated.workflow, resolvedCampaignName, generated.firstMessage);
  onBuildEvent?.({ type: "validation", id: "validation-current", status: "checking", issues: [] });
  let validation = validateVoiceCampaignWorkflow({
    nodes: generated.workflow.nodes,
    edges: generated.workflow.edges,
    universalRoutes: generated.workflow.universalRoutes ?? [],
  });
  if (!validation.valid) {
    onBuildEvent?.({ type: "validation", id: "validation-repair", status: "repairing", issues: validation.issues });
    const emitPartialRepair = createPartialBuildEmitter(segment.name, onStatus, onBuildEvent);
    generated = await generateSegmentSpecificScript({
      datasetId,
      dataset,
      segment,
      offer: purpose,
      objective: campaignBrief,
      language,
      agentName,
      archetype,
      knownFacts,
      validationFeedback: validation.issues,
      onPartial: emitPartialRepair,
    });
    emitBuildPlan(generated, onBuildEvent);
    template = workflowToTemplate(generated.workflow, resolvedCampaignName, generated.firstMessage);
    validation = validateVoiceCampaignWorkflow({
      nodes: generated.workflow.nodes,
      edges: generated.workflow.edges,
      universalRoutes: generated.workflow.universalRoutes ?? [],
    });
  }
  if (!validation.valid) {
    onBuildEvent?.({ type: "validation", id: "validation-final", status: "failed", issues: validation.issues });
    throw new Error(`Generated workflow failed validation: ${validation.issues.join("; ")}`);
  }
  onBuildEvent?.({ type: "validation", id: "validation-final", status: "passed", issues: [] });
  onBuildEvent?.({
    type: "narrative",
    id: "validation-complete",
    content: generated.generation.validationPassed,
  });

  // Fact-ledger pass: generated nodes may not state facts absent from the
  // brief/purpose/archetype defaults — unsourced atoms become {{Placeholder}}s.
  for (const node of generated.workflow.nodes) node.provenance = "generated";
  const ledger = applyFactLedgerToWorkflow(generated.workflow, {
    brief: campaignBrief,
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
  if (ledger.rewrittenNodes.length > 0) {
    const rewrittenBodies = new Map(ledger.rewrittenNodes.map((node) => [node.id, node.body]));
    for (const node of generated.workflow.nodes) {
      const rewritten = rewrittenBodies.get(node.id);
      if (rewritten !== undefined) node.body = rewritten;
    }
    template = workflowToTemplate(generated.workflow, resolvedCampaignName, generated.firstMessage);
  }
  for (const diagnostic of ledger.diagnostics) {
    const placeholder = typeof diagnostic.data?.placeholder === "string" ? diagnostic.data.placeholder : null;
    onBuildEvent?.({
      type: "review",
      id: `review-${diagnostic.id}`,
      label: placeholder ? `Source ${placeholder}` : cleanText(diagnostic.message, "Review diagnostic", 80),
      description: diagnostic.message,
      severity: diagnostic.severity === "error" ? "required" : "recommended",
    });
  }

  emitCompiledBuildTranscript({
    generated,
    onBuildEvent,
  });
  const experimentSplit = defaultVoiceCampaignExperimentSplit();
  const operatorScript = buildEditableCallScript({
    nodes: template.nodes,
    edges: template.edges,
  });
  const defaultSuccess = defaultVoiceCampaignSuccessDefinition();
  const generatedGuardrails = [...new Set([...defaultSuccess.guardrails, ...generated.guardrails])];
  const successDefinition = {
    ...defaultSuccess,
    primary: {
      ...defaultSuccess.primary,
      label: generated.successCriteria.primary,
      criterion: generated.successCriteria.primary,
      description: generated.successCriteria.primary,
    },
    secondary: generated.successCriteria.secondary.map((criterion, index) => ({
      id: `secondary-generated-${index + 1}`,
      label: criterion,
      type: "call_outcome" as const,
      outcome: "positive" as const,
      windowDays: 0,
      criterion,
      description: criterion,
    })),
    guardrails: generatedGuardrails,
  };
  // Runtime call prompt = company + script/workflow + guardrails. Purpose is authoring-only.
  const seededPersonaPrompt = defaultVoiceCampaignPersonaPrompt(
    agentName,
    dataset.companyName?.trim() || dataset.label || "the company",
    geminiVoiceGender(voice || agentName),
  );
  const compiled = compileVoiceCampaignScript({
    template,
    campaignName: resolvedCampaignName,
    firstMessage: generated.firstMessage,
    nodes: template.nodes,
    edges: template.edges,
    segment,
    purpose,
    dataset: {
      datasetId: dataset.id,
      label: dataset.label,
      companyName: dataset.companyName,
      entityName: dataset.entityName,
    },
    language,
    voice,
    voiceName: agentName,
    agentName,
    companyName: dataset.companyName,
    personaPrompt: seededPersonaPrompt,
    operatorScript,
    universalRoutes: generated.workflow.universalRoutes,
    guardrails: generatedGuardrails,
  });

  const campaign: VoiceCampaign = {
    id: campaignId,
    userId,
    name: resolvedCampaignName,
    datasetId,
    datasetLabel: dataset.label,
    companyName: dataset.companyName,
    entityName: dataset.entityName,
    segmentId: segment.id,
    segmentName: segment.name,
    purposeId: purpose.purposeId,
    purposeName: purpose.name,
    systemPrompt: compiled.systemPrompt,
    // Compiled server-side from the freshly generated workflow this same tick
    // — the runtime may trust it directly (see buildCampaignRuntimePrompt).
    systemPromptSource: "compiled",
    firstMessage: compiled.firstMessage,
    scriptReasoning: compiled.reasoning || generated.reasoning,
    editableScript: operatorScript,
    personaPrompt: seededPersonaPrompt,
    agentId: REALTIME_MODEL,
    voice,
    voiceName: agentName,
    voiceProvider: "gemini-live",
    language,
    languageExplicit: true,
    workflow: {
      templateId: template.id,
      templateTitle: template.title,
      nodes: template.nodes,
      edges: template.edges,
      universalRoutes: generated.workflow.universalRoutes,
    },
    generationRequestId,
    phoneNumbers,
    status: "draft",
    calls: [],
    createdAt: new Date().toISOString(),
    successDefinition: successDefinitionWithExperimentBaseline(successDefinition, experimentSplit),
    experimentSplit,
  };

  saveCampaign(campaign);
  onBuildEvent?.({
    type: "narrative",
    id: "save-complete",
    content: generated.generation.completion,
  });
  return {
    campaign,
    template,
    generationSummary: generated.generation.completion,
    diagnostics: ledger.diagnostics,
  };
}
