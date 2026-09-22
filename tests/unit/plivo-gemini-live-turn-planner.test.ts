import { describe, expect, it, vi } from "vitest";
import { applyCustomerTurnPlan, planCustomerTurn } from "@/lib/plivo-gemini-live-turn-planner";
import { detectLeadingDecisionIntent } from "@/lib/voice-semantic-traps";
import { DECISION_RESOLUTION_DEDUPE_MS } from "@/lib/plivo-gemini-live-config";

// The runtime language checker was removed: plans no longer carry a language,
// never switch language, and instructions never name one. `campaignLanguage` is
// a static passthrough from CallConfig used only to select the semantic-trap
// ambiguity table.

describe("planCustomerTurn", () => {
  it("plans slow_down as a control intent", () => {
    const plan = planCustomerTurn({
      userText: "Ma'am, can you please speak a bit slowly?",
      lastAssistantText: "नमस्ते, क्या अभी बात हो पाएगी?",
      source: "live",
      campaignLanguage: "Hindi",
    });
    expect(plan.action).toBe("control_slow_down");
    expect(plan.cutPolicy).toBe("clear_playback");
    expect(plan.instruction).toContain("slow down");
    expect(plan.protectAckMs).toBeGreaterThan(0);
  });

  it("emits exactly one instruction reason for slow_down", () => {
    const plan = planCustomerTurn({
      userText: "Please speak slowly",
      source: "live",
      campaignLanguage: "Hindi",
    });
    expect(plan.instructionReason).toBe("control_intent_slow_down");
    expect(plan.action).toBe("control_slow_down");
  });

  it("plans wait/stop as an interrupt_drop control intent", () => {
    const plan = planCustomerTurn({
      userText: "Ek minute ruko please",
      source: "live",
      campaignLanguage: "Hinglish",
    });
    expect(plan.action).toBe("control_wait");
    expect(plan.cutPolicy).toBe("interrupt_drop");
    expect(plan.controlIntent).toBe("wait");
  });

  it("does not name a language in any emitted instruction", () => {
    const plans = [
      planCustomerTurn({ userText: "Please speak slowly", source: "live", campaignLanguage: "Hindi" }),
      planCustomerTurn({
        userText: "What is the interest rate on this?",
        source: "live",
        campaignLanguage: "Hindi",
      }),
    ];
    for (const plan of plans) {
      expect(plan.instruction).not.toMatch(/only in (Hindi|English|Hinglish|Tamil|Telugu|Kannada)/i);
      expect(plan.instruction).not.toContain("Language update");
    }
  });

  it("plans आगे बढ़ाओ as semantic_yes after Hindi confirm line", () => {
    const plan = planCustomerTurn({
      userText: "आगे बढ़ाओ।",
      lastAssistantText: "कन्फर्म कीजिए — हाँ, आगे बढ़ाऊँ, या अभी नहीं?",
      source: "flush",
      campaignLanguage: "Hindi",
    });
    expect(plan.action).toBe("semantic_yes");
    expect(plan.instructionReason).toBe("semantic_resolution");
    expect(plan.instruction).toContain("Treat this as YES");
  });

  it("plans an English NO as semantic_no", () => {
    const plan = planCustomerTurn({
      userText: "No, no, ma'am. I don't think so.",
      lastAssistantText: "क्या आगे फंड की जरूरत पड़ सकती है क्या?",
      source: "live",
      campaignLanguage: "Hindi",
    });
    expect(plan.action).toBe("semantic_no");
    expect(plan.cutPolicy).toBe("clear_playback");
    expect(plan.instructionReason).toBe("semantic_resolution");
  });

  it("plans ASR-garbled English decline as semantic_no", () => {
    const last =
      "आगे 3-6 महीने में होम, बिज़नेस, एजुकेशन, मेडिकल या फैमिली एक्सपेंस के लिएक्स्ट्रा फंड की ज़रूरत पड़ सकती है क्या?";
    const user = "Oh no no man I don't install.";
    expect(detectLeadingDecisionIntent(user)?.intent).toBe("no");
    const plan = planCustomerTurn({
      userText: user,
      lastAssistantText: last,
      source: "live",
      campaignLanguage: "Hindi",
    });
    expect(plan.action).toBe("semantic_no");
  });

  it("plans opening YES as next scripted step, not hardcoded top-up pitch", () => {
    const plan = planCustomerTurn({
      userText: "हां, बोलो।",
      lastAssistantText:
        "नमस्ते, मैं Ananya Vastu Housing Finance से बोल रही हूँ। क्या अभी एक मिनट बात हो पाएगी?",
      source: "live",
      campaignLanguage: "Hindi",
    });
    expect(plan.action).toBe("semantic_yes");
    expect(plan.instruction).toContain("agreed to talk");
    expect(plan.instruction).toContain("NEXT step written in the Campaign workflow");
    expect(plan.instruction).toContain("Do NOT invent a product pitch");
    expect(plan.instruction).not.toContain("आपका लोन रिसेंटली डिस्बर्स");
    expect(plan.instruction).toContain("do NOT jump to advisor callback");
  });

  it("treats right-person YES as script continue, not opening top-up pitch", () => {
    const plan = planCustomerTurn({
      userText: "हां, दिखाइए।",
      lastAssistantText:
        "ठीक है, धन्यवाद! ट्रेनिंग और ऑडिट पर्पस के लिए इस कॉल को रिकॉर्ड किया जाएगा। मैं वास्तु हाउसिंग फाइनेंसे आपकी एआई असिस्टेंट विद्या हूँ। मैं आशा के नाम से सबमिट की गई लोन एप्लीकेशन के बारे में बात कर रही हूँ। क्या मैं सही व्यक्ति से बात कर रही हूँ?",
      source: "live",
      campaignLanguage: "Hindi",
    });
    expect(plan.action).toBe("semantic_yes");
    expect(plan.instruction).not.toContain("permission-to-talk");
    expect(plan.instruction).toContain("right-person / identity");
    expect(plan.instruction).toContain("NEXT step written in the Campaign workflow");
  });

  it("does not treat number-source questions as YES via हां-in-कहां", () => {
    expect(
      detectLeadingDecisionIntent("2 मिनट 2 मिनट 2 मिनट आपको नंबर कहां से मिला?")?.intent,
    ).toBeUndefined();
    const plan = planCustomerTurn({
      userText: "2 मिनट 2 मिनट 2 मिनट आपको नंबर कहां से मिला?",
      lastAssistantText:
        "नमस्ते, मैं Ananya Vastu Housing Finance से बोल रही हूँ। क्या अभी एक मिनट बात हो पाएगी?",
      source: "live",
      campaignLanguage: "Hindi",
    });
    expect(plan.action).not.toBe("semantic_yes");
  });

  it("still detects leading हाँ as yes", () => {
    expect(detectLeadingDecisionIntent("हां, बोलो।")?.intent).toBe("yes");
  });

  it("plans bare बोलो as opening YES (permission go-ahead)", () => {
    const plan = planCustomerTurn({
      userText: "बोलो।",
      lastAssistantText:
        "नमस्ते, मैं Ananya Vastu Housing Finance से बोल रही हूँ। क्या अभी एक मिनट बात हो पाएगी?",
      source: "live",
      campaignLanguage: "Hindi",
    });
    expect(plan.action).toBe("semantic_yes");
    expect(plan.instruction).toContain("agreed to talk");
    expect(plan.instruction).toContain("NEXT step written in the Campaign workflow");
  });

  it("plans amount/need statement as need YES, not callback high-stakes", () => {
    const plan = planCustomerTurn({
      userText: "मैम, ₹2 करोड़ चाहिए मेरे को।",
      lastAssistantText:
        "The exact rate will be shared by the advisor after the review. Would you like me to note down your interest for a callback?",
      source: "live",
      campaignLanguage: "Hindi",
    });
    expect(plan.action).toBe("semantic_yes");
    expect(plan.instruction).toContain("concrete funding need");
    expect(plan.instruction).not.toContain("agreed to the callback");
    expect(plan.semantic?.trapId).not.toBe("high_stakes_confirm");
  });

  it("does not treat availability question as semantic_no / high-stakes", () => {
    const plan = planCustomerTurn({
      userText: "नहीं तो दो खोके मिलेंगे क्या मेरे को?",
      lastAssistantText:
        "ठीक है, मैं एडवाइज़र कॉलबैक के लिए नोट कर देती हूँ। किस पर्पस के लिए फंड चाहिए?",
      source: "live",
      campaignLanguage: "Hindi",
    });
    expect(plan.action).not.toBe("semantic_no");
    expect(plan.action).not.toBe("semantic_yes");
    expect(plan.semantic?.trapId).not.toBe("high_stakes_confirm");
  });

  it("treats ASR कोके need as amount/need YES not callback", () => {
    const plan = planCustomerTurn({
      userText: "हां, मैम। दो कोके की जरूरत है।",
      lastAssistantText: "आगे 3-6 महीने में एक्स्ट्रा फंड की ज़रूरत पड़ सकती है क्या?",
      source: "live",
      campaignLanguage: "Hindi",
    });
    expect(plan.action).toBe("semantic_yes");
    expect(plan.instruction).toMatch(/need|funding|जरूरत|concrete/i);
    expect(plan.semantic?.trapId).not.toBe("high_stakes_confirm");
  });

  it("treats go-ahead after short identity opening as semantic_yes with bounded protect", () => {
    const plan = planCustomerTurn({
      userText: "हां जी, मैम। बताइए।",
      lastAssistantText: "Namaste, main Ananya bol rahi hoon ABSLI se.",
      source: "live",
      campaignLanguage: "Hinglish",
    });
    expect(plan.action).toBe("semantic_yes");
    expect(plan.instruction).toContain("agreed to talk");
    // Keep short so barge-in still works during the post-YES pitch.
    expect(plan.protectAckMs).toBeGreaterThanOrEqual(1000);
    expect(plan.protectAckMs).toBeLessThanOrEqual(2000);
  });

  it("forces WhatsApp send_link instruction when customer asks for WhatsApp details", () => {
    const withTool = planCustomerTurn({
      userText: "Can you please share me the details of our WhatsApp?",
      lastAssistantText: "Would you like more details?",
      source: "live",
      hasLinkTool: true,
      campaignLanguage: "English",
    });
    expect(withTool.action).toBe("whatsapp_send_link");
    expect(withTool.instructionReason).toBe("whatsapp_send_link");
    expect(withTool.instruction).toContain("host is already sending");
    expect(withTool.instruction).toContain("do NOT call send_link");

    const withoutTool = planCustomerTurn({
      userText: "WhatsApp pe details bhej do",
      lastAssistantText: "Kya details chahiye?",
      source: "live",
      hasLinkTool: false,
      campaignLanguage: "Hinglish",
    });
    expect(withoutTool.action).toBe("whatsapp_send_link");
    expect(withoutTool.instructionReason).toBe("whatsapp_send_unavailable");
    expect(withoutTool.instruction).toContain("no WhatsApp link tool");
  });

  it("plans a mid-call content question as direct_answer", () => {
    const plan = planCustomerTurn({
      userText: "Aapko mera number kahan se mila, batao zara?",
      lastAssistantText: "Main aapke loan ke baare mein baat kar rahi hoon.",
      source: "live",
      campaignLanguage: "Hinglish",
    });
    expect(plan.action).toBe("direct_answer");
    expect(plan.instructionReason).toBe("direct_customer_answer");
    expect(plan.instruction).toContain("Answer that directly now");
  });

  it("plans nothing for a short filler ack outside a decision context", () => {
    const plan = planCustomerTurn({
      userText: "hmm ok",
      source: "live",
      campaignLanguage: "Hinglish",
    });
    expect(plan.action).toBe("none");
    expect(plan.cutPolicy).toBe("none");
    expect(plan.instruction).toBe("");
  });
});

