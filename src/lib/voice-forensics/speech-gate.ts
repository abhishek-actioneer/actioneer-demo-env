import {
  LOCAL_BARGE_IN_ECHO_RMS_MULTIPLIER,
  LOCAL_BARGE_IN_INITIAL_NOISE_RMS,
  LOCAL_BARGE_IN_MIN_ACTIVE_RATIO,
  LOCAL_BARGE_IN_MIN_PEAK,
  LOCAL_BARGE_IN_MIN_RMS,
  LOCAL_BARGE_IN_MIN_SPEECH_FRAMES,
  LOCAL_BARGE_IN_NOISE_MULTIPLIER,
} from "../plivo-gemini-live-config";
import { analyzeInboundSpeechFrame } from "../plivo-gemini-live-stream-utils";

const PLIVO_MULAW_BYTES_PER_MS = 8;

export interface ForensicSpeechGateDecision {
  acceptedPayloads: string[];
  speech: boolean;
  speechCandidate: boolean;
  rms: number;
  peak: number;
  activeRatio: number;
  dynamicRms: number;
}

export interface ForensicSpeechGateStats {
  mediaFramesSeen: number;
  acceptedMediaFrames: number;
  rejectedMediaFrames: number;
  rejectedWhileAgentAudible: number;
  acceptedWhileAgentAudible: number;
  acceptedAudioMs: number;
}

/**
 * Echo-resistant speech gate for voice forensics.
 *
 * Plivo media events are the caller-side stream, but in real phone calls that
 * stream still includes silence and can include speakerphone playback leakage.
 * This gate only releases a short run of payloads after local acoustic VAD has
 * confirmed sustained caller speech. Frames captured while assistant audio is
 * audibly playing are treated as contaminated and are not released.
 */
export class ForensicSpeechGate {
  private localNoiseFloorRms = LOCAL_BARGE_IN_INITIAL_NOISE_RMS;
  private pendingSpeechPayloads: string[] = [];
  private speechRunFrames = 0;
  private statsValue: ForensicSpeechGateStats = {
    mediaFramesSeen: 0,
    acceptedMediaFrames: 0,
    rejectedMediaFrames: 0,
    rejectedWhileAgentAudible: 0,
    acceptedWhileAgentAudible: 0,
    acceptedAudioMs: 0,
  };

  accept(payload: string, options: { agentAudioAudible: boolean }): ForensicSpeechGateDecision {
    this.statsValue.mediaFramesSeen += 1;
    const analysis = analyzeInboundSpeechFrame(payload, this.localNoiseFloorRms, {
      minRms: LOCAL_BARGE_IN_MIN_RMS,
      minPeak: LOCAL_BARGE_IN_MIN_PEAK,
      minActiveRatio: LOCAL_BARGE_IN_MIN_ACTIVE_RATIO,
      noiseMultiplier: LOCAL_BARGE_IN_NOISE_MULTIPLIER,
      agentSpeakingBoost: options.agentAudioAudible ? LOCAL_BARGE_IN_ECHO_RMS_MULTIPLIER : 1,
      updateNoiseFloor: !options.agentAudioAudible,
    });
    this.localNoiseFloorRms = analysis.nextNoiseFloorRms;

    const acceptedPayloads = options.agentAudioAudible
      ? this.rejectPayload(true)
      : analysis.speech
        ? this.acceptSpeechPayload(payload)
        : this.rejectPayload(false);

    return {
      acceptedPayloads,
      speech: analysis.speech,
      speechCandidate: analysis.speechCandidate,
      rms: analysis.rms,
      peak: analysis.peak,
      activeRatio: analysis.activeRatio,
      dynamicRms: analysis.dynamicRms,
    };
  }

  stats(): ForensicSpeechGateStats {
    return { ...this.statsValue };
  }

  private acceptSpeechPayload(payload: string): string[] {
    this.speechRunFrames += 1;
    this.pendingSpeechPayloads.push(payload);

    const framesNeeded = LOCAL_BARGE_IN_MIN_SPEECH_FRAMES;

    if (this.speechRunFrames < framesNeeded) return [];

    const accepted = this.pendingSpeechPayloads;
    this.pendingSpeechPayloads = [];
    this.statsValue.acceptedMediaFrames += accepted.length;
    this.statsValue.acceptedAudioMs += accepted.reduce((sum, item) => (
      sum + (Buffer.from(item, "base64").length / PLIVO_MULAW_BYTES_PER_MS)
    ), 0);
    return accepted;
  }

  private rejectPayload(agentAudioAudible: boolean): string[] {
    const rejectedRun = this.pendingSpeechPayloads.length;
    this.pendingSpeechPayloads = [];
    this.speechRunFrames = 0;
    this.statsValue.rejectedMediaFrames += 1 + rejectedRun;
    if (agentAudioAudible) this.statsValue.rejectedWhileAgentAudible += 1 + rejectedRun;
    return [];
  }
}
