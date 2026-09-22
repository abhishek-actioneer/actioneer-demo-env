import type { CallConfig } from "./voice-call-state";
import { getCampaign } from "./voice-campaign-store";
import { shouldEndCallAfterAssistantTurn } from "./voice-call-disconnect";
import { normalizeTranscriptText } from "./plivo-gemini-live-text-utils";
import {
  buildSemanticClarificationInstruction,
  buildSemanticResolutionInstruction,
  classifyDecisionUtterance,
  isAssistantWrapUpTranscript,
  isBinaryDecisionContext,
  isDecisionTrapEvaluationReady,
  isSemanticTrapGateEnabled,
  isThanksOnlyTranscript,
  type ShortUtteranceClassification,
} from "./voice-semantic-traps";
import {
  buildSemanticFallbackInstruction,
  captureHighStakesDecisionAtClarify,
  isHighStakesSemanticTrapContext,
  shouldBlockWorkflowAfterSemanticFallback,
} from "./voice-semantic-trap-session";
import {
  AGENT_SEMANTIC_RESPONSE_BARGE_IN_COOLDOWN_MS,
} from "./plivo-gemini-live-config";

export type SemanticClarificationSource = "live" | "flush";
export type SemanticGateReleaseReason = "resolved" | "long_response" | "max_attempts";

export interface SemanticControllerDeps {
  /**
   * The campaign's configured language, read straight from CallConfig. Static
   * setting, not a runtime detection — it only selects which intra-language
   * ambiguity table the trap gate consults.
   */
  getLanguage: () => string;
  getCallConfig: () => CallConfig | undefined;
  sendClientInstruction: (
    text: string,
    reason: string,
    options?: { deferUntilIdle?: boolean },
  ) => void;
  emitEvent: (event: string, payload: Record<string, unknown>) => void;
  clearPlivoAudio: (reason?: string) => void;
  isDropModelAudioActive: () => boolean;
  setSemanticTrapAudioDrop: () => void;
  clearOutputTranscriptBuffer: () => void;
  getOutboundQueuedBytes: () => number;
  getAssistantTurnStartMs: () => number | undefined;
}

export interface SemanticController {
  classify(userText: string): ShortUtteranceClassification | null;
  classifyLive(userText: string): ShortUtteranceClassification | null;
  isClearDecisionIntent(
    classification: ShortUtteranceClassification | null,
  ): classification is ShortUtteranceClassification;
  applyDecisionResolution(
    userText: string,
    classification: ShortUtteranceClassification,
    source: SemanticClarificationSource,
  ): boolean;
  /** Mark resolution state without sending an instruction (turn planner owns the single instruction). */
  markDecisionResolutionApplied(
    userText: string,
    classification: ShortUtteranceClassification,
    source: SemanticClarificationSource,
  ): void;
  /** Sticky: same yes/no utterance already resolved this call (live must not re-fire on flush). */
  wasDecisionResolutionAppliedFor(userText: string, intent?: string): boolean;
  requestClarification(
    userText: string,
    classification: ShortUtteranceClassification,
    source: SemanticClarificationSource,
  ): boolean;
  maybeResolve(
    userText: string,
    classification: ShortUtteranceClassification | null,
    source?: SemanticClarificationSource,
  ): boolean;
  releaseGate(reason: SemanticGateReleaseReason, userText: string): void;
  /** Clear gate state without sending a fallback instruction (control intents). */
  releaseGateSilently(reason: string, userText: string): void;
  interruptForTrap(userText: string): void;
  semanticAudioBlocked(): boolean;
  isAgentTurnBargeInProtected(): boolean;
  protectAgentTurnFromBargeIn(): void;
  allowSemanticAgentTurn(): void;
  disallowSemanticAgentTurn(): void;
  /** Customer said only "thanks" after the agent's closing turn — send a brief sign-off. */
  shouldSendPostClosingThanks(userText: string): boolean;
  isAssistantWrapUpTurn(text: string): boolean;
  sendPostClosingThanksInstruction(userText: string): void;
  recordAssistantTurn(said: string): void;
  bumpClarificationAttempts(): void;
  isAwaitingClarification(): boolean;
  isHighStakesWorkflowBlocked(): boolean;
  getLiveClarificationKey(): string;
  getLastDecisionResolutionSentAtMs(): number;
  isAgentTurnAllowed(): boolean;
  getAgentTurnBargeInProtectedUntilMs(): number;
  getClarificationAttempts(): number;
  getLastAssistantTurnText(): string;
  getLastAssistantWasClosingTurn(): boolean;
}

