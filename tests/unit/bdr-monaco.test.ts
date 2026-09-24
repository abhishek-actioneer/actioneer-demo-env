import { afterEach, describe, expect, it, vi } from "vitest";
import { importMonacoAudience, listMonacoAudiences } from "@/lib/bdr/monaco";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Monaco API adapter", () => {
  it("imports every page and preserves opt-outs", async () => {
    vi.stubEnv("MONACO_API_KEY", "test-token");
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { id: "aud", name: "Audience", contact_count: 2, status: "active" } }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "c1", phone_number: "+12025550123", do_not_contact: true }], pagination: { total_pages: 2, total_count: 2 } }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "c2", phone_number: "+12025550124" }], pagination: { total_pages: 2, total_count: 2 } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await importMonacoAudience("aud");
    expect(result.contacts).toHaveLength(2);
    expect(result.contacts[0].doNotContact).toBe(true);
    expect(fetchMock.mock.calls[2][0]).toContain("page=2");
    expect(fetchMock.mock.calls.every((call) => call[1].method === "GET")).toBe(true);
  });
  it("does not return partial contacts if a later page fails", async () => {
    vi.stubEnv("MONACO_API_KEY", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ data: { id: "aud", name: "Audience", contact_count: 2, status: "active" } }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "c1" }], pagination: { total_pages: 2, total_count: 2 } }))
      .mockResolvedValueOnce(new Response("private diagnostic", { status: 500 })));
    await expect(importMonacoAudience("aud")).rejects.toThrow("Monaco request failed (500)");
  });
  it("surfaces missing credentials without calling Monaco", async () => {
    vi.stubEnv("MONACO_API_KEY", "");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(listMonacoAudiences()).rejects.toThrow("MONACO_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
