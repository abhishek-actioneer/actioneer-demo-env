import { createHash } from "crypto";
import { generateJson } from "@/lib/llm";
import type {
  GuardrailViolation,
  VoiceCall,
  VoiceCallAnalysis,
  VoiceCallOutcome,
  VoiceCampaign,
  VoiceTranscriptTurn,
} from "./voice-campaign-types";
import { selectDisplayTranscript } from "./voice-transcript-display";

interface LLMVoiceCallAnalysis {
  outcome: VoiceCallOutcome;
  summary: string;
  reason: string;
  customerNeed: string;
  nextStep: string;
  callbackPreference: string;
  confidence: number;
}

const OUTCOMES: VoiceCallOutcome[] = [
  "positive",
  "callback_scheduled",
  "neutral",
  "negative",
  "busy",
  "wrong_number",
  "no_answer",
  "failed",
  "unknown",
];

const PROVIDER_SUMMARY_PATTERNS = [
  /^Gemini \+ our Plivo accepted\b/i,
  /^Browser live test\b/i,
];

function cleanText(value: string | undefined, max = 280): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  return text.length <= max ? text : `${text.slice(0, max - 1).trim()}...`;
}

function isProviderSummary(value: string | undefined): boolean {
  const text = cleanText(value);
  return !text || PROVIDER_SUMMARY_PATTERNS.some((pattern) => pattern.test(text));
}

function displayTranscript(call: VoiceCall): VoiceTranscriptTurn[] {
  return selectDisplayTranscript(call);
}

function transcriptForPrompt(turns: VoiceTranscriptTurn[]): string {
  return turns
    .map((turn, index) => `${index + 1}. ${turn.role === "assistant" ? "Agent" : "Customer"}: ${turn.text}`)
    .join("\n")
    .slice(0, 12_000);
}

function userText(turns: VoiceTranscriptTurn[]): string {
  return turns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function callInputText(call: VoiceCall): string {
  const turns = displayTranscript(call);
  const transcript = turns.map((turn) => `${turn.role}:${turn.text}`).join("\n");
  const summary = call.analysis || isProviderSummary(call.summary) ? "" : call.summary ?? "";
  return [
    call.id,
    call.status,
    call.durationSeconds ?? "",
    summary,
    transcript,
  ].join("\n");
}

export function voiceCallAnalysisInputHash(call: VoiceCall): string {
  return createHash("sha1").update(callInputText(call)).digest("hex");
}

export function voiceCallNeedsAnalysis(call: VoiceCall, force = false): boolean {
  if (force) return true;
  const inputHash = voiceCallAnalysisInputHash(call);
  return call.analysis?.inputHash !== inputHash;
}

function normalizeOutcome(value: unknown): VoiceCallOutcome {
  return OUTCOMES.includes(value as VoiceCallOutcome) ? value as VoiceCallOutcome : "unknown";
}

function normalizeConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0.4;
  return Math.max(0, Math.min(1, numeric));
}

function baseAnalysis(
  call: VoiceCall,
  outcome: VoiceCallOutcome,
  summary: string,
  reason: string,
  source: VoiceCallAnalysis["source"],
  patch: Partial<Pick<VoiceCallAnalysis, "customerNeed" | "nextStep" | "callbackPreference" | "confidence">> = {},
): VoiceCallAnalysis {
  return {
    outcome,
    summary: cleanText(summary, 360) || "No customer response captured yet.",
    reason: cleanText(reason, 360) || "Insufficient call content for deeper analysis.",
    customerNeed: cleanText(patch.customerNeed, 180) || undefined,
    nextStep: cleanText(patch.nextStep, 180) || undefined,
    callbackPreference: cleanText(patch.callbackPreference, 120) || undefined,
    confidence: normalizeConfidence(patch.confidence ?? (source === "llm" ? 0.7 : 0.45)),
    source,
    inputHash: voiceCallAnalysisInputHash(call),
    analyzedAt: new Date().toISOString(),
  };
}

