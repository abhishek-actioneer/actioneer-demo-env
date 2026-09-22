import type { VoiceCampaign } from "./voice-campaign-types";
import {
  appendVoiceCustomerContextToSystemPrompt,
  applyVoiceCustomerPlaceholders,
  restoreCustomerNamePlaceholdersFromEditableScript,
  sanitizeFundsIndiaLiveTestPrompt,
  type VoiceCustomerContext,
} from "./voice-customer-context";
import {
  appendLinkToolHintToSystemPrompt,
  renderUniversalRoutesSection,
  type VoiceFlowNode,
} from "./voice-campaign-flow";
import { geminiVoiceGender } from "./gemini-voices";
import { resolveLinkSuccessConfig } from "./voice-campaign-success";
import { resolveCampaignCanonicalOpening } from "./voice-campaign-opening";
import { extractOpeningLineFromScript } from "./voice-campaign-opening";

function editableScriptRuntimePrompt(campaign: VoiceCampaign): string | undefined {
  const script = campaign.editableScript?.trim();
  if (!script) return undefined;

  const persona = campaign.personaPrompt?.trim() || [
    `You are ${campaign.voiceName?.trim() || "a phone advisor"}${campaign.companyName?.trim() ? ` from ${campaign.companyName.trim()}` : ""}.`,
    "You are having a focused real-time phone conversation.",
  ].join("\n");

  // Universal routes must reach a live call on this path too — imported and
  // script-edited campaigns dial through here, not through the compiled prompt.
  const routesSection = renderUniversalRoutesSection(
    campaign.workflow?.universalRoutes ?? [],
    (campaign.workflow?.nodes ?? []) as VoiceFlowNode[],
  );

  return `${persona}${routesSection ? `\n\n${routesSection}` : ""}

Company:
${campaign.companyName?.trim() || "the company"}

Campaign:
${campaign.name}

# CAMPAIGN SCRIPT — PRIMARY SOURCE OF TRUTH
The operator-authored script below is the only source of campaign facts and call flow.
- Follow its numbered steps and Routing notes.
- Lines beginning with "Say:" are approved customer-facing speech. When that step is active, deliver its Say line before stopping to listen; do not replace it with a different product flow or improvised script.
- Lines beginning with "Note:" and all Routing notes are private control instructions. Never read them aloud.
- Do not invent, substitute, or introduce products, offers, rates, fees, amounts, eligibility, or claims that are absent from this script.
- Handle the customer's latest question or interruption before continuing the route.
- Speak one short turn at a time, then stop and listen.
- Never skip ahead until the customer has actually responded.
- Never turn this collections campaign into a generic support, new-loan, sales, qualification, or lead-capture conversation.

${script}

Runtime contract:
- Return only the next spoken line.
- Do not use markdown or stage directions.
- Do not expose private notes, routing labels, placeholders, or internal fields.
- If a placeholder has no known value, ask for or verify it before discussing account-specific details.`;
}

/**
 * The campaign's compiled talk-track, ready for a live call: system prompt,
 * opening line, and link-success config.
 *
 * Extracted from the outbound call-user route so the inbound answer route can
 * run the *same* workflow rather than a parallel re-implementation — when a
 * number is bound in "campaign-script" mode, both directions must compile the
 * script identically or the two paths silently drift apart.
 */
export interface CampaignRuntimePrompt {
  systemPrompt: string;
  firstMessage: string;
  linkDest?: string;
  linkWindowDays?: number;
  linkTemplate?: string;
}

/**
 * Few-shot style demonstration turns seeded into Gemini Live's initial client
 * content (behind GEMINI_LIVE_SEED_TURNS — see seedTurnsEnabled). Two
 * exchanges: one short model turn showing ideal length/register in the
 * campaign language + agent gender, then a customer interruption with a brief
 * model recovery. Deliberately generic — no offer facts, no amounts, no
 * digits — so seeding can never leak campaign-specific claims.
 */
