import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CallConfig } from "@/lib/voice-call-state";

const mocks = vi.hoisted(() => ({
  createAttributionToken: vi.fn(),
  recordCustomerChannelEvent: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
  upsertCallFollowUp: vi.fn(),
}));

vi.mock("@/lib/public-base-url", () => ({
  resolvePublicBaseUrl: () => "https://staging.example.test",
}));

vi.mock("@/lib/attribution-store", () => ({
  createAttributionToken: (...args: unknown[]) => mocks.createAttributionToken(...args),
}));

vi.mock("@/lib/voice-campaign-store", () => ({
  upsertCallFollowUp: (...args: unknown[]) => mocks.upsertCallFollowUp(...args),
}));

vi.mock("@/lib/customer-channel-memory", () => ({
  recordCustomerChannelEvent: (...args: unknown[]) => mocks.recordCustomerChannelEvent(...args),
}));

vi.mock("@/features/integrations/server/providers/gupshup/whatsapp-client", () => ({
  sendWhatsAppTemplate: (...args: unknown[]) => mocks.sendWhatsAppTemplate(...args),
}));

import { hostSendWhatsAppLink } from "@/lib/plivo-gemini-live-send-link";

const callConfig: CallConfig = {
  campaignId: "campaign-1",
  datasetId: "dataset-1",
  systemPrompt: "prompt",
  firstMessage: "hello",
  voice: "voice-1",
  language: "English",
  toNumber: "919981999999",
  userId: "user-1",
  linkDest: "https://merchant.example.test/apply",
  linkTemplate: "Open your details: {link}",
};

describe("hostSendWhatsAppLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAttributionToken.mockReturnValue({ token: "token-1" });
    mocks.sendWhatsAppTemplate.mockResolvedValue({
      sid: "gs-1",
      status: "submitted",
      from: "919991990651",
      to: callConfig.toNumber,
      provider: "gupshup",
      contentSid: "approved-template-1",
    });
  });

  it("uses only the approved template endpoint and records provider submission accurately", async () => {
    const sessionEvent = vi.fn();
    const sendClientInstruction = vi.fn();

    const started = hostSendWhatsAppLink({
      callId: "call-1",
      callConfig,
      sessionDump: { event: sessionEvent },
      sendClientInstruction,
    });

    expect(started.ok).toBe(true);
    await vi.waitFor(() => expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledOnce());

    const [, input] = mocks.sendWhatsAppTemplate.mock.calls[0];
    expect(input).toMatchObject({
      userId: "user-1",
      runtimeVariables: {
        message: "Open your details: https://staging.example.test/api/t/token-1",
        link: "https://staging.example.test/api/t/token-1",
      },
    });
    expect(input).not.toHaveProperty("media");

    await vi.waitFor(() => {
      expect(mocks.upsertCallFollowUp).toHaveBeenLastCalledWith(
        "call-1",
        expect.objectContaining({
          status: "sent",
          messageMode: "template",
          providerStatus: "submitted",
          contentSid: "approved-template-1",
        }),
      );
    });
    expect(mocks.recordCustomerChannelEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "whatsapp.template_sent",
        providerMessageId: "gs-1",
        status: "submitted",
      }),
    );
    expect(sendClientInstruction).toHaveBeenCalledWith(
      expect.stringContaining("Do not claim it was delivered or read"),
      "tool_send_link_success",
      { deferUntilIdle: true },
    );
  });

  it("works without a configured link destination, falling back to generic text", async () => {
    const noLinkConfig: CallConfig = { ...callConfig, linkDest: undefined, linkTemplate: undefined };
    const sessionEvent = vi.fn();
    const sendClientInstruction = vi.fn();

    const started = hostSendWhatsAppLink({
      callId: "call-2",
      callConfig: noLinkConfig,
      sessionDump: { event: sessionEvent },
      sendClientInstruction,
    });

    expect(started.ok).toBe(true);
    expect(mocks.createAttributionToken).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledOnce());

    const [, input] = mocks.sendWhatsAppTemplate.mock.calls[0];
    expect(input.runtimeVariables.message).toBeTruthy();
    expect(input.runtimeVariables).not.toHaveProperty("link");
    expect(input.runtimeVariables).not.toHaveProperty("url");
  });

  it("sends at most once per call — a second trigger for the same callId is a no-op", async () => {
    const sendClientInstruction = vi.fn();

    const first = hostSendWhatsAppLink({
      callId: "call-3",
      callConfig,
      sessionDump: { event: vi.fn() },
      sendClientInstruction,
    });
    expect(first.ok).toBe(true);
    await vi.waitFor(() => expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledOnce());

    const second = hostSendWhatsAppLink({
      callId: "call-3",
      callConfig,
      sessionDump: { event: vi.fn() },
      sendClientInstruction,
    });
    expect(second).toEqual({ ok: false, message: expect.stringContaining("already been sent") });
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledOnce();
  });
});
