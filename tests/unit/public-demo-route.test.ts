import { describe, expect, it } from "vitest";
import {
  applyPublicDemoRoute,
  buildPublicDemoRouteOverrideInstruction,
  detectPublicDemoRouteIntent,
  inferPublicDemoRouteFromContext,
  MAX_ROUTE_OVERRIDE_CHARS,
  publicDemoWhatsAppAllowed,
  resolvePublicDemoCampaignId,
  resolvePublicDemoRouteIntent,
  summarizeCampaignScriptForOverride,
} from "@/lib/public-demo-route";
import { PUBLIC_DEMO_CAMPAIGN_ID } from "@/lib/public-demo-personas";
import type { CallConfig } from "@/lib/voice-call-state";
import { hostSendWhatsAppLink } from "@/lib/plivo-gemini-live-send-link";
import { planCustomerTurn, applyCustomerTurnPlan } from "@/lib/plivo-gemini-live-turn-planner";

function baseConfig(overrides: Partial<CallConfig> = {}): CallConfig {
  return {
    campaignId: PUBLIC_DEMO_CAMPAIGN_ID,
    systemPrompt: "router",
    firstMessage: "hi",
    voice: "Aoede",
    voiceName: "Vani",
    language: "Hinglish",
    toNumber: "919999999999",
    isPublicDemo: true,
    activePersonaId: null,
    ...overrides,
  };
}

describe("public demo route detection", () => {
  it("routes collection and lead intents from free-form speech", () => {
    expect(detectPublicDemoRouteIntent("home loan emi help", null)).toEqual({
      type: "route",
      personaId: "collection",
    });
    expect(detectPublicDemoRouteIntent("I want two wheeler finance", null)).toEqual({
      type: "route",
      personaId: "lead-qualification",
    });
  });

  it("returns menu only when already on a persona", () => {
    expect(detectPublicDemoRouteIntent("go back to the menu", null)).toBeNull();
    expect(detectPublicDemoRouteIntent("main menu please", "collection")).toEqual({
      type: "menu",
    });
  });

  it("ignores re-selecting the same persona", () => {
    expect(detectPublicDemoRouteIntent("home loan collection", "collection")).toBeNull();
  });

  it("treats a different persona while routed as a switch", () => {
    expect(detectPublicDemoRouteIntent("bike finance please", "collection")).toEqual({
      type: "route",
      personaId: "lead-qualification",
    });
  });

  it("summarises campaign script when OVERRIDE would exceed 80% of max", () => {
    const override = buildPublicDemoRouteOverrideInstruction("collection");
    expect(override.length).toBeLessThanOrEqual(MAX_ROUTE_OVERRIDE_CHARS);
    expect(override).toMatch(/SYSTEM OVERRIDE/i);
    expect(override.length).toBeGreaterThan(800);
    const summarised = summarizeCampaignScriptForOverride(
      "Note: secret\n1. Step one\nSay: Hello\nRouting: skip\n2. Step two\nSay: World\n" + "x".repeat(5000),
      400,
    );
    expect(summarised.length).toBeLessThanOrEqual(400);
    expect(summarised).not.toMatch(/^Note:/m);
    expect(summarised).toMatch(/summarised/i);
  });

  it("detects mid-call ordinal switch with transfer language", () => {
    expect(
      detectPublicDemoRouteIntent("Can you switch the call back to one?", "lead-qualification"),
    ).toEqual({ type: "route", personaId: "collection" });
    expect(
      detectPublicDemoRouteIntent("please transfer me to option 2", "collection"),
    ).toEqual({ type: "route", personaId: "lead-qualification" });
    expect(
      detectPublicDemoRouteIntent("connect me to someone who can help with home loan", "lead-qualification"),
    ).toEqual({ type: "route", personaId: "collection" });
  });

  it("routes affirmations after the IVR named a single use case", () => {
    expect(
      inferPublicDemoRouteFromContext(
        "Ji, confirmed.",
        "Great. Toh main confirm kar sakti hoon ki aapne Home loan ki details discuss karna chahte hain?",
        null,
      ),
    ).toEqual({ type: "route", personaId: "collection" });
    expect(
      resolvePublicDemoRouteIntent(
        "Yes.",
        null,
        "I can help with Home loan collection. Is that what you need?",
      ),
    ).toEqual({ type: "route", personaId: "collection" });
  });

  it("routes ASR near-miss collection cues", () => {
    expect(detectPublicDemoRouteIntent("मैं कम्यून के रिगार्डिंग बात कर रही थी", null)).toEqual({
      type: "route",
      personaId: "collection",
    });
    expect(detectPublicDemoRouteIntent("regarding my refund", null)).toEqual({
      type: "route",
      personaId: "collection",
    });
  });

  it("plans soft-route when caller affirms the offered use case", () => {
    const cfg = baseConfig();
    const plan = planCustomerTurn({
      userText: "Ji, confirmed.",
      source: "live",
      isPublicDemo: true,
      activePersonaId: null,
      callConfig: cfg,
      callId: "call-affirm-route",
      lastAssistantText:
        "Toh main confirm kar sakti hoon ki aapne Home loan collection discuss karna chahte hain?",
    });
    expect(plan.action).toBe("public_demo_route");
    expect(plan.publicDemoPersonaId).toBe("collection");
    expect(cfg.activePersonaId).toBe("collection");
  });
});

