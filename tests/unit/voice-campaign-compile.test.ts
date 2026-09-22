import { describe, expect, it } from "vitest";
import {
  compileVoiceCampaignScript,
  VOICE_CAMPAIGN_TEMPLATES,
  type VoiceUniversalRoute,
} from "@/lib/voice-campaign-flow";
import {
  buildCampaignRuntimePrompt,
  buildVoiceSeedTurns,
} from "@/lib/voice-campaign-runtime-prompt";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";

const blankTemplate = VOICE_CAMPAIGN_TEMPLATES.find((t) => t.id === "blank")!;

const ROUTES: VoiceUniversalRoute[] = [
  {
    kind: "do_not_call",
    label: "Do not call",
    trigger: "the customer asks to stop calling or remove their number",
    behavior: "Apologize once and confirm they will not be called again.",
    terminal: true,
  },
  {
    kind: "busy_callback",
    label: "Busy",
    trigger: "the customer says they are busy",
    behavior: "Acknowledge briefly and offer a callback at {{companyName}}'s calling hours.",
    targetNodeId: "end",
    terminal: false,
  },
];

function compile(universalRoutes?: VoiceUniversalRoute[]) {
  return compileVoiceCampaignScript({
    template: blankTemplate,
    campaignName: "Compile test campaign",
    nodes: blankTemplate.nodes,
    edges: blankTemplate.edges,
    dataset: { companyName: "Acme Finance" },
    language: "Hinglish",
    voice: "Sulafat",
    universalRoutes,
  });
}

describe("compileVoiceCampaignScript universal routes", () => {
  it("renders a universal-routes section with trigger, behavior, terminal and target title", () => {
    const { systemPrompt } = compile(ROUTES);

    expect(systemPrompt).toContain(
      "Universal routes (these apply from ANY point in the call, interrupting the workflow):",
    );
    expect(systemPrompt).toContain(
      "- If the customer asks to stop calling or remove their number: Apologize once and confirm they will not be called again. Then end the call.",
    );
    // Non-terminal route resolves targetNodeId to the node title.
    expect(systemPrompt).toContain('Then continue from the "Close Call" step.');
    // Route text runs through renderVoiceTemplateText like node bodies.
    expect(systemPrompt).toContain("Acme Finance's calling hours");
    expect(systemPrompt).not.toContain("{{companyName}}");
  });

  it("places the section after the talk track and before the workflow handling rules", () => {
    const { systemPrompt } = compile(ROUTES);
    const talkTrackIdx = systemPrompt.indexOf("Campaign workflow");
    const routesIdx = systemPrompt.indexOf("Universal routes");
    const rulesIdx = systemPrompt.indexOf("Workflow handling rules:");

    expect(talkTrackIdx).toBeGreaterThanOrEqual(0);
    expect(routesIdx).toBeGreaterThan(talkTrackIdx);
    expect(rulesIdx).toBeGreaterThan(routesIdx);
  });

  it("renders no universal-routes section when no routes are provided", () => {
    expect(compile(undefined).systemPrompt).not.toContain("Universal routes");
    expect(compile([]).systemPrompt).not.toContain("Universal routes");
  });
});

function makeCampaign(overrides: Partial<VoiceCampaign> = {}): VoiceCampaign {
  return {
    id: "vc_test",
    name: "Test campaign",
    segmentId: "seg-1",
    segmentName: "Segment",
    purposeId: "pur-1",
    purposeName: "Purpose",
    systemPrompt: "",
    firstMessage: "Namaste, ek minute baat ho payegi?",
    scriptReasoning: "",
    agentId: "gemini-live",
    voice: "Sulafat",
    language: "Hinglish",
    phoneNumbers: [],
    status: "draft",
    calls: [],
    createdAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildVoiceSeedTurns", () => {
  const variants: Array<{ language: string; voice: string }> = [
    { language: "Hinglish", voice: "Sulafat" },
    { language: "Hindi", voice: "Charon" },
    { language: "English", voice: "" },
    { language: "Tamil", voice: "Sulafat" }, // unsupported language falls back to English
  ];

  it("returns at least two exchanges starting with a user turn", () => {
    for (const variant of variants) {
      const turns = buildVoiceSeedTurns(makeCampaign(variant));
      expect(turns.length).toBeGreaterThanOrEqual(2);
      expect(turns[0].role).toBe("user");
      expect(turns.some((t) => t.role === "model")).toBe(true);
      // Alternating roles: each exchange is user → model.
      for (let i = 0; i < turns.length; i += 1) {
        expect(turns[i].role).toBe(i % 2 === 0 ? "user" : "model");
        expect(turns[i].text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("contains no digits or currency in any seed text", () => {
    for (const variant of variants) {
      for (const turn of buildVoiceSeedTurns(makeCampaign(variant))) {
        expect(turn.text).not.toMatch(/[0-9₹]/);
        expect(turn.text).not.toMatch(/\bRs\b/i);
        expect(turn.text).not.toMatch(/rupees|rupaye/i);
      }
    }
  });
});

describe("buildCampaignRuntimePrompt prompt-source short-circuit", () => {
  const editableScript = 'Say: Namaste ji, main aapke account ke baare mein baat karna chahti hoon.';

  it("uses the persisted systemPrompt when systemPromptSource is 'compiled'", () => {
    const campaign = makeCampaign({
      systemPrompt: "COMPILED_PROMPT_MARKER\nFollow the compiled workflow.",
      systemPromptSource: "compiled",
      editableScript,
    });
    const { systemPrompt } = buildCampaignRuntimePrompt(campaign);
    expect(systemPrompt).toContain("COMPILED_PROMPT_MARKER");
    expect(systemPrompt).not.toContain("CAMPAIGN SCRIPT — PRIMARY SOURCE OF TRUTH");
  });

  it("keeps the editableScript-first behavior when systemPromptSource is absent", () => {
    const campaign = makeCampaign({
      systemPrompt: "COMPILED_PROMPT_MARKER\nFollow the compiled workflow.",
      editableScript,
    });
    const { systemPrompt } = buildCampaignRuntimePrompt(campaign);
    expect(systemPrompt).toContain("CAMPAIGN SCRIPT — PRIMARY SOURCE OF TRUTH");
    expect(systemPrompt).toContain(editableScript);
    expect(systemPrompt).not.toContain("COMPILED_PROMPT_MARKER");
  });

  it("falls back to editableScript when systemPromptSource is 'compiled' but systemPrompt is blank", () => {
    const campaign = makeCampaign({
      systemPrompt: "   ",
      systemPromptSource: "compiled",
      editableScript,
    });
    const { systemPrompt } = buildCampaignRuntimePrompt(campaign);
    expect(systemPrompt).toContain("CAMPAIGN SCRIPT — PRIMARY SOURCE OF TRUTH");
  });
});
