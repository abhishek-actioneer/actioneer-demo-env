import { WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { resolveCallConfig } from "./voice-call-config-resolver";
import { removeCallConfig, storeCallConfig, type CallConfig } from "./voice-call-state";
import { findCall, getCampaign, upsertCall } from "./voice-campaign-store";
import { createVoiceBridgeRecorder, type VoiceBridgeRecorder } from "./voice-bridge-recorder";
import { createVoiceForensicsSession, type BiomarkerKeySource } from "./voice-forensics";
import { createVoiceBiometricLiveSession } from "./voice-biometric/session";
import { DEFAULT_DATASET } from "./datasets/constants";
import { ensureGeminiLiveConfig } from "./voice-agent-provider";
import type {
  VoiceCallLatency,
  VoiceTranscriptTurn,
  VoiceTurnLatency,
} from "./voice-campaign-types";
import { hasGeminiRealtimeTranscript } from "./voice-transcript-sort";
import {
  deriveTurnLatencies,
  emitVoiceLifecycle,
  emitVoiceTurn,
  makeSpeechId,
  type EouSource,
  type VoiceTurnRecord,
} from "./voice-events";
import { createVoiceSessionDump } from "./voice-debug-dump";
import { terminatePlivoCall } from "./plivo-client";
import { enqueueCallEvent } from "./server/call-event-outbox-repo";
import {
  CLIENT_CONTROLLED_ACTIVITY_ENABLED,
  DETECT_AUTOMATED_SCREENING,
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_VOICE,
  liveTranscriptFollowUpEnabled,
  LOCAL_BARGE_IN_VAD_ENABLED,
  OPENING_AUDIO_GRACE_MS,
  OUTBOUND_BATCH_BYTES,
  OUTBOUND_PREROLL_BYTES,
  OUTBOUND_PUMP_INTERVAL_MS,
  outboundMaxFramesPerTick,
  outboundTargetCushionMs,
  PLIVO_FRAME_DURATION_MS,
  PLIVO_MULAW_FRAME_BYTES,
  seedTurnsEnabled,
  STORE_REALTIME_TRANSCRIPT,
  buildGeminiLiveSystemInstruction,
  geminiSetupPayload,
  logGeminiLiveSystemInstruction,
  openGeminiSocket,
  resolveGeminiVoice,
} from "./plivo-gemini-live-config";
import { claimWarmGeminiSession, dropPendingWarmSessionBeforeClaim } from "./plivo-gemini-live-prewarm";
import {
  callIdFromRequest,
  isOpen,
  objectValue,
  parseEvent,
  sendJson,
  socketCanClose,
  stringValue,
} from "./plivo-gemini-live-ws-utils";
import { sendGeminiAudioIfAllowed } from "./plivo-gemini-live-stream-utils";
import { createOutboundAudioController } from "./plivo-gemini-live-outbound-controller";
import { createSemanticController } from "./plivo-gemini-live-semantic-controller";
import { createGeminiMessageHandler, type GeminiHandlerDeps } from "./plivo-gemini-live-gemini-handler";
import { createOpeningController } from "./plivo-gemini-live-opening";
import { createBargeInController } from "./plivo-gemini-live-barge-in";
import { createSileroVadSession, type SileroVadSession } from "./plivo-gemini-live-vad";
import { createInstructionQueue } from "./plivo-gemini-live-instructions";
import { createCallControlRuntime } from "./plivo-gemini-live-call-runtime";
import { createCallerIdleController } from "./plivo-gemini-live-caller-idle";
import {
  createUserTurnFlusher,
  queuePostCallFollowupFromLiveTranscript,
  recordLiveTranscriptTurn,
} from "./plivo-gemini-live-user-turn";

export { prewarmGeminiLiveCallSession, refreshGeminiPrewarmOnAnswer } from "./plivo-gemini-live-prewarm";

/** Nearest-rank percentile over an ascending-sorted array (ms). */
function latencyPercentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank))];
}

