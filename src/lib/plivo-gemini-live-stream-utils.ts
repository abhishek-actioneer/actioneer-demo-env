import { mulawToPcm16, plivoMulawToGeminiPcm16 } from "./telephony-audio";
import {
  detectRuntimeControlIntent,
  hasShortConversationalReplySignal,
  isLikelyNoiseTranscript,
  isLowSignalTranscript,
  isOutOfDomainTranscript,
} from "./plivo-gemini-live-transcript-guards";
import { normalizeTranscriptText } from "./plivo-gemini-live-text-utils";
import { arrayValue, objectValue, sendJson, stringValue } from "./plivo-gemini-live-ws-utils";
import type { ShortUtteranceClassification } from "./voice-semantic-traps";

export function extractModelAudio(event: Record<string, unknown>): Array<{ data: string; mimeType?: string }> {
  const serverContent = objectValue(event.serverContent);
  const modelTurn = objectValue(serverContent?.modelTurn);
  const parts = arrayValue(modelTurn?.parts);
  const audio: Array<{ data: string; mimeType?: string }> = [];

  for (const part of parts) {
    const inlineData = objectValue(part.inlineData) ?? objectValue(part.inline_data);
    const data = stringValue(inlineData?.data);
    if (!data) continue;
    audio.push({
      data,
      mimeType: stringValue(inlineData?.mimeType) ?? stringValue(inlineData?.mime_type),
    });
  }

  return audio;
}

export function hasMeaningfulUserSpeechInput(text: string): boolean {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return false;
  if (isLowSignalTranscript(normalized)) return false;
  if (isLikelyNoiseTranscript(normalized)) return false;
  if (isOutOfDomainTranscript(normalized)) return false;
  return true;
}

export function isSubstantiveUserInterruptInput(
  text: string,
  classifySemanticTrap: (text: string) => ShortUtteranceClassification | null,
  isClearDecisionIntent: (classification: ShortUtteranceClassification | null) => boolean,
  interruptQuestionRegex: RegExp,
): boolean {
  const normalized = normalizeTranscriptText(text);
  if (!hasMeaningfulUserSpeechInput(normalized)) return false;
  const trap = classifySemanticTrap(normalized);
  if (isClearDecisionIntent(trap)) return false;
  if (detectRuntimeControlIntent(normalized)) return false;
  if (interruptQuestionRegex.test(normalized)) return true;
  // Short confirm/deny replies after barge-in still need an answer nudge —
  // compactLen>=12 used to skip "haan"/"yes" and leave dead air.
  if (hasShortConversationalReplySignal(normalized)) return true;
  const compactLen = normalized.replace(/[\s\d.,!?]/g, "").length;
  return compactLen >= 12;
}

export interface InboundSpeechAnalysis {
  speech: boolean;
  /**
   * Voice-like frame that cleared the absolute speech bars but missed only the
   * adaptive noise-floor bar. During duplex playback this is a provisional
   * barge-in signal: pause outbound audio briefly, then require persistence.
   */
  speechCandidate: boolean;
  rms: number;
  peak: number;
  activeRatio: number;
  dynamicRms: number;
  noiseFloorRms: number;
  nextNoiseFloorRms: number;
}

