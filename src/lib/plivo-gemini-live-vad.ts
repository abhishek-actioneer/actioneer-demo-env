import { RealTimeVAD } from "avr-vad";
import { mulawToPcm16, resamplePcm16Mono } from "./telephony-audio";
import {
  SILERO_VAD_ENABLED,
  SILERO_VAD_MIN_SPEECH_FRAMES,
  SILERO_VAD_NEGATIVE_THRESHOLD,
  SILERO_VAD_POSITIVE_THRESHOLD,
  SILERO_VAD_REDEMPTION_FRAMES,
} from "./plivo-gemini-live-config";

export interface SileroVadCallbacks {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onMisfire: () => void;
}

export interface SileroVadSession {
  feedFrame(payload: string): void;
  destroy(): Promise<void>;
}

/**
 * Plivo mulaw payload (8kHz) -> Float32Array (16kHz, range [-1,1]) for Silero.
 *
 * avr-vad's RealTimeVAD only builds its internal resampler when
 * `options.sampleRate > 16000` (see node_modules/avr-vad dist/real-time-vad.js)
 * — it can downsample, but silently does NOT upsample 8kHz audio, and its
 * Silero wrapper hardcodes the ONNX model's `sr` input to 16000n regardless of
 * what you pass. Feeding it raw 8kHz frames therefore means every 512-sample
 * frame is actually 64ms of real audio being scored as if it were the 32ms
 * the model expects — confirmed root cause of an earlier spike against a real
 * call recording that produced nothing but VADMisfire with default
 * thresholds. This was never a threshold-tuning problem.
 *
 * Reuses the same linear-interpolation upsampler already proven correct in
 * production for the Plivo -> Gemini audio path (telephony-audio.ts).
 */
function mulawPayloadToFloat32At16k(payload: string): Float32Array {
  const mulaw = Buffer.from(payload, "base64");
  const pcm8k = mulawToPcm16(mulaw);
  const pcm16k = resamplePcm16Mono(pcm8k, 8000, 16000);
  const samples = Math.floor(pcm16k.length / 2);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = pcm16k.readInt16LE(i * 2) / 32768;
  }
  return out;
}

/**
 * Creates a per-call Silero VAD session. Returns undefined if disabled or if
 * the ONNX model fails to load — callers must treat this as a purely
 * additive, best-effort signal and tolerate its absence.
 */
export async function createSileroVadSession(
  callbacks: SileroVadCallbacks,
): Promise<SileroVadSession | undefined> {
  if (!SILERO_VAD_ENABLED) return undefined;
  try {
    const vad = await RealTimeVAD.new({
      model: "v5",
      // Audio is pre-resampled to 16kHz by mulawPayloadToFloat32At16k above —
      // do not set this to 8000 (see note above on why that silently no-ops).
      sampleRate: 16000,
      positiveSpeechThreshold: SILERO_VAD_POSITIVE_THRESHOLD,
      negativeSpeechThreshold: SILERO_VAD_NEGATIVE_THRESHOLD,
      minSpeechFrames: SILERO_VAD_MIN_SPEECH_FRAMES,
      redemptionFrames: SILERO_VAD_REDEMPTION_FRAMES,
      onSpeechStart: callbacks.onSpeechStart,
      onSpeechEnd: callbacks.onSpeechEnd,
      onVADMisfire: callbacks.onMisfire,
    });
    vad.start();
    let destroyed = false;
    return {
      feedFrame(payload: string): void {
        if (destroyed) return;
        const frame = mulawPayloadToFloat32At16k(payload);
        void vad.processAudio(frame).catch((error) => {
          console.error("[voice/gemini-live] silero vad processAudio failed", error);
        });
      },
      async destroy(): Promise<void> {
        if (destroyed) return;
        destroyed = true;
        try {
          await vad.destroy();
        } catch (error) {
          console.error("[voice/gemini-live] silero vad destroy failed", error);
        }
      },
    };
  } catch (error) {
    console.error("[voice/gemini-live] failed to initialize silero vad session", error);
    return undefined;
  }
}
