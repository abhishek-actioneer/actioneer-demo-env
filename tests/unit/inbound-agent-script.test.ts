import { describe, expect, it } from "vitest";
import { buildInboundAgentSystemPrompt } from "@/lib/inbound-agent-prompt";
import type { InboundAgentConfig } from "@/lib/inbound-agent-config";

// Two DIDs on one Plivo account must be able to behave as two different agents
// (a welcome line and a collections line). The talk-track lives on the binding,
// so the same persona can serve both numbers.

function config(overrides: Partial<InboundAgentConfig> = {}): InboundAgentConfig {
  return {
    campaignId: "vc_test",
    mode: "inbound-agent",
    agentName: "Mira",
    companyName: "Vastu Housing Finance",
    language: "Hinglish",
    voice: "Aoede",
    knowledgeEnabled: true,
    verificationRequiredForAccount: true,
    ...overrides,
  };
}

const COLLECTIONS = "Confirm the caller's EMI due date, then offer to schedule a payment.";

describe("buildInboundAgentSystemPrompt — per-number script", () => {
  it("runs the default greet-and-discover framing when no script is set", () => {
    const prompt = buildInboundAgentSystemPrompt(config());
    expect(prompt).toContain("let the caller lead");
    expect(prompt).not.toContain("YOUR WORKFLOW ON THIS LINE");
  });

  it("swaps in the script when one is set", () => {
    const prompt = buildInboundAgentSystemPrompt(config({ scriptOverride: COLLECTIONS }));
    expect(prompt).toContain("YOUR WORKFLOW ON THIS LINE");
    expect(prompt).toContain(COLLECTIONS);
    expect(prompt).not.toContain("let the caller lead");
  });

  it("never lets a script imply the agent placed the call", () => {
    const prompt = buildInboundAgentSystemPrompt(config({ scriptOverride: COLLECTIONS }));
    expect(prompt).toContain("You did NOT call them");
  });

  it("keeps the grounding rails under a script", () => {
    // A script must not be able to talk the agent out of these.
    const prompt = buildInboundAgentSystemPrompt(config({ scriptOverride: COLLECTIONS }));
    expect(prompt).toContain("NEVER invent interest rates");
    expect(prompt).toContain("Do not promise a live transfer");
  });

  it("keeps the verification rail under a script when it is on", () => {
    const prompt = buildInboundAgentSystemPrompt(
      config({ scriptOverride: COLLECTIONS, verificationRequiredForAccount: true }),
    );
    expect(prompt).toContain("requires identity verification");
  });

  it("drops only the verification rail when explicitly disabled", () => {
    // Collections needs this off to discuss dues at all — but the rest of the
    // safety block must survive.
    const prompt = buildInboundAgentSystemPrompt(
      config({ scriptOverride: COLLECTIONS, verificationRequiredForAccount: false }),
    );
    expect(prompt).not.toContain("requires identity verification");
    expect(prompt).toContain("NEVER invent interest rates");
  });

  it("treats a whitespace-only script as no script", () => {
    const prompt = buildInboundAgentSystemPrompt(config({ scriptOverride: "   " }));
    expect(prompt).toContain("let the caller lead");
    expect(prompt).not.toContain("YOUR WORKFLOW ON THIS LINE");
  });

  it("gives two numbers genuinely different prompts", () => {
    const welcome = buildInboundAgentSystemPrompt(
      config({ scriptOverride: "Thank the caller for their new home loan and confirm their details." }),
    );
    const collections = buildInboundAgentSystemPrompt(config({ scriptOverride: COLLECTIONS }));
    expect(welcome).not.toEqual(collections);
    expect(collections).toContain("EMI due date");
    expect(welcome).toContain("new home loan");
  });
});
