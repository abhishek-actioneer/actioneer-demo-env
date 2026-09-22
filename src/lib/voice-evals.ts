export type VoiceEvalInputType = "text" | "audio";
export type VoiceEvalCategory = "voice" | "support" | "sales" | "scheduling" | "quality" | "compliance";
export type VoiceEvalVerdict = "pass" | "fail" | "insufficient_evidence" | "not_applicable" | "error";

export interface VoiceEvalScoreLevel {
  id: string;
  label: string;
  description: string;
  color: "red" | "yellow" | "green" | "gray";
}

export interface VoiceEvalAgent {
  id: string;
  name: string;
  description: string;
  prompt: string;
  inputType: VoiceEvalInputType;
  category: VoiceEvalCategory;
  source: "built_in" | "custom";
  systemPrompt?: string;
  contextSources?: string[];
  scoreLevels?: VoiceEvalScoreLevel[];
  createdAt?: string;
  updatedAt?: string;
}

export const VOICE_EVAL_CONTEXT_SOURCES = [
  { id: "transcript", name: "Transcript", description: "Speaker-labelled turns and raw transcript rows." },
  { id: "call-metadata", name: "Call metadata", description: "Duration, timestamps, end reason, phone and call identifiers." },
  { id: "workflow-logs", name: "Workflow logs", description: "Nodes reached, branches taken, routing, and workflow progress." },
  { id: "workflow-semantics", name: "Workflow semantics", description: "Runtime interpretation of workflow nodes, routes, transfer behavior, loop gates, tools, and settings." },
  { id: "transfer-context", name: "Transfer context", description: "Transfer outcome, warm-transfer state, configured handoff targets, and transfer nodes." },
  { id: "disposition-results", name: "Disposition results", description: "Post-call disposition outputs and status fields." },
  { id: "citation-variables", name: "Citation variables", description: "Structured cited variables extracted from call metrics." },
  { id: "webhook-payloads", name: "Webhook payloads", description: "Post-call webhook payload and delivery metadata." },
  { id: "tool-logs", name: "Tool logs", description: "Tool calls, arguments, responses, and handoff evidence." },
  { id: "variables", name: "Variables", description: "Runtime variables captured during the call." },
  { id: "analysis", name: "Analysis", description: "Stored post-call analysis fields when available." },
  { id: "call-metrics", name: "Call metrics", description: "Metric payloads, citations, and extracted measurement data." },
  { id: "call-config", name: "Call config", description: "Call setup and configuration context." },
  { id: "agent-config", name: "Agent config", description: "Full call-time agent setup, including prompt/task and runtime settings." },
  { id: "workflow-config", name: "Workflow config", description: "Call-time workflow JSON such as nodes, edges, prompts, and start node." },
  { id: "persona-config", name: "Persona config", description: "Persona setup attached to the call, including prompt/config payloads when present." },
  { id: "contact-memory", name: "Contact memory", description: "Relevant persisted contact memory attached to the call." },
  { id: "call-notes", name: "Call notes", description: "Notes saved against the call record." },
] as const;

export type VoiceEvalContextSourceId = (typeof VOICE_EVAL_CONTEXT_SOURCES)[number]["id"];

const VOICE_EVAL_CONTEXT_SOURCE_IDS = new Set<string>(
  VOICE_EVAL_CONTEXT_SOURCES.map((source) => source.id),
);

export function isVoiceEvalContextSourceId(value: string): value is VoiceEvalContextSourceId {
  return VOICE_EVAL_CONTEXT_SOURCE_IDS.has(value);
}

export const DEFAULT_VOICE_EVAL_CONTEXT_SOURCES = VOICE_EVAL_CONTEXT_SOURCES
  .filter((source) => ![
    "analysis",
    "webhook-payloads",
    "agent-config",
    "workflow-config",
    "persona-config",
  ].includes(source.id))
  .map((source) => source.id);

const LEGACY_VOICE_EVAL_CONTEXT_SOURCE_IDS: Record<string, string> = {
  "pathway-logs": "workflow-logs",
  "pathway-semantics": "workflow-semantics",
  "pathway-config": "workflow-config",
};

/** Keeps agents saved before the workflow terminology change compatible. */
export function normalizeVoiceEvalContextSources(sources?: string[]): string[] | undefined {
  if (!sources) return undefined;
  return Array.from(new Set(sources.map((source) => LEGACY_VOICE_EVAL_CONTEXT_SOURCE_IDS[source] ?? source)));
}

export const DEFAULT_VOICE_EVAL_SCORE_LEVELS: VoiceEvalScoreLevel[] = [
  { id: "off-brand", label: "Off-brand", description: "Agent repeatedly shows clear anti-patterns that materially hurt the call.", color: "red" },
  { id: "acceptable", label: "Acceptable", description: "Mostly fine, but a few specific slips or one meaningful pattern are present.", color: "yellow" },
  { id: "on-brand", label: "On-brand", description: "Reads like a competent person on the phone: warm, direct, brief, and grounded.", color: "green" },
  { id: "inconclusive", label: "Inconclusive", description: "Last-resort escape level when the evidence supports two levels equally.", color: "gray" },
];