export function analyzeInboundSpeechFrame(
  payload: string,
  localNoiseFloorRms: number,
  options: {
    minRms: number;
    minPeak: number;
    minActiveRatio: number;
    noiseMultiplier: number;
    /** Extra floor while agent is speaking (echo resistance). */
    agentSpeakingBoost?: number;
    /**
     * The caller channel contains far-end playback leakage while the agent is
     * audible. Never teach that mixed signal to the ambient-noise estimator.
     */
    updateNoiseFloor?: boolean;
    /**
     * <1 lowers every threshold (more sensitive). Only safe to use when there
     * is no agent audio to echo — e.g. while awaiting the customer's answer,
     * where a false positive just re-arms Gemini's activity window (cheap)
     * but a false negative silently drops a quiet/speakerphone reply
     * (expensive: forced re-ask loop, dead air, eventual hangup).
     */
    sensitivityMultiplier?: number;
  },
): InboundSpeechAnalysis {
  const agentBoost = options.agentSpeakingBoost && options.agentSpeakingBoost > 1
    ? options.agentSpeakingBoost
    : 1;
  const sensitivity =
    options.sensitivityMultiplier && options.sensitivityMultiplier > 0 && options.sensitivityMultiplier < 1
      ? options.sensitivityMultiplier
      : 1;
  const effectiveMinRms = Math.round(options.minRms * agentBoost * sensitivity);
  const effectiveMinPeak = Math.round(options.minPeak * agentBoost * sensitivity);
  const effectiveMinActiveRatio = Math.max(0.15, options.minActiveRatio * sensitivity);
  const pcm = mulawToPcm16(Buffer.from(payload, "base64"));
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) {
    return {
      speech: false,
      speechCandidate: false,
      rms: 0,
      peak: 0,
      activeRatio: 0,
      dynamicRms: effectiveMinRms,
      noiseFloorRms: localNoiseFloorRms,
      nextNoiseFloorRms: localNoiseFloorRms,
    };
  }

  let sumSquares = 0;
  let peak = 0;
  let activeSamples = 0;
  const activeSampleThreshold = Math.max(
    Math.floor(effectiveMinRms * 0.65),
    Math.floor(localNoiseFloorRms * 2),
  );
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.abs(pcm.readInt16LE(index * 2));
    sumSquares += sample * sample;
    if (sample > peak) peak = sample;
    if (sample >= activeSampleThreshold) activeSamples += 1;
  }

  const rms = Math.sqrt(sumSquares / samples);
  const activeRatio = activeSamples / samples;
  const dynamicRms = Math.max(
    effectiveMinRms,
    localNoiseFloorRms * options.noiseMultiplier * agentBoost * sensitivity,
  );
  const clearsAbsoluteRms = rms >= effectiveMinRms;
  const clearsPeak = peak >= effectiveMinPeak;
  const clearsActiveRatio = activeRatio >= effectiveMinActiveRatio;
  const speech = rms >= dynamicRms && clearsPeak && clearsActiveRatio;
  // This is deliberately not a looser general-purpose VAD. It identifies the
  // exact production failure mode where a real voice clears every absolute
  // speech bar but a self-inflated adaptive floor is the sole rejection.
  const speechCandidate =
    !speech && clearsAbsoluteRms && clearsPeak && clearsActiveRatio;

  const nextNoiseFloorRms =
    options.updateNoiseFloor === false ||
    speech ||
    speechCandidate ||
    !Number.isFinite(rms) ||
    rms <= 0
      ? localNoiseFloorRms
      : ((localNoiseFloorRms * 0.94) + (Math.min(rms, options.minRms * 0.55) * 0.06));

  return {
    speech,
    speechCandidate,
    rms,
    peak,
    activeRatio,
    dynamicRms,
    noiseFloorRms: nextNoiseFloorRms,
    nextNoiseFloorRms,
  };
}

export function requiredLocalBargeInSpeechFrames(
  firstResponseRequested: boolean,
  openingTurnComplete: boolean,
  agentAudioLikelyActive: boolean,
  minSpeechFrames: number,
): number {
  if (firstResponseRequested && !openingTurnComplete) {
    return minSpeechFrames;
  }
  if (agentAudioLikelyActive) {
    // Require more consecutive speech frames while agent is playing — echo
    // often looks like short bursts of energy (speakerphone).
    return Math.ceil(minSpeechFrames * 2.75);
  }
  return minSpeechFrames;
}

/**
 * How many consecutive silence frames must pass before we close the Gemini
 * activity window for an utterance that has already produced `openSpeechFrames`
 * frames of speech.
 *
 * Short utterances keep the conservative floor — clipping the tail of a
 * one-word answer can leave Gemini too little audio to transcribe at all.
 * Once the caller has produced a substantial utterance that risk is gone, and
 * the extra silence is pure added latency before the model may even begin
 * responding (under manual VAD the server adds no silence tolerance of its own).
 */
export function requiredActivityEndSilenceFrames(
  openSpeechFrames: number,
  shortFrames: number,
  longFrames: number,
  longUtteranceFrames: number,
): number {
  if (openSpeechFrames >= longUtteranceFrames) {
    // Never let the "long" tuning exceed the conservative floor — a misconfigured
    // override must not silently make latency worse than the default path.
    return Math.min(shortFrames, longFrames);
  }
  return shortFrames;
}

