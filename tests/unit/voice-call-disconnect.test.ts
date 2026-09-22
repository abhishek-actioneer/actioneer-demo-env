import { describe, expect, it } from "vitest";
import { shouldEndCallAfterAssistantTurn } from "@/lib/voice-call-disconnect";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";

function campaignWithEndBody(body: string): VoiceCampaign {
  return {
    id: "vc_test",
    userId: "user_test",
    name: "Test",
    datasetId: "vastu-hfc",
    segmentId: "seg_test",
    segmentName: "Test segment",
    purposeId: "p1",
    purposeName: "Test",
    systemPrompt: "prompt",
    firstMessage: "hello",
    scriptReasoning: "test fixture",
    phoneNumbers: [],
    agentId: "gemini",
    voice: "Aoede",
    language: "Hindi",
    status: "draft",
    calls: [],
    createdAt: new Date().toISOString(),
    workflow: {
      templateId: "t1",
      templateTitle: "Test",
      nodes: [
        {
          id: "end",
          type: "voiceNode",
          position: { x: 0, y: 0 },
          data: { kind: "end", title: "Close", body },
        },
      ],
      edges: [],
    },
  } as VoiceCampaign;
}

describe("shouldEndCallAfterAssistantTurn", () => {
  it("does not hang up when mid-call pitch opens with धन्यवाद then asks a question", () => {
    const said =
      "धन्यवाद! कॉल को ट्रेनिंग और ऑडिट पर्पस के लिए रिकॉर्ड किया जाएगा। " +
      "मैं Vastu Housing Finance से आपकी AI असिस्टेंट हूँ। " +
      "मैं Ravi के नाम से सबमिट की गई लोन एप्लीकेशन के बारे में कॉल कर रही हूँ। " +
      "क्या मैं सही व्यक्ति से बात कर रही हूँ?";

    expect(shouldEndCallAfterAssistantTurn(said)).toBe(false);
  });

  it("hangs up on a short closing thanks", () => {
    expect(shouldEndCallAfterAssistantTurn("धन्यवाद।")).toBe(true);
    expect(shouldEndCallAfterAssistantTurn("Dhanyavaad, have a nice day.")).toBe(true);
  });

  it("hangs up when soft thanks appears near the end of a wrap-up", () => {
    expect(
      shouldEndCallAfterAssistantTurn(
        "ठीक है, मैंने नोट कर लिया है। आपके समय के लिए धन्यवाद।",
      ),
    ).toBe(true);
  });

  it("does not hang up when soft thanks only opens a long non-question pitch", () => {
    const said =
      "धन्यवाद। कॉल को रिकॉर्ड किया जाएगा। मैं Vastu Housing Finance से बोल रही हूँ। " +
      "मैं लोन एप्लीकेशन के बारे में जानकारी देना चाहती हूँ। थोड़ा और विस्तार से बताती हूँ।";
    expect(shouldEndCallAfterAssistantTurn(said)).toBe(false);
  });

  it("does not hang up on end-node match when the turn still asks a question", () => {
    const campaign = campaignWithEndBody('Say: "धन्यवाद, आपका दिन शुभ हो।"');
    const said =
      "धन्यवाद! कॉल रिकॉर्ड की जाएगी। क्या मैं सही व्यक्ति से बात कर रही हूँ?";
    expect(shouldEndCallAfterAssistantTurn(said, campaign)).toBe(false);
  });
});
