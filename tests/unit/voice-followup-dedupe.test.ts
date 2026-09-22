import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceTranscriptTurn } from "@/lib/voice-campaign-types";

/**
 * Regression test for the double-WhatsApp bug: both post-call triggers (live
 * stream close + recording transcription) invoke maybeSendPostCallFollowUp for
 * the same call. The dedupe claim must be written in the same tick as the
 * guard check — before the async body build — or both racers pass the guard
 * and the customer receives the message twice.
 */

const call: Record<string, unknown> = {
  id: "call-1",
  toNumber: "+919999999999",
  recipientId: "r1",
  followUps: [] as unknown[],
};
const campaign = {
  id: "camp-1",
  userId: "u1",
  datasetId: "quickhelp",
  companyName: "Acme",
  systemPrompt: "Key benefit: quick approval\nClose: thanks for your time",
};

vi.mock("@/lib/voice-campaign-store", () => ({
  findCall: vi.fn(() => ({ call, campaign })),
  upsertCallFollowUp: vi.fn((_callId: string, followUp: { id: string }) => {
    const list = call.followUps as Array<{ id: string }>;
    call.followUps = [...list.filter((f) => f.id !== followUp.id), followUp];
  }),
}));

// Slow LLM: the async window between guard check and (pre-fix) claim write.
vi.mock("@/lib/openai-client", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          await new Promise((resolve) => setTimeout(resolve, 120));
          return { choices: [{ message: { content: '{"body":"Follow-up body"}' } }] };
        },
      },
    },
  }),
}));

const sendWhatsAppTemplate = vi.fn(async (to: string) => ({
  sid: `sid-${sendWhatsAppTemplate.mock.calls.length}`,
  status: "submitted",
  to,
  from: "src",
}));

vi.mock("@/lib/gupshup-whatsapp-client", () => ({
  fetchGupshupWhatsAppTemplates: vi.fn(async () => []),
  resolveWhatsAppTemplatePayload: vi.fn(() => ({ templateId: "tpl-1", params: ["Acme"] })),
  sendWhatsAppTemplate: (...args: unknown[]) => sendWhatsAppTemplate(args[0] as string),
}));

vi.mock("@/lib/attribution-store", () => ({ createAttributionToken: vi.fn() }));
vi.mock("@/lib/customer-channel-memory", () => ({ recordCustomerChannelEvent: vi.fn() }));
vi.mock("@/lib/public-base-url", () => ({ resolvePublicBaseUrl: () => "http://localhost:3000" }));

function turn(role: VoiceTranscriptTurn["role"], text: string): VoiceTranscriptTurn {
  return { id: `${role}-${text.slice(0, 8)}`, role, text, at: new Date().toISOString() };
}

describe("maybeSendPostCallFollowUp dedupe", () => {
  beforeEach(() => {
    call.followUps = [];
    sendWhatsAppTemplate.mockClear();
    process.env.OPENAI_API_KEY = "test-key";
    process.env.VOICE_POST_CALL_FOLLOWUP_DELAY_MS = "0";
  });

  it("sends exactly once when both triggers race for the same call", async () => {
    const { maybeSendPostCallFollowUp } = await import("@/lib/voice-followup-sms");
    const turns = [
      turn("assistant", "Namaste, calling about your loan enquiry."),
      turn("user", "Haan, WhatsApp pe bhej do please."),
    ];

    await Promise.all([
      maybeSendPostCallFollowUp("call-1", "rec-live", turns),
      maybeSendPostCallFollowUp("call-1", "rec-transcription", turns),
    ]);

    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);

    // A late third trigger (retry, replay) must also back off.
    await maybeSendPostCallFollowUp("call-1", "rec-late", turns);
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);

    const followUps = call.followUps as Array<{ status: string; body: string }>;
    expect(followUps).toHaveLength(1);
    expect(followUps[0].status).toBe("sent");
    expect(followUps[0].body).toContain("Follow-up body");
  });
});