describe("applyPublicDemoRoute + WhatsApp gate", () => {
  it("mutates CallConfig to the routed campaign id and clears on menu", () => {
    const cfg = baseConfig();
    applyPublicDemoRoute("call-test-1", cfg, {
      kind: "persona",
      personaId: "collection",
    });
    expect(cfg.activePersonaId).toBe("collection");
    expect(cfg.campaignId).toBe(resolvePublicDemoCampaignId("collection"));
    expect(cfg.voiceName).toBe("Ananya");
    expect(cfg.systemPrompt).toMatch(/ACTIVE CAMPAIGN: collection/i);
    expect(publicDemoWhatsAppAllowed(cfg)).toBe(true);

    applyPublicDemoRoute("call-test-1", cfg, { kind: "router" });
    expect(cfg.activePersonaId).toBeNull();
    expect(cfg.campaignId).toBe(PUBLIC_DEMO_CAMPAIGN_ID);
    expect(cfg.linkDest).toBeUndefined();
    expect(publicDemoWhatsAppAllowed(cfg)).toBe(false);
  });

  it("blocks host WhatsApp while unrouted on public demo", () => {
    const cfg = baseConfig();
    const result = hostSendWhatsAppLink({
      callId: "call-wa-block",
      callConfig: cfg,
      sessionDump: { event() {} },
      sendClientInstruction() {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/not routed|blocked/i);
    }
  });

  it("plans a soft-route OVERRIDE when intent matches", () => {
    const cfg = baseConfig();
    const plan = planCustomerTurn({
      userText: "I need help with home loan EMI",
      source: "live",
      isPublicDemo: true,
      activePersonaId: null,
      callConfig: cfg,
      callId: "call-plan-route",
    });
    expect(plan.action).toBe("public_demo_route");
    expect(plan.publicDemoPersonaId).toBe("collection");
    expect(plan.instruction).toMatch(/SYSTEM OVERRIDE/i);
    expect(plan.instruction).toMatch(/stay on the call/i);
    expect(plan.instruction.length).toBeLessThan(4000);
    expect(cfg.activePersonaId).toBe("collection");
  });

  it("suppresses racing direct_answer for a few seconds after soft route", () => {
    const cfg = baseConfig();
    const first = planCustomerTurn({
      userText: "Home loan ke recording",
      source: "live",
      isPublicDemo: true,
      activePersonaId: null,
      callConfig: cfg,
      callId: "call-plan-race",
    });
    expect(first.action).toBe("public_demo_route");
    const second = planCustomerTurn({
      userText: "Home loan ke recording jankari chahiye.",
      source: "live",
      isPublicDemo: true,
      activePersonaId: cfg.activePersonaId,
      callConfig: cfg,
      callId: "call-plan-race",
    });
    expect(second.action).toBe("none");
    expect(second.instructionReason).toBe("public_demo_route_cooldown");
  });

  it("still allows mid-call switch during post-route cooldown", () => {
    const cfg = baseConfig();
    const first = planCustomerTurn({
      userText: "home loan emi",
      source: "live",
      isPublicDemo: true,
      activePersonaId: null,
      callConfig: cfg,
      callId: "call-plan-mid-switch",
    });
    expect(first.action).toBe("public_demo_route");
    expect(cfg.activePersonaId).toBe("collection");
    const mid = planCustomerTurn({
      userText: "Can you switch the call back to two?",
      source: "live",
      isPublicDemo: true,
      activePersonaId: cfg.activePersonaId,
      callConfig: cfg,
      callId: "call-plan-mid-switch",
    });
    expect(mid.action).toBe("public_demo_route");
    expect(mid.publicDemoPersonaId).toBe("lead-qualification");
    expect(cfg.activePersonaId).toBe("lead-qualification");
  });

  it("plays filler ambient before sending the Ananya OVERRIDE", () => {
    const cfg = baseConfig();
    const plan = planCustomerTurn({
      userText: "I need help with home loan EMI",
      source: "live",
      isPublicDemo: true,
      activePersonaId: null,
      callConfig: cfg,
      callId: "call-ambient",
    });
    expect(plan.action).toBe("public_demo_route");

    const queued: string[] = [];
    const instructions: string[] = [];
    const dropClears: string[] = [];
    let deferred: { delayMs: number; run: () => void } | undefined;

    applyCustomerTurnPlan(
      {
        sessionDump: { event() {} },
        tryClearAudiblePlayback: () => false,
        interruptCurrentModelAudio() {},
        clearModelAudioDropGuard: (reason) => {
          dropClears.push(reason);
        },
        activateCustomerPause() {},
        noteControlIntentSent() {},
        markDecisionResolutionApplied() {},
        sendClientInstruction: (text) => {
          instructions.push(text);
        },
        protectAckUntil() {},
        queueOutboundMulaw: (payload) => {
          queued.push(payload);
        },
        scheduleDeferred: (delayMs, run) => {
          deferred = { delayMs, run };
        },
      },
      plan,
      "I need help with home loan EMI",
      { fingerprint: "", atMs: 0 },
      "live",
    );

    expect(queued).toHaveLength(1);
    expect(queued[0]!.length).toBeGreaterThan(100);
    expect(instructions).toHaveLength(0);
    expect(dropClears).toHaveLength(0);
    expect(deferred?.delayMs).toBe(1050);

    deferred!.run();
    expect(dropClears).toContain("public_demo_switch_ambient_done");
    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toMatch(/SYSTEM OVERRIDE/i);
  });

  it("plans IVR-safe direct answer when public demo is unrouted", () => {
    const cfg = baseConfig();
    const plan = planCustomerTurn({
      userText: "aap kya kya help kar sakti ho meri query solve",
      source: "live",
      isPublicDemo: true,
      activePersonaId: null,
      callConfig: cfg,
      callId: "call-plan-ivr",
    });
    expect(plan.action).toBe("direct_answer");
    expect(plan.instructionReason).toBe("direct_customer_answer_demo_ivr");
    expect(plan.instruction).toMatch(/IVR|welcome host/i);
    expect(plan.instruction).toMatch(/Home loan collection|Two-wheeler finance/i);
    expect(plan.instruction).not.toMatch(/Campaign script/);
  });

  it("plans unrouted WhatsApp refusal on public demo", () => {
    const cfg = baseConfig();
    const plan = planCustomerTurn({
      userText: "please send details on WhatsApp",
      source: "live",
      isPublicDemo: true,
      activePersonaId: null,
      hasLinkTool: true,
      callConfig: cfg,
      callId: "call-plan-wa",
    });
    expect(plan.action).toBe("whatsapp_send_link");
    expect(plan.instructionReason).toBe("whatsapp_send_demo_unrouted");
    expect(plan.instruction).toMatch(/cannot send WhatsApp now/i);
  });
});