describe("applyCustomerTurnPlan sticky semantic dedupe", () => {
  function makeDeps() {
    return {
      sessionDump: { event: vi.fn() },
      tryClearAudiblePlayback: vi.fn(() => true),
      interruptCurrentModelAudio: vi.fn(),
      clearModelAudioDropGuard: vi.fn(),
      clearCustomerSpeechMute: vi.fn(),
      activateCustomerPause: vi.fn(),
      noteControlIntentSent: vi.fn(),
      markDecisionResolutionApplied: vi.fn(),
      sendClientInstruction: vi.fn(),
      protectAckUntil: vi.fn(),
    };
  }

  it("does not re-fire the same semantic_yes after the timed window (late flush)", () => {
    const plan = planCustomerTurn({
      userText: "हां जी, बताइए।",
      lastAssistantText: "Namaste, main Ananya bol rahi hoon. Kya abhi baat ho payegi?",
      source: "live",
      campaignLanguage: "Hinglish",
    });
    expect(plan.action).toBe("semantic_yes");

    const deps = makeDeps();
    const first = applyCustomerTurnPlan(deps, plan, "हां जी, बताइए।", { fingerprint: "", atMs: 0 }, "live");
    expect(deps.sendClientInstruction).toHaveBeenCalledTimes(1);

    const lateDedupe = {
      fingerprint: first.fingerprint,
      atMs: Date.now() - DECISION_RESOLUTION_DEDUPE_MS - 5_000,
    };
    applyCustomerTurnPlan(deps, plan, "हां जी, बताइए।", lateDedupe, "flush");
    expect(deps.sendClientInstruction).toHaveBeenCalledTimes(1);
    expect(deps.interruptCurrentModelAudio).toHaveBeenCalledTimes(1);
  });

  it("sticky-dedupes when flush user text matches prior semantic decision key", () => {
    const plan = planCustomerTurn({
      userText: "हां जी, बताइए आप।",
      lastAssistantText: "Namaste, main Ananya bol rahi hoon. Kya abhi baat ho payegi?",
      source: "flush",
      campaignLanguage: "Hinglish",
    });
    expect(plan.action).toBe("semantic_yes");

    const deps = makeDeps();
    const lateDedupe = {
      fingerprint: "semantic_yes|हां जी, बताइए आप।",
      atMs: Date.now() - DECISION_RESOLUTION_DEDUPE_MS - 20_000,
    };
    applyCustomerTurnPlan(deps, plan, "हां जी, बताइए आप।", lateDedupe, "flush");
    expect(deps.sendClientInstruction).not.toHaveBeenCalled();
    expect(deps.interruptCurrentModelAudio).not.toHaveBeenCalled();
  });

  it("applies a control intent without touching any language state", () => {
    const plan = planCustomerTurn({
      userText: "Please speak slowly",
      source: "live",
      campaignLanguage: "Hindi",
    });
    const deps = makeDeps();
    applyCustomerTurnPlan(deps, plan, "Please speak slowly", { fingerprint: "", atMs: 0 }, "live");
    expect(deps.noteControlIntentSent).toHaveBeenCalledWith("slow_down");
    expect(deps.sendClientInstruction).toHaveBeenCalledTimes(1);
  });
});
