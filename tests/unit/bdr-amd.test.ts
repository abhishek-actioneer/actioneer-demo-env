import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import twilio from "twilio";
import type { BdrRecipient } from "@/lib/bdr/types";
import { POST } from "@/app/api/bdr/twilio/amd/route";

const mocks = vi.hoisted(() => ({ row: {} as BdrRecipient, update: vi.fn() }));
vi.mock("@/lib/bdr/store", () => ({
  updateBdrCall: (id: string, callback: (row: BdrRecipient) => void) => {
    mocks.update(id);
    callback(mocks.row);
  },
}));

beforeEach(() => {
  vi.stubEnv("VOICE_FORCE_WEBHOOK_VERIFY", "1");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC-test");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
  vi.stubEnv("VOICE_PUBLIC_BASE_URL", "https://example.com");
  mocks.row = { status: "connected", providerSid: "CA-test" } as BdrRecipient;
  mocks.update.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const request = (overrides: Record<string, string> = {}, signed = true) => {
  const url = "https://example.com/api/bdr/twilio/amd?callId=call-1";
  const params = { AccountSid: "AC-test", CallSid: "CA-test", AnsweredBy: "machine_end_beep", ...overrides };
  return new Request(url, { method: "POST", body: new URLSearchParams(params), headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    ...(signed ? { "x-twilio-signature": twilio.getExpectedTwilioSignature("test-token", url, params) } : {}),
  } });
};

describe("authenticated asynchronous answering-machine callbacks", () => {
  it("rejects unsigned callbacks and callbacks for another account", async () => {
    expect((await POST(request({}, false))).status).toBe(403);
    expect((await POST(request({ AccountSid: "AC-other" }))).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("persists a verified verdict and accepts duplicate delivery idempotently", async () => {
    expect((await POST(request())).status).toBe(204);
    expect((await POST(request())).status).toBe(204);
    expect(mocks.row.answeredBy).toBe("machine_end_beep");
    expect(mocks.row.status).toBe("connected");
    expect(mocks.update).toHaveBeenCalledWith("call-1");
  });
  it("ignores a different call SID without replacing the existing SID", async () => {
    await POST(request({ CallSid: "CA-other" }));
    expect(mocks.row.answeredBy).toBeUndefined();
    expect(mocks.row.providerSid).toBe("CA-test");
  });
  it("does not change a terminal call", async () => {
    mocks.row.status = "completed";
    await POST(request());
    expect(mocks.row.answeredBy).toBeUndefined();
  });
  it("ignores unknown verdicts", async () => {
    await POST(request({ AnsweredBy: "unexpected" }));
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
