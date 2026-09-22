import type { CallConfig } from "./voice-call-state";
import { appendCallTranscript } from "./voice-campaign-store";
import type { VoiceTranscriptTurn } from "./voice-campaign-types";
import { maybeSendPostCallFollowUp } from "./voice-followup-sms";
import type { VoiceSessionDumpLogger } from "./voice-debug-dump";
import { maybeTriggerMidCallWorkflowActions } from "./voice-midcall-actions";
import {
  evaluateSemanticTrapFlush,
  MAX_SEMANTIC_CLARIFICATION_ATTEMPTS,
  semanticTrapDedupeKey,
} from "./voice-semantic-trap-session";
import {
  detectRuntimeControlIntent,
  isLikelyNoiseTranscript,
  isLikelyNonAddressedAmbientTranscript,
  isLowSignalTranscript,
  isOutOfDomainTranscript,
  lastAssistantAskedQuestion,
  shouldArmAmbientModelAudioDrop,
  shouldResumeFromUserSpeech,
  type RuntimeControlIntent,
} from "./plivo-gemini-live-transcript-guards";
import { POST_INTERRUPT_ANSWER_WINDOW_MS } from "./plivo-gemini-live-config";
import type { SemanticController } from "./plivo-gemini-live-semantic-controller";
import {
  applyCustomerTurnPlan,
  planCustomerTurn,
} from "./plivo-gemini-live-turn-planner";
import { hostSendWhatsAppLink } from "./plivo-gemini-live-send-link";
import { hasGupshupWhatsAppTemplateConfig } from "../features/integrations/server/providers/gupshup/whatsapp-client";
import { publicDemoWhatsAppAllowed } from "./public-demo-route";
import type { ShortUtteranceClassification } from "./voice-semantic-traps";

// ── Control-intent / pause-resume instruction builders ────────────────────
// (formerly plivo-gemini-live-control-utils.ts — merged here since these are
// only ever consumed alongside the user-turn flush + live control-intent path.)

export function controlIntentDedupeKey(intent: RuntimeControlIntent, sourceText: string): string {
  const tail = sourceText.toLowerCase().slice(-60);
  return `${intent}:${tail}`;
}

export function controlIntentCooldownMs(intent: RuntimeControlIntent): number {
  // slow_down must outlast long dropped-turn windows; otherwise flush/live
  // re-sends and re-cuts the acknowledgement after Gemini finally turnCompletes.
  return intent === "slow_down" ? 12000 : 8000;
}

export function shouldSkipControlIntentAsDuplicate(params: {
  intent: RuntimeControlIntent;
  sourceText: string;
  lastControlIntentKey: string;
  lastControlIntentSentAtMs: number;
  nowMs: number;
}): { skip: boolean; dedupeKey: string; tail: string; cooldownMs: number } {
  const tail = params.sourceText.toLowerCase().slice(-60);
  const dedupeKey = `${params.intent}:${tail}`;
  const cooldownMs = controlIntentCooldownMs(params.intent);
  const skip =
    dedupeKey === params.lastControlIntentKey &&
    params.nowMs - params.lastControlIntentSentAtMs < cooldownMs;
  return { skip, dedupeKey, tail, cooldownMs };
}

export function buildControlIntentInstructionText(intent: RuntimeControlIntent): string {
  const action = intent === "slow_down"
    ? "Customer asked you to slow down."
    : "Customer asked you to pause speaking for a moment.";
  const followup = intent === "slow_down"
    ? "Give one short acknowledgement, then continue with shorter, slower sentences."
    : "Give one short acknowledgement, then stay silent and wait for the customer's next speech before continuing.";
  return `${action} ${followup}`;
}

export function buildPauseResumeInstructionText(): string {
  return (
    "Customer has asked you to continue. Exit waiting mode now and resume the conversation naturally from where you paused. " +
    "Do not repeat any waiting acknowledgement (for example \"I'm waiting\" / \"take your time\"). Continue the actual call flow now."
  );
}

// ── Live transcript persistence helpers ─────────────────────────────────────
// (formerly plivo-gemini-live-transcript-store.ts — merged here since both
// call sites live in the user-turn flush / stream transcript-recording path.)

