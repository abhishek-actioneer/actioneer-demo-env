import {
  type VoiceCampaignTemplate,
  type VoiceFlowEdge,
  type VoiceFlowNode,
  type VoiceFlowNodeKind,
  type VoiceUniversalRoute,
} from "@/lib/voice-campaign-flow";
import type { CampaignDiagnostic } from "@/lib/voice-diagnostics";
import { layoutVoiceWorkflow } from "@/lib/voice-campaign-layout";
import type {
  VoiceCallOutcome,
  VoiceCallProvider,
  VoiceCampaign,
  VoiceCampaignExperimentSplit,
  VoiceCampaignSuccessBaselineSource,
  VoiceCampaignSuccessCallOutcome,
  VoiceCampaignSuccessDefinition,
  VoiceCampaignSuccessMetric,
  VoiceCampaignSuccessMetricType,
} from "@/lib/voice-campaign-types";
import {
  defaultVoiceCampaignSuccessDefinition,
} from "@/lib/voice-campaign-success";
import {
  defaultVoiceCampaignExperimentSplit,
  successDefinitionWithExperimentBaseline,
} from "@/lib/voice-campaign-experiment";
import type { Segment } from "@/lib/types";
import type { Purpose } from "@/lib/purpose-types";
import type {
  VoiceCampaignStudioTab,
  VoiceCallLogFilter,
} from "@/components/voice-campaigns/voice-campaign-studio";
import { CALL_PROVIDER_OPTIONS, MODEL_OPTIONS } from "@/features/integrations/catalog";
export { CALL_PROVIDER_OPTIONS, MODEL_OPTIONS };

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_CAMPAIGN_LANGUAGE = "Hinglish";
export const LEGACY_DEFAULT_LANGUAGE = "Hindi";

/** Max characters for operator editableScript (save + rewrite APIs). */
export const VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS = 2_000_000;

export const TEST_NUMBERS_KEY = "voice-campaign-test-numbers";
export const HOLD_TO_LAUNCH_MS = 3000;

export const VOICE_CALL_OUTCOMES: VoiceCallOutcome[] = [
  "positive",
  "neutral",
  "negative",
  "busy",
  "wrong_number",
  "no_answer",
  "failed",
  "unknown",
];

export const SUCCESS_METRIC_TYPES: Array<{ id: VoiceCampaignSuccessMetricType; label: string }> = [
  { id: "call_outcome", label: "Call outcome" },
  { id: "dataset_event", label: "Dataset event" },
  { id: "sql", label: "SQL condition" },
];

export const SUCCESS_CALL_OUTCOMES: Array<{ id: VoiceCampaignSuccessCallOutcome; label: string }> = [
  { id: "positive", label: "Positive response" },
  { id: "callback_scheduled", label: "Callback scheduled" },
  { id: "neutral", label: "Neutral response" },
  { id: "negative", label: "Negative response" },
  { id: "busy", label: "Busy / call later" },
  { id: "wrong_number", label: "Wrong number" },
  { id: "no_answer", label: "No answer" },
  { id: "failed", label: "Failed call" },
  { id: "unknown", label: "Unknown" },
];

export const SUCCESS_BASELINE_SOURCES: Array<{ id: VoiceCampaignSuccessBaselineSource; label: string }> = [
  { id: "unavailable", label: "No baseline yet" },
  { id: "manual", label: "Manual baseline" },
  { id: "historical_crm", label: "Historical CRM" },
  { id: "dataset_average", label: "Dataset average" },
  { id: "previous_campaign", label: "Previous campaign" },
  { id: "holdout", label: "Holdout group" },
];

export type SuccessPresetId = "positive_response" | "callback_scheduled" | "kyc_completed" | "custom";

export interface SuccessPreset {
  id: SuccessPresetId;
  title: string;
  description: string;
  primary?: VoiceCampaignSuccessMetric;
  secondary?: VoiceCampaignSuccessMetric[];
  attributionWindowDays?: number;
}

