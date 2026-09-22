import { WebSocket } from "ws";
import type { CallConfig } from "./voice-call-state";
import type { VoiceSessionDumpLogger } from "./voice-debug-dump";
import type { OutboundAudioController } from "./plivo-gemini-live-outbound-controller";
import type { SemanticController } from "./plivo-gemini-live-semantic-controller";
import { geminiPcm16ToPlivoMulaw } from "./telephony-audio";
import { emitVoiceLifecycle } from "./voice-events";
import { shouldEndCallAfterAssistantTurn } from "./voice-call-disconnect";
import { getCampaign } from "./voice-campaign-store";
import { maybeTriggerMidCallWorkflowActions } from "./voice-midcall-actions";
import { isSemanticInstructionReason } from "./voice-semantic-trap-session";
import { normalizeTranscriptText } from "./plivo-gemini-live-text-utils";
import {
  buildPitchContinuationInstruction,
  buildSemanticContinuationInstruction,
  detectRuntimeControlIntent,
  isIncompletePitchFragment,
  isIncompleteSemanticReply,
  isLikelyNoiseTranscript,
  isLikelyNonAddressedAmbientTranscript,
  isLowSignalTranscript,
  isOutOfDomainTranscript,
  lastAssistantAskedQuestion,
  looksLikeAssistantEchoInUserTranscript,
  looksLikeDuplicateAssistantRestate,
  mergeIncrementalTranscript,
  shouldArmAmbientModelAudioDrop,
  shouldCutAssistantPitchRestart,
  shouldProtectPitchPlayback,
  shouldResumeFromUserSpeech,
  stripUserCrosstalkFromAssistant,
  type RuntimeControlIntent,
} from "./plivo-gemini-live-transcript-guards";
import {
  applyCustomerTurnPlan,
  applySuppressedTurnPlan,
  isRedundantLiveTurnPlan,
  planCustomerTurn,
} from "./plivo-gemini-live-turn-planner";
import { hostSendWhatsAppLink } from "./plivo-gemini-live-send-link";
import { hasGupshupWhatsAppTemplateConfig } from "../features/integrations/server/providers/gupshup/whatsapp-client";
import { publicDemoWhatsAppAllowed } from "./public-demo-route";
import {
  arrayValue,
  boolValue,
  objectValue,
  outputAudioRate,
  parseEvent,
  sendJson,
  stringValue,
} from "./plivo-gemini-live-ws-utils";
import {
  extractModelAudio,
  hasMeaningfulUserSpeechInput,
} from "./plivo-gemini-live-stream-utils";
import {
  DETECT_AUTOMATED_SCREENING,
  STORE_REALTIME_TRANSCRIPT,
  redundantTurnPlanSuppressionEnabled,
  seedTurnsEnabled,
} from "./plivo-gemini-live-config";

/**
 * Reason the model's audio is currently being dropped/suppressed rather than
 * forwarded to Plivo. Mirrors the union owned by plivo-gemini-live-stream.ts.
 */
export type ModelAudioDropReason =
  | "interrupt"
  | "screening"
  | "control_intent"
  | "semantic_trap"
  | "assistant_pitch_restart"
  | "ambient_noise";

/**
 * Everything the Gemini `message` handler needs from the owning stream
 * session. The stream keeps a large amount of per-call mutable state as
 * plain `let` locals (shared with the Plivo-side handler, `closeBoth`,
 * timers, etc). Rather than hoisting all of that into this module, we expose
 * it here via get/set accessor pairs that close over the *same* bindings
 * back in plivo-gemini-live-stream.ts — so mutations made from this handler
 * are immediately visible to the rest of the stream, and vice versa. State
 * and behavior that's already encapsulated elsewhere (the semantic trap
 * gate, the outbound audio controller) is passed through as a single
 * object instead of being re-exposed field by field. Actions that already
 * encapsulate meaningful stream-owned logic (instruction dispatch,
 * barge-in, transcript flushing, disconnect scheduling,
 * etc) are passed through as callbacks instead of being reimplemented here.
 */
export interface GeminiHandlerDeps {
  /** Stable WebSocket reference for this Gemini session (== activeGeminiWs). */
  geminiSocket: WebSocket;
  sessionDump: VoiceSessionDumpLogger;
  callId: string | undefined;
  connectedAt: number;
  callConfig: CallConfig;
  /** Whether this session claimed a prewarmed Gemini socket. */
  prewarmed: boolean;
  /** True when the session was (re)started with the minimal setup payload —
   *  seed turns are skipped there to keep the retry surface minimal. */
  minimalSetup: boolean;
  outbound: OutboundAudioController;
  semantic: SemanticController;

  getSetupComplete(): boolean;
  setSetupComplete(value: boolean): void;

  getPendingUserTranscript(): string;
  setPendingUserTranscript(value: string): void;
  getPendingUserTranscriptAcousticallyVerified?(): boolean;
  setPendingUserTranscriptAcousticallyVerified?(value: boolean): void;

  getLastMeaningfulUserSpeechAtMs(): number;
  setLastMeaningfulUserSpeechAtMs(value: number): void;

  getAssistantTurnStartMs(): number | undefined;
  setAssistantTurnStartMs(value: number | undefined): void;

  getUserTurnBargeInGraceUntilMs(): number;

  getAwaitingCustomerResponse(): boolean;
  setAwaitingCustomerResponse(value: boolean): void;

  getDropModelAudioUntilTurnComplete(): boolean;
  setDropModelAudioUntilTurnComplete(value: boolean): void;

  getModelAudioDropReason(): ModelAudioDropReason | undefined;
  setModelAudioDropReason(value: ModelAudioDropReason | undefined): void;

  getOutputTranscriptBuffer(): string;
  setOutputTranscriptBuffer(value: string): void;
  /**
   * Assistant text for a turn that was cut, taken from the live buffer or from
   * the snapshot the clear paths leave behind. Consumes it, so one interrupted
   * turn is recorded once.
   */
  takeInterruptedAssistantText(): string;

  getScreeningReplyQueued(): boolean;
  setScreeningReplyQueued(value: boolean): void;

  getCustomerPauseActive(): boolean;
  setCustomerPauseActive(value: boolean): void;

  getCustomerPauseAckPending(): boolean;
  setCustomerPauseAckPending(value: boolean): void;

  getOpeningTurnComplete(): boolean;
  getFirstResponseRequested(): boolean;

  getUserTurnStartMs(): number | undefined;
  setUserTurnStartMs(value: number | undefined): void;


  getVoiceModelStartMs(): number | undefined;
  setVoiceModelStartMs(value: number | undefined): void;

  getVoiceLastSpeechFrameMs(): number | null;
  setVoiceEouProxyMs(value: number | null): void;

  getSuppressedModelAudioDropReason(): string | undefined;
  setSuppressedModelAudioDropReason(value: string | undefined): void;

  getSuppressedModelAudioDropChunks(): number;
  setSuppressedModelAudioDropChunks(value: number): void;

  getOutboundAudioChunks(): number;
  setOutboundAudioChunks(value: number): void;

  getVoiceFirstAudioOutMs(): number | undefined;
  setVoiceFirstAudioOutMs(value: number | undefined): void;

  getLastInstruction(): string;
  getLastInstructionReason(): string;
  clearLastInstructionOwnership(reason?: string): void;
  shouldPreserveOwnershipOnDrop(droppedReason: string): boolean;
  noteAssistantAnsweredAfterBargeIn(said: string): void;
  getLastPlaybackCutAtMs(): number;
  isAckProtected(nowMs?: number): boolean;
  protectAckUntil(untilMs: number): void;

  noteControlIntentSent(intent: RuntimeControlIntent): void;
  activateCustomerPause(): void;
  getCallerAudioEnabled(): boolean;
  getCurrentCallUuid(): string | undefined;

