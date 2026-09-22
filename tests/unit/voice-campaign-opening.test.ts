import { describe, expect, it } from "vitest";

import type { VoiceFlowNode } from "@/lib/voice-campaign-flow";
import {
  extractOpeningLineFromWorkflow,
  resolveCampaignCanonicalOpening,
} from "@/lib/voice-campaign-opening";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";

function startNode(body: string): VoiceFlowNode {
  return {
    id: "start",
    type: "voiceNode",
    position: { x: 0, y: 0 },
    data: { kind: "start", title: "Connect and Greeting", body },
  };
}

describe("workflow opening resolution", () => {
  it("extracts Say: from the start node", () => {
    const opening = extractOpeningLineFromWorkflow([
      startNode(
        "Say: Hi, namaste! Main Ananya bol rahi hoon, TVS Finance ki AI Assistant. Kya meri baat {{Customer Name}} ji se ho rahi hai?\nPrivate guidance: Confirm identity.",
      ),
    ]);
    expect(opening).toBe(
      "Hi, namaste! Main Ananya bol rahi hoon, TVS Finance ki AI Assistant. Kya meri baat {{Customer Name}} ji se ho rahi hai?",
    );
  });

  it("prefers workflow opening over stale firstMessage", () => {
    const campaign = {
      firstMessage: "Hi, नमस्ते! मैं Ananya बोल रही हूँ — stale stored opener",
      editableScript: "",
      workflow: {
        nodes: [
          startNode(
            "Say: Hi, namaste! Main Ananya bol rahi hoon, TVS Finance ki AI Assistant. Kya meri baat {{Customer Name}} ji se ho rahi hai?",
          ),
        ],
      },
      language: "Hinglish",
      systemPrompt: "",
    } as Pick<
      VoiceCampaign,
      "firstMessage" | "editableScript" | "workflow" | "language" | "systemPrompt"
    >;

    expect(resolveCampaignCanonicalOpening(campaign)).toMatch(/^Hi, namaste! Main Ananya/);
    expect(resolveCampaignCanonicalOpening(campaign)).toMatch(/^Hi, namaste! Main Ananya/);
    expect(resolveCampaignCanonicalOpening(campaign)).not.toContain("नमस्ते");
  });
});
