/**
 * End-to-end soft-route flow smoke (no live Plivo/Gemini).
 * Vani (IVR) → route → Ananya campaign → menu → Vani again.
 */
import { describe, expect, it } from "vitest";
import {
  applyPublicDemoRoute,
  buildPublicDemoRouteOverrideInstruction,
  detectPublicDemoRouteIntent,
  publicDemoWhatsAppAllowed,
} from "@/lib/public-demo-route";
import { buildPublicDemoInboundGreeting } from "@/lib/public-demo-inbound-prompt";
import {
  PUBLIC_DEMO_CAMPAIGN_ID,
  PUBLIC_DEMO_ROUTER_AGENT_NAME,
} from "@/lib/public-demo-personas";
import { planCustomerTurn } from "@/lib/plivo-gemini-live-turn-planner";
import type { CallConfig } from "@/lib/voice-call-state";
import { hostSendWhatsAppLink as sendWa } from "@/lib/plivo-gemini-live-send-link";

function routerConfig(): CallConfig {
  return {
    campaignId: PUBLIC_DEMO_CAMPAIGN_ID,
    systemPrompt: "router",
    firstMessage: buildPublicDemoInboundGreeting({
      agentName: PUBLIC_DEMO_ROUTER_AGENT_NAME,
    }),
    voice: "Aoede",
    voiceName: PUBLIC_DEMO_ROUTER_AGENT_NAME,
    language: "Hinglish",
    toNumber: "917987409984",
    isPublicDemo: true,
    activePersonaId: null,
  };
}

describe("public demo flow smoke (Vani → campaign → menu)", () => {
  it("greets as Vani, not Ananya", () => {
    const g = buildPublicDemoInboundGreeting();
    expect(g).toMatch(/Vani/);
    expect(g.toLowerCase()).not.toContain("ananya");
  });

  it("routes home-loan intent to collection / Ananya", () => {
    const cfg = routerConfig();
    expect(cfg.voiceName).toBe("Vani");
    const plan = planCustomerTurn({
      userText: "home loan ke regarding enquiry karne thi",
      source: "live",
      isPublicDemo: true,
      activePersonaId: null,
      callConfig: cfg,
      callId: "smoke-collection",
    });
    expect(plan.action).toBe("public_demo_route");
    expect(plan.publicDemoPersonaId).toBe("collection");
    expect(plan.instruction.length).toBeLessThan(4000);
    expect(plan.instruction).toMatch(/Ananya/);
    expect(plan.instruction).toMatch(/not Vani/i);
    expect(cfg.activePersonaId).toBe("collection");
    expect(cfg.voiceName).toBe("Ananya");
    expect(cfg.campaignId).not.toBe(PUBLIC_DEMO_CAMPAIGN_ID);
    expect(publicDemoWhatsAppAllowed(cfg)).toBe(true);
  });

  it("routes two-wheeler / bike intent to lead qualification", () => {
    const cfg = routerConfig();
    const plan = planCustomerTurn({
      userText: "two wheeler finance chahiye bike loan",
      source: "live",
      isPublicDemo: true,
      activePersonaId: null,
      callConfig: cfg,
      callId: "smoke-lead",
    });
    expect(plan.action).toBe("public_demo_route");
    expect(plan.publicDemoPersonaId).toBe("lead-qualification");
    expect(cfg.voiceName).toBe("Ananya");
    expect(cfg.activePersonaId).toBe("lead-qualification");
  });

  it("returns to Vani on main menu", () => {
    const cfg = routerConfig();
    applyPublicDemoRoute("smoke-menu", cfg, {
      kind: "persona",
      personaId: "collection",
    });
    expect(cfg.voiceName).toBe("Ananya");
    // Clear cooldown so menu can plan (detect menu, not cooldown).
    cfg.publicDemoRouteAppliedAtMs = Date.now() - 10_000;
    const plan = planCustomerTurn({
      userText: "go back to the menu",
      source: "live",
      isPublicDemo: true,
      activePersonaId: cfg.activePersonaId,
      callConfig: cfg,
      callId: "smoke-menu",
    });
    expect(plan.action).toBe("public_demo_menu");
    expect(plan.instruction).toMatch(/Vani/);
    expect(cfg.activePersonaId).toBeNull();
    expect(cfg.voiceName).toBe("Vani");
    expect(cfg.campaignId).toBe(PUBLIC_DEMO_CAMPAIGN_ID);
    expect(publicDemoWhatsAppAllowed(cfg)).toBe(false);
  });

  it("blocks WhatsApp while still on Vani / unrouted", () => {
    const cfg = routerConfig();
    const result = sendWa({
      callId: "smoke-wa",
      callConfig: cfg,
      sessionDump: { event() {} },
      sendClientInstruction() {},
    });
    expect(result.ok).toBe(false);
  });

  it("override instruction stays compact", () => {
    const text = buildPublicDemoRouteOverrideInstruction("collection");
    expect(text.length).toBeLessThan(4000);
    const intent = detectPublicDemoRouteIntent("emi repayment", null);
    expect(intent?.type === "route" ? intent.personaId : undefined).toBe(
      "collection",
    );
  });
});
