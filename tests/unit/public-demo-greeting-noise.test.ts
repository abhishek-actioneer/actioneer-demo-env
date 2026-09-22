import { describe, expect, it } from "vitest";
import {
  hasShortConversationalReplySignal,
  isOutOfDomainTranscript,
} from "@/lib/plivo-gemini-live-transcript-guards";

describe("bare greeting as conversational signal", () => {
  it.each(["hello", "hi", "hey", "Hello?", "namaste", "हैलो", "मैडम", "नमस्ते"])(
    "treats %j as a short conversational reply, not noise",
    (utterance) => {
      expect(hasShortConversationalReplySignal(utterance)).toBe(true);
      expect(isOutOfDomainTranscript(utterance)).toBe(false);
    },
  );

  it("still discards short gibberish without a reply signal", () => {
    expect(hasShortConversationalReplySignal("xyz")).toBe(false);
    expect(isOutOfDomainTranscript("xyz")).toBe(true);
  });
});
