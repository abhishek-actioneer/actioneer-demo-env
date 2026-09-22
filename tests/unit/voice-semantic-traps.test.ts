import { describe, expect, it } from "vitest";
import {
  buildSemanticClarificationInstruction,
  classifyDecisionUtterance,
  classifyShortUtterance,
  detectLeadingDecisionIntent,
  fuzzyMatchCanonicalUtterance,
  isAssistantWrapUpTranscript,
  isBinaryDecisionContext,
  isDecisionTrapEvaluationReady,
  isOpeningGoAhead,
  isOpeningPermissionQuestion,
  isSemanticTrapEvaluationReady,
  isSemanticTrapGateEnabled,
  isThanksOnlyTranscript,
  levenshteinDistance,
  listSemanticTraps,
  looksLikeAmountOrNeedStatement,
  looksLikeContentOrAvailabilityQuestion,
  maxAllowedEditDistance,
  normalizeSemanticLanguage,
  requiresHighStakesConfirm,
  semanticTrapSystemPromptBlock,
} from "@/lib/voice-semantic-traps";

describe("voice-semantic-traps", () => {
  const yesNoQuestion = "Kya abhi ek minute baat ho payegi?";

  describe("Kannada", () => {
    it("flags ha vs huh trap", () => {
      const result = classifyShortUtterance({
        text: "ha",
        language: "Kannada",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.needsClarification).toBe(true);
      expect(result?.trapId).toBe("kn_ha_vs_huh");
    });

    it("flags ella vs illa trap", () => {
      const result = classifyShortUtterance({
        text: "ella",
        language: "Kannada",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("kn_illa_vs_ella");
    });

    it("treats illa as clear no", () => {
      const result = classifyShortUtterance({
        text: "illa",
        language: "Kannada",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.intent).toBe("no");
      expect(result?.needsClarification).toBe(false);
    });

    it("flags beku vs beda trap", () => {
      const result = classifyShortUtterance({
        text: "beku",
        language: "Kannada",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("kn_beda_vs_beku");
    });
  });

  describe("Tamil", () => {
    it("flags amma vs aama trap", () => {
      const result = classifyShortUtterance({
        text: "amma",
        language: "Tamil",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("ta_aama_vs_amma");
    });

    it("flags ille vs illa trap", () => {
      const result = classifyShortUtterance({
        text: "ille",
        language: "Tamil",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("ta_illa_vs_ille");
    });

    it("flags short aa particle", () => {
      const result = classifyShortUtterance({
        text: "aa",
        language: "Tamil",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("ta_aa_vs_aama");
    });

    it("treats aama as clear yes when not high-stakes", () => {
      const result = classifyShortUtterance({
        text: "aama",
        language: "Tamil",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });
  });

  describe("Telugu", () => {
    it("flags aa vs avunu trap", () => {
      const result = classifyShortUtterance({
        text: "aa",
        language: "Telugu",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("te_aa_vs_avunu");
    });

    it("flags leda vs ledu trap", () => {
      const result = classifyShortUtterance({
        text: "leda",
        language: "Telugu",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("te_ledu_vs_leda");
    });

    it("treats ledu as clear no", () => {
      const result = classifyShortUtterance({
        text: "ledu",
        language: "Telugu",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.intent).toBe("no");
      expect(result?.needsClarification).toBe(false);
    });

    it("treats avunu as clear yes", () => {
      const result = classifyShortUtterance({
        text: "avunu",
        language: "Telugu",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });

    it("flags roman sari vs sare trap", () => {
      const result = classifyShortUtterance({
        text: "sari",
        language: "Telugu",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("te_sare_vs_sari");
    });
  });

  describe("Odia", () => {
    it("flags ha vs huh trap", () => {
      const result = classifyShortUtterance({
        text: "ha",
        language: "Odia",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("or_ha_vs_huh");
    });

    it("flags na vs naa trap", () => {
      const result = classifyShortUtterance({
        text: "naa",
        language: "Odia",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("or_na_vs_naa");
    });

    it("flags short na particle", () => {
      const result = classifyShortUtterance({
        text: "na",
        language: "Odia",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("or_na_short");
    });

    it("treats haan as clear yes", () => {
      const result = classifyShortUtterance({
        text: "haan",
        language: "Odia",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });
  });

  describe("shared behavior", () => {
    /**
     * The high_stakes_confirm trap is gone. It used to hijack a CLEAR yes/no
     * whenever the agent's previous line mentioned link/book/callback and read
     * out a canned per-language confirm sentence. On a live TVS Credit call it
     * played the identical Hindi line three times — the customer's next words
     * were "आप एआई हो क्या?". A clear answer now goes straight to the model.
     */
    it("passes a clear yes through on a high-stakes assistant line", () => {
      const result = classifyShortUtterance({
        text: "aama",
        language: "Tamil",
        lastAssistantText: "Shall I schedule an advisor callback for you?",
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
      expect(result?.trapId).toBeUndefined();
    });

    it("never emits the canned confirm line, in any language", () => {
      // The exact wording that looped, plus the assistant lines that re-armed it.
      const assistantLines = [
        "Shall I schedule an advisor callback for you?",
        "मैंने लिंक भेज दिया है. अपॉइंटमेंट बुकrne में मदद करूँ?",
        "I've sent the link — shall I book the appointment?",
      ];
      const answers: Array<[string, string]> = [
        ["Tamil", "aama"],
        ["Hindi", "हाँ"],
        ["Hinglish", "haan"],
        ["English", "yes"],
        ["English", "no"],
      ];

      for (const lastAssistantText of assistantLines) {
        for (const [language, text] of answers) {
          const result = classifyShortUtterance({ text, language, lastAssistantText });
          expect(result?.trapId, `${language} "${text}"`).not.toBe("high_stakes_confirm");
          const instruction = buildSemanticClarificationInstruction(
            language,
            result?.trapId,
            text,
          );
          expect(instruction).not.toContain("कन्फर्म कीजिए");
          expect(instruction).not.toContain("Just to confirm");
          expect(instruction).not.toContain("Confirm kariye");
        }
      }
    });

    it("feature flag defaults off", () => {
      const prev = process.env.VOICE_SEMANTIC_TRAP_GATE;
      delete process.env.VOICE_SEMANTIC_TRAP_GATE;
      expect(isSemanticTrapGateEnabled()).toBe(false);
      process.env.VOICE_SEMANTIC_TRAP_GATE = "1";
      expect(isSemanticTrapGateEnabled()).toBe(true);
      if (prev === undefined) delete process.env.VOICE_SEMANTIC_TRAP_GATE;
      else process.env.VOICE_SEMANTIC_TRAP_GATE = prev;
    });

    it("skips gate outside decision context", () => {
      expect(classifyShortUtterance({
        text: "ha",
        language: "Kannada",
        lastAssistantText: "Thanks for your time today.",
      })).toBeNull();
    });

    it("skips gate for long utterances", () => {
      expect(classifyShortUtterance({
        text: "illa nanu interest illa adre later call madi",
        language: "Kannada",
        lastAssistantText: yesNoQuestion,
      })).toBeNull();
    });

    it("detects binary decision context", () => {
      expect(isBinaryDecisionContext("Can we talk for a minute?")).toBe(true);
      expect(isBinaryDecisionContext("Thanks, goodbye.")).toBe(false);
    });

    it("detects high-stakes consent context", () => {
      expect(requiresHighStakesConfirm("Shall I schedule a callback?")).toBe(true);
      expect(requiresHighStakesConfirm("How are you today?")).toBe(false);
    });

    it("lists all traps for each South language", () => {
      expect(listSemanticTraps("Kannada").length).toBeGreaterThanOrEqual(3);
      expect(listSemanticTraps("Tamil").length).toBeGreaterThanOrEqual(3);
      expect(listSemanticTraps("Telugu").length).toBeGreaterThanOrEqual(4);
      expect(listSemanticTraps("Odia").length).toBeGreaterThanOrEqual(4);
    });

    it("injects trap block for all South languages", () => {
      for (const lang of ["Kannada", "Tamil", "Telugu", "Odia"]) {
        const block = semanticTrapSystemPromptBlock(lang);
        expect(block).toContain("INTRA-LANGUAGE TRAP AWARENESS");
        expect(block.length).toBeGreaterThan(50);
      }
    });

    it("returns Hindi trap block when traps exist", () => {
      const block = semanticTrapSystemPromptBlock("Hindi");
      expect(block).toContain("INTRA-LANGUAGE TRAP AWARENESS (Hindi)");
      expect(block).toContain("Ha (yes particle)");
    });

    it("waits for minimum ASR length before live eval", () => {
      expect(isSemanticTrapEvaluationReady("h")).toBe(false);
      expect(isSemanticTrapEvaluationReady("ha")).toBe(true);
      expect(isSemanticTrapEvaluationReady("illa nanu interest illa")).toBe(false);
    });
  });

  describe("fuzzy canonical matching", () => {
    it("computes levenshtein distance", () => {
      expect(levenshteinDistance("howdu", "houdu")).toBe(1);
      expect(levenshteinDistance("beku", "bekaa")).toBe(2);
      expect(levenshteinDistance("avunu", "avuni")).toBe(1);
      expect(levenshteinDistance("same", "same")).toBe(0);
    });

    it("caps edit distance by token length", () => {
      expect(maxAllowedEditDistance(2)).toBe(1);
      expect(maxAllowedEditDistance(4)).toBe(2);
      expect(maxAllowedEditDistance(5)).toBe(2);
    });

    it("recovers ASR typo for clear Kannada yes", () => {
      const result = classifyShortUtterance({
        text: "hodu",
        language: "Kannada",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
      expect(result?.confidence).toBe(2);
    });

    it("recovers ASR typo for Kannada trap beku", () => {
      const result = classifyShortUtterance({
        text: "bekaa",
        language: "Kannada",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.trapId).toBe("kn_beda_vs_beku");
      expect(result?.needsClarification).toBe(true);
    });

    it("recovers Telugu ledu typo", () => {
      const result = classifyShortUtterance({
        text: "lebu",
        language: "Telugu",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.intent).toBe("no");
      expect(result?.needsClarification).toBe(false);
      expect(result?.confidence).toBe(2);
    });

    it("recovers Tamil aama typo", () => {
      const result = classifyShortUtterance({
        text: "amaa",
        language: "Tamil",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });

    it("clarifies when fuzzy tie crosses intents", () => {
      const fuzzy = fuzzyMatchCanonicalUtterance("Kannada", "hu");
      expect(fuzzy.matches.length).toBeGreaterThan(0);
      const result = classifyShortUtterance({
        text: "hu",
        language: "Kannada",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.needsClarification).toBe(true);
    });

    it("skips fuzzy match for single roman letter", () => {
      expect(fuzzyMatchCanonicalUtterance("Kannada", "h").matches).toEqual([]);
      expect(classifyShortUtterance({
        text: "h",
        language: "Kannada",
        lastAssistantText: yesNoQuestion,
      })).toBeNull();
    });

    it("passes a fuzzy clear yes through without a confirm hijack", () => {
      const result = classifyShortUtterance({
        text: "amaa",
        language: "Tamil",
        lastAssistantText: "Shall I schedule an advisor callback for you?",
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
      expect(result?.trapId).toBeUndefined();
    });
  });

  describe("decision utterances (longer replies)", () => {
    const fundsQuestion =
      "ಮುಂದಿನ 3-6 ತಿಂಗಳಲ್ಲಿ ಎಕ್ಸ್ಟ್ರಾ ಫಂಡ್ ಅಗತ್ಯ ಬರಬಹುದೇ?";

    it("detects Hindi leading yes on Kannada campaign question", () => {
      const result = classifyDecisionUtterance({
        text: "हां, बिल्कुल। वह तो नोट कर रहा हूं। एक्चुअली, वह तो",
        language: "Kannada",
        lastAssistantText: fundsQuestion,
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });

    it("detects Kannada script leading yes with need", () => {
      const result = classifyDecisionUtterance({
        text: "ಹಾ, ಬರಬಹುದು. ಇದೆ. ಅವಶ್ಯಕತೆ ಇದೆ.",
        language: "Kannada",
        lastAssistantText: fundsQuestion,
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });

    it("detects English interest phrase at decision point", () => {
      const result = classifyDecisionUtterance({
        text: "Hello, I need education purpose loan, may I know?",
        language: "Tamil",
        lastAssistantText: "அடுத்த 3-6 மாசத்துல எக்ஸ்ட்ரா பணம் தேவைப்படலாமா?",
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });

    it("treats bare बोलो as clear opening YES", () => {
      const result = classifyDecisionUtterance({
        text: "बोलो।",
        language: "Hindi",
        lastAssistantText:
          "नमस्ते, मैं Ananya Vastu Housing Finance से बोल रही हूँ। क्या अभी एक मिनट बात हो पाएगी?",
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
      expect(result?.trapId).toBeUndefined();
    });

    it("does not force high-stakes confirm on amount/need statements", () => {
      const result = classifyDecisionUtterance({
        text: "मैम, ₹2 करोड़ चाहिए मेरे को।",
        language: "Hindi",
        lastAssistantText:
          "Would you like me to note down your interest for a callback?",
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
      expect(result?.trapId).not.toBe("high_stakes_confirm");
      expect(looksLikeAmountOrNeedStatement("मैम, ₹2 करोड़ चाहिए मेरे को।")).toBe(true);
    });

    it("takes a short yes to a callback offer at face value", () => {
      const result = classifyDecisionUtterance({
        text: "हां",
        language: "Hindi",
        lastAssistantText:
          "Would you like me to note down your interest for a callback?",
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
      expect(result?.trapId).toBeUndefined();
    });

    it("treats आगे बढ़ाओ as YES after high-stakes confirm line", () => {
      const result = classifyDecisionUtterance({
        text: "आगे बढ़ाओ।",
        language: "Hindi",
        lastAssistantText: "कन्फर्म कीजिए — हाँ, आगे बढ़ाऊँ, या अभी नहीं?",
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });

    it("treats go ahead as YES after English confirm line", () => {
      const result = classifyDecisionUtterance({
        text: "Go ahead.",
        language: "English",
        lastAssistantText: "Just to confirm — should I go ahead with that, or not right now?",
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });

    it("does not treat नहीं तो … मिलेंगे क्या as decline", () => {
      expect(
        classifyDecisionUtterance({
          text: "नहीं तो दो खोके मिलेंगे क्या मेरे को?",
          language: "Hindi",
          lastAssistantText:
            "Would you like me to note down your interest for a callback?",
        }),
      ).toBeNull();
      expect(looksLikeContentOrAvailabilityQuestion("नहीं तो दो खोके मिलेंगे क्या मेरे को?")).toBe(
        true,
      );
    });

    it("does not treat Spanish Ya… as leading yes", () => {
      expect(detectLeadingDecisionIntent("Ya un día es, ¿no?")?.intent).toBeUndefined();
    });

    it("does not treat Italian ASR No, per parlare… as decline", () => {
      expect(
        classifyDecisionUtterance({
          text: "No, per parlare in inglese.",
          language: "English",
          lastAssistantText: "Is there anything else I can help you with right now?",
        }),
      ).toBeNull();
      expect(detectLeadingDecisionIntent("No, per parlare in inglese.")?.intent).toBeUndefined();
    });

    it("ignores embedded English no mid-utterance (Telugu code-switch)", () => {
      expect(classifyDecisionUtterance({
        text: "onna ki no vaidyum sam loan undi kada",
        language: "Telugu",
        lastAssistantText: "ఇప్పుడు ఒక నిమిషం మాట్లాడవచ్చా?",
      })).toBeNull();
    });

    it("detects leading no when it starts the reply", () => {
      const result = classifyDecisionUtterance({
        text: "no, I don't need extra funds right now",
        language: "English",
        lastAssistantText: "Can we talk for a minute?",
      });
      expect(result?.intent).toBe("no");
      expect(result?.needsClarification).toBe(false);
    });

    it("returns null outside decision context", () => {
      expect(classifyDecisionUtterance({
        text: "हां, बिल्कुल। वह तो नोट कर रहा हूं।",
        language: "Kannada",
        lastAssistantText: "ನಮಸ್ಕಾರ, ನಾನು Ananya.",
      })).toBeNull();
    });
  });

  describe("thanks-only transcripts", () => {
    it("recognizes mixed thanks", () => {
      expect(isThanksOnlyTranscript("Thank you. धन्यवाद।")).toBe(true);
      expect(isThanksOnlyTranscript("धन्यवाद। थैंक यू।")).toBe(true);
      expect(isThanksOnlyTranscript("நன்றி.")).toBe(true);
    });

    it("rejects substantive replies", () => {
      expect(isThanksOnlyTranscript("हां, बिल्कुल। वह तो नोट कर रहा हूं।")).toBe(false);
      expect(isThanksOnlyTranscript("Hello, I need a loan")).toBe(false);
    });
  });

  describe("decision trap evaluation readiness", () => {
    it("allows longer decision replies than short trap gate", () => {
      const longReply = "हां, बिल्कुल। वह तो नोट कर रहा हूं। एक्चुअली, वह तो";
      expect(isSemanticTrapEvaluationReady(longReply)).toBe(false);
      expect(isDecisionTrapEvaluationReady(longReply)).toBe(true);
    });
  });

  describe("Indo-Aryan languages", () => {
    it("flags Hindi ha trap", () => {
      const result = classifyShortUtterance({
        text: "ha",
        language: "Hindi",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.needsClarification).toBe(true);
      expect(result?.trapId).toBe("hi_ha_vs_huh");
    });

    it("accepts Hinglish haan as clear yes", () => {
      const result = classifyShortUtterance({
        text: "haan",
        language: "Hinglish",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });

    it("accepts English yes as clear yes", () => {
      const result = classifyShortUtterance({
        text: "yes",
        language: "English",
        lastAssistantText: "Can we talk for a minute?",
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });

    it("flags Hindi ha trap", () => {
      const result = classifyShortUtterance({
        text: "ha",
        language: "Hindi",
        lastAssistantText: yesNoQuestion,
      });
      expect(result?.needsClarification).toBe(true);
      expect(result?.trapId).toBe("hi_ha_vs_huh");
    });

    it("detects Hinglish bol sakte ho at decision point", () => {
      const result = classifyDecisionUtterance({
        text: "हां, बोल सकते हो।",
        language: "Telugu",
        lastAssistantText: "ఇప్పుడు ఒక నిమిషం మాట్లాడవచ్చా?",
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });

    it("normalizes all supported runtime languages", () => {
      expect(normalizeSemanticLanguage("English")).toBe("English");
      expect(normalizeSemanticLanguage("hi")).toBe("Hindi");
      expect(normalizeSemanticLanguage("hinglish")).toBe("Hinglish");
      expect(normalizeSemanticLanguage("bhoj")).toBeUndefined();
      expect(normalizeSemanticLanguage("kn")).toBe("Kannada");
    });
  });

  describe("wrap-up and thanks helpers", () => {
    it("detects assistant wrap-up across languages", () => {
      expect(isAssistantWrapUpTranscript("ಸರಿ, ಧನ್ಯವಾದಗಳು!")).toBe(true);
      expect(isAssistantWrapUpTranscript("धन्यवाद, समय दिया")).toBe(true);
      expect(isAssistantWrapUpTranscript("Thank you for your time")).toBe(true);
      expect(isAssistantWrapUpTranscript("Do you need extra funds?")).toBe(false);
    });
  });

  describe("short identity openings", () => {
    it("treats ABSLI-style identity line as opening permission context", () => {
      expect(
        isOpeningPermissionQuestion("Namaste, main Ananya bol rahi hoon ABSLI se."),
      ).toBe(true);
      expect(isOpeningGoAhead("हां जी, मैम। बताइए।")).toBe(true);
      const result = classifyDecisionUtterance({
        text: "हां जी, मैम। बताइए।",
        language: "Hinglish",
        lastAssistantText: "Namaste, main Ananya bol rahi hoon ABSLI se.",
      });
      expect(result?.intent).toBe("yes");
      expect(result?.needsClarification).toBe(false);
    });

    it("does not treat right-person checks as opening permission", () => {
      expect(
        isOpeningPermissionQuestion(
          "मैं विद्या हूँ। क्या मैं सही व्यक्ति से बात कर रही हूँ?",
        ),
      ).toBe(false);
      expect(
        isOpeningPermissionQuestion(
          "Am I speaking with the right person regarding the loan application?",
        ),
      ).toBe(false);
    });

    it("still treats good-time / minute questions as opening permission", () => {
      expect(
        isOpeningPermissionQuestion(
          "Wonderful, thank you for confirming! Is this a good time to talk?",
        ),
      ).toBe(true);
      expect(
        isOpeningPermissionQuestion(
          "नमस्ते, मैं Ananya से बोल रही हूँ। क्या अभी एक मिनट बात हो पाएगी?",
        ),
      ).toBe(true);
    });
  });
});
