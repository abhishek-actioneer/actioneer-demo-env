/**
 * Prompt for importing an existing client voicebot script.
 *
 * This model call is an INDEXING task, not an authoring task. Client scripts are
 * compliance artifacts — recording disclosures, RBI language, exact penalty
 * amounts and CIBIL claims are signed off by the client's legal team and cannot
 * be paraphrased. So the model is allowed to decide only:
 *   - which spoken beats belong to which stage
 *   - what each stage is called (using the document's own headings)
 *   - how stages route to each other
 *
 * It is not allowed to compose. Every spoken line must be copied
 * character-for-character out of the source, which
 * `verifyVerbatimSpokenLines` then checks mechanically — the prompt asks for
 * fidelity, the verifier is what actually enforces it.
 */

import type { VoiceUniversalRouteKind } from "@/lib/voice-campaign-flow";

/**
 * Role the model assigns to each placeholder token it sees.
 *
 * This has to come from the model rather than a token-name heuristic: in
 * "this is <Name> calling you from TVS Credit" the token is the AGENT, while in
 * "Am I speaking with Mr. <xxxx>" it is the customer. Both are bare name slots,
 * and guessing from the token alone gets the caller's own introduction wrong.
 */
export type ScriptPlaceholderRole =
  | "customer-name"
  | "agent-name"
  | "dataset-field"
  | "runtime-slot";

/**
 * House style the document was authored in. Voicebot-native docs are nearly
 * the workflow already; human-telecaller docs need heavier restructuring, so
 * downstream passes scale their effort by this field.
 */
export type ScriptImportGenre = "voicebot-native" | "human-telecaller" | "unknown";

/** The 10 canonical universal-route kinds, in stable display order. */
export const IMPORT_UNIVERSAL_ROUTE_KINDS = [
  "end_call",
  "do_not_call",
  "not_interested",
  "busy_callback",
  "wrong_person",
  "change_language",
  "question_confusion",
  "escalation",
  "silence_unclear",
  "voicemail_screening",
] as const satisfies readonly VoiceUniversalRouteKind[];

/**
 * A model-reported claim that an imported stage/line fulfils a universal route
 * kind. `sayLine`, when present, is copied verbatim from the node body and is
 * re-verified against the source before it is allowed to become route behavior.
 */
export interface ScriptImportRouteBinding {
  kind: VoiceUniversalRouteKind;
  nodeId: string;
  sayLine: string | null;
}

export interface ScriptImportPromptResult {
  campaignName: string;
  firstMessage: string;
  reasoning: string;
  detectedLanguage: string;
  genre: ScriptImportGenre;
  placeholders: Array<{ token: string; role: ScriptPlaceholderRole }>;
  universalRouteBindings: ScriptImportRouteBinding[];
  workflow: {
    title: string;
    description: string;
    objective: string;
    audienceHint: string;
    nodes: Array<{
      id: string;
      kind: "start" | "prompt" | "question" | "condition" | "action" | "transfer" | "end";
      title: string;
      body: string;
      helper: string | null;
    }>;
    edges: Array<{ source: string; target: string; label: string | null }>;
  };
}

export const MIN_IMPORT_NODES = 3;
export const MAX_IMPORT_NODES = 24;
export const MAX_ROUTE_BINDINGS = 12;

