import { describe, expect, it } from "vitest";
import { BDR_SPEAKING_STYLE, takeBdrSpeechPhrase } from "@/lib/bdr/speaking-style";

describe("natural spoken phrase boundaries", () => {
  it("keeps a short acknowledgement with the point that follows", () => {
    expect(takeBdrSpeechPhrase("Right. ")).toBeUndefined();
    expect(takeBdrSpeechPhrase("Right. Those calls are reaching your technicians after hours. What happens then?")).toEqual({ text: "Right. Those calls are reaching your technicians after hours.", rest: "What happens then?" });
  });
  it("does not force a mid-sentence cut at 120 characters", () => {
    expect(takeBdrSpeechPhrase("Your team could capture the caller's details and the kind of job they need before routing a concise summary to the technician on call")).toBeUndefined();
  });
  it("does not separate a decimal, initial or common abbreviation", () => {
    expect(takeBdrSpeechPhrase("The example amount you just mentioned was 12.")).toBeUndefined();
    expect(takeBdrSpeechPhrase("The example amount you just mentioned was 12.50 dollars. Next question?")?.text).toBe("The example amount you just mentioned was 12.50 dollars.");
    expect(takeBdrSpeechPhrase("That escalation could go directly to Dr. Smith for review. Anything else?")?.text).toBe("That escalation could go directly to Dr. Smith for review.");
  });
  it("flushes short questions and remaining text immediately when the model finishes", () => {
    expect(takeBdrSpeechPhrase("Which trade?", true)).toEqual({ text: "Which trade?", rest: "" });
    expect(takeBdrSpeechPhrase(" ", true)).toBeUndefined();
  });
  it("includes non-repetitive delivery while keeping identity and honesty", () => {
    expect(BDR_SPEAKING_STYLE).toContain("Do not start consecutive replies with the same phrase");
    expect(BDR_SPEAKING_STYLE).toContain("after the prospect finishes");
    expect(BDR_SPEAKING_STYLE).toContain("answer honestly");
    expect(BDR_SPEAKING_STYLE).toContain("No SSML");
  });
});
