import { describe, expect, it } from "vitest";

import {
  CONTINUE_IN_CURRENT_LANGUAGE,
  ENGLISH_MARKER_LIST,
  FOLLOW_CUSTOMER_LANGUAGE_NUDGE,
  ROMANIZED_MARKER_LISTS,
  buildVoiceLanguageDirective,
  languageFollowInstruction,
  resolveVoiceLanguagePlan,
} from "@/lib/voice-language-policy";
import { CASUAL_INDIC_LANGUAGES } from "@/lib/voice-casual-spoken-register";
import { planCustomerTurn } from "@/lib/plivo-gemini-live-turn-planner";
import { isLowSignalTranscript } from "@/lib/plivo-gemini-live-transcript-guards";

/** One natural reply per selectable language, in its own script. */
const REPLIES: Record<string, string> = {
  Hindi: "हां, मिल गया मेरे को",
  Marathi: "हो, मला मिळाले",
  Tamil: "ஆமா, கிடைச்சது",
  Telugu: "అవును, వచ్చింది",
  Kannada: "ಹೌದು, ಸಿಕ್ಕಿತು",
  Bengali: "হ্যাঁ, পেয়েছি",
  Odia: "ହଁ, ମିଳିଲା",
  English: "Yes, I received it",
};

/** The studio picker's non-regional entries — the base pair, however opened. */
const BILINGUAL = ["Hinglish", "Hindi", "English"];

/**
 * Any language line the policy can emit: a concrete directive or the neutral
 * nudge. Tests assert on THIS rather than on the nudge string, so that adding a
 * newly-nameable language cannot silently turn a "line is present" assertion
 * into a vacuous one.
 */
const LANGUAGE_LINE_RE =
  /(Reply in (Hindi|Tamil|Telugu|Kannada|Marathi|Bengali|Odia)\.|Reply in Indian English \(en-IN\)|Reply in the same language the customer just used\.|Continue in the language you are already speaking\.)/;

describe("voice language policy — shape selection", () => {
  it("gives every non-regional language the {Hindi, English} base pair", () => {
    for (const language of BILINGUAL) {
      const plan = resolveVoiceLanguagePlan(language);
      expect(plan.shape, language).toBe("bilingual");
      expect(plan.pinned, language).toBe(false);
      expect([...plan.spoken].sort(), language).toEqual(["English", "Hindi"]);
    }
  });

  it("opens in the selected language while still carrying the pair", () => {
    // Hinglish is the pair spoken as one mixed register, so it opens in itself
    // rather than adding a third entry.
    expect(resolveVoiceLanguagePlan("Hindi").spoken).toEqual(["Hindi", "English"]);
    expect(resolveVoiceLanguagePlan("English").spoken).toEqual(["English", "Hindi"]);
    expect(resolveVoiceLanguagePlan("Hinglish").primary).toBe("Hinglish");
    expect(resolveVoiceLanguagePlan("Hinglish").spoken).toEqual(["Hindi", "English"]);
  });

  it("pins every regional pack while keeping the set reachable by request", () => {
    // Product decision 2026-07-29: regional campaigns do not auto code-switch,
    // because 37.5% of their transcripts are ASR hallucination. The permitted
    // SET is unchanged so an explicit request can still reach Hindi or English.
    for (const language of CASUAL_INDIC_LANGUAGES) {
      const plan = resolveVoiceLanguagePlan(language);
      expect(plan.shape, language).toBe("pinned");
      expect(plan.pinned, language).toBe(true);
      expect(plan.primary, language).toBe(language);
      expect(plan.spoken, language).toEqual([language, "Hindi", "English"]);
    }
  });

  it("carries the base pair on every selectable language", () => {
    for (const language of [...BILINGUAL, ...CASUAL_INDIC_LANGUAGES]) {
      const plan = resolveVoiceLanguagePlan(language);
      expect(plan.spoken, language).toContain("Hindi");
      expect(plan.spoken, language).toContain("English");
    }
  });

  it("defaults a missing language to Hinglish rather than throwing", () => {
    expect(resolveVoiceLanguagePlan(undefined).primary).toBe("Hinglish");
    expect(resolveVoiceLanguagePlan("  ").primary).toBe("Hinglish");
  });
});

