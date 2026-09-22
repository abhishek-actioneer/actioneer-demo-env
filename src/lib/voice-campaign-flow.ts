import type { Edge, Node } from "@xyflow/react";
import type { Purpose } from "@/lib/purpose-types";
import { DEFAULT_SARVAM_SPEAKER, sarvamSpeakerLabel } from "@/lib/sarvam-voices";
import { geminiVoiceDisplayName, geminiVoiceGender } from "@/lib/gemini-voices";
import type { Segment } from "@/lib/types";
import type { VoiceCampaignSuccessDefinition } from "@/lib/voice-campaign-types";
import { findLinkSuccessMetric } from "@/lib/voice-campaign-success";
import { extractOpeningLineFromWorkflow } from "@/lib/voice-campaign-opening";

const LINK_TOOL_MARKER = "SEND_LINK TOOL";

export function appendLinkToolHintToSystemPrompt(
  systemPrompt: string,
  successDefinition?: VoiceCampaignSuccessDefinition,
): string {
  if (systemPrompt.includes(LINK_TOOL_MARKER)) return systemPrompt;
  const linkMetric = findLinkSuccessMetric(successDefinition);
  const purposeLine = linkMetric
    ? `The link is for: ${linkMetric.label || "the link"}${linkMetric.description ? ` (${linkMetric.description})` : ""}.`
    : "Use it whenever the customer asks for something in writing or it would help them to have it on WhatsApp.";
  return systemPrompt + `

[${LINK_TOOL_MARKER}]
You have a tool called send_link that instantly sends a message to the customer's WhatsApp during this call.
${purposeLine}
- Offer to send it when it fits naturally — e.g. when the customer shows interest, asks how to proceed, or asks for details in writing
- Call send_link the moment the customer agrees to receive it
- After a successful send, say something like: "Done — I've just sent it to your WhatsApp. Please check it when you're ready."
- If the tool returns sent=false, say: "I wasn't able to send it right now, but we can arrange it after the call."
- Never read out the URL itself`;
}

const FEMALE_AGENT_NAMES = ["Priya", "Neha", "Kavya", "Arushi", "Shreya", "Ritu"];
const MALE_AGENT_NAMES = ["Arjun", "Rahul", "Kabir", "Dev", "Rohan"];

export function defaultAgentName(voiceName: string | undefined): string {
  if (voiceName) {
    const displayName = geminiVoiceDisplayName(voiceName);
    if (displayName !== voiceName) return displayName;
  }
  const gender = geminiVoiceGender(voiceName ?? "");
  if (gender === "male") return MALE_AGENT_NAMES[0];
  return FEMALE_AGENT_NAMES[0];
}

export function normalizeAgentGenderedPhrases(
  text: string,
  gender: "female" | "male" | "unknown",
): string {
  if (gender === "unknown") return text;
  const replacements: Array<[RegExp, string]> = gender === "male"
    ? [
        [/समझी/g, "समझा"],
        [/कर रही हूँ/g, "कर रहा हूँ"],
        [/कर रही हूं/g, "कर रहा हूं"],
        [/कर दूँगी/g, "कर दूँगा"],
        [/कर दूंगी/g, "कर दूंगा"],
        [/करूँगी/g, "करूँगा"],
        [/करूंगी/g, "करूंगा"],
        [/\bsamjhi\b/gi, "samjha"],
        [/\bsamajhi\b/gi, "samajha"],
        [/\bkar rahi\b/gi, "kar raha"],
        [/\bkarti hoon\b/gi, "karta hoon"],
        [/\bkarti hu\b/gi, "karta hu"],
        [/\bcheck karti\b/gi, "check karta"],
        [/\bpoochh rahi\b/gi, "poochh raha"],
        [/\bpooch rahi\b/gi, "pooch raha"],
        [/\bdekh rahi\b/gi, "dekh raha"],
        [/\bsun rahi\b/gi, "sun raha"],
        [/\bbatati hoon\b/gi, "batata hoon"],
        [/\bbata rahi\b/gi, "bata raha"],
        [/\ble rahi\b/gi, "le raha"],
        [/\bleti hoon\b/gi, "leta hoon"],
        [/\bbol rahi\b/gi, "bol raha"],
        [/\brahi hoon\b/gi, "raha hoon"],
        [/\bkar rahi hoon\b/gi, "kar raha hoon"],
        [/\bkar dungi\b/gi, "kar dunga"],
        [/\bkarungi\b/gi, "karunga"],
      ]
    : [
        [/समझा/g, "समझी"],
        [/कर रहा हूँ/g, "कर रही हूँ"],
        [/कर रहा हूं/g, "कर रही हूं"],
        [/कर दूँगा/g, "कर दूँगी"],
        [/कर दूंगा/g, "कर दूंगी"],
        [/करूँगा/g, "करूँगी"],
        [/करूंगा/g, "करूंगी"],
        [/\bsamjha\b/gi, "samjhi"],
        [/\bsamajha\b/gi, "samajhi"],
        [/\bkar raha\b/gi, "kar rahi"],
        [/\bkarta hoon\b/gi, "karti hoon"],
        [/\bkarta hu\b/gi, "karti hu"],
        [/\bcheck karta\b/gi, "check karti"],
        [/\bpoochh raha\b/gi, "poochh rahi"],
        [/\bpooch raha\b/gi, "pooch rahi"],
        [/\bdekh raha\b/gi, "dekh rahi"],
        [/\bsun raha\b/gi, "sun rahi"],
        [/\bbatata hoon\b/gi, "batati hoon"],
        [/\bbata raha\b/gi, "bata rahi"],
        [/\ble raha\b/gi, "le rahi"],
        [/\bleta hoon\b/gi, "leti hoon"],
        [/\bbol raha\b/gi, "bol rahi"],
        [/\braha hoon\b/gi, "rahi hoon"],
        [/\bkar raha hoon\b/gi, "kar rahi hoon"],
        [/\bkar dunga\b/gi, "kar dungi"],
        [/\bkarunga\b/gi, "karungi"],
      ];

  return replacements.reduce((next, [pattern, replacement]) => next.replace(pattern, replacement), text);
}

