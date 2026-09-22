import { findCall, upsertCallFollowUp } from "./voice-campaign-store";
import { getOpenAI } from "./openai-client";
import {
  fetchGupshupWhatsAppTemplates,
  resolveWhatsAppTemplatePayload,
  sendWhatsAppTemplate,
  type GupshupWhatsAppTemplate,
  type SendWhatsAppResult,
  type WhatsAppTemplateRuntime,
} from "./gupshup-whatsapp-client";
import { createAttributionToken } from "./attribution-store";
import { resolvePublicBaseUrl } from "./public-base-url";
import { recordCustomerChannelEvent } from "./customer-channel-memory";
import type {
  VoiceCall,
  VoiceCampaign,
  VoiceFollowUp,
  VoiceTranscriptTurn,
} from "./voice-campaign-types";

interface PostCallFollowUpDecision {
  shouldSend: boolean;
  reason?: string;
}

const NEGATIVE_OR_OPTOUT_RE =
  /\b(do not call|don't call|stop calling|remove my number|wrong number|not interested|no need|do not send|don't send|mat bhej|mat bhejo)\b|(?:कॉल मत|मत भेज|नहीं भेज|नही भेज|रहने दो|नहीं चाहिए|नही चाहिए|गलत नंबर|दिलचस्पी नहीं)/i;
// Any way a customer or agent can refer to "send me a message" — channel words
// included, since the channel itself is no longer a choice (post-call is always
// WhatsApp) and they still signal the same intent.
const MESSAGE_MENTION_RE =
  /\b(?:message|msg|whats\s*app|whatsapp|wa|sms|text|text message)\b|(?:मैसेज|संदेश|व्हाट्सऐप|वॉट्सऐप|एसएमएस)/i;
const SEND_INTENT_RE =
  /\b(send|share|text|message|bhej|bhejo|bhej do|bhej dijiye)\b|(?:भेज|शेयर|सेंड|बता दीजिए|बता दीजिये)/i;
const DETAILS_RE =
  /\b(details?|link|info|information|steps?|note|overview)\b|(?:डिटेल|विवरण|जानकारी|लिंक|स्टेप|नोट|ओवरव्यू)/i;
const AFFIRMATIVE_RE =
  /\b(yes|yeah|yep|sure|ok|okay|please|haan|han|ji|theek|thik|send|share|bhej|bhejo)\b|(?:हाँ|हां|जी|ठीक|ठिक|कर दीजिए|कर दीजिये|कर दो|भेज दीजिए|भेज दीजिये|भेज दो)/i;
const FOLLOW_UP_ACTION_RE =
  /\b(follow[- ]?up|callback|call back|support|team|branch|note|noted|request|arrange)\b|(?:फॉलो[\s-]?अप|कॉल बैक|सपोर्ट|सहायता|टीम|ब्रांच|नोट|रिक्वेस्ट|अनुरोध)/i;
const ISSUE_OR_INTEREST_RE =
  /\b(payment|pay|amount|date|issue|problem|support|help|interested|details?|callback|follow[- ]?up)\b|(?:पेमेंट|भुगतान|अमाउंट|राशि|तारीख|डेट|दिक्कत|समस्या|सपोर्ट|मदद|जानकारी|डिटेल|फॉलो[\s-]?अप|कॉल बैक|ब्रांच)/i;
const POST_CALL_FOLLOWUP_DELAY_MS = Math.max(
  0,
  Number(process.env.VOICE_POST_CALL_FOLLOWUP_DELAY_MS ?? process.env.VOICE_POST_CALL_SMS_DELAY_MS ?? 30_000) || 0,
);
/**
 * Post-call follow-ups are WhatsApp-only. A phone call does not open WhatsApp's
 * 24-hour session, so this always goes out as an approved template — never
 * free-form text, never SMS, never Twilio.
 */
const POST_CALL_CHANNEL = "whatsapp" as const;