describe("voice language policy — Hindi ↔ English movement", () => {
  // Regression: a live Hindi campaign refused "Ma'am, can you speak in English?".
  // The switch rule existed only on the trilingual path, and Hindi is the bridge
  // language so it is never a trilingual primary — it could not reach the rule.
  // The old monolingual block asserted "Speak only Hindi for the whole call".
  const ALL = [...BILINGUAL, ...CASUAL_INDIC_LANGUAGES];

  it("lets the customer change language on EVERY campaign, pinned ones included", () => {
    // The escape hatch is the whole reason regional campaigns are "pinned" and
    // not "locked". A hard lock is what shipped before 2026-07-28, and a caller
    // asking for English had no way out of it.
    for (const language of ALL) {
      const directive = buildVoiceLanguageDirective(language);
      expect(directive, language).toMatch(/explicitly asks you to speak one of/i);
      expect(directive, language).toMatch(/takes priority over/i);
    }
  });

  it("never hard-locks a call, even a pinned one", () => {
    for (const language of ALL) {
      const directive = buildVoiceLanguageDirective(language);
      expect(directive, language).not.toContain(`Speak only ${language} for the whole call`);
      expect(directive, language).not.toContain(`Speak this entire call in ${language}`);
    }
  });

  it("follows the customer automatically on Hindi/English, and only there", () => {
    // Bilingual campaigns follow. Regional campaigns do NOT — their transcripts
    // are 37.5% ASR hallucination, so following them is following noise.
    for (const language of BILINGUAL) {
      expect(buildVoiceLanguageDirective(language), language).toMatch(
        /Follow the customer\. Reply in whichever of .*they last spoke to you in/i,
      );
      expect(buildVoiceLanguageDirective(language), language).toMatch(
        /not one fixed language for the whole call/i,
      );
    }
    for (const language of CASUAL_INDIC_LANGUAGES) {
      const directive = buildVoiceLanguageDirective(language);
      expect(directive, language).not.toMatch(/Follow the customer/i);
      expect(directive, language).toMatch(
        new RegExp(`Do NOT change language on your own`, "i"),
      );
      expect(directive, language).toMatch(new RegExp(`This call is in ${language}\\.`));
    }
  });

  it("tells a Hindi-opening call to stay in English for an English speaker", () => {
    // Without this the model has a rule for every language it might hear except
    // English, and keeps answering an English speaker in Hindi. Pinned campaigns
    // do not get this clause — staying put is the point.
    for (const language of ["Hindi", "Hinglish"]) {
      expect(buildVoiceLanguageDirective(language), language).toMatch(
        /includes staying in English if they are speaking English to you/i,
      );
    }
    // Redundant when English is already what the call opens in.
    expect(buildVoiceLanguageDirective("English")).not.toMatch(/includes staying in English/i);
    expect(buildVoiceLanguageDirective("Tamil")).not.toMatch(/includes staying in English/i);
  });

  it("keeps the permitted set closed", () => {
    expect(buildVoiceLanguageDirective("Hindi")).toMatch(
      /Never speak a language outside Hindi or English on this call/i,
    );
  });

  it("drops the Hindi repair fallback entirely", () => {
    // "Recover into Hindi" was itself an unrequested language change, and it
    // fired exactly when the transcript was least trustworthy. On call w42ib the
    // agent left Tamil for fifty seconds off garbled Devanagari.
    for (const language of ALL) {
      expect(buildVoiceLanguageDirective(language), language).not.toMatch(
        /still unclear after asking once/i,
      );
    }
    expect(buildVoiceLanguageDirective("Tamil")).toMatch(
      /do not switch to Hindi or any other language to recover/i,
    );
  });
});

