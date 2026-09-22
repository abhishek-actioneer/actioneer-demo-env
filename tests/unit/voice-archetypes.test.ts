import { describe, expect, it } from "vitest";
import { VOICE_ARCHETYPES, getVoiceArchetype, listVoiceArchetypes } from "@/lib/voice-archetypes";
import { extractFactAtoms } from "@/lib/voice-fact-ledger";
import type { VoiceUniversalRouteKind } from "@/lib/voice-campaign-flow";

const REQUIRED_ROUTE_KINDS: VoiceUniversalRouteKind[] = [
  "end_call",
  "do_not_call",
  "not_interested",
  "busy_callback",
  "wrong_person",
  "change_language",
  "question_confusion",
  "escalation",
  "silence_unclear",
  "voicemail_screening",
];

describe("voice archetypes", () => {
  it("ships the 7 corpus-derived archetypes", () => {
    expect(VOICE_ARCHETYPES.map((archetype) => archetype.id)).toEqual([
      "collections-pre-due",
      "collections-post-due",
      "welcome-onboarding",
      "x-sell-pre-approved",
      "activation-mandate",
      "lead-qualification",
      "health-reminder",
    ]);
  });

  it("looks up archetypes by id and returns null for unknown ids", () => {
    expect(getVoiceArchetype("collections-post-due")?.sector).toBe("bfsi-collections");
    expect(getVoiceArchetype("nonexistent")).toBeNull();
    expect(listVoiceArchetypes()).toHaveLength(7);
  });

  for (const archetype of VOICE_ARCHETYPES) {
    describe(archetype.id, () => {
      it("has exactly one start stage and at least one end stage", () => {
        expect(archetype.stages.filter((stage) => stage.kind === "start")).toHaveLength(1);
        expect(archetype.stages.some((stage) => stage.kind === "end")).toBe(true);
      });

      it("has between 5 and 8 stages with unique ids", () => {
        expect(archetype.stages.length).toBeGreaterThanOrEqual(5);
        expect(archetype.stages.length).toBeLessThanOrEqual(8);
        expect(new Set(archetype.stages.map((stage) => stage.id)).size).toBe(archetype.stages.length);
      });

      it("binds all 10 universal route kinds exactly once", () => {
        const kinds = archetype.defaultUniversalRoutes.map((route) => route.kind);
        expect(kinds).toHaveLength(REQUIRED_ROUTE_KINDS.length);
        for (const kind of REQUIRED_ROUTE_KINDS) {
          expect(kinds.filter((candidate) => candidate === kind)).toHaveLength(1);
        }
      });

      it("carries a non-empty sector guardrail pack", () => {
        expect(archetype.guardrailPack.length).toBeGreaterThan(0);
      });

      it("keeps safeDefaultFacts free of currency and percentage atoms", () => {
        for (const fact of archetype.safeDefaultFacts) {
          const atoms = extractFactAtoms(fact);
          expect(atoms.filter((atom) => atom.kind === "currency" || atom.kind === "percentage")).toEqual([]);
        }
      });
    });
  }
});
