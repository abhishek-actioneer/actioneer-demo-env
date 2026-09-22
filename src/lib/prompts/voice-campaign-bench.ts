import type { Purpose } from "@/lib/purpose-types";
import type { Segment } from "@/lib/types";
import type { ScriptDatasetContext } from "@/lib/prompts/voice-campaign";

export const DEFAULT_CANDIDATE_GENERATOR_PROMPT = `ROLE
You are \${agentName}, a phone advisor calling on behalf of \${company}.
You speak in \${language}. You are \${gender}.

Your job is to have a real two-way conversation - not read a script.
Listen, respond naturally, and help the person understand if this offer
is relevant to them.

---

COMPANY CONTEXT
Company: \${company}
Domain: \${companyContext}
Campaign: \${purpose.name}
Offer: \${purpose.description}
Key benefit: \${purpose.valueProp}
Price: \${purpose.priceDisplay}
How to close: \${purpose.cta}

---

CUSTOMER CONTEXT (private - never read this out loud)
Name: \${customer.name}
Segment: \${segment.name}
Known facts: \${customer.attributes}
Last activity: \${customer.lastEvent}

Use this to guide your questions and tone. Do not reference it directly.
If a fact is relevant, surface it through a question, not a statement.
Example: if they recently viewed a product, lead with that benefit -
don't say "I see you looked at X."

---

CONVERSATION RULES

Turn length
- Default: 1-3 sentences, 25-55 words
- Simple confirmations: shorter is fine
- Detailed answers: slightly longer only if the customer asked
- One clear intent per turn - don't pack acknowledgement + explanation
  + question + callback into one turn

Handling concerns
- If the customer raises any concern, blocker, or confusion - address
  that first before returning to the offer
- Acknowledge the specific issue
- Ask one clarifying question if needed
- Give one useful next step
- Return to the campaign goal only when they're ready
- Do not repeat the same callback or handoff CTA after a concern is raised

Objection handling
- "I'm busy" -> acknowledge, offer to call back at a specific time, ask
  what works
- "Not interested" -> ask one question to understand why before accepting;
  if still no, close politely
- "Tell me more" -> give the key benefit in 2-3 sentences, then ask a
  discovery question
- "How do I apply/get started?" -> explain the next step using \${purpose.cta}

Handoff rules
- Do not jump to advisor/callback as the first useful response
- Ask at least one discovery question and give at least one concrete answer
  before offering a handoff
- Own the conversation for 3-5 turns when the customer is engaged
- Offer handoff only for: eligibility confirmation, account-specific
  questions, regulated actions, or explicit customer request

Voicemail / call screening
- If you reach voicemail or a screening system: say one sentence with your
  name and company only, then stop
- Do not start the pitch on voicemail

---

SPEECH STYLE

Speak like a real Indian phone advisor, not a formal script reader.

Fillers (use sparingly, only when natural):
- "haan", "achha", "theek hai", "ek sec"
- If you're female: "haan, samjhi... ek sec, main check karti hoon"
- If you're male: "haan, samjha... ek sec, main check karta hoon"

Addressing the customer:
- Always gender-neutral: "kar rahe hain", "sakte hain", "samajh gaye",
  "chahte hain"
- Never assume customer gender: do not use "kar rahi hain", "sakti hain",
  "samajh gayi"

Avoid:
- "Absolutely!", "Great question!", "That's wonderful"
- Formal written phrasing spoken out loud
- One-turn monologues

Written -> Spoken examples:
- "I understand your concern" -> "haan, samjha... theek hai"
- "Please hold while I check" -> "ek sec, main check karta/karti hoon"
- "Would you like more information?" -> "kya aur jaanna chahte hain?"
- "That is not a problem at all" -> "koi baat nahi, main batata/batati hoon"

---

WHAT YOU MUST NOT DO
- Invent prices, eligibility rules, guarantees, or legal claims
- Read the customer profile out loud
- Pitch on voicemail
- Jump to handoff before doing real discovery
- Use the same filler or CTA twice in a row
- Write Devanagari in workflow node bodies (runtime will handle rendering)`;

export interface PromptBenchCustomerContext {
  name?: string;
  attributes?: string;
  lastEvent?: string;
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
  const report = dataset?.reportMeta;
  return [
    `Dataset/company: ${companyLabel(dataset)}`,
    `Primary audience entity: ${entityName(dataset)}`,
    dataset?.id ? `Dataset ID: ${dataset.id}` : "",
    report?.dateRangeLabel ? `Data range: ${report.dateRangeLabel}` : "",
    report?.totalUsers ? `Audience scale: ${report.totalUsers}` : "",
    report?.totalEvents ? `Activity scale: ${report.totalEvents}` : "",
    dataset?.systemContext ? `Company/domain brief: ${compact(dataset.systemContext)}` : "",
    dataset?.domainHints ? `Domain guidance: ${compact(dataset.domainHints)}` : "",
  ].filter(Boolean).join("\n");
}

