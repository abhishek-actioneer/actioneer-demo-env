import type { Purpose } from "@/lib/purpose-types";
import type { Segment } from "@/lib/types";
import type { VoiceCampaignArchetype } from "@/lib/voice-archetypes";
import type { VoiceUniversalRoute } from "@/lib/voice-campaign-flow";
import type { CampaignDiagnostic } from "@/lib/voice-diagnostics";

export interface ScriptPromptResult {
  generation?: GeneratedVoiceAgentNarrative;
  campaignName: string;
  systemPrompt: string;
  firstMessage: string;
  reasoning: string;
  workflow: GeneratedVoiceWorkflow;
  successCriteria?: {
    primary: string;
    secondary: string[];
  };
  guardrails?: string[];
  /** Stamped server-side after the fact-ledger pass — never produced by the LLM. */
  diagnostics?: CampaignDiagnostic[];
  /** Intake's archetype pick, stamped server-side. */
  archetypeId?: string | null;
}

export interface GeneratedVoiceAgentNarrative {
  opening: {
    title: string;
    detail: string;
  };
  steps: Array<{
    id: string;
    title: string;
    detail: string;
  }>;
  designRationale: string;
  workflowPlanSummary: string;
  edgeRationale: string;
  routeRationale: string;
  validationPassed: string;
  completion: string;
}

export interface GeneratedVoiceWorkflowNode {
  id: string;
  kind: "start" | "prompt" | "question" | "condition" | "action" | "transfer" | "end";
  title: string;
  body: string;
  helper: string | null;
  /** Stamped server-side after parsing — excluded from LLM JSON schemas. */
  provenance?: "verbatim" | "generated" | "operator";
}

export interface GeneratedVoiceWorkflowEdge {
  source: string;
  target: string;
  label: string | null;
}

export interface GeneratedVoiceWorkflow {
  title: string;
  description: string;
  objective: string;
  audienceHint: string;
  nodes: GeneratedVoiceWorkflowNode[];
  edges: GeneratedVoiceWorkflowEdge[];
  universalRoutes?: VoiceUniversalRoute[];
}

export interface ScriptDatasetContext {
  id?: string;
  label?: string;
  companyName?: string;
  entityName?: string;
  systemContext?: string;
  domainHints?: string;
  reportMeta?: {
    totalEvents?: string;
    totalUsers?: string;
    dateRangeLabel?: string;
    dbName?: string;
  };
}

function compact(value: string | undefined, maxLength = 1400): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function companyLabel(dataset?: ScriptDatasetContext): string {
  return dataset?.companyName?.trim() || dataset?.label?.trim() || "the company";
}

function entityName(dataset?: ScriptDatasetContext): string {
  return dataset?.entityName?.trim() || "customers";
}

function datasetBlock(dataset?: ScriptDatasetContext): string {
  return [
    `Dataset/company: ${companyLabel(dataset)}`,
    `Primary audience entity: ${entityName(dataset)}`,
    dataset?.id ? `Dataset ID: ${dataset.id}` : "",
  ].filter(Boolean).join("\n");
}