export function recordLiveTranscriptTurn(params: {
  enabled: boolean;
  campaignId?: string;
  callUuid?: string;
  role: "assistant" | "user";
  text: string;
  sequence: number;
  startMs: number;
  endMs: number;
  turns: VoiceTranscriptTurn[];
}): { sequence: number; turns: VoiceTranscriptTurn[] } {
  if (!params.enabled || !params.campaignId || !params.callUuid) {
    return { sequence: params.sequence, turns: params.turns };
  }
  const trimmed = params.text.trim();
  if (!trimmed) {
    return { sequence: params.sequence, turns: params.turns };
  }

  const nextSequence = params.sequence + 1;
  const turn: VoiceTranscriptTurn = {
    id: `${params.callUuid}_live_${params.role}_${nextSequence}`,
    role: params.role,
    text: trimmed,
    at: new Date().toISOString(),
    itemId: `live-${params.role}-${params.startMs}-${nextSequence}`,
    sequence: nextSequence,
    startMs: params.startMs,
    endMs: params.endMs,
  };

  const nextTurns = [...params.turns, turn];
  appendCallTranscript(params.campaignId, params.callUuid, turn);
  return { sequence: nextSequence, turns: nextTurns };
}

export function queuePostCallFollowupFromLiveTranscript(params: {
  alreadyQueued: boolean;
  callUuid?: string;
  turns: VoiceTranscriptTurn[];
}): boolean {
  if (params.alreadyQueued || !params.callUuid || params.turns.length === 0) return params.alreadyQueued;

  void maybeSendPostCallFollowUp(
    params.callUuid,
    `live-${params.callUuid}`,
    params.turns,
  ).catch((err) => {
    console.error("[voice/gemini-live] Failed to process live transcript follow-up:", err);
  });
  return true;
}

// ── User-turn flush ──────────────────────────────────────────────────────────

/**
 * Everything `flushPendingUserTranscript` needs from the owning stream
 * session. Mirrors the get/set accessor-pair pattern used by
 * `GeminiHandlerDeps` — mutations here are immediately visible back in
 * plivo-gemini-live-stream.ts since the getters/setters close over the same
 * bindings.
 */
export interface UserTurnFlusherDeps {
  sessionDump: VoiceSessionDumpLogger;
  semantic: SemanticController;

  getCallConfig(): CallConfig | undefined;
  getCurrentCallUuid(): string | undefined;
  /** Media-stream call config id (vc-in-...), not Plivo CallUUID. */
  getCallConfigId(): string | undefined;

  getPendingUserTranscript(): string;
  setPendingUserTranscript(value: string): void;
  getPendingUserTranscriptAcousticallyVerified?(): boolean;
  setPendingUserTranscriptAcousticallyVerified?(value: boolean): void;

  getScreeningReplyQueued(): boolean;

  getCustomerTurnCount(): number;
  setCustomerTurnCount(value: number): void;

  getUserTurnStartMs(): number | undefined;
  setUserTurnStartMs(value: number | undefined): void;

  getCustomerPauseActive(): boolean;
  setCustomerPauseActive(value: boolean): void;
  setCustomerPauseAckPending(value: boolean): void;

  getOutputTranscriptBuffer(): string;
  getLastUserBargeInAtMs(): number;

  getTurnPlanDedupe(): { fingerprint: string; atMs: number };
  setTurnPlanDedupe(value: { fingerprint: string; atMs: number }): void;

  mediaStreamOffsetMs(): number;

