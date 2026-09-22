import { describe, expect, it } from "vitest";

import { shouldSendPostCallFollowUp } from "@/lib/voice-followup-sms";
import type { VoiceTranscriptTurn } from "@/lib/voice-campaign-types";

function turn(role: VoiceTranscriptTurn["role"], text: string): VoiceTranscriptTurn {
  return { id: `${role}-${text.slice(0, 8)}`, role, text, at: new Date().toISOString() };
}

describe("shouldSendPostCallFollowUp", () => {
  it("sends even when the customer opted out or asked not to be contacted", () => {
    const decision = shouldSendPostCallFollowUp([
      turn("assistant", "Namaste, calling about your loan enquiry."),
      turn("user", "Please don't call me again, wrong number."),
    ]);
    expect(decision.shouldSend).toBe(true);
  });

  it("sends even when the transcript shows no engagement signal at all", () => {
    const decision = shouldSendPostCallFollowUp([
      turn("assistant", "Hello?"),
      turn("recording", "(silence)"),
    ]);
    expect(decision.shouldSend).toBe(true);
    expect(decision.reason).toBe("always_send_post_call");
  });

  it("records an explicit customer request as the reason", () => {
    const decision = shouldSendPostCallFollowUp([
      turn("assistant", "Would you like me to send details?"),
      turn("user", "Haan, WhatsApp pe bhej do please."),
    ]);
    expect(decision.shouldSend).toBe(true);
    expect(decision.reason).toBe("customer_requested_message");
  });

  it("sends over WhatsApp even when the customer names SMS", () => {
    const decision = shouldSendPostCallFollowUp([
      turn("assistant", "Should I share the details?"),
      turn("user", "Yes, send me an SMS."),
    ]);
    // The decision no longer carries a channel — post-call is WhatsApp-only.
    expect(decision.shouldSend).toBe(true);
    expect(decision).not.toHaveProperty("channel");
  });
});
