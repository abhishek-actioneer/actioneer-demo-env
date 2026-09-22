/**
 * Unit coverage for defaultStarterChips — the dataset-driven replacement for
 * the hardcoded FundsIndia starter pills shown when no segment is selected
 * on the voice campaign "new" page. Pure function, no JSX / DOM involved.
 */
import { describe, it, expect } from "vitest";
import { defaultStarterChips, segmentStarterChips } from "@/lib/voice-campaign-starters";
import {
  extractOpeningLineFromScript,
} from "@/lib/voice-campaign-studio-utils";
import type { Purpose } from "@/lib/purpose-types";

function makePurpose(overrides: Partial<Purpose>): Purpose {
  return {
    purposeId: "p1",
    sku: "sku-1",
    name: "Portfolio Review",
    category: "advisory",
    tagline: "A quick health check",
    description: "Long description text",
    valueProp: "Helps investors stay on track",
    priceDisplay: "Free",
    cta: "Book now",
    ...overrides,
  };
}

describe("defaultStarterChips", () => {
  it("with 0 purposes returns only the neutral pad chips, in order", () => {
    const chips = defaultStarterChips([]);
    // Only 3 neutral pad chips are defined, so with zero purposes to draw
    // from, the result tops out at 3 — the "pad to exactly 4" rule can only
    // be honored when there are purposes (or enough pad candidates) to draw on.
    expect(chips).toEqual([
      {
        label: "Reactivation check-in",
        brief: "Call dormant customers with a warm check-in to understand their situation and re-engage them.",
        iconKey: "phone",
      },
      {
        label: "Feedback check-in",
        brief: "Call recent customers to gather feedback on their experience and surface issues early.",
        iconKey: "refresh",
      },
      {
        label: "Service follow-up",
        brief: "Follow up on a recent interaction and offer help completing the next step.",
        iconKey: "file",
      },
    ]);
  });

  it("with 2 purposes returns 2 purpose chips + 2 pads (exactly 4 total)", () => {
    const purposes: Purpose[] = [
      makePurpose({ name: "Portfolio Review", tagline: "A quick health check", valueProp: "Helps investors stay on track" }),
      makePurpose({ name: "SIP Activation", tagline: "Start investing regularly", valueProp: "Builds long-term wealth" }),
    ];
    const chips = defaultStarterChips(purposes);

    expect(chips).toHaveLength(4);
    expect(chips[0]).toEqual({
      label: "Portfolio Review",
      brief: "A quick health check. Helps investors stay on track.",
      iconKey: "trending",
      purposeId: "p1",
    });
    expect(chips[1]).toEqual({
      label: "SIP Activation",
      brief: "Start investing regularly. Builds long-term wealth.",
      iconKey: "refresh",
      purposeId: "p1",
    });
    expect(chips[2].label).toBe("Reactivation check-in");
    expect(chips[3].label).toBe("Feedback check-in");
  });

  it("with 5 purposes returns the first 3 purpose chips + 1 pad", () => {
    const purposes: Purpose[] = Array.from({ length: 5 }, (_, i) =>
      makePurpose({ name: `Purpose ${i}`, tagline: `Tagline ${i}`, valueProp: `Value ${i}` }),
    );
    const chips = defaultStarterChips(purposes);

    expect(chips).toHaveLength(4);
    expect(chips.map((c) => c.label)).toEqual([
      "Purpose 0",
      "Purpose 1",
      "Purpose 2",
      "Reactivation check-in",
    ]);
    expect(chips.map((c) => c.iconKey)).toEqual(["trending", "refresh", "file", "phone"]);
  });

  it("interpolates a custom entityName into the neutral pad chip briefs", () => {
    const chips = defaultStarterChips([], "investor");

    expect(chips[0].brief).toBe(
      "Call dormant investors with a warm check-in to understand their situation and re-engage them.",
    );
    expect(chips[1].brief).toBe(
      "Call recent investors to gather feedback on their experience and surface issues early.",
    );
    // Service follow-up brief has no entity interpolation.
    expect(chips[2].brief).toBe("Follow up on a recent interaction and offer help completing the next step.");
  });

  it("skips a pad chip whose label collides with an already-included purpose name", () => {
    const purposes: Purpose[] = [
      makePurpose({ name: "Reactivation check-in", tagline: "Win back lapsed users", valueProp: "Re-engages inactive accounts" }),
    ];
    const chips = defaultStarterChips(purposes);

    // "Reactivation check-in" pad chip must be skipped since a purpose chip
    // already carries that exact label.
    expect(chips.map((c) => c.label)).toEqual([
      "Reactivation check-in",
      "Feedback check-in",
      "Service follow-up",
    ]);
    expect(chips[0].brief).toBe("Win back lapsed users. Re-engages inactive accounts.");
    expect(chips[0].iconKey).toBe("trending");
    expect(chips[0].purposeId).toBe("p1");
  });
});