describe("voice language policy — Indian English", () => {
  it("pins en-IN on every campaign language, including ones that do not open in English", () => {
    for (const language of [...BILINGUAL, ...CASUAL_INDIC_LANGUAGES]) {
      expect(buildVoiceLanguageDirective(language), language).toMatch(/en-IN/);
    }
  });

  it("binds the en-IN rule to speaking English, not to English being the campaign language", () => {
    // Otherwise a Hindi call that switches to English under the customer-request
    // rule would have no pronunciation guidance at all.
    expect(buildVoiceLanguageDirective("Hindi")).toMatch(/Whenever you speak English/i);
  });
});

describe("voice language policy — turn-level follow nudge", () => {
  // The system-instruction rule alone did not move a live Hindi call onto an
  // English-speaking caller (call 4mpei, 2026-07-28). This rides an instruction
  // the runtime already sends, so it adds no round trip and no latency.
  const englishQuestion = "Ma'am, can you like speak in short sentences, please?";

  it("carries the nudge on the direct-answer instruction", () => {
    const plan = planCustomerTurn({
      userText: englishQuestion,
      lastAssistantText: "नमस्ते! मैं Mira बोल रही हूँ. क्या मेरी बात Kamala जी से हो रही है?",
      campaignLanguage: "Hindi",
      source: "live",
    });
    expect(plan.action).toBe("direct_answer");
    // A confidently-English utterance now gets the concrete directive rather than
    // the neutral nudge — see LANGUAGE_LINE_RE. What matters is that SOME
    // language line rides along, which is what this regression guards.
    expect(plan.instruction).toMatch(LANGUAGE_LINE_RE);
  });

  it("carries a language line on EVERY action the planner can return", () => {
    // Regression (call fclle, final turn): the nudge was wired into
    // direct_answer only, so "Can you send me a WhatsApp message?" took the
    // whatsapp_send_link branch with no language guidance and the agent stayed
    // in Hindi against an English speaker.
    const utterances: Array<[string, string]> = [
      ["direct_answer", "Can you explain the repayment schedule to me please?"],
      ["whatsapp_send_link", "Can you send me a WhatsApp message?"],
      ["control_slow_down", "Ma'am, can you please speak a bit slowly?"],
      ["control_wait", "Wait wait wait one second please"],
      ["semantic", "Yes"],
    ];
    for (const [label, userText] of utterances) {
      const plan = planCustomerTurn({
        userText,
        lastAssistantText: "Did you receive the amount?",
        campaignLanguage: "Hindi",
        source: "live",
      });
      if (!plan.instruction.trim()) continue; // action "none" sends nothing
      expect(plan.instruction, `${label}: ${plan.action}`).toMatch(LANGUAGE_LINE_RE);
    }
  });

  it("does not duplicate the language line when a branch already carries it", () => {
    const plan = planCustomerTurn({
      userText: "Can you explain the repayment schedule to me please?",
      lastAssistantText: "Did you receive the amount?",
      campaignLanguage: "Hindi",
      source: "live",
    });
    // Count language lines of ANY form — the concrete "Reply in X." as well as
    // the neutral nudge. Counting only the nudge quietly passed as zero once
    // English became nameable, which is the opposite of what this guards.
    const occurrences = plan.instruction.match(new RegExp(LANGUAGE_LINE_RE, "g"))?.length ?? 0;
    expect(occurrences).toBe(1);
  });

  it("directs no language, so romanized Hindi cannot flip the call to English", () => {
    // "Haan ji bolo" is Hindi in Latin script — any script-based detection would
    // read it as English. The nudge defers to what the model actually heard.
    //
    // It DOES mention English now, in a conditional that only fires if English
    // is what the model already chose: a live call switched to English on
    // request and came back American. Naming a language and qualifying one are
    // different things, so this asserts the absence of a DIRECTIVE.
    expect(FOLLOW_CUSTOMER_LANGUAGE_NUDGE).not.toMatch(/^Reply in (Hindi|English|Tamil)\./i);
    expect(FOLLOW_CUSTOMER_LANGUAGE_NUDGE).toMatch(/same language the customer just used/i);
    expect(FOLLOW_CUSTOMER_LANGUAGE_NUDGE).toMatch(/Indian English \(en-IN\)/);
  });
});