export type VoiceFlowNodeKind =
  | "start"
  | "prompt"
  | "question"
  | "condition"
  | "action"
  | "transfer"
  | "end";

export interface VoiceFlowNodeData extends Record<string, unknown> {
  kind: VoiceFlowNodeKind;
  title: string;
  body: string;
  helper?: string;
  required?: boolean;
  /** Stamped server-side after parsing — never requested from the LLM. */
  provenance?: "verbatim" | "generated" | "operator";
  midCallAction?: {
    enabled?: boolean;
    actionType?: "send_message" | "disconnect_call";
    triggerOn?: "assistant_turn" | "user_turn";
    channel?: "sms" | "whatsapp";
    template?: string;
    contentSid?: string;
    contentVariables?: Record<string, string>;
    oncePerCall?: boolean;
    containsAny?: string[];
  };
}

export type VoiceFlowNode = Node<VoiceFlowNodeData, "voiceNode">;
export type VoiceFlowEdge = Edge;

export type VoiceUniversalRouteKind =
  | "end_call"
  | "do_not_call"
  | "not_interested"
  | "busy_callback"
  | "wrong_person"
  | "change_language"
  | "question_confusion"
  | "escalation"
  | "silence_unclear"
  | "voicemail_screening";

export interface VoiceUniversalRoute {
  kind: VoiceUniversalRouteKind;
  label: string;
  trigger: string;
  behavior: string;
  targetNodeId?: string;
  terminal: boolean;
}

/**
 * Whether a route kind ends the call once it fires. SINGLE SOURCE OF TRUTH —
 * the archetype defaults (voice-archetypes.ts) and the script importer
 * (voice-script-import.ts) both read this table. A second literal set diverged
 * once already: the importer left `wrong_person` non-terminal, so a wrong-number
 * apology kept a non-customer on the line against the collections guardrail.
 */
export const UNIVERSAL_ROUTE_TERMINAL: Record<VoiceUniversalRouteKind, boolean> = {
  end_call: true,
  do_not_call: true,
  not_interested: true,
  busy_callback: true,
  wrong_person: true,
  change_language: false,
  question_confusion: false,
  escalation: false,
  silence_unclear: false,
  voicemail_screening: true,
};

export interface VoiceCampaignTemplate {
  id: string;
  title: string;
  description: string;
  objective: string;
  audienceHint: string;
  defaultCampaignName: string;
  recommendedOfferId?: string;
  firstMessage: string;
  nodes: VoiceFlowNode[];
  edges: VoiceFlowEdge[];
}

export interface VoiceDatasetContext {
  datasetId?: string;
  label?: string;
  companyName?: string;
  entityName?: string;
  systemContext?: string;
  domainHints?: string;
  welcomeSubtitle?: string;
  reportMeta?: {
    totalEvents?: string;
    totalUsers?: string;
    dateRangeLabel?: string;
    dbName?: string;
  };
}

const node = (
  id: string,
  kind: VoiceFlowNodeKind,
  title: string,
  body: string,
  x: number,
  y: number,
  helper?: string,
  required = true
): VoiceFlowNode => ({
  id,
  type: "voiceNode",
  position: { x, y },
  data: { kind, title, body, helper, required },
});

const edge = (source: string, target: string, label?: string): VoiceFlowEdge => ({
  id: `e-${source}-${target}-${label ?? "next"}`.replace(/\s+/g, "-").toLowerCase(),
  source,
  target,
  label,
  type: "smoothstep",
});

export function voiceCompanyName(dataset?: VoiceDatasetContext): string {
  return dataset?.companyName?.trim() || dataset?.label?.trim() || "the company";
}

export function voiceEntityName(dataset?: VoiceDatasetContext): string {
  return dataset?.entityName?.trim() || "customers";
}