export const SUCCESS_PRESETS: SuccessPreset[] = [
  {
    id: "positive_response",
    title: "Positive response",
    description: "A user says yes or shows clear interest on the call.",
    attributionWindowDays: 7,
    primary: {
      id: "primary-positive-response",
      label: "Positive response",
      type: "call_outcome",
      outcome: "positive",
      windowDays: 0,
      description: "Customer showed clear interest or consented to the next step during the call.",
    },
    secondary: [
      {
        id: "secondary-callback-scheduled",
        label: "Callback scheduled",
        type: "call_outcome",
        outcome: "callback_scheduled",
        windowDays: 0,
        description: "Advisor, support, or expert follow-up was requested or scheduled.",
      },
    ],
  },
  {
    id: "callback_scheduled",
    title: "Callback scheduled",
    description: "A user asks for, accepts, or books a follow-up.",
    attributionWindowDays: 7,
    primary: {
      id: "primary-callback-scheduled",
      label: "Callback scheduled",
      type: "call_outcome",
      outcome: "callback_scheduled",
      windowDays: 0,
      description: "Advisor, support, or expert follow-up was requested or scheduled.",
    },
    secondary: [
      {
        id: "secondary-positive-response",
        label: "Positive response",
        type: "call_outcome",
        outcome: "positive",
        windowDays: 0,
        description: "Customer showed clear interest or consented to the next step during the call.",
      },
    ],
  },
  {
    id: "kyc_completed",
    title: "KYC completed",
    description: "A user completes KYC after the campaign.",
    attributionWindowDays: 7,
    primary: {
      id: "primary-kyc-completed",
      label: "KYC completed",
      type: "dataset_event",
      eventName: "kyc_completed",
      windowDays: 7,
      description: "Customer completed KYC after receiving the campaign.",
    },
    secondary: [
      {
        id: "secondary-callback-scheduled",
        label: "Callback scheduled",
        type: "call_outcome",
        outcome: "callback_scheduled",
        windowDays: 0,
        description: "Advisor, support, or expert follow-up was requested or scheduled.",
      },
    ],
  },
  {
    id: "custom",
    title: "Custom",
    description: "Use an event, SQL condition, or custom outcome.",
  },
];

