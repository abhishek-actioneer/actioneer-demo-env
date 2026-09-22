import type { VoiceCampaign } from "./voice-campaign-types";
import { resolveCampaignCanonicalOpening } from "./voice-campaign-opening";
import { extractOpeningLineFromScript } from "./voice-campaign-opening";

/**
 * Running a campaign's outbound talk-track on an INBOUND call.
 *
 * The script authored in the studio assumes we dialed the customer: it opens by
 * confirming identity ("is this {{Customer Name}}?") and it addresses a known
 * recipient throughout. On an inbound call none of that holds — the caller
 * dialed us, we do not know who they are, and every {{placeholder}} is
 * unresolved. So we keep the campaign's workflow verbatim (stages, routing,
 * guardrails) and prepend a context block that re-frames who is calling whom.
 *
 * This is deliberately additive: the campaign prompt is never rewritten, only
 * framed, so what the user reads on the Script tab is what the agent runs.
 */

/**
 * Opening line for an inbound call: the campaign's own opening, spoken verbatim,
 * exactly as it reads on the Script tab. No placeholder substitution and no
 * rewrite — an unresolved {{Customer Name}} is spoken as written, which is the
 * deliberate trade for the first line being identical to the campaign's.
 *
 * The Inbound card's greeting field overrides it outright.
 */
export function buildCampaignInboundOpening(
  campaign: Pick<VoiceCampaign, "language" | "editableScript" | "systemPrompt" | "firstMessage" | "workflow">,
  greetingOverride?: string,
): string {
  if (greetingOverride?.trim()) return greetingOverride.trim();
  const opening = extractOpeningLineFromScript(campaign.editableScript ?? "")
    || resolveCampaignCanonicalOpening(campaign);
  // An inbound caller has no sampled customer context. Never speak a literal
  // {{Customer Name}} token: keep the authored introduction and convert the
  // outbound identity question into an inbound identity-confirmation question.
  // Do not invite an open-ended support conversation: that lets the model leave
  // the authored campaign before B1 has completed.
  if (/\{\{|\[\s*(?:customer\s*name|name|नाम)\s*\]/i.test(opening)) {
    const introduction = opening
      .replace(/\s*(?:Kya|क्या)\s+main\s+.*$/iu, "")
      .replace(/\{\{[^}]+\}\}|\[[^\]]+\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return `${introduction || "Namaste."} Kripya apna naam confirm karenge?`;
  }
  return opening;
}

/**
 * Prepend inbound framing to the campaign's compiled system prompt. Everything
 * after the block is the campaign's own workflow, untouched.
 */
export function adaptCampaignPromptForInbound(
  systemPrompt: string,
  campaign: Pick<VoiceCampaign, "voiceName" | "companyName" | "name">,
  fromNumber?: string,
): string {
  const agent = campaign.voiceName?.trim() || "the assistant";
  const company = campaign.companyName?.trim();

  const block =
    `INBOUND CALL CONTEXT — READ FIRST, THIS OVERRIDES THE SCRIPT'S FRAMING\n` +
    `You are ${agent}${company ? `, answering the phone for ${company}` : ""}. ` +
    `The customer called YOU — you did not dial them.\n` +
    `\n` +
    `What changes versus the script below:\n` +
    `- Your FIRST turn is supplied separately by the launch code. Say only that opening, exactly as instructed.\n` +
    `- Then STOP and wait. The caller has not said anything yet. Never acknowledge, answer, or assume a reply that has not happened, and never move to a later stage of the script until the caller has actually spoken.\n` +
    `- You do NOT know who is calling. The number they called from is NOT proof of identity.\n` +
    `- Any {{placeholder}} in the script (customer name, amounts, dates) is UNKNOWN. After the opening line, never say a placeholder out loud and never invent a value. Ask the caller for what you need, or say you'll need to verify it.\n` +
    `- If the caller queries anything odd in your opening, acknowledge it plainly and move on — do not explain that you are reading a script.\n` +
    `- This is campaign-script mode, not a general support or sales line. Do not invent or begin any product, loan, eligibility, qualification, or lead-capture flow.\n` +
    `- Complete B1 identity confirmation first, then B2, then B3. After B3, follow only the listed Routing notes. Do not jump to a stage merely because the caller mentions a product.\n` +
    `- Before anything account-specific, confirm identity first. If the caller asks about an unrelated matter, briefly explain that this call is for the campaign matter and return to the current required step.\n` +
    `${fromNumber ? `- The caller is dialing from ${fromNumber}.\n` : ""}` +
    `\n` +
    `What stays exactly the same: the conversation stages, routing rules, private guidance, tone, language, and every guardrail in the script below. Follow them as written.\n` +
    `\n` +
    `--- CAMPAIGN SCRIPT (${campaign.name || "campaign"}) ---\n\n`;

  return block + systemPrompt;
}