export type CustomerSpeechMuteAction = "answer" | "recover" | "wait" | "unclear";

/**
 * Decides what the customer-speech mute failsafe should do at a probe tick.
 *
 * The mute is normally cleared by a turn plan or nudge; this failsafe only runs
 * when that never happened. It used to be a single blind `setTimeout` for the
 * whole budget, so a false barge-in (ambient noise, speakerphone echo) muted the
 * agent for the full 3.5s before recovery even began. Session dumps put turns
 * that hit it at ~3850ms to first audio versus ~1750ms for clean turns.
 *
 * The early-out is deliberately narrow: recover immediately ONLY when there is
 * no transcript at all AND the caller-speech hangover has lapsed, which
 * together mean nothing was actually said. Anything else waits out the budget
 * exactly as before, so a slow or quiet speaker is never cut off — the risk
 * this failsafe's original long timeout existed to avoid.
 */
export function resolveCustomerSpeechMuteAction(params: {
  pendingTranscript: string;
  callerSpeechActive: boolean;
  elapsedMs: number;
  budgetMs: number;
  /**
   * ASR returned words during this mute window, but the noise/out-of-domain
   * guards rejected them. That is still positive evidence a human spoke —
   * background noise does not produce lexical output — so the customer must not
   * be told "you said nothing" and talked over. We don't know WHAT they said,
   * only THAT they said something.
   */
  heardRejectedSpeech?: boolean;
  /** A verified activity window recently closed and ASR may still be landing. */
  awaitingVerifiedActivityTranscript?: boolean;
}): CustomerSpeechMuteAction {
  const pending = params.pendingTranscript.trim();
  // Budget spent: answer what we heard; if all we have is rejected speech, ask
  // them to repeat rather than resuming the pitch over them.
  if (params.elapsedMs >= params.budgetMs) {
    if (pending) return "answer";
    return params.heardRejectedSpeech ? "unclear" : "recover";
  }
  // Something was transcribed, the caller is still going, or ASR produced words
  // we discarded: let the budget run rather than declaring silence.
  if (
    pending ||
    params.callerSpeechActive ||
    params.heardRejectedSpeech ||
    params.awaitingVerifiedActivityTranscript
  ) {
    return "wait";
  }
  // Silent and nothing transcribed at all — the barge-in was noise. Recover now.
  return "recover";
}

// ── Inbound audio ingress (formerly plivo-gemini-live-audio-ingress.ts) ────
// Merged here since these are the other half of the same inbound-frame
// pipeline: forwarding caller audio to Gemini and replaying a short prefix
// buffer around local barge-in detection.

export function sendGeminiAudioIfAllowed(params: {
  setupComplete: boolean;
  callerAudioEnabled: boolean;
  geminiWs: unknown;
  payloadBase64: string;
}): void {
  if (!params.setupComplete || !params.callerAudioEnabled) return;
  const audio = plivoMulawToGeminiPcm16(params.payloadBase64);
  sendJson(params.geminiWs as any, {
    realtimeInput: {
      audio: {
        data: audio,
        mimeType: "audio/pcm;rate=16000",
      },
    },
  });
}

export function rememberInboundPayload(
  recentInboundPayloads: string[],
  payloadBase64: string,
  maxFrames: number,
): string[] {
  const next = [...recentInboundPayloads, payloadBase64];
  if (next.length > maxFrames) {
    return next.slice(-maxFrames);
  }
  return next;
}

export function replayRecentInboundAudio(params: {
  setupComplete: boolean;
  callerAudioEnabled: boolean;
  recentInboundPayloads: string[];
  excludeTailFrames?: number;
  onReplayFrame: (payloadBase64: string) => void;
  onReplay?: (frames: number, excludedTailFrames: number) => void;
}): void {
  if (!params.setupComplete || !params.callerAudioEnabled || params.recentInboundPayloads.length === 0) return;
  const excludedTailFrames = params.excludeTailFrames ?? 0;
  const replayCount = Math.max(0, params.recentInboundPayloads.length - excludedTailFrames);
  if (replayCount === 0) return;
  const frames = params.recentInboundPayloads.slice(0, replayCount);
  params.onReplay?.(frames.length, excludedTailFrames);
  for (const frame of frames) {
    params.onReplayFrame(frame);
  }
}
