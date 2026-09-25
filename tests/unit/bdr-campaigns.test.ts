import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST } from "@/app/api/bdr/campaigns/route";
import { PATCH } from "@/app/api/bdr/campaigns/[id]/route";
import { closeBdrStoreForTests, getBdrCampaign, mutateBdrCampaign } from "@/lib/bdr/store";
import { BDR_TEMPLATES } from "@/lib/bdr/templates";

vi.mock("@/lib/bdr/http", () => ({ bdrRoute: (handler: (user: string) => unknown) => handler("test-operator") }));
vi.mock("@/lib/bdr/monaco", () => ({ importMonacoAudience: async (id: string) => ({
  audience: { id, name: "Test segment" },
  contacts: [{ id: "contact-1", firstName: "Alex", lastName: "Test", company: "Example", title: "Owner", phone: "+12025550123" }],
}) }));
const id = "00000000-0000-4000-8000-000000000001";
const audienceId = "00000000-0000-4000-8000-000000000002";
let directory: string;
const request = (body: unknown) => new Request("https://example.com/api/bdr/campaigns", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "bdr-campaigns-")); vi.stubEnv("VOICE_STORAGE_DIR", directory); });
afterEach(() => { closeBdrStoreForTests(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

describe("campaign template persistence", () => {
  it.each(BDR_TEMPLATES)("imports $id as a draft with its full script and voicemail", async (template) => {
    await POST(request({ id, audienceId, templateId: template.id }));
    const saved = getBdrCampaign(id)!;
    expect(saved).toMatchObject({ templateId: template.id, opening: template.opening, script: template.script, voicemail: template.voicemail, status: "draft" });
    expect(saved.recipients[0].status).toBe("pending");
    expect(saved.recipients[0].callId).toBeUndefined();
  });
  it("saves a newly applied template and custom voicemail without starting calls", async () => {
    await POST(request({ id, audienceId }));
    const template = BDR_TEMPLATES[1];
    const fields = { ...getBdrCampaign(id)!, templateId: template.id, script: template.script, opening: template.opening, voicemail: "A custom voicemail from Daniel." };
    await PATCH(request({ action: "save", fields }), { params: Promise.resolve({ id }) });
    expect(getBdrCampaign(id)).toMatchObject({ templateId: template.id, voicemail: fields.voicemail, status: "draft" });
  });
  it("does not overwrite a previous import when the request is retried", async () => {
    await POST(request({ id, audienceId, templateId: "field-services" }));
    await POST(request({ id, audienceId, templateId: "financial-services" }));
    expect(getBdrCampaign(id)?.templateId).toBe("field-services");
  });
  it("rejects unknown templates", async () => {
    await expect(POST(request({ id, audienceId, templateId: "unknown" }))).rejects.toThrow();
    expect(getBdrCampaign(id)).toBeUndefined();
  });
  it("prevents template changes while a campaign is running", async () => {
    await POST(request({ id, audienceId }));
    mutateBdrCampaign(id, "test-operator", (campaign) => { campaign.status = "running"; });
    await expect(PATCH(request({ action: "save", fields: getBdrCampaign(id) }), { params: Promise.resolve({ id }) })).rejects.toThrow("Pause the campaign");
  });
});
