import type { WebSocket } from "ws";
import {
  AWAITING_CUSTOMER_VAD_SENSITIVITY,
  ACTIVITY_START_MIN_SPEECH_FRAMES,
  clientActivityEndSilenceFrames,
  CLIENT_CONTROLLED_ACTIVITY_ENABLED,
  activityEndLongUtteranceFrames,
  activityEndSilenceFramesLong,
  INTERRUPT_QUESTION_RE,
  LOCAL_BARGE_IN_COOLDOWN_MS,
  LOCAL_BARGE_IN_CANDIDATE_CONFIRM_FRAMES,
  LOCAL_BARGE_IN_ECHO_RMS_MULTIPLIER,
  LOCAL_BARGE_IN_INITIAL_NOISE_RMS,
  LOCAL_BARGE_IN_MIN_ACTIVE_RATIO,
  LOCAL_BARGE_IN_MIN_PEAK,
  LOCAL_BARGE_IN_MIN_RMS,
  LOCAL_BARGE_IN_MIN_SPEECH_FRAMES,
  LOCAL_BARGE_IN_NOISE_MULTIPLIER,
  LOCAL_BARGE_IN_PLAYBACK_DUCK_MS,
  LOCAL_BARGE_IN_PREFIX_FRAMES,
  LOCAL_BARGE_IN_RESET_SILENCE_FRAMES,
  LOCAL_BARGE_IN_SPEECH_HANGOVER_MS,
  LOCAL_BARGE_IN_VAD_ENABLED,
  OPENING_LOCAL_BARGE_IN_MIN_AUDIO_MS,
  PLAYBACK_CUT_COOLDOWN_MS,
  POST_BARGE_IN_NUDGE_MS,
  POST_INTERRUPT_ANSWER_WINDOW_MS,
  POST_USER_TURN_BARGE_IN_GRACE_MS,
  BARGE_IN_RECOVERY_PROTECT_MS,
  customerSpeechAsrGraceMs,
  modelAudioDropGuardMaxMs,
  customerSpeechMuteProbeMs,
  customerSpeechMuteTimeoutMs,
  userActivityEvidenceWindowMs,
  userActivityRecoveryTimeoutMs,
} from "./plivo-gemini-live-config";
import {
  analyzeInboundSpeechFrame as analyzeInboundSpeechFrameWithNoise,
  isSubstantiveUserInterruptInput,
  rememberInboundPayload as rememberInboundPayloadFrames,
  replayRecentInboundAudio,
  requiredActivityEndSilenceFrames,
  requiredLocalBargeInSpeechFrames as computeRequiredLocalBargeInSpeechFrames,
  resolveCustomerSpeechMuteAction,
} from "./plivo-gemini-live-stream-utils";
import { shouldProtectPitchPlayback } from "./plivo-gemini-live-transcript-guards";
import { sendJson } from "./plivo-gemini-live-ws-utils";
import type { ModelAudioDropReason } from "./plivo-gemini-live-gemini-handler";
import type { ShortUtteranceClassification } from "./voice-semantic-traps";
import { languageFollowInstruction } from "./voice-language-policy";

export interface BargeInControllerDeps {
  isClosed: () => boolean;
  getSetupComplete: () => boolean;
  getGeminiWs: () => WebSocket | undefined;
  getCallerAudioEnabled: () => boolean;
  getAwaitingCustomerResponse: () => boolean;
  /** Clear post-opening mute so agent audio can play after real caller speech. */
  releaseAwaitingCustomerResponse: (reason: string) => void;
  getUserTurnStartMs: () => number | undefined;
  setUserTurnStartMs: (value: number | undefined) => void;
  /** Pending ASR text — used if customer-speech-mute times out without a plan. */
  getPendingUserTranscript?: () => string;
  agentAudioLikelyActive: () => boolean;
  /** True only while audio is queued or still within the Plivo playout window. */
  agentAudioAudible?: () => boolean;
  /** Real Plivo playout queued (not merely a paused pump / playback deadline). */
  outboundQueuedBytes?: () => number;
  isAgentTurnBargeInProtected: () => boolean;
  classifySemanticTrap: (text: string) => ShortUtteranceClassification | null;
  isClearSemanticDecisionIntent: (
    classification: ShortUtteranceClassification | null,
  ) => boolean;
  /**
   * The campaign's configured language, needed only to resolve an ambiguous
   * script against the permitted set (see languageFollowInstruction). Optional:
   * without it, unique scripts still resolve and Devanagari falls back to the
   * neutral nudge.
   */
  getCampaignLanguage?: () => string | undefined;
  /** Live CallConfig — used to suppress recoveries during public-demo soft-route quiet window. */
  getCallConfig?: () => { publicDemoSwitchQuietUntilMs?: number } | undefined;
  sendClientInstruction: (
    text: string,
    reason: string,
    options?: { deferUntilIdle?: boolean },
  ) => void;
  clearPlivoAudio: (reason?: string) => void;
  clearOutputTranscriptBuffer: () => void;
  emitEvent: (event: string, payload?: Record<string, unknown>) => void;
  markVoiceInterruptedThisTurn: () => void;
  setVoiceLastSpeechFrameMs: (ms: number) => void;
  streamOffsetMs: () => number;
  sendGeminiAudio: (payload: string) => void;
  /** Soft duck: pause outbound pump without dropping queued audio. */
  pauseOutboundPlayback: () => void;
  resumeOutboundPlayback: () => void;
  /** Named hold used by provisional duplex-speech confirmation. */
  holdOutboundPlayback?: (reason: string) => void;
  releaseOutboundPlayback?: (reason: string) => void;

  // Opening-lifecycle bridges (owned by plivo-gemini-live-opening.ts).
  getFirstResponseRequested: () => boolean;
  getOpeningTurnComplete: () => boolean;
  /** Full opening-complete path (arms awaiting-customer). */
  markOpeningTurnComplete: () => void;
  getOpeningAudioStartedAtMs: () => number | undefined;
  enableCallerAudioAfterOpening: () => void;
  /** Last committed assistant text — used to keep pitch playback protected. */
  getLastAssistantTurnText: () => string;
  getOutputTranscriptBuffer: () => string;
  /** Cancel caller-idle prompting as soon as a verified activity window opens. */
  onUserActivityStart?: (reason: string) => void;
}

export interface BargeInController {
  localCallerSpeechActive(): boolean;
  localPlaybackDuckActive(): boolean;
  markLocalCallerSpeech(now?: number, shouldDuckPlayback?: boolean): void;
  armPostUserTurnBargeInGrace(now?: number): void;
  getUserTurnBargeInGraceUntilMs(): number;

  isDropModelAudioActive(): boolean;
  setDropModelAudioActive(value: boolean): void;
  getModelAudioDropReason(): ModelAudioDropReason | undefined;
  setModelAudioDropReason(value: ModelAudioDropReason | undefined): void;
  setDropModelAudio(reason: ModelAudioDropReason): void;
  /** Release drop-until-turnComplete so a planned follow-up can speak immediately. */
  clearModelAudioDropGuard(reason: string): void;
  /**
   * True after a real barge-in until we intentionally allow the next agent reply.
   * Keeps Gemini audio suppressed even after the interrupted turn's turnComplete.
   */
  isCustomerSpeechMuteActive(): boolean;
  /** Suppress agent audio after barge-in until a planned reply. */
  armCustomerSpeechMute(reason: string): void;
  /** Allow agent audio again (call when a planned reply is about to speak). */
  clearCustomerSpeechMute(reason: string): void;
  /**
   * After a barge-in that produced no usable customer transcript, unmute and
   * tell the model to continue — otherwise the call stays dead air.
   */
  recoverFromEmptyBargeIn(reason: string): void;
  /** Caller spoke but every transcript was rejected — ask them to repeat. */
  recoverFromUnclearBargeIn(reason: string): void;
  /** Record that ASR produced words the guards discarded (a human spoke). */
  noteRejectedSpeech(nowMs?: number): void;
  /** True while a post-barge-in recovery reply is protected from ambient drops. */
  isBargeInRecoveryProtected(): boolean;

  /** Unified playback cut with shared cooldown across VAD/transcript/server paths. */
  tryClearAudiblePlayback(reason: string, details?: Record<string, unknown>): boolean;
  clearAudibleModelAudio(reason: string, details?: Record<string, unknown>): void;
  interruptCurrentModelAudio(reason: string, details?: Record<string, unknown>): void;

