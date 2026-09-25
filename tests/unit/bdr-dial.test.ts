import { afterEach, expect, it, vi } from "vitest";
import { dialBdrContact } from "@/lib/bdr/telephony";

const mocks = vi.hoisted(() => ({ create: vi.fn(async () => ({ sid: "CA-test" })) }));
vi.mock("twilio", () => ({ default: () => ({ calls: { create: mocks.create } }) }));
afterEach(() => vi.unstubAllEnvs());

it("requests non-blocking message-end detection with authenticated callback routing", async () => {
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC-test");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+12025550123");
  vi.stubEnv("VOICE_PUBLIC_BASE_URL", "https://example.com");
  expect(await dialBdrContact("+12025550124", "call-1")).toBe("CA-test");
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
    machineDetection: "DetectMessageEnd", asyncAmd: "true", machineDetectionTimeout: 45,
    asyncAmdStatusCallback: "https://example.com/api/bdr/twilio/amd?callId=call-1",
    asyncAmdStatusCallbackMethod: "POST", to: "+12025550124", from: "+12025550123",
  }));
});
