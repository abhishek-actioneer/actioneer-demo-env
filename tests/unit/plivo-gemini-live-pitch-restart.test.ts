import { describe, expect, it } from "vitest";
import {
  buildPitchContinuationInstruction,
  buildSemanticContinuationInstruction,
  isBargeInCutStub,
  isIncompletePitchFragment,
  isIncompleteSemanticReply,
  looksLikeAssistantEchoInUserTranscript,
  looksLikeAssistantPitchRestart,
  mergeIncrementalTranscript,
  pitchRemainderAfterSaid,
  shouldCutAssistantPitchRestart,
  shouldProtectPitchPlayback,
  stripUserCrosstalkFromAssistant,
} from "@/lib/plivo-gemini-live-transcript-guards";
import { buildSemanticResolutionInstruction } from "@/lib/voice-semantic-traps";

describe("looksLikeAssistantPitchRestart", () => {
  it("detects full pitch regenerating after short opening fragment", () => {
    const previous = "आपका लोन रिसेंटली";
    const next =
      "आपका लोन अभी रिसेंटली disburse हुआ था, इसलिए एक छोटा सा चेक कर रही हूँ - आगे 3-6 महीने में फंड की ज़रूरत पड़ सकती है क्या?";
    expect(looksLikeAssistantPitchRestart(previous, next)).toBe(true);
  });

  it("does not flag a mid-sentence continuation", () => {
    const previous = "आपका लोन रिसेंटली";
    const next = "डिस्बर्स हुआ था, इसलिए एक छोटा सा चेक कर रही हूँ। क्या फंड की जरूरत है?";
    expect(looksLikeAssistantPitchRestart(previous, next)).toBe(false);
  });

  it("does not flag extending a 2-token stub (log stutter case)", () => {
    const previous = "आपका लोन";
    const next = "आपका लोन रिसेंटली disburse हुआ था, इसलिए एक छोटा सा चेक कर रही हूँ";
    expect(looksLikeAssistantPitchRestart(previous, next)).toBe(false);
  });

  it("does not flag mid-phrase pickup after incomplete pitch (log case)", () => {
    const previous = "आपका लोन रिसेंटली डिस्बर्स हुआ था, इसलिएक छोटा सा चेकर रही";
    const next = "रिसेंटली डिस्बर्स हुआ था, इसलिएक छोटा सा चेकर रही हूँ - आगे 3-6 महीने में";
    expect(looksLikeAssistantPitchRestart(previous, next)).toBe(false);
    expect(
      shouldCutAssistantPitchRestart({
        previous,
        next,
        instructionReason: "none",
      }),
    ).toBe(false);
  });

  it("detects soft restate after mid-phrase fragment (log case)", () => {
    const previous = "अभी रिसेंटली disburse हुआ था, इसलिएक छोटा";
    const next =
      "हाँ, तो मैं कह रही थी कि आपका लोन अभी हाल ही में डिस्बर्स हुआ था, इसलिएक छोटा सा चेकर रही हूँ - आगे 3-6 महीने में फंड की ज़रूरत पड़ सकती है क्या?";
    expect(isIncompletePitchFragment(previous)).toBe(true);
    expect(looksLikeAssistantPitchRestart(previous, next)).toBe(true);
  });

  it("cuts soft restate early before loan opener reappears", () => {
    const previous = "अभी रिसेंटली disburse हुआ था, इसलिएक छोटा";
    const next = "हाँ, तो मैं कह रही थी कि";
    expect(looksLikeAssistantPitchRestart(previous, next)).toBe(true);
  });

  it("does not flag the first pitch against the opening permission question", () => {
    const previous =
      "नमस्ते, मैं Ananya Vastu Housing Finance से बोल रही हूँ। क्या अभी एक मिनट बात हो पाएगी?";
    const next = "आपका लोन रिसेंटली डिस्बर्स हुआ था";
    expect(looksLikeAssistantPitchRestart(previous, next)).toBe(false);
  });

  it("does not cut short non-loan acks that share an opening", () => {
    const previous = "हां जी बिल्कुल";
    const next = "हां जी, बिल्कुल बताती हूँ आगे की डिटेल्स";
    expect(looksLikeAssistantPitchRestart(previous, next)).toBe(false);
  });
});