export const DEFAULT_VOICE_EVAL_SYSTEM_PROMPT = `You are a judge for one phone-call agent. Grade only the behavior named in the eval task. Do not grade whether the overall conversation succeeded unless the task explicitly asks you to.

Calibration baseline

Use the transcript as the primary evidence for what the customer and agent said. Use runtime logs and configuration only to clarify intended behavior and platform state. Missing artifacts are not proof of failure.

Reasoning requirements

- State the selected level and a one-line summary.
- For any level below the target, cite at least one exact agent turn that demonstrates the problem.
- Explicitly acknowledge borderline behavior you noticed but correctly did not flag.
- Never invent evidence or expand the rubric into unrelated issues.

Inconclusive is a last-resort level when the supplied evidence genuinely supports two levels equally. Insufficient evidence is reserved for a missing or empty transcript, or a transcript with no agent turns.`;

export const BRAND_TONE_SYSTEM_PROMPT = `You are a tone judge for one phone-call agent. Grade the agent's style of speaking — whether it sounds like a real person on the phone or like a script being read out. You are NOT grading whether the conversation succeeded; another agent handles that.

Calibration baseline

The desired voice is warm, direct, brief, grounded in the customer's words, and free of marketing-speak. The agent should sound like a competent human on the phone — not a chatbot, not a salesperson, and not a sycophant. Default to On-brand for a normal phone call. To drop below On-brand, cite specific agent turns that violate the rules.

Anti-patterns to escalate

- Sycophantic pile-on: repeated, performative enthusiasm such as “Absolutely fantastic” or “What a wonderful question.”
- Marketing-speak: brochure language such as “cutting-edge,” “world-class,” “unlock value,” or “streamline your workflow.”
- Script tells: every turn beginning with the same template, or repeating the customer's last sentence verbatim before responding.
- Empty hedging: filler that does not advance the conversation.
- Robotic acknowledgments: unnatural phrases such as “I have noted your concern.”
- Over-apology stack: three or more apologies for one issue.
- Steamrolling emotional moments: skipping past clear frustration, sadness, or urgency.

What is not a defect

- A slightly synthetic TTS voice.
- Brief professional acknowledgments such as “Got it,” “Sure thing,” or “Of course.”
- One isolated “Great” or “Thanks for letting me know.”
- Mild redundancy while confirming details such as a phone number or address.
- Polite closings and necessary clarifying questions.

Reasoning requirements

- Include the selected level and a one-line summary.
- For Acceptable or Off-brand, quote at least one exact agent turn that demonstrates the anti-pattern.
- Explicitly acknowledge borderline behavior that you noticed but correctly did not flag.

Inconclusive is the last-resort level when the evidence supports two levels equally. Insufficient evidence is reserved for a missing transcript, an empty transcript, or a transcript with zero agent turns. Missing runtime artifacts are not proof of failure. Keep the rubric narrow.`;