export function renderVoiceTemplateText(text: string, dataset?: VoiceDatasetContext): string {
  const companyName = voiceCompanyName(dataset);
  const datasetLabel = dataset?.label?.trim() || companyName;
  const entityName = voiceEntityName(dataset);

  return text.replace(/\{\{\s*(companyName|datasetLabel|entityName)\s*\}\}/g, (_match, key: string) => {
    if (key === "companyName") return companyName;
    if (key === "datasetLabel") return datasetLabel;
    return entityName;
  });
}

/**
 * Normalize operator-script text for the compiled system prompt.
 * Customer-name placeholders ({{Customer Name}}, [name], [नाम], …) are LEFT
 * intact — they are filled at dial time from the sampled/recipient customer
 * context via applyVoiceCustomerPlaceholders. Do not collapse them to
 * "the customer" here; that baked a generic string into every saved campaign
 * and made the live name (Shanti, etc.) unreachable from the talk track.
 */
function sanitizeVoicePromptText(text: string): string {
  return text
    // Runtime slot filled after language preference — keep a clear spoken cue.
    .replace(/\{\{\s*Selected Language\s*\}\}/gi, "the selected language");
}

function callScreeningReplyLine(agentName: string, companyName: string, language: string): string {
  const normalizedLanguage = language.trim().toLowerCase();
  if (normalizedLanguage.includes("hindi")) {
    return `मैं ${agentName}, ${companyName} से हूँ, एक छोटी सेवा-संबंधी कॉल है।`;
  }
  if (normalizedLanguage.includes("hinglish")) {
    return `Main ${agentName}, ${companyName} se hoon, ek chhoti service call hai.`;
  }
  return `This is ${agentName} from ${companyName}, calling about a brief service update.`;
}

/** Default persona block seeded into the Context UI — editable after that. */
export function defaultVoiceCampaignPersonaPrompt(
  agentName: string,
  companyName: string,
  agentGender: "male" | "female" | "unknown" = "unknown",
): string {
  const genderLine =
    agentGender !== "unknown"
      ? `Your selected voice is ${agentGender}. All first-person wording must match a ${agentGender} speaker.\n\n`
      : "";
  return (
    `You are ${agentName}, a phone advisor from ${companyName}.\n` +
    genderLine +
    `You are having a focused real-time phone conversation.\n` +
    `Do not sound like a scripted sales agent.`
  );
}