/**
 * segmentStarterChips replaces the hardcoded FundsIndia keyword ladder
 * (SIP / ELSS / portfolio lanes) that used to live in the voice campaign
 * "new" page. Chips must come from the dataset's purpose catalog only,
 * contextualized to the selected segment — no domain keyword rules.
 */
const SUVIDHA_LIKE_PURPOSES: Purpose[] = [
  makePurpose({
    purposeId: "SUVIDHA_PREAPPROVED_PL",
    name: "Pre-approved Personal Loan",
    tagline: "Pre-approved top-up for borrowers in good standing",
    valueProp: "Instant eligibility check with no branch visit",
  }),
  makePurpose({
    purposeId: "SUVIDHA_EMI_SUPPORT",
    name: "EMI Support Follow-up",
    tagline: "Respectful payment help for missed or bounced EMIs",
    valueProp: "Capture payment intent or route hardship cases to the branch",
  }),
];

const INVESTMENT_TERMS = /sip|elss|portfolio|invest/i;

describe("segmentStarterChips", () => {
  it("derives segment chips from the dataset's purposes, not hardcoded investment lanes", () => {
    const chips = segmentStarterChips(
      { name: "High-risk EMI bounce borrowers", description: "Borrowers with 2+ bounced EMIs" },
      SUVIDHA_LIKE_PURPOSES,
      "borrowers",
    );
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.label).not.toMatch(INVESTMENT_TERMS);
      expect(chip.brief).not.toMatch(INVESTMENT_TERMS);
    }
    const labels = chips.map((chip) => chip.label);
    expect(labels).toContain("Pre-approved Personal Loan");
    expect(labels).toContain("EMI Support Follow-up");
  });

  it("references the selected segment in purpose-derived briefs", () => {
    const chips = segmentStarterChips(
      { name: "Recent loan closures" },
      SUVIDHA_LIKE_PURPOSES,
      "borrowers",
    );
    const purposeChip = chips.find((chip) => chip.label === "Pre-approved Personal Loan");
    expect(purposeChip?.brief).toContain("Recent loan closures");
    expect(purposeChip?.purposeId).toBe("SUVIDHA_PREAPPROVED_PL");
  });

  it("applies no domain keyword rules — a SIP-named segment on a loan dataset still gets loan-catalog chips", () => {
    const chips = segmentStarterChips(
      { name: "Dormant SIP investors", description: "" },
      SUVIDHA_LIKE_PURPOSES,
      "borrowers",
    );
    const labels = chips.map((chip) => chip.label);
    expect(labels).toContain("Pre-approved Personal Loan");
    expect(labels).toContain("EMI Support Follow-up");
    expect(labels.every((label) => !INVESTMENT_TERMS.test(label))).toBe(true);
  });

  it("falls back to the neutral default chips when the dataset has no purposes", () => {
    const chips = segmentStarterChips({ name: "Any segment", description: "" }, [], "borrowers");
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.brief).not.toMatch(INVESTMENT_TERMS);
    }
  });

  it("caps chips at 4", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      makePurpose({ purposeId: `p_${i}`, name: `Loan Offer ${i}`, tagline: `Tagline ${i}`, valueProp: `Value ${i}` }),
    );
    const chips = segmentStarterChips({ name: "Dormant borrowers", description: "" }, many, "borrowers");
    expect(chips.length).toBeLessThanOrEqual(4);
  });
});