export const VOICE_SCRIPT_IMPORT_SCHEMA = {
  name: "voice_script_import",
  schema: {
    type: "object",
    properties: {
      campaignName: { type: "string" },
      firstMessage: { type: "string" },
      reasoning: { type: "string" },
      detectedLanguage: { type: "string" },
      genre: {
        type: "string",
        enum: ["voicebot-native", "human-telecaller", "unknown"],
      },
      universalRouteBindings: {
        type: "array",
        maxItems: MAX_ROUTE_BINDINGS,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: IMPORT_UNIVERSAL_ROUTE_KINDS },
            nodeId: { type: "string" },
            sayLine: { type: ["string", "null"] },
          },
          required: ["kind", "nodeId", "sayLine"],
          additionalProperties: false,
        },
      },
      placeholders: {
        type: "array",
        maxItems: 60,
        items: {
          type: "object",
          properties: {
            token: { type: "string" },
            role: {
              type: "string",
              enum: ["customer-name", "agent-name", "dataset-field", "runtime-slot"],
            },
          },
          required: ["token", "role"],
          additionalProperties: false,
        },
      },
      workflow: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          objective: { type: "string" },
          audienceHint: { type: "string" },
          nodes: {
            type: "array",
            minItems: MIN_IMPORT_NODES,
            maxItems: MAX_IMPORT_NODES,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                kind: {
                  type: "string",
                  enum: ["start", "prompt", "question", "condition", "action", "transfer", "end"],
                },
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
            minItems: 2,
            maxItems: 48,
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
    required: ["campaignName", "firstMessage", "reasoning", "detectedLanguage", "genre", "universalRouteBindings", "placeholders", "workflow"],
    additionalProperties: false,
  },
  strict: true,
} as const;