describe("voice language policy — script-gated follow instruction", () => {
  it("holds a language the customer explicitly asked for, instead of snapping back", () => {
    // Regression from call u066j (2026-07-29). The first pinned implementation
    // said "Reply in Tamil unless the customer has asked you to use another
    // language" and the model ignored the trailing condition every time: the
    // customer asked for Hindi, got it, and was dragged back to Tamil on the
    // very next turn; then asked for English, got it, dragged back again.
    //
    // The pin now reads the AGENT's own last turn, so once a request has moved
    // the call the pin moves with it. These are the verbatim turns.
    const askedForHindi = "हाँ, बिल्कुल! मैं Mira, Vastu Housing Finance से AI Assistant बोल रही हूँ।";
    const askedForEnglish = "Sure, I can talk in English. This call is being recorded for quality purposes.";
    expect(
      languageFollowInstruction("Yes, I am talking Shanti ji but who are you calling?", "Tamil", askedForHindi),
    ).toBe("Reply in Hindi.");
    expect(
      languageFollowInstruction("I understood, can you please go on, what is next?", "Tamil", askedForEnglish),
    ).toMatch(/^Reply in Indian English \(en-IN\)/);
  });

  it("reads the agent's dominant script, not the first one it finds", () => {
    // Real agent turns are mixed: Tamil carrying English product words, and on
    // u066j a Tamil turn containing the Devanagari word हिंदी. First-match-wins
    // gets both wrong.
    const tamilWithEnglish = "நான் Mira, Vastu Housing Finance-ல இருந்து AI Assistant பேசுறேன்.";
    const tamilWithDevanagari =
      "மன்னிக்கணும். நான் தமிழ்ல தான் பேச முடியும். உங்களுக்கு हिंदी இல்லனா English-ல பேசணுமா?";
    expect(languageFollowInstruction("okay go on", "Tamil", tamilWithEnglish)).toBe("Reply in Tamil.");
    expect(languageFollowInstruction("okay go on", "Tamil", tamilWithDevanagari)).toBe("Reply in Tamil.");
  });

  it("holds position rather than guessing when the agent's own script is ambiguous", () => {
    // A Marathi campaign that granted a Hindi request is speaking Devanagari,
    // which is both languages. Naming the campaign language would drag it back
    // off the language the customer asked for.
    expect(languageFollowInstruction("okay go on", "Marathi", "हो, मी Mira बोलतेय.")).toBe(
      CONTINUE_IN_CURRENT_LANGUAGE,
    );
    // With nothing said yet there is no position to hold — open in the campaign's.
    expect(languageFollowInstruction("okay go on", "Marathi", "")).toBe("Reply in Marathi.");
  });

  it("pins a regional campaign to its own language, whatever the transcript says", () => {
    // The product decision of 2026-07-29. Each of these is verbatim from the
    // Tamil calls of that night, where Gemini's ASR returned Portuguese, Korean,
    // Italian and Devanagari for Tamil audio. Under the old trilingual rules the
    // Devanagari line resolved to "Reply in Hindi." and the agent abandoned
    // Tamil for fifty seconds (call w42ib).
    // Agent last spoke Tamil, so the pin is Tamil regardless of the garbage the
    // caller ASR returns.
    const AGENT_TAMIL = "வணக்கம்! நான் Mira பேசுறேன்.";
    const PIN = "Reply in Tamil.";
    for (const text of [
      "Amanh\u00e3, sabe, eu queria dar um peitinho s\u00f3 em algu\u00e9m e mexer.",
      "\uc544, \uc815\ub9d0 \uc798\ud588\uc5b4, \uadf8\ub798.",
      "A me le pesa la Maddalena che vado a studiare con",
      REPLIES.Hindi,
      REPLIES.Tamil,
      "Can you please tell me what the payment amount is?",
      "",
    ]) {
      expect(languageFollowInstruction(text, "Tamil", AGENT_TAMIL), text).toBe(PIN);
    }
  });

  it("pins every regional pack, not just Tamil", () => {
    for (const language of CASUAL_INDIC_LANGUAGES) {
      expect(languageFollowInstruction(REPLIES.Hindi, language), language).toBe(
        `Reply in ${language}.`,
      );
    }
  });

  it("hands an explicit language request back to the system prompt, even when pinned", () => {
    // Pinning must not overrule rule 3. If it did, the turn line would drag the
    // caller back to Tamil on every turn after they asked for English.
    for (const language of ["Tamil", "Marathi", "Hindi"]) {
      expect(
        languageFollowInstruction("Ma'am, can you speak in English please?", language),
        language,
      ).toBe(FOLLOW_CUSTOMER_LANGUAGE_NUDGE);
    }
  });

  it("resolves Devanagari to Hindi on the bilingual campaigns that still detect", () => {
    for (const campaign of ["Hindi", "Hinglish", "English"]) {
      expect(languageFollowInstruction(REPLIES.Hindi, campaign), campaign).toBe("Reply in Hindi.");
    }
  });

  it("names English when the English evidence is strong, on any campaign", () => {
    // This test used to assert the OPPOSITE — that English always stays neutral,
    // "where Latin script proves nothing". Latin script alone still proves
    // nothing; enough English function words with zero Indic markers does.
    //
    // The old behaviour was the single largest measured defect: the policy could
    // name an Indic language but never English, so it could push the agent into
    // Hindi and never back out. tmp/voice-scoreboard.ts attributes 45 of 53
    // switch-follow misses across 299 calls to exactly that asymmetry.
    for (const text of [
      "Can you speak in short sentences please?",
      "Yes, I did receive the amount. What happens next?",
      "I would prefer an in-person visit. When can we arrange that?",
    ]) {
      for (const campaign of ["Hindi", "English", "Hinglish"]) {
        expect(languageFollowInstruction(text, campaign), `${campaign}: ${text}`).toMatch(
          /^Reply in Indian English \(en-IN\)/,
        );
      }
    }
  });

  it("still refuses to call short or Indic-flecked Latin text English", () => {
    // The mirror of the drift bug: shoving a Hindi speaker into English. One
    // Indic marker anywhere disqualifies the line, and two English function
    // words are required, so filler and Hinglish both stay neutral.
    for (const text of [
      "Yes ma'am.", // too little evidence
      REPLIES.English, // "Yes, I received it" — one marker
      "Okay.",
      "Main taras pani",
      "car loan hai bus", // one Indic marker present: disqualified, not English
    ]) {
      expect(languageFollowInstruction(text, "Hindi"), text).toBe(FOLLOW_CUSTOMER_LANGUAGE_NUDGE);
    }
    // Enough Hindi to be named outright, despite the English framing words.
    expect(languageFollowInstruction("Hello, aap bhej do link madam.", "Hindi")).toBe(
      "Reply in Hindi.",
    );
  });

  it("recognises romanized Hindi, which the ASR emits once a call turns English", () => {
    // Call 9w6t3: three Latin-script Hindi turns went uncorrected because the
    // script gate saw only Latin. These are verbatim from that call.
    for (const text of [
      "Haan ma'am, mil gaya loan to aa gaya hai. Maine message bhi dekh liya.",
      "Actually, agar main EMI nahin bhar pata hun to kya hoga?",
      "Call kyon kar rahe ho mere ko?",
    ]) {
      expect(languageFollowInstruction(text, "Hindi"), text).toBe("Reply in Hindi.");
    }
  });

  it("needs two distinct markers, so one Hindi word in an English sentence is ignored", () => {
    // Both verbatim from the corpus, both English despite a marker.
    expect(languageFollowInstruction("speak fast I am like thoda in a rush.", "Hindi")).toBe(
      FOLLOW_CUSTOMER_LANGUAGE_NUDGE,
    );
    expect(languageFollowInstruction("Haan, please continue.", "Hindi")).toBe(
      FOLLOW_CUSTOMER_LANGUAGE_NUDGE,
    );
    // Repetition is one piece of evidence, not three.
    expect(languageFollowInstruction("nahin nahin nahin", "Hindi")).toBe(
      FOLLOW_CUSTOMER_LANGUAGE_NUDGE,
    );
  });

  it("stands aside when the customer names a language — that is a request", () => {
    // Romanized Hindi ASKING for English. Answering "Reply in Hindi" would
    // contradict the request; rule 3 of the system instruction owns this.
    expect(languageFollowInstruction("Haan ji, kya aap English mein baat kar sakte hain?", "Hindi"))
      .toBe(FOLLOW_CUSTOMER_LANGUAGE_NUDGE);
    expect(languageFollowInstruction("मैम, आप English में बोल सकती हैं?", "Hindi")).toBe(
      FOLLOW_CUSTOMER_LANGUAGE_NUDGE,
    );
  });

  it("does not try to separate Hindi from Marathi any more — it pins instead", () => {
    // Marathi/Hindi is the one genuinely ambiguous pair (shared Devanagari), and
    // the romanized markers built to separate them are unreachable under the
    // pinned policy. Pinning answers the question a different way: a Marathi
    // campaign speaks Marathi, so nothing has to be told apart.
    const PIN = "Reply in Marathi.";
    expect(languageFollowInstruction("Haan, mil gaya hai", "Marathi")).toBe(PIN);
    expect(languageFollowInstruction("Mala kahi samajla nahi, tumhi kay bolat aahat?", "Marathi"))
      .toBe(PIN);
  });

  it.skip("SKIPPED: regional romanized detection is unreachable while campaigns are pinned", () => {
    // Kept, not deleted. ROMANIZED_MARKER_LISTS still holds validated lists for
    // all six regional languages; resolveRomanizedLanguage simply never scores
    // them, because it only scores PERMITTED languages and a pinned campaign
    // short-circuits before it. If auto-following is ever restored for regional
    // campaigns, un-skip this and the two below rather than rebuilding them.
    // SYNTHETIC — unlike the Hindi cases above, these are authored, not verbatim
    // from a call. The dumps contain no romanized regional speech at all (9
    // regional transcripts, every one in native script), so recall here is
    // asserted against linguistic knowledge, not measured. tmp/eval-romanized.ts
    // measures the half that can be measured: that none of these lists fire on
    // the real Hindi/English corpus.
    const SAMPLES: Record<string, string> = {
      Tamil: "Enakku theriyala, neenga konjam sollunga",
      Telugu: "Naaku teliyadu, meeru konchem cheppandi",
      Kannada: "Nanage gottilla, neevu swalpa heli",
      Marathi: "Mala kahi samajla nahi, tumhi sanga",
      Bengali: "Ami bujhte parchi na, apni ektu bolun",
      Odia: "Mu bujhili nahin, apana tike kuhantu",
    };
    for (const [language, text] of Object.entries(SAMPLES)) {
      expect(languageFollowInstruction(text, language), language).toBe(`Reply in ${language}.`);
    }
  });

  it.skip("SKIPPED: unreachable while pinned — see the note above", () => {
    // A campaign permits at most one regional language. Romanized Tamil on a
    // Telugu campaign is not evidence for Telugu, and must not become it.
    expect(languageFollowInstruction("Enakku theriyala, neenga sollunga", "Telugu")).toBe(
      FOLLOW_CUSTOMER_LANGUAGE_NUDGE,
    );
    expect(languageFollowInstruction("Enakku theriyala, neenga sollunga", "Hindi")).toBe(
      FOLLOW_CUSTOMER_LANGUAGE_NUDGE,
    );
  });

  it("stays neutral when two permitted languages score equally", () => {
    // Only reachable on bilingual campaigns now: Hindi vs English, where one
    // marker each decides nothing.
    expect(languageFollowInstruction("Haan, okay", "Hindi")).toBe(FOLLOW_CUSTOMER_LANGUAGE_NUDGE);
  });

  it("keeps every regional marker list disjoint from Hindi", () => {
    // Hindi is permitted on EVERY campaign, so a token shared with Hindi is
    // evidence for nobody and quietly degrades the strict-winner rule.
    // Regional-vs-regional overlap is fine — two regionals are never both
    // permitted — and is deliberately not asserted here.
    const hindi = ROMANIZED_MARKER_LISTS.Hindi;
    for (const [language, markers] of Object.entries(ROMANIZED_MARKER_LISTS)) {
      if (language === "Hindi") continue;
      const shared = [...markers].filter((token) => hindi.has(token));
      expect(shared, `${language} shares tokens with Hindi`).toEqual([]);
    }
  });

  it("keeps the English list disjoint from every Indic list", () => {
    // looksLikeEnglish() disqualifies a line on ANY Indic marker, so an overlap
    // would make the English detector unable to ever fire on the shared token —
    // silently, and only for some campaigns.
    for (const [language, markers] of Object.entries(ROMANIZED_MARKER_LISTS)) {
      const shared = [...ENGLISH_MARKER_LIST].filter((token) => markers.has(token));
      expect(shared, `English shares tokens with ${language}`).toEqual([]);
    }
  });

  it("keeps English words out of every marker list", () => {
    // The rule that makes the whole mechanism safe: one English homograph turns
    // an ordinary English sentence into a language switch. "emi" is on this list
    // because EMI is the most-spoken English term on these calls.
    const ENGLISH = [
      "main", "to", "is", "in", "us", "me", "par", "so", "do", "the", "a", "hi",
      "sang", "chai", "mash", "mote", "sari", "naan", "emi", "no", "on", "at", "be",
      "pan", "ho", "ki", "an", "it", "we", "he", "as", "or", "if", "up", "by",
    ];
    for (const [language, markers] of Object.entries(ROMANIZED_MARKER_LISTS)) {
      const leaked = ENGLISH.filter((word) => markers.has(word));
      expect(leaked, `${language} contains English words`).toEqual([]);
    }
  });

  it("falls back on empty, unknown-script, and multi-script input", () => {
    expect(languageFollowInstruction("", "Hindi")).toBe(FOLLOW_CUSTOMER_LANGUAGE_NUDGE);
    expect(languageFollowInstruction("   ", "Hindi")).toBe(FOLLOW_CUSTOMER_LANGUAGE_NUDGE);
    expect(languageFollowInstruction("你好", "Hindi")).toBe(FOLLOW_CUSTOMER_LANGUAGE_NUDGE);
    // Two Indic scripts at once — no single answer, so do not invent one.
    expect(languageFollowInstruction(`${REPLIES.Hindi} ${REPLIES.Tamil}`, "Hindi")).toBe(
      FOLLOW_CUSTOMER_LANGUAGE_NUDGE,
    );
  });

  it("reaches the direct-answer instruction with the concrete language", () => {
    const plan = planCustomerTurn({
      userText: "हां, मिल गया मेरे को। लेकिन आप क्यों कॉल कर रहे हो?",
      lastAssistantText: "Was that amount received to you?",
      campaignLanguage: "Hindi",
      source: "live",
    });
    expect(plan.action).toBe("direct_answer");
    expect(plan.instruction).toContain("Reply in Hindi.");
  });
});