describe("extractOpeningLineFromScript", () => {
  it("extracts the VIDYA opener from a PD script", () => {
    const script = `
AI Name: Vidya
STEP 1 — GREETING & LANGUAGE PREFERENCE
VIDYA: नमस्कार! आप किस भाषा में बात करना पसंद करेंगे?
[Wait for the customer]
VIDYA: This call will be recorded for training and audit purposes.
`;
    const opening = extractOpeningLineFromScript(script);
    expect(opening).toBe("नमस्कार! आप किस भाषा में बात करना पसंद करेंगे?");
  });
});

describe("compileVoiceCampaignScript runtime prompt", () => {
  it("keeps the shared template catalog free of dataset-specific campaign scripts", async () => {
    const { VOICE_CAMPAIGN_TEMPLATES } = await import("@/lib/voice-campaign-flow");
    const serialized = JSON.stringify(VOICE_CAMPAIGN_TEMPLATES);

    expect(serialized).not.toContain("FundsIndia");
    expect(serialized).not.toContain("fundsindia-dormant");
  });

  it("includes company + workflow talk track + guardrails, not full script dump or purpose catalog facts", async () => {
    const { compileVoiceCampaignScript, VOICE_CAMPAIGN_TEMPLATES } = await import(
      "@/lib/voice-campaign-flow"
    );
    const template = VOICE_CAMPAIGN_TEMPLATES[0];
    const purpose = makePurpose({
      purposeId: "VASTU_TOPUP",
      name: "Existing Customer Top-Up Loan",
      priceDisplay: "Special top-up rate 9.5%",
      valueProp: "Extra funds against existing home loan",
    });
    const operatorScript =
      "VIDYA: नमस्कार! आप किस भाषा में बात करना पसंद करेंगे?\nVIDYA: This call is recorded.";
    const compiled = compileVoiceCampaignScript({
      template,
      campaignName: "PD language test",
      firstMessage: "नमस्कार! आप किस भाषा में बात करना पसंद करेंगे?",
      nodes: template.nodes,
      edges: template.edges,
      purpose,
      dataset: { companyName: "Vastu Housing Finance", label: "Vastu" },
      language: "Hindi",
      guardrails: ["Never promise loan approval on this call."],
      operatorScript,
    });
    expect(compiled.systemPrompt).toContain("Vastu Housing Finance");
    expect(compiled.systemPrompt).toContain("Campaign workflow (primary talk track");
    expect(compiled.systemPrompt).toContain("Workflow handling rules:");
    // Full Script-tab dump must not overcrowding the live prompt when workflow exists.
    expect(compiled.systemPrompt).not.toContain(operatorScript);
    expect(compiled.systemPrompt).not.toContain("Campaign script (primary talk track");
    expect(compiled.systemPrompt).toContain("Never promise loan approval on this call.");
    expect(compiled.systemPrompt).not.toContain("Campaign purpose facts");
    expect(compiled.systemPrompt).not.toContain("Existing Customer Top-Up Loan");
    expect(compiled.systemPrompt).not.toContain("Special top-up rate 9.5%");
    // Node talk-track from the template workflow should be present.
    expect(template.nodes.some((n) => n.data.kind !== "start")).toBe(true);
    const sampleBody = template.nodes.find((n) => n.data.kind !== "start")?.data.body;
    if (sampleBody?.trim()) {
      expect(compiled.systemPrompt).toContain(
        sampleBody.trim().slice(0, Math.min(40, sampleBody.trim().length)),
      );
    }
  });

  it("falls back to operator script when workflow has no talk-track nodes", async () => {
    const { compileVoiceCampaignScript } = await import("@/lib/voice-campaign-flow");
    const operatorScript = "Say: Hello, this is a fallback-only talk track.";
    const compiled = compileVoiceCampaignScript({
      template: {
        id: "empty",
        title: "Empty",
        description: "Empty",
        objective: "Empty",
        audienceHint: "customers",
        defaultCampaignName: "Empty",
        firstMessage: "Hello",
        nodes: [],
        edges: [],
      },
      campaignName: "Fallback",
      firstMessage: "Hello",
      nodes: [],
      edges: [],
      language: "English",
      operatorScript,
    });
    expect(compiled.systemPrompt).toContain(operatorScript);
    expect(compiled.systemPrompt).toContain("Campaign workflow (primary talk track");
  });
});
