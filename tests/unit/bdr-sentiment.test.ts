import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BdrRecipient } from "@/lib/bdr/types";
const mocks = vi.hoisted(() => ({ row: {} as BdrRecipient }));
vi.mock("@/lib/bdr/store", () => ({
  listBdrCampaigns: () => [{ recipients: [mocks.row] }],
  updateBdrCall: (_id: string, mutate: (row: BdrRecipient) => void) => mutate(mocks.row),
}));
import { analyzeBdrSentimentsTick, bdrSentimentInput } from "@/lib/bdr/sentiment";
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test");
  mocks.row = { callId: "call", status: "completed", callOutcome: "conversation", transcript: [{ role: "user", text: "Yes, a walkthrough would be useful." }] } as BdrRecipient;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const modelResponse = (label: string, reason: string) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ label, reason }) } }] }));
describe("post-call sentiment", () => {
  it("stores an evidence-based label once and reanalyzes a late transcript change", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(modelResponse("positive", "Requested a walkthrough.")).mockResolvedValueOnce(modelResponse("negative", "Declined further contact."));
    vi.stubGlobal("fetch", fetch);
    await analyzeBdrSentimentsTick(); await analyzeBdrSentimentsTick();
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.row.sentiment?.label).toBe("positive");
    mocks.row.transcript!.push({ role: "user", text: "Actually, please do not contact me." });
    await analyzeBdrSentimentsTick();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.row.sentiment?.label).toBe("negative");
  });
  it("does not invent sentiment for a voicemail or score the screener's words", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    mocks.row.callOutcome = "voicemail";
    mocks.row.transcript = [{ role: "user", text: "Please leave a message", source: "voicemail" }];
    await analyzeBdrSentimentsTick();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.row.sentimentState).toBe("not_applicable");
    expect(bdrSentimentInput(mocks.row).input).not.toContain("Please leave");
  });
  it("leaves insufficient evidence unscored", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelResponse("insufficient", "Only a greeting was exchanged.")));
    await analyzeBdrSentimentsTick();
    expect(mocks.row.sentiment).toBeUndefined();
    expect(mocks.row.sentimentState).toBe("not_applicable");
  });
  it("bounds failures and does not retry rapidly or alter call status", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })); vi.stubGlobal("fetch", fetch);
    await analyzeBdrSentimentsTick(); await analyzeBdrSentimentsTick();
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.row.status).toBe("completed");
    expect(mocks.row.sentimentState).toBe("failed");
  });
});