describe("transcript guards — supported scripts", () => {
  it("accepts a reply in every selectable language's own script", () => {
    // Bengali was absent from the script whitelist until 2026-07-28, so Bengali
    // replies scored as low-signal and never reached the turn planner.
    for (const [language, reply] of Object.entries(REPLIES)) {
      expect(isLowSignalTranscript(reply), language).toBe(false);
    }
  });
});

describe("voice language policy — out-of-set requests", () => {
  it("bounds the switch offer to the languages the campaign can actually speak", () => {
    const directive = buildVoiceLanguageDirective("Hindi");
    expect(directive).toMatch(/explicitly asks you to speak one of Hindi or English/i);
    expect(directive).toMatch(/If they ask for a language that is not Hindi or English/i);
    expect(directive).toMatch(/do not attempt a language outside that set/i);
  });

  it("closes the permitted set rather than leaving a loophole", () => {
    expect(buildVoiceLanguageDirective("Tamil")).toMatch(
      /Never speak a language outside Tamil, Hindi or English on this call/i,
    );
  });
});

describe("voice language policy — script contract", () => {
  it("tells a switched call to keep the script's steps and order", () => {
    const directive = buildVoiceLanguageDirective("Hindi");
    expect(directive).toMatch(/same content, same order/i);
    expect(directive).toMatch(/source of truth for WHAT you say and in what order/i);
  });

  it("does not tie Say: lines to the campaign language once a switch has happened", () => {
    const directive = buildVoiceLanguageDirective("Hindi");
    expect(directive).toMatch(/already in the language you are currently speaking/i);
    expect(directive).not.toMatch(/already in the requested language/i);
  });
});