describe("looksLikeAssistantEchoInUserTranscript", () => {
  it("flags romanized echo of the Hindi pitch", () => {
    expect(
      looksLikeAssistantEchoInUserTranscript(
        "Aapka loan recently disburse hua tha.",
        "आपका लोन रिसेंटली डिस्बर्स हुआ था, इसलिएक छोटा सा चेकर रही",
      ),
    ).toBe(true);
  });

  it("does not flag a real customer decline", () => {
    expect(
      looksLikeAssistantEchoInUserTranscript(
        "Oh no no no, I don't think so.",
        "आपका लोन रिसेंटली डिस्बर्स हुआ था, आगे फंड की जरूरत है क्या?",
      ),
    ).toBe(false);
  });
});

describe("shouldCutAssistantPitchRestart", () => {
  it("never cuts while pitch_continuation owns the turn", () => {
    expect(
      shouldCutAssistantPitchRestart({
        previous: "आपका लोन रिसेंटली",
        next: "आपका लोन अभी रिसेंटली disburse हुआ था",
        instructionReason: "pitch_continuation",
      }),
    ).toBe(false);
  });

  it("still cuts unprompted restarts after a longer fragment", () => {
    expect(
      shouldCutAssistantPitchRestart({
        previous: "आपका लोन रिसेंटली",
        next: "आपका लोन अभी रिसेंटली disburse हुआ था",
        instructionReason: "none",
      }),
    ).toBe(true);
  });
});

describe("isIncompletePitchFragment", () => {
  it("flags short loan-pitch openings", () => {
    expect(isIncompletePitchFragment("आपका लोन रिसेंटली")).toBe(true);
    expect(isIncompletePitchFragment("आपका लोन")).toBe(true);
  });

  it("flags mid-phrase loan chunks without आपका लोन opener", () => {
    expect(isIncompletePitchFragment("अभी रिसेंटली disburse हुआ था, इसलिएक छोटा")).toBe(true);
  });

  it("does not treat generic stubs like जी, मैं as incomplete pitch", () => {
    expect(isIncompletePitchFragment("जी, मैं")).toBe(false);
    expect(isIncompletePitchFragment("हां")).toBe(false);
    expect(isIncompletePitchFragment("जी, आपका")).toBe(true);
  });

  it("does not flag a completed funds question", () => {
    expect(
      isIncompletePitchFragment(
        "आपका लोन रिसेंटली डिस्बर्स हुआ था, इसलिए एक छोटा सा चेक कर रही हूँ - आगे फंड की जरूरत पड़ सकती है क्या?",
      ),
    ).toBe(false);
  });
});

describe("buildPitchContinuationInstruction", () => {
  it("exact-says only the remaining pitch words", () => {
    const full =
      "आपका लोन रिसेंटली डिस्बर्स हुआ था, इसलिए एक छोटा सा चेक कर रही हूँ - आगे 3-6 महीने में होम, बिज़नेस, एजुकेशन, मेडिकल या फैमिली एक्सपेंस के लिए एक्स्ट्रा फंड की ज़रूरत पड़ सकती है क्या?";
    const text = buildPitchContinuationInstruction("आपका लोन रिसेंटली डिस्बर्स", full);
    expect(text).toContain("Say exactly this next");
    expect(text).toContain("हुआ था");
    expect(text).not.toMatch(/Say exactly this next[\s\S]*आपका लोन रिसेंटली डिस्बर्स हुआ/);
  });

  it("falls back when no full pitch is provided", () => {
    const text = buildPitchContinuationInstruction("आपका लोन रिसेंटली");
    expect(text).toContain("Do NOT restart");
    expect(text).toContain("आपका लोन रिसेंटली");
    expect(text).toContain("hello can you hear me");
  });
});

describe("pitchRemainderAfterSaid", () => {
  it("strips the spoken prefix from the scripted pitch", () => {
    const full =
      "आपका लोन रिसेंटली डिस्बर्स हुआ था, इसलिए एक छोटा सा चेक कर रही हूँ - आगे फंड की जरूरत पड़ सकती है क्या?";
    expect(pitchRemainderAfterSaid(full, "आपका लोन रिसेंटली डिस्बर्स")).toMatch(/^हुआ था/);
  });
});

describe("isIncompleteSemanticReply", () => {
  it("flags cut-off amount acks", () => {
    expect(isIncompleteSemanticReply("समझी। 2")).toBe(true);
  });
});

