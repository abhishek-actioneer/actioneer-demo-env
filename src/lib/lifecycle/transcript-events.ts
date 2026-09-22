import type { VoiceCall } from "@/lib/voice-campaign-types";

export interface TranscriptEventExtraction {
  eventTypes: string[];
  summary: string;
  confidence: number;
  metadata: Record<string, unknown>;
}

function transcriptText(call: VoiceCall, role?: "assistant" | "user"): string {
  return (call.transcript ?? [])
    .filter((turn) => !role || turn.role === role)
    .map((turn) => turn.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLifecycleTranscriptEvents(call: VoiceCall): TranscriptEventExtraction {
  const assistant = transcriptText(call, "assistant");
  const customer = transcriptText(call, "user");
  const customerLower = customer.toLowerCase();
  const assistantLower = assistant.toLowerCase();
  const allLower = `${assistantLower} ${customerLower}`;
  const eventTypes = new Set<string>();

  if (call.status === "failed") eventTypes.add("call_failed");
  if (call.status === "no_answer") eventTypes.add("call_no_answer");
  if (call.status === "connected" || call.status === "completed" || (call.durationSeconds ?? 0) > 0) {
    eventTypes.add("call_connected");
  }

  if (/\b(kyc|activation|activate|account|sip|fund|advisor|callback|offer|help)\b/i.test(assistantLower)) {
    eventTypes.add("sku_pitched");
  }

  if (/\b(wrong number|incorrect number|not my number|not .* person)\b|गलत नंबर/i.test(customerLower)) {
    eventTypes.add("wrong_number");
  }

  if (/\b(stop calling|do not call|don't call|opt out|remove my number|unsubscribe)\b|मत करो|कॉल मत/i.test(customerLower)) {
    eventTypes.add("opted_out");
  }

  if (/\b(complaint|complain|misleading|harassment|fraud|scam|sebi|rbi)\b|शिकायत|धोखा/i.test(customerLower)) {
    eventTypes.add("complaint");
  }

  if (/\b(guaranteed return|guarantee returns|assured return|risk free|no risk)\b/i.test(allLower)) {
    eventTypes.add("conduct_flag");
  }

  if (/\b(yes|okay|ok|interested|send|share|schedule|book|callback|call back|help me|i want|please do)\b|हाँ|ठीक|भेज|शेड्यूल|बुक/i.test(customerLower)) {
    eventTypes.add("offer_accepted");
  } else if (/\b(not interested|no need|decline|not now|don't want|do not want|refuse)\b|नहीं चाहिए|जरूरत नहीं/i.test(customerLower)) {
    eventTypes.add("offer_rejected");
  } else if (/\b(later|tomorrow|evening|busy|call later|think about|send details)\b|बाद में|कल|शाम/i.test(customerLower)) {
    eventTypes.add("offer_pending");
  }

  const summary = customer
    ? customer.slice(0, 260)
    : call.status === "no_answer"
      ? "No answer captured."
      : call.status === "failed"
        ? "Call failed before usable transcript."
        : "No customer-side transcript captured.";

  return {
    eventTypes: Array.from(eventTypes),
    summary,
    confidence: customer ? 0.72 : 0.5,
    metadata: {
      voiceCallStatus: call.status,
      durationSeconds: call.durationSeconds,
      transcriptTurns: call.transcript?.length ?? 0,
      heuristic: true,
    },
  };
}