  tryClearAudiblePlayback(reason: string, details?: Record<string, unknown>): boolean;
  interruptCurrentModelAudio(reason: string, details?: Record<string, unknown>): void;
  clearModelAudioDropGuard?(reason: string): void;
  clearCustomerSpeechMute?(reason: string): void;
  /** True while post-barge-in mute is holding agent audio. */
  isCustomerSpeechMuteActive?(): boolean;
  /**
   * Resume after a barge-in that produced only noise / empty ASR —
   * prevents dry calls when the agent was cut mid-sentence.
   */
  recoverFromEmptyBargeIn?(reason: string): void;
  /** True while empty-barge-in recovery audio must not be ambient-dropped. */
  isBargeInRecoveryProtected?(): boolean;
  /** ASR produced words the guards discarded — a human spoke, content unknown. */
  noteRejectedSpeech?(nowMs?: number): void;
  getAwaitingCustomerResponse?(): boolean;
  getLastMeaningfulUserSpeechAtMs?(): number;
  activateCustomerPause(): void;
  noteControlIntentSent(intent: RuntimeControlIntent): void;
  markDecisionResolutionApplied(
    userText: string,
    semantic: ShortUtteranceClassification,
    source: "live" | "flush",
  ): void;
  sendClientInstruction(
    text: string,
    reason?: string,
    options?: { deferUntilIdle?: boolean },
  ): void;
  protectAckUntil(untilMs: number): void;
  sendResumeFromPauseInstruction(source: "live" | "flush", userText: string): void;
  /** Queue μ-law into Plivo outbound (public-demo switch ambient). */
  queueOutboundMulaw?(payloadBase64: string): void;

  recordTranscriptTurn(
    role: "assistant" | "user",
    text: string,
    timing?: { startMs?: number; endMs?: number },
  ): void;
  releaseAwaitingCustomerResponse(reason: string): void;
  schedulePostBargeInNudge(userTurnText: string): void;
  clearPostBargeInNudge(reason: string): void;
  sendPostInterruptAnswerNudge(userTurnText: string): void;
  isSubstantiveUserInterrupt(text: string): boolean;
  scheduleAgentDisconnect(triggerText: string, reason: string): void;
}

export interface UserTurnFlusher {
  flushPendingUserTranscript(): void;
}

/**
 * Owns the finalized-customer-turn flush pipeline: noise/out-of-domain
 * filtering, call-screening suppression, control-intent handling, customer
 * hold/pause resume, the semantic short-utterance trap gate, transcript
 * recording, and mid-call workflow triggering.
 */