describe("isBargeInCutStub + semantic continuation", () => {
  it("flags short non-pitch barge-in stubs from logs", () => {
    expect(isBargeInCutStub("Confirm karne")).toBe(true);
    expect(isBargeInCutStub("Aage badhne")).toBe(true);
    expect(isBargeInCutStub("Sunke achha laga,")).toBe(true);
  });

  it("does not treat real loan pitch fragments as barge-in stubs", () => {
    expect(isBargeInCutStub("आपका लोन रिसेंटली")).toBe(false);
  });

  it("asks for a fresh complete reply instead of continue-from-next-word", () => {
    const text = buildSemanticContinuationInstruction("Confirm karne", "Hinglish");
    expect(text).toContain("must be discarded");
    expect(text).toContain("complete short reply");
    expect(text).not.toContain("Continue from the next word");
  });

  it("keeps continue-from-next-word for longer incomplete replies", () => {
    const longer =
      "समझी। मैंने 2 करोड़ रुपये का अमाउंट नोट कर लिया है और आगे प्रोसेस";
    expect(isBargeInCutStub(longer)).toBe(false);
    const text = buildSemanticContinuationInstruction(longer, "Hindi");
    expect(text).toContain("Continue from the next word");
  });
});

describe("opening YES pitch instruction", () => {
  it("asks for the next Campaign-script step, not a hardcoded top-up pitch", () => {
    const instruction = buildSemanticResolutionInstruction(
      {
        intent: "yes",
        confidence: 3,
        ambiguous: false,
        needsClarification: false,
        trapId: "decision_yes",
      },
      "हां बोलो।",
      "Hindi",
      "नमस्ते, मैं Ananya Vastu Housing Finance से बोल रही हूँ। क्या अभी एक मिनट बात हो पाएगी?",
    );
    expect(instruction).toContain("NEXT step written in the Campaign workflow");
    expect(instruction).toContain("Do NOT invent a product pitch");
    expect(instruction).not.toContain("आपका लोन रिसेंटली डिस्बर्स");
    expect(instruction).toContain("do NOT jump to advisor callback");
  });
});

describe("shouldProtectPitchPlayback", () => {
  it("protects while an incomplete pitch is streaming", () => {
    expect(
      shouldProtectPitchPlayback({
        lastAssistantText: "",
        currentOutputBuffer: "आपका लोन रिसेंटली",
      }),
    ).toBe(true);
  });

  it("protects between incomplete pitch turns", () => {
    expect(
      shouldProtectPitchPlayback({
        lastAssistantText: "आपका लोन रिसेंटली",
        currentOutputBuffer: "",
      }),
    ).toBe(true);
  });

  it("releases after the funds question lands", () => {
    expect(
      shouldProtectPitchPlayback({
        lastAssistantText: "",
        currentOutputBuffer:
          "आपका लोन रिसेंटली डिस्बर्स हुआ था, इसलिए एक छोटा सा चेक कर रही हूँ - आगे फंड की जरूरत पड़ सकती है क्या?",
      }),
    ).toBe(false);
  });
});

describe("looksLikeDuplicateAssistantRestate", () => {
  it("detects near-identical restates of a completed turn", async () => {
    const { looksLikeDuplicateAssistantRestate } = await import(
      "@/lib/plivo-gemini-live-transcript-guards"
    );
    const said =
      "Aapko batana chahungi yeh call quality purpose ke liye record ho rahi hai. " +
      "Hamare records ke mutabik amount bheja gaya tha. Kya aap confirm kar sakti hain ki yeh amount aapko mil gaya hai?";
    expect(looksLikeDuplicateAssistantRestate(said, said)).toBe(true);
    expect(
      looksLikeDuplicateAssistantRestate(
        said,
        `${said} Extra trailing clarification.`,
      ),
    ).toBe(true);
    expect(
      looksLikeDuplicateAssistantRestate(
        "Kya main Rakesh ji se baat kar rahi hoon?",
        said,
      ),
    ).toBe(false);
  });
});

describe("stripUserCrosstalkFromAssistant", () => {
  it("removes leaked user phrase from assistant text", () => {
    const assistant = "जी बिल्कुल, मुझे फंड नहीं चाहिए, आगे बताती हूँ";
    const user = "मुझे फंड नहीं चाहिए";
    expect(stripUserCrosstalkFromAssistant(assistant, user)).toBe("जी बिल्कुल, आगे बताती हूँ");
  });

  it("does not strip short shared tokens", () => {
    const assistant = "जी हाँ, बताती हूँ";
    expect(stripUserCrosstalkFromAssistant(assistant, "हाँ")).toBe(assistant);
  });
});

describe("mergeIncrementalTranscript", () => {
  it("dedupes cumulative prefixes instead of stuttering", () => {
    expect(mergeIncrementalTranscript("आपका लोन", "आपका लोन रिसेंटली")).toBe("आपका लोन रिसेंटली");
  });
});
