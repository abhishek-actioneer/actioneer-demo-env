import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeBdrPhone, prepareRecipients, personalizeBdr, type BdrCampaign, type BdrContact } from "@/lib/bdr/types";
import { claimBdrRecipient, closeBdrStoreForTests, createBdrCampaign, findBdrCall, getBdrCampaign, mutateBdrCampaign, suppressBdrPhone, updateBdrCall } from "@/lib/bdr/store";
import { applyBdrCallStatus, bdrStreamToken, validBdrStreamToken } from "@/lib/bdr/telephony";

let directory: string;
const contact = (id: string, phone = "+12025550123", doNotContact = false): BdrContact => ({ id, phone, doNotContact, firstName: "Alex", lastName: "Test", company: "Example", title: "Owner" });
const campaign = (id = "campaign-1", status: BdrCampaign["status"] = "draft"): BdrCampaign => ({ id, userId: "operator", name: "Test campaign", audienceId: "audience", audienceName: "Test audience", status, recipients: prepareRecipients([contact("contact-1"), contact("contact-2", "+12025550124")]), script: "Test qualification script", opening: "Hello {{first_name}}", voiceId: "test-voice", language: "English", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "bdr-unit-")); vi.stubEnv("VOICE_STORAGE_DIR", directory); });
afterEach(() => { closeBdrStoreForTests(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

describe("BDR import and personalization", () => {
  it("normalizes international numbers without guessing their country", () => {
    expect(normalizeBdrPhone("+1 (202) 555-0123")).toBe("+12025550123");
    expect(normalizeBdrPhone("0091 98765 43210")).toBe("+919876543210");
    expect(normalizeBdrPhone("2025550123")).toBeUndefined();
    expect(normalizeBdrPhone("+12025550123 ext 4")).toBeUndefined();
  });
  it("excludes opt-outs, malformed numbers, and duplicate phones", () => {
    const rows = prepareRecipients([contact("1", "+12025550129", true), contact("2"), contact("3"), contact("4", "123")]);
    expect(rows.map((r) => r.status)).toEqual(["excluded", "pending", "excluded", "excluded"]);
  });
  it("propagates a phone opt-out even when another record for that number is not opted out", () => {
    const rows = prepareRecipients([contact("1"), contact("2", "+12025550123", true)]);
    expect(rows.every((r) => r.status === "excluded")).toBe(true);
  });
  it("personalizes known placeholders and handles missing company", () => {
    expect(personalizeBdr("Hi {{first_name}} at {{company}}", { ...contact("1"), company: "" })).toBe("Hi Alex at your team");
  });
});

describe("durable campaign queue", () => {
  it("never dispatches an imported draft or a paused campaign", () => {
    createBdrCampaign(campaign());
    createBdrCampaign(campaign("paused", "paused"));
    expect(claimBdrRecipient(1)).toBeUndefined();
  });
  it("treats duplicate imports as an upsert without resetting call progress", () => {
    createBdrCampaign(campaign("one", "running"));
    claimBdrRecipient(1);
    createBdrCampaign(campaign("one"));
    expect(getBdrCampaign("one")?.recipients[0].status).toBe("dispatching");
  });
  it("enforces ownership on reads, mutations, and ID collisions", () => {
    createBdrCampaign(campaign());
    expect(getBdrCampaign("campaign-1", "other")).toBeUndefined();
    expect(() => mutateBdrCampaign("campaign-1", "other", () => undefined)).toThrow();
    expect(() => createBdrCampaign({ ...campaign(), userId: "other" })).toThrow();
  });
  it("claims a contact once and keeps its reservation across restart", () => {
    createBdrCampaign(campaign("one", "running"));
    const first = claimBdrRecipient(1)!;
    expect(first.recipient.callId).toBeTruthy();
    closeBdrStoreForTests();
    expect(claimBdrRecipient(1)).toBeUndefined();
    expect(findBdrCall(first.recipient.callId!)?.recipient.id).toBe("contact-1");
  });
  it("honors persistent do-not-call suppression across campaigns", () => {
    createBdrCampaign(campaign("one", "running"));
    suppressBdrPhone("+12025550123");
    claimBdrRecipient(1);
    expect(getBdrCampaign("one")?.recipients[0].status).toBe("excluded");
    expect(claimBdrRecipient(1)?.recipient.id).toBe("contact-2");
  });
  it("does not let late callbacks regress a terminal state or change the call SID", () => {
    createBdrCampaign(campaign("one", "running"));
    const { recipient } = claimBdrRecipient(1)!;
    applyBdrCallStatus(recipient.callId!, "CA-test", "completed");
    applyBdrCallStatus(recipient.callId!, "CA-test", "ringing");
    applyBdrCallStatus(recipient.callId!, "CA-other", "in-progress");
    expect(findBdrCall(recipient.callId!)?.recipient.status).toBe("completed");
    expect(findBdrCall(recipient.callId!)?.recipient.providerSid).toBe("CA-test");
  });
  it("preserves streamed transcripts when a status update arrives", () => {
    createBdrCampaign(campaign("one", "running"));
    const { recipient } = claimBdrRecipient(1)!;
    updateBdrCall(recipient.callId!, (r) => { r.transcript = [{ role: "user", text: "Call me later" }]; });
    applyBdrCallStatus(recipient.callId!, "CA-test", "completed");
    expect(findBdrCall(recipient.callId!)?.recipient.transcript).toHaveLength(1);
  });
  it("requires the signed stream token to match the specific call", () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "unit-test-secret");
    expect(validBdrStreamToken("call-1", bdrStreamToken("call-1"))).toBe(true);
    expect(validBdrStreamToken("call-2", bdrStreamToken("call-1"))).toBe(false);
    expect(validBdrStreamToken("call-1", "")).toBe(false);
  });
});
