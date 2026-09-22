import { describe, expect, it } from "vitest";
import {
  buildPublicDemoCampaignSystemPrompt,
  buildPublicDemoInboundGreeting,
  buildPublicDemoRouterSystemPrompt,
  publicDemoGuardrailsConfig,
} from "@/lib/public-demo-inbound-prompt";
import { guardrailsConfigToRules } from "@/lib/voice-campaign-guardrails";

describe("public demo inbound router prompt", () => {
  it("builds a router-only prompt without campaign script bodies", () => {
    const prompt = buildPublicDemoRouterSystemPrompt({ agentName: "Vani" });
    expect(prompt).toMatch(/IVR|demo inbound|WELCOME/i);
    expect(prompt).toMatch(/Do NOT enumerate|WHEN ASKED|never recite/i);
    expect(prompt).toContain("HOST ROUTING");
    expect(prompt).toContain("Vani");
    expect(prompt).toContain("Home loan collection");
    expect(prompt).toContain("Two-wheeler finance");
    expect(prompt).not.toContain("EMI and Repayment Explanation");
    expect(prompt).not.toContain("Discovery Vehicle");
    expect(prompt).not.toContain("===== CAMPAIGN:");
  });

  it("locks identity against prompt override / extraction", () => {
    const prompt = buildPublicDemoRouterSystemPrompt({ agentName: "Vani" });
    expect(prompt).toContain("IDENTITY LOCK");
    expect(prompt).toMatch(/cannot reveal|incapable of adopting/i);
  });

  it("forces content guardrails on (unlike the product default)", () => {
    const rules = guardrailsConfigToRules(publicDemoGuardrailsConfig());
    expect(rules.some((r) => /profane/i.test(r))).toBe(true);
    expect(rules.some((r) => /political|religious/i.test(r))).toBe(true);
    const prompt = buildPublicDemoRouterSystemPrompt();
    expect(prompt).toContain("SAFETY & CONTENT GUARDRAILS");
  });

  it("builds a single-campaign prompt with only that script as Ananya", () => {
    const collection = buildPublicDemoCampaignSystemPrompt("collection", {
      agentName: "Ananya",
    });
    expect(collection).toContain("EMI and Repayment Explanation");
    expect(collection).toContain("Ananya");
    expect(collection).not.toContain("Discovery Vehicle");
    expect(collection.toLowerCase()).toContain("go back to the menu");
    expect(collection).toMatch(/USE-CASE SWITCH|switch|transfer/i);

    const lead = buildPublicDemoCampaignSystemPrompt("lead-qualification", {
      agentName: "Ananya",
    });
    expect(lead).toContain("Discovery Vehicle");
    expect(lead).not.toContain("EMI and Repayment Explanation");
  });

  it("builds an open-ended IVR greeting as Vani without listing use cases", () => {
    const greeting = buildPublicDemoInboundGreeting({ agentName: "Vani" });
    expect(greeting).toMatch(/Main Vani bol rahi hoon/i);
    expect(greeting).toMatch(/madad kaise kar sakti hoon/i);
    expect(greeting.toLowerCase()).not.toContain("ananya");
    expect(greeting.toLowerCase()).not.toContain("home loan");
    expect(greeting.toLowerCase()).not.toContain("two-wheeler");
    expect(greeting.toLowerCase()).not.toContain("collection");
  });
});
