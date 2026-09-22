/**
 * Pass 0 intake (docs/script-generator-design.md, "Pass 0 — Intake").
 *
 * One cheap structured call that classifies the request before any script is
 * authored: which archetype the campaign fits, what facts the brief actually
 * supplies, and which facts the archetype needs that the brief lacks. The
 * result routes the generation prompt — it never authors campaign copy itself.
 */

export interface VoiceIntakeResult {
  mode: "generate" | "import" | "hybrid";
  archetypeId: string | null;
  sector: "bfsi-collections" | "bfsi-sales" | "health" | "unknown";
  languages: string[];
  agentGender: "female" | "male" | "unknown";
  knownFacts: string[];
  openQuestions: string[];
}

export const VOICE_INTAKE_SCHEMA = {
  name: "voice_campaign_intake",
  schema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["generate", "import", "hybrid"] },
      archetypeId: { type: ["string", "null"] },
      sector: { type: "string", enum: ["bfsi-collections", "bfsi-sales", "health", "unknown"] },
      languages: { type: "array", maxItems: 6, items: { type: "string" } },
      agentGender: { type: "string", enum: ["female", "male", "unknown"] },
      knownFacts: { type: "array", maxItems: 24, items: { type: "string" } },
      openQuestions: { type: "array", maxItems: 12, items: { type: "string" } },
    },
    required: ["mode", "archetypeId", "sector", "languages", "agentGender", "knownFacts", "openQuestions"],
    additionalProperties: false,
  },
  strict: true,
} as const;

export interface VoiceIntakePromptInput {
  brief?: string;
  docSummary?: string;
  datasetLabel?: string;
  segmentName?: string;
  archetypeCatalog: Array<{ id: string; label: string; sector: string; description: string }>;
}

export function buildVoiceIntakePrompt(input: VoiceIntakePromptInput): { system: string; user: string } {
  const catalogLines = input.archetypeCatalog
    .map((archetype) => `- id: "${archetype.id}" | sector: ${archetype.sector} | ${archetype.label} — ${archetype.description}`)
    .join("\n");

  const system = `You are classifying a request to create an outbound AI voice campaign. You do NOT write any script content — you only classify the request so the right generation path runs next.

ARCHETYPE CATALOG (the only valid archetypeId values):
${catalogLines}

Decide:
1. "mode": "import" if the request is primarily about an uploaded/attached client script document, "generate" if it is a brief with no document, "hybrid" if both a document and a directive are present.
2. "archetypeId": the single best-fitting id from the catalog above, or null if none fits. Never invent an id that is not in the catalog.
3. "sector": the catalog sector of the chosen archetype, or your best classification of the request; "unknown" if unclear.
4. "languages": the spoken languages the request asks for (e.g. "Hinglish", "Hindi", "English", "Tamil"). Empty array if unspecified.
5. "agentGender": "female" or "male" only when the request states or grammatically implies the agent's voice gender; otherwise "unknown".
6. "knownFacts": every concrete fact the brief supplies that the script may speak — amounts, rates, fees, dates, tenures, offer terms, eligibility rules, product names. Copy each as a LITERAL substring of the brief, verbatim, one fact per entry. Do not paraphrase, normalize, or invent. Empty array if the brief supplies none.
7. "openQuestions": facts the chosen archetype needs to run this call that the brief does NOT supply (e.g. the EMI amount for a collections reminder, the offer rate for a cross-sell). Phrase each as a short question to the operator. Empty array if nothing is missing or no archetype was chosen.

Classify only. Do not answer the open questions yourself and do not add facts that are not in the brief.`;

  const user = [
    input.datasetLabel ? `Dataset/company: ${input.datasetLabel}` : "",
    input.segmentName ? `Target segment: ${input.segmentName}` : "",
    input.brief ? `Campaign brief:\n${input.brief}` : "Campaign brief: (none provided)",
    input.docSummary ? `Uploaded document summary:\n${input.docSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}