export const VOICE_CAMPAIGN_TEMPLATES: VoiceCampaignTemplate[] = [
  {
    id: "high-intent-conversion",
    title: "High-Intent Conversion",
    description: "Call an engaged audience and qualify whether they want the next step.",
    objective: "Identify interested customers, answer only from available offer facts, and capture a clear follow-up action.",
    audienceHint: "Users who recently showed strong intent or match a high-propensity segment.",
    defaultCampaignName: "High-intent outreach",
    firstMessage: "Namaste, {{companyName}} se call kar rahi hoon. Ek minute baat ho payegi?",
    nodes: [
      node("start", "start", "Call Connect", "Use only the configured opening line, then wait for permission before explaining the call purpose.", 0, 0),
      node("context", "prompt", "Purpose Context", "Say one short purpose line using the selected offer and dataset context. Do not promise eligibility or outcomes.", 0, 150),
      node("need", "question", "Intent Check", "Ask one simple question to understand whether the customer is interested in the next step.", 0, 310),
      node("interest", "condition", "Interested?", "Classify the response as interested, maybe later, not interested, or wants more details.", 0, 470),
      node("followup", "transfer", "Follow-Up Consent", "Confirm consent for the right team member to follow up with details.", -280, 640),
      node("details", "action", "Send Details", "Offer to send basic details on WhatsApp or SMS if they want to review later.", 0, 640),
      node("end", "end", "Close Call", "Thank them and close respectfully without pressure.", 280, 640),
    ],
    edges: [
      edge("start", "context"),
      edge("context", "need"),
      edge("need", "interest"),
      edge("interest", "followup", "interested"),
      edge("interest", "details", "maybe later"),
      edge("interest", "end", "not interested"),
    ],
  },
  {
    id: "reactivation",
    title: "Reactivation Outreach",
    description: "Reach inactive or cooling-off customers with a low-pressure check-in.",
    objective: "Understand why the customer has not been active and offer a relevant next step only if useful.",
    audienceHint: "Customers with recent inactivity, drop-off, churn risk, or stalled journeys.",
    defaultCampaignName: "Reactivation outreach",
    firstMessage: "Namaste, {{companyName}} se call kar rahi hoon. Ek minute baat ho payegi?",
    nodes: [
      node("start", "start", "Call Connect", "Use only the configured opening line, then wait for permission before explaining the call purpose.", 0, 0),
      node("purpose", "prompt", "Check-In Context", "Say the reason for the check-in in one short line using dataset and segment context.", 0, 150),
      node("reason", "question", "Reason Discovery", "Ask what is blocking them or whether they still need help.", 0, 310),
      node("next", "condition", "Next Step?", "Classify as wants help, wants details, busy, resolved, or not interested.", 0, 470),
      node("followup", "transfer", "Follow-Up", "Confirm a preferred callback window or support next step.", -180, 640),
      node("end", "end", "Close Call", "If not interested or already resolved, thank them and close cleanly.", 180, 640),
    ],
    edges: [
      edge("start", "purpose"),
      edge("purpose", "reason"),
      edge("reason", "next"),
      edge("next", "followup", "wants help"),
      edge("next", "end", "resolved or not interested"),
    ],
  },
  {
    id: "upsell-cross-sell",
    title: "Upsell / Cross-Sell",
    description: "Introduce a relevant product, feature, or service based on segment behavior.",
    objective: "Check whether the customer has a relevant need and collect consent for details or follow-up.",
    audienceHint: "Existing customers who are eligible for, or likely to benefit from, another product or service.",
    defaultCampaignName: "Upsell outreach",
    firstMessage: "Namaste, {{companyName}} se call kar rahi hoon. Ek minute baat ho payegi?",
    nodes: [
      node("start", "start", "Call Connect", "Use only the configured opening line, then wait for permission before explaining the call purpose.", 0, 0),
      node("need", "question", "Need Discovery", "Ask whether the selected offer is relevant to their current need.", 0, 150),
      node("fit", "question", "Fit Check", "If interested, ask one qualifying question grounded in the offer facts.", 0, 310),
      node("qualify", "condition", "Qualified Interest?", "Separate strong interest, information request, not now, and not interested.", 0, 470),
      node("specialist", "transfer", "Specialist Follow-Up", "Confirm preferred callback window and consent for follow-up.", -260, 640),
      node("nurture", "action", "Send Product Note", "Offer to send a short note for later review.", 0, 640),
      node("end", "end", "Close Call", "Thank them and close without pressure.", 260, 640),
    ],
    edges: [
      edge("start", "need"),
      edge("need", "fit", "has need"),
      edge("need", "end", "no need"),
      edge("fit", "qualify"),
      edge("qualify", "specialist", "strong interest"),
      edge("qualify", "nurture", "needs info"),
      edge("qualify", "end", "not now"),
    ],
  },
  {
    id: "retention-save",
    title: "Retention Save",
    description: "Handle churn-risk or dissatisfaction signals with a respectful support-led conversation.",
    objective: "Understand the issue, avoid defensive selling, and route the customer to the right support outcome.",
    audienceHint: "Customers showing churn risk, complaints, failed journeys, or declining engagement.",
    defaultCampaignName: "Retention outreach",
    firstMessage: "Namaste, {{companyName}} se call kar rahi hoon. Ek minute baat ho payegi?",
    nodes: [
      node("start", "start", "Call Connect", "Use only the configured opening line, then wait for permission before explaining the call purpose.", 0, 0),
      node("issue", "question", "Issue Check", "Ask whether there is anything the team can help resolve.", 0, 150),
      node("understand", "question", "Clarify", "If they share an issue, ask one short clarifying question.", 0, 310),
      node("route", "condition", "Route Outcome", "Classify as needs support, needs details, busy, resolved, or not interested.", 0, 470),
      node("support", "transfer", "Support Follow-Up", "Confirm consent and preferred time for follow-up.", -260, 640),
      node("details", "action", "Send Overview", "Send a neutral overview if they prefer to read first.", 0, 640),
      node("end", "end", "Close Call", "Thank them and close politely.", 260, 640),
    ],
    edges: [
      edge("start", "issue"),
      edge("issue", "understand", "has issue"),
      edge("issue", "end", "no issue"),
      edge("understand", "route"),
      edge("route", "support", "needs support"),
      edge("route", "details", "details first"),
      edge("route", "end", "not interested"),
    ],
  },
  {
    id: "service-follow-up",
    title: "Service Follow-Up",
    description: "Follow up after a recent service, transaction, or support interaction.",
    objective: "Check whether the customer needs help, collect a clean response, and route unresolved issues.",
    audienceHint: "Customers with a recent interaction, transaction, request, or incomplete support journey.",
    defaultCampaignName: "Service follow-up",
    firstMessage: "Namaste, {{companyName}} se call kar rahi hoon. Ek minute baat ho payegi?",
    nodes: [
      node("start", "start", "Call Connect", "Use only the configured opening line, then wait for permission before explaining the call purpose.", 0, 0),
      node("context", "prompt", "Interaction Context", "Mention the recent interaction or segment reason only if it is present in the selected context.", 0, 150),
      node("satisfaction", "question", "Need Help?", "Ask whether everything is fine or if they need help.", 0, 310),
      node("route", "condition", "Response Route", "Classify as satisfied, needs help, wants callback, busy, or not interested.", 0, 470),
      node("help", "transfer", "Help Follow-Up", "Route unresolved issues to the right team.", -300, 640),
      node("note", "action", "Capture Note", "Capture any short feedback or preferred follow-up window.", 0, 640),
      node("end", "end", "Close Call", "Close respectfully without repeated prompting.", 300, 640),
    ],
    edges: [
      edge("start", "context"),
      edge("context", "satisfaction"),
      edge("satisfaction", "route"),
      edge("route", "help", "needs help"),
      edge("route", "note", "feedback or callback"),
      edge("route", "end", "satisfied or not interested"),
    ],
  },
  {
    id: "blank",
    title: "Blank Workflow",
    description: "Start with a minimal call flow and build your own outbound campaign.",
    objective: "Create a custom outbound voice campaign using the selected dataset, segment, and offer context.",
    audienceHint: "Any selected audience segment.",
    defaultCampaignName: "New voice campaign",
    firstMessage: "Namaste, {{companyName}} se call kar rahi hoon. Ek minute baat ho payegi?",
    nodes: [
      node("start", "start", "Call Connect", "Use only the configured opening line, then wait for permission before explaining the call purpose.", 0, 0),
      node("prompt", "prompt", "Conversation Goal", "Say the purpose of the call in one short line.", 0, 180),
      node("end", "end", "Close Call", "Thank them and close respectfully.", 0, 360),
    ],
    edges: [edge("start", "prompt"), edge("prompt", "end")],
  },
];

