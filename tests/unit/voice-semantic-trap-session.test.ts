import { describe, expect, it } from "vitest";
import {
  buildSemanticFallbackInstruction,
  captureHighStakesDecisionAtClarify,
  evaluateSemanticTrapFlush,
  isHighStakesSemanticTrapContext,
  MAX_SEMANTIC_CLARIFICATION_ATTEMPTS,
  semanticTrapDedupeKey,
  shouldBlockWorkflowAfterSemanticFallback,
  shouldReleaseSemanticGate,
} from "@/lib/voice-semantic-trap-session";
import type { ShortUtteranceClassification } from "@/lib/voice-semantic-traps";

describe("voice-semantic-trap-session", () => {
  const resolvedYes: ShortUtteranceClassification = {
    intent: "yes",
    needsClarification: false,
    trapId: "ta_aama_vs_amma",
    confidence: 3,
    ambiguous: false,
  };

  const stillAmbiguous: ShortUtteranceClassification = {
    intent: "unknown",
    needsClarification: true,
    trapId: "kn_ha_vs_huh",
    confidence: 1,
    ambiguous: true,
  };

  const dedupeKey = semanticTrapDedupeKey("kn_ha_vs_huh", "ha");

  it("releases when classification resolves", () => {
    expect(
      shouldReleaseSemanticGate({
        awaiting: true,
        classification: resolvedYes,
        userText: "aama",
        clarificationAttempts: 1,
      }),
    ).toEqual({ release: true, reason: "resolved" });
  });

  it("releases on long reply without classification", () => {
    expect(
      shouldReleaseSemanticGate({
        awaiting: true,
        classification: null,
        userText: "illa nanu interest illa adre later call madi",
        clarificationAttempts: 1,
      }),
    ).toEqual({ release: true, reason: "long_response" });
  });

  it("releases after max clarification attempts", () => {
    expect(
      shouldReleaseSemanticGate({
        awaiting: true,
        classification: stillAmbiguous,
        userText: "ha",
        clarificationAttempts: MAX_SEMANTIC_CLARIFICATION_ATTEMPTS,
      }),
    ).toEqual({ release: true, reason: "max_attempts" });
  });

  it("keeps gate closed while awaiting short ambiguous reply", () => {
    expect(
      shouldReleaseSemanticGate({
        awaiting: true,
        classification: stillAmbiguous,
        userText: "ha",
        clarificationAttempts: 1,
      }),
    ).toEqual({ release: false });
  });

  it("builds fallback instructions", () => {
    expect(buildSemanticFallbackInstruction("Tamil", "long_response", "nanu busy")).toContain("longer reply");
    expect(buildSemanticFallbackInstruction("Tamil", "max_attempts", "ha")).toContain("exhausted");
    expect(buildSemanticFallbackInstruction("Tamil", "max_attempts", "ha", true)).toContain("NOT consented");
  });

  describe("high-stakes context", () => {
    const callbackQuestion = "Shall I schedule an advisor callback for you?";

    it("captures high-stakes at homophone trap during callback question", () => {
      expect(
        captureHighStakesDecisionAtClarify("kn_ha_vs_huh", callbackQuestion, false),
      ).toBe(true);
    });

    it("does not capture high-stakes for homophone outside callback context", () => {
      expect(
        captureHighStakesDecisionAtClarify("kn_ha_vs_huh", "Kya abhi ek minute baat ho payegi?", false),
      ).toBe(false);
    });

    it("blocks workflow after any high-stakes fallback", () => {
      expect(shouldBlockWorkflowAfterSemanticFallback(true)).toBe(true);
      expect(shouldBlockWorkflowAfterSemanticFallback(false)).toBe(false);
    });

    it("detects high-stakes via captured decision flag after assistant text changes", () => {
      expect(
        isHighStakesSemanticTrapContext({
          decisionActive: true,
          assistantText: "Just to confirm — interest irukka?",
        }),
      ).toBe(true);
    });
  });

  describe("evaluateSemanticTrapFlush", () => {
    it("returns clarification_sent when flush sends clarification", () => {
      expect(
        evaluateSemanticTrapFlush({
          classification: stillAmbiguous,
          userText: "ha",
          liveClarificationKey: "",
          trapDedupeKey: dedupeKey,
          awaitingClarification: true,
          clarificationAttempts: 1,
          clarificationSent: true,
        }),
      ).toEqual({ action: "clarification_sent" });
    });

    it("returns live_already_handled without double-counting attempts", () => {
      expect(
        evaluateSemanticTrapFlush({
          classification: stillAmbiguous,
          userText: "ha",
          liveClarificationKey: dedupeKey,
          trapDedupeKey: dedupeKey,
          awaitingClarification: true,
          clarificationAttempts: 1,
          clarificationSent: false,
        }),
      ).toEqual({ action: "live_already_handled" });
    });

    it("returns resolved_continue on clear yes after clarification", () => {
      expect(
        evaluateSemanticTrapFlush({
          classification: resolvedYes,
          userText: "aama",
          liveClarificationKey: "",
          trapDedupeKey: semanticTrapDedupeKey("ta_aama_vs_amma", "aama"),
          awaitingClarification: true,
          clarificationAttempts: 1,
          clarificationSent: false,
        }),
      ).toEqual({ action: "resolved_continue" });
    });

    it("blocks while awaiting short ambiguous second reply", () => {
      expect(
        evaluateSemanticTrapFlush({
          classification: stillAmbiguous,
          userText: "ha",
          liveClarificationKey: "",
          trapDedupeKey: dedupeKey,
          awaitingClarification: true,
          clarificationAttempts: 1,
          clarificationSent: false,
        }),
      ).toEqual({ action: "block_awaiting_user" });
    });

    it("releases gate after max attempts on repeated ambiguity", () => {
      expect(
        evaluateSemanticTrapFlush({
          classification: stillAmbiguous,
          userText: "ha",
          liveClarificationKey: "",
          trapDedupeKey: dedupeKey,
          awaitingClarification: true,
          clarificationAttempts: MAX_SEMANTIC_CLARIFICATION_ATTEMPTS,
          clarificationSent: false,
        }),
      ).toEqual({ action: "release_gate", reason: "max_attempts" });
    });

    it("continues normal flush when gate inactive", () => {
      expect(
        evaluateSemanticTrapFlush({
          classification: null,
          userText: "howdu nanu free ideeni",
          liveClarificationKey: "",
          trapDedupeKey: "",
          awaitingClarification: false,
          clarificationAttempts: 0,
          clarificationSent: false,
        }),
      ).toEqual({ action: "continue" });
    });

    it("silently releases gate when control intent preempts clarification", () => {
      expect(
        evaluateSemanticTrapFlush({
          classification: null,
          userText: "Ma'am, can you please speak a bit slowly?",
          liveClarificationKey: "",
          trapDedupeKey: "",
          awaitingClarification: true,
          clarificationAttempts: 1,
          clarificationSent: false,
          controlIntent: "slow_down",
        }),
      ).toEqual({ action: "release_gate_silent", reason: "control_slow_down" });
    });

    it("does not long_response-fallback when control intent is present", () => {
      expect(
        evaluateSemanticTrapFlush({
          classification: null,
          userText: "Ma'am, can you please speak a bit slowly?",
          liveClarificationKey: "",
          trapDedupeKey: "",
          awaitingClarification: true,
          clarificationAttempts: 1,
          clarificationSent: false,
          controlIntent: "slow_down",
        }).action,
      ).not.toBe("release_gate");
    });
  });
});