  flushSuppressedModelAudioDropLog(): void;
  getSuppressedModelAudioDropReason(): string | undefined;
  setSuppressedModelAudioDropReason(value: string | undefined): void;
  getSuppressedModelAudioDropChunks(): number;
  setSuppressedModelAudioDropChunks(value: number): void;

  getLastUserBargeInAtMs(): number;
  getLastPlaybackCutAtMs(): number;

  isSubstantiveUserInterrupt(text: string): boolean;
  sendPostInterruptAnswerNudge(userTurnText: string): void;

  rememberInboundPayload(payload: string): void;
  handleLocalBargeInVad(payload: string): void;
  /** Silero (neural) VAD fired a speech-start — see notifySileroSpeechStart. */
  notifySileroSpeechStart(): void;
  /** When client-controlled activity is on, audio should only flow while this is true. */
  isUserActivityOpen(): boolean;
  /** Acoustic proof that a caller activity window recently opened. */
  hasRecentUserActivityEvidence(nowMs?: number): boolean;
  /** Voice-like duplex evidence, even if the adaptive RMS floor rejected it. */
  hasRecentBargeInCandidateEvidence(nowMs?: number): boolean;
  /** Cancel the dry-turn watchdog once Gemini starts a real response. */
  resolveUserActivityResponse(reason: string): void;
  /** Clear the dry-turn watchdog when the call/session closes. */
  clearUserActivityRecovery(reason: string): void;

  clearPostBargeInNudge(reason: string): void;
  schedulePostBargeInNudge(userTurnText: string): void;
  /** Call when a full assistant turn lands after a barge-in — cancels late duplicate nudges. */
  noteAssistantAnsweredAfterBargeIn(said: string): void;
  /** Protect the next agent ack from Gemini serverContent.interrupted. */
  protectAckUntil(untilMs: number): void;
  isAckProtected(nowMs?: number): boolean;
}

/**
 * Owns local (client-side) VAD barge-in detection, the various "drop/cut
 * the model's audio" primitives, and the post-interrupt answer nudge —
 * everything that decides when the caller has interrupted the agent and
 * how the stream reacts to it. Opening-turn lifecycle lives in the
 * sibling `plivo-gemini-live-opening.ts` controller; a handful of getters
 * bridge the two since local barge-in behavior differs during the
 * opening line.
 */