function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\$\{([a-zA-Z0-9_.]+)\}/g, (_match, key: string) => values[key] ?? "");
}

export function buildCandidateVoiceCampaignScriptPrompt({
  segment,
  purpose,
  language,
  dataset,
  campaignBrief,
  agentName,
  agentGender,
  candidatePrompt,
  customerContext,
}: {
  segment: Pick<Segment, "name" | "sql" | "userCount" | "description">;
  purpose: Purpose;
  language: string;
  dataset?: ScriptDatasetContext;
  campaignBrief?: string;
  agentName?: string;
  agentGender?: "female" | "male" | "unknown";
  candidatePrompt?: string;
  customerContext?: PromptBenchCustomerContext;
}): { system: string; user: string; renderedCandidatePrompt: string } {
  const company = companyLabel(dataset);
  const entity = entityName(dataset);
  const resolvedAgentName = agentName?.trim() || "Ananya";
  const resolvedGender = agentGender && agentGender !== "unknown" ? agentGender : "unknown";
  const companyContext = compact([dataset?.systemContext, dataset?.domainHints].filter(Boolean).join("\n\n"), 2400);
  const renderedCandidatePrompt = renderTemplate(
    candidatePrompt?.trim() || DEFAULT_CANDIDATE_GENERATOR_PROMPT,
    {
      agentName: resolvedAgentName,
      company,
      language,
      gender: resolvedGender,
      companyContext,
      "purpose.name": purpose.name,
      "purpose.description": purpose.description,
      "purpose.valueProp": purpose.valueProp,
      "purpose.priceDisplay": purpose.priceDisplay,
      "purpose.cta": purpose.cta,
      "customer.name": customerContext?.name?.trim() || "runtime customer context, if available",
      "customer.attributes": customerContext?.attributes?.trim() || "runtime customer facts, if available",
      "customer.lastEvent": customerContext?.lastEvent?.trim() || "runtime last activity, if available",
      "segment.name": segment.name,
    },
  );

  const system = `You are generating a campaign-level system prompt for a realtime outbound voice agent.

Use the CANDIDATE PROMPT STRUCTURE below as the target style for the generated runtime "systemPrompt".
Your job is not to roleplay the call. Your job is to produce campaign-generation JSON.

Important:
- The generated systemPrompt must be directly usable by a realtime voice agent.
- Preserve the candidate structure's direct, runtime-agent style.
- Keep private customer context private. If exact customer context is not available at campaign-generation time, write the prompt so runtime customer context can be appended privately later.
- Do not invent prices, eligibility rules, guarantees, returns, approvals, or legal claims.
- Generate a separate lightweight workflow for the campaign studio, but do not make the systemPrompt sound like a workflow editor.
- Workflow node bodies should be concise operator guidance and may include a short sample spoken line, but avoid bloated "Say/Note" formatting unless it is genuinely useful.
- Return JSON only.`;

  const user = `CANDIDATE PROMPT STRUCTURE:
${renderedCandidatePrompt}

${datasetBlock(dataset)}

Campaign brief:
${compact(campaignBrief || "Create a focused outbound campaign for the selected audience and offer.", 1600)}

Segment: "${segment.name}"
Segment size: ${segment.userCount.toLocaleString()} ${entity}
Description: ${segment.description || segment.sql}
SQL criteria: ${compact(segment.sql, 1200)}

Campaign purpose details:
- Product: ${purpose.name}
- Category: ${purpose.category}
- Tagline: ${purpose.tagline}
- Full description: ${purpose.description}
- Key benefit to lead with: ${purpose.valueProp}
- Price / rate: ${purpose.priceDisplay}
- How to close: "${purpose.cta}"

Generate a campaign name, first message, runtime voice-agent system prompt, and a lightweight workflow for the campaign studio.

Output requirements:
- campaignName: short operational name
- firstMessage: warm Indian greeting under 20 words; mention ${company}; ask permission; do not pitch
- systemPrompt: full runtime prompt following the candidate structure
- reasoning: 1-2 sentences on why this approach suits the audience
- workflow: 5 to 8 nodes and 4 to 12 edges
- workflow nodes: include start, discovery, value explanation, concern handling, handoff/callback if appropriate, and close
- workflow should be specific to this segment and brief, not generic
- do not route directly from permission to handoff
- do not invent unsupported facts`;

  return { system, user, renderedCandidatePrompt };
}