export function buildVoiceScriptImportPrompt(
  documentText: string,
  context?: { fileLabel?: string; companyName?: string; segmentName?: string },
): { system: string; user: string } {
  const company = context?.companyName?.trim();

  const system = `You are indexing an existing outbound voice-agent script into a structured campaign workflow.

This script is already written and already approved. Your job is to ORGANISE it, never to rewrite it.

ABSOLUTE RULE — VERBATIM SPOKEN TEXT
Every customer-facing line you output must be copied character-for-character from the source document.
- Do NOT reword, paraphrase, translate, shorten, expand, or merge spoken lines.
- Do NOT fix grammar, spelling, punctuation, capitalisation, or transliteration.
- Do NOT change any number, amount, percentage, date, rate, charge, or legal/regulatory wording.
- Do NOT "improve" tone or make lines sound more natural.
- Do NOT touch placeholder tokens. Leave {user_name}, {agent_name}, {emi_amount}, <Name>, <xxxx>, [date] exactly as written. They are rewritten downstream by deterministic code.
An automated checker compares every spoken line you emit against the source. Any line that is not an exact match is reported as an import failure, so copying is strictly better than composing.

HOW TO STRUCTURE
- Nodes are the document's own stages. Reuse the document's own section headings as node titles ("Bounce Notification", "Promise to Pay", "Callback Handling"). Do not invent a generic sales funnel.
- Use between ${MIN_IMPORT_NODES} and ${MAX_IMPORT_NODES} nodes. Group related beats into one stage rather than emitting one node per line.
- Exactly one node with kind "start" (the greeting / identity check). At least one node with kind "end" (the close).
- Choose kinds honestly: "question" when the agent asks and waits, "condition" when the document branches on a customer answer, "action" when the agent records/sends something, "transfer" for escalation or specialist handoff, "end" for a closing line.

NODE BODIES
- Put each customer-facing line on its own line prefixed exactly with "Say: ".
- When the document offers several interchangeable phrasings for the same stage (alternate pitches, "Or", numbered variants like G1/G2/G3, B4/B5), keep ALL of them as separate "Say: " lines in that stage's body. They are approved alternates; dropping them loses approved copy.
- Put agent-facing instructions on their own line prefixed exactly with "Note: " — e.g. "Note: Wait for confirmation from the customer.", "Note: Capture the reason code."
- Use the "helper" field for one short operator hint about the stage, or null.

WHAT IS NOT TALK TRACK — DO NOT TURN THESE INTO NODES OR SPOKEN LINES
- Version-control / document-history tables (VERSION, MAKER, CHECKER, CHANGE, DATE).
- Internal code lookups and dispositions (application stage codes, reason/issue code lists, CRM disposition tables).
- Headers, footers, page numbers, vendor instructions, and formatting notes.
Ignore this material entirely. If a code list is needed as context, summarise it in a "Note:" line — never as a "Say:" line.

ROUTING
- Derive edges from the document's explicit branching ("If the customer refuses…", "If not from TVS Credit…", "If the respondent is available…") and from stage order where the flow is linear.
- Label each edge with the customer condition that triggers it, in the document's own words where possible. Use null for a plain next-step edge.
- Every node except the start should be reachable.

COMPLETENESS
- Do not drop any customer-facing line from the document. If a line has no natural home, add a stage for it.
- If the document contains an FAQ or objection bank, keep those as "Say: " lines inside a dedicated stage.

PLACEHOLDERS — CLASSIFY, DO NOT REWRITE
List every distinct placeholder token in the document in the "placeholders" array, copied exactly as written (including its braces or angle brackets), with what it refers to:
- "customer-name": the person being called. e.g. {user_name}, {customer_name}, <xxxx> in "Am I speaking with Mr. <xxxx>".
- "agent-name": the calling agent's own name. e.g. {agent_name}, <Name> in "this is <Name> calling you from TVS Credit".
- "dataset-field": any other value looked up per customer — amounts, dates, product names, branch names, shop names.
- "runtime-slot": something decided during the conversation, e.g. a chosen language or a callback time the customer just gave.
Judge by how the token is USED in its sentence, not by its name. The same-looking token can be the agent in one line and the customer in another — read the surrounding sentence. Getting this wrong makes the agent introduce itself with the customer's name, so be careful with bare name tokens.

GENRE — WHAT KIND OF DOCUMENT IS THIS
Set "genre" to how the document was authored, judged from its structure:
- "voicebot-native": written FOR a voicebot — labelled utterance IDs (G1, B4, C2), one utterance per named intent, a dynamic-variables table, per-intent section headers.
- "human-telecaller": written for human agents — Agent:/Customer: dialogue prose, process instructions ("probe and dispose", "ask for a convenient time"), FAQ banks, version-control tables.
- "unknown": neither pattern clearly fits.

UNIVERSAL ROUTE BINDINGS — TAG, NEVER INVENT
Clients often include their own handling for situations that occur on any call. In "universalRouteBindings", tag which of your nodes fulfils each situation the document ACTUALLY covers:
- "end_call": the customer asks to stop the call / the approved closing line.
- "do_not_call": the customer asks never to be contacted again.
- "not_interested": the customer declines the pitch.
- "busy_callback": the customer is busy and a callback is arranged.
- "wrong_person": the person reached is not the intended customer.
- "change_language": the customer asks to switch language.
- "question_confusion": the customer asks a question or sounds confused.
- "escalation": the customer asks for a human agent / supervisor / branch.
- "silence_unclear": the customer is silent or cannot be heard clearly.
- "voicemail_screening": voicemail or call screening is detected.
For each binding, "nodeId" is the node whose content handles that situation. When ONE spoken line in that node specifically serves the route (e.g. the approved wrong-number apology), copy it into "sayLine" character-for-character from that node's body; otherwise use null. Bind only what the document contains — if the document has no handling for a kind, leave that kind out entirely. Never compose a line to fill a route.

OTHER FIELDS
- "firstMessage": the document's own opening greeting, copied verbatim as ONE spoken line. If several greeting variants exist, use the first. Do not join two separate lines together.
- "detectedLanguage": the language the spoken lines are actually written in — one of "Hinglish", "Hindi", "English", "Tamil", "Telugu", "Kannada", "Marathi", "Bengali", "Gujarati", "Odia", or "Mixed". Judge by the spoken lines, not the headings. Romanized Hindi/English mixture is "Hinglish".
- "campaignName": a short name for this campaign, based on the document's title.
- "reasoning": 1-2 sentences on how you segmented the document. This is the only field where you write in your own words.`;

  const user = [
    context?.fileLabel ? `Source file: ${context.fileLabel}` : "",
    company ? `Company: ${company}` : "",
    context?.segmentName ? `Intended audience segment: ${context.segmentName}` : "",
    "",
    "Index the following script document into a campaign workflow, copying all spoken lines verbatim:",
    "",
    "--- BEGIN SCRIPT DOCUMENT ---",
    documentText,
    "--- END SCRIPT DOCUMENT ---",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { system, user };
}
