import { mulawToPcm16, resamplePcm16Mono } from "../telephony-audio";
import type { ForensicAudio } from "./types";

/**
 * Accumulates USER-ONLY Plivo μ-law frames and exposes immutable prefix
 * snapshots for QA horizons. Snapshots do not drain the buffer: 0.5s, 1s, 2s,
 * and 5s all run over the first N milliseconds of the same user-side signal.
 */
export class UserAudioAccumulator {
  private mulawChunks: Buffer[] = [];
  private totalBytes = 0;

  /**
   * Append one Plivo μ-law frame.
   * @param payload base64 μ-law (8kHz mono).
   * @param speech whether this frame is user speech. Defaults to true because
   *               the channel is already user-only; VAD may gate silence later.
   */
  append(payload: string, speech = true): void {
    if (!speech || !payload) return;
    const mulaw = Buffer.from(payload, "base64");
    if (mulaw.length === 0) return;
    this.mulawChunks.push(mulaw);
    this.totalBytes += mulaw.length;
  }

  /** Total user audio accumulated across the call so far, milliseconds. */
  get totalMs(): number {
    return this.totalBytes / 8;
  }

  /** The entire accumulated μ-law buffer (8kHz mono), in arrival order. */
  fullMulaw(): Buffer {
    return Buffer.concat(this.mulawChunks, this.totalBytes);
  }

  /** True when at least `horizonMs` of user audio has been accumulated. */
  has(horizonMs: number): boolean {
    return this.totalBytes >= bytesForMs(horizonMs);
  }

  /**
   * Return the first `horizonMs` of user audio without consuming it. Returns
   * null when insufficient user audio has been captured.
   */
  snapshot(horizonMs: number): ForensicAudio | null {
    const targetBytes = bytesForMs(horizonMs);
    if (this.totalBytes < targetBytes) return null;
    const mulaw8k = Buffer.concat(this.mulawChunks, this.totalBytes).subarray(0, targetBytes);
    return forensicAudioFromMulaw(Buffer.from(mulaw8k), horizonMs);
  }
}

export function bytesForMs(ms: number): number {
  // μ-law is 8000 samples/sec, 1 byte/sample => 8 bytes/ms.
  return Math.max(0, Math.round(ms * 8));
}

/** Build a ForensicAudio (8kHz pcm16 + 16kHz float) from a μ-law buffer. */
export function forensicAudioFromMulaw(mulaw8k: Buffer, horizonMs: number): ForensicAudio {
  const pcm16 = mulawToPcm16(mulaw8k);
  const pcm16k = resamplePcm16Mono(pcm16, 8000, 16000);
  const samples = Math.floor(pcm16k.length / 2);
  const float32_16k = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    float32_16k[i] = pcm16k.readInt16LE(i * 2) / 32768;
  }

  return {
    mulaw8k,
    pcm16,
    float32_16k,
    horizonMs,
    durationMs: mulaw8k.length / 8,
    sampleRate: 8000,
  };
}