export function createBargeInController(deps: BargeInControllerDeps): BargeInController {
  let localBargeInSpeechFrames = 0;
  let localBargeInSilenceFrames = 0;
  let lastLocalBargeInAtMs = 0;
  let lastUserBargeInAtMs = 0;
  let lastPlaybackCutAtMs = 0;
  let localCallerSpeechUntilMs = 0;
  let localPlaybackDuckUntilMs = 0;
  let userTurnBargeInGraceUntilMs = 0;
  let localNoiseFloorRms = LOCAL_BARGE_IN_INITIAL_NOISE_RMS;
  let postBargeInNudgeTimer: NodeJS.Timeout | undefined;
  let recentInboundPayloads: string[] = [];
  let dropModelAudioUntilTurnComplete = false;
  let modelAudioDropReason: ModelAudioDropReason | undefined;
  /** Backstop for a turnComplete that never arrives — see setDropModelAudio. */
  let dropGuardMaxAgeTimer: ReturnType<typeof setTimeout> | undefined;
  /** After barge-in: keep suppressing agent audio until a planned reply clears this. */
  let muteAgentWhileCustomerSpeaking = false;
  let customerSpeechMuteTimer: NodeJS.Timeout | undefined;
  /** Wall-clock: ignore ambient_noise interrupts until this time after empty recovery. */
  let bargeInRecoveryProtectedUntilMs = 0;
  /**
   * When ASR last produced words that the noise/out-of-domain guards threw away.
   * Ambient noise does not generate lexical output, so this is evidence a human
   * spoke even though we could not use what they said.
   */
  let lastRejectedSpeechAtMs = 0;
  // The mute failsafe's budget now lives in customerSpeechMuteTimeoutMs() so it
  // is tunable from .env.local; armCustomerSpeechMute probes against it.
  let suppressedModelAudioDropChunks = 0;
  let suppressedModelAudioDropReason: string | undefined;
  let postInterruptNudgeSentForBargeInAtMs = 0;
  /** Barge-in timestamp for which a full assistant turn already answered the interrupt. */
  let assistantAnsweredForBargeInAtMs = 0;
  let ackProtectedUntilMs = 0;
  let playbackDuckResumeTimer: NodeJS.Timeout | undefined;
  /** Client-controlled Gemini activity window (activityStart → activityEnd). */
  let userActivityOpen = false;
  let activitySpeechFrames = 0;
  let activityOpenSpeechFrames = 0;
  let activitySilenceFrames = 0;
  let activityUsesIdleSensitivity = false;
  let userActivityEvidenceUntilMs = 0;
  let verifiedActivityAsrGraceUntilMs = 0;
  let userActivityRecoveryTimer: NodeJS.Timeout | undefined;
  let duplexCandidateFrames = 0;
  let duplexCandidateSilenceFrames = 0;
  let duplexCandidateEvidenceUntilMs = 0;
  let duplexCandidateHoldActive = false;
  const DUPLEX_CANDIDATE_HOLD = "barge_in_candidate";
  /** Min speech inside an open window before silence may close it (avoids breath-split turns). */
  const ACTIVITY_MIN_OPEN_SPEECH_FRAMES = 10;

  function localCallerSpeechActive(): boolean {
    return Date.now() < localCallerSpeechUntilMs;
  }

  function isUserActivityOpen(): boolean {
    // When server VAD owns turns, treat activity as always open for ingress gating.
    return !CLIENT_CONTROLLED_ACTIVITY_ENABLED || userActivityOpen;
  }

  function hasRecentUserActivityEvidence(nowMs = Date.now()): boolean {
    return nowMs < userActivityEvidenceUntilMs;
  }

  function hasRecentBargeInCandidateEvidence(nowMs = Date.now()): boolean {
    return nowMs < duplexCandidateEvidenceUntilMs;
  }

  function releaseDuplexCandidateHold(reason: string): void {
    if (!duplexCandidateHoldActive) return;
    duplexCandidateHoldActive = false;
    deps.releaseOutboundPlayback?.(DUPLEX_CANDIDATE_HOLD);
    deps.emitEvent("gemini.barge_in_candidate_released", { reason });
  }

  function resetDuplexCandidate(reason: string): void {
    duplexCandidateFrames = 0;
    duplexCandidateSilenceFrames = 0;
    releaseDuplexCandidateHold(reason);
  }

  function observeDuplexCandidate(nowMs: number): boolean {
    duplexCandidateEvidenceUntilMs = Math.max(
      duplexCandidateEvidenceUntilMs,
      nowMs + userActivityEvidenceWindowMs(),
    );
    duplexCandidateFrames += 1;
    duplexCandidateSilenceFrames = 0;
    if (!duplexCandidateHoldActive) {
      duplexCandidateHoldActive = true;
      deps.holdOutboundPlayback?.(DUPLEX_CANDIDATE_HOLD);
      deps.emitEvent("gemini.barge_in_candidate_started", {
        requiredFrames: LOCAL_BARGE_IN_CANDIDATE_CONFIRM_FRAMES,
      });
    }
    if (
      duplexCandidateFrames < LOCAL_BARGE_IN_CANDIDATE_CONFIRM_FRAMES ||
      (deps.agentAudioAudible?.() ?? true)
    ) {
      return false;
    }

    const confirmedFrames = duplexCandidateFrames;
    resetDuplexCandidate("confirmed");
    markLocalCallerSpeech(nowMs, false);
    deps.setVoiceLastSpeechFrameMs(deps.streamOffsetMs());
    signalActivityStart("local_vad_duplex_candidate");
    deps.emitEvent("gemini.barge_in_candidate_confirmed", {
      frames: confirmedFrames,
    });
    return true;
  }

  function observeNoDuplexCandidate(): void {
    if (duplexCandidateFrames <= 0 && !duplexCandidateHoldActive) return;
    // The purpose of the hold is to create a clean no-echo observation window.
    // Do not release it while the cushion already sent to Plivo is still
    // audible; otherwise the next syllable is judged against the same mixed
    // playback signal and fragmented speech never reaches confirmation.
    if (deps.agentAudioAudible?.()) return;
    duplexCandidateSilenceFrames += 1;
    if (duplexCandidateSilenceFrames >= LOCAL_BARGE_IN_RESET_SILENCE_FRAMES) {
      resetDuplexCandidate("not_sustained");
    }
  }

  function clearUserActivityRecovery(reason: string): void {
    if (reason === "call_closed") resetDuplexCandidate(reason);
    if (!userActivityRecoveryTimer) return;
    clearTimeout(userActivityRecoveryTimer);
    userActivityRecoveryTimer = undefined;
    deps.emitEvent("gemini.user_activity_recovery_cancelled", { reason });
  }

  function resolveUserActivityResponse(reason: string): void {
    clearUserActivityRecovery(reason);
  }

  function armUserActivityRecovery(): void {
    clearUserActivityRecovery("rearmed");
    const timeoutMs = userActivityRecoveryTimeoutMs();
    userActivityRecoveryTimer = setTimeout(() => {
      userActivityRecoveryTimer = undefined;
      if (deps.isClosed()) return;
      deps.emitEvent("gemini.user_activity_response_timeout", { timeoutMs });
      recoverFromUnclearBargeIn("user_activity_response_timeout");
    }, timeoutMs);
    deps.emitEvent("gemini.user_activity_recovery_armed", { timeoutMs });
  }

  function signalActivityStart(reason: string): void {
    if (!CLIENT_CONTROLLED_ACTIVITY_ENABLED || userActivityOpen || deps.isClosed()) return;
    if (!deps.getSetupComplete() || !deps.getCallerAudioEnabled()) return;
    const agentAudible = deps.agentAudioAudible?.() ?? deps.agentAudioLikelyActive();
    const cutActivePlayback = deps.agentAudioLikelyActive() && localBargeInAllowedNow();
    deps.onUserActivityStart?.(reason);
    clearUserActivityRecovery("new_activity");
    userActivityOpen = true;
    activityUsesIdleSensitivity = !agentAudible;
    userActivityEvidenceUntilMs = Date.now() + userActivityEvidenceWindowMs();
    activitySpeechFrames = 0;
    // The activity window only opens after this many locally verified speech
    // frames. Count that prefix as part of the utterance so a very short reply
    // still arms recovery and gets the correct short-turn silence tolerance.
    activityOpenSpeechFrames = ACTIVITY_START_MIN_SPEECH_FRAMES;
    activitySilenceFrames = 0;
    sendJson(deps.getGeminiWs(), { realtimeInput: { activityStart: {} } });
    console.log(`[voice/gemini-live] activityStart (${reason})`);
    deps.emitEvent("gemini.activity_start", { reason });
    // Replay buffered speech so the first syllable isn't lost.
    replayRecentInboundAudioToGemini(0);
    // Opening a real caller activity window already means the echo-aware VAD
    // accepted sustained speech. Cut Plivo NOW. Waiting for a second, much
    // higher barge-in counter let Gemini receive/transcribe the caller while
    // the customer still heard the entire buffered agent turn.
    if (cutActivePlayback) {
      if (deps.getUserTurnStartMs() === undefined) {
        deps.setUserTurnStartMs(deps.streamOffsetMs());
      }
      noteUserBargeIn("local_vad_barge_in");
      armCustomerSpeechMute("local_vad_activity_start");
      interruptCurrentModelAudio("local_vad_barge_in_activity_start", {
        activityReason: reason,
      });
      console.log("[voice/gemini-live] local VAD activity start cut active playback");
    }
    // Retire the awaiting-customer state HERE, not on the first energetic frame.
    // awaitingCustomerResponse lowers every VAD threshold by
    // AWAITING_CUSTOMER_VAD_SENSITIVITY so a quiet first answer can be heard;
    // releasing it on frame 1 restored the strict bar before the remaining
    // ACTIVITY_START_MIN_SPEECH_FRAMES could accumulate, so this window never
    // opened and the caller's entire first utterance was never sent to Gemini
    // (confirmed: call vc-test-...-uotur, 9.1s of speech lost between
    // turn_complete and awaiting_customer_cleared). The boost must survive
    // until it has done its job — opening this window.
    // Mirrors notifySileroSpeechStart, which already released only after
    // signalActivityStart.
    if (
      deps.getAwaitingCustomerResponse() &&
      deps.getOpeningTurnComplete() &&
      !(deps.agentAudioAudible?.() ?? deps.agentAudioLikelyActive()) &&
      !deps.isAgentTurnBargeInProtected?.()
    ) {
      deps.releaseAwaitingCustomerResponse(`activity_start:${reason}`);
    }
  }

  function signalActivityEnd(reason: string): void {
    if (!CLIENT_CONTROLLED_ACTIVITY_ENABLED || !userActivityOpen || deps.isClosed()) return;
    const completedSpeechFrames = activityOpenSpeechFrames;
    userActivityOpen = false;
    activityUsesIdleSensitivity = false;
    activitySpeechFrames = 0;
    activityOpenSpeechFrames = 0;
    activitySilenceFrames = 0;
    sendJson(deps.getGeminiWs(), { realtimeInput: { activityEnd: {} } });
    console.log(`[voice/gemini-live] activityEnd (${reason})`);
    deps.emitEvent("gemini.activity_end", { reason });
    if (completedSpeechFrames > 0) {
      const nowMs = Date.now();
      userActivityEvidenceUntilMs = nowMs + userActivityEvidenceWindowMs();
      verifiedActivityAsrGraceUntilMs = nowMs + customerSpeechAsrGraceMs();
      armUserActivityRecovery();
    }
  }

  /**
   * REMOVED: a synthetic activityStart+activityEnd "pulse" with no real audio
   * in between was tried here to proactively cut free-wheel generation.
   * Confirmed regression: Gemini's ASR hallucinates garbage transcripts
   * (random Spanish phrases) for near-empty audio turns, which is worse than
   * leaving the free-wheel to be interrupted naturally by the caller's own
   * speech. Do not reintroduce without confirming Gemini Live tolerates
   * empty/near-empty manual activity turns.
   */

  /**
   * Drive Gemini turn boundaries from local VAD. Also forwards audio while the
   * activity window is open (media path skips sendGeminiAudio in this mode).
   * Per-utterance segmentation (speech opens, ~silence closes) — same path for
   * greeting and mid-call. A held-open window with no activityEnd stalls
   * Gemini entirely.
   */
  function trackClientActivity(payload: string, speech: boolean): void {
    if (!CLIENT_CONTROLLED_ACTIVITY_ENABLED) return;
    if (!deps.getSetupComplete() || !deps.getCallerAudioEnabled() || deps.isClosed()) return;

    if (speech) {
      activitySilenceFrames = 0;
      if (userActivityOpen) {
        activityOpenSpeechFrames += 1;
        deps.sendGeminiAudio(payload);
        return;
      }
      activitySpeechFrames += 1;
      if (activitySpeechFrames >= ACTIVITY_START_MIN_SPEECH_FRAMES) {
        signalActivityStart("local_vad_speech");
        // Threshold frame must reach Gemini even if prefix replay raced empty.
        deps.sendGeminiAudio(payload);
      }
      return;
    }

    // Decay rather than hard-reset while the window is still closed. A soft
    // utterance onset dips in and out around the VAD threshold, and a single
    // flickering non-speech frame used to wipe the entire run-up to
    // ACTIVITY_START_MIN_SPEECH_FRAMES — so the window only opened for a caller
    // who cleared the bar on 4 consecutive frames. Real silence still drains
    // the counter within a few frames.
    activitySpeechFrames = userActivityOpen ? 0 : Math.max(0, activitySpeechFrames - 1);
    if (!userActivityOpen) return;
    // Keep streaming trailing silence so Gemini hears the end of the utterance.
    deps.sendGeminiAudio(payload);
    activitySilenceFrames += 1;
    // Ignore brief mid-phrase dips until we've captured a real chunk of speech.
    if (activityOpenSpeechFrames < ACTIVITY_MIN_OPEN_SPEECH_FRAMES) {
      if (activitySilenceFrames >= clientActivityEndSilenceFrames()) {
        signalActivityEnd("local_vad_silence_short_utterance");
      }
      return;
    }
    // Long utterances close on a shorter silence tail — the conservative floor
    // only protects short answers from being clipped past the point Gemini can
    // transcribe them. See requiredActivityEndSilenceFrames.
    const baseSilenceFrames = clientActivityEndSilenceFrames();
    const requiredSilenceFrames = requiredActivityEndSilenceFrames(
      activityOpenSpeechFrames,
      baseSilenceFrames,
      activityEndSilenceFramesLong(),
      activityEndLongUtteranceFrames(),
    );
    if (activitySilenceFrames >= requiredSilenceFrames) {
      signalActivityEnd(
        requiredSilenceFrames < baseSilenceFrames
          ? "local_vad_silence_long_utterance"
          : "local_vad_silence",
      );
    }
  }

  function localPlaybackDuckActive(): boolean {
    return Date.now() < localPlaybackDuckUntilMs;
  }

  function markLocalCallerSpeech(now = Date.now(), shouldDuckPlayback = false): void {
    localCallerSpeechUntilMs = Math.max(localCallerSpeechUntilMs, now + LOCAL_BARGE_IN_SPEECH_HANGOVER_MS);
    if (shouldDuckPlayback) {
      localPlaybackDuckUntilMs = Math.max(localPlaybackDuckUntilMs, now + LOCAL_BARGE_IN_PLAYBACK_DUCK_MS);
      // Pause the pump instead of dropping model chunks — dropping caused audible
      // stutter holes when echo briefly tripped VAD during agent speech.
      deps.pauseOutboundPlayback();
      if (playbackDuckResumeTimer) clearTimeout(playbackDuckResumeTimer);
      const resumeIn = Math.max(0, localPlaybackDuckUntilMs - Date.now());
      playbackDuckResumeTimer = setTimeout(() => {
        playbackDuckResumeTimer = undefined;
        if (!localPlaybackDuckActive() && !dropModelAudioUntilTurnComplete) {
          deps.resumeOutboundPlayback();
        }
      }, resumeIn + 5);
    }
  }

  function armPostUserTurnBargeInGrace(now = Date.now()): void {
    userTurnBargeInGraceUntilMs = Math.max(
      userTurnBargeInGraceUntilMs,
      now + POST_USER_TURN_BARGE_IN_GRACE_MS,
    );
  }

  function noteUserBargeIn(reason: string): void {
    const now = Date.now();
    lastUserBargeInAtMs = now;
    // New barge-in opens a fresh answer window; prior "already answered" no longer applies.
    assistantAnsweredForBargeInAtMs = 0;
    if (reason === "local_vad_barge_in") {
      lastLocalBargeInAtMs = now;
    }
  }

  function noteAssistantAnsweredAfterBargeIn(said: string): void {
    if (!said.trim()) return;
    if (!lastUserBargeInAtMs || Date.now() - lastUserBargeInAtMs > POST_INTERRUPT_ANSWER_WINDOW_MS) {
      return;
    }
    assistantAnsweredForBargeInAtMs = lastUserBargeInAtMs;
    // Treat as already nudged so a late timer / flush cannot send a second answer.
    postInterruptNudgeSentForBargeInAtMs = lastUserBargeInAtMs;
    clearPostBargeInNudge("assistant_already_answered");
  }

  function protectAckUntil(untilMs: number): void {
    ackProtectedUntilMs = Math.max(ackProtectedUntilMs, untilMs);
  }

  function isAckProtected(nowMs = Date.now()): boolean {
    return nowMs < ackProtectedUntilMs;
  }

  function clearAudibleModelAudio(reason: string, details?: Record<string, unknown>): void {
    resetDuplexCandidate(`playback_cleared:${reason}`);
    if (
      reason === "live_speech_cut" ||
      reason === "transcript_barge_in" ||
      reason === "local_vad_barge_in" ||
      reason === "gemini_interrupted" ||
      reason.startsWith("gemini_interrupted") ||
      reason.includes("barge_in")
    ) {
      deps.markVoiceInterruptedThisTurn();
      noteUserBargeIn(reason);
    }
    lastPlaybackCutAtMs = Date.now();
    if (playbackDuckResumeTimer) {
      clearTimeout(playbackDuckResumeTimer);
      playbackDuckResumeTimer = undefined;
    }
    deps.clearOutputTranscriptBuffer();
    deps.clearPlivoAudio(reason);
    // Must use markOpeningTurnComplete (not a raw flag flip): barge-in during the
    // opener otherwise skips awaiting-customer arming and the later turnComplete no-ops.
    if (deps.getFirstResponseRequested() && !deps.getOpeningTurnComplete()) {
      deps.markOpeningTurnComplete();
    }
    deps.emitEvent("gemini.model_audio_cleared", {
      reason,
      ...(details ?? {}),
    });
  }

  function tryClearAudiblePlayback(reason: string, details?: Record<string, unknown>): boolean {
    const now = Date.now();
    if (now - lastPlaybackCutAtMs < PLAYBACK_CUT_COOLDOWN_MS) {
      deps.emitEvent("gemini.playback_cut_suppressed_cooldown", {
        reason,
        msSinceLastCut: now - lastPlaybackCutAtMs,
        cooldownMs: PLAYBACK_CUT_COOLDOWN_MS,
      });
      return false;
    }
    if (dropModelAudioUntilTurnComplete) {
      deps.emitEvent("gemini.playback_cut_suppressed_drop_guard", {
        reason,
        activeDropReason: modelAudioDropReason ?? "unknown",
      });
      return false;
    }
    clearAudibleModelAudio(reason, details);
    return true;
  }

  /**
   * The guard is named for its release condition — "until turn complete" — and
   * that is exactly the bug: we killed this turn from the client, so Gemini may
   * never send a turnComplete for it, and nothing else bounds the wait.
   *
   * This is a TAIL fix, and the size of that tail is smaller than it first
   * looked. Measured over 300 calls (tmp/voice-scoreboard.ts) the guard is
   * healthy almost always — p50 18ms, p90 183ms, p95 1960ms — but the tail is
   * real: p99 9213ms, max 17353ms, 21 of 483 windows over 3s, and 18 windows
   * never released before the call ended. For the whole of such a window the
   * agent's audio is discarded (gemini-handler: dropModelAudioUntilTurnComplete)
   * AND further barge-in is refused (interrupt_ignored_existing_drop_guard,
   * localBargeInAllowedNow) — dead air the caller cannot interrupt.
   *
   * So the guard gets its own deadline. It exists to swallow the tail of ONE
   * killed agent turn; a few seconds is all that can legitimately take. The cap
   * sits above p95, so healthy turns never reach it and it only ever ends a
   * window the normal release already failed to close.
   */
  function setDropModelAudio(reason: ModelAudioDropReason): void {
    dropModelAudioUntilTurnComplete = true;
    modelAudioDropReason = reason;
    if (dropGuardMaxAgeTimer) clearTimeout(dropGuardMaxAgeTimer);
    const maxAgeMs = modelAudioDropGuardMaxMs();
    dropGuardMaxAgeTimer = setTimeout(() => {
      dropGuardMaxAgeTimer = undefined;
      if (deps.isClosed() || !dropModelAudioUntilTurnComplete) return;
      deps.emitEvent("gemini.model_audio_drop_guard_expired", {
        maxAgeMs,
        activeDropReason: modelAudioDropReason ?? "unknown",
      });
      console.warn(
        `[voice/gemini-live] drop guard hit its ${maxAgeMs}ms cap without a turnComplete` +
          ` — releasing so the agent can be heard again`,
      );
      clearModelAudioDropGuard("drop_guard_max_age");
    }, maxAgeMs);
  }

  function clearModelAudioDropGuard(reason: string): void {
    if (dropGuardMaxAgeTimer) {
      clearTimeout(dropGuardMaxAgeTimer);
      dropGuardMaxAgeTimer = undefined;
    }
    if (!dropModelAudioUntilTurnComplete && !modelAudioDropReason) return;
    const previous = modelAudioDropReason ?? "unknown";
    dropModelAudioUntilTurnComplete = false;
    modelAudioDropReason = undefined;
    deps.emitEvent("gemini.model_audio_drop_guard_cleared", {
      reason,
      previousDropReason: previous,
    });
  }

  function armCustomerSpeechMute(reason: string): void {
    muteAgentWhileCustomerSpeaking = true;
    // Caller is speaking — do not keep shielding the next cut behind ack windows.
    ackProtectedUntilMs = 0;
    // Every caller of this function has positive evidence that a human just
    // spoke: local VAD confirmed sustained speech, or Gemini's own VAD fired an
    // interrupt. In both cases a transcript is in flight, so the probe must not
    // be allowed to declare "nothing was said" before it can possibly land.
    //
    // Only signalActivityEnd used to arm this grace, which left the
    // Gemini-initiated interrupt paths ("gemini_interrupted",
    // "gemini_interrupted_awaiting_speech") with no grace at all — and those are
    // exactly the ones that misfired. Measured over 299 calls: 13 of 43
    // barge_in_empty_recovery events were followed by the caller's real
    // transcript within 1.5s, two of them within 32ms. Each one told a customer
    // who had just spoken clearly that they had said nothing, and burned a whole
    // turn doing it — far more latency than the round trip this design avoids.
    verifiedActivityAsrGraceUntilMs = Math.max(
      verifiedActivityAsrGraceUntilMs,
      Date.now() + customerSpeechAsrGraceMs(),
    );
    if (customerSpeechMuteTimer) clearTimeout(customerSpeechMuteTimer);

    // Probe for evidence instead of waiting out the whole budget blind. A false
    // barge-in resolves on the first tick; a real speaker still gets the full
    // budget. See resolveCustomerSpeechMuteAction.
    const armedAtMs = Date.now();
    const budgetMs = customerSpeechMuteTimeoutMs();

    const probe = (): void => {
      customerSpeechMuteTimer = undefined;
      if (!muteAgentWhileCustomerSpeaking || deps.isClosed()) return;
      const pending = (deps.getPendingUserTranscript?.() || "").trim();
      const elapsedMs = Date.now() - armedAtMs;
      const action = resolveCustomerSpeechMuteAction({
        pendingTranscript: pending,
        callerSpeechActive: localCallerSpeechActive(),
        elapsedMs,
        budgetMs,
        heardRejectedSpeech: lastRejectedSpeechAtMs >= armedAtMs,
        awaitingVerifiedActivityTranscript:
          Date.now() < verifiedActivityAsrGraceUntilMs,
      });

      if (action === "wait") {
        customerSpeechMuteTimer = setTimeout(
          probe,
          Math.max(1, Math.min(customerSpeechMuteProbeMs(), budgetMs - elapsedMs)),
        );
        return;
      }

      const timedOut = elapsedMs >= budgetMs;
      deps.emitEvent("gemini.customer_speech_mute_timeout", {
        reason,
        pendingUserTranscript: pending,
        elapsedMs,
        budgetMs,
        // Distinguishes the evidence-driven early-out from the budget expiring,
        // so dumps show which path recovered the turn.
        resolvedBy: timedOut ? "budget" : "probe_no_speech",
      });
      console.warn(
        `[voice/gemini-live] customer-speech-mute resolved after ${elapsedMs}ms` +
          ` (${timedOut ? "budget" : "probe_no_speech"})` +
          (pending ? ` — forcing answer for "${pending.slice(0, 80)}"` : " (no transcript)"),
      );
      if (action === "answer") {
        sendPostInterruptAnswerNudge(pending);
      } else if (action === "unclear") {
        recoverFromUnclearBargeIn(timedOut ? "mute_timeout_unclear" : "mute_probe_unclear");
      } else {
        // Empty barge-in (noise / false start) used to only clear mute — agent
        // never resumed and the call went dry. Always recover with a continue nudge.
        recoverFromEmptyBargeIn(timedOut ? "mute_timeout_empty" : "mute_probe_no_speech");
      }
    };

    customerSpeechMuteTimer = setTimeout(probe, Math.min(customerSpeechMuteProbeMs(), budgetMs));
    deps.emitEvent("gemini.customer_speech_mute_armed", { reason });
  }

  function clearCustomerSpeechMute(reason: string): void {
    if (customerSpeechMuteTimer) {
      clearTimeout(customerSpeechMuteTimer);
      customerSpeechMuteTimer = undefined;
    }
    if (!muteAgentWhileCustomerSpeaking) return;
    muteAgentWhileCustomerSpeaking = false;
    deps.emitEvent("gemini.customer_speech_mute_cleared", { reason });
  }

  function isCustomerSpeechMuteActive(): boolean {
    return muteAgentWhileCustomerSpeaking;
  }

  /**
   * Unmute + ask the model to continue after a barge-in that had no clear
   * customer speech (false barge-in, ambient blip, empty ASR). Prevents the
   * "agent cut mid-sentence → forever silent" dry-call failure.
   */
  function recoverFromEmptyBargeIn(reason: string): void {
    if (deps.isClosed()) return;
    const quietUntil = deps.getCallConfig?.()?.publicDemoSwitchQuietUntilMs;
    if (typeof quietUntil === "number" && Date.now() < quietUntil) {
      deps.emitEvent("public_demo.barge_in_recovery_suppressed", {
        kind: "empty",
        reason,
        quietUntil,
      });
      return;
    }
    clearCustomerSpeechMute(reason);
    clearModelAudioDropGuard(reason);
    clearPostBargeInNudge(reason);
    // Protect the continue-turn from immediate ambient_noise re-drops (confirmed
    // dry-call: recovery instruction fired, then 20+ chunks dropped as ambient_noise).
    bargeInRecoveryProtectedUntilMs = Date.now() + BARGE_IN_RECOVERY_PROTECT_MS;
    deps.sendClientInstruction(
      `You were interrupted, but the customer did not say anything clear. ` +
        `Continue the call naturally from where you left off. ` +
        `Do not apologize at length, do not restart the whole pitch from the beginning, ` +
        `and do not wait silently — speak the next useful sentence now.`,
      "barge_in_empty_recovery",
    );
    deps.emitEvent("gemini.barge_in_empty_recovery", {
      reason,
      protectMs: BARGE_IN_RECOVERY_PROTECT_MS,
    });
    console.log(`[voice/gemini-live] barge-in empty recovery (${reason})`);
  }

  /**
   * The caller spoke, but every transcript we got was rejected by the noise /
   * out-of-domain guards. Resuming the pitch here is what makes barge-in feel
   * broken: from their seat they interrupted, the agent went quiet, then talked
   * straight over them. Ask them to repeat instead — we know they said
   * something, we just could not make it out.
   */
  function recoverFromUnclearBargeIn(reason: string): void {
    if (deps.isClosed()) return;
    const quietUntil = deps.getCallConfig?.()?.publicDemoSwitchQuietUntilMs;
    if (typeof quietUntil === "number" && Date.now() < quietUntil) {
      deps.emitEvent("public_demo.barge_in_recovery_suppressed", {
        kind: "unclear",
        reason,
        quietUntil,
      });
      return;
    }
    clearCustomerSpeechMute(reason);
    clearModelAudioDropGuard(reason);
    clearPostBargeInNudge(reason);
    bargeInRecoveryProtectedUntilMs = Date.now() + BARGE_IN_RECOVERY_PROTECT_MS;
    deps.sendClientInstruction(
      `The customer just said something but it did not come through clearly. ` +
        `Do NOT continue what you were saying and do NOT restart your pitch. ` +
        `In one short sentence, politely ask them to repeat that, then stop and listen.`,
      "barge_in_unclear_recovery",
    );
    deps.emitEvent("gemini.barge_in_unclear_recovery", {
      reason,
      protectMs: BARGE_IN_RECOVERY_PROTECT_MS,
    });
    console.log(`[voice/gemini-live] barge-in unclear recovery (${reason}) — asking caller to repeat`);
  }

  /** ASR produced words that the guards discarded — a human spoke, content unknown. */
  function noteRejectedSpeech(nowMs = Date.now()): void {
    lastRejectedSpeechAtMs = nowMs;
  }

  function isBargeInRecoveryProtected(nowMs = Date.now()): boolean {
    return nowMs < bargeInRecoveryProtectedUntilMs;
  }

  function interruptCurrentModelAudio(reason: string, details?: Record<string, unknown>): void {
    const dropReason: ModelAudioDropReason =
      reason === "assistant_pitch_restart"
          ? "assistant_pitch_restart"
        : reason.includes("control_intent")
          ? "control_intent"
        : reason.includes("ambient_noise") ||
            reason.includes("noise_ignored") ||
            reason.includes("out_of_domain") ||
            reason.includes("non_addressed")
          ? "ambient_noise"
          : "interrupt";
    // Never re-arm ambient drop while a recovery continue-turn is in flight —
    // that is exactly the dry-call pattern in production logs.
    if (dropReason === "ambient_noise" && isBargeInRecoveryProtected()) {
      deps.emitEvent("gemini.ambient_interrupt_skipped_during_recovery", {
        reason,
        protectRemainingMs: Math.max(0, bargeInRecoveryProtectedUntilMs - Date.now()),
        ...(details ?? {}),
      });
      console.log(
        `[voice/gemini-live] skipped ambient interrupt during recovery protect (${reason})`,
      );
      return;
    }
    setDropModelAudio(dropReason);
    deps.markVoiceInterruptedThisTurn(); // U2: deterministic barge-in flag (R4)

    const now = Date.now();
    const forceClear =
      dropReason === "control_intent" ||
      dropReason === "assistant_pitch_restart" ||
      dropReason === "ambient_noise" ||
      reason.includes("semantic") ||
      reason.includes("local_vad_barge_in");
    if (!forceClear && now - lastPlaybackCutAtMs < PLAYBACK_CUT_COOLDOWN_MS) {
      // Playback was already cut by VAD/transcript path — keep drop guard, skip
      // a second Plivo clearAudio which causes audible holes.
      deps.emitEvent("gemini.model_audio_interrupt_clear_skipped_cooldown", {
        reason,
        msSinceLastCut: now - lastPlaybackCutAtMs,
        ...(details ?? {}),
      });
    } else {
      clearAudibleModelAudio(reason, details);
    }
    deps.emitEvent("gemini.model_audio_interrupted", {
      reason,
      ...(details ?? {}),
    });
  }

  function flushSuppressedModelAudioDropLog(): void {
    if (suppressedModelAudioDropChunks <= 0) return;
    console.log(
      `[voice/gemini-live] dropped ${suppressedModelAudioDropChunks} model audio chunk(s) during ${suppressedModelAudioDropReason ?? "unknown"}`,
    );
    deps.emitEvent("gemini.model_audio_dropped_batch", {
      chunks: suppressedModelAudioDropChunks,
      reason: suppressedModelAudioDropReason ?? "unknown",
    });
    suppressedModelAudioDropChunks = 0;
    suppressedModelAudioDropReason = undefined;
  }

  function isSubstantiveUserInterrupt(text: string): boolean {
    return isSubstantiveUserInterruptInput(
      text,
      (t) => deps.classifySemanticTrap(t),
      (classification) => deps.isClearSemanticDecisionIntent(classification),
      INTERRUPT_QUESTION_RE,
    );
  }

  function sendPostInterruptAnswerNudge(userTurnText: string): void {
    // Avoid double-answer: if we already nudged for this barge-in window, skip.
    if (
      lastUserBargeInAtMs > 0 &&
      postInterruptNudgeSentForBargeInAtMs === lastUserBargeInAtMs
    ) {
      deps.emitEvent("gemini.post_interrupt_answer_nudge_skipped_duplicate", {
        text: userTurnText,
      });
      // Still lift mute — a stuck mute after a skipped nudge is dead air.
      clearCustomerSpeechMute("nudge_duplicate_unmute");
      clearModelAudioDropGuard("nudge_duplicate_unmute");
      return;
    }
    if (
      lastUserBargeInAtMs > 0 &&
      assistantAnsweredForBargeInAtMs === lastUserBargeInAtMs
    ) {
      deps.emitEvent("gemini.post_interrupt_answer_nudge_skipped_already_answered", {
        text: userTurnText,
      });
      clearCustomerSpeechMute("nudge_already_answered_unmute");
      clearModelAudioDropGuard("nudge_already_answered_unmute");
      return;
    }
    const wasMuted = muteAgentWhileCustomerSpeaking;
    // Mute means we are intentionally suppressing agent audio — still nudge.
    if (!wasMuted && deps.agentAudioLikelyActive()) {
      deps.emitEvent("gemini.post_interrupt_answer_nudge_skipped_agent_speaking", {
        text: userTurnText,
      });
      return;
    }
    clearCustomerSpeechMute("post_interrupt_nudge");
    clearModelAudioDropGuard("post_interrupt_nudge");
    bargeInRecoveryProtectedUntilMs = Date.now() + BARGE_IN_RECOVERY_PROTECT_MS;
    postInterruptNudgeSentForBargeInAtMs = lastUserBargeInAtMs || Date.now();
    deps.sendClientInstruction(
      `The customer interrupted you and said: "${userTurnText}". ` +
      `Answer that directly now, briefly and naturally. ` +
      `${languageFollowInstruction(
        userTurnText,
        deps.getCampaignLanguage?.(),
        deps.getLastAssistantTurnText(),
      )} ` +
      `Do not repeat your previous sentence.`,
      "post_interrupt_answer",
    );
    deps.emitEvent("gemini.post_interrupt_answer_nudge", {
      text: userTurnText,
    });
  }

  function rememberInboundPayload(payload: string): void {
    recentInboundPayloads = rememberInboundPayloadFrames(
      recentInboundPayloads,
      payload,
      LOCAL_BARGE_IN_PREFIX_FRAMES,
    );
  }

  function replayRecentInboundAudioToGemini(excludeTailFrames = 0): void {
    replayRecentInboundAudio({
      setupComplete: deps.getSetupComplete(),
      callerAudioEnabled: deps.getCallerAudioEnabled(),
      recentInboundPayloads,
      excludeTailFrames,
      onReplayFrame: (frame) => deps.sendGeminiAudio(frame),
      onReplay: (frames, excludedTailFrames) => {
        deps.emitEvent("gemini.replayed_local_barge_in_prefix", {
          frames,
          excludedTailFrames,
        });
      },
    });
  }

  /**
   * Diagnostic: while the agent is speaking, aggregate the caller channel's
   * energy against the gate it has to clear. A caller who shouts and is never
   * heard produces max rms well above dynamicRms (gate failed to arm) or well
   * below it (echo boost too high) — the dump distinguishes the two. Windowed
   * to ~500ms so a 50fps frame path stays cheap and the dump stays readable.
   */
  const PLAYBACK_PROBE_WINDOW_MS = 500;
  let probeStartedAtMs = 0;
  let probeFrames = 0;
  let probeSpeechFrames = 0;
  let probeMaxRms = 0;
  let probeSumRms = 0;
  let probeMaxPeak = 0;
  let probeMaxActiveRatio = 0;
  let probeLastDynamicRms = 0;
  let probeLastNoiseFloor = 0;

  function flushPlaybackProbe(): void {
    if (!probeFrames) return;
    deps.emitEvent("vad.agent_playback_probe", {
      windowMs: Date.now() - probeStartedAtMs,
      frames: probeFrames,
      speechFrames: probeSpeechFrames,
      maxRms: Math.round(probeMaxRms),
      avgRms: Math.round(probeSumRms / probeFrames),
      maxPeak: Math.round(probeMaxPeak),
      maxActiveRatio: Number(probeMaxActiveRatio.toFixed(3)),
      // The three bars the caller had to clear this window. All must pass for
      // a frame to count as speech, so a single one of these can be the reason
      // shouting never registered. Sensitivity is always 1 here (the soft gate
      // only applies when the agent is NOT speaking), so effective = raw * boost.
      gateRms: Math.round(probeLastDynamicRms),
      gatePeak: Math.round(LOCAL_BARGE_IN_MIN_PEAK * LOCAL_BARGE_IN_ECHO_RMS_MULTIPLIER),
      gateActiveRatio: Number(Math.max(0.15, LOCAL_BARGE_IN_MIN_ACTIVE_RATIO).toFixed(3)),
      // Which bar(s) the loudest frame of this window failed.
      failedRms: probeMaxRms < probeLastDynamicRms,
      failedPeak: probeMaxPeak < LOCAL_BARGE_IN_MIN_PEAK * LOCAL_BARGE_IN_ECHO_RMS_MULTIPLIER,
      failedActiveRatio: probeMaxActiveRatio < Math.max(0.15, LOCAL_BARGE_IN_MIN_ACTIVE_RATIO),
      noiseFloorRms: Math.round(probeLastNoiseFloor),
      echoBoost: LOCAL_BARGE_IN_ECHO_RMS_MULTIPLIER,
      rawMinRms: LOCAL_BARGE_IN_MIN_RMS,
      requiredSpeechFrames: requiredLocalBargeInSpeechFrames(),
      bargeInAllowed: localBargeInAllowedNow(),
    });
    probeStartedAtMs = 0;
    probeFrames = 0;
    probeSpeechFrames = 0;
    probeMaxRms = 0;
    probeSumRms = 0;
    probeMaxPeak = 0;
    probeMaxActiveRatio = 0;
  }

  function analyzeInboundSpeechFrame(
    payload: string,
  ): { speech: boolean; speechCandidate: boolean; rms: number; peak: number; activeRatio: number; dynamicRms: number; noiseFloorRms: number } {
    const agentSpeaking = deps.agentAudioAudible?.() ?? deps.agentAudioLikelyActive();
    // Nothing audible is being played to the customer while we're waiting on
    // their answer (free-wheel model audio is dropped before it ever reaches
    // Plivo) — so there is no echo to defend against here. Relax the energy
    // gate so quiet/speakerphone-distance single-word answers ("Tamil",
    // "Kannada") still cross the bar instead of being locally discarded
    // before Gemini ever sees them.
    // Soft energy gate while awaiting the customer's answer: no agent audio is
    // audible in that state, so there is no echo to defend against.
    const noEchoListening = !agentSpeaking && (!userActivityOpen || activityUsesIdleSensitivity);
    const analysis = analyzeInboundSpeechFrameWithNoise(payload, localNoiseFloorRms, {
      minRms: LOCAL_BARGE_IN_MIN_RMS,
      minPeak: LOCAL_BARGE_IN_MIN_PEAK,
      minActiveRatio: LOCAL_BARGE_IN_MIN_ACTIVE_RATIO,
      noiseMultiplier: LOCAL_BARGE_IN_NOISE_MULTIPLIER,
      agentSpeakingBoost: agentSpeaking ? LOCAL_BARGE_IN_ECHO_RMS_MULTIPLIER : 1,
      sensitivityMultiplier: noEchoListening ? AWAITING_CUSTOMER_VAD_SENSITIVITY : 1,
      // The duplex channel contains outbound leakage and possible caller
      // speech. Learning either as ambient noise creates a self-raising gate.
      updateNoiseFloor: !agentSpeaking,
    });
    localNoiseFloorRms = analysis.nextNoiseFloorRms;

    if (agentSpeaking) {
      if (!probeStartedAtMs) probeStartedAtMs = Date.now();
      probeFrames += 1;
      if (analysis.speech) probeSpeechFrames += 1;
      if (analysis.rms > probeMaxRms) probeMaxRms = analysis.rms;
      probeSumRms += analysis.rms;
      if (analysis.peak > probeMaxPeak) probeMaxPeak = analysis.peak;
      if (analysis.activeRatio > probeMaxActiveRatio) probeMaxActiveRatio = analysis.activeRatio;
      probeLastDynamicRms = analysis.dynamicRms;
      probeLastNoiseFloor = analysis.noiseFloorRms;
      if (Date.now() - probeStartedAtMs >= PLAYBACK_PROBE_WINDOW_MS) flushPlaybackProbe();
    } else {
      // Agent stopped mid-window — emit what we have so the boundary is visible.
      flushPlaybackProbe();
    }

    return {
      speech: analysis.speech,
      speechCandidate: analysis.speechCandidate,
      rms: analysis.rms,
      peak: analysis.peak,
      activeRatio: analysis.activeRatio,
      dynamicRms: analysis.dynamicRms,
      noiseFloorRms: analysis.noiseFloorRms,
    };
  }

  function requiredLocalBargeInSpeechFrames(): number {
    return computeRequiredLocalBargeInSpeechFrames(
      deps.getFirstResponseRequested(),
      deps.getOpeningTurnComplete(),
      deps.agentAudioLikelyActive(),
      LOCAL_BARGE_IN_MIN_SPEECH_FRAMES,
    );
  }

  function localBargeInAllowedNow(): boolean {
    if (!LOCAL_BARGE_IN_VAD_ENABLED || deps.isClosed() || dropModelAudioUntilTurnComplete) return false;
    if (Date.now() < userTurnBargeInGraceUntilMs) return false;
    // Ack / semantic / pitch are NOT hard blocks — they only raise the speech-frame
    // bar below. Hard-blocking made barge-in feel broken (agent kept talking).
    if (!deps.agentAudioLikelyActive()) return false;
    if (deps.getFirstResponseRequested() && !deps.getOpeningTurnComplete()) {
      const openingAudioStartedAtMs = deps.getOpeningAudioStartedAtMs();
      if (!openingAudioStartedAtMs) return false;
      return Date.now() - openingAudioStartedAtMs >= OPENING_LOCAL_BARGE_IN_MIN_AUDIO_MS;
    }
    return true;
  }

  function handleLocalBargeInVad(payload: string): void {
    if (!LOCAL_BARGE_IN_VAD_ENABLED || deps.isClosed()) return;

    const agentAudibleAtFrame =
      deps.agentAudioAudible?.() ?? deps.agentAudioLikelyActive();
    const analysis = analyzeInboundSpeechFrame(payload);
    if (analysis.speech) {
      // Real audio energy from caller: allow short outbound ducking.
      markLocalCallerSpeech(Date.now(), true);
      deps.setVoiceLastSpeechFrameMs(deps.streamOffsetMs()); // U2: speech-gated EOU proxy (KTD4 c.1)
      // NOTE: awaitingCustomerResponse is deliberately NOT released here. This
      // frame was only detected because awaiting lowered the VAD bar; clearing
      // it now raises the bar again mid-utterance and starves
      // trackClientActivity of the consecutive frames it needs. The release
      // moved into signalActivityStart — see the comment there.
      if (
        deps.getAwaitingCustomerResponse() &&
        deps.getOpeningTurnComplete() &&
        !deps.getCallerAudioEnabled()
      ) {
        deps.enableCallerAudioAfterOpening();
      }
    }

    // During duplex playback, energetic frames are ambiguous: they may be the
    // caller or speakerphone echo. Start a reversible outbound hold on either
    // kind of voice-like evidence, then wait for the already-sent Plivo
    // cushion to drain. Only the clean no-echo frames below may open a new
    // caller activity window. This replaces handset-sensitive runs of 11
    // perfect frames with an acoustic state transition that works the same way
    // across gain, codec and background-noise differences.
    const duplexCandidateAllowed =
      (analysis.speech || analysis.speechCandidate) &&
      (agentAudibleAtFrame || duplexCandidateHoldActive) &&
      localBargeInAllowedNow();
    if (duplexCandidateAllowed) {
      if (observeDuplexCandidate(Date.now())) return;
    } else if (!analysis.speech) {
      observeNoDuplexCandidate();
    }

    // Client-owned turns: only stream audio inside activityStart→activityEnd.
    // Never open a fresh activity window from acoustically mixed playback;
    // doing so lets persistent echo confirm itself. Once the sent cushion has
    // drained, agentAudibleAtFrame becomes false even though the held local
    // queue remains intact, and normal low-latency activity detection resumes.
    const cleanActivitySpeech =
      analysis.speech && (!agentAudibleAtFrame || userActivityOpen);
    trackClientActivity(payload, cleanActivitySpeech);

    // After the opener, barge-in must work even when free-wheel audio is dropped
    // (outbound looks idle) — otherwise we only "start listening" once Gemini finishes.
    const awaitingPostOpen =
      deps.getAwaitingCustomerResponse() && deps.getOpeningTurnComplete();
    if (!localBargeInAllowedNow() && !awaitingPostOpen) {
      if (!deps.agentAudioLikelyActive()) {
        localBargeInSpeechFrames = 0;
        localBargeInSilenceFrames = 0;
      }
      return;
    }
    if (!localBargeInAllowedNow() && awaitingPostOpen) {
      // Fall through with a lighter path: clear any stuck drop / ensure listen.
      if (!analysis.speech) return;
      if (!deps.getCallerAudioEnabled()) {
        deps.enableCallerAudioAfterOpening();
      }
      return;
    }

    if (!analysis.speech) {
      localBargeInSilenceFrames += 1;
      if (localBargeInSilenceFrames >= LOCAL_BARGE_IN_RESET_SILENCE_FRAMES) {
        localBargeInSpeechFrames = 0;
        localBargeInSilenceFrames = 0;
      }
      return;
    }

    localBargeInSpeechFrames += 1;
    localBargeInSilenceFrames = 0;
    let framesNeeded = requiredLocalBargeInSpeechFrames();
    // Echo-prone windows need a bit more sustained speech — never a hard block.
    if (
      isAckProtected() ||
      deps.isAgentTurnBargeInProtected() ||
      shouldProtectPitchPlayback({
        lastAssistantText: deps.getLastAssistantTurnText(),
        currentOutputBuffer: deps.getOutputTranscriptBuffer(),
      })
    ) {
      framesNeeded = Math.max(framesNeeded + 2, Math.ceil(framesNeeded * 1.5));
    }
    if (localBargeInSpeechFrames < framesNeeded) return;

    const now = Date.now();
    if (now - lastLocalBargeInAtMs < LOCAL_BARGE_IN_COOLDOWN_MS) return;
    lastLocalBargeInAtMs = now;
    localBargeInSpeechFrames = 0;
    localBargeInSilenceFrames = 0;

    const duringOpening = deps.getFirstResponseRequested() && !deps.getOpeningTurnComplete();
    const replayPrefix = !deps.getCallerAudioEnabled();
    if (replayPrefix) {
      deps.enableCallerAudioAfterOpening();
      replayRecentInboundAudioToGemini(1);
    }
    if (deps.getUserTurnStartMs() === undefined) {
      deps.setUserTurnStartMs(deps.streamOffsetMs());
    }
    // Hard interrupt + keep agent muted until we plan a reply. Clearing drop on
    // turnComplete alone let Gemini keep talking over the customer.
    armCustomerSpeechMute("local_vad_barge_in");
    interruptCurrentModelAudio("local_vad_barge_in", {
      rms: Math.round(analysis.rms),
      peak: analysis.peak,
      activeRatio: Number(analysis.activeRatio.toFixed(3)),
      dynamicRms: Math.round(analysis.dynamicRms),
      noiseFloorRms: Math.round(analysis.noiseFloorRms),
      duringOpening,
    });
    console.log(
      `[voice/gemini-live] local VAD barge-in rms=${Math.round(analysis.rms)}` +
        ` dynamicRms=${Math.round(analysis.dynamicRms)}` +
        ` noiseFloor=${Math.round(analysis.noiseFloorRms)}` +
        ` peak=${analysis.peak} activeRatio=${analysis.activeRatio.toFixed(3)}`,
    );
  }

  /**
   * Silero (neural) VAD runs in parallel with the RMS/energy heuristic above
   * and only ever ADDS a trigger to open Gemini's activity window — it never
   * closes one and never suppresses the RMS path (activityEnd still comes
   * from trackClientActivity's normal silence accounting either way, since
   * every frame keeps flowing through handleLocalBargeInVad regardless of who
   * opened the window). Scoped deliberately to the awaiting-customer /
   * no-echo state ("yes/no" follow-ups): that's
   * where quiet, monosyllable, speakerphone-distance answers were being
   * missed by the amplitude-only heuristic even after relaxing its
   * thresholds — a false positive there is cheap (just re-arms the window),
   * unlike the general mid-call barge-in path, which already fights real
   * playback echo and can't afford extra false triggers.
   */
  function notifySileroSpeechStart(): void {
    if (!deps.getAwaitingCustomerResponse() || deps.agentAudioLikelyActive()) return;
    markLocalCallerSpeech(Date.now(), false);
    if (!userActivityOpen) {
      signalActivityStart("silero_vad_speech");
    }
    if (deps.getOpeningTurnComplete() && !deps.getCallerAudioEnabled()) {
      deps.enableCallerAudioAfterOpening();
    }
    if (deps.getOpeningTurnComplete() && !deps.isAgentTurnBargeInProtected()) {
      deps.releaseAwaitingCustomerResponse("silero_vad_speech");
    }
    deps.emitEvent("gemini.silero_vad_speech_start");
  }

  function clearPostBargeInNudge(reason: string): void {
    if (!postBargeInNudgeTimer) return;
    clearTimeout(postBargeInNudgeTimer);
    postBargeInNudgeTimer = undefined;
    deps.emitEvent("gemini.post_barge_in_nudge_cancelled", { reason });
  }

  function schedulePostBargeInNudge(userTurnText: string): void {
    if (deps.isClosed() || !deps.getSetupComplete()) return;
    if (!lastUserBargeInAtMs || Date.now() - lastUserBargeInAtMs > POST_INTERRUPT_ANSWER_WINDOW_MS) return;
    if (!isSubstantiveUserInterrupt(userTurnText)) return;
    if (
      lastUserBargeInAtMs > 0 &&
      (postInterruptNudgeSentForBargeInAtMs === lastUserBargeInAtMs ||
        assistantAnsweredForBargeInAtMs === lastUserBargeInAtMs)
    ) {
      return;
    }

    clearPostBargeInNudge("rescheduled");
    const bargeInAtMs = lastUserBargeInAtMs;
    postBargeInNudgeTimer = setTimeout(() => {
      postBargeInNudgeTimer = undefined;
      // Do not abort on localCallerSpeechActive hangover or drop/mute — those are
      // exactly when a longer barge-in needs a forced answer nudge.
      if (
        deps.isClosed() ||
        !deps.getSetupComplete() ||
        deps.getAwaitingCustomerResponse() ||
        (deps.agentAudioLikelyActive() && !muteAgentWhileCustomerSpeaking) ||
        assistantAnsweredForBargeInAtMs === bargeInAtMs ||
        postInterruptNudgeSentForBargeInAtMs === bargeInAtMs
      ) {
        deps.emitEvent("gemini.post_barge_in_nudge_aborted", {
          reason:
            assistantAnsweredForBargeInAtMs === bargeInAtMs
              ? "assistant_already_answered"
              : postInterruptNudgeSentForBargeInAtMs === bargeInAtMs
                ? "already_nudged"
                : "conditions_not_met",
          text: userTurnText,
        });
        return;
      }
      sendPostInterruptAnswerNudge(userTurnText);
    }, POST_BARGE_IN_NUDGE_MS);
    deps.emitEvent("gemini.post_barge_in_nudge_scheduled", {
      delayMs: POST_BARGE_IN_NUDGE_MS,
      text: userTurnText,
    });
  }

  return {
    localCallerSpeechActive,
    localPlaybackDuckActive,
    markLocalCallerSpeech,
    armPostUserTurnBargeInGrace,
    getUserTurnBargeInGraceUntilMs: () => userTurnBargeInGraceUntilMs,

    isDropModelAudioActive: () => dropModelAudioUntilTurnComplete,
    /**
     * The turnComplete / turn-dropped release path (gemini-handler) comes
     * through here rather than clearModelAudioDropGuard, so it must do the two
     * things that path also does: cancel the max-age backstop, and SAY SO.
     *
     * It used to do neither. The silence cost real analysis time on 2026-07-29:
     * with no event, dumps showed the guard arming and never coming down, and a
     * scoreboard built on those dumps reported p90 9254ms and 116 calls with a
     * stuck guard. Measured properly the same corpus is p90 183ms. An invisible
     * state transition is indistinguishable from a hung one.
     */
    setDropModelAudioActive: (value) => {
      const previous = dropModelAudioUntilTurnComplete;
      dropModelAudioUntilTurnComplete = value;
      if (previous && !value) {
        if (dropGuardMaxAgeTimer) {
          clearTimeout(dropGuardMaxAgeTimer);
          dropGuardMaxAgeTimer = undefined;
        }
        deps.emitEvent("gemini.model_audio_drop_guard_cleared", {
          reason: "turn_boundary",
          previousDropReason: modelAudioDropReason ?? "unknown",
        });
      }
    },
    getModelAudioDropReason: () => modelAudioDropReason,
    setModelAudioDropReason: (value) => { modelAudioDropReason = value; },
    setDropModelAudio,
    clearModelAudioDropGuard,
    isCustomerSpeechMuteActive,
    armCustomerSpeechMute,
    clearCustomerSpeechMute,
    recoverFromEmptyBargeIn,
    recoverFromUnclearBargeIn,
    noteRejectedSpeech,
    isBargeInRecoveryProtected,

    tryClearAudiblePlayback,
    clearAudibleModelAudio,
    interruptCurrentModelAudio,

    flushSuppressedModelAudioDropLog,
    getSuppressedModelAudioDropReason: () => suppressedModelAudioDropReason,
    setSuppressedModelAudioDropReason: (value) => { suppressedModelAudioDropReason = value; },
    getSuppressedModelAudioDropChunks: () => suppressedModelAudioDropChunks,
    setSuppressedModelAudioDropChunks: (value) => { suppressedModelAudioDropChunks = value; },

    getLastUserBargeInAtMs: () => lastUserBargeInAtMs,
    getLastPlaybackCutAtMs: () => lastPlaybackCutAtMs,

    isSubstantiveUserInterrupt,
    sendPostInterruptAnswerNudge,

    rememberInboundPayload,
    handleLocalBargeInVad,
    notifySileroSpeechStart,
    isUserActivityOpen,
    hasRecentUserActivityEvidence,
    resolveUserActivityResponse,
    clearUserActivityRecovery,
    hasRecentBargeInCandidateEvidence,

    clearPostBargeInNudge,
    schedulePostBargeInNudge,
    noteAssistantAnsweredAfterBargeIn,
    protectAckUntil,
    isAckProtected,
  };
}