export function createUserTurnFlusher(deps: UserTurnFlusherDeps): UserTurnFlusher {
  function suppressAmbientFalseReply(reason: string, text: string, phase: string): void {
    if (text.trim()) {
      deps.sessionDump.event("transcript.out_of_domain_ignored", {
        text,
        phase,
        reason,
      });
    }
    deps.setPendingUserTranscript("");
    deps.setPendingUserTranscriptAcousticallyVerified?.(false);
    const meaningfulAt = deps.getLastMeaningfulUserSpeechAtMs?.() ?? 0;
    const mayDropAudio = shouldArmAmbientModelAudioDrop({
      muteActive: deps.isCustomerSpeechMuteActive?.(),
      recoveryProtected: deps.isBargeInRecoveryProtected?.(),
      awaitingCustomer: deps.getAwaitingCustomerResponse?.(),
      lastAssistantText: deps.semantic.getLastAssistantTurnText(),
      msSinceMeaningfulUserSpeech: meaningfulAt > 0 ? Date.now() - meaningfulAt : undefined,
    });
    if (!mayDropAudio) {
      deps.sessionDump.event("transcript.noise_cleared_without_audio_drop", {
        text,
        phase,
        reason,
        awaitingCustomer: deps.getAwaitingCustomerResponse?.(),
        askedQuestion: lastAssistantAskedQuestion(deps.semantic.getLastAssistantTurnText()),
      });
      return;
    }
    // Ignoring the transcript alone is not enough — Gemini may already be
    // generating a spoken reply to ambient audio. Drop it before it plays.
    deps.interruptCurrentModelAudio(reason, {
      text: text.slice(0, 240),
      phase,
    });
  }

  function flushPendingUserTranscript(): void {
    const pendingUserTranscript = deps.getPendingUserTranscript();
    const acousticallyVerified =
      deps.getPendingUserTranscriptAcousticallyVerified?.() ?? false;
    if (
      !acousticallyVerified &&
      (isLowSignalTranscript(pendingUserTranscript) ||
        isLikelyNoiseTranscript(pendingUserTranscript) ||
        isOutOfDomainTranscript(pendingUserTranscript))
    ) {
      suppressAmbientFalseReply(
        isLowSignalTranscript(pendingUserTranscript)
          ? "ambient_noise_low_signal"
          : isLikelyNoiseTranscript(pendingUserTranscript)
            ? "ambient_noise_ignored"
            : "ambient_noise_out_of_domain",
        pendingUserTranscript,
        "flush",
      );
      return;
    }
    if (
      !acousticallyVerified &&
      isLikelyNonAddressedAmbientTranscript(
        pendingUserTranscript,
        deps.semantic.getLastAssistantTurnText(),
      )
    ) {
      suppressAmbientFalseReply(
        "ambient_noise_non_addressed",
        pendingUserTranscript,
        "flush",
      );
      return;
    }
    // Do not persist known call-screening / voicemail prompt text as customer speech.
    if (deps.getScreeningReplyQueued()) {
      deps.setPendingUserTranscript("");
      deps.setPendingUserTranscriptAcousticallyVerified?.(false);
      return;
    }
    const userTurnText = pendingUserTranscript;
    if (!userTurnText.trim()) {
      deps.setPendingUserTranscript("");
      deps.setPendingUserTranscriptAcousticallyVerified?.(false);
      return;
    }
    // Count each finalized customer turn once.
    deps.setCustomerTurnCount(deps.getCustomerTurnCount() + 1);

    if (deps.getCustomerPauseActive()) {
      const controlForPause = detectRuntimeControlIntent(userTurnText);
      const isHoldReinforcement =
        controlForPause?.intent === "wait" || controlForPause?.intent === "stop";
      if (!isHoldReinforcement && shouldResumeFromUserSpeech(userTurnText)) {
        deps.setCustomerPauseActive(false);
        deps.setCustomerPauseAckPending(false);
        deps.sessionDump.event("gemini.customer_pause_released", {
          reason: "resume_by_speech_flush",
        });
        deps.sendResumeFromPauseInstruction("flush", userTurnText);
      } else if (!controlForPause) {
        deps.recordTranscriptTurn("user", userTurnText, {
          startMs: deps.getUserTurnStartMs() ?? deps.mediaStreamOffsetMs(),
          endMs: deps.mediaStreamOffsetMs(),
        });
        deps.setUserTurnStartMs(undefined);
        deps.setPendingUserTranscript("");
        deps.sessionDump.event("gemini.customer_pause_held", {
          userText: userTurnText,
        });
        return;
      }
    }

    // Clarification gate still owns its multi-turn state machine.
    const semanticClassification = deps.semantic.classify(userTurnText);
    const trapDedupeKey = semanticClassification
      ? semanticTrapDedupeKey(semanticClassification.trapId, userTurnText)
      : "";
    const callConfig = deps.getCallConfig();
    const plan = planCustomerTurn({
      userText: userTurnText,
      lastAssistantText: deps.semantic.getLastAssistantTurnText(),
      source: "flush",
      hasLinkTool: Boolean(
        callConfig &&
          hasGupshupWhatsAppTemplateConfig(callConfig.userId) &&
          publicDemoWhatsAppAllowed(callConfig),
      ),
      customerName:
        callConfig?.customerContext?.displayName ||
        callConfig?.customerContext?.firstName,
      campaignLanguage: callConfig?.language,
      isPublicDemo: Boolean(callConfig?.isPublicDemo),
      activePersonaId: callConfig?.activePersonaId,
      callConfig: callConfig ?? undefined,
      callId: deps.getCallConfigId() ?? undefined,
    });

    const clarificationSent = semanticClassification?.needsClarification
      ? deps.semantic.requestClarification(userTurnText, semanticClassification, "flush")
      : false;

    const liveAlreadyHandled = Boolean(
      semanticClassification?.needsClarification &&
      !clarificationSent &&
      deps.semantic.getLiveClarificationKey() === trapDedupeKey,
    );

    if (
      deps.semantic.isAwaitingClarification() &&
      !clarificationSent &&
      !liveAlreadyHandled &&
      (semanticClassification?.needsClarification ?? true)
    ) {
      deps.semantic.bumpClarificationAttempts();
    }

    const flushDecision = evaluateSemanticTrapFlush({
      classification: semanticClassification,
      userText: userTurnText,
      liveClarificationKey: deps.semantic.getLiveClarificationKey(),
      trapDedupeKey,
      awaitingClarification: deps.semantic.isAwaitingClarification(),
      clarificationAttempts: deps.semantic.getClarificationAttempts(),
      clarificationSent,
      maxAttempts: MAX_SEMANTIC_CLARIFICATION_ATTEMPTS,
      controlIntent: plan.controlIntent ?? null,
    });

    switch (flushDecision.action) {
      case "clarification_sent":
      case "live_already_handled":
        deps.recordTranscriptTurn("user", userTurnText, {
          startMs: deps.getUserTurnStartMs() ?? deps.mediaStreamOffsetMs(),
          endMs: deps.mediaStreamOffsetMs(),
        });
        deps.setUserTurnStartMs(undefined);
        if (flushDecision.action === "clarification_sent") {
          deps.releaseAwaitingCustomerResponse("semantic_clarification_pending");
        }
        deps.setPendingUserTranscript("");
        return;
      case "resolved_continue":
        deps.semantic.maybeResolve(userTurnText, semanticClassification, "flush");
        break;
      case "release_gate":
        deps.semantic.releaseGate(flushDecision.reason, userTurnText);
        break;
      case "release_gate_silent":
        deps.semantic.releaseGateSilently(flushDecision.reason, userTurnText);
        break;
      case "block_awaiting_user":
        deps.recordTranscriptTurn("user", userTurnText, {
          startMs: deps.getUserTurnStartMs() ?? deps.mediaStreamOffsetMs(),
          endMs: deps.mediaStreamOffsetMs(),
        });
        deps.setUserTurnStartMs(undefined);
        deps.setPendingUserTranscript("");
        return;
      case "continue":
        break;
    }

    // Gate paths that already sent the spoken instruction must not race a second
    // turn-plan instruction (double WHY). Silent control release still needs the plan.
    const skipPlanBecauseGateSpoke =
      flushDecision.action === "resolved_continue" ||
      flushDecision.action === "release_gate";
    // Live already applied this YES/NO — pending may still exist if consume failed;
    // never cut mid-pitch with a second semantic_resolution.
    const skipPlanBecauseLiveResolved =
      (plan.action === "semantic_yes" ||
        plan.action === "semantic_no" ||
        plan.action === "direct_answer") &&
      deps.semantic.wasDecisionResolutionAppliedFor(
        userTurnText,
        plan.semantic?.intent,
      );

    // One plan → one instruction + one cut (shared with live path).
    if (!skipPlanBecauseGateSpoke && !skipPlanBecauseLiveResolved) {
      const prevDedupe = deps.getTurnPlanDedupe();
      const nextDedupe = applyCustomerTurnPlan(
        {
          sessionDump: deps.sessionDump,
          tryClearAudiblePlayback: deps.tryClearAudiblePlayback,
          interruptCurrentModelAudio: deps.interruptCurrentModelAudio,
          clearModelAudioDropGuard: deps.clearModelAudioDropGuard,
          clearCustomerSpeechMute: deps.clearCustomerSpeechMute,
          activateCustomerPause: deps.activateCustomerPause,
          noteControlIntentSent: deps.noteControlIntentSent,
          markDecisionResolutionApplied: deps.markDecisionResolutionApplied,
          sendClientInstruction: deps.sendClientInstruction,
          protectAckUntil: deps.protectAckUntil,
          onHostWhatsAppSend: () => {
            const callId = deps.getCallConfigId() || deps.getCurrentCallUuid();
            const callConfig = deps.getCallConfig();
            if (!callId || !callConfig || !hasGupshupWhatsAppTemplateConfig(callConfig.userId)) return;
            if (!publicDemoWhatsAppAllowed(callConfig)) {
              console.warn(
                `[voice/gemini-live] host send_link skipped: public demo not routed yet callId=${callId}`,
              );
              return;
            }
            const started = hostSendWhatsAppLink({
              callId,
              callConfig,
              sessionDump: deps.sessionDump,
              sendClientInstruction: deps.sendClientInstruction,
            });
            if (started.ok) {
              console.log(
                `[voice/gemini-live] host send_link started token=${started.token} callId=${callId}`,
              );
            } else {
              console.warn(`[voice/gemini-live] host send_link skipped: ${started.message}`);
            }
          },
          queueOutboundMulaw: deps.queueOutboundMulaw
            ? (payload) => deps.queueOutboundMulaw!(payload)
            : undefined,
        },
        plan,
        userTurnText,
        prevDedupe,
        "flush",
      );
      deps.setTurnPlanDedupe(nextDedupe);
    } else if (skipPlanBecauseLiveResolved) {
      console.log(
        `[voice/gemini-live] flush skipped turn plan (live already resolved) action=${plan.action}`,
      );
      deps.sessionDump.event("gemini.turn_plan_skipped_live_resolved", {
        action: plan.action,
        userText: userTurnText,
      });
    }

    const now = Date.now();
    const recentUserBargeIn = now - deps.getLastUserBargeInAtMs() < POST_INTERRUPT_ANSWER_WINDOW_MS;
    const substantiveInterrupt = recentUserBargeIn && deps.isSubstantiveUserInterrupt(userTurnText);
    const agentAlreadyResponded = deps.getOutputTranscriptBuffer().trim().length > 0;
    const planHandled =
      skipPlanBecauseGateSpoke ||
      skipPlanBecauseLiveResolved ||
      plan.action !== "none" ||
      Boolean(plan.instruction);

    if (!planHandled) {
      if (deps.semantic.shouldSendPostClosingThanks(userTurnText)) {
        deps.semantic.sendPostClosingThanksInstruction(userTurnText);
        deps.sessionDump.event("gemini.unplanned_turn_handled", {
          reason: "post_closing_thanks",
          source: "flush_pending_user_transcript",
          userText: userTurnText,
        });
      } else if (substantiveInterrupt && !agentAlreadyResponded) {
        deps.clearPostBargeInNudge("answered_on_flush");
        deps.sendPostInterruptAnswerNudge(userTurnText);
        deps.sessionDump.event("gemini.unplanned_turn_handled", {
          reason: "post_interrupt_answer",
          source: "flush_pending_user_transcript",
          userText: userTurnText,
        });
      } else if (substantiveInterrupt && agentAlreadyResponded) {
        deps.clearPostBargeInNudge("agent_already_answered_interrupt");
        deps.sessionDump.event("gemini.unplanned_turn_handled", {
          reason: "agent_already_answered_interrupt",
          source: "flush_pending_user_transcript",
          userText: userTurnText,
        });
      }
    } else if (substantiveInterrupt && agentAlreadyResponded) {
      deps.clearPostBargeInNudge("agent_already_answered_interrupt");
    }

    deps.recordTranscriptTurn("user", userTurnText, {
      startMs: deps.getUserTurnStartMs() ?? deps.mediaStreamOffsetMs(),
      endMs: deps.mediaStreamOffsetMs(),
    });
    deps.setUserTurnStartMs(undefined);
    deps.releaseAwaitingCustomerResponse("user_turn_flushed");
    const currentCallUuid = deps.getCurrentCallUuid();
    const midCallConfig = callConfig ?? deps.getCallConfig();
    if (
      currentCallUuid &&
      midCallConfig &&
      !deps.semantic.isAwaitingClarification() &&
      !deps.semantic.isHighStakesWorkflowBlocked()
    ) {
      void maybeTriggerMidCallWorkflowActions({
        callId: currentCallUuid,
        role: "user",
        text: userTurnText,
        callConfig: midCallConfig,
      }).then((result) => {
        if (result.disconnectCall) {
          deps.scheduleAgentDisconnect(
            userTurnText,
            result.disconnectReason || "workflow_disconnect_user_turn",
          );
        }
      }).catch((error) => {
        console.error("[voice/gemini-live] mid-call user action failed:", error);
      });
    }
    // Only schedule a delayed nudge when the agent has not already spoken for this interrupt.
    if (!(substantiveInterrupt && agentAlreadyResponded) && !planHandled) {
      deps.schedulePostBargeInNudge(userTurnText);
    }
    deps.setPendingUserTranscript("");
  }

  return { flushPendingUserTranscript };
}
