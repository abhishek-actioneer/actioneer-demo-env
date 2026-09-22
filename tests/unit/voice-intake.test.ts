import { describe, expect, it } from "vitest";
import { buildVoiceIntakePrompt, VOICE_INTAKE_SCHEMA } from "@/lib/prompts/voice-intake";
import { buildVoiceCampaignScriptPrompt } from "@/lib/prompts/voice-campaign";
import { getVoiceArchetype, listVoiceArchetypes } from "@/lib/voice-archetypes";
import type { Purpose } from "@/lib/purpose-types";

interface SchemaNode {
  type?: string | string[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaNode;
}

function collectObjectNodes(node: SchemaNode, path: string, out: Array<{ path: string; node: SchemaNode }>) {
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  if (types.includes("object") || node.properties) {
    out.push({ path, node });
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      collectObjectNodes(child, `${path}.${key}`, out);
    }
  }
  if (node.items) collectObjectNodes(node.items, `${path}[]`, out);
}

const CATALOG = listVoiceArchetypes().map((archetype) => ({
  id: archetype.id,
  label: archetype.label,
  sector: archetype.sector,
  description: archetype.description,
}));

describe("VOICE_INTAKE_SCHEMA", () => {
  it("is a strict schema with a name", () => {
    expect(VOICE_INTAKE_SCHEMA.name).toBe("voice_campaign_intake");
    expect(VOICE_INTAKE_SCHEMA.strict).toBe(true);
  });

  it("sets additionalProperties:false and a complete required array at every object level", () => {
    const objectNodes: Array<{ path: string; node: SchemaNode }> = [];
    collectObjectNodes(VOICE_INTAKE_SCHEMA.schema as unknown as SchemaNode, "$", objectNodes);
    expect(objectNodes.length).toBeGreaterThan(0);
    for (const { path, node } of objectNodes) {
      expect(node.additionalProperties, `additionalProperties at ${path}`).toBe(false);
      const keys = Object.keys(node.properties ?? {}).sort();
      expect([...(node.required ?? [])].sort(), `required at ${path}`).toEqual(keys);
    }
  });

  it("covers every VoiceIntakeResult field", () => {
    const properties = (VOICE_INTAKE_SCHEMA.schema as unknown as SchemaNode).properties ?? {};
    expect(Object.keys(properties).sort()).toEqual(
      ["agentGender", "archetypeId", "knownFacts", "languages", "mode", "openQuestions", "sector"],
    );
    expect(properties.archetypeId.type).toEqual(["string", "null"]);
  });
});

describe("buildVoiceIntakePrompt", () => {
  it("lists every archetype id from the supplied catalog", () => {
    const { system } = buildVoiceIntakePrompt({
      brief: "Remind pre-due customers about their upcoming EMI",
      archetypeCatalog: CATALOG,
    });
    for (const entry of CATALOG) {
      expect(system).toContain(`"${entry.id}"`);
    }
  });

  it("threads brief, dataset, and segment context into the user message", () => {
    const { user } = buildVoiceIntakePrompt({
      brief: "Call defaulters about the pending EMI of Rs. 4,500",
      datasetLabel: "Suvidha Capital",
      segmentName: "30-day overdue",
      archetypeCatalog: CATALOG,
    });
    expect(user).toContain("Call defaulters about the pending EMI of Rs. 4,500");
    expect(user).toContain("Suvidha Capital");
    expect(user).toContain("30-day overdue");
  });

  it("instructs literal knownFacts extraction and catalog-only archetype ids", () => {
    const { system } = buildVoiceIntakePrompt({ brief: "x", archetypeCatalog: CATALOG });
    expect(system).toContain("LITERAL substring");
    expect(system).toContain("Never invent an id that is not in the catalog");
  });
});

describe("buildVoiceCampaignScriptPrompt with archetype", () => {
  const segment = {
    id: "seg-1",
    name: "30-day overdue",
    sql: "SELECT 1",
    userCount: 1200,
    description: "Customers 30 days past due",
  };
  const purpose: Purpose = {
    purposeId: "p1",
    sku: "sku1",
    name: "EMI follow-up",
    category: "campaign-brief",
    tagline: "Pay on time",
    description: "Follow up on the pending EMI",
    valueProp: "Avoid penalties",
    priceDisplay: "-",
    cta: "Confirm a payment date",
  };
  const archetype = getVoiceArchetype("collections-post-due");
  if (!archetype) throw new Error("collections-post-due archetype missing");

  const build = (options?: Parameters<typeof buildVoiceCampaignScriptPrompt>[7]) =>
    buildVoiceCampaignScriptPrompt(
      segment,
      purpose,
      "Hinglish",
      { id: "suvidha-capital", label: "Suvidha Capital" },
      "Follow up on the pending EMI of Rs. 4,500",
      "Ananya",
      "female",
      options,
    );

  it("injects the stage skeleton in order", () => {
    const { system } = build({ archetype, knownFacts: [] });
    expect(system).toContain(`CAMPAIGN ARCHETYPE: ${archetype.label} (${archetype.id})`);
    expect(system).toContain("Use these stages in this order as your node plan");
    let cursor = -1;
    for (const stage of archetype.stages) {
      const index = system.indexOf(`${stage.title} — ${stage.goal}`);
      expect(index, `stage "${stage.title}" present`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("injects the slot schema with elicitation instruction", () => {
    const { system } = build({ archetype });
    expect(system).toContain("the call must establish these; phrase questions to elicit them");
    expect(system).toContain("payment_status (enum: paid | promised | disputed | refused)");
    expect(system).toContain("ptp_date (date)");
  });

  it("lists knownFacts and archetype safe defaults verbatim in ALLOWED FACT SOURCES", () => {
    const { system } = build({ archetype, knownFacts: ["pending EMI of Rs. 4,500"] });
    expect(system).toContain("ALLOWED FACT SOURCES");
    expect(system).toContain("- pending EMI of Rs. 4,500");
    for (const fact of archetype.safeDefaultFacts) {
      expect(system).toContain(`- ${fact}`);
    }
    expect(system).toContain("MUST be written as a {{Placeholder}} token");
    expect(system).toContain("a deterministic checker rejects unsourced facts");
  });

  it("omits the archetype block when no archetype is supplied", () => {
    const { system } = build();
    expect(system).not.toContain("CAMPAIGN ARCHETYPE");
    expect(system).not.toContain("ALLOWED FACT SOURCES");
    // Existing prompt rules survive the options extension.
    expect(system).toContain("Rules for the placeholder systemPrompt field");
  });

  it("keeps existing rules intact when the archetype block is injected", () => {
    const { system, user } = build({ archetype, knownFacts: ["pending EMI of Rs. 4,500"] });
    expect(system).toContain("Rules for workflow / talk track");
    expect(system).toContain("Rules for the placeholder systemPrompt field");
    expect(user).toContain("Follow up on the pending EMI of Rs. 4,500");
  });
});