function compactText(value: string, maxLength = 480): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function promptLine(prompt: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = prompt.match(new RegExp(`(?:^|\\n)-\\s*${escaped}:\\s*(.+)`, "i"));
  return match?.[1]?.trim();
}

function fallbackPostCallBody(campaign: VoiceCampaign, turns: VoiceTranscriptTurn[]): string {
  const companyName = campaign.companyName || campaign.datasetLabel || "the team";
  const transcriptText = turns.map((turn) => turn.text).join(" ");
  const usesDevanagari = /[\u0900-\u097F]/.test(transcriptText);
  const paymentMethod = /(?:digital|upi|online|डिजिटल|यूपीआई|ऑनलाइन)/i.test(transcriptText)
    ? (usesDevanagari ? "डिजिटल पेमेंट" : "digital payment")
    : /(?:branch|ब्रांच)/i.test(transcriptText)
      ? (usesDevanagari ? "ब्रांच पेमेंट" : "branch payment")
      : undefined;
  const nextMonthEnd = /(?:next month(?:'s)? end|end of next month|अगले महीने(?: के)? अंत|महीने एंड)/i.test(transcriptText);
  const tentativeDate = nextMonthEnd
    ? (usesDevanagari ? "अगले महीने के अंत तक" : "by the end of next month")
    : undefined;

  if (usesDevanagari) {
    const detail = [tentativeDate, paymentMethod ? `${paymentMethod} के लिए` : undefined]
      .filter(Boolean)
      .join(" ");
    return compactText(`${companyName}: आपकी बात नोट कर ली गई है${detail ? ` - ${detail}` : ""}. सहायता चाहिए तो हमारी टीम से संपर्क करें.`);
  }

  const detail = [
    tentativeDate ? `payment ${tentativeDate}` : undefined,
    paymentMethod ? `via ${paymentMethod}` : undefined,
  ].filter(Boolean).join(" ");
  return compactText(`${companyName}: We have noted your call${detail ? ` - ${detail}` : ""}. Contact our team if you need support.`);
}

function transcriptForPrompt(turns: VoiceTranscriptTurn[]): string {
  return turns
    .filter((turn) => turn.role === "assistant" || turn.role === "user")
    .map((turn) => `${turn.role === "assistant" ? "Agent" : "Customer"}: ${turn.text}`)
    .join("\n")
    .slice(-6000);
}

function parseMessageBody(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { body?: unknown };
    return typeof parsed.body === "string" ? compactText(parsed.body, 320) : undefined;
  } catch {
    return undefined;
  }
}

async function buildPostCallMessageBody(
  campaign: VoiceCampaign,
  call: VoiceCall,
  turns: VoiceTranscriptTurn[],
): Promise<string> {
  const companyName = campaign.companyName || campaign.datasetLabel || "the team";
  const fallback = fallbackPostCallBody(campaign, turns);
  if (!process.env.OPENAI_API_KEY) return fallback;

  const benefit = promptLine(campaign.systemPrompt, "Key benefit");
  const close = promptLine(campaign.systemPrompt, "Close");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Write one post-call WhatsApp message from the business to the customer.",
            "Use only the transcript and campaign facts provided. Do not invent promises, dates, links, or amounts.",
            "Match the language actually spoken by the customer. If the call is Hindi/Hinglish, write natural Hindi/Hinglish.",
            "Mention the concrete outcome: payment timing, payment method, support request, branch help, or callback only if it was discussed.",
            "Do not mention internal campaign objectives, scripts, routing, capture, agent instructions, or transcript quality.",
            "Keep it short: one or two sentences, maximum 320 characters.",
            "Return only JSON: {\"body\":\"...\"}",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Company: ${companyName}`,
            `Campaign language hint: ${campaign.language}`,
            `Campaign name: ${campaign.name}`,
            `Call purpose: ${campaign.purposeName}`,
            benefit ? `Key benefit: ${benefit}` : "",
            close ? `Allowed close: ${close}` : "",
            `Customer phone: ${call.toNumber}`,
            "",
            "Transcript:",
            transcriptForPrompt(turns),
          ].filter(Boolean).join("\n"),
        },
      ],
    });
    return parseMessageBody(completion.choices[0]?.message?.content) ?? fallback;
  } catch (err) {
    console.error("[voice/followup] Failed to generate transcript-aware message body:", err);
    return fallback;
  }
}

function agentOfferedFollowUp(text: string): boolean {
  const hasSendOrDetails = SEND_INTENT_RE.test(text) || DETAILS_RE.test(text);
  if (MESSAGE_MENTION_RE.test(text) && hasSendOrDetails) return true;
  return FOLLOW_UP_ACTION_RE.test(text) && (hasSendOrDetails || AFFIRMATIVE_RE.test(text));
}

function agentConfirmedFollowUp(text: string): boolean {
  return FOLLOW_UP_ACTION_RE.test(text) && /(?:done|noted|confirm|arrange|request|कर रही|कर रहा|कर दिया|कर दिया है|कर दूँ|कर दूं|रख रही|रख रहा|note कर|नोट कर)/i.test(text);
}

function userRequestedFollowUp(text: string): boolean {
  if (NEGATIVE_OR_OPTOUT_RE.test(text)) return false;
  return MESSAGE_MENTION_RE.test(text) && (SEND_INTENT_RE.test(text) || DETAILS_RE.test(text));
}

/**
 * Every completed call gets a post-call WhatsApp message, regardless of outcome
 * or opt-out. The returned `reason` is telemetry only — it records which signal
 * the transcript carried, and never gates or routes the send.
 */
export function shouldSendPostCallFollowUp(turns: VoiceTranscriptTurn[]): PostCallFollowUpDecision {
  let recentFollowUpOffer = 0;
  let sawCustomerConsentOrNeed = false;
  let sawConfirmedFollowUp = false;

  for (const turn of turns) {
    const text = turn.text.trim();
    if (!text) continue;

    if (turn.role === "assistant") {
      if (agentConfirmedFollowUp(text)) sawConfirmedFollowUp = true;
      if (agentOfferedFollowUp(text)) recentFollowUpOffer = 2;
      else recentFollowUpOffer = Math.max(0, recentFollowUpOffer - 1);
      continue;
    }

    if (turn.role !== "user") continue;

    if (AFFIRMATIVE_RE.test(text) || ISSUE_OR_INTEREST_RE.test(text)) {
      sawCustomerConsentOrNeed = true;
    }

    if (userRequestedFollowUp(text)) {
      return { shouldSend: true, reason: "customer_requested_message" };
    }
    if (recentFollowUpOffer > 0 && AFFIRMATIVE_RE.test(text)) {
      return { shouldSend: true, reason: "customer_accepted_followup_offer" };
    }
    recentFollowUpOffer = Math.max(0, recentFollowUpOffer - 1);
  }

  if (sawConfirmedFollowUp && sawCustomerConsentOrNeed) {
    return { shouldSend: true, reason: "agent_confirmed_followup" };
  }
  return { shouldSend: true, reason: "always_send_post_call" };
}

function postCallFollowUpId(callId: string): string {
  return `post-call-${POST_CALL_CHANNEL}-${callId}`;
}

function hasPostCallFollowUp(call: VoiceCall): boolean {
  return (call.followUps ?? []).some(
    (followUp) => followUp.trigger === "post_call_transcript" && followUp.type === POST_CALL_CHANNEL,
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAttributionBody(
  baseBody: string,
  trackingUrl: string,
  template: string | undefined,
): string {
  if (template?.includes("{link}")) {
    return compactText(template.replace("{link}", trackingUrl));
  }
  return compactText(`${baseBody}\n${trackingUrl}`);
}

function maybeInjectAttributionLink(
  campaign: VoiceCampaign,
  call: VoiceCall,
  body: string,
): string {
  const metric = campaign.successDefinition?.primary;
  if (metric?.type !== "link" || !metric.destinationUrl) return body;

  const baseUrl = resolvePublicBaseUrl();
  if (!baseUrl) {
    console.warn("[voice/followup] attribution link skipped — NEXT_PUBLIC_BASE_URL or equivalent not set");
    return body;
  }

  const windowDays = campaign.successDefinition?.attributionWindowDays ?? 7;

  try {
    const attrToken = createAttributionToken({
      callId: call.id,
      campaignId: campaign.id,
      dest: metric.destinationUrl,
      channel: POST_CALL_CHANNEL,
      windowDays,
      recipientId: call.recipientId,
    });

    const trackingUrl = `${baseUrl}/api/t/${attrToken.token}`;
    return buildAttributionBody(body, trackingUrl, metric.followUpTemplate);
  } catch (err) {
    console.error("[voice/followup] attribution token creation failed:", err);
    return body;
  }
}

function maskPhoneForLog(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 6) return trimmed || "(empty)";
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-3)}`;
}

function firstUrl(value: string): string {
  return value.match(/https?:\/\/\S+/i)?.[0] ?? "";
}

function dateLabel(now = new Date()): string {
  return now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function timeLabel(now = new Date()): string {
  return now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function whatsAppTemplateRuntime(
  campaign: VoiceCampaign,
  call: VoiceCall,
  body: string,
): WhatsAppTemplateRuntime {
  const now = new Date();
  const customerName =
    call.recipientContext?.displayName ||
    call.recipientContext?.firstName ||
    "there";
  const link = firstUrl(body);
  return {
    message: body,
    body,
    text: body,
    link,
    url: link,
    customerName,
    name: customerName,
    companyName: campaign.companyName || campaign.datasetLabel || "the team",
    campaignName: campaign.name,
    purposeName: campaign.purposeName,
    date: dateLabel(now),
    time: timeLabel(now),
  };
}

/**
 * Template parameters must be single-line, non-empty and brace-free — Meta
 * rejects blanks and newlines, and stray braces would be re-rendered as
 * placeholders downstream. Returns the first candidate that survives.
 */
function firstNonBlank(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 900);
  }
  return "";
}

/** Placeholder names in body order, e.g. `{{1}} {{2}}` → ["1", "2"]. */
function orderedPlaceholders(body: string | undefined): string[] {
  if (!body) return [];
  const names: string[] = [];
  for (const match of body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const name = match[1]?.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Fill an arbitrary approved template we did not configure — the emergency path
 * when the selected one is rejected. Named placeholders ({{customerName}})
 * resolve from the runtime. Positional ones ({{1}}) are almost always short
 * slots ("Hi {{1}},"), so they get short values; only a single-parameter
 * template is treated as a message carrier. Nothing is ever left blank, since
 * Meta rejects empty parameters.
 */
export function paramsForApprovedTemplate(
  template: GupshupWhatsAppTemplate,
  runtime: WhatsAppTemplateRuntime,
): string[] {
  const names = orderedPlaceholders(template.body);
  const count = names.length || template.parameterCount;
  if (count <= 0) return [];
  const positional = count === 1
    ? [runtime.message]
    : [runtime.customerName, runtime.companyName, runtime.purposeName, runtime.date, runtime.time];
  return Array.from({ length: count }, (_, index) => {
    const named = names[index] ? runtime[names[index]] : undefined;
    return firstNonBlank(named, positional[index], runtime.companyName, "our team");
  });
}

interface TemplateAttempt {
  templateId: string;
  params: string[];
  label: string;
}

function configuredTemplateAttempt(
  campaign: VoiceCampaign,
  runtime: WhatsAppTemplateRuntime,
): TemplateAttempt | undefined {
  try {
    const payload = resolveWhatsAppTemplatePayload({
      userId: campaign.userId,
      runtimeVariables: runtime,
    });
    if (!payload) return undefined;
    return {
      templateId: payload.templateId,
      params: payload.params.map((value) => firstNonBlank(value, runtime.companyName, "our team")),
      label: "configured",
    };
  } catch (err) {
    console.error("[voice/followup] WhatsApp template payload failed:", err);
    return undefined;
  }
}

/**
 * Try plain-text templates before media ones. A media template needs a header
 * image/video we do not have on a post-call follow-up, so it is certain to be
 * rejected — attempting it first just delays the message that would have worked.
 */
export function templateSendPriority(template: GupshupWhatsAppTemplate): number {
  const type = template.type?.trim().toUpperCase();
  return !type || type === "TEXT" ? 0 : 1;
}

async function approvedTemplateAttempts(
  campaign: VoiceCampaign,
  runtime: WhatsAppTemplateRuntime,
  skipTemplateId: string | undefined,
): Promise<TemplateAttempt[]> {
  let templates: GupshupWhatsAppTemplate[] = [];
  try {
    templates = await fetchGupshupWhatsAppTemplates({
      userId: campaign.userId,
      templateStatus: "APPROVED",
    });
  } catch (err) {
    console.error("[voice/followup] approved WhatsApp template lookup failed:", err);
    return [];
  }

  return templates
    .filter((template) => !template.status || template.status.toUpperCase() === "APPROVED")
    .filter((template) => template.id !== skipTemplateId)
    .sort((a, b) => templateSendPriority(a) - templateSendPriority(b))
    .map((template) => ({
      templateId: template.id,
      params: paramsForApprovedTemplate(template, runtime),
      label: `approved:${template.name}`,
    }));
}

interface TemplateSendOutcome {
  result: SendWhatsAppResult;
  attempt: TemplateAttempt;
}

/**
 * Send the configured template; if it is missing or rejected, walk the account's
 * other approved templates until one goes through. The call ends with a WhatsApp
 * message as long as *any* approved template still works.
 */
async function sendFirstWorkingTemplate(
  campaign: VoiceCampaign,
  to: string,
  runtime: WhatsAppTemplateRuntime,
  callId: string,
): Promise<TemplateSendOutcome> {
  const configured = configuredTemplateAttempt(campaign, runtime);
  const failures: string[] = [];

  const attemptSend = async (attempt: TemplateAttempt): Promise<TemplateSendOutcome | undefined> => {
    try {
      const result = await sendWhatsAppTemplate(to, {
        userId: campaign.userId,
        templateId: attempt.templateId,
        configuredParams: attempt.params,
        runtimeVariables: runtime,
      });
      return { result, attempt };
    } catch (err) {
      const message = err instanceof Error ? err.message : "WhatsApp template send failed";
      failures.push(`${attempt.label}(${attempt.templateId}): ${message}`);
      console.warn(
        `[voice/followup] template_rejected callId=${callId} template=${attempt.label}` +
          ` templateId=${attempt.templateId} error=${message}`,
      );
      return undefined;
    }
  };

  if (configured) {
    const outcome = await attemptSend(configured);
    if (outcome) return outcome;
  } else {
    failures.push("configured: no WhatsApp template selected for this workspace");
  }

  const fallbacks = await approvedTemplateAttempts(campaign, runtime, configured?.templateId);
  if (fallbacks.length > 0) {
    console.log(
      `[voice/followup] trying ${fallbacks.length} approved fallback template(s) callId=${callId}`,
    );
  }
  for (const attempt of fallbacks) {
    const outcome = await attemptSend(attempt);
    if (outcome) return outcome;
  }

  throw new Error(
    failures.length > 0
      ? `No approved WhatsApp template could be sent — ${failures.join("; ")}`
      : "No approved WhatsApp template available for this workspace",
  );
}

function legacyContentVariables(params: string[]): Record<string, string> {
  return Object.fromEntries(params.map((value, index) => [String(index + 1), value]));
}

export async function maybeSendPostCallFollowUp(
  callId: string,
  recordingSid: string,
  turns: VoiceTranscriptTurn[],
): Promise<void> {
  const found = findCall(callId);
  if (!found) {
    console.log(
      `[voice/followup] skip callId=${callId} recordingSid=${recordingSid} reason=call_not_found turns=${turns.length}`,
    );
    return;
  }

  const decision = shouldSendPostCallFollowUp(turns);
  if (!decision.shouldSend) {
    console.log(
      `[voice/followup] decision callId=${callId} recordingSid=${recordingSid}` +
        ` shouldSend=false turns=${turns.length}`,
    );
    return;
  }

  // Both triggers (live stream close, recording transcription) can race here.
  // The claim below is written in the same tick as this check — before the
  // async body build — so whichever trigger arrives second sees it and backs off.
  if (hasPostCallFollowUp(found.call)) {
    console.log(
      `[voice/followup] skip callId=${callId} recordingSid=${recordingSid} reason=already_triggered`,
    );
    return;
  }

  const to = found.call.toNumber.trim();

  const followUp: VoiceFollowUp = {
    id: postCallFollowUpId(found.call.id),
    type: POST_CALL_CHANNEL,
    status: "pending",
    trigger: "post_call_transcript",
    messageMode: "template",
    to,
    body: "",
    reason: decision.reason,
    provider: "gupshup",
    sourceRecordingSid: recordingSid,
    createdAt: new Date().toISOString(),
  };
  upsertCallFollowUp(callId, followUp);
  console.log(
    `[voice/followup] queued channel=${POST_CALL_CHANNEL} callId=${callId}` +
      ` followUpId=${followUp.id} to=${maskPhoneForLog(to)}`,
  );

  try {
    const body = maybeInjectAttributionLink(
      found.campaign,
      found.call,
      await buildPostCallMessageBody(found.campaign, found.call, turns),
    );
    followUp.body = body;
    upsertCallFollowUp(callId, followUp);
    const runtime = whatsAppTemplateRuntime(found.campaign, found.call, body);

    console.log(
      `[voice/followup] decision callId=${callId} recordingSid=${recordingSid}` +
        ` shouldSend=true channel=${POST_CALL_CHANNEL} reason=${decision.reason ?? "(none)"}` +
        ` to=${maskPhoneForLog(to)} bodyChars=${body.length} turns=${turns.length}`,
    );

    if (POST_CALL_FOLLOWUP_DELAY_MS > 0) await wait(POST_CALL_FOLLOWUP_DELAY_MS);

    console.log(
      `[voice/followup] send_start channel=${POST_CALL_CHANNEL} callId=${callId}` +
        ` followUpId=${followUp.id} to=${maskPhoneForLog(to)}`,
    );
    const { result, attempt } = await sendFirstWorkingTemplate(found.campaign, to, runtime, callId);
    console.log(
      `[voice/followup] send_success channel=${POST_CALL_CHANNEL} callId=${callId}` +
        ` followUpId=${followUp.id} template=${attempt.label} templateId=${attempt.templateId}` +
        ` sid=${result.sid} status=${result.status}`,
    );

    const templateId = result.contentSid ?? attempt.templateId;
    upsertCallFollowUp(callId, {
      ...followUp,
      status: "sent",
      providerSid: result.sid,
      providerStatus: result.status,
      contentSid: templateId,
      contentVariables: legacyContentVariables(attempt.params),
      sentAt: new Date().toISOString(),
    });
    recordCustomerChannelEvent({
      channel: "whatsapp",
      direction: "outbound",
      actor: "agent",
      phone: to,
      text: body,
      at: new Date().toISOString(),
      provider: "gupshup",
      providerMessageId: result.sid,
      campaignId: found.campaign.id,
      callId,
      userId: found.campaign.userId,
      datasetId: found.campaign.datasetId,
      recipientId: found.call.recipientId,
      templateId,
      status: result.status,
      eventType: "whatsapp.template_sent",
      destination: result.to,
      source: result.from,
      idempotencyKey: result.sid ? `gupshup:outbound:${result.sid}` : `whatsapp:followup:${followUp.id}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "WhatsApp send failed";
    console.error(
      `[voice/followup] send_failed channel=${POST_CALL_CHANNEL} callId=${callId}` +
        ` followUpId=${followUp.id} error=${message}`,
    );
    upsertCallFollowUp(callId, {
      ...followUp,
      status: "failed",
      error: message,
    });
  }
}
