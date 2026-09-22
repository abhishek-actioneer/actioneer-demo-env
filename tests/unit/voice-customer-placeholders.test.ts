import { describe, expect, it } from "vitest";
import {
  appendVoiceCustomerContextToSystemPrompt,
  applyVoiceCustomerPlaceholders,
  resolveVoiceCustomerDisplayName,
  restoreCustomerNamePlaceholdersFromEditableScript,
  type VoiceCustomerContext,
} from "@/lib/voice-customer-context";
import { compileVoiceCampaignScript, type VoiceFlowNode } from "@/lib/voice-campaign-flow";

const shanti: VoiceCustomerContext = {
  source: "generic",
  datasetId: "vastu-hfc",
  displayName: "Shanti",
  firstName: "Shanti",
  gender: "female",
};

describe("voice customer name placeholders", () => {
  it("resolves display name over first name", () => {
    expect(resolveVoiceCustomerDisplayName(shanti)).toBe("Shanti");
    expect(resolveVoiceCustomerDisplayName({ firstName: "Ram" })).toBe("Ram");
    expect(resolveVoiceCustomerDisplayName(undefined)).toBeUndefined();
  });

  it("fills {{Customer Name}} and sibling spellings from sampled context", () => {
    const script =
      "I'm reaching out regarding a loan application submitted under the name {{Customer Name}}. " +
      "Thank you so much for your time today, [Customer Name]. Hello [name] / [नाम] / {{customerName}}.";
    expect(applyVoiceCustomerPlaceholders(script, shanti)).toBe(
      "I'm reaching out regarding a loan application submitted under the name Shanti. " +
        "Thank you so much for your time today, Shanti. Hello Shanti / Shanti / Shanti.",
    );
  });

  it("leaves runtime slots and unfilled names alone when no context", () => {
    const script =
      "Continuing in {{Selected Language}}. Hello {{Customer Name}}. Slot {{Tomorrow / Today}} via {{Phone / Video}}.";
    expect(applyVoiceCustomerPlaceholders(script, undefined)).toBe(script);
  });

  it("fills {{Disbursed Amount}} / {{Disbursement Date}} from rawFields", () => {
    const customer: VoiceCustomerContext = {
      ...shanti,
      rawFields: {
        entity: "hfc",
        product_type: "home_purchase",
        disbursement_date: "2024-10-03",
        sanctioned_amount: "1360000",
        disbursed_amount: "1360000",
        interest_rate: "14.04",
      },
    };
    const script =
      "Hamare records ke hisaab se ₹{{Disbursed Amount}} amount {{Disbursement Date}} ko bheja gaya tha. " +
      "Continuing in {{Selected Language}}.";
    expect(applyVoiceCustomerPlaceholders(script, customer)).toBe(
      "Hamare records ke hisaab se ₹1360000 amount 2024-10-03 ko bheja gaya tha. " +
        "Continuing in {{Selected Language}}.",
    );
  });

  it("fills Customer Name inside appendVoiceCustomerContextToSystemPrompt", () => {
    const prompt = appendVoiceCustomerContextToSystemPrompt(
      "Am I speaking with {{Customer Name}}?",
      shanti,
    );
    expect(prompt).toContain("Am I speaking with Shanti?");
    expect(prompt).not.toContain("{{Customer Name}}");
    expect(prompt).toContain("Customer name: Shanti");
  });

  it("keeps {{Customer Name}} through compile (does not bake 'the customer')", () => {
    const nodes: VoiceFlowNode[] = [
      {
        id: "start",
        type: "voiceNode",
        position: { x: 0, y: 0 },
        data: { kind: "start", title: "Start", body: "Open", required: true },
      },
      {
        id: "identity",
        type: "voiceNode",
        position: { x: 0, y: 160 },
        data: {
          kind: "question",
          title: "Identity",
          body: "Say: I'm reaching out regarding a loan application submitted under the name {{Customer Name}}.",
          required: false,
        },
      },
    ];
    const compiled = compileVoiceCampaignScript({
      campaignName: "Vastu PD",
      template: {
        id: "t",
        title: "t",
        description: "t",
        objective: "t",
        audienceHint: "applicants",
        defaultCampaignName: "Vastu PD",
        firstMessage: "नमस्कार!",
        nodes: [],
        edges: [],
      },
      firstMessage: "नमस्कार!",
      nodes,
      edges: [],
      language: "Hindi",
      operatorScript:
        "VIDYA: I'm reaching out regarding a loan application submitted under the name {{Customer Name}}.",
    });
    expect(compiled.systemPrompt).toContain("{{Customer Name}}");
    expect(compiled.systemPrompt).not.toMatch(
      /under the name the customer/i,
    );
    // Workflow-primary: full Script-tab dump is not also injected.
    expect(compiled.systemPrompt).not.toContain("VIDYA:");

    const runtime = appendVoiceCustomerContextToSystemPrompt(compiled.systemPrompt, shanti);
    expect(runtime).toContain("under the name Shanti");
    expect(runtime).not.toContain("{{Customer Name}}");
  });

  it("restores only placeholder-backed 'the customer' occurrences from editableScript", () => {
    const baked =
      "You are Vidya.\n\n" +
      "Campaign script (primary talk track — follow this):\n" +
      "I'm reaching out regarding a loan under the name the customer. Wait for the customer.\n" +
      "Workflow handling rules:\n" +
      "- Always wait for the customer before continuing.\n";
    const editable =
      "I'm reaching out regarding a loan under the name {{Customer Name}}. Wait for the customer.";
    const restored = restoreCustomerNamePlaceholdersFromEditableScript(baked, editable);
    expect(restored).toContain("under the name {{Customer Name}}");
    // Non-placeholder "the customer" in the same script section stays put.
    expect(restored).toContain("Wait for the customer.");
    expect(restored).toContain("Always wait for the customer before continuing");

    const runtime = appendVoiceCustomerContextToSystemPrompt(restored, shanti);
    expect(runtime).toContain("under the name Shanti");
    expect(runtime).toContain("Wait for the customer.");
    expect(runtime).toContain("Always wait for the customer before continuing");
  });
});