function statusAnalysis(call: VoiceCall): VoiceCallAnalysis | undefined {
  if (call.status === "failed") {
    return baseAnalysis(call, "failed", "Call failed before a customer response was captured.", "Provider marked the call as failed.", "status", {
      nextStep: "Retry or verify the number/provider status.",
      confidence: 0.95,
    });
  }
  if (call.status === "no_answer") {
    return baseAnalysis(call, "no_answer", "Customer did not answer.", "Provider marked the call as no answer.", "status", {
      nextStep: "Retry at another time.",
      confidence: 0.95,
    });
  }
  return undefined;
}

function heuristicAnalysis(call: VoiceCall, turns: VoiceTranscriptTurn[]): VoiceCallAnalysis {
  const customer = userText(turns).toLowerCase();
  const allText = turns.map((turn) => turn.text).join(" ").toLowerCase();

  if (!customer.trim()) {
    const summary = call.status === "calling"
      ? "Awaiting callback or transcript before response analysis is available."
      : "No clear customer response was captured.";
    return baseAnalysis(call, call.status === "calling" ? "unknown" : "no_answer", summary, "There is no usable customer-side transcript.", "heuristic", {
      nextStep: call.status === "calling" ? "Wait for call completion before retrying." : "Retry the call if needed.",
      confidence: 0.55,
    });
  }

  if (/\b(wrong number|incorrect number|not my number)\b|गलत नंबर/i.test(customer)) {
    return baseAnalysis(call, "wrong_number", "Customer indicated this is the wrong number.", "The customer response contains a wrong-number signal.", "heuristic", {
      nextStep: "Suppress or verify this number before retrying.",
      confidence: 0.85,
    });
  }

  if (/\b(not interested|no need|don't call|do not call|stop calling|refuse|declined)\b|जरूरत नहीं|नहीं चाहिए|मत करो/i.test(customer)) {
    return baseAnalysis(call, "negative", "Customer declined or said there is no current need.", "The customer response contains a decline/no-need signal.", "heuristic", {
      nextStep: "Do not push; suppress or re-engage later with a softer prompt.",
      confidence: 0.78,
    });
  }

  if (/\b(not a good time|busy|call later|later|tomorrow|evening)\b|बाद में|कल|शाम/i.test(customer) && !/\b(send|schedule|book|yes|link|callback)\b|भेज|शेड्यूल|बुक|हाँ|ठीक/i.test(customer)) {
    return baseAnalysis(call, "busy", "Customer asked to continue later.", "The customer response indicates timing friction.", "heuristic", {
      nextStep: "Schedule a later callback.",
      callbackPreference: cleanText(customer, 120),
      confidence: 0.72,
    });
  }

  if (/\b(yes|interested|send|link|schedule|book|callback|advisor|want|need|pay|payment)\b|हाँ|ठीक|भेज|शेड्यूल|बुक|कॉल|पेमेंट|जरूरत/i.test(customer)) {
    return baseAnalysis(call, "positive", "Customer showed intent for a next step.", "The customer accepted help, a link, booking, callback, or advisor follow-up.", "heuristic", {
      customerNeed: cleanText(customer, 140),
      nextStep: /\bpay|payment\b|पेमेंट/i.test(allText) ? "Send payment/help link." : "Create the promised follow-up.",
      confidence: 0.72,
    });
  }

  return baseAnalysis(call, "neutral", "Customer answered but did not give a clear positive or negative signal.", "The transcript has customer speech but no decisive intent.", "heuristic", {
    customerNeed: cleanText(customer, 140),
    nextStep: "Review transcript before deciding whether to retry.",
    confidence: 0.48,
  });
}

function sanitizeLLMAnalysis(call: VoiceCall, raw: LLMVoiceCallAnalysis): VoiceCallAnalysis {
  return baseAnalysis(
    call,
    normalizeOutcome(raw.outcome),
    raw.summary,
    raw.reason,
    "llm",
    {
      customerNeed: raw.customerNeed,
      nextStep: raw.nextStep,
      callbackPreference: raw.callbackPreference,
      confidence: raw.confidence,
    },
  );
}

// ---------------------------------------------------------------------------
// Success criterion check — runs post-call, zero latency impact
// ---------------------------------------------------------------------------

interface LLMCriterionCheck {
  met: boolean;
  reason: string;
}

export async function checkCriterion(
  criterion: string,
  turns: VoiceTranscriptTurn[],
  datasetId: string,
): Promise<{ met: boolean; reason: string }> {
  if (!criterion.trim()) return { met: false, reason: "No criterion defined." };
  const customerTurns = turns.filter((t) => t.role === "user");
  if (customerTurns.length === 0) return { met: false, reason: "No customer response captured." };

  try {
    const result = await generateJson<LLMCriterionCheck>({
      messages: [
        {
          role: "system",
          content: `You evaluate whether a voice call transcript meets a specific success criterion.
Read the full transcript and determine if the criterion was met.
Answer only from what is explicitly stated. Do not infer or assume intent beyond what is said.
Return met: true only if the criterion is clearly and unambiguously satisfied.`,
        },
        {
          role: "user",
          content: `SUCCESS CRITERION:\n${criterion}\n\nCALL TRANSCRIPT:\n${transcriptForPrompt(turns)}`,
        },
      ],
      jsonSchema: {
        name: "criterion_check",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            met:    { type: "boolean" },
            reason: { type: "string" },
          },
          required: ["met", "reason"],
        },
      },
      feature: "voice-campaigns.criterion-check",
      label: "success criterion check",
      datasetId,
      timeoutMs: 20_000,
      maxOutputTokens: 200,
    });
    return { met: result.met, reason: cleanText(result.reason, 280) };
  } catch {
    return { met: false, reason: "Criterion check failed." };
  }
}