/**
 * Owns all mutable state and behavior for the short-utterance "semantic trap"
 * gate: intra-language homophone disambiguation (yes/no/confused) at decision
 * points, high-stakes confirm tracking, and the barge-in protection window
 * that keeps clarification/resolution/fallback turns from being interrupted.
 */
export function createSemanticController(deps: SemanticControllerDeps): SemanticController {
  let lastAssistantTurnText = "";
  let lastAssistantWasClosingTurn = false;
  let lastDecisionResolutionSentAtMs = 0;
  let lastDecisionResolutionKey = "";
  let awaitingSemanticClarification = false;
  let pendingSemanticTrapId: string | undefined;
  let lastSemanticClarificationAtMs = 0;
  let lastSemanticClarificationKey = "";
  let liveSemanticClarificationKey = "";
  /** Normalized user text that triggered the current clarification — must not also resolve it. */
  let pendingClarificationTriggerText = "";
  let semanticClarificationAttempts = 0;
  /** Allows the next agent turn (clarification/resolution/fallback) to play out loud. */
  let semanticAgentTurnAllowed = false;
  /** Wall-clock guard — barge-in suppressed until this time after a semantic instruction. */
  let agentTurnBargeInProtectedUntilMs = 0;
  /** After high-stakes max_attempts fallback — block workflow actions for rest of call. */
  let semanticHighStakesWorkflowBlocked = false;
  /** Captured at clarify time — survives lastAssistantTurnText changing to the clarify question. */
  let semanticHighStakesDecisionActive = false;

  function semanticDecisionContextActive(): boolean {
    return awaitingSemanticClarification || isBinaryDecisionContext(lastAssistantTurnText);
  }

  function classify(userText: string): ShortUtteranceClassification | null {
    if (!isSemanticTrapGateEnabled()) return null;
    return classifyDecisionUtterance({
      text: userText,
      language: deps.getLanguage(),
      lastAssistantText: lastAssistantTurnText,
      atDecisionPoint: semanticDecisionContextActive(),
    });
  }

  function classifyLive(userText: string): ShortUtteranceClassification | null {
    if (!isDecisionTrapEvaluationReady(userText)) return null;
    return classify(userText);
  }

  function isClearDecisionIntent(
    classification: ShortUtteranceClassification | null,
  ): classification is ShortUtteranceClassification {
    return Boolean(
      classification &&
      !classification.needsClarification &&
      (classification.intent === "yes" || classification.intent === "no"),
    );
  }

  function decisionResolutionKey(userText: string, intent: string): string {
    return `${intent}:${normalizeTranscriptText(userText).toLowerCase().slice(-120)}`;
  }

  function wasDecisionResolutionAppliedFor(userText: string, intent?: string): boolean {
    if (!lastDecisionResolutionKey) return false;
    const normalized = normalizeTranscriptText(userText).toLowerCase().slice(-120);
    if (!normalized) return false;
    if (intent) {
      return lastDecisionResolutionKey === decisionResolutionKey(userText, intent);
    }
    // Same utterance text already resolved (intent prefix may differ only if reclassified).
    return lastDecisionResolutionKey.endsWith(`:${normalized}`);
  }

  function applyDecisionResolution(
    userText: string,
    classification: ShortUtteranceClassification,
    source: SemanticClarificationSource,
  ): boolean {
    if (!isClearDecisionIntent(classification)) return false;
    if (!isBinaryDecisionContext(lastAssistantTurnText)) return false;

    const now = Date.now();
    const resolutionKey = decisionResolutionKey(userText, classification.intent);
    // Sticky same-utterance: long agent replies outlive the timed window; flush must not re-send.
    if (resolutionKey === lastDecisionResolutionKey) {
      deps.emitEvent("gemini.decision_resolution_ignored_duplicate", {
        source,
        intent: classification.intent,
        text: userText,
        reason: "sticky_same_resolution_key",
        ageMs: now - lastDecisionResolutionSentAtMs,
      });
      return false;
    }
    if (now - lastDecisionResolutionSentAtMs < 2000) return false;

    lastDecisionResolutionSentAtMs = now;
    lastDecisionResolutionKey = resolutionKey;
    semanticAgentTurnAllowed = true;
    agentTurnBargeInProtectedUntilMs = Math.max(
      agentTurnBargeInProtectedUntilMs,
      now + AGENT_SEMANTIC_RESPONSE_BARGE_IN_COOLDOWN_MS,
    );

    deps.emitEvent("gemini.decision_resolution", {
      source,
      intent: classification.intent,
      text: userText,
      assistantText: lastAssistantTurnText,
    });
    deps.sendClientInstruction(
      buildSemanticResolutionInstruction(
        classification,
        userText,
        deps.getLanguage(),
        lastAssistantTurnText,
        deps.getCallConfig()?.customerContext?.displayName ||
          deps.getCallConfig()?.customerContext?.firstName,
      ),
      "semantic_resolution",
    );
    console.log(
      `[voice/gemini-live] decision resolution (${source}) intent=${classification.intent} text="${userText}"`,
    );
    return true;
  }

  function markDecisionResolutionApplied(
    userText: string,
    classification: ShortUtteranceClassification,
    source: SemanticClarificationSource,
  ): void {
    const now = Date.now();
    lastDecisionResolutionSentAtMs = now;
    lastDecisionResolutionKey = decisionResolutionKey(userText, classification.intent);
    semanticAgentTurnAllowed = true;
    agentTurnBargeInProtectedUntilMs = Math.max(
      agentTurnBargeInProtectedUntilMs,
      now + AGENT_SEMANTIC_RESPONSE_BARGE_IN_COOLDOWN_MS,
    );
    deps.emitEvent("gemini.decision_resolution", {
      source,
      intent: classification.intent,
      text: userText,
      assistantText: lastAssistantTurnText,
      via: "turn_planner",
    });
    console.log(
      `[voice/gemini-live] decision resolution (${source}/planner) intent=${classification.intent} text="${userText}"`,
    );
  }

  function isAssistantWrapUpTurn(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const callConfig = deps.getCallConfig();
    if (callConfig && shouldEndCallAfterAssistantTurn(trimmed, getCampaign(callConfig.campaignId))) {
      return true;
    }
    return isAssistantWrapUpTranscript(trimmed);
  }

  function sendPostClosingThanksInstruction(userText: string): void {
    deps.sendClientInstruction(
      `Customer said a brief thanks ("${userText}") after your closing. ` +
      `Do NOT repeat your previous closing message. ` +
      `Say at most one short goodbye phrase in ${deps.getLanguage()}, then stop.`,
      "post_closing_thanks",
    );
    deps.emitEvent("gemini.post_closing_thanks_instruction", {
      text: userText,
      language: deps.getLanguage(),
    });
  }

  function shouldSendPostClosingThanks(userText: string): boolean {
    return lastAssistantWasClosingTurn && isThanksOnlyTranscript(userText);
  }

  function isHighStakesSemanticContext(): boolean {
    return isHighStakesSemanticTrapContext({
      decisionActive: semanticHighStakesDecisionActive,
      trapId: pendingSemanticTrapId,
      assistantText: lastAssistantTurnText,
    });
  }

  function isAgentTurnBargeInProtected(): boolean {
    // Time-window only. Previously `semanticAgentTurnAllowed` blocked barge-in for
    // the entire semantic reply (often 15–30s of pitch), so real interruptions
    // could not cut audio until turnComplete — felt like barge-in was broken.
    // Echo protection still applies for AGENT_SEMANTIC_RESPONSE_BARGE_IN_COOLDOWN_MS
    // after resolution / protectAgentTurnFromBargeIn().
    return Date.now() < agentTurnBargeInProtectedUntilMs;
  }

  function protectAgentTurnFromBargeIn(): void {
    agentTurnBargeInProtectedUntilMs = Math.max(
      agentTurnBargeInProtectedUntilMs,
      Date.now() + AGENT_SEMANTIC_RESPONSE_BARGE_IN_COOLDOWN_MS,
    );
  }

  function allowSemanticAgentTurn(): void {
    semanticAgentTurnAllowed = true;
    protectAgentTurnFromBargeIn();
  }

  function disallowSemanticAgentTurn(): void {
    semanticAgentTurnAllowed = false;
  }

  function releaseGate(reason: SemanticGateReleaseReason, userText: string): void {
    const highStakes = isHighStakesSemanticContext();
    awaitingSemanticClarification = false;
    pendingSemanticTrapId = undefined;
    liveSemanticClarificationKey = "";
    pendingClarificationTriggerText = "";
    semanticHighStakesDecisionActive = false;
    semanticClarificationAttempts = 0;
    semanticAgentTurnAllowed = false;
    if (reason !== "resolved") {
      if (shouldBlockWorkflowAfterSemanticFallback(highStakes)) {
        semanticHighStakesWorkflowBlocked = true;
      }
      console.log(`[voice/gemini-live] semantic gate fallback reason=${reason} highStakes=${highStakes} text="${userText}"`);
      deps.emitEvent("gemini.semantic_trap_fallback", { reason, text: userText, highStakes });
      allowSemanticAgentTurn();
      deps.sendClientInstruction(
        buildSemanticFallbackInstruction(deps.getLanguage(), reason, userText, highStakes),
        "semantic_fallback",
      );
    }
  }

  function releaseGateSilently(reason: string, userText: string): void {
    awaitingSemanticClarification = false;
    pendingSemanticTrapId = undefined;
    liveSemanticClarificationKey = "";
    pendingClarificationTriggerText = "";
    semanticHighStakesDecisionActive = false;
    semanticClarificationAttempts = 0;
    allowSemanticAgentTurn();
    console.log(`[voice/gemini-live] semantic gate released silently reason=${reason} text="${userText}"`);
    deps.emitEvent("gemini.semantic_trap_released_silent", { reason, text: userText });
  }

  function interruptForTrap(userText: string): void {
    // Arm the model-audio drop only while a model turn is actually in flight.
    // If the turn already completed (trap fired on its transcript), the armed
    // gate would swallow the trap's own instructed confirmation turn instead.
    const modelTurnInFlight = deps.getAssistantTurnStartMs() !== undefined;
    if (!deps.isDropModelAudioActive()) {
      if (modelTurnInFlight) {
        deps.setSemanticTrapAudioDrop();
        deps.clearOutputTranscriptBuffer();
      }
      // Always cut Plivo playback: queued frames of the finished turn may
      // still be playing on the phone even when no model turn is in flight.
      deps.clearPlivoAudio();
    }
    console.log(`[voice/gemini-live] semantic trap interrupt — cut agent audio for "${userText}"`);
    deps.emitEvent("gemini.semantic_trap_interrupt", {
      text: userText,
      hadOutboundAudio: deps.getOutboundQueuedBytes() > 0 || deps.getAssistantTurnStartMs() !== undefined,
    });
  }

  function requestClarification(
    userText: string,
    classification: ShortUtteranceClassification,
    source: SemanticClarificationSource,
  ): boolean {
    // Same utterance already resolved (live trap → flush must not re-clarify).
    if (wasDecisionResolutionAppliedFor(userText, classification.intent)) {
      deps.emitEvent("gemini.semantic_clarification_skipped_already_resolved", {
        source,
        intent: classification.intent,
        text: userText,
      });
      console.log(
        `[voice/gemini-live] semantic trap clarification skipped (already resolved) src=${source} text="${userText}"`,
      );
      return false;
    }
    const dedupeKey = `${classification.trapId ?? "unknown"}:${userText.trim().toLowerCase()}`;
    const now = Date.now();
    if (source === "flush" && liveSemanticClarificationKey === dedupeKey) {
      return false;
    }
    if (now - lastSemanticClarificationAtMs < 2500 && lastSemanticClarificationKey === dedupeKey) {
      return false;
    }

    awaitingSemanticClarification = true;
    pendingSemanticTrapId = classification.trapId;
    pendingClarificationTriggerText = normalizeTranscriptText(userText).toLowerCase();
    semanticHighStakesDecisionActive = captureHighStakesDecisionAtClarify(
      classification.trapId,
      lastAssistantTurnText,
      semanticHighStakesDecisionActive,
    );
    semanticClarificationAttempts += 1;
    lastSemanticClarificationAtMs = now;
    lastSemanticClarificationKey = dedupeKey;
    if (source === "live") {
      liveSemanticClarificationKey = dedupeKey;
      interruptForTrap(userText);
    }

    console.log(
      `[voice/gemini-live] semantic trap gate (${source}) trapId=${classification.trapId ?? "unknown"} ` +
      `intent=${classification.intent} text="${userText}"`,
    );
    deps.emitEvent("gemini.semantic_clarification_required", {
      source,
      trapId: classification.trapId,
      intent: classification.intent,
      text: userText,
    });
    allowSemanticAgentTurn();
    deps.sendClientInstruction(
      buildSemanticClarificationInstruction(
        deps.getLanguage(),
        classification.trapId,
        userText,
      ),
      "semantic_clarification",
    );
    return true;
  }

  function maybeResolve(
    userText: string,
    classification: ShortUtteranceClassification | null,
    source: SemanticClarificationSource = "live",
  ): boolean {
    if (!awaitingSemanticClarification) return false;
    if (!classification || classification.needsClarification) return false;

    // Live ASR often re-emits the same utterance that triggered clarification.
    // Never treat that echo as the customer's answer to the confirm question.
    const normalized = normalizeTranscriptText(userText).toLowerCase();
    if (
      pendingClarificationTriggerText &&
      (normalized === pendingClarificationTriggerText ||
        normalized.includes(pendingClarificationTriggerText) ||
        pendingClarificationTriggerText.includes(normalized))
    ) {
      deps.emitEvent("gemini.semantic_resolve_ignored_same_utterance", {
        text: userText,
        trigger: pendingClarificationTriggerText,
      });
      return false;
    }

    if (!isClearDecisionIntent(classification)) return false;

    // Capture assistant question before releaseGate clears gate state.
    const assistantForResolution = lastAssistantTurnText;
    releaseGate("resolved", userText);
    // Sticky: flush must not re-open high_stakes on this same utterance against
    // the still-stale lastAssistant question while the resolution pitch plays.
    markDecisionResolutionApplied(userText, classification, source);
    console.log(
      `[voice/gemini-live] semantic trap resolved intent=${classification.intent} text="${userText}"`,
    );
    deps.emitEvent("gemini.semantic_trap_resolved", {
      intent: classification.intent,
      text: userText,
    });
    allowSemanticAgentTurn();
    deps.sendClientInstruction(
      buildSemanticResolutionInstruction(
        classification,
        userText,
        deps.getLanguage(),
        assistantForResolution,
        deps.getCallConfig()?.customerContext?.displayName ||
          deps.getCallConfig()?.customerContext?.firstName,
      ),
      "semantic_resolution",
    );
    return true;
  }

  function semanticAudioBlocked(): boolean {
    return awaitingSemanticClarification && !semanticAgentTurnAllowed;
  }

  function recordAssistantTurn(said: string): void {
    // Cut stubs ("मैं Vastu Housing") must not replace the real prior question —
    // otherwise flush re-plans the same YES against a short identity opener.
    const trimmed = said.trim();
    if (!trimmed) return;
    if (trimmed.length < 28 && !/[?？]/.test(trimmed)) return;
    if (/[,;:]$/.test(trimmed) && trimmed.length < 48) return;
    lastAssistantTurnText = said;
    lastAssistantWasClosingTurn = isAssistantWrapUpTurn(said);
  }

  function bumpClarificationAttempts(): void {
    semanticClarificationAttempts += 1;
  }

  return {
    classify,
    classifyLive,
    isClearDecisionIntent,
    applyDecisionResolution,
    markDecisionResolutionApplied,
    wasDecisionResolutionAppliedFor,
    requestClarification,
    maybeResolve,
    releaseGate,
    releaseGateSilently,
    interruptForTrap,
    semanticAudioBlocked,
    isAgentTurnBargeInProtected,
    protectAgentTurnFromBargeIn,
    allowSemanticAgentTurn,
    disallowSemanticAgentTurn,
    shouldSendPostClosingThanks,
    isAssistantWrapUpTurn,
    sendPostClosingThanksInstruction,
    recordAssistantTurn,
    bumpClarificationAttempts,
    isAwaitingClarification: () => awaitingSemanticClarification,
    isHighStakesWorkflowBlocked: () => semanticHighStakesWorkflowBlocked,
    getLiveClarificationKey: () => liveSemanticClarificationKey,
    getLastDecisionResolutionSentAtMs: () => lastDecisionResolutionSentAtMs,
    isAgentTurnAllowed: () => semanticAgentTurnAllowed,
    getAgentTurnBargeInProtectedUntilMs: () => agentTurnBargeInProtectedUntilMs,
    getClarificationAttempts: () => semanticClarificationAttempts,
    getLastAssistantTurnText: () => lastAssistantTurnText,
    getLastAssistantWasClosingTurn: () => lastAssistantWasClosingTurn,
  };
}