export function cloneTemplateFlow(template: VoiceCampaignTemplate): {
  nodes: VoiceFlowNode[];
  edges: VoiceFlowEdge[];
} {
  return {
    nodes: template.nodes.map((n) => ({
      ...n,
      position: { ...n.position },
      data: { ...n.data },
    })),
    edges: template.edges.map((e) => ({ ...e })),
  };
}

const START_NODE_PRIVATE_SETUP =
  "Private setup only. The launch opening has already been spoken; after the customer responds to the opening, continue to the next workflow step without repeating the greeting.";

function normalizeSpokenLineKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Runtime body for the start node.
 *
 * Only the line that already became the launch opening is removed. The greeting
 * stage legitimately carries more than the opening — the identity check ("Am I
 * speaking with …?") and every approved alternate phrasing — and blanking the
 * whole body dropped them from the live prompt, silently deleting the RPC check
 * that the collections guardrails depend on.
 */
function startNodeRuntimeBody(
  rawBody: string,
  workflowOpening: string | undefined,
  dataset: VoiceDatasetContext | undefined,
): string {
  const openingKey = workflowOpening ? normalizeSpokenLineKey(workflowOpening) : "";
  const residual: string[] = [];
  for (const raw of (rawBody ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const spoken = line.match(/^(?:VIDYA|AGENT|ASSISTANT|Say|कहें)\s*[:：]\s*(.+)$/i)?.[1]?.trim() ?? line;
    if (openingKey && normalizeSpokenLineKey(spoken) === openingKey) continue;
    residual.push(line);
  }
  if (residual.length === 0) return START_NODE_PRIVATE_SETUP;
  const rendered = sanitizeVoicePromptText(renderVoiceTemplateText(residual.join("\n"), dataset));
  if (!rendered.trim()) return START_NODE_PRIVATE_SETUP;
  return `${START_NODE_PRIVATE_SETUP}\nThe rest of this stage is still live — deliver these approved lines after the customer responds to the opening:\n${rendered}`;
}

/**
 * Render universal routes as a prompt section.
 *
 * Shared by the workflow compiler and the editableScript runtime fallback so a
 * campaign's interruption routes reach a live call on BOTH prompt paths.
 *
 * The two trailing clauses are mutually exclusive on purpose: a terminal route
 * that also carried a targetNodeId used to emit "Then end the call. Then
 * continue from the "X" step." — two contradictory instructions on the
 * do-not-call path, where continuing is a compliance failure.
 */
export function renderUniversalRoutesSection(
  universalRoutes: VoiceUniversalRoute[],
  nodes: VoiceFlowNode[],
  dataset?: VoiceDatasetContext,
): string {
  if (universalRoutes.length === 0) return "";
  const lines = universalRoutes.map((route) => {
    const trigger = sanitizeVoicePromptText(renderVoiceTemplateText(route.trigger, dataset));
    const behavior = sanitizeVoicePromptText(renderVoiceTemplateText(route.behavior, dataset));
    if (route.terminal) return `- If ${trigger}: ${behavior} Then end the call.`;
    const targetTitle = route.targetNodeId
      ? nodes.find((n) => n.id === route.targetNodeId)?.data.title ?? route.targetNodeId
      : undefined;
    return `- If ${trigger}: ${behavior}${targetTitle ? ` Then continue from the "${targetTitle}" step.` : ""}`;
  });
  return `Universal routes (these apply from ANY point in the call, interrupting the workflow):
${lines.join("\n")}`;
}

export function compileVoiceCampaignScript({
  template,
  campaignName,
  firstMessage,
  nodes,
  edges,
  segment: _segment,
  purpose: _purpose,
  dataset,
  language,
  voice,
  voiceName,
  agentName: agentNameOverride,
  companyName: companyNameOverride,
  personaPrompt,
  guardrails = [],
  operatorScript,
  universalRoutes = [],
}: {
  template: VoiceCampaignTemplate;
  campaignName: string;
  firstMessage?: string;
  nodes: VoiceFlowNode[];
  edges: VoiceFlowEdge[];
  /** Kept for call-site compat. Purpose/offer facts are authoring-only — not injected into the runtime call prompt. */
  segment?: Pick<Segment, "name" | "description" | "userCount" | "sql">;
  /** Kept for call-site compat. Used when generating scripts; omitted from the live system prompt. */
  purpose?: Purpose;
  dataset?: VoiceDatasetContext;
  language: string;
  voice?: string;
  voiceName?: string;
  agentName?: string;
  /** UI Context override — preferred over dataset.companyName. */
  companyName?: string;
  /** UI Context persona block — replaces the auto-generated "You are …" intro. */
  personaPrompt?: string;
  guardrails?: string[];
  /** Operator Script-tab text — authoring mirror only. Used as runtime fallback when workflow nodes are empty. */
  operatorScript?: string;
  /** Interruption routes available from every meaningful workflow state. */
  universalRoutes?: VoiceUniversalRoute[];
}): { systemPrompt: string; firstMessage: string; reasoning: string } {
  const agentName = agentNameOverride?.trim() || defaultAgentName(voiceName || sarvamSpeakerLabel(voice || DEFAULT_SARVAM_SPEAKER));
  const agentGender = geminiVoiceGender(voice || voiceName || "");
  const companyName = companyNameOverride?.trim() || voiceCompanyName(dataset);
  const audienceHint = renderVoiceTemplateText(template.audienceHint, dataset);
  // Workflow array order is semantic; canvas y-position is presentation only.
  const orderedNodes = nodes;
  // Computed before flowLines: the start node's body is rendered relative to it.
  const workflowOpening = extractOpeningLineFromWorkflow(nodes);
  const flowLines = orderedNodes
    .map((n, index) => {
      const body = n.data.kind === "start"
        ? startNodeRuntimeBody(n.data.body, workflowOpening, dataset)
        : sanitizeVoicePromptText(renderVoiceTemplateText(n.data.body, dataset));
      const helper = n.data.helper?.trim()
        ? ` [Private note: ${sanitizeVoicePromptText(renderVoiceTemplateText(n.data.helper, dataset))}]`
        : "";
      return `${index + 1}. ${n.data.title} (${n.data.kind}): ${body}${helper}`;
    })
    .join("\n");
  const edgeLines = edges
    .map((e) => {
      const source = nodes.find((n) => n.id === e.source)?.data.title ?? e.source;
      const target = nodes.find((n) => n.id === e.target)?.data.title ?? e.target;
      const label = typeof e.label === "string" ? ` when "${e.label}"` : "";
      return `- ${source} -> ${target}${label}`;
    })
    .join("\n");

  const resolvedFirstMessage = normalizeAgentGenderedPhrases(
    renderVoiceTemplateText(
      workflowOpening || firstMessage?.trim() || template.firstMessage,
      dataset,
    ),
    agentGender,
  );
  const hindiAcknowledgementExamples = agentGender === "female"
    ? '"हाँ", "जी", "समझी", "ठीक है"'
    : agentGender === "male"
      ? '"हाँ", "जी", "समझा", "ठीक है"'
      : '"हाँ", "जी", "समझा/समझी", "ठीक है"';
  const hinglishAcknowledgementExamples = agentGender === "female"
    ? '"haan", "ji", "samjhi", "theek hai"'
    : agentGender === "male"
      ? '"haan", "ji", "samjha", "theek hai"'
      : '"haan", "ji", "samjha/samjhi", "theek hai"';
  const hindiRomanizationRule = agentGender === "female"
    ? '- For Hindi, never use romanized Hindi such as "theek hai", "samjhi", or "baat ho payegi"; write those as "ठीक है", "समझी", and "बात हो पाएगी".'
    : agentGender === "male"
      ? '- For Hindi, never use romanized Hindi such as "theek hai", "samjha", or "baat ho payegi"; write those as "ठीक है", "समझा", and "बात हो पाएगी".'
      : '- For Hindi, never use romanized Hindi such as "theek hai", "samjha/samjhi", or "baat ho payegi"; write those as "ठीक है", "समझा/समझी", and "बात हो पाएगी".';
  const automatedScreeningReply = callScreeningReplyLine(agentName, companyName, language);
  const workflowSummary = [
    flowLines,
    edgeLines ? `\nRouting:\n${edgeLines}` : "",
  ].filter(Boolean).join("\n");

  // Universal routes: interruption handling that applies from any workflow
  // state. Rendered as its own section so the runtime model treats them as
  // recurring loops rather than steps in the spine.
  //
  // NOTE (future work): the eventual emission target is Google's 4-part Live
  // systemInstruction layout — persona → one-time sequence (the spine) →
  // loops (these universal routes) → answer-only knowledge, with tools and
  // guardrails last (docs/script-generator-design.md). Until that reorder is
  // evaluated against live calls, this section is strictly additive; do not
  // reorder or delete the existing tuned sections around it.
  const universalRoutesSection = renderUniversalRoutesSection(universalRoutes, nodes, dataset);

  // Runtime talk track is workflow-first. The Script tab remains the operator
  // authoring mirror (synced into node bodies) — do not also dump the full
  // script into the live prompt (it overcrowds Gemini and duplicates the graph).
  const hasWorkflowTalkTrack = orderedNodes.some((n) => n.data.kind !== "start" || orderedNodes.length > 1);
  const scriptBodyFallback = sanitizeVoicePromptText(operatorScript?.trim() || "");
  const talkTrackSection = hasWorkflowTalkTrack
    ? `Campaign workflow (primary talk track — follow step order and routing; do not invent product/offer facts outside it):
${workflowSummary || "(Workflow is empty — stay silent on product facts.)"}`
    : scriptBodyFallback
      ? `Campaign workflow (primary talk track — follow this; do not invent product/offer facts outside it):
${scriptBodyFallback}`
      : `Campaign workflow (primary talk track):
(No workflow or operator script provided. Do not invent product, pricing, or eligibility facts.)`;

  const personaBlock =
    personaPrompt?.trim() ||
    defaultVoiceCampaignPersonaPrompt(agentName, companyName, agentGender);

  const systemPrompt = `${personaBlock}

Company:
${companyName}

Campaign:
${campaignName}

${talkTrackSection}${universalRoutesSection ? `\n\n${universalRoutesSection}` : ""}

Workflow handling rules:
- The Campaign workflow is the primary talk track and private control logic.
- Follow node order and Routing labels. Speak only customer-facing lines from node bodies (text after "Say:" / "कहें:" when present).
- Never say node titles, node kinds, routing labels, helper notes, or control words like "Signal सुनें", "node", "route", "Branches:", or "next step पर जाएँ".
- If a node body says "कहें:" or "say:", only the quoted customer-facing phrase is possible spoken copy. Everything outside the quote is private instruction. If the quoted phrase is romanized and the spoken language is Hindi, translate or adapt it into natural Hindi before speaking.
- "{{Customer Name}}" / "[Customer Name]" / "[name]" / "[नाम]" are filled at dial time from private customer context when a name is known. Speak that exact filled name — never invent a different one.
- Other "{{Field Label}}" slots (e.g. "{{Disbursed Amount}}", "{{Disbursement Date}}") are also filled at dial time from the sampled customer row when that column exists. Speak the filled value — never invent amounts or dates.
- If a customer-name placeholder is still present unfilled, do not invent a name; skip naming the customer and continue naturally.
- If a field placeholder is still present unfilled, do not invent a value; skip that detail and continue naturally.
- Runtime slots like "{{Selected Language}}", "{{Tomorrow / Today}}", and "{{Phone / Video}}" are filled from the live conversation — substitute the real choice the customer already gave; never read the braces aloud.
- Treat remaining bracket placeholders like "[date]" or "[amount]" as private placeholders, not spoken copy, unless the value is already known from private context or the conversation.
- If a start node repeats the opening instructions, do not say it again after the launch opening.
- Convert mixed operator text into clean spoken language for the active call language; do not read English/Hinglish control phrases aloud during a Hindi call.

Opening:
- The launch code speaks this opening line as the first turn:
  "${resolvedFirstMessage}"
- The first turn must contain only that opening line.
- After the opening line, wait for the customer.
- If the opening asked which language they prefer, wait for their language choice, then continue the workflow in that language.
- Do not invent product pitches in the opening turn.

Call screening and voicemail:
- If the audio says the call is being screened, transcribed, sent to voicemail, asks you to state your name, or asks why you are calling, it is not the customer.
- Do not treat that as permission to start the workflow.
- Do not pitch, qualify, ask a question, or mention offer details.
- Say exactly one screening-safe sentence:
  "${automatedScreeningReply}"
- Then wait silently for a real customer response.
- If it is clearly voicemail, leave only that one sentence and stop speaking.

Language rules:
- Default to ${language} at the start of the call until the customer chooses otherwise.
- If the opening (or any turn) asks which language they prefer: wait silently until they name a language. Do not continue the campaign workflow, invent English, or free-wheel while waiting.
- When re-asking language preference, list Latin option names (Hindi, English, Tamil, Kannada, Telugu) so speech recognition can catch them; then stop and wait.
- If they clearly name a language (including Tamil/Kannada/Telugu), treat that as an explicit choice, rewrite the remaining workflow steps into that language, and continue only in that language.
- After a language is chosen, do not switch away because ASR looks like English/Hindi — Tamil/Telugu/Kannada ASR is often wrong. Switch only if the customer clearly names another language.
- Do not switch languages unless the customer switches first or answers a language-preference question.
- The private workflow may be authored in English or romanized Hinglish. When the customer chooses a language, treat that authoring as meaning-only and deliver every remaining step in the chosen language.
- If language is Hinglish, use natural romanized Hinglish.
- If language is English, use Indian English (en-IN) only — never US English (en-US) or UK English. Indian pronunciation, Indian wording, Indian phone cadence. No Americanisms (gonna, wanna, awesome, folks).
- Whenever any English word is spoken on this call (including mixed Hinglish), prefer en-IN pronunciation and wording over en-US.
- If language is Hindi, use simple conversational Hindi in Devanagari script only.
- If language is Tamil, use casual spoken Tamil (பேச்சுத் தமிழ்) only — phone-agent style with நீங்க / பேசுறேன் / சரிங்க. Never formal written Tamil (நீங்கள் / பேசுகிறேன் / இருக்கிறீர்களா).
- If language is Telugu, use casual spoken Telugu only — phone-agent style with మీరు / మాట్లాడుతున్నా / సరే. Never formal literary Telugu (మాట్లాడుచున్నాను).
- If language is Kannada, use casual spoken Kannada only — phone-agent style with ನೀವು / ಮಾತಾಡ್ತಾ ಇದೀನಿ / ಸರಿ. Never formal literary Kannada (ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ).
- Never sound like a textbook or newsreader in Tamil/Telugu/Kannada — short warm phone sentences only.
- Match first-person grammar to the selected voice gender.
- If the selected voice is female, use female forms such as "कर रही हूँ", "कर दूँगी", "समझी", and Hinglish "kar rahi hoon", "kar dungi", "samjhi".
- If the selected voice is male, use male forms such as "कर रहा हूँ", "कर दूँगा", "समझा", and Hinglish "kar raha hoon", "kar dunga", "samjha".
- Never make a male voice speak female first-person forms, and never make a female voice speak male first-person forms.
- For acknowledgements like "understood", female speakers must say "समझी"/"samjhi", never "समझा"/"samjha".
- If PRIVATE CUSTOMER CONTEXT FOR THIS CALL includes "Customer gender", use that gender immediately from the first reply — do not wait to detect from speech. If gender is male, use "aap kar rahe hain", "kar sakte hain", "samajh gaye" throughout. If gender is female, use "aap kar rahi hain", "kar sakti hain", "samajh gayi" throughout.
- If no customer gender is provided in context, listen to the customer's first 1–2 replies for gendered verb forms (raha/rahi, sochta/sochti, samjha/samjhi). Once detected, match second-person forms accordingly. Until clearly detected, default to neutral plural ("kar rahe hain", "kar sakte hain"). Never assume customer gender from the agent voice gender. Do not ask — infer silently.
${hindiRomanizationRule}
- For Hindi, keep brand names as written but write all normal conversation in Devanagari.

Response style:
- Return only one spoken response at a time.
- The default reply is one to three short spoken sentences.
- Most useful replies should be around 25 to 55 words total.
- Simple confirmations, closures, and interruption responses can be shorter.
- One idea per response.
- Ask at most one question.
- Sound calm and conversational.
- Speak like a real Indian phone caller.
- If speaking English, it must be Indian English (en-IN) only — never en-US.
- Do not use markdown, bullet points, stage directions, or ellipses.
- Use natural acknowledgements occasionally.
- In Hindi, use ${hindiAcknowledgementExamples}.
- In Hinglish, use ${hinglishAcknowledgementExamples}.

Conversation behavior:
- Follow the Campaign workflow step order. Do not invent a parallel product pitch.
- If private customer context includes a customer name, use exactly that name and no other name.
- If the customer interrupts, stop immediately and respond only to the latest intent.
- If the customer says busy, ask for a better callback time or close politely per the workflow.
- If the customer says not interested, apologize politely and end per the workflow.
- The customer's latest concern overrides the workflow path — acknowledge briefly, help or triage, then return to the workflow only if appropriate.

If customer asks who is calling:
Reply naturally that you are ${agentName} from ${companyName}.

If customer asks about price, rates, fees, limits, eligibility, documents, or terms:
Answer only from the Campaign workflow. If the workflow does not establish the answer, say the team will confirm after checking. Do not invent facts.

If customer asks to remove their number or stop calling:
Apologize once and end the call.

Closing behavior:
- When you deliver a final polite close, that must be your last spoken line.
- Do not ask another question after a closing line.

Safety rules:
- Never ask for OTPs.
- Never ask for card details.
- Never ask for Aadhaar or PAN numbers.
- Never ask for passwords or payment credentials.
- Never promise approval.
- Never pressure the customer.
- Never shame the customer.
${guardrails.length > 0 ? `
Compliance rules (must follow on every call without exception):
${guardrails.map((r) => `- ${r}`).join("\n")}` : ""}

Runtime context:
- The greeting/opening has already been spoken by the launch code.
- Do not greet again unless the workflow explicitly requires a later greeting.
- Stay in the active call language.
- Return only the next spoken line.
- If a private customer context block exists later in the prompt, use it silently and naturally. Do not reveal internal fields.
- Never invent, infer, or substitute a customer name.

Final turn contract:
- One turn equals one clear intent.
- Normal target: 1 to 3 short spoken sentences, about 25 to 55 words total.
- When in doubt, be warm, concise, and pause.`;

  const reasoning = `${template.title} for ${audienceHint}. Runtime prompt uses ${companyName}, the campaign workflow, and guardrails — purpose/offer catalog facts are authoring-only. Script tab is the operator editing mirror synced into workflow nodes.`;

  return {
    systemPrompt,
    firstMessage: resolvedFirstMessage,
    reasoning,
  };
}