export interface VoiceEvalWorkbench {
  id: string;
  userId: string;
  datasetId: string;
  name: string;
  description: string;
  status: "active" | "archived";
  evalAgentIds: string[];
  campaignIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VoiceEvalEvidence {
  turnIndex: number;
  quote: string;
}

export interface VoiceEvalResult {
  id: string;
  jobId: string;
  workbenchId: string;
  evalAgentId: string;
  evalAgentName: string;
  campaignId: string;
  callId: string;
  verdict: VoiceEvalVerdict;
  score: number | null;
  rationale: string;
  evidence: VoiceEvalEvidence[];
  createdAt: string;
  updatedAt: string;
}

export const BUILT_IN_VOICE_EVAL_AGENTS: VoiceEvalAgent[] = [
  {
    id: "builtin:brand-tone",
    name: "Brand tone",
    description: "Grades whether the agent sounds warm, direct, customer-grounded, and natural rather than scripted.",
    prompt: "Pass when the agent consistently sounds warm, direct, respectful, and customer-grounded. Fail only with concrete turns that are robotic, pushy, dismissive, or clearly off-brand.",
    inputType: "text",
    category: "voice",
    source: "built_in",
    systemPrompt: BRAND_TONE_SYSTEM_PROMPT,
    contextSources: DEFAULT_VOICE_EVAL_CONTEXT_SOURCES,
    scoreLevels: DEFAULT_VOICE_EVAL_SCORE_LEVELS,
  },
  {
    id: "builtin:conversation-quality",
    name: "Conversational quality",
    description: "Checks whether the agent listened, acknowledged, and adapted to clear customer signals.",
    prompt: "Pass when the agent acknowledges and adapts to the customer's signals without talking past them, stacking questions, or repeating itself. Fail only with citable transcript evidence.",
    inputType: "text",
    category: "voice",
    source: "built_in",
  },
  {
    id: "builtin:issue-understanding",
    name: "Issue understanding",
    description: "Checks that the agent understood the customer before suggesting a next step.",
    prompt: "Pass when the agent accurately reflects or paraphrases the customer's actual need before recommending a next step. Return insufficient evidence if the customer never states a need.",
    inputType: "text",
    category: "support",
    source: "built_in",
  },
  {
    id: "builtin:resolution",
    name: "Resolution",
    description: "Grades whether the call ended with a clear outcome, answer, handoff, or next step.",
    prompt: "Pass when the call reaches a clear outcome relative to the customer's need: an answer, completed action, correct handoff, or explicit next step. Do not reward vague promises.",
    inputType: "text",
    category: "support",
    source: "built_in",
  },
  {
    id: "builtin:objection-handling",
    name: "Objection handling",
    description: "Grades whether the agent addressed a real objection directly and in the customer's framing.",
    prompt: "If the customer raises an objection, pass when the agent addresses it directly, accurately, and without pressure. Return not_applicable when no objection occurs.",
    inputType: "text",
    category: "sales",
    source: "built_in",
  },
  {
    id: "builtin:discovery",
    name: "Discovery",
    description: "Checks whether outbound agents understand customer needs before pitching.",
    prompt: "For outbound sales-style calls, pass when the agent asks focused open questions before pitching. Return not_applicable for inbound calls where the customer arrives with a clear request.",
    inputType: "text",
    category: "sales",
    source: "built_in",
  },
  {
    id: "builtin:appointment-booked",
    name: "Appointment booked",
    description: "Checks whether date, time, channel, and customer agreement were explicitly confirmed.",
    prompt: "Pass only when an appointment or callback is explicitly agreed with enough concrete scheduling detail. Return not_applicable when scheduling was not the call goal.",
    inputType: "text",
    category: "scheduling",
    source: "built_in",
  },
  {
    id: "builtin:scheduling-clarity",
    name: "Scheduling clarity",
    description: "Grades whether discussed scheduling details were clear enough to prevent a missed follow-up.",
    prompt: "When scheduling occurs, pass if date or window, follow-up channel, and next action are unambiguous. Return not_applicable if scheduling was never discussed.",
    inputType: "text",
    category: "scheduling",
    source: "built_in",
  },
  {
    id: "builtin:hallucination-detection",
    name: "Hallucination detection",
    description: "Flags fabricated claims, invented prior actions, unsupported customer facts, and false certainty.",
    prompt: "Pass when the agent makes no fabricated or unsupported factual claims. Fail only when the transcript contains a specific invented fact, action, promise, or certainty unsupported by the customer or campaign context.",
    inputType: "text",
    category: "quality",
    source: "built_in",
  },
  {
    id: "builtin:prompt-adherence",
    name: "Prompt & workflow adherence",
    description: "Checks required sequence, workflow purpose, tool constraints, and routing behavior.",
    prompt: "Pass when the agent follows the supplied campaign instructions, required sequence, guardrails, and workflow intent. Cite the exact turn for any clear deviation.",
    inputType: "text",
    category: "quality",
    source: "built_in",
  },
  {
    id: "builtin:runtime-decision-quality",
    name: "Runtime decision quality",
    description: "Grades whether the agent chose the right next step, escalation, handoff, or stop condition.",
    prompt: "Pass when the agent's in-call decisions follow logically from customer signals: continue, clarify, use a tool, offer a handoff, schedule, or stop. Fail on a clearly harmful or irrelevant decision.",
    inputType: "text",
    category: "quality",
    source: "built_in",
  },
  {
    id: "builtin:lead-opportunity",
    name: "Lead opportunity handling",
    description: "Detects a real buying signal and grades whether the agent advanced it appropriately.",
    prompt: "If the customer shows a concrete buying or follow-up signal, pass when the agent advances it with an appropriate next step. Return not_applicable when no opportunity signal occurs.",
    inputType: "text",
    category: "sales",
    source: "built_in",
  },
  {
    id: "builtin:transfer-request",
    name: "Transfer request behavior",
    description: "Grades how the agent handles requests to speak with a human.",
    prompt: "When the customer requests a human, pass if the agent acknowledges the request and transfers, escalates, or clearly explains the next step without obstruction. Return not_applicable if no transfer is requested.",
    inputType: "text",
    category: "quality",
    source: "built_in",
  },
  {
    id: "builtin:compliance",
    name: "Compliance & guardrails",
    description: "Checks campaign guardrails, consent boundaries, unsupported claims, and pressure language.",
    prompt: "Pass only when the agent respects every supplied campaign guardrail. Fail on a specific prohibited claim, consent failure, sensitive-data request, or pressure tactic and cite the turn.",
    inputType: "text",
    category: "compliance",
    source: "built_in",
  },
];

export function getBuiltInVoiceEvalAgent(id: string): VoiceEvalAgent | undefined {
  return BUILT_IN_VOICE_EVAL_AGENTS.find((agent) => agent.id === id);
}