function cleanString(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function voiceForensicsName(config: CallConfig | undefined): string | undefined {
  return cleanString(config?.customerContext?.displayName) ||
    cleanString(config?.customerContext?.firstName);
}

function voiceForensicsExpectedGender(config: CallConfig | undefined): "male" | "female" | null {
  const gender = config?.customerContext?.gender;
  return gender === "male" || gender === "female" ? gender : null;
}

/**
 * Biomarker identity for this call: the customer's dataset id, else the pinned
 * verification subject, else the other party's phone number. Deliberately NOT
 * `config.userId` — that is the tenant/agent owner's Clerk id, and keying on it
 * collapsed every caller into one shared voiceprint bucket. The key source
 * travels with the id: it selects the gallery's enrollment policy
 * (verify-then-refresh / frozen / verification-only).
 */
function voiceForensicsIdentity(
  config: CallConfig | undefined,
): { id: string; source: BiomarkerKeySource } | undefined {
  const phone = cleanString(config?.toNumber);
  // Live-test calls carry a MOCK customerContext for prompt personalization;
  // the voice on the line is the tester. Key by the dialed phone (matched
  // against the gallery, never enrolled) so the tester's voice can never
  // become a sampled customer's reference.
  if (config?.isTestCall === true) {
    return phone ? { id: phone, source: "phone" } : undefined;
  }
  const customerId = cleanString(config?.customerContext?.investorId);
  if (customerId) {
    // Dialed number didn't match this customer's registered phone: the voice on
    // the line may not be the customer. Bench against their reference, but the
    // verification-only policy blocks enrollment.
    if (config?.voiceIdentityPhoneVerified === false) {
      return { id: customerId, source: "unverified-customer" };
    }
    return { id: customerId, source: "customer-id" };
  }
  const subjectId = cleanString(config?.verificationSubjectId);
  if (subjectId) return { id: subjectId, source: "pinned-subject" };
  if (phone) return { id: phone, source: "phone" };
  return undefined;
}

/**
 * Fold the per-turn spine records collected during a call into the durable
 * VoiceCallLatency summary written onto the call record at hangup. Pure; the
 * aggregates cover only turns with a measurable voice_to_voice_ms (interrupted
 * turns with no agent audio are counted in turnCount but excluded from stats).
 */
export function summarizeVoiceTurnLatencies(
  records: VoiceTurnRecord[],
  eouSource: EouSource,
): VoiceCallLatency {
  const turns: VoiceTurnLatency[] = records.map((r) => ({
    turnIndex: r.turn_index,
    eouProxyMs: r.eou_proxy_ms,
    eouSource: r.eou_source,
    voiceToVoiceMs: r.voice_to_voice_ms,
    detectionThinkMs: r.detection_think_ms,
    responseLagMs: r.response_lag_ms,
    totalTurnMs: r.total_turn_ms,
    interrupted: r.interrupted,
  }));
  const measured = turns
    .map((t) => t.voiceToVoiceMs)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
  const avg = measured.length
    ? Math.round(measured.reduce((sum, v) => sum + v, 0) / measured.length)
    : null;
  return {
    turnCount: turns.length,
    measuredCount: measured.length,
    v2vP50Ms: latencyPercentile(measured, 50),
    v2vP90Ms: latencyPercentile(measured, 90),
    v2vMaxMs: measured.length ? measured[measured.length - 1] : null,
    v2vAvgMs: avg,
    eouSource,
    turns,
  };
}

export function handlePlivoGeminiLiveMediaStream(plivoWs: WebSocket, req: IncomingMessage): void {
  console.log(`[voice/gemini-live] Media stream connected url=${req.url ?? ""} epochMs=${Date.now()}`);
  const callId = callIdFromRequest(req);
  const callConfig = callId ? resolveCallConfig(callId) : undefined;
  // U2: WS-connected lifecycle event (additive; keyed by call_id).
  if (callId) emitVoiceLifecycle("voice_ws_connected", {}, callId, "gemini_live");
  const connectedAt = Date.now();
  const sessionDump = createVoiceSessionDump({
    endpoint: "plivo-gemini-live-session",
    identityParts: [callConfig?.campaignId, callId],
    metadata: {
      callId,
      campaignId: callConfig?.campaignId,
      provider: "plivo-gemini",
      url: req.url,
      model: GEMINI_LIVE_MODEL,
      voice: callConfig?.voice || GEMINI_LIVE_VOICE,
      callConfig: callConfig ? {
        campaignId: callConfig.campaignId,
        systemPrompt: callConfig.systemPrompt,
        firstMessage: callConfig.firstMessage,
        voice: callConfig.voice,
        voiceName: callConfig.voiceName,
        language: callConfig.language,
        toNumber: callConfig.toNumber,
        customerContext: callConfig.customerContext,
      } : undefined,
      storeRealtimeTranscript: STORE_REALTIME_TRANSCRIPT,
      detectAutomatedScreening: DETECT_AUTOMATED_SCREENING,
      liveTranscriptFollowUp: liveTranscriptFollowUpEnabled(),
    },
  });
  sessionDump.event("media.connected", {
    callId,
    campaignId: callConfig?.campaignId,
    hasCallConfig: Boolean(callConfig),
    url: req.url,
  });

  let streamId: string | undefined;
  let currentCallUuid: string | undefined;
  let geminiWs: WebSocket | undefined;
  let closed = false;
  let setupComplete = false;
  let bridgeRecorder: VoiceBridgeRecorder | undefined;
  // User-side voice forensics (gender / speaker verification / deepfake-LA /
  // replay-PA). Additive + fault-isolated: accumulates user-only audio to ~5s and
  // runs the analyzers on a rolling basis. Covers inbound and outbound (this is
  // the single shared bridge). No-op when VOICE_FORENSICS_ENABLED=false.
  const forensicsIdentity = voiceForensicsIdentity(callConfig);
  const forensics = createVoiceForensicsSession({
    callId: callId ?? "",
    datasetId: callConfig?.datasetId ?? DEFAULT_DATASET,
    campaignId: callConfig?.campaignId,
    phone: callConfig?.toNumber,
    name: voiceForensicsName(callConfig),
    gender: voiceForensicsExpectedGender(callConfig),
    userId: forensicsIdentity?.id,
    biomarkerId: forensicsIdentity?.id,
    keySource: forensicsIdentity?.source,
    enrollOnce: forensicsIdentity?.source === "pinned-subject",
  });
  let biometric: ReturnType<typeof createVoiceBiometricLiveSession> | undefined;
  let sileroVad: SileroVadSession | undefined;
  let latestTimestamp = 0;
  let outputTranscriptBuffer = "";
  /**
   * Last non-empty assistant text wiped by a clear, kept so an interrupted turn
   * can still be recorded. The barge-in and semantic paths clear the buffer at
   * the moment of the cut, which is well before turnComplete reaches the drop
   * branch — reading the buffer there always found "" and every barge-in turn
   * vanished from the transcript (call 9w6t3: 4 drops, 0 recorded).
   */
  let lastClearedOutputTranscript = "";
  /** Wipe the live buffer, preserving what it held for the drop path. */
  const takeOutputTranscriptBuffer = (): void => {
    const pending = outputTranscriptBuffer.trim();
    if (pending) lastClearedOutputTranscript = pending;
    outputTranscriptBuffer = "";
  };
  let transcriptSequence = 0;
  let liveTranscriptTurns: VoiceTranscriptTurn[] = [];
  let outboundAudioChunks = 0;
  let postCallFollowUpQueued = false;
  let pendingUserTranscript = "";
  let pendingUserTranscriptAcousticallyVerified = false;
  let geminiSetupRetryUsed = false;
  let disconnectInitiated = false;
  let awaitingCustomerResponse = false;
  let streamClockStartedAtMs: number | null = null;
  let userTurnStartMs: number | undefined;
  let assistantTurnStartMs: number | undefined;
  let disconnectAfterPlaybackTimer: NodeJS.Timeout | undefined;
  let lastMeaningfulUserSpeechAtMs = 0;
  let customerTurnCount = 0;
  let turnPlanDedupe = { fingerprint: "", atMs: 0 };

  // Wired after bargeIn/callerIdle are created (circular controller callbacks).
  const bridgeCallbacks: {
    clearCustomerSpeechMute?: (reason: string) => void;
    cancelCallerIdlePrompt?: (reason: string) => void;
  } = {};
  const instructions = createInstructionQueue({
    isClosed: () => closed,
    getGeminiWs: () => geminiWs,
    getSetupComplete: () => setupComplete,
    isDropModelAudioActive: () => bargeIn.isDropModelAudioActive(),
    getAwaitingCustomerResponse: () => awaitingCustomerResponse,
    agentAudioLikelyActive: () => agentAudioLikelyActive(),
    clearCustomerSpeechMute: (reason) => bridgeCallbacks.clearCustomerSpeechMute?.(reason),
    sessionDump,
  });
  if (callConfig?.isVoiceBiometricDemo && callConfig.userId) {
    biometric = createVoiceBiometricLiveSession({
      tenantUserId: callConfig.userId,
      datasetId: callConfig.datasetId ?? "hdfc-creditfraud",
      callbacks: {
        onStatus: (stage, detail) => sessionDump.event("voice_biometric.status", { stage, ...detail }),
        onChallenge: (challenge) => {
          instructions.sendClientInstruction(
            `VOICE_BIOMETRIC_SERVER CHALLENGE: Ask the caller to repeat exactly: "${challenge}". Do not reveal any profile yet.`,
            "voice_biometric_challenge",
          );
        },
        onIdentified: (enrollment, similarity) => {
          callConfig.customerContext = {
            source: "generic",
            datasetId: callConfig.datasetId ?? "hdfc-creditfraud",
            investorId: enrollment.subjectId,
            firstName: enrollment.displayName.split(/\s+/)[0],
            displayName: enrollment.displayName,
          };
          storeCallConfig(callId ?? enrollment.subjectId, callConfig);
          const profile = enrollment.profile;
          const transactions = profile.recentTransactions
            .map((item) => `${item.label}: INR ${item.amountInr}`)
            .join("; ");
          instructions.sendClientInstruction(
            `VOICE_BIOMETRIC_SERVER VERIFIED. The caller is ${profile.displayName}. This is simulated data: account ${profile.accountNumberMasked}, available balance INR ${profile.balanceInr}, recent transactions: ${transactions}. Greet them and offer balance or recent transaction help. Never describe the biometric score.`,
            "voice_biometric_verified",
          );
          sessionDump.event("voice_biometric.identified", {
            subjectId: enrollment.subjectId,
            similarity,
          });
        },
        onRejected: (reason) => {
          instructions.sendClientInstruction(
            "VOICE_BIOMETRIC_SERVER REJECTED. Say you could not reliably verify the caller and cannot open a profile. Do not reveal candidate names or scores.",
            "voice_biometric_rejected",
          );
          sessionDump.event("voice_biometric.rejected", { reason });
        },
      },
    });
  }

  const callControl = createCallControlRuntime({
    sessionDump,
    getCallConfig: () => callConfig,
    sendClientInstruction: (text, reason, options) => instructions.sendClientInstruction(text, reason, options),
    setDropModelAudio: (reason) => bargeIn.setDropModelAudio(reason),
    clearPlivoAudio: (reason) => clearPlivoAudio(reason),
    clearOutputTranscriptBuffer: () => {
      takeOutputTranscriptBuffer();
    },
  });

  const semantic = createSemanticController({
    getLanguage: () => callConfig?.language ?? "",
    getCallConfig: () => callConfig,
    sendClientInstruction: (text, reason, options) => instructions.sendClientInstruction(text, reason, options),
    emitEvent: (event, payload) => sessionDump.event(event, payload),
    clearPlivoAudio: (reason) => clearPlivoAudio(reason),
    isDropModelAudioActive: () => bargeIn.isDropModelAudioActive(),
    setSemanticTrapAudioDrop: () => bargeIn.setDropModelAudio("semantic_trap"),
    clearOutputTranscriptBuffer: () => {
      takeOutputTranscriptBuffer();
    },
    getOutboundQueuedBytes: () => outbound.queuedBytes(),
    getAssistantTurnStartMs: () => assistantTurnStartMs,
  });

  const opening = createOpeningController({
    isClosed: () => closed,
    getCallConfig: () => callConfig,
    setAwaitingCustomerResponse: (value) => { awaitingCustomerResponse = value; },
    sendClientInstruction: (text, reason) => instructions.sendClientInstruction(text, reason),
    emitEvent: (event, payload) => sessionDump.event(event, payload),
  });

  const bargeIn = createBargeInController({
    isClosed: () => closed,
    getSetupComplete: () => setupComplete,
    getGeminiWs: () => geminiWs,
    getCallerAudioEnabled: () => opening.isCallerAudioEnabled(),
    getAwaitingCustomerResponse: () => awaitingCustomerResponse,
    releaseAwaitingCustomerResponse: (reason) => releaseAwaitingCustomerResponse(reason),
    getUserTurnStartMs: () => userTurnStartMs,
    setUserTurnStartMs: (value) => { userTurnStartMs = value; },
    getPendingUserTranscript: () => pendingUserTranscript,
    agentAudioLikelyActive: () => agentAudioLikelyActive(),
    agentAudioAudible: () => outbound.isPlayoutActive(),
    outboundQueuedBytes: () => outbound.queuedBytes(),
    isAgentTurnBargeInProtected: () => semantic.isAgentTurnBargeInProtected(),
    classifySemanticTrap: (text) => semantic.classify(text),
    isClearSemanticDecisionIntent: (classification) => semantic.isClearDecisionIntent(classification),
    getCampaignLanguage: () => callConfig?.language,
    getCallConfig: () => callConfig,
    sendClientInstruction: (text, reason, options) => instructions.sendClientInstruction(text, reason, options),
    clearPlivoAudio: (reason) => clearPlivoAudio(reason),
    clearOutputTranscriptBuffer: () => {
      takeOutputTranscriptBuffer();
    },
    emitEvent: (event, payload) => sessionDump.event(event, payload),
    markVoiceInterruptedThisTurn: () => { voiceInterruptedThisTurn = true; },
    setVoiceLastSpeechFrameMs: (ms) => { voiceLastSpeechFrameMs = ms; },
    streamOffsetMs: () => streamOffsetMs(),
    sendGeminiAudio: (payload) => sendGeminiAudio(payload),
    pauseOutboundPlayback: () => outbound.pause(),
    resumeOutboundPlayback: () => outbound.resume(),
    holdOutboundPlayback: (reason) => outbound.hold(reason),
    releaseOutboundPlayback: (reason) => outbound.release(reason),
    getFirstResponseRequested: () => opening.isFirstResponseRequested(),
    getOpeningTurnComplete: () => opening.isOpeningTurnComplete(),
    markOpeningTurnComplete: () => opening.markOpeningTurnComplete(),
    getOpeningAudioStartedAtMs: () => opening.getOpeningAudioStartedAtMs(),
    enableCallerAudioAfterOpening: () => opening.enableCallerAudioAfterOpening(),
    getLastAssistantTurnText: () => semantic.getLastAssistantTurnText(),
    getOutputTranscriptBuffer: () => outputTranscriptBuffer,
    onUserActivityStart: (reason) =>
      bridgeCallbacks.cancelCallerIdlePrompt?.(`user_activity:${reason}`),
  });
  bridgeCallbacks.clearCustomerSpeechMute = (reason) => bargeIn.clearCustomerSpeechMute(reason);

  // Best-effort, additive-only — see notifySileroSpeechStart. Async model
  // load; if the call closes before it resolves, destroy immediately instead
  // of leaking the ONNX session.
  void createSileroVadSession({
    onSpeechStart: () => bargeIn.notifySileroSpeechStart(),
    onSpeechEnd: () => sessionDump.event("silero_vad.speech_end", {}),
    onMisfire: () => sessionDump.event("silero_vad.misfire", {}),
  }).then((session) => {
    if (closed) {
      void session?.destroy();
      return;
    }
    sileroVad = session;
  });

  // ── U2: additive voice-observability locals (KTD3/KTD4). Reads only; no audio
  //    decision, threshold, or pump behavior depends on any of these. ──────────
  const voiceEouSource: EouSource = LOCAL_BARGE_IN_VAD_ENABLED ? "gemini_vad_proxy" : "raw_frame_proxy";
  let voiceTurnIndex = 0;
  let voiceLastSpeechFrameMs: number | null = null; // last SPEECH frame (KTD4 c.1)
  let voiceModelStartMs: number | undefined;        // first model audio chunk of turn (KTD4 c.2)
  let voiceEouProxyMs: number | null = null;        // frozen = lastSpeech at model-start
  let voiceFirstAudioOutMs: number | undefined;     // first outbound audio of turn
  let voiceInterruptedThisTurn = false;
  const voiceInterruptedTurnIndices: number[] = []; // spine ground truth for U7 (R11)
  const voiceTurnRecords: VoiceTurnRecord[] = [];    // accumulated for durable per-call summary

  function streamOffsetMs(): number {
    if (streamClockStartedAtMs != null) {
      return Math.max(0, Date.now() - streamClockStartedAtMs);
    }
    return Math.max(0, Date.now() - connectedAt);
  }

  function mediaStreamOffsetMs(): number {
    return streamOffsetMs();
  }

  // U2: assemble + emit one voice_turn record at the turnComplete seam, then
  // reset per-turn locals. All four clocks are streamOffsetMs() reads (KTD4 c.3).
  // Fires once per turnComplete (including interrupted/dropped turns).
  function flushVoiceTurn(turnCompleteMs: number): void {
    // Gate dynamically inside emitVoiceTurn (reads process.env at call time), NOT
    // on an import-time const — under the custom server, voice-events.ts is
    // imported before Next loads .env.local, so a const would freeze `false` and
    // silently drop every voice_turn when the flag comes from an env file.
    if (callId) {
      const derived = deriveTurnLatencies(
        voiceEouProxyMs,
        voiceModelStartMs ?? null,
        voiceFirstAudioOutMs ?? null,
        turnCompleteMs,
      );
      const record: VoiceTurnRecord = {
        speech_id: makeSpeechId(callId, voiceTurnIndex),
        turn_index: voiceTurnIndex,
        eou_proxy_ms: derived.eou_proxy_ms,
        eou_source: voiceEouSource,
        voice_to_voice_ms: derived.voice_to_voice_ms,
        detection_think_ms: derived.detection_think_ms,
        response_lag_ms: derived.response_lag_ms,
        total_turn_ms: derived.total_turn_ms,
        interrupted: voiceInterruptedThisTurn,
      };
      // Keep for the durable per-call summary written at hangup (in addition to
      // the fire-and-forget PostHog/stdout emit below).
      voiceTurnRecords.push(record);
      emitVoiceTurn(record, callId, "gemini_live");
    }
    if (voiceInterruptedThisTurn) voiceInterruptedTurnIndices.push(voiceTurnIndex);
    voiceTurnIndex += 1;
    voiceModelStartMs = undefined;
    voiceEouProxyMs = null;
    voiceFirstAudioOutMs = undefined;
    voiceInterruptedThisTurn = false;
  }

  function scheduleAgentDisconnect(triggerText: string, reason: string): void {
    if (disconnectInitiated || disconnectAfterPlaybackTimer) return;
    const queuedMs = outbound.queuedDurationMs();
    const delayMs = Math.max(OPENING_AUDIO_GRACE_MS, queuedMs + 600);
    console.log(`[voice/gemini-live] scheduling agent disconnect in ${delayMs}ms reason=${reason}`);
    sessionDump.event("call.disconnect_scheduled", {
      reason,
      delayMs,
      triggerText,
    });
    disconnectAfterPlaybackTimer = setTimeout(() => {
      disconnectAfterPlaybackTimer = undefined;
      void requestAgentDisconnect(triggerText, reason);
    }, delayMs);
  }

  async function requestAgentDisconnect(triggerText: string, reason: string): Promise<void> {
    if (disconnectInitiated) return;
    disconnectInitiated = true;
    if (!currentCallUuid || !callConfig) {
      closeBoth("agent-disconnect-missing-call");
      return;
    }

    const found = findCall(currentCallUuid);
    if (found?.campaign.userId && found.campaign.datasetId) {
      try {
        enqueueCallEvent({
          userId: found.campaign.userId,
          datasetId: found.campaign.datasetId,
          campaignId: found.campaign.id,
          callId: currentCallUuid,
          provider: "plivo",
          eventType: "call.agent_disconnect",
          payload: {
            reason,
            triggerText,
            at: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error("[voice/gemini-live] Failed to enqueue agent disconnect event:", error);
      }
    }

    try {
      await terminatePlivoCall(currentCallUuid);
    } catch (error) {
      console.error("[voice/gemini-live] Failed to terminate call via Plivo API:", error);
    } finally {
      upsertCall(callConfig.campaignId, {
        id: currentCallUuid,
        status: "completed",
        summary: "Call ended by agent workflow action",
        endedAt: new Date().toISOString(),
      });
      closeBoth("agent-requested-disconnect");
    }
  }

  const { flushPendingUserTranscript } = createUserTurnFlusher({
    sessionDump,
    semantic,

    getCallConfig: () => callConfig,
    getCurrentCallUuid: () => currentCallUuid,
    getCallConfigId: () => callId,

    getPendingUserTranscript: () => pendingUserTranscript,
    setPendingUserTranscript: (value) => {
      pendingUserTranscript = value;
      if (!value) pendingUserTranscriptAcousticallyVerified = false;
    },
    getPendingUserTranscriptAcousticallyVerified: () =>
      pendingUserTranscriptAcousticallyVerified,
    setPendingUserTranscriptAcousticallyVerified: (value) => {
      pendingUserTranscriptAcousticallyVerified = value;
    },

    getScreeningReplyQueued: () => callControl.getScreeningReplyQueued(),

    getCustomerTurnCount: () => customerTurnCount,
    setCustomerTurnCount: (value) => { customerTurnCount = value; },

    getUserTurnStartMs: () => userTurnStartMs,
    setUserTurnStartMs: (value) => { userTurnStartMs = value; },

    getCustomerPauseActive: () => callControl.getCustomerPauseActive(),
    setCustomerPauseActive: (value) => callControl.setCustomerPauseActive(value),
    setCustomerPauseAckPending: (value) => callControl.setCustomerPauseAckPending(value),

    getOutputTranscriptBuffer: () => outputTranscriptBuffer,
    getLastUserBargeInAtMs: () => bargeIn.getLastUserBargeInAtMs(),
    getTurnPlanDedupe: () => turnPlanDedupe,
    setTurnPlanDedupe: (value) => { turnPlanDedupe = value; },

    mediaStreamOffsetMs,
    tryClearAudiblePlayback: (reason, details) => bargeIn.tryClearAudiblePlayback(reason, details),
    interruptCurrentModelAudio: (reason, details) => bargeIn.interruptCurrentModelAudio(reason, details),
    clearModelAudioDropGuard: (reason) => bargeIn.clearModelAudioDropGuard(reason),
    clearCustomerSpeechMute: (reason) => bargeIn.clearCustomerSpeechMute(reason),
    isCustomerSpeechMuteActive: () => bargeIn.isCustomerSpeechMuteActive(),
    recoverFromEmptyBargeIn: (reason) => bargeIn.recoverFromEmptyBargeIn(reason),
    isBargeInRecoveryProtected: () => bargeIn.isBargeInRecoveryProtected(),
    noteRejectedSpeech: (nowMs) => bargeIn.noteRejectedSpeech(nowMs),
    getAwaitingCustomerResponse: () => awaitingCustomerResponse,
    getLastMeaningfulUserSpeechAtMs: () => lastMeaningfulUserSpeechAtMs,
    activateCustomerPause: () => callControl.activateCustomerPause(),
    noteControlIntentSent: (intent) => callControl.noteControlIntentSent(intent),
    markDecisionResolutionApplied: (userText, classification, source) =>
      semantic.markDecisionResolutionApplied(userText, classification, source),
    sendClientInstruction: (text, reason, options) => instructions.sendClientInstruction(text, reason, options),
    protectAckUntil: (untilMs) => bargeIn.protectAckUntil(untilMs),
    sendResumeFromPauseInstruction: callControl.sendResumeFromPauseInstruction,
    queueOutboundMulaw: (payload) => queuePlivoMulaw(payload),

    recordTranscriptTurn,
    releaseAwaitingCustomerResponse,
    schedulePostBargeInNudge: (userTurnText) => bargeIn.schedulePostBargeInNudge(userTurnText),
    clearPostBargeInNudge: (reason) => bargeIn.clearPostBargeInNudge(reason),
    sendPostInterruptAnswerNudge: (userTurnText) => bargeIn.sendPostInterruptAnswerNudge(userTurnText),
    isSubstantiveUserInterrupt: (text) => bargeIn.isSubstantiveUserInterrupt(text),
    scheduleAgentDisconnect,
    onFinalUserTranscript: (text) => biometric?.noteTranscript(text),
  });

  function closeBoth(reason = "unspecified"): void {
    if (closed) return;
    closed = true;
    opening.clearTimers();
    if (disconnectAfterPlaybackTimer) clearTimeout(disconnectAfterPlaybackTimer);
    bargeIn.clearPostBargeInNudge("call_closed");
    bargeIn.clearUserActivityRecovery("call_closed");
    callerIdle.cancel("call_closed");
    flushPendingUserTranscript();
    if (outputTranscriptBuffer.trim()) {
      recordTranscriptTurn("assistant", outputTranscriptBuffer, {
        startMs: assistantTurnStartMs ?? mediaStreamOffsetMs(),
        endMs: mediaStreamOffsetMs(),
      });
      outputTranscriptBuffer = "";
    }
    if (liveTranscriptFollowUpEnabled()) queuePostCallFollowUpFromLiveTranscript();
    outbound.stop();
    void forensics.finalize();
    biometric?.close();
    bridgeRecorder?.finalize();
    if (sileroVad) {
      void sileroVad.destroy();
      sileroVad = undefined;
    }
    if (callId) removeCallConfig(callId);
    if (socketCanClose(geminiWs)) geminiWs?.close();
    if (socketCanClose(plivoWs)) plivoWs.close();
    sessionDump.close({
      reason,
      callId,
      streamId,
      currentCallUuid,
      setupComplete,
      latestTimestamp,
      transcriptTurns: liveTranscriptTurns.length,
      outboundAudioChunks,
      automatedScreeningHandled: callControl.getAutomatedScreeningHandled(),
    });

    // U2: transcript-finalized lifecycle event — gemini_inline path. Fires ONLY
    // when a realtime transcript is present; this is the exact inverse of U5's
    // skip-when-realtime predicate, so exactly one finalize fires per call_id.
    if (callId && hasGeminiRealtimeTranscript(liveTranscriptTurns)) {
      const triggeredAtMs = callConfig?.triggeredAtMs;
      emitVoiceLifecycle(
        "voice_transcript_finalized",
        {
          transcript_source: "gemini_inline",
          trigger_to_transcript_ms: typeof triggeredAtMs === "number" ? Date.now() - triggeredAtMs : null,
        },
        callId,
        "gemini_live",
      );
    }

    // Persist the per-turn latency spine onto the durable call record so the
    // call-log UI can show voice-to-voice latency. One write at hangup (no
    // hot-path I/O), and fail-open — observability must never break the call.
    if (callConfig?.campaignId && currentCallUuid && voiceTurnRecords.length > 0) {
      try {
        const latency = summarizeVoiceTurnLatencies(voiceTurnRecords, voiceEouSource);
        upsertCall(callConfig.campaignId, { id: currentCallUuid, latency });
      } catch (err) {
        console.error("[voice/latency] persist to call record failed (non-fatal):", err);
      }
    }

    // Post-call: run analysis + push to Zoho — async, does not block hangup
    if (liveTranscriptTurns.length >= 2 && callConfig?.campaignId && currentCallUuid) {
      const capturedCampaignId = callConfig.campaignId;
      const capturedCallUuid = currentCallUuid;
      const capturedToNumber = callConfig.toNumber;
      const capturedUserId = callConfig.userId ?? callConfig.toNumber;

      void (async () => {
        try {
          const { analyzeVoiceCallResponse } = await import("./voice-response-analysis");
          const { pushCallToZohoCrm } = await import("./zoho-crm-client");
          const campaign = getCampaign(capturedCampaignId);
          if (!campaign) return;
          const call = campaign.calls.find(
            (c) => c.id === capturedCallUuid || c.callConfigId === capturedCallUuid,
          );
          if (!call) return;
          upsertCall(capturedCampaignId, { id: capturedCallUuid, zohoSyncStatus: "pending" });
          const analysis = await analyzeVoiceCallResponse(campaign, call);
          upsertCall(capturedCampaignId, { id: capturedCallUuid, analysis });
          if (process.env.ZOHO_REFRESH_TOKEN) {
            await pushCallToZohoCrm({
              campaignId: capturedCampaignId,
              callId: capturedCallUuid,
              campaignName: campaign.name,
              phone: capturedToNumber,
              userId: capturedUserId,
              summary: analysis?.summary ?? "",
              nextStep: analysis?.nextStep ?? null,
              callbackPreference: analysis?.callbackPreference ?? null,
              outcome: analysis?.outcome ?? "unknown",
              baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "https://demo.actioneer.com",
            });
            upsertCall(capturedCampaignId, { id: capturedCallUuid, zohoSyncStatus: "synced" });
          }
        } catch (err) {
          console.error("[voice/gemini-live] Post-call analysis/Zoho push failed:", err);
          upsertCall(capturedCampaignId, { id: capturedCallUuid, zohoSyncStatus: "failed" });
        }
      })();

      // U7: Layer 2 enrichment — post-hangup, sample-gated, keyed by the SAME
      // call_id the spine (voice_turn) events use so it joins the latency rows.
      // Fully independent of the Zoho path; runVoiceEnrichment never throws.
      if (callId) {
        const capturedSpineCallId = callId;
        const capturedInterruptedTurns = [...voiceInterruptedTurnIndices];
        void (async () => {
          try {
            const { runVoiceEnrichment } = await import("./voice-enrichment");
            const campaign = getCampaign(capturedCampaignId);
            const call = campaign?.calls.find(
              (c) => c.id === capturedCallUuid || c.callConfigId === capturedCallUuid,
            );
            if (!campaign || !call) return;
            await runVoiceEnrichment({
              callId: capturedSpineCallId,
              campaign,
              call,
              interruptedTurnIndices: capturedInterruptedTurns,
              pipeline: "gemini_live",
            });
          } catch (err) {
            console.error("[voice/enrichment] post-call enrichment failed (non-fatal):", err);
          }
        })();
      }
    }
  }

  function recordTranscriptTurn(
    role: "assistant" | "user",
    text: string,
    timing?: { startMs?: number; endMs?: number },
  ): void {
    const endMs = timing?.endMs ?? streamOffsetMs();
    const startMs = timing?.startMs ?? endMs;
    const updated = recordLiveTranscriptTurn({
      enabled: STORE_REALTIME_TRANSCRIPT,
      campaignId: callConfig?.campaignId,
      callUuid: currentCallUuid,
      role,
      text,
      sequence: transcriptSequence,
      startMs,
      endMs,
      turns: liveTranscriptTurns,
    });
    transcriptSequence = updated.sequence;
    liveTranscriptTurns = updated.turns;
  }

  function queuePostCallFollowUpFromLiveTranscript(): void {
    postCallFollowUpQueued = queuePostCallFollowupFromLiveTranscript({
      alreadyQueued: postCallFollowUpQueued,
      callUuid: currentCallUuid,
      turns: liveTranscriptTurns,
    });
  }

  function sendPlivoJson(payload: Record<string, unknown>): void {
    if (!isOpen(plivoWs)) return;
    plivoWs.send(JSON.stringify(payload), { compress: false, binary: false, fin: true }, (err) => {
      if (err) console.error("[voice/gemini-live] Plivo send failed:", err);
    });
  }

  function sendPlivoMulaw(payload: string): void {
    sendPlivoJson({
      event: "playAudio",
      media: {
        contentType: "audio/x-mulaw",
        sampleRate: 8000,
        payload,
      },
    });
    bridgeRecorder?.recordOutbound(payload);
  }

  const outbound = createOutboundAudioController(
    {
      frameBytes: PLIVO_MULAW_FRAME_BYTES,
      frameDurationMs: PLIVO_FRAME_DURATION_MS,
      batchBytes: OUTBOUND_BATCH_BYTES,
      prerollBytes: OUTBOUND_PREROLL_BYTES,
      pumpIntervalMs: OUTBOUND_PUMP_INTERVAL_MS,
      targetCushionMs: outboundTargetCushionMs(),
      maxFramesPerTick: outboundMaxFramesPerTick(),
    },
    {
      isClosed: () => closed,
      onEmitMulaw: (payloadBase64) => sendPlivoMulaw(payloadBase64),
      onSyncOutboundCursor: () => bridgeRecorder?.syncOutboundCursor(latestTimestamp),
    },
  );

  const callerIdle = createCallerIdleController({
    isClosed: () => closed,
    agentAudioLikelyActive: () => agentAudioLikelyActive(),
    estimatedRemainingPlaybackMs: () => outbound.estimatedRemainingPlaybackMs(),
    releaseAwaitingCustomerResponse,
    sendClientInstruction: (text, reason) =>
      instructions.sendClientInstruction(text, reason),
    emitEvent: (event, payload) => sessionDump.event(event, payload),
  });
  bridgeCallbacks.cancelCallerIdlePrompt = (reason) => callerIdle.cancel(reason);

  function queuePlivoMulaw(payload: string): void {
    outbound.queue(payload);
  }

  function flushOutboundRemainder(): void {
    outbound.flushRemainder();
  }

  function clearPlivoAudio(reason = "unspecified"): void {
    outbound.clear();
    sessionDump.event("plivo.clear_audio", { reason, streamId });
    sendPlivoJson({
      event: "clearAudio",
      ...(streamId ? { streamId } : {}),
    });
  }

  function agentAudioLikelyActive(): boolean {
    return outbound.isLikelyActive(assistantTurnStartMs !== undefined);
  }

  function sendGeminiAudio(payload: string): void {
    const callerAudioEnabled = opening.isCallerAudioEnabled();
    sendGeminiAudioIfAllowed({
      setupComplete,
      callerAudioEnabled,
      geminiWs,
      payloadBase64: payload,
    });
  }

  function releaseAwaitingCustomerResponse(reason: string): void {
    if (!awaitingCustomerResponse) return;
    awaitingCustomerResponse = false;
    console.log(`[voice/gemini-live] customer responded; ${reason}`);
    sessionDump.event("gemini.awaiting_customer_cleared", { reason });
  }

  function startGemini(options?: { minimalSetup?: boolean; skipWarmSession?: boolean; voiceOverride?: string }): void {
    if (closed || geminiWs || !callConfig) return;
    try {
      ensureGeminiLiveConfig();
    } catch (err) {
      console.error("[voice/gemini-live] Missing config:", err);
      sessionDump.event("gemini.missing_config", {
        error: err instanceof Error ? err.message : "Missing Gemini config",
      });
      closeBoth("gemini-missing-config");
      return;
    }

    const warmSession = !options?.skipWarmSession && callId ? claimWarmGeminiSession(callId) : undefined;
    if (!warmSession && callId) {
      dropPendingWarmSessionBeforeClaim(callId);
    }
    const geminiVoice = resolveGeminiVoice(
      options?.voiceOverride || warmSession?.callConfig.voice || callConfig.voice || GEMINI_LIVE_VOICE,
    );
    geminiWs = warmSession?.ws ?? openGeminiSocket();
    const activeGeminiWs = geminiWs;
    setupComplete = warmSession?.setupComplete ?? false;
    console.log(
      `[voice/gemini-live] Opening Gemini Live WS model=${GEMINI_LIVE_MODEL} voice=${geminiVoice}` +
        ` prewarmed=${warmSession ? "true" : "false"} t=+${Date.now() - connectedAt}ms`,
    );
    sessionDump.event("gemini.opening_ws", {
      model: GEMINI_LIVE_MODEL,
      voice: geminiVoice,
      minimalSetup: Boolean(options?.minimalSetup),
      prewarmed: Boolean(warmSession),
      elapsedMs: Date.now() - connectedAt,
    });

    // Exact systemInstruction Gemini Live received (or will receive) for this call.
    const systemInstructionText = buildGeminiLiveSystemInstruction(callConfig);
    logGeminiLiveSystemInstruction(systemInstructionText, {
      language: callConfig.language,
      campaignId: callConfig.campaignId,
      callId,
      source: warmSession ? "prewarmed_claim" : "setup",
      minimalSetup: Boolean(options?.minimalSetup),
    });
    sessionDump.event("gemini.system_instruction", {
      text: systemInstructionText,
      charCount: systemInstructionText.length,
      language: callConfig.language,
      campaignId: callConfig.campaignId,
      source: warmSession ? "prewarmed_claim" : "setup",
      minimalSetup: Boolean(options?.minimalSetup),
      dumpStorageKey: sessionDump.storageKey,
    });

    if (!warmSession) {
      geminiWs.on("open", () => {
        if (geminiWs !== activeGeminiWs) return;
        sendJson(geminiWs, geminiSetupPayload(callConfig, options));
      });
    }

    const geminiHandlerDeps: GeminiHandlerDeps = {
      geminiSocket: activeGeminiWs,
      sessionDump,
      callId,
      connectedAt,
      callConfig,
      prewarmed: Boolean(warmSession),
      minimalSetup: Boolean(options?.minimalSetup),
      outbound,
      semantic,

      getSetupComplete: () => setupComplete,
      setSetupComplete: (value) => { setupComplete = value; },

      getPendingUserTranscript: () => pendingUserTranscript,
      setPendingUserTranscript: (value) => {
        pendingUserTranscript = value;
        if (!value) pendingUserTranscriptAcousticallyVerified = false;
      },
      getPendingUserTranscriptAcousticallyVerified: () =>
        pendingUserTranscriptAcousticallyVerified,
      setPendingUserTranscriptAcousticallyVerified: (value) => {
        pendingUserTranscriptAcousticallyVerified = value;
      },

      getLastMeaningfulUserSpeechAtMs: () => lastMeaningfulUserSpeechAtMs,
      setLastMeaningfulUserSpeechAtMs: (value) => { lastMeaningfulUserSpeechAtMs = value; },

      getAssistantTurnStartMs: () => assistantTurnStartMs,
      setAssistantTurnStartMs: (value) => { assistantTurnStartMs = value; },

      getUserTurnBargeInGraceUntilMs: () => bargeIn.getUserTurnBargeInGraceUntilMs(),

      getAwaitingCustomerResponse: () => awaitingCustomerResponse,
      setAwaitingCustomerResponse: (value) => { awaitingCustomerResponse = value; },

      getDropModelAudioUntilTurnComplete: () => bargeIn.isDropModelAudioActive(),
      setDropModelAudioUntilTurnComplete: (value) => bargeIn.setDropModelAudioActive(value),

      getModelAudioDropReason: () => bargeIn.getModelAudioDropReason(),
      setModelAudioDropReason: (value) => bargeIn.setModelAudioDropReason(value),

      getOutputTranscriptBuffer: () => outputTranscriptBuffer,
      setOutputTranscriptBuffer: (value) => { outputTranscriptBuffer = value; },
      takeInterruptedAssistantText: () => {
        const said = outputTranscriptBuffer.trim() || lastClearedOutputTranscript;
        lastClearedOutputTranscript = "";
        return said;
      },

      getScreeningReplyQueued: () => callControl.getScreeningReplyQueued(),
      setScreeningReplyQueued: (value) => callControl.setScreeningReplyQueued(value),

      getCustomerPauseActive: () => callControl.getCustomerPauseActive(),
      setCustomerPauseActive: (value) => callControl.setCustomerPauseActive(value),

      getCustomerPauseAckPending: () => callControl.getCustomerPauseAckPending(),
      setCustomerPauseAckPending: (value) => callControl.setCustomerPauseAckPending(value),

      getOpeningTurnComplete: () => opening.isOpeningTurnComplete(),
      getFirstResponseRequested: () => opening.isFirstResponseRequested(),

      getUserTurnStartMs: () => userTurnStartMs,
      setUserTurnStartMs: (value) => { userTurnStartMs = value; },

      getVoiceModelStartMs: () => voiceModelStartMs,
      setVoiceModelStartMs: (value) => { voiceModelStartMs = value; },

      getVoiceLastSpeechFrameMs: () => voiceLastSpeechFrameMs,
      setVoiceEouProxyMs: (value) => { voiceEouProxyMs = value; },

      getSuppressedModelAudioDropReason: () => bargeIn.getSuppressedModelAudioDropReason(),
      setSuppressedModelAudioDropReason: (value) => bargeIn.setSuppressedModelAudioDropReason(value),

      getSuppressedModelAudioDropChunks: () => bargeIn.getSuppressedModelAudioDropChunks(),
      setSuppressedModelAudioDropChunks: (value) => bargeIn.setSuppressedModelAudioDropChunks(value),

      getOutboundAudioChunks: () => outboundAudioChunks,
      setOutboundAudioChunks: (value) => { outboundAudioChunks = value; },

      getVoiceFirstAudioOutMs: () => voiceFirstAudioOutMs,
      setVoiceFirstAudioOutMs: (value) => { voiceFirstAudioOutMs = value; },

      getLastInstruction: () => instructions.getLastInstruction(),
      getLastInstructionReason: () => instructions.getLastInstructionReason(),
      clearLastInstructionOwnership: (reason) => instructions.clearLastInstructionOwnership(reason),
      shouldPreserveOwnershipOnDrop: (droppedReason) =>
        instructions.shouldPreserveOwnershipOnDrop(droppedReason),
      noteAssistantAnsweredAfterBargeIn: (said) => bargeIn.noteAssistantAnsweredAfterBargeIn(said),
      getLastPlaybackCutAtMs: () => bargeIn.getLastPlaybackCutAtMs(),
      isAckProtected: (nowMs) => bargeIn.isAckProtected(nowMs),
      protectAckUntil: (untilMs) => bargeIn.protectAckUntil(untilMs),
      noteControlIntentSent: (intent) => callControl.noteControlIntentSent(intent),
      activateCustomerPause: () => callControl.activateCustomerPause(),
      getCallerAudioEnabled: () => opening.isCallerAudioEnabled(),
      getCurrentCallUuid: () => currentCallUuid,
      getTurnPlanDedupe: () => turnPlanDedupe,
      setTurnPlanDedupe: (value) => { turnPlanDedupe = value; },

      requestFirstResponse: () => opening.requestFirstResponse(),
      sendClientInstruction: instructions.sendClientInstruction,
      interruptCurrentModelAudio: (reason, details) => bargeIn.interruptCurrentModelAudio(reason, details),
      clearModelAudioDropGuard: (reason) => bargeIn.clearModelAudioDropGuard(reason),
      isCustomerSpeechMuteActive: () => bargeIn.isCustomerSpeechMuteActive(),
      clearCustomerSpeechMute: (reason) => bargeIn.clearCustomerSpeechMute(reason),
      armCustomerSpeechMute: (reason) => bargeIn.armCustomerSpeechMute(reason),
      recoverFromEmptyBargeIn: (reason) => bargeIn.recoverFromEmptyBargeIn(reason),
      isBargeInRecoveryProtected: () => bargeIn.isBargeInRecoveryProtected(),
      noteRejectedSpeech: (nowMs) => bargeIn.noteRejectedSpeech(nowMs),
      hasRecentUserActivityEvidence: (nowMs) =>
        bargeIn.hasRecentUserActivityEvidence(nowMs),
      hasRecentBargeInCandidateEvidence: (nowMs) =>
        bargeIn.hasRecentBargeInCandidateEvidence(nowMs),
      resolveUserActivityResponse: (reason) =>
        bargeIn.resolveUserActivityResponse(reason),
      sendPostInterruptAnswerNudge: (text) => bargeIn.sendPostInterruptAnswerNudge(text),
      tryClearAudiblePlayback: (reason, details) => bargeIn.tryClearAudiblePlayback(reason, details),
      clearAudibleModelAudio: (reason, details) => bargeIn.clearAudibleModelAudio(reason, details),
      markLocalCallerSpeech: (now, shouldDuckPlayback) => bargeIn.markLocalCallerSpeech(now, shouldDuckPlayback),
      armPostUserTurnBargeInGrace: (now) => bargeIn.armPostUserTurnBargeInGrace(now),
      sendResumeFromPauseInstruction: callControl.sendResumeFromPauseInstruction,
      sendControlIntentInstruction: callControl.sendControlIntentInstruction,
      releaseAwaitingCustomerResponse,
      handleAutomatedScreeningInput: callControl.handleAutomatedScreeningInput,
      localPlaybackDuckActive: () => bargeIn.localPlaybackDuckActive(),
      localCallerSpeechActive: () => bargeIn.localCallerSpeechActive(),
      flushSuppressedModelAudioDropLog: () => bargeIn.flushSuppressedModelAudioDropLog(),
      streamOffsetMs,
      armOpeningBargeInWindow: () => opening.armOpeningBargeInWindow(),
      queuePlivoMulaw,
      flushVoiceTurn,
      flushPendingUserTranscript,
      flushPendingRealtimeInstructions: instructions.flushPendingRealtimeInstructions,
      sendAutomatedScreeningReply: callControl.sendAutomatedScreeningReply,
      flushOutboundRemainder,
      clearPlivoAudio,
      recordTranscriptTurn,
      scheduleAgentDisconnect,
      markOpeningTurnComplete: () => opening.markOpeningTurnComplete(),
      agentAudioLikelyActive,
      agentAudioAudible: () => outbound.isPlayoutActive(),
      armCallerIdlePrompt: (reason) => callerIdle.armAfterAgentTurn(reason),
      cancelCallerIdlePrompt: (reason) => callerIdle.cancel(reason),
    };
    const handleGeminiMessage = createGeminiMessageHandler(geminiHandlerDeps);

    geminiWs.on("message", (data) => {
      if (geminiWs !== activeGeminiWs) return;
      handleGeminiMessage(data);
    });

    geminiWs.on("close", (code, reason) => {
      if (geminiWs !== activeGeminiWs) return;
      console.log(`[voice/gemini-live] Gemini WS close code=${code} reason=${reason.toString() || "(empty)"}`);
      sessionDump.event("gemini.ws_close", {
        code,
        reason: reason.toString() || "(empty)",
      });
      if (!setupComplete && !options?.minimalSetup && !geminiSetupRetryUsed && (code === 1007 || code === 1011)) {
        geminiSetupRetryUsed = true;
        geminiWs = undefined;
        if (socketCanClose(activeGeminiWs)) activeGeminiWs.close();
        console.warn(`[voice/gemini-live] retrying Gemini setup with minimal config after close code=${code}`);
        sessionDump.event("gemini.retry_minimal_setup", {
          trigger: "close",
          code,
          reason: reason.toString() || "(empty)",
        });
        startGemini({
          minimalSetup: true,
          skipWarmSession: true,
          voiceOverride: GEMINI_LIVE_VOICE,
        });
        return;
      }
      closeBoth(`gemini-ws-close-${code}`);
    });
    geminiWs.on("error", (err) => {
      if (geminiWs !== activeGeminiWs) return;
      console.error("[voice/gemini-live] Gemini WS error:", err);
      sessionDump.event("gemini.ws_error", {
        error: err.message,
      });
      if (!setupComplete && !options?.minimalSetup && !geminiSetupRetryUsed) {
        geminiSetupRetryUsed = true;
        geminiWs = undefined;
        if (socketCanClose(activeGeminiWs)) activeGeminiWs.close();
        console.warn("[voice/gemini-live] retrying Gemini setup with minimal config after socket error");
        sessionDump.event("gemini.retry_minimal_setup", {
          trigger: "error",
          error: err.message,
        });
        startGemini({
          minimalSetup: true,
          skipWarmSession: true,
          voiceOverride: GEMINI_LIVE_VOICE,
        });
        return;
      }
      closeBoth("gemini-ws-error");
    });

    if (setupComplete) {
      console.log(`[voice/gemini-live] using prewarmed Gemini setup t=+${Date.now() - connectedAt}ms`);
      sessionDump.event("gemini.prewarmed_setup_used", {
        elapsedMs: Date.now() - connectedAt,
      });
      // U2: setup-complete lifecycle event on the prewarmed path (R1).
      if (callId) emitVoiceLifecycle("voice_setup_complete", { prewarmed: true }, callId, "gemini_live");
      // Seed style-demonstration turns BEFORE the opening instruction (cold
      // path does the same in createGeminiMessageHandler on setupComplete).
      // turnComplete MUST stay false — true makes Gemini start generating
      // before the opening instruction arrives. Raw sendJson on purpose: the
      // instruction controller gates on awaitingCustomerResponse.
      if (!options?.minimalSetup && seedTurnsEnabled() && callConfig.seedTurns?.length) {
        sendJson(geminiWs, {
          clientContent: {
            turns: callConfig.seedTurns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
            turnComplete: false,
          },
        });
        sessionDump.event("gemini.seed_turns_sent", {
          count: callConfig.seedTurns.length,
          path: "prewarmed_claim",
        });
      }
      opening.requestFirstResponse();
      if (!callConfig.firstMessage.trim()) {
        opening.markOpeningTurnComplete();
      }
    }
  }

  if (!callConfig) {
    console.error(`[voice/gemini-live] Missing call config for callId=${callId || "(empty)"}`);
    sessionDump.event("call_config.missing", {
      callId,
    });
    closeBoth("missing-call-config");
    return;
  }

  plivoWs.on("message", (data) => {
    const event = parseEvent(data);
    if (!event || typeof event.event !== "string") return;

    if (event.event === "start") {
      const start = objectValue(event.start);
      streamId = stringValue(start?.streamId);
      currentCallUuid = stringValue(start?.callId);
      const mediaFormat = objectValue(start?.mediaFormat);
      console.log(
        `[voice/gemini-live] start StreamID=${streamId ?? "(missing)"} CallUUID=${currentCallUuid ?? "(missing)"}` +
          ` media=${mediaFormat ? JSON.stringify(mediaFormat) : "(missing)"} epochMs=${Date.now()}`,
      );
      sessionDump.event("plivo.start", {
        streamId,
        callId: currentCallUuid,
        callConfigId: callId,
        mediaFormat,
      });
      streamClockStartedAtMs = Date.now();
      if (currentCallUuid) {
        bridgeRecorder = createVoiceBridgeRecorder(currentCallUuid);
        upsertCall(callConfig.campaignId, {
          id: currentCallUuid,
          callConfigId: callId,
          provider: "plivo",
          toNumber: callConfig.toNumber,
          status: "connected",
          engaged: false,
          startedAt: new Date().toISOString(),
          triggeredAtMs: callConfig.triggeredAtMs, // U5: durable trigger time
        });
      }
      startGemini();
      return;
    }

    if (event.event === "media") {
      const media = objectValue(event.media);
      const payload = stringValue(media?.payload);
      if (!payload) return;
      latestTimestamp = Number(stringValue(media?.timestamp)) || latestTimestamp;
      bridgeRecorder?.recordInbound(latestTimestamp, payload);
      bargeIn.rememberInboundPayload(payload);
      // U2: when the speech classifier is disabled, fall back to a last-RAW-frame
      // EOU proxy tagged `raw_frame_proxy` (KTD4 c.1). When enabled,
      // handleLocalBargeInVad tracks the speech-gated proxy instead.
      if (!LOCAL_BARGE_IN_VAD_ENABLED) voiceLastSpeechFrameMs = streamOffsetMs();
      bargeIn.handleLocalBargeInVad(payload);
      sileroVad?.feedFrame(payload);
      // V1 forensics audio: feed EVERY inbound Plivo frame contiguously, in
      // arrival order — no gating, no splicing. Snapshots are taken by byte
      // length at each horizon (see UserAudioAccumulator). This yields clean,
      // time-accurate caller-side audio (like the full-call recorder), instead
      // of the old gate-and-splice that stitched non-adjacent frames together.
      // Echo of the agent while it speaks is knowingly ignored for V1.
      forensics.feed(payload);
      biometric?.feed(payload);
      // Client-controlled activity: barge-in VAD owns activityStart/End and only
      // forwards audio inside that window — continuous silence must not reach Gemini.
      if (!CLIENT_CONTROLLED_ACTIVITY_ENABLED || !LOCAL_BARGE_IN_VAD_ENABLED) {
        sendGeminiAudio(payload);
      }
      return;
    }

    if (event.event === "clearedAudio") {
      outbound.resetPlaybackDeadline();
      sessionDump.event("plivo.cleared_audio", {
        streamId,
        callId: currentCallUuid,
      });
      return;
    }

    if (event.event === "stop") {
      sessionDump.event("plivo.stop", {
        streamId,
        callId: currentCallUuid,
        latestTimestamp,
      });
      sendJson(geminiWs, { realtimeInput: { audioStreamEnd: true } });
      closeBoth("plivo-stop");
    }
  });

  plivoWs.on("close", (code, reason) => {
    console.log(`[voice/gemini-live] Plivo WS close code=${code} reason=${reason.toString() || "(empty)"}`);
    sessionDump.event("plivo.ws_close", {
      code,
      reason: reason.toString() || "(empty)",
    });
    closeBoth(`plivo-ws-close-${code}`);
  });
  plivoWs.on("error", (err) => {
    console.error("[voice/gemini-live] Plivo WS error:", err);
    sessionDump.event("plivo.ws_error", {
      error: err.message,
    });
    closeBoth("plivo-ws-error");
  });
}