// ---------------------------------------------------------------------------
// Guardrail compliance check — runs post-call, zero latency impact
// ---------------------------------------------------------------------------

interface LLMGuardrailCheck {
  violations: Array<{ rule: string; turn: number; quote: string }>;
}

/**
 * Result of the compliance judge. `status: "error"` distinguishes a
 * throw/timeout from a genuine clean pass — a timeout must NEVER be counted as
 * "no violations" (R14). The prior contract returned a bare `[]` in both cases.
 */
export interface ComplianceCheckResult {
  status: "ok" | "error";
  violations: GuardrailViolation[];
}

export async function checkGuardrailCompliance(
  guardrails: string[],
  turns: VoiceTranscriptTurn[],
  datasetId: string,
): Promise<ComplianceCheckResult> {
  if (guardrails.length === 0) return { status: "ok", violations: [] };

  const agentTurns = turns
    .map((t, i) => ({ ...t, index: i + 1 }))
    .filter((t) => t.role === "assistant");
  if (agentTurns.length === 0) return { status: "ok", violations: [] };

  try {
    const result = await generateJson<LLMGuardrailCheck>({
      messages: [
        {
          role: "system",
          content: `You are a compliance auditor for outbound voice calls. Review the agent's transcript and identify any turns where the agent violated a compliance rule.
Only flag clear, unambiguous violations. Do not flag borderline cases or customer speech.
For each violation, return the exact rule violated, the 1-based turn number, and a short quote from the agent's response.
If no violations, return an empty array.`,
        },
        {
          role: "user",
          content: `COMPLIANCE RULES:
${guardrails.map((r, i) => `${i + 1}. ${r}`).join("\n")}

AGENT TRANSCRIPT (agent turns only):
${agentTurns.map((t) => `Turn ${t.index}: ${t.text}`).join("\n\n")}`,
        },
      ],
      jsonSchema: {
        name: "guardrail_compliance_check",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            violations: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  rule:  { type: "string" },
                  turn:  { type: "number" },
                  quote: { type: "string" },
                },
                required: ["rule", "turn", "quote"],
              },
            },
          },
          required: ["violations"],
        },
      },
      feature: "voice-campaigns.guardrail-compliance",
      label: "guardrail compliance check",
      datasetId,
      timeoutMs: 30_000,
      maxOutputTokens: 800,
    });
    return { status: "ok", violations: result.violations ?? [] };
  } catch {
    // A throw/timeout is UNKNOWN, never "clean" — surface it as an error so the
    // caller can refuse to mark the call safe (R14).
    return { status: "error", violations: [] };
  }
}

