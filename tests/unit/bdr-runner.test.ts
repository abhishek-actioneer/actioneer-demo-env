import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBdrStoreForTests, createBdrCampaign, getBdrCampaign, mutateBdrCampaign } from "@/lib/bdr/store";
import { prepareRecipients, type BdrCampaign } from "@/lib/bdr/types";
const mocks = vi.hoisted(() => ({ contact: vi.fn(), dial: vi.fn() }));
vi.mock("@/lib/bdr/config", () => ({ bdrReadiness: () => ({ calling: true }) }));
vi.mock("@/lib/bdr/monaco", () => ({ getMonacoContact: mocks.contact }));
vi.mock("@/lib/bdr/telephony", async (original) => ({ ...await original<typeof import("@/lib/bdr/telephony")>(), dialBdrContact: mocks.dial }));
import { dispatchBdrTick } from "@/lib/bdr/runner";
let directory: string;
const contact = { id: "contact", firstName: "Alex", lastName: "Test", company: "Example", title: "Owner", phone: "+12025550123", doNotContact: false };
function seed(status: BdrCampaign["status"]) {
  createBdrCampaign({ id: "campaign", userId: "owner", name: "Test", audienceId: "aud", audienceName: "Test", script: "Test script", opening: "Hi", voiceId: "voice", language: "English", status, recipients: prepareRecipients([contact]), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "bdr-runner-")); vi.stubEnv("VOICE_STORAGE_DIR", directory); mocks.contact.mockReset().mockResolvedValue(contact); mocks.dial.mockReset().mockResolvedValue("CA-test"); });
afterEach(() => { closeBdrStoreForTests(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
describe("manual launch dispatcher", () => {
  it("does not call contacts just because an audience has been imported", async () => {
    seed("draft"); await dispatchBdrTick(); expect(mocks.dial).not.toHaveBeenCalled(); expect(mocks.contact).not.toHaveBeenCalled();
  });
  it("dials only after manual launch and only once across ticks", async () => {
    seed("draft"); mutateBdrCampaign("campaign", "owner", (c) => { c.status = "running"; });
    await dispatchBdrTick(); await dispatchBdrTick(); expect(mocks.dial).toHaveBeenCalledTimes(1);
    expect(getBdrCampaign("campaign")?.recipients[0].status).toBe("calling");
  });
  it("rechecks the pause button after awaiting Monaco", async () => {
    seed("running"); mocks.contact.mockImplementation(async () => { mutateBdrCampaign("campaign", "owner", (c) => { c.status = "paused"; }); return contact; });
    await dispatchBdrTick(); expect(mocks.dial).not.toHaveBeenCalled(); expect(getBdrCampaign("campaign")?.recipients[0].status).toBe("pending");
  });
  it("skips a contact who opted out after import", async () => {
    seed("running"); mocks.contact.mockResolvedValue({ ...contact, doNotContact: true });
    await dispatchBdrTick(); expect(mocks.dial).not.toHaveBeenCalled(); expect(getBdrCampaign("campaign")?.recipients[0].status).toBe("excluded");
  });
  it("does not silently call a changed phone number", async () => {
    seed("running"); mocks.contact.mockResolvedValue({ ...contact, phone: "+12025550125" });
    await dispatchBdrTick(); expect(mocks.dial).not.toHaveBeenCalled();
  });
  it("pauses on uncertain dial results without automatically retrying", async () => {
    seed("running"); mocks.dial.mockRejectedValue(new Error("Network timeout"));
    await dispatchBdrTick(); await dispatchBdrTick();
    expect(mocks.dial).toHaveBeenCalledTimes(1); expect(getBdrCampaign("campaign")?.status).toBe("paused"); expect(getBdrCampaign("campaign")?.recipients[0].status).toBe("needs_review");
  });
  it("shows a definite Twilio rejection without classifying it as an uncertain call", async () => {
    seed("running"); mocks.dial.mockRejectedValue(Object.assign(new Error("The From number is not a Twilio number"), { status: 400, code: 21212 }));
    await dispatchBdrTick(); await dispatchBdrTick();
    const campaign = getBdrCampaign("campaign");
    expect(mocks.dial).toHaveBeenCalledTimes(1);
    expect(campaign?.status).toBe("paused");
    expect(campaign?.recipients[0].status).toBe("failed");
    expect(campaign?.error).toContain("code 21212");
  });
});