export const SUCCESS_WINDOW_OPTIONS = [
  { days: 0, label: "Same call" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

export const EXPERIMENT_PRESETS = [
  { testPercent: 80, title: "Recommended", description: "Call 80%, hold back 20% for lift." },
  { testPercent: 90, title: "Small holdout", description: "Call 90%, hold back 10%." },
  { testPercent: 50, title: "Even split", description: "Call 50%, hold back 50%." },
];

export const DEFAULT_CUSTOM_OFFER = {
  name: "",
  category: "campaign",
  tagline: "",
  description: "",
  valueProp: "",
  priceDisplay: "Details confirmed by the team",
  cta: "Say yes and the team will call back with details",
};

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface GeneratedCampaignDraft {
  campaignName: string;
  firstMessage: string;
  reasoning: string;
  workflow: {
    title: string;
    description: string;
    objective: string;
    audienceHint: string;
    nodes: Array<{
      id: string;
      kind: VoiceFlowNodeKind;
      title: string;
      body: string;
      helper: string | null;
      /** Stamped server-side after parsing — never part of the LLM schema. */
      provenance?: "verbatim" | "generated" | "operator";
    }>;
    edges: Array<{
      source: string;
      target: string;
      label: string | null;
    }>;
    universalRoutes?: VoiceUniversalRoute[];
  };
  /** Archetype the generate-script route matched, when it reports one. */
  archetypeId?: string | null;
  /** Fact-ledger / intake diagnostics reported by the generation route. */
  diagnostics?: CampaignDiagnostic[];
}

/**
 * `VoiceCampaignTemplate` has no universalRoutes slot, so drafts built from an
 * import or generation carry their routes as an extra property on the template
 * object. It rides through every `{ ...template }` spread and is naturally
 * cleared when a different template replaces the draft.
 */
export interface VoiceCampaignTemplateWithRoutes extends VoiceCampaignTemplate {
  universalRoutes?: VoiceUniversalRoute[];
}

export interface VoicePurposeSuggestion {
  type: "existing" | "custom";
  purposeId: string | null;
  title: string;
  reason: string;
  campaignBrief: string;
  purpose: Purpose | null;
}

export interface VoiceScriptOption {
  title: string;
  description: string;
  campaignBrief: string;
  templateId: string | null;
}

// ─── Script types ─────────────────────────────────────────────────────────────

export interface ConversationScriptLine {
  kind: "say" | "note" | "route" | "text";
  label?: string;
  text: string;
}

export interface ConversationScriptSection {
  number?: string;
  title: string;
  lines: ConversationScriptLine[];
}

// ─── Pure functions ───────────────────────────────────────────────────────────

export function studioTabFromParam(value: string | null): VoiceCampaignStudioTab | null {
  if (value === "performance") return "overview";
  if (value === "responses") return "voice-analysis";
  if (value === "prompts") return "script";
  const tabs: VoiceCampaignStudioTab[] = ["script", "workflow", "overview", "call-logs", "voice-analysis", "guardrails", "success-metrics", "connections"];
  return tabs.some((tab) => tab === value) ? value as VoiceCampaignStudioTab : null;
}

export function voiceOutcomeFromParam(value: string | null): VoiceCallOutcome | null {
  return VOICE_CALL_OUTCOMES.some((outcome) => outcome === value) ? value as VoiceCallOutcome : null;
}

export function callLogFilterFromParams(
  kind: string | null,
  outcome: string | null,
  scriptCheck: string | null,
  minSecondsParam: string | null,
): VoiceCallLogFilter | null {
  if (kind === "outcome") {
    const parsedOutcome = voiceOutcomeFromParam(outcome);
    return parsedOutcome ? { kind: "outcome", outcome: parsedOutcome } : null;
  }

  if (kind === "script-check") {
    const check = scriptCheck?.trim();
    if (check && /^[a-z0-9_-]{1,64}$/.test(check)) {
      return { kind: "script-check", check };
    }
  }

  if (kind === "latency") {
    return { kind: "latency" };
  }

  if (kind === "retention") {
    const minSeconds = Number(minSecondsParam);
    if (Number.isFinite(minSeconds) && minSeconds >= 0 && minSeconds <= 3600) {
      return { kind: "retention", minSeconds: Math.round(minSeconds) };
    }
    return { kind: "retention", minSeconds: 20 };
  }

  return null;
}

export function normalizeSelectedLanguage(value?: string | null): string {
  const language = value?.trim();
  if (!language) return DEFAULT_CAMPAIGN_LANGUAGE;
  return language;
}

export function campaignLanguageForUi(campaign: Pick<VoiceCampaign, "language" | "languageExplicit">): string {
  const language = normalizeSelectedLanguage(campaign.language);
  return language.toLowerCase() === LEGACY_DEFAULT_LANGUAGE.toLowerCase() && !campaign.languageExplicit
    ? DEFAULT_CAMPAIGN_LANGUAGE
    : language;
}

export function defaultOpeningLineForLanguage(
  language: string,
  options?: { agentName?: string; companyName?: string },
): string {
  const agentName = options?.agentName?.trim() || "Ananya";
  const companyName = options?.companyName?.trim() || "the team";
  const normalized = language.trim().toLowerCase();

  if (normalized === "english") {
    return `Hello, this is ${agentName} calling from ${companyName}. Is this a good time for a quick conversation?`;
  }
  if (normalized === "hindi") {
    return `नमस्ते, मैं ${agentName} ${companyName} से बोल रही हूँ। क्या अभी एक मिनट बात हो पाएगी?`;
  }
  if (normalized === "telugu") {
    return `నమస్కారం, నేను ${agentName} ${companyName} నుంచి మాట్లాడుతున్నా. ఇప్పుడు ఒక నిమిషం మాట్లాడొచ్చా?`;
  }
  if (normalized === "kannada") {
    return `ನಮಸ್ಕಾರ, ನಾನು ${agentName} ${companyName} ಇಂದ ಮಾತಾಡ್ತಾ ಇದೀನಿ. ಈಗ ಒಂದು ನಿಮಿಷ ಮಾತಾಡಬಹುದಾ?`;
  }
  if (normalized === "odia") {
    return `ନମସ୍କାର, ମୁଁ ${agentName} ${companyName} ରୁ କହୁଛି। ଏବେ ଗୋଟେ ମିନିଟ କଥା ହେବ କି?`;
  }
  if (normalized === "tamil") {
    return `வணக்கம், நான் ${agentName}, ${companyName}ல் இருந்து பேசுறேன். இப்ப ஒரு நிமிஷம் பேசலாமா?`;
  }
  return `Namaste, main ${agentName} bol rahi hoon ${companyName} se. Ek minute baat ho payegi?`;
}

function normalizeComparableLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export {
  extractOpeningLineFromScript,
  extractOpeningLineFromWorkflow,
  resolveCampaignCanonicalOpening,
} from "@/lib/voice-campaign-opening";

export function isSystemGeneratedOpeningLine(
  firstMessage: string,
  language: string,
  options?: { agentName?: string; companyName?: string },
): boolean {
  const normalized = normalizeComparableLine(firstMessage);
  if (!normalized) return true;

  const agentName = options?.agentName?.trim() || "Ananya";
  const companyName = options?.companyName?.trim() || "the team";
  const known = new Set<string>([
    normalizeComparableLine(defaultOpeningLineForLanguage(language, { agentName, companyName })),
    normalizeComparableLine(defaultOpeningLineForLanguage(language, { agentName: "Ananya", companyName })),
    normalizeComparableLine(defaultOpeningLineForLanguage(language, { agentName, companyName: "the team" })),
    normalizeComparableLine(defaultOpeningLineForLanguage(language, { agentName: "Ananya", companyName: "the team" })),
    normalizeComparableLine("Namaste, team se call kar rahi hoon. Ek minute baat ho payegi?"),
    normalizeComparableLine("Hello, this is a quick call from the team. Is this a good time?"),
    normalizeComparableLine("Namaste, calling from the team. Ek minute baat ho payegi?"),
    normalizeComparableLine(`Namaste, ${companyName} se call kar rahi hoon. Ek minute baat ho payegi?`),
    normalizeComparableLine(`Namaste, main ${agentName} bol rahi hoon ${companyName} se. Ek minute baat ho payegi?`),
  ]);

  if (known.has(normalized)) return true;

  return false;
}

export function containsDevanagari(value: string): boolean {
  return /[ऀ-ॿ]/.test(value);
}

export function autoRewriteScriptKey(campaignId: string | undefined, script: string): string {
  const normalized = normalizeScriptForComparison(script);
  return `${campaignId ?? "draft"}:${normalized.length}:${normalized.slice(0, 500)}`;
}

export function withDataset(path: string, datasetId: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}datasetId=${encodeURIComponent(datasetId)}`;
}

export function isSafeDatasetId(value: string | null): value is string {
  return Boolean(value && /^[a-z0-9_-]+$/.test(value) && value.length <= 64);
}

export function callProviderLabel(provider: VoiceCallProvider): string {
  return CALL_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ?? "Gemini";
}

export function normalizeIndianNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]/.test(digits[2])) return `+${digits}`;
  return raw.trim();
}

export function parsePhoneNumbers(raw: string): string[] {
  return raw.split(/[\n,]/).map((s) => normalizeIndianNumber(s.trim())).filter(Boolean);
}

export function campaignPurposeFallback(campaign: VoiceCampaign | null): Purpose | null {
  if (!campaign) return null;
  return {
    purposeId: campaign.purposeId,
    sku: campaign.purposeId,
    name: campaign.purposeName,
    category: "campaign-purpose",
    tagline: campaign.purposeName,
    description: campaign.purposeName,
    valueProp: campaign.purposeName,
    priceDisplay: "No product pricing",
    cta: "Say yes and the team will follow up",
  };
}

export function campaignSegmentFallback(campaign: VoiceCampaign | null): Segment | null {
  if (!campaign) return null;
  return {
    id: campaign.segmentId,
    name: campaign.segmentName,
    sql: "",
    description: campaign.segmentName,
    userCount: campaign.phoneNumbers.length,
    createdAt: campaign.createdAt,
    pushStatus: {},
  };
}

export function loadTestNumbers(): string[] {
  try { return JSON.parse(localStorage.getItem(TEST_NUMBERS_KEY) ?? "[]") as string[]; }
  catch { return []; }
}

export function saveTestNumbers(numbers: string[]): void {
  localStorage.setItem(TEST_NUMBERS_KEY, JSON.stringify(numbers));
}

export function baselineRateInputValue(definition: VoiceCampaignSuccessDefinition): string {
  const rate = definition.baseline.rate;
  if (rate === undefined || !Number.isFinite(rate)) return "";
  const percent = rate * 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function parseBaselineRatePercent(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const percent = Number(value);
  if (!Number.isFinite(percent)) return undefined;
  return Math.max(0, Math.min(100, percent)) / 100;
}

export function secondarySuccessMetric(definition: VoiceCampaignSuccessDefinition): VoiceCampaignSuccessMetric {
  return definition.secondary[0] ?? defaultVoiceCampaignSuccessDefinition().secondary[0];
}

export function successPresetId(definition: VoiceCampaignSuccessDefinition): SuccessPresetId {
  const primary = definition.primary;
  if (primary.type === "call_outcome" && primary.outcome === "positive") return "positive_response";
  if (primary.type === "call_outcome" && primary.outcome === "callback_scheduled") return "callback_scheduled";
  if (primary.type === "dataset_event" && primary.eventName === "kyc_completed") return "kyc_completed";
  return "custom";
}

export function applySuccessPreset(
  definition: VoiceCampaignSuccessDefinition,
  presetId: SuccessPresetId,
): VoiceCampaignSuccessDefinition {
  const preset = SUCCESS_PRESETS.find((item) => item.id === presetId);
  if (!preset?.primary) return definition;
  return {
    ...definition,
    primary: { ...preset.primary },
    secondary: preset.secondary?.map((metric) => ({ ...metric })) ?? definition.secondary,
    attributionWindowDays: preset.attributionWindowDays ?? definition.attributionWindowDays,
  };
}

export function successMetricTrackingLabel(metric: VoiceCampaignSuccessMetric): string {
  if (metric.type === "call_outcome") {
    return SUCCESS_CALL_OUTCOMES.find((option) => option.id === metric.outcome)?.label ?? "Call outcome";
  }
  if (metric.type === "dataset_event") return metric.eventName ? `Event: ${metric.eventName}` : "Dataset event";
  if (metric.type === "sql") return "SQL condition";
  return "Tracked outcome";
}

export function successWindowLabel(days: number): string {
  if (days <= 0) return "Same call";
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function successBaselineDescription(
  definition: VoiceCampaignSuccessDefinition,
  split?: VoiceCampaignExperimentSplit,
): string {
  const measuredDefinition = successDefinitionWithExperimentBaseline(
    definition,
    split ?? defaultVoiceCampaignExperimentSplit(false),
  );
  if (split?.enabled) {
    return `${split.controlPercent}% control holdout. Lift is calculated automatically after launch.`;
  }
  if (measuredDefinition.baseline.rate !== undefined) {
    return `${Math.round(measuredDefinition.baseline.rate * 100)}% ${measuredDefinition.baseline.label ?? "baseline"}`;
  }
  const sourceLabel = SUCCESS_BASELINE_SOURCES.find((source) => source.id === measuredDefinition.baseline.source)?.label;
  if (measuredDefinition.baseline.source !== "unavailable" && sourceLabel) return sourceLabel;
  return "No baseline yet. Track success rate first, then add a baseline later.";
}

export function generatedWorkflowToTemplate(
  draft: GeneratedCampaignDraft,
  selectedSegment: Segment,
): VoiceCampaignTemplateWithRoutes {
  const nodes: VoiceFlowNode[] = draft.workflow.nodes.map((node, index) => ({
    id: node.id,
    type: "voiceNode",
    position: { x: 0, y: index * 170 },
    data: {
      kind: node.kind,
      title: node.title,
      body: node.body,
      helper: node.helper ?? undefined,
      required: node.kind === "start" || node.kind === "end",
      ...(node.provenance ? { provenance: node.provenance } : {}),
    },
  }));

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: VoiceFlowEdge[] = draft.workflow.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      id: `e-${edge.source}-${edge.target}-${edge.label ?? "next"}`.replace(/\s+/g, "-").toLowerCase(),
      source: edge.source,
      target: edge.target,
      label: edge.label ?? undefined,
      type: "smoothstep",
    }));

  const layoutNodes = layoutVoiceWorkflow(nodes, edges);

  return {
    id: `generated-${Date.now()}`,
    title: draft.workflow.title || "Generated Workflow",
    description: draft.workflow.description || "Generated from campaign brief",
    objective: draft.workflow.objective || draft.reasoning,
    audienceHint: draft.workflow.audienceHint || selectedSegment.name,
    defaultCampaignName: draft.campaignName || "Generated voice campaign",
    firstMessage: draft.firstMessage,
    nodes: layoutNodes,
    edges,
    ...(draft.workflow.universalRoutes?.length
      ? { universalRoutes: draft.workflow.universalRoutes }
      : {}),
  };
}

export function buildEditableCallScript({
  nodes,
  edges,
}: {
  nodes: VoiceFlowNode[];
  edges: VoiceFlowEdge[];
}): string {
  // Node-array order is the authored script order. Canvas layout is visual
  // only: branching layouts legitimately move later steps above earlier ones,
  // and sorting by y silently rewrote B1..B17 into B8,B1,B2... in the Script tab.
  const orderedNodes = nodes;
  const sections = [
    "Conversation script:",
    ...orderedNodes.flatMap((node, index) => [
      "",
      `${index + 1}. ${node.data.title}`,
      node.data.body.trim() || "(Write what the agent should say or do at this step.)",
      node.data.helper ? `Note: ${node.data.helper}` : "",
    ]).filter((line) => line !== ""),
  ];

  const routeLines = edges
    .map((edge) => {
      const source = nodes.find((node) => node.id === edge.source)?.data.title ?? edge.source;
      const target = nodes.find((node) => node.id === edge.target)?.data.title ?? edge.target;
      const label = typeof edge.label === "string" && edge.label.trim() ? ` when ${edge.label}` : "";
      return `- ${source} -> ${target}${label}`;
    });

  if (routeLines.length > 0) {
    sections.push("", "Routing notes:", ...routeLines);
  }

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Content fingerprint used to detect workflow talk-track changes (ignores node x/y alone). */
export function workflowScriptFingerprint(
  nodes: VoiceFlowNode[],
  edges: VoiceFlowEdge[],
): string {
  return normalizeScriptForComparison(buildEditableCallScript({ nodes, edges }));
}

export function looksLikeStepScript(scriptText: string): boolean {
  return /^\s*STEP\s+\d+/im.test(scriptText);
}

export function looksLikeCanonicalScript(scriptText: string): boolean {
  const trimmed = scriptText.trim();
  return /^conversation script\s*:?/i.test(trimmed) || /^\d+\.\s+\S+/m.test(trimmed);
}

interface ParsedScriptStep {
  title: string;
  body: string;
  helper?: string;
}

/** Parse STEP N — Title blocks (PD-style operator scripts). */
export function parseStepScriptSections(scriptText: string): ParsedScriptStep[] {
  const lines = scriptText.split(/\r?\n/);
  const steps: ParsedScriptStep[] = [];
  let current: ParsedScriptStep | null = null;
  const bodyLines: string[] = [];
  let helper: string | undefined;

  function flush() {
    if (!current) return;
    const body = bodyLines.join("\n").trim();
    steps.push({
      title: current.title,
      body: body || "(Write what the agent should say or do at this step.)",
      helper,
    });
    current = null;
    bodyLines.length = 0;
    helper = undefined;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const stepHeader = line.match(/^\s*STEP\s+(\d+)\s*[—:\-–]\s*(.+)$/i);
    if (stepHeader) {
      flush();
      current = { title: stepHeader[2].trim(), body: "" };
      continue;
    }
    // Routing / FAQ banks after steps are not part of a node body.
    if (/^\s*Routing notes\s*:?\s*$/i.test(line)) {
      flush();
      break;
    }
    if (/^\s*FAQ\b/i.test(line) || /^\s*SEGMENT\s+\d+/i.test(line)) {
      flush();
      break;
    }
    if (!current) continue;
    const note = line.trim().match(/^(note|notes|ध्यान दें)\s*:\s*(.+)$/i);
    if (note) {
      helper = note[2].trim();
      continue;
    }
    bodyLines.push(line);
  }
  flush();
  return steps;
}

function sectionLinesToBody(section: ConversationScriptSection): { body: string; helper?: string } {
  const bodyParts: string[] = [];
  let helper: string | undefined;
  for (const line of section.lines) {
    if (line.kind === "note") {
      helper = line.text.trim();
      continue;
    }
    if (line.kind === "route") continue;
    if (line.kind === "say") {
      bodyParts.push(`Say: ${line.text}`);
      continue;
    }
    bodyParts.push(line.text);
  }
  return {
    body: bodyParts.join("\n").trim() || "(Write what the agent should say or do at this step.)",
    helper,
  };
}

function findNodeIdByTitle(nodes: VoiceFlowNode[], title: string): string | undefined {
  const needle = title.trim().toLowerCase();
  if (!needle) return undefined;
  const exact = nodes.find((node) => node.data.title.trim().toLowerCase() === needle);
  if (exact) return exact.id;
  const partial = nodes.find((node) => {
    const t = node.data.title.trim().toLowerCase();
    return t.includes(needle) || needle.includes(t);
  });
  return partial?.id;
}

function applyRoutingNotesToEdges(
  routeLines: string[],
  nodes: VoiceFlowNode[],
  previousEdges: VoiceFlowEdge[],
): VoiceFlowEdge[] {
  const next: VoiceFlowEdge[] = [];
  for (const raw of routeLines) {
    const line = raw.replace(/^\s*-\s*/, "").trim();
    const match = line.match(/^(.+?)\s*->\s*(.+?)(?:\s+when\s+(.+))?$/i);
    if (!match) continue;
    const sourceId = findNodeIdByTitle(nodes, match[1]);
    const targetId = findNodeIdByTitle(nodes, match[2]);
    if (!sourceId || !targetId) continue;
    const label = match[3]?.trim();
    const prev = previousEdges.find((e) => e.source === sourceId && e.target === targetId);
    next.push({
      id: prev?.id ?? `e-${sourceId}-${targetId}-${label ?? "next"}`.replace(/\s+/g, "-").toLowerCase(),
      source: sourceId,
      target: targetId,
      label: label || prev?.label || undefined,
      type: "smoothstep",
    });
  }
  return next.length > 0 ? next : previousEdges;
}

/**
 * Push Script-tab text into workflow nodes/edges.
 * Supports canonical numbered scripts and PD-style STEP scripts.
 */
export function applyScriptToWorkflow(
  scriptText: string,
  nodes: VoiceFlowNode[],
  edges: VoiceFlowEdge[],
): { nodes: VoiceFlowNode[]; edges: VoiceFlowEdge[] } {
  const trimmed = scriptText.trim();
  if (!trimmed || nodes.length === 0) return { nodes, edges };

  const ordered = nodes;
  const stepSections = parseStepScriptSections(trimmed);
  const parsed = parseConversationScript(trimmed);
  const numberedSections = parsed.filter(
    (section) => section.title !== "Routing notes" && Boolean(section.number),
  );

  const steps: ParsedScriptStep[] = stepSections.length > 0
    ? stepSections
    : numberedSections.map((section) => {
        const { body, helper } = sectionLinesToBody(section);
        return { title: section.title, body, helper };
      });

  // Freeform blob with no STEP/numbered sections: keep structure, put full script on start node.
  if (steps.length === 0) {
    const start = ordered.find((node) => node.data.kind === "start") ?? ordered[0];
    if (!start) return { nodes, edges };
    return {
      nodes: nodes.map((node) =>
        node.id === start.id
          ? { ...node, data: { ...node.data, body: trimmed } }
          : node,
      ),
      edges,
    };
  }

  let nextNodes = nodes.map((node) => {
    const index = ordered.findIndex((item) => item.id === node.id);
    if (index < 0 || index >= steps.length) return node;
    const step = steps[index]!;
    // Positional rebuild keeps each node's provenance while the parsed body is
    // unchanged; a changed body is an operator edit made in the Script tab.
    const bodyChanged =
      normalizeScriptForComparison(step.body) !== normalizeScriptForComparison(node.data.body);
    return {
      ...node,
      data: {
        ...node.data,
        title: step.title || node.data.title,
        body: step.body,
        helper: step.helper ?? node.data.helper,
        ...(bodyChanged ? { provenance: "operator" as const } : {}),
      },
    };
  });

  if (steps.length > ordered.length) {
    const lastY = ordered[ordered.length - 1]?.position.y ?? 0;
    const extras: VoiceFlowNode[] = [];
    for (let i = ordered.length; i < steps.length; i++) {
      const step = steps[i]!;
      extras.push({
        id: `script-step-${Date.now()}-${i}`,
        type: "voiceNode",
        position: { x: ordered[0]?.position.x ?? 0, y: lastY + (i - ordered.length + 1) * 170 },
        data: {
          kind: i === steps.length - 1 ? "end" : "prompt",
          title: step.title,
          body: step.body,
          helper: step.helper,
          required: false,
          // A step that exists only in Script-tab text was typed by the operator.
          provenance: "operator",
        },
      });
    }
    nextNodes = layoutVoiceWorkflow([...nextNodes, ...extras], edges);
  }

  const routeSection = parsed.find((section) => section.title === "Routing notes");
  const routeLines = routeSection
    ? routeSection.lines.filter((line) => line.kind === "route").map((line) => line.text)
    : [];
  const nextEdges = routeLines.length > 0
    ? applyRoutingNotesToEdges(routeLines, nextNodes, edges)
    : edges;

  return { nodes: nextNodes, edges: nextEdges };
}

/** Rebuild Script-tab text from workflow, preserving STEP style when the current script uses it. */
export function applyWorkflowToScript(
  currentScript: string,
  nodes: VoiceFlowNode[],
  edges: VoiceFlowEdge[],
): string {
  if (nodes.length === 0) return currentScript;
  if (looksLikeStepScript(currentScript)) {
    return buildStepCallScript({ nodes, edges });
  }
  return buildEditableCallScript({ nodes, edges });
}

export function buildStepCallScript({
  nodes,
  edges,
}: {
  nodes: VoiceFlowNode[];
  edges: VoiceFlowEdge[];
}): string {
  const orderedNodes = nodes;
  const parts = orderedNodes.flatMap((node, index) => {
    const block = [
      `STEP ${index + 1} — ${node.data.title}`,
      "",
      node.data.body.trim() || "(Write what the agent should say or do at this step.)",
    ];
    if (node.data.helper?.trim()) {
      block.push("", `Note: ${node.data.helper.trim()}`);
    }
    return index === 0 ? block : ["", ...block];
  });

  const routeLines = edges.map((edge) => {
    const source = nodes.find((node) => node.id === edge.source)?.data.title ?? edge.source;
    const target = nodes.find((node) => node.id === edge.target)?.data.title ?? edge.target;
    const label = typeof edge.label === "string" && edge.label.trim() ? ` when ${edge.label}` : "";
    return `- ${source} -> ${target}${label}`;
  });
  if (routeLines.length > 0) {
    parts.push("", "Routing notes:", ...routeLines);
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** True when script text and workflow talk-track describe the same content. */
export function areScriptAndWorkflowInSync(
  scriptText: string,
  nodes: VoiceFlowNode[],
  edges: VoiceFlowEdge[],
): boolean {
  if (!scriptText.trim() || nodes.length === 0) return !scriptText.trim() && nodes.length === 0;
  const applied = applyScriptToWorkflow(scriptText, nodes, edges);
  return workflowScriptFingerprint(applied.nodes, applied.edges) ===
    workflowScriptFingerprint(nodes, edges);
}

/**
 * Synthesize a workflow from script text alone, for campaigns saved without one
 * (script-first live tests, pre-workflow records). Returns null when the script
 * has no parseable step structure — callers should leave the workflow empty.
 */
export function bootstrapWorkflowFromScript(
  scriptText: string,
): { nodes: VoiceFlowNode[]; edges: VoiceFlowEdge[] } | null {
  const trimmed = scriptText.trim();
  if (!trimmed) return null;

  const stepSections = parseStepScriptSections(trimmed);
  const parsed = parseConversationScript(trimmed);
  const numberedSections = parsed.filter(
    (section) => section.title !== "Routing notes" && Boolean(section.number),
  );
  const steps: ParsedScriptStep[] = stepSections.length > 0
    ? stepSections
    : numberedSections.map((section) => {
        const { body, helper } = sectionLinesToBody(section);
        return { title: section.title, body, helper };
      });
  if (steps.length === 0) return null;

  const nodes: VoiceFlowNode[] = steps.map((step, index) => ({
    id: index === 0 ? "start" : `script-step-${index + 1}`,
    type: "voiceNode",
    position: { x: 0, y: index * 170 },
    data: {
      kind: index === 0 ? "start" : index === steps.length - 1 ? "end" : "prompt",
      title: step.title,
      body: step.body,
      helper: step.helper,
      required: false,
    },
  }));

  const linearEdges: VoiceFlowEdge[] = nodes.slice(0, -1).map((node, index) => ({
    id: `e-${node.id}-${nodes[index + 1]!.id}`,
    source: node.id,
    target: nodes[index + 1]!.id,
    type: "smoothstep",
  }));

  const routeSection = parsed.find((section) => section.title === "Routing notes");
  const routeLines = routeSection
    ? routeSection.lines.filter((line) => line.kind === "route").map((line) => line.text)
    : [];
  const edges = routeLines.length > 0
    ? applyRoutingNotesToEdges(routeLines, nodes, linearEdges)
    : linearEdges;

  return { nodes: layoutVoiceWorkflow(nodes, edges), edges };
}

export function templateWithCallScript(
  template: VoiceCampaignTemplate,
  scriptText: string,
): VoiceCampaignTemplate {
  const script = scriptText.trim();
  if (!script) return template;
  return {
    ...template,
    objective: `${template.objective}

Private operator-edited call plan. This is not spoken copy:
${script}

Use this only to decide the next response. Never read routing instructions, node names, helper notes, "Signal सुनें", "node पर जाएँ", or similar operator text aloud. If a line contains a quoted customer-facing phrase after "Say:" or "कहें:", only that quoted phrase may be spoken when it fits the conversation.`,
  };
}

export function normalizeScriptForComparison(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseConversationScript(scriptText: string): ConversationScriptSection[] {
  const sections: ConversationScriptSection[] = [];
  let current: ConversationScriptSection | null = null;

  function ensureSection(title = "Script notes"): ConversationScriptSection {
    if (!current) {
      current = { title, lines: [] };
      sections.push(current);
    }
    return current;
  }

  for (const rawLine of scriptText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^conversation script\s*:?$/i.test(line)) continue;

    const numbered = line.match(/^(\d+)\.\s+(.+)$/);
    if (numbered) {
      current = { number: numbered[1], title: numbered[2], lines: [] };
      sections.push(current);
      continue;
    }

    if (/^routing notes\s*:?$/i.test(line)) {
      current = { title: "Routing notes", lines: [] };
      sections.push(current);
      continue;
    }

    const target = ensureSection();
    const say = line.match(/^(कहें|करें|say|agent says|agent|bot)\s*:\s*(.+)$/i);
    if (say) {
      target.lines.push({ kind: "say", label: say[1], text: say[2] });
      continue;
    }

    const note = line.match(/^(note|notes|ध्यान दें)\s*:\s*(.+)$/i);
    if (note) {
      target.lines.push({ kind: "note", label: note[1], text: note[2] });
      continue;
    }

    if (line.startsWith("- ")) {
      target.lines.push({ kind: "route", text: line.slice(2) });
      continue;
    }

    target.lines.push({ kind: "text", text: line });
  }

  return sections;
}

export function serializeConversationScript(sections: ConversationScriptSection[]): string {
  const lines = ["Conversation script:"];

  sections.forEach((section, sectionIndex) => {
    lines.push("");
    if (section.title === "Routing notes" && !section.number) {
      lines.push("Routing notes:");
    } else {
      lines.push(`${section.number ?? sectionIndex + 1}. ${section.title}`);
    }

    section.lines.forEach((line) => {
      if (line.kind === "say") {
        lines.push(`Say: ${line.text}`);
        return;
      }
      if (line.kind === "note") {
        lines.push(`Note: ${line.text}`);
        return;
      }
      if (line.kind === "route") {
        lines.push(`- ${line.text}`);
        return;
      }
      lines.push(line.text);
    });
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function scriptTextareaRows(text: string, minRows = 1): number {
  const explicitLines = text.split(/\r?\n/).length;
  const wrappedLines = Math.ceil(text.length / 92);
  return Math.max(minRows, explicitLines, Math.min(6, wrappedLines));
}

export function templateWithEditedCallScript(
  template: VoiceCampaignTemplate,
  scriptText: string,
  nodes: VoiceFlowNode[],
  edges: VoiceFlowEdge[],
): VoiceCampaignTemplate {
  // Always prefer live studio nodes/edges — draft.template can lag behind inspector edits.
  const withLiveFlow: VoiceCampaignTemplate = { ...template, nodes, edges };
  const current = normalizeScriptForComparison(scriptText);
  if (!current) return withLiveFlow;
  const generated = normalizeScriptForComparison(buildEditableCallScript({ nodes, edges }));
  return current === generated ? withLiveFlow : templateWithCallScript(withLiveFlow, scriptText);
}