export function buildVoiceCampaignScriptPrompt(
  segment: Pick<Segment, "name" | "sql" | "userCount" | "description"> & Partial<Pick<Segment, "id">>,
  purpose: Purpose,
  language: string,
  dataset?: ScriptDatasetContext,
  campaignBrief?: string,
  agentName?: string,
  agentGender?: "female" | "male" | "unknown",
  options?: { fullAgent?: boolean; archetype?: VoiceCampaignArchetype; knownFacts?: string[] },
): { system: string; user: string } {
  const company = companyLabel(dataset);
  const entity = entityName(dataset);
  const localeInstruction =
    "Use contemporary Indian conversational pronunciation and phrasing appropriate to the selected language.";
  const isBriefOnlyPurpose = purpose.category === "campaign-brief";
  const purposeAuthoringRule = isBriefOnlyPurpose
    ? "- The user supplied a campaign objective without a separate product or offer. Follow that objective and do not invent a product, price, rate, eligibility rule, or promotional claim."
    : "- Bake offer facts (price/rate, eligibility, benefits, close) into value-explanation and Q&A node bodies as sample spoken lines";
  const callbackPreparationRule = isBriefOnlyPurpose
    ? "- Before suggesting any callback or expert connection, the agent must ask at least one segment-specific discovery question and give at least one useful explanation grounded in the campaign brief. Do not invent missing offer facts."
    : "- Before suggesting any callback or expert connection, the agent must ask at least one segment-specific discovery question and give at least one useful, concrete answer or explanation grounded in the offer facts woven into the script.";
  const agentInstruction = agentName?.trim()
    ? `Use "${agentName.trim()}" as the agent name/persona.`
    : "Choose a simple Indian first name for the agent persona.";
  const genderInstruction = agentGender && agentGender !== "unknown"
    ? `The selected voice is ${agentGender}. All first-person wording must match a ${agentGender} speaker. For Hindi, male voices use forms like "कर रहा हूँ", "कर दूँगा", and "समझा"; female voices use "कर रही हूँ", "कर दूँगी", and "समझी". For Hinglish, male voices use "kar raha hoon", "kar dunga", and "samjha"; female voices use "kar rahi hoon", "kar dungi", and "samjhi". Never make a male voice read female first-person grammar, or a female voice read male first-person grammar.`
    : "Keep the agent name and first-person grammar internally consistent.";
  const fullAgent = options?.fullAgent === true;
  const archetype = options?.archetype;
  const knownFacts = (options?.knownFacts ?? []).map((fact) => fact.trim()).filter(Boolean);
  const archetypeBlock = archetype
    ? `
CAMPAIGN ARCHETYPE: ${archetype.label} (${archetype.id})
Use these stages in this order as your node plan; adapt titles to the campaign but keep the flow:
${archetype.stages.map((stage, index) => `${index + 1}. [${stage.kind}] ${stage.title} — ${stage.goal}`).join("\n")}

Conversation slots — the call must establish these; phrase questions to elicit them:
${archetype.slots.map((slot) => `- ${slot.name} (${slot.type}${slot.values?.length ? `: ${slot.values.join(" | ")}` : ""})`).join("\n")}

ALLOWED FACT SOURCES
The only sources a number, rate, amount, fee, date, tenure, or eligibility claim may come from:
1. The campaign brief (quoted in the user message).${knownFacts.length ? `
2. Known facts extracted from the brief:
${knownFacts.map((fact) => `   - ${fact}`).join("\n")}` : ""}
${knownFacts.length ? "3" : "2"}. Archetype safe defaults:
${archetype.safeDefaultFacts.map((fact) => `   - ${fact}`).join("\n")}
Any number, rate, amount, date, or eligibility claim not present in these sources MUST be written as a {{Placeholder}} token (for example {{Amount}}, {{Rate}}, {{Date}}), never invented — a deterministic checker rejects unsourced facts.
`
    : "";
  const system = `You are authoring an outbound AI voice campaign for ${company}. The campaign brief is the primary source of intent. Any explicit purpose/offer facts are AUTHORING INPUT ONLY — bake relevant supplied facts into the workflow talk track. The live call runtime will recompile its system prompt from company + operator script/workflow + guardrails, and will NOT inject a separate purpose/offer facts block.

Your job:
1. Write a concrete workflow (nodes/edges) whose spoken lines contain every product/offer fact the agent may say
2. Write a short firstMessage opening
3. Write a SHORT placeholder systemPrompt (persona + language only; do not dump offer catalog facts there)
4. Handle a real two-way conversation via workflow instructions — answering questions, objections, natural responses

Rules for workflow / talk track:
${purposeAuthoringRule}
- The agent should feel like a knowledgeable, natural phone representative, not a robot reading a script
- Ground the call in ${company} and the selected ${entity} segment via spoken lines, not a separate facts dump
- Include how to handle common objections ("I'm busy", "Not interested", "Tell me more", "How do I apply?")
- The customer's latest concern must override the campaign path. If they mention any blocker, confusion, objection, or practical problem, the agent must help solve or triage that concern before returning to the offer or callback.
- Keep responses conversational and interruption-friendly, but not clipped or robotic.
- Default to one clear intent per turn. Most useful replies should be 1 to 3 short spoken sentences, around 25 to 55 words total.
- Separate authoring from speech: workflow node titles and bodies are edited by human operators, so write them in simple English or romanized Hinglish, not Devanagari, even when the selected spoken language is Hindi.
- In workflow node bodies, prefix sample customer-facing lines with "Say:" and keep them easy to edit in romanized Hinglish or simple English. The runtime will adapt those samples to the selected spoken language.
- For Hinglish spoken output, use natural romanized Hinglish.
- For Tamil / Telugu / Kannada spoken output, use casual phone-agent speech only (பேச்சுத் தமிழ் / casual Telugu / casual Kannada) — short warm call lines, never formal literary or textbook forms.
- ${localeInstruction}
- For Indian languages only, use light fillers when natural: "haan", "achha", "theek hai", "ek sec", and gender-matched "samjha"/"samjhi". For Spanish, French, German, and Italian, use only native conversational particles appropriate to that language.
- Write workflow authoring text for spoken language ${language}
- ${agentInstruction}
- ${genderInstruction}
${`- For second-person forms addressing the customer (any "aap" construction), use gender-neutral defaults in all node bodies: prefer "kar rahe hain", "sakte hain", "samajh gaye", "chahte hain". Never write "kar rahi hain", "sakti hain", "samajh gayi" in node bodies — customer gender is unknown at script authoring time and will be detected at runtime.`}
- Do NOT use filler phrases like "Absolutely!" or "Great question!"
- Do NOT make the first useful response an expert callback, specialist transfer, or advisor handoff.
${callbackPreparationRule}
- Expert/advisor callback is a late-stage route — not the default pitch.
- Workflow node bodies must be concrete talk-track instructions with example phrasing the caller can actually say.
- Do not write meta phrases like "ask a segment-specific discovery question" as the node body. Spell out the actual question, explanation, objection response, or route rule.
- Workflow node titles and bodies must remain easy for an English-keyboard operator to edit. Do not generate Devanagari workflow text unless the user explicitly asks for a Hindi-script authoring format.
${archetypeBlock}
Rules for the placeholder systemPrompt field:
- Keep it short: persona ("You are … from ${company}"), default language ${language}, and "follow the campaign script/workflow".
- Do NOT paste Campaign purpose details, price/rate catalogs, or segment SQL into systemPrompt.
- Runtime will replace/rebuild this from company + script + workflow + guardrails.

The "firstMessage" is what the agent says immediately when the call connects - a warm, natural greeting in ${language} under 20 words that names ${company}. It must not include the pitch, offer, or reason for calling. If language is Hindi or Hinglish, prefer romanized spoken Hinglish for this editable opening unless the user explicitly asks for Devanagari. Asking which language the customer prefers is allowed when the brief requests it.

Respond with a JSON object:
{
  ${fullAgent ? `"generation": {
    "opening": {
      "title": "<short live status written for this exact request>",
      "detail": "<what you understood about the goal, audience, language, and voice choice>"
    },
    "steps": [
      {
        "id": "<lowercase-kebab-id>",
        "title": "<specific build decision or action>",
        "detail": "<concise explanation grounded in this campaign>"
      }
    ],
    "designRationale": "<why this conversational approach fits this audience and objective>",
    "workflowPlanSummary": "<natural introduction to the workflow you designed>",
    "edgeRationale": "<why you connected and branched the workflow this way>",
    "routeRationale": "<how interruption, consent, callback, and escalation routes fit this campaign>",
    "validationPassed": "<what makes the completed workflow coherent and safe once deterministic validation passes>",
    "completion": "<campaign-specific summary to show only after the draft is saved>"
  },` : ""}
  "campaignName": "<short campaign name>",
  "systemPrompt": "<short placeholder persona prompt — no offer catalog dump>",
  "firstMessage": "<opening line, under 20 words>",
  "reasoning": "<1-2 sentences on why this approach suits this segment>",
  "workflow": {
    "title": "<short workflow title>",
    "description": "<one sentence description>",
    "objective": "<call objective grounded in the campaign brief>",
    "audienceHint": "<why this audience is being contacted>",
    "nodes": [
      {
        "id": "<lowercase-kebab-id>",
        "kind": "start | prompt | question | condition | action | transfer | end",
        "title": "<short node title>",
        "body": "<specific instruction for this step>",
        "helper": "<optional short operator note or null>"
      }
    ],
    "edges": [
      { "source": "<node id>", "target": "<node id>", "label": "<route label or null>" }
    ]${fullAgent ? `,
    "universalRoutes": [
      {
        "kind": "end_call | do_not_call | not_interested | busy_callback | wrong_person | change_language | question_confusion | escalation | silence_unclear | voicemail_screening",
        "label": "<short route label>",
        "trigger": "<specific customer signal>",
        "behavior": "<safe response and next action>",
        "targetNodeId": "<existing node id or null>",
        "terminal": true
      }
    ]` : ""}
  }${fullAgent ? `,
  "successCriteria": {
    "primary": "<observable primary outcome>",
    "secondary": ["<observable supporting outcome>"]
  },
  "guardrails": ["<specific safety, consent, or accuracy boundary>"]` : ""}
}`;

  const purposeBlock = isBriefOnlyPurpose
    ? `Campaign direction (derived from the user's brief; this is not a separate product or offer):
- Objective: ${purpose.description}
- Desired next step: ${purpose.cta}
- Do not add catalog products or commercial terms that are not stated in the brief.`
    : `Campaign purpose details (AUTHORING ONLY — weave into workflow spoken lines; do not dump into systemPrompt):
- Product: ${purpose.name}
- Category: ${purpose.category}
- Tagline: ${purpose.tagline}
- Full description: ${purpose.description}
- Key benefit to lead with: ${purpose.valueProp}
- Price / rate: ${purpose.priceDisplay}
- How to close: "${purpose.cta}"`;
  const valueExplanationRequirement = isBriefOnlyPurpose
    ? "- Include a useful explanation step grounded in the campaign brief. Do not introduce an unrelated catalog product."
    : "- Include a value explanation step with the exact short explanation the agent can give using offer facts from this purpose.";

  const user = `${datasetBlock(dataset)}

Campaign brief:
${compact(campaignBrief || "Create a focused outbound campaign for the selected audience and offer.", 1600)}

Segment: "${segment.name}"
Segment ID: ${segment.id || "selected-segment"}
Segment size: ${segment.userCount.toLocaleString()} ${entity}

${purposeBlock}

Generate a campaign name, first message, short placeholder systemPrompt, and a workflow for the campaign studio.

Workflow requirements:
- Use ${fullAgent ? "7 to 12" : "5 to 8"} nodes.
- Include exactly one start node and at least one end node.
- Keep the start node limited to call connection / language preference / permission to speak (per brief).
- Make the workflow specific to this segment and use case, not a generic high-intent sales template.
- Include a discovery step with the exact question the agent should ask this audience.
${valueExplanationRequirement}
- Include an objection or concern-handling route with specific if/then criteria and a sample response.
- Include a route for unexpected customer problems: acknowledge the issue, clarify what is blocking them, suggest the next best step, then bridge back to the campaign goal if the customer is still engaged.
- Do not route directly from interest to expert transfer. Handoff can appear only after discovery + explanation + fit/concern handling.
- Use prompt nodes for context setting, question nodes for customer discovery, condition nodes for routing, action nodes for sending details or capturing notes, transfer nodes for callback or specialist handoff, and end nodes for polite close.
- Keep node bodies specific enough that they compile into a runnable voice-agent prompt.
- Every node body should include one very short sample spoken line, then private signal/next-step guidance.
- Keep every sample spoken line natural for a phone call, usually one sentence; it may be 25 to 45 words when explaining value or context.
- Do not write node bodies that encourage one-turn monologues.
- Condition nodes must list clear branches in plain language, for example: "अगर amount confusion है तो explain node पर जाएं; अगर अभी interested नहीं हैं तो close करें."
- Do not invent offer facts, prices, eligibility, guarantees, or legal claims.
- Make the workflow match the campaign brief, not a generic template.${fullAgent ? `
- Make every generation status and narrative specific to this request. Do not use generic build narration such as "understanding the goal", "building the workflow", or "saving the agent".
- The generation.steps array is the user-facing build trace. Choose 4 to 8 meaningful steps based on the actual work this campaign requires; do not follow a fixed phase template.
- Explain decisions without claiming to reveal private chain-of-thought. Keep each detail concise, concrete, and suitable for an audit log.
- Include a transfer node for unresolved or disputed issues.
- Add exactly one universal route for each of these kinds: end_call, do_not_call, not_interested, busy_callback, wrong_person, change_language, question_confusion, escalation, silence_unclear, voicemail_screening.
- Universal routes apply from every non-terminal state. Point routes to an existing workflow node when the response requires continued handling; terminal routes may target an end node.
- Include observable success criteria derived only from the campaign goal.
- Include concise guardrails covering consent, unsupported claims, sensitive data, pressure, and the campaign-specific risks implied by the goal.` : ""}`;

  return { system, user };
}