export async function analyzeVoiceCallResponse(campaign: VoiceCampaign, call: VoiceCall): Promise<VoiceCallAnalysis> {
  const addLanguageQuality = (analysis: VoiceCallAnalysis): VoiceCallAnalysis => analysis;
  const status = statusAnalysis(call);
  if (status) return addLanguageQuality(status);

  const turns = displayTranscript(call);
  const fallback = heuristicAnalysis(call, turns);
  const customer = userText(turns);
  if (!customer.trim() || turns.length === 0) return addLanguageQuality(fallback);

  // Run outcome analysis, guardrail check, and criterion check concurrently — zero latency impact
  const guardrails: string[] = campaign.successDefinition?.guardrails ?? [];
  const primaryCriterion: string = campaign.successDefinition?.primary?.criterion ?? "";
  const [outcomeResult, guardrailViolations, criterionResult] = await Promise.allSettled([
    generateJson<LLMVoiceCallAnalysis>({
      messages: [
        {
          role: "system",
          content: `You analyze outbound voice campaign call transcripts.
Classify only from the customer's actual response. Ignore provider status text, call setup messages, and the agent's scripted pitch unless the customer responds to it.

Outcome rules:
- positive: customer gives clear buying/support intent or accepts a payment/help link but WITHOUT scheduling a specific callback or advisor appointment.
- callback_scheduled: customer explicitly agrees to a specific callback, advisor call, or follow-up appointment (with or without a time). Use this whenever a concrete follow-up is booked.
- neutral: customer engaged but gave no clear next-step intent.
- busy: customer says this is a bad time or asks to talk later without accepting any outcome.
- negative: customer declines, says no need/not interested, or asks not to be contacted.
- wrong_number: customer says this is the wrong number/person.
- no_answer: no real customer response, voicemail/IVR only, or customer never engaged.
- unknown: transcript is too garbled or contradictory to classify.

Return concise business analysis. If the customer asks for a later call, capture the exact callback timing preference; otherwise return an empty string for callbackPreference. Do not invent facts or next steps.`,
        },
        {
          role: "user",
          content: `CAMPAIGN
Name: ${campaign.name}
Segment: ${campaign.segmentName}
Purpose: ${campaign.purposeName}
Language: ${campaign.language}

CALL
Status: ${call.status}
Duration seconds: ${call.durationSeconds ?? "unknown"}

TRANSCRIPT
${transcriptForPrompt(turns)}`,
        },
      ],
      jsonSchema: {
        name: "voice_call_response_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            outcome: { type: "string", enum: OUTCOMES },
            summary: { type: "string" },
            reason: { type: "string" },
            customerNeed: { type: "string" },
            nextStep: { type: "string" },
            callbackPreference: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["outcome", "summary", "reason", "customerNeed", "nextStep", "callbackPreference", "confidence"],
        },
      },
      feature: "voice-campaigns.response-analysis",
      label: "voice campaign response analysis",
      datasetId: campaign.datasetId,
      timeoutMs: 45_000,
      maxOutputTokens: 500,
    }),
    checkGuardrailCompliance(guardrails, turns, campaign.datasetId ?? ""),
    checkCriterion(primaryCriterion, turns, campaign.datasetId ?? ""),
  ]);

  // Unwrap the compliance result. A rejected settle OR an inner `status: "error"`
  // (throw/timeout) is UNKNOWN → never safe: surface `complianceStatus: "error"`
  // and do not let it collapse to an empty/clean `[]` (R14, both sites fixed).
  const compliance: ComplianceCheckResult =
    guardrailViolations.status === "fulfilled"
      ? guardrailViolations.value
      : { status: "error", violations: [] };
  const violations = compliance.violations;
  const complianceStatus = compliance.status;
  const criterion = criterionResult.status === "fulfilled" ? criterionResult.value : null;

  try {
    if (outcomeResult.status === "rejected") throw outcomeResult.reason;
    const analysis = sanitizeLLMAnalysis(call, outcomeResult.value);
    return addLanguageQuality({
      ...analysis,
      guardrailViolations: violations.length > 0 ? violations : undefined,
      complianceStatus,
      criterionMet: criterion?.met,
      criterionReason: criterion?.reason,
    });
  } catch (error) {
    console.error("[voice/response-analysis] Falling back to heuristic analysis:", error);
    return addLanguageQuality({
      ...fallback,
      guardrailViolations: violations.length > 0 ? violations : undefined,
      complianceStatus,
      criterionMet: criterion?.met,
      criterionReason: criterion?.reason,
    });
  }
}