  // ── Stream-owned actions (kept in plivo-gemini-live-stream.ts; passed
  //    through so their logic/state stays in one place). ──────────────────
  requestFirstResponse(): void;
  sendClientInstruction(
    text: string,
    reason?: string,
    options?: { deferUntilIdle?: boolean },
  ): void;
  interruptCurrentModelAudio(reason: string, details?: Record<string, unknown>): void;
  clearModelAudioDropGuard(reason: string): void;
  isCustomerSpeechMuteActive(): boolean;
  clearCustomerSpeechMute(reason: string): void;
  armCustomerSpeechMute?(reason: string): void;
  /** Resume after barge-in with no usable customer transcript (prevents dry calls). */
  recoverFromEmptyBargeIn?(reason: string): void;
  /** True while empty-barge-in recovery must not be ambient-dropped. */
  isBargeInRecoveryProtected?(): boolean;
  /** ASR produced words the guards discarded — a human spoke, content unknown. */
  noteRejectedSpeech?(nowMs?: number): void;
  /** Local VAD opened a real caller activity window around this transcript. */
  hasRecentUserActivityEvidence?(nowMs?: number): boolean;
  /** Duplex candidate evidence survived the absolute acoustic speech bars. */
  hasRecentBargeInCandidateEvidence?(nowMs?: number): boolean;
  /** Gemini began producing a response for the verified caller activity. */
  resolveUserActivityResponse?(reason: string): void;
  sendPostInterruptAnswerNudge?(userTurnText: string): void;
  /** Unified cut with shared cooldown — prefer this over clearAudibleModelAudio for barge-in paths. */
  tryClearAudiblePlayback(reason: string, details?: Record<string, unknown>): boolean;
  clearAudibleModelAudio(reason: string, details?: Record<string, unknown>): void;
  markLocalCallerSpeech(now?: number, shouldDuckPlayback?: boolean): void;
  armPostUserTurnBargeInGrace(now?: number): void;
  sendResumeFromPauseInstruction(source: "live" | "flush", userText: string): void;
  sendControlIntentInstruction(
    intent: RuntimeControlIntent,
    sourceText: string,
    source: "live" | "flush",
  ): boolean;
  releaseAwaitingCustomerResponse(reason: string): void;
  handleAutomatedScreeningInput(inputText: string): void;
  localPlaybackDuckActive(): boolean;
  localCallerSpeechActive(): boolean;
  flushSuppressedModelAudioDropLog(): void;
  streamOffsetMs(): number;
  armOpeningBargeInWindow(): void;
  queuePlivoMulaw(payload: string): void;
  flushVoiceTurn(turnCompleteMs: number): void;
  flushPendingUserTranscript(): void;
  flushPendingRealtimeInstructions(reason: string): void;
  sendAutomatedScreeningReply(): void;
  flushOutboundRemainder(): void;
  clearPlivoAudio(reason?: string): void;
  recordTranscriptTurn(
    role: "assistant" | "user",
    text: string,
    timing?: { startMs?: number; endMs?: number },
  ): void;
  scheduleAgentDisconnect(triggerText: string, reason: string): void;
  markOpeningTurnComplete(): void;
  agentAudioLikelyActive(): boolean;
  /** Actual outbound queue/playout state, excluding model-turn bookkeeping. */
  agentAudioAudible(): boolean;
  armCallerIdlePrompt(reason: string): void;
  cancelCallerIdlePrompt(reason: string): void;

  /** Shared with flush so live+flush do not double-apply the same plan. */
  getTurnPlanDedupe(): { fingerprint: string; atMs: number };
  setTurnPlanDedupe(value: { fingerprint: string; atMs: number }): void;
}

function hostSendLinkFromDeps(deps: GeminiHandlerDeps): void {
  const callId = deps.callId || deps.getCurrentCallUuid();
  const callConfig = deps.callConfig;
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
}

function applyLiveCustomerTurnPlan(
  deps: GeminiHandlerDeps,
  plan: Parameters<typeof applyCustomerTurnPlan>[1],
  userText: string,
  acousticallyVerified: boolean,
  interruptedAudiblePlayback = false,
): void {
  // Latency: injecting an instruction here restarts Gemini's in-flight turn and
  // costs ~850ms of voice-to-voice. Skip the ones that only restate what the
  // model would do anyway — the utterance is still consumed below so flush does
  // not re-plan it later.
  if (
    redundantTurnPlanSuppressionEnabled() &&
    isRedundantLiveTurnPlan(plan, {
      // A hard cut makes the outbound queue look idle before planning. Preserve
      // the pre-cut fact that the customer interrupted audible speech, or a
      // semantic yes/no plan is incorrectly suppressed as "redundant".
      agentAudioActive: deps.agentAudioAudible() || interruptedAudiblePlayback,
      awaitingSemanticClarification: deps.semantic.isAwaitingClarification(),
    })
  ) {
    // Still performs the plan's gate-clearing / decision bookkeeping — only the
    // instruction is skipped. See applySuppressedTurnPlan.
    applySuppressedTurnPlan(
      {
        sessionDump: deps.sessionDump,
        tryClearAudiblePlayback: deps.tryClearAudiblePlayback,
        interruptCurrentModelAudio: deps.interruptCurrentModelAudio,
        clearModelAudioDropGuard: deps.clearModelAudioDropGuard,
        clearCustomerSpeechMute: deps.clearCustomerSpeechMute,
        activateCustomerPause: deps.activateCustomerPause,
        noteControlIntentSent: deps.noteControlIntentSent,
        markDecisionResolutionApplied: (text, semantic, src) =>
          deps.semantic.markDecisionResolutionApplied(text, semantic, src),
        sendClientInstruction: deps.sendClientInstruction,
        protectAckUntil: deps.protectAckUntil,
      },
      plan,
      userText,
      "live",
    );
    if (acousticallyVerified || hasMeaningfulUserSpeechInput(userText)) {
      deps.recordTranscriptTurn("user", userText, {
        startMs: deps.getUserTurnStartMs() ?? deps.streamOffsetMs(),
        endMs: deps.streamOffsetMs(),
      });
    }
    deps.setPendingUserTranscript("");
    deps.setUserTurnStartMs(undefined);
    return;
  }

  const prevDedupe = deps.getTurnPlanDedupe();
  const next = applyCustomerTurnPlan(
    {
      sessionDump: deps.sessionDump,
      tryClearAudiblePlayback: deps.tryClearAudiblePlayback,
      interruptCurrentModelAudio: deps.interruptCurrentModelAudio,
      clearModelAudioDropGuard: deps.clearModelAudioDropGuard,
      clearCustomerSpeechMute: deps.clearCustomerSpeechMute,
      activateCustomerPause: deps.activateCustomerPause,
      noteControlIntentSent: deps.noteControlIntentSent,
      markDecisionResolutionApplied: (text, semantic, source) =>
        deps.semantic.markDecisionResolutionApplied(text, semantic, source),
      sendClientInstruction: deps.sendClientInstruction,
      protectAckUntil: deps.protectAckUntil,
      onHostWhatsAppSend: () => hostSendLinkFromDeps(deps),
      queueOutboundMulaw: (payload) => deps.queuePlivoMulaw(payload),
    },
    plan,
    userText,
    prevDedupe,
    "live",
  );
  deps.setTurnPlanDedupe(next);

  const appliedNewPlan =
    next.fingerprint !== prevDedupe.fingerprint || next.atMs !== prevDedupe.atMs;
  // Live already owned this utterance. Clear pending so assistant turnComplete
  // flush cannot re-fire the same YES ~15–30s later and ClearedAudio mid-pitch.
  if (
    appliedNewPlan &&
    plan.instruction &&
    (plan.action === "semantic_yes" ||
      plan.action === "semantic_no" ||
      plan.action === "direct_answer")
  ) {
    if (acousticallyVerified || hasMeaningfulUserSpeechInput(userText)) {
      deps.recordTranscriptTurn("user", userText, {
        startMs: deps.getUserTurnStartMs() ?? deps.streamOffsetMs(),
        endMs: deps.streamOffsetMs(),
      });
    }
    deps.setPendingUserTranscript("");
    deps.setUserTurnStartMs(undefined);
    console.log(
      `[voice/gemini-live] live consumed user turn (flush will no-op) action=${plan.action}`,
    );
    deps.sessionDump.event("gemini.live_consumed_user_turn", {
      action: plan.action,
      instructionReason: plan.instructionReason,
      userText,
    });
    // The user-activity recovery timer is a safety net for "the caller spoke and
    // NOTHING came back". Once a turn plan has been dispatched for their words,
    // that premise is false — we heard them, and we have told the model exactly
    // what to answer. Until 2026-07-29 the timer only ever cancelled on model
    // OUTPUT, so a plan that took longer than 3.5s to produce audio still ate a
    // "did not come through clearly" injection on top of a perfectly good answer.
    //
    // Confirmed on call 1rerq: the customer asked "can you explain this to me
    // like I am 5 year old person?", the planner correctly dispatched a
    // direct_answer at 65423ms, the transcript landed at 65483ms — and at
    // 65732ms the timer fired anyway and overrode it. The agent replied "I'm
    // sorry, I couldn't understand that." to a question it had understood fine.
    //
    // The model failing to speak at all is still covered: caller-idle prompting
    // arms on assistant_turn_complete with its own 5s budget.
    deps.resolveUserActivityResponse?.("turn_plan_dispatched");
  }

  // Long barge-in with plan=none used to leave customer-speech-mute on forever
  // (free-wheel audio dropped → dead silence). Force an answer nudge.
  if (
    deps.isCustomerSpeechMuteActive() &&
    (acousticallyVerified || hasMeaningfulUserSpeechInput(userText)) &&
    (plan.action === "none" || !plan.instruction)
  ) {
    deps.sendPostInterruptAnswerNudge?.(userText);
  }
}