describe("voice language policy — Romance ASR garble is not English", () => {
  it("refuses to call Gemini's Romance hallucinations English", () => {
    // Verbatim from the Tamil call vc-test-...-0ljl1 (2026-07-29), which
    // produced French twice, Spanish once and Korean once across seven customer
    // turns. Naming a language off any of these would switch a live Tamil call
    // on pure ASR noise.
    for (const text of [
      "Il a un sale caractère, il a il a pas les bras pour une girafe. Nager.",
      "En la catedral de Llandaff le va a soltar una niña. Que nada ha de ser lo que tú te has dado.",
      "L'ange mira.",
      "아마 바르바알에",
      // Constructed: Romance garble that DOES clear the English threshold.
      // Before the guard was consulted this returned "Reply in English."
      "come has been, no more que nada",
    ]) {
      expect(languageFollowInstruction(text, "Hindi"), text).toBe(
        FOLLOW_CUSTOMER_LANGUAGE_NUDGE,
      );
    }
  });

  it("still names English for real English on a bilingual campaign", () => {
    // The guard must not swallow genuine English — that would recreate the
    // one-way policy this whole change exists to fix.
    expect(
      languageFollowInstruction("Can you please tell me what the payment amount is?", "Hindi"),
    ).toMatch(/^Reply in Indian English \(en-IN\)/);
  });
});