export function buildVoiceSeedTurns(
  campaign: VoiceCampaign,
): Array<{ role: "user" | "model"; text: string }> {
  const gender = geminiVoiceGender(campaign.voice || campaign.voiceName || "");
  const language = (campaign.language || "").trim().toLowerCase();

  if (language.includes("hinglish")) {
    const demo = gender === "male"
      ? "Ji namaste, main aapse ek chhoti si zaroori baat karne ke liye call kar raha hoon. Kya abhi thodi baat ho sakti hai?"
      : gender === "female"
        ? "Ji namaste, main aapse ek chhoti si zaroori baat karne ke liye call kar rahi hoon. Kya abhi thodi baat ho sakti hai?"
        : "Ji namaste, yeh ek chhoti si zaroori service call hai. Kya abhi aapse thodi baat ho sakti hai?";
    const recovery = gender === "male"
      ? "Ji bilkul, samjha. Aap bataiye, baad mein kab baat karna theek rahega?"
      : gender === "female"
        ? "Ji bilkul, samjhi. Aap bataiye, baad mein kab baat karna theek rahega?"
        : "Ji bilkul, koi baat nahi. Aap bataiye, baad mein kab baat karna theek rahega?";
    return [
      { role: "user", text: "Hello, haan boliye." },
      { role: "model", text: demo },
      { role: "user", text: "Ek second, main abhi thoda busy hoon." },
      { role: "model", text: recovery },
    ];
  }

  if (language.includes("hindi")) {
    const demo = gender === "male"
      ? "जी नमस्ते, मैं आपसे एक छोटी सी ज़रूरी बात करने के लिए कॉल कर रहा हूँ। क्या अभी थोड़ी बात हो सकती है?"
      : gender === "female"
        ? "जी नमस्ते, मैं आपसे एक छोटी सी ज़रूरी बात करने के लिए कॉल कर रही हूँ। क्या अभी थोड़ी बात हो सकती है?"
        : "जी नमस्ते, यह एक छोटी सी ज़रूरी सेवा कॉल है। क्या अभी आपसे थोड़ी बात हो सकती है?";
    const recovery = gender === "male"
      ? "जी बिल्कुल, समझा। आप बताइए, बाद में कब बात करना ठीक रहेगा?"
      : gender === "female"
        ? "जी बिल्कुल, समझी। आप बताइए, बाद में कब बात करना ठीक रहेगा?"
        : "जी बिल्कुल, कोई बात नहीं। आप बताइए, बाद में कब बात करना ठीक रहेगा?";
    return [
      { role: "user", text: "हेलो, हाँ बोलिए।" },
      { role: "model", text: demo },
      { role: "user", text: "एक सेकंड, मैं अभी थोड़ी जल्दी में हूँ।" },
      { role: "model", text: recovery },
    ];
  }

  // Default: Indian English, gender-neutral phrasing.
  return [
    { role: "user", text: "Hello, yes, who is this?" },
    { role: "model", text: "Good day ji, this is a short service call from our team. May I take a quick minute of your time?" },
    { role: "user", text: "Sorry, hold on, I am a little busy right now." },
    { role: "model", text: "Of course, no problem at all. When would be a good time to call you back?" },
  ];
}

export function buildCampaignRuntimePrompt(
  campaign: VoiceCampaign,
  customerContext?: VoiceCustomerContext,
): CampaignRuntimePrompt {
  // Prompt-source contract:
  // 1. systemPromptSource === "compiled" — the PATCH/create routes recompiled
  //    systemPrompt from the current workflow + editableScript on the last
  //    save, so it is trustworthy and carries the full compiled rule stack.
  //    Use it directly (placeholder restoration still applies below).
  // 2. Otherwise (legacy persistence): older saves only wrote editableScript,
  //    leaving systemPrompt stale or empty; trusting systemPrompt then made
  //    inbound calls run an unrelated generated campaign. Keep the original
  //    behavior verbatim — compile from editableScript whenever it exists.
  // Either way, restore {{Customer Name}} from editableScript when an older
  // compile baked "the customer" into the talk track, then fill from the
  // sampled customer.
  const compiledSystemPrompt =
    campaign.systemPromptSource === "compiled" && campaign.systemPrompt?.trim()
      ? campaign.systemPrompt
      : undefined;
  const scriptPrompt = compiledSystemPrompt ?? editableScriptRuntimePrompt(campaign);
  const rawPrompt = scriptPrompt ?? (
    campaign.datasetId === "fundsindia"
      ? sanitizeFundsIndiaLiveTestPrompt(campaign.systemPrompt ?? "")
      : (campaign.systemPrompt ?? "")
  );

  const basePrompt = restoreCustomerNamePlaceholdersFromEditableScript(rawPrompt, campaign.editableScript);

  const linkConfig = resolveLinkSuccessConfig(campaign.successDefinition);

  const systemPrompt = appendLinkToolHintToSystemPrompt(
    appendVoiceCustomerContextToSystemPrompt(basePrompt, customerContext),
    campaign.successDefinition,
  );

  return {
    systemPrompt,
    firstMessage: applyVoiceCustomerPlaceholders(
      extractOpeningLineFromScript(campaign.editableScript ?? "") || resolveCampaignCanonicalOpening(campaign),
      customerContext,
    ),
    linkDest: linkConfig?.dest,
    linkWindowDays: linkConfig?.windowDays,
    linkTemplate: linkConfig?.template,
  };
}