/**
 * Builds the handler for the Gemini Live `message` event. The caller is
 * responsible for the `geminiWs !== activeGeminiWs` staleness guard — this
 * function assumes it is only ever invoked for the currently-active socket.
 */
export function createGeminiMessageHandler(
  deps: GeminiHandlerDeps,
): (data: WebSocket.RawData) => void {
  /** Cap soft restart ↔ continuation nudges so a stuck model cannot loop. */
  let pitchContinuationNudges = 0;
  const MAX_PITCH_CONTINUATION_NUDGES = 2;

  function maybeRequestPitchContinuation(
    alreadySaid: string,
    source: string,
  ): boolean {
    if (!alreadySaid || !isIncompleteSemanticReply(alreadySaid)) return false;
    if (pitchContinuationNudges >= MAX_PITCH_CONTINUATION_NUDGES) {
      deps.sessionDump.event("gemini.pitch_continuation_capped", {
        text: alreadySaid,
        source,
        nudges: pitchContinuationNudges,
      });
      return false;
    }
    pitchContinuationNudges += 1;
    deps.semantic.allowSemanticAgentTurn();
    // Do not inject a hardcoded top-up pitch remainder — continue the Campaign script.
    const instruction = isIncompletePitchFragment(alreadySaid)
      ? buildPitchContinuationInstruction(alreadySaid)
      : buildSemanticContinuationInstruction(alreadySaid);
    deps.sendClientInstruction(instruction, "pitch_continuation");
    deps.protectAckUntil(Date.now() + 1200);
    deps.sessionDump.event("gemini.pitch_continuation_requested", {
      text: alreadySaid,
      source,
      nudge: pitchContinuationNudges,
      mode: isIncompletePitchFragment(alreadySaid) ? "pitch_remainder" : "semantic_continue",
    });
    return true;
  }

  return function handleGeminiMessage(data: WebSocket.RawData): void {
    const event = parseEvent(data);
    if (!event) return;

    if (event.error) {
      console.error("[voice/gemini-live] Gemini error:", JSON.stringify(event.error));
      deps.sessionDump.event("gemini.error", {
        error: event.error,
      });
      return;
    }

    if (event.setupComplete) {
      deps.setSetupComplete(true);
      console.log(`[voice/gemini-live] setup complete t=+${Date.now() - deps.connectedAt}ms`);
      deps.sessionDump.event("gemini.setup_complete", {
        elapsedMs: Date.now() - deps.connectedAt,
      });
      // U2: setup-complete lifecycle event with prewarmed flag (R1).
      if (deps.callId) {
        emitVoiceLifecycle("voice_setup_complete", { prewarmed: deps.prewarmed }, deps.callId, "gemini_live");
      }
      // Seed style-demonstration turns BEFORE the opening instruction.
      // turnComplete MUST stay false — true makes Gemini start generating
      // before the opening instruction arrives (ordering is load-bearing).
      // Raw sendJson on purpose: the instruction controller gates on
      // awaitingCustomerResponse and would hold these back. Skipped in
      // minimal-setup retry mode.
      if (!deps.minimalSetup && seedTurnsEnabled() && deps.callConfig.seedTurns?.length) {
        sendJson(deps.geminiSocket, {
          clientContent: {
            turns: deps.callConfig.seedTurns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
            turnComplete: false,
          },
        });
        deps.sessionDump.event("gemini.seed_turns_sent", {
          count: deps.callConfig.seedTurns.length,
          path: "setup",
        });
      }
      deps.requestFirstResponse();
      return;
    }

    if (event.goAway) {
      console.log(`[voice/gemini-live] goAway ${JSON.stringify(event.goAway)}`);
      deps.sessionDump.event("gemini.go_away", {
        goAway: event.goAway,
      });
    }

    const toolCallEvent = objectValue(event.toolCall);
    if (toolCallEvent) {
      const capturedCallId = deps.getCurrentCallUuid();
      const capturedConfig = deps.callConfig;
      const capturedGeminiWs = deps.geminiSocket;
      void (async () => {
        const calls = arrayValue(toolCallEvent.functionCalls);
        const responses: Array<{ id: string; name: string; response: Record<string, unknown>; scheduling?: string }> = [];
        for (const call of calls) {
          const fnName = stringValue(call.name) ?? "";
          const fnId = stringValue(call.id) ?? "";
          if (fnName === "send_link" && capturedConfig && hasGupshupWhatsAppTemplateConfig(capturedConfig.userId) && capturedCallId) {
            const started = hostSendWhatsAppLink({
              callId: capturedCallId,
              callConfig: capturedConfig,
              sessionDump: deps.sessionDump,
              sendClientInstruction: deps.sendClientInstruction,
            });
            // SILENT: ack immediately; delivery confirmation arrives later via
            // hostSendWhatsAppLink's deferred instruction.
            if (started.ok) {
              responses.push({
                id: fnId,
                name: fnName,
                scheduling: "SILENT",
                response: {
                  sent: true,
                  message:
                    "Send initiated. Do NOT tell the customer the link has been sent yet — continue the conversation naturally. You will receive a system notice once delivery is confirmed; only then mention the link.",
                },
              });
            } else {
              responses.push({
                id: fnId,
                name: fnName,
                response: { sent: false, message: started.message },
              });
            }
          } else {
            responses.push({ id: fnId, name: fnName, response: { error: `Unknown tool: ${fnName}` } });
          }
        }
        sendJson(capturedGeminiWs, {
          toolResponse: {
            functionResponses: responses.map(r => ({ id: r.id, name: r.name, response: r.response, ...(r.scheduling ? { scheduling: r.scheduling } : {}) })),
          },
        });
      })().catch(err => console.error("[voice/gemini-live] toolCall handler error:", err));
      return;
    }

    const serverContent = objectValue(event.serverContent);
    if (boolValue(serverContent?.interrupted)) {
      const now = Date.now();
      const pendingUserTranscript = deps.getPendingUserTranscript();
      const meaningfulPending =
        (deps.getPendingUserTranscriptAcousticallyVerified?.() ?? false) ||
        hasMeaningfulUserSpeechInput(pendingUserTranscript);
      const recentMeaningfulSpeech = now - deps.getLastMeaningfulUserSpeechAtMs() <= 900;
      const localSpeech = deps.localCallerSpeechActive();
      // Control intents must cut even under pitch/ack shields.
      const intentBypass =
        meaningfulPending && Boolean(detectRuntimeControlIntent(pendingUserTranscript));
      // Energy-first: Gemini often fires interrupted before ASR text lands.
      // Requiring transcript+energy agreement made barge-in feel broken.
      const shouldTreatAsRealBargeIn =
        localSpeech ||
        intentBypass ||
        (meaningfulPending && recentMeaningfulSpeech);
      const withinPostUserTurnGrace = now < deps.getUserTurnBargeInGraceUntilMs();
      const awaitingCustomerResponse = deps.getAwaitingCustomerResponse();
      const dropModelAudioUntilTurnComplete = deps.getDropModelAudioUntilTurnComplete();
      const pitchProtected = shouldProtectPitchPlayback({
        lastAssistantText: deps.semantic.getLastAssistantTurnText(),
        currentOutputBuffer: deps.getOutputTranscriptBuffer(),
      });
      if (
        awaitingCustomerResponse &&
        !pendingUserTranscript.trim() &&
        !deps.localPlaybackDuckActive() &&
        !localSpeech
      ) {
        // Still waiting for a transcript and no local speech energy — ignore
        // Gemini false interrupts from free-wheel. When local VAD hears speech,
        // honor the interrupt so ASR can finish.
        console.log("[voice/gemini-live] ignoring interrupt while waiting for customer response");
        deps.sessionDump.event("gemini.interrupt_ignored_waiting_for_customer", {
          barge_in_reason: "awaiting_idle",
        });
      } else if (
        awaitingCustomerResponse &&
        !pendingUserTranscript.trim() &&
        (localSpeech || deps.localPlaybackDuckActive())
      ) {
        // Customer is speaking while we drop free-wheel — honor Gemini's interrupt
        // so the user turn can finalize into a CALLER transcript.
        deps.armCustomerSpeechMute?.("gemini_interrupted_awaiting_speech");
        deps.interruptCurrentModelAudio("gemini_interrupted_awaiting_speech", {
          awaitingCustomerResponse,
          localSpeech,
          barge_in_reason: "awaiting_customer_speech",
        });
        console.log(
          "[voice/gemini-live] honoring interrupt — customer speech while awaiting response",
        );
        deps.sessionDump.event("gemini.interrupted", {
          awaitingCustomerResponse,
          barge_in_reason: "awaiting_customer_speech",
        });
      } else if (withinPostUserTurnGrace && !meaningfulPending && !localSpeech) {
        deps.sessionDump.event("gemini.interrupt_ignored_post_user_grace", {
          msRemaining: deps.getUserTurnBargeInGraceUntilMs() - now,
        });
      } else if (deps.semantic.isAgentTurnBargeInProtected() && !intentBypass) {
        deps.sessionDump.event("gemini.interrupt_ignored_agent_turn_protected", {
          msUntilProtectionEnds: deps.semantic.getAgentTurnBargeInProtectedUntilMs() - now,
          semanticAgentTurnAllowed: deps.semantic.isAgentTurnAllowed(),
        });
      } else if ((deps.isAckProtected(now) || pitchProtected) && !intentBypass && !localSpeech) {
        // Echo-only interrupts stay blocked under ack/pitch. Real local speech
        // or a control transcript must still cut.
        deps.sessionDump.event("gemini.interrupt_ignored_ack_protected", {
          lastInstructionReason: deps.getLastInstructionReason(),
          pitchProtected,
        });
      } else if (dropModelAudioUntilTurnComplete) {
        deps.sessionDump.event("gemini.interrupt_ignored_existing_drop_guard", {
          activeDropReason: deps.getModelAudioDropReason() ?? "unknown",
        });
      } else if (!shouldTreatAsRealBargeIn) {
        deps.sessionDump.event("gemini.interrupt_ignored_low_confidence", {
          pendingUserTranscript,
          msSinceMeaningfulSpeech: now - deps.getLastMeaningfulUserSpeechAtMs(),
          localSpeech,
        });
      } else {
        // interruptCurrentModelAudio sets the drop guard + clears playback.
        // tryClearAudiblePlayback alone is insufficient (no drop guard).
        deps.armCustomerSpeechMute?.("gemini_interrupted");
        deps.interruptCurrentModelAudio("gemini_interrupted", {
          awaitingCustomerResponse,
          hasPendingUserTranscript: Boolean(pendingUserTranscript.trim()),
          barge_in_reason: awaitingCustomerResponse ? "awaiting_but_speaking" : "server_interrupt",
        });
        console.log("[voice/gemini-live] interrupted current model audio");
        deps.sessionDump.event("gemini.interrupted", {
          awaitingCustomerResponse,
          hasPendingUserTranscript: Boolean(pendingUserTranscript.trim()),
          barge_in_reason: awaitingCustomerResponse ? "awaiting_but_speaking" : "server_interrupt",
        });
      }
    }

    const inputTranscription = objectValue(serverContent?.inputTranscription);
    const inputText = stringValue(inputTranscription?.text);
    const normalizedInputText = inputText ? normalizeTranscriptText(inputText) : "";
    if (normalizedInputText) {
      const acousticallyVerified =
        (deps.getPendingUserTranscriptAcousticallyVerified?.() ?? false) ||
        (deps.hasRecentUserActivityEvidence?.() ?? false);
      const duplexCandidateEvidence =
        deps.hasRecentBargeInCandidateEvidence?.() ?? false;
      const assistantAudibleAtTranscript = deps.agentAudioAudible();
      const mayDropAmbientAudio = () =>
        shouldArmAmbientModelAudioDrop({
          muteActive: deps.isCustomerSpeechMuteActive(),
          recoveryProtected: deps.isBargeInRecoveryProtected?.(),
          awaitingCustomer: deps.getAwaitingCustomerResponse(),
          lastAssistantText: deps.semantic.getLastAssistantTurnText(),
          msSinceMeaningfulUserSpeech:
            deps.getLastMeaningfulUserSpeechAtMs() > 0
              ? Date.now() - deps.getLastMeaningfulUserSpeechAtMs()
              : undefined,
        });

      // Speakerphone / full-duplex often echoes the agent's pitch into input ASR
      // ("Aapka loan recently disburse hua tha" while agent is mid-pitch).
      if (
        looksLikeAssistantEchoInUserTranscript(
          normalizedInputText,
          deps.semantic.getLastAssistantTurnText(),
        ) ||
        looksLikeAssistantEchoInUserTranscript(
          normalizedInputText,
          deps.getOutputTranscriptBuffer(),
        )
      ) {
        deps.sessionDump.event("transcript.assistant_echo_ignored", {
          text: normalizedInputText,
          phase: "live",
        });
        return;
      }
      if (!acousticallyVerified && isOutOfDomainTranscript(normalizedInputText)) {
        deps.sessionDump.event("transcript.out_of_domain_ignored", {
          text: normalizedInputText,
          phase: "live",
        });
        // We are discarding the words, not the fact that words existed — noise
        // does not transcribe. Keeps the barge-in failsafe from concluding the
        // caller said nothing and resuming over them.
        deps.noteRejectedSpeech?.();
        deps.setPendingUserTranscript("");
        if (mayDropAmbientAudio()) {
          deps.interruptCurrentModelAudio("ambient_noise_out_of_domain", {
            text: normalizedInputText.slice(0, 240),
            phase: "live",
          });
        }
        return;
      }
      if (acousticallyVerified || hasMeaningfulUserSpeechInput(normalizedInputText)) {
        deps.setLastMeaningfulUserSpeechAtMs(Date.now());
        // Transcript-only signal can be delayed/noisy; keep speech-active bookkeeping,
        // but do not duck outbound audio based on transcript alone.
        deps.markLocalCallerSpeech(Date.now(), false);
        deps.armPostUserTurnBargeInGrace();
      }
      const mergedUserTranscript = mergeIncrementalTranscript(deps.getPendingUserTranscript(), normalizedInputText);
      const awaitingCustomerResponse = deps.getAwaitingCustomerResponse();
      if (
        !acousticallyVerified &&
        awaitingCustomerResponse &&
        isLowSignalTranscript(mergedUserTranscript)
      ) {
        console.log(`[voice/gemini-live] ignoring low-signal transcript while awaiting customer: "${mergedUserTranscript}"`);
        deps.sessionDump.event("transcript.noise_ignored", {
          text: mergedUserTranscript,
          phase: "awaiting_customer",
        });
        deps.setPendingUserTranscript("");
        // Never ambient-drop while awaiting an answer — that kills Gemini's
        // next reply and leaves the customer waiting (dry call after "समझ आ गया?").
      } else if (
        !acousticallyVerified &&
        (isLikelyNoiseTranscript(mergedUserTranscript) ||
          isLikelyNonAddressedAmbientTranscript(
            mergedUserTranscript,
            deps.semantic.getLastAssistantTurnText(),
          ))
      ) {
        const ambient =
          isLikelyNonAddressedAmbientTranscript(
            mergedUserTranscript,
            deps.semantic.getLastAssistantTurnText(),
          );
        deps.sessionDump.event("transcript.noise_ignored", {
          text: mergedUserTranscript,
          phase: ambient ? "live_non_addressed" : "live_noise",
        });
        deps.setPendingUserTranscript("");
        if (mayDropAmbientAudio()) {
          deps.interruptCurrentModelAudio(
            ambient ? "ambient_noise_non_addressed" : "ambient_noise_ignored",
            {
              text: mergedUserTranscript.slice(0, 240),
              phase: ambient ? "live_non_addressed" : "live_noise",
            },
          );
        }
      } else {
        deps.setPendingUserTranscript(mergedUserTranscript);
        if (acousticallyVerified) {
          deps.setPendingUserTranscriptAcousticallyVerified?.(true);
        }

        // Speech-first playback cut, independent of turn planning. By this
        // point explicit echo/noise guards have already rejected agent leakage.
        // A caller transcript received during real Plivo playout is therefore
        // a safe fallback when the adaptive energy gate missed the onset.
        const assistantLikelySpeakingNow = assistantAudibleAtTranscript;
        const pitchProtected = shouldProtectPitchPlayback({
          lastAssistantText: deps.semantic.getLastAssistantTurnText(),
          currentOutputBuffer: deps.getOutputTranscriptBuffer(),
        });
        const liveIntentBypass = Boolean(detectRuntimeControlIntent(mergedUserTranscript));
        const meaningfulLiveSpeech =
          acousticallyVerified || hasMeaningfulUserSpeechInput(mergedUserTranscript);
        const transcriptConfirmedDuringPlayback =
          assistantLikelySpeakingNow &&
          meaningfulLiveSpeech &&
          (duplexCandidateEvidence || !looksLikeAssistantEchoInUserTranscript(
            mergedUserTranscript,
            deps.semantic.getLastAssistantTurnText(),
          ));
        const recentAcousticPlaybackCut =
          acousticallyVerified &&
          Date.now() - deps.getLastPlaybackCutAtMs() <= 2_500;
        let interruptedAudiblePlayback = recentAcousticPlaybackCut;
        if (
          meaningfulLiveSpeech &&
          (deps.localCallerSpeechActive() || transcriptConfirmedDuringPlayback) &&
          (!deps.semantic.isAgentTurnBargeInProtected() || liveIntentBypass || transcriptConfirmedDuringPlayback) &&
          !deps.getDropModelAudioUntilTurnComplete() &&
          (!deps.isAckProtected() || liveIntentBypass || transcriptConfirmedDuringPlayback) &&
          (!pitchProtected || liveIntentBypass || transcriptConfirmedDuringPlayback) &&
          deps.getCallerAudioEnabled() &&
          assistantLikelySpeakingNow
        ) {
          const cutReason = transcriptConfirmedDuringPlayback
            ? "transcript_confirmed_barge_in"
            : "live_speech_cut";
          interruptedAudiblePlayback = true;
          // Hard interrupt — clear alone lets Gemini keep generating over the caller.
          deps.armCustomerSpeechMute?.(cutReason);
          deps.interruptCurrentModelAudio(cutReason, {
            userText: mergedUserTranscript,
            acousticCandidate: duplexCandidateEvidence,
            barge_in_reason: cutReason,
          });
          console.log(`[voice/gemini-live] cut agent playback for ${cutReason}`);
          deps.sessionDump.event("gemini.live_speech_playback_cut", {
            userText: mergedUserTranscript,
            acousticCandidate: duplexCandidateEvidence,
            barge_in_reason: cutReason,
          });
        }

        if (deps.getCustomerPauseActive()) {
          const controlForPause = detectRuntimeControlIntent(mergedUserTranscript);
          const isHoldReinforcement =
            controlForPause?.intent === "wait" || controlForPause?.intent === "stop";
          if (!isHoldReinforcement && shouldResumeFromUserSpeech(mergedUserTranscript)) {
            deps.setCustomerPauseActive(false);
            deps.setCustomerPauseAckPending(false);
            deps.sessionDump.event("gemini.customer_pause_released", {
              reason: "resume_by_speech_live",
              userText: mergedUserTranscript,
            });
            deps.sendResumeFromPauseInstruction("live", mergedUserTranscript);
          } else {
            deps.sessionDump.event("gemini.customer_pause_held", {
              userText: mergedUserTranscript,
            });
          }
        } else if (
          acousticallyVerified ||
          (!isLowSignalTranscript(mergedUserTranscript) &&
            (!isLikelyNoiseTranscript(mergedUserTranscript) ||
              Boolean(detectRuntimeControlIntent(mergedUserTranscript))))
        ) {
          const plan = planCustomerTurn({
            userText: mergedUserTranscript,
            lastAssistantText: deps.semantic.getLastAssistantTurnText(),
            source: "live",
            hasLinkTool: Boolean(
              deps.callConfig &&
                hasGupshupWhatsAppTemplateConfig(deps.callConfig.userId) &&
                publicDemoWhatsAppAllowed(deps.callConfig),
            ),
            customerName:
              deps.callConfig?.customerContext?.displayName ||
              deps.callConfig?.customerContext?.firstName,
            campaignLanguage: deps.callConfig?.language,
            isPublicDemo: Boolean(deps.callConfig?.isPublicDemo),
            activePersonaId: deps.callConfig?.activePersonaId,
            callConfig: deps.callConfig ?? undefined,
            // Must be the media-stream callId (vc-in-...), NOT Plivo CallUUID.
            callId: deps.callId,
          });
          const liveSemantic = deps.semantic.classifyLive(mergedUserTranscript);
          if (liveSemantic?.needsClarification) {
            deps.semantic.requestClarification(mergedUserTranscript, liveSemantic, "live");
          } else if (deps.semantic.isAwaitingClarification()) {
            // Control intents preempt the confirm gate — never race a fallback.
            if (plan.controlIntent) {
              deps.semantic.releaseGateSilently(`control_${plan.controlIntent}`, mergedUserTranscript);
              applyLiveCustomerTurnPlan(
                deps,
                plan,
                mergedUserTranscript,
                acousticallyVerified,
                interruptedAudiblePlayback,
              );
            } else {
              const resolved = deps.semantic.maybeResolve(mergedUserTranscript, liveSemantic);
              if (resolved) {
                // Same as semantic_yes live consume — flush must not re-open
                // high_stakes clarify on this utterance mid-resolution-pitch.
                if (
                  acousticallyVerified ||
                  hasMeaningfulUserSpeechInput(mergedUserTranscript)
                ) {
                  deps.recordTranscriptTurn("user", mergedUserTranscript, {
                    startMs: deps.getUserTurnStartMs() ?? deps.streamOffsetMs(),
                    endMs: deps.streamOffsetMs(),
                  });
                }
                deps.setPendingUserTranscript("");
                deps.setUserTurnStartMs(undefined);
                console.log(
                  `[voice/gemini-live] live consumed user turn (flush will no-op) action=semantic_trap_resolved`,
                );
                deps.sessionDump.event("gemini.live_consumed_user_turn", {
                  action: "semantic_trap_resolved",
                  userText: mergedUserTranscript,
                });
              }
              if (
                !resolved &&
                (plan.action === "semantic_yes" || plan.action === "semantic_no")
              ) {
                applyLiveCustomerTurnPlan(
                  deps,
                  plan,
                  mergedUserTranscript,
                  acousticallyVerified,
                  interruptedAudiblePlayback,
                );
              }
            }
          } else {
            // One plan → one instruction + one cut policy.
            applyLiveCustomerTurnPlan(
              deps,
              plan,
              mergedUserTranscript,
              acousticallyVerified,
              interruptedAudiblePlayback,
            );
          }
        }

        if (deps.getUserTurnStartMs() === undefined) {
          deps.setUserTurnStartMs(deps.streamOffsetMs());
        }
        // Ignore agent-echo ASR and barge-in-protected windows: clearing
        // awaiting here lets Gemini free-wheel a duplicate of the same reply.
        if (
          deps.getAwaitingCustomerResponse() &&
          !deps.agentAudioLikelyActive() &&
          !deps.semantic.isAgentTurnBargeInProtected() &&
          !looksLikeAssistantEchoInUserTranscript(
            normalizedInputText,
            deps.semantic.getLastAssistantTurnText(),
          )
        ) {
          deps.releaseAwaitingCustomerResponse("customer_speech_detected");
        }
        console.log(`[voice/gemini-live] 👤 CALLER: "${normalizedInputText}"`);
        deps.sessionDump.event("transcript.user", {
          text: normalizedInputText,
        });
        if (DETECT_AUTOMATED_SCREENING && deps.getOpeningTurnComplete()) {
          deps.handleAutomatedScreeningInput(deps.getPendingUserTranscript());
        }
      }
    }

    if (STORE_REALTIME_TRANSCRIPT) {
      const outputTranscription = objectValue(serverContent?.outputTranscription);
      const outputText = stringValue(outputTranscription?.text);
      if (
        outputText &&
        !deps.getDropModelAudioUntilTurnComplete() &&
        !deps.getAwaitingCustomerResponse() &&
        !deps.localPlaybackDuckActive() &&
        !deps.semantic.semanticAudioBlocked()
      ) {
        if (deps.getAssistantTurnStartMs() === undefined) {
          deps.setAssistantTurnStartMs(deps.streamOffsetMs());
        }
        const outputTranscriptBuffer = mergeIncrementalTranscript(deps.getOutputTranscriptBuffer(), outputText);
        deps.setOutputTranscriptBuffer(outputTranscriptBuffer);

        // Ride ack protection along with an incomplete funds pitch so echo
        // cannot chop mid-sentence after the initial 5.5s window expires.
        if (
          shouldProtectPitchPlayback({
            lastAssistantText: deps.semantic.getLastAssistantTurnText(),
            currentOutputBuffer: outputTranscriptBuffer,
          })
        ) {
          deps.protectAckUntil(Date.now() + 2500);
        }

        // Gemini often splits the funds pitch across turns and regenerates from
        // "आपका लोन…" on a free WHY(none) follow-up. Never cut while we are in
        // pitch_continuation — that response is supposed to finish the stub and
        // often regenerates from the short opener (cutting it causes stutter).
        const previousAssistant = deps.semantic.getLastAssistantTurnText();
        const instructionReason = deps.getLastInstructionReason();
        const unpromptedRestart = shouldCutAssistantPitchRestart({
          previous: previousAssistant,
          next: outputTranscriptBuffer,
          instructionReason,
        });
        if (unpromptedRestart && !deps.getDropModelAudioUntilTurnComplete()) {
          deps.interruptCurrentModelAudio("assistant_pitch_restart", {
            previous: previousAssistant.slice(0, 120),
            restart: outputTranscriptBuffer.slice(0, 120),
            instructionReason,
          });
          console.warn(
            `[voice/gemini-live] interrupted assistant pitch restart ` +
            `"${outputTranscriptBuffer.slice(0, 48)}${outputTranscriptBuffer.length > 48 ? "…" : ""}"`,
          );
          deps.sessionDump.event("gemini.assistant_pitch_restart_interrupted", {
            previous: previousAssistant,
            restart: outputTranscriptBuffer,
            instructionReason,
          });
        }

        if (!deps.getDropModelAudioUntilTurnComplete()) {
          deps.resolveUserActivityResponse?.("output_transcription");
        }

      }
    }

    const modelAudio = extractModelAudio(event);
    const holdGuardActive = deps.getCustomerPauseActive() && !deps.getCustomerPauseAckPending();
    // U2: freeze EOU at the FIRST model audio chunk of the turn — an
    // unconditional per-turn seam (KTD4 c.2). Fires even for dropped audio.
    if (modelAudio.length > 0 && deps.getVoiceModelStartMs() === undefined) {
      deps.setVoiceModelStartMs(deps.streamOffsetMs());
      deps.setVoiceEouProxyMs(deps.getVoiceLastSpeechFrameMs());
    }
    // Soft duck pauses the outbound pump (see barge-in controller) — do NOT
    // discard model chunks here or the agent stutters when duck ends.
    const semanticBlocked = deps.semantic.semanticAudioBlocked();
    const dropModelAudioUntilTurnComplete = deps.getDropModelAudioUntilTurnComplete();
    const awaitingCustomerResponse = deps.getAwaitingCustomerResponse();
    const customerSpeechMute = deps.isCustomerSpeechMuteActive();
    if (
      (dropModelAudioUntilTurnComplete ||
        awaitingCustomerResponse ||
        customerSpeechMute ||
        holdGuardActive ||
        semanticBlocked) &&
      modelAudio.length > 0
    ) {
      const reason = customerSpeechMute
        ? "customer-speech-mute"
        : semanticBlocked
        ? "awaiting-semantic-clarification"
        : awaitingCustomerResponse
        ? "awaiting-customer"
        : holdGuardActive
          ? "customer_pause_hold"
          : (deps.getModelAudioDropReason() ?? "interrupt-guard");
      if (deps.getSuppressedModelAudioDropReason() !== reason) {
        deps.flushSuppressedModelAudioDropLog();
        deps.setSuppressedModelAudioDropReason(reason);
      }
      deps.setSuppressedModelAudioDropChunks(deps.getSuppressedModelAudioDropChunks() + modelAudio.length);
    } else {
      deps.flushSuppressedModelAudioDropLog();
      if (modelAudio.length > 0) {
        deps.resolveUserActivityResponse?.("outbound_audio");
        deps.cancelCallerIdlePrompt("outbound_audio");
      }
      // The opening line has started reaching the customer — start the
      // protective barge-in window so they can interrupt the rest of it.
      if (deps.getFirstResponseRequested() && !deps.getOpeningTurnComplete() && modelAudio.length > 0) {
        deps.armOpeningBargeInWindow();
      }
      for (const chunk of modelAudio) {
        const payload = geminiPcm16ToPlivoMulaw(chunk.data, outputAudioRate(chunk.mimeType));
        const outboundAudioChunks = deps.getOutboundAudioChunks() + 1;
        deps.setOutboundAudioChunks(outboundAudioChunks);
        // U2: first outbound audio of this turn → response_lag anchor.
        if (deps.getVoiceFirstAudioOutMs() === undefined) deps.setVoiceFirstAudioOutMs(deps.streamOffsetMs());
        if (outboundAudioChunks <= 5 || outboundAudioChunks % 20 === 0) {
          console.log(
            `[voice/gemini-live] audio chunk out #${outboundAudioChunks}` +
              ` inChars=${chunk.data.length} mime=${chunk.mimeType ?? "(missing)"} plivoChars=${payload.length}`,
          );
          deps.sessionDump.event("gemini.audio_chunk_out", {
            index: outboundAudioChunks,
            inputChars: chunk.data.length,
            mimeType: chunk.mimeType,
            plivoChars: payload.length,
          });
        }
        deps.queuePlivoMulaw(payload);
      }
    }

    if (boolValue(serverContent?.turnComplete)) {
      deps.flushSuppressedModelAudioDropLog();
      // U2: emit the per-turn latency record once per turnComplete (before the
      // drop/continuation branches below), then reset per-turn locals.
      deps.flushVoiceTurn(deps.streamOffsetMs());
      if (deps.getDropModelAudioUntilTurnComplete()) {
        deps.setDropModelAudioUntilTurnComplete(false);
        const droppedReason = deps.getModelAudioDropReason() ?? "interrupt";
        deps.setModelAudioDropReason(undefined);
        deps.setOutputTranscriptBuffer("");
        // Drop path used to leave assistantTurnStartMs set, which made
        // agentAudioLikelyActive() true and blocked deferred instruction flush.
        deps.setAssistantTurnStartMs(undefined);
        deps.outbound.unsyncCursor();
        // Interrupted turn never delivered its instruction — don't let WHY(...)
        // own the next successful agent turn. But preserve ownership when the
        // interrupt path already queued a follow-up (confirm / control / switch).
        if (!deps.shouldPreserveOwnershipOnDrop(droppedReason)) {
          deps.clearLastInstructionOwnership(`turn_dropped:${droppedReason}`);
        } else {
          deps.sessionDump.event("gemini.instruction_ownership_preserved_on_drop", {
            droppedReason,
            instructionReason: deps.getLastInstructionReason(),
          });
        }
        if (
          droppedReason === "control_intent" ||
          droppedReason === "assistant_pitch_restart"
        ) {
          // Those paths already own the follow-up instruction — do not re-run
          // the full turn planner. Still persist any pending user speech so it
          // is not lost or later absorbed into an assistant bubble.
          const pending = deps.getPendingUserTranscript().trim();
          if (pending && hasMeaningfulUserSpeechInput(pending)) {
            deps.recordTranscriptTurn("user", pending, {
              startMs: deps.getUserTurnStartMs() ?? deps.streamOffsetMs(),
              endMs: deps.streamOffsetMs(),
            });
            deps.sessionDump.event("transcript.user_recorded_on_drop", {
              text: pending,
              droppedReason,
            });
          }
          deps.setPendingUserTranscript("");
          deps.setUserTurnStartMs(undefined);
        } else {
          deps.flushPendingUserTranscript();
        }
        // Flush queued instructions BEFORE pitch_continuation so a deferred
        // nudge cannot overwrite WHY(pitch_continuation) ownership.
        deps.flushPendingRealtimeInstructions(`turn_dropped_after_interrupt:${droppedReason}`);
        if (droppedReason === "assistant_pitch_restart") {
          maybeRequestPitchContinuation(
            deps.semantic.getLastAssistantTurnText(),
            "after_restart_drop",
          );
        }
        console.log(`[voice/gemini-live] dropped model turn after ${droppedReason}`);
        deps.sessionDump.event("gemini.turn_dropped_after_interrupt", {
          reason: droppedReason,
        });
        // transcript.assistant only commits at turn_complete, which an
        // interrupted turn never reaches — so everything the agent actually
        // said before being cut was discarded. On call 5hgso that hid ~15s of
        // speech across three turns and made the log look like dead air.
        // Read via takeInterruptedAssistantText, not the live buffer: the
        // barge-in path clears the buffer at the moment of the cut, long before
        // turnComplete gets here, so reading it directly always found "".
        // Recorded here as observation only: semantic.recordAssistantTurn is
        // deliberately NOT called, because lastAssistantText drives the ambient
        // and barge-in guards and must keep meaning "last COMPLETED turn".
        const saidBeforeDrop = deps.takeInterruptedAssistantText();
        if (saidBeforeDrop) {
          deps.sessionDump.event("transcript.assistant_recorded_on_drop", {
            text: saidBeforeDrop,
            droppedReason,
          });
          deps.recordTranscriptTurn("assistant", saidBeforeDrop, {
            startMs: deps.getAssistantTurnStartMs() ?? deps.streamOffsetMs(),
            endMs: deps.streamOffsetMs(),
          });
        }
        // Ambient drop after a question left the customer waiting — resume.
        if (
          droppedReason === "ambient_noise" &&
          (deps.getAwaitingCustomerResponse() ||
            lastAssistantAskedQuestion(deps.semantic.getLastAssistantTurnText())) &&
          deps.recoverFromEmptyBargeIn
        ) {
          deps.recoverFromEmptyBargeIn("ambient_noise_drop_after_question");
        }
        if (deps.getScreeningReplyQueued()) {
          deps.setScreeningReplyQueued(false);
          deps.sendAutomatedScreeningReply();
        }
        return;
      }
      deps.flushOutboundRemainder();
      deps.outbound.unsyncCursor();
      const said = deps.getOutputTranscriptBuffer().trim();
      // Gemini sometimes free-wheels a second generation of the same completed
      // reply (echo barge-in clears awaiting / ClearedAudio mid-turn). Drop it.
      if (
        said &&
        looksLikeDuplicateAssistantRestate(deps.semantic.getLastAssistantTurnText(), said)
      ) {
        deps.setOutputTranscriptBuffer("");
        deps.clearPlivoAudio("duplicate_assistant_restate");
        deps.clearLastInstructionOwnership("duplicate_assistant_restate");
        deps.setAwaitingCustomerResponse(true);
        deps.semantic.disallowSemanticAgentTurn();
        console.log(
          `[voice/gemini-live] dropped duplicate assistant restate: "${said.slice(0, 120)}${said.length > 120 ? "…" : ""}"`,
        );
        deps.sessionDump.event("gemini.duplicate_assistant_restate_dropped", {
          text: said,
          previous: deps.semantic.getLastAssistantTurnText(),
        });
        return;
      }
      const lastInstructionReasonBeforeConsume = deps.getLastInstructionReason();
      const semanticInstructionTurn =
        deps.semantic.isAgentTurnAllowed() && isSemanticInstructionReason(lastInstructionReasonBeforeConsume);
      const controlOrCorrectionIncomplete =
        Boolean(said) &&
        isIncompleteSemanticReply(said) &&
        lastInstructionReasonBeforeConsume.startsWith("control_intent_");
      const requestPitchContinuation =
        Boolean(said) &&
        isIncompleteSemanticReply(said) &&
        ((semanticInstructionTurn &&
          (lastInstructionReasonBeforeConsume === "semantic_resolution" ||
            lastInstructionReasonBeforeConsume === "pitch_continuation")) ||
          controlOrCorrectionIncomplete);
      // Restart drop runs even under semantic ownership (semantic_resolution) —
      // mid-stream interrupt may have missed if transcript lagged. Never drop a
      // pitch_continuation turn that is finishing a short stub.
      if (
        said &&
        shouldCutAssistantPitchRestart({
          previous: deps.semantic.getLastAssistantTurnText(),
          next: said,
          instructionReason: lastInstructionReasonBeforeConsume,
        })
      ) {
        const previousAssistant = deps.semantic.getLastAssistantTurnText();
        deps.setOutputTranscriptBuffer("");
        deps.clearPlivoAudio("assistant_pitch_restart");
        console.log(
          `[voice/gemini-live] dropped assistant pitch restart: "${said.slice(0, 120)}${said.length > 120 ? "…" : ""}"`,
        );
        deps.sessionDump.event("gemini.assistant_pitch_restart_dropped", {
          text: said,
          previous: previousAssistant,
          instructionReason: lastInstructionReasonBeforeConsume,
        });
        deps.clearLastInstructionOwnership("assistant_pitch_restart");
        if (semanticInstructionTurn) {
          deps.semantic.disallowSemanticAgentTurn();
        }
        maybeRequestPitchContinuation(previousAssistant, "after_restart_drop_complete");
        return;
      }
      if (semanticInstructionTurn) {
        deps.semantic.disallowSemanticAgentTurn();
        // Keep barge-in protection warm for the rest of a multi-turn pitch
        // (Gemini often splits "आपका लोन…" + continuation). Do NOT force
        // awaiting-customer here while the pitch is still incomplete — that
        // drops the continuation and leaves silence.
        if (
          lastInstructionReasonBeforeConsume === "semantic_resolution" ||
          lastInstructionReasonBeforeConsume === "pitch_continuation"
        ) {
          deps.semantic.protectAgentTurnFromBargeIn();
          deps.protectAckUntil(Date.now() + 1200);
          // Once the funds question landed, wait for the customer — otherwise
          // Gemini free-wheels a WHY(none) re-ask of the same question.
          if (said && /[?？]/.test(said) && !isIncompletePitchFragment(said)) {
            deps.setAwaitingCustomerResponse(true);
          }
          deps.sessionDump.event("gemini.semantic_pitch_turn_protected", {
            text: said,
            instructionReason: lastInstructionReasonBeforeConsume,
            awaitingCustomer: deps.getAwaitingCustomerResponse(),
          });
        }
      } else if ((deps.getAwaitingCustomerResponse() || deps.semantic.semanticAudioBlocked()) && said) {
        deps.setOutputTranscriptBuffer("");
        deps.clearPlivoAudio("unprompted_continuation");
        console.log(`[voice/gemini-live] dropped unprompted agent continuation: "${said.slice(0, 120)}${said.length > 120 ? "…" : ""}"`);
        deps.sessionDump.event("gemini.unprompted_continuation_dropped", {
          text: said,
        });
        return;
      }
      // Capture + clear before flush so a new interrupt instruction from
      // flushPendingUserTranscript keeps ownership of the *next* agent turn.
      const lastInstruction = deps.getLastInstruction();
      const lastInstructionReason = lastInstructionReasonBeforeConsume;
      const pendingUserBeforeFlush = deps.getPendingUserTranscript();
      // Empty turnComplete after a playback cut (buffer cleared) must NOT consume
      // a newer instruction that was just queued for the customer's barge-in
      // reply — that was turning semantic_yes into WHY(none) re-asks.
      if (said) {
        deps.clearLastInstructionOwnership("assistant_turn_complete");
      } else {
        deps.sessionDump.event("gemini.empty_turn_complete_kept_instruction", {
          instructionReason: lastInstructionReasonBeforeConsume,
        });
      }
      if (said) {
        // Mark before flush so schedulePostBargeInNudge does not arm a late duplicate.
        deps.noteAssistantAnsweredAfterBargeIn(said);
      }
      // Request pitch continuation BEFORE flushing pending user speech. Otherwise
      // agent-echo ASR in the pending buffer can steal ownership (semantic plan)
      // and the incomplete pitch never gets a clean continuation.
      if (requestPitchContinuation && said) {
        deps.flushPendingRealtimeInstructions("before_pitch_continuation");
        maybeRequestPitchContinuation(said, "after_incomplete_semantic_turn");
        // Hold pending user text — flushing now races the continuation. Echo is
        // dropped; real barge-in stays for the next idle flush.
        if (
          looksLikeAssistantEchoInUserTranscript(
            deps.getPendingUserTranscript(),
            said,
          )
        ) {
          deps.setPendingUserTranscript("");
          deps.setUserTurnStartMs(undefined);
        }
      } else {
        deps.flushPendingUserTranscript();
      }
      if (said) {
        deps.semantic.recordAssistantTurn(said);
        if (!isIncompleteSemanticReply(said)) {
          pitchContinuationNudges = 0;
        }
        console.log(`[voice/gemini-live] 🤖 AGENT SAID: "${said}"`);
        console.log(`[voice/gemini-live]    WHY(${lastInstructionReason}): "${lastInstruction.slice(0, 160).replace(/\n/g, " ")}${lastInstruction.length > 160 ? "…" : ""}"`);
        deps.sessionDump.event("transcript.assistant", {
          text: said,
          instruction: lastInstruction,
          instructionReason: lastInstructionReason,
        });
      }
      const outboundAudioChunks = deps.getOutboundAudioChunks();
      console.log(`[voice/gemini-live] turn complete audioChunks=${outboundAudioChunks}`);
      deps.sessionDump.event("gemini.turn_complete", {
        audioChunks: outboundAudioChunks,
        said: Boolean(said),
      });
      const assistantText = stripUserCrosstalkFromAssistant(said, pendingUserBeforeFlush);
      deps.recordTranscriptTurn("assistant", assistantText, {
        startMs: deps.getAssistantTurnStartMs() ?? deps.streamOffsetMs(),
        endMs: deps.streamOffsetMs(),
      });
      if (deps.getCustomerPauseActive() && deps.getCustomerPauseAckPending() && said) {
        deps.setCustomerPauseAckPending(false);
        deps.sessionDump.event("gemini.customer_pause_ack_delivered", {
          said,
        });
      }
      deps.setAssistantTurnStartMs(undefined);
      if (deps.getFirstResponseRequested() && !deps.getOpeningTurnComplete()) {
        deps.markOpeningTurnComplete();
      }
      const currentCallUuid = deps.getCurrentCallUuid();
      const closingTurn = Boolean(
        currentCallUuid &&
        said &&
        shouldEndCallAfterAssistantTurn(said, getCampaign(deps.callConfig.campaignId)),
      );
      if (currentCallUuid && said) {
        const callConfig = deps.callConfig;
        if (closingTurn) {
          deps.scheduleAgentDisconnect(said, "assistant_closing_turn");
        } else {
          void maybeTriggerMidCallWorkflowActions({
            callId: currentCallUuid,
            role: "assistant",
            text: said,
            callConfig,
          }).then((result) => {
            if (result.disconnectCall) {
              deps.scheduleAgentDisconnect(
                said,
                result.disconnectReason || "workflow_disconnect_assistant_turn",
              );
            }
          }).catch((error) => {
            console.error("[voice/gemini-live] mid-call assistant action failed:", error);
          });
        }
      }
      if (said && lastInstructionReason === "caller_idle_check") {
        // The presence check is one-shot. Wait for caller speech after it;
        // do not recursively ask the same question every five seconds.
        deps.setAwaitingCustomerResponse(true);
      } else if (said && !closingTurn) {
        deps.armCallerIdlePrompt("assistant_turn_complete");
      }
      deps.setOutputTranscriptBuffer("");
      // Flush any remaining deferred notices. Pitch continuation (if needed) was
      // already requested above so it keeps WHY(pitch_continuation) ownership.
      deps.flushPendingRealtimeInstructions("model_turn_complete");
    }
  };
}