describe("voice language policy — Indian English is never optional", () => {
  it("qualifies en-IN on every line that can produce English", () => {
    // A live call on 2026-07-29 switched to English on request and came back
    // American. Rule 7 of the system instruction had always said en-IN; it is
    // just too far from the point of generation for the Live model to weigh it,
    // exactly like the follow-the-customer rule before it. So every turn-level
    // line that can end in English now carries the constraint itself.
    const linesThatCanProduceEnglish = [
      languageFollowInstruction("Can you please tell me the payment amount?", "Hindi"),
      languageFollowInstruction("okay go on", "Tamil", "Sure, I can talk in English."),
      languageFollowInstruction("Please talk to me in English.", "Tamil", "நான் Mira பேசுறேன்"),
      languageFollowInstruction("okay go on", "Marathi", "हो, मी Mira बोलतेय."),
    ];
    for (const line of linesThatCanProduceEnglish) {
      expect(line, line).toMatch(/Indian English \(en-IN\)/);
      expect(line, line).toMatch(/never American or British/);
    }
  });

  it("leaves non-English reply lines untouched", () => {
    // The qualifier is dead weight on a Tamil or Hindi turn, and every extra
    // clause competes for attention with the directive it is attached to.
    expect(languageFollowInstruction("okay go on", "Tamil", "நான் Mira பேசுறேன்")).toBe(
      "Reply in Tamil.",
    );
    expect(languageFollowInstruction("हां, मिल गया मेरे को", "Hindi")).toBe("Reply in Hindi.");
  });

  it("keeps en-IN in the system instruction too, for every campaign", () => {
    for (const language of [...BILINGUAL, ...CASUAL_INDIC_LANGUAGES]) {
      expect(buildVoiceLanguageDirective(language), language).toMatch(/en-IN/);
    }
  });
});
