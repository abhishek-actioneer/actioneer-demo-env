import { mulawToPcm16 } from "../telephony-audio";

/**
 * Post-call silence removal for voice forensics.
 *
 * Takes the ENTIRE contiguous user-side μ-law audio, runs an energy-based VAD
 * to find where the caller actually spoke, and rebuilds a clean track that keeps
 * the voiced audio and short natural pauses but removes only LONG dead-air
 * stretches. Cuts happen strictly inside long silences, so joining is click-free
 * without any fades or added silence — no processing is applied to the voice.
 *
 * Why energy VAD (not Silero): the offline Silero-legacy model in avr-vad
 * over-triggered badly on 8kHz telephony audio (marked ~100% as speech). A
 * simple RMS gate cleanly separates caller speech (thousands RMS) from telephony
 * silence (~0 RMS) and matches the ground-truth energy profile of real calls.
 *
 * Rules (agreed):
 *   - Remove only silence gaps longer than MAX_KEPT_SILENCE_MS.
 *   - Keep gaps ≤ MAX_KEPT_SILENCE_MS untouched (natural pauses stay).
 *   - Tail (and small head) hangover so word edges aren't clipped.
 *   - No fades, no inserted silence, no other DSP.
 */

const BYTES_PER_MS = 8;        // μ-law 8kHz mono => 8 bytes/ms
const FRAME_SAMPLES = 160;     // 20ms @ 8kHz
const MIN_SPEECH_MS = 100;     // drop shorter blips (clicks/noise)
const HEAD_MS = 40;            // small pre-roll so onsets aren't clipped
const TAIL_MS = 120;           // hangover so word endings aren't clipped
const MAX_KEPT_SILENCE_MS = 3000; // only silence longer than this is excised
const ABS_THRESH = 250;        // RMS floor for "speech"
const PEAK_FRACTION = 0.06;    // ...or 6% of the p95 peak, whichever is higher

export interface VoicedSegment {
  startMs: number;
  endMs: number;
}

export interface CleanUserAudio {
  /** μ-law 8kHz mono with long silences removed. */
  processedMulaw8k: Buffer;
  /** Wall-clock length of the raw input, ms. */
  rawMs: number;
  /** Length of the processed (silence-trimmed) track, ms. */
  processedMs: number;
  /** Voiced segments detected (with hangover applied), in ms. */
  segments: VoicedSegment[];
}

/** Per-frame RMS over the decoded 8kHz PCM16. */
function frameRms(pcm16: Buffer): number[] {
  const frames = Math.floor(pcm16.length / 2 / FRAME_SAMPLES);
  const rms: number[] = new Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let i = 0; i < FRAME_SAMPLES; i += 1) {
      const v = pcm16.readInt16LE((f * FRAME_SAMPLES + i) * 2);
      sum += v * v;
    }
    rms[f] = Math.sqrt(sum / FRAME_SAMPLES);
  }
  return rms;
}

/**
 * Energy VAD → voiced segments (in ms) with head/tail hangover applied and
 * merged. Segments are relative to the μ-law timeline (20ms granularity).
 */
export function detectVoicedSegments(mulaw8k: Buffer): VoicedSegment[] {
  if (mulaw8k.length === 0) return [];
  const pcm16 = mulawToPcm16(mulaw8k);
  const rms = frameRms(pcm16);
  const n = rms.length;
  if (n === 0) return [];

  const sorted = [...rms].sort((a, b) => a - b);
  const peak = sorted[Math.min(n - 1, Math.floor(0.95 * n))];
  const thresh = Math.max(ABS_THRESH, PEAK_FRACTION * peak);

  const head = Math.round(HEAD_MS / 20);
  const tail = Math.round(TAIL_MS / 20);
  const minRun = Math.round(MIN_SPEECH_MS / 20);

  // Contiguous runs of frames above threshold, blips dropped, hangover applied.
  const segs: VoicedSegment[] = [];
  let runStart = -1;
  const flush = (endFrame: number) => {
    if (runStart < 0) return;
    if (endFrame - runStart >= minRun) {
      const s = Math.max(0, runStart - head);
      const e = Math.min(n, endFrame + tail);
      const last = segs[segs.length - 1];
      if (last && s * 20 <= last.endMs) last.endMs = Math.max(last.endMs, e * 20);
      else segs.push({ startMs: s * 20, endMs: e * 20 });
    }
    runStart = -1;
  };
  for (let f = 0; f < n; f += 1) {
    if (rms[f] > thresh) { if (runStart < 0) runStart = f; }
    else flush(f);
  }
  flush(n);
  return segs;
}

function msToByteOffset(ms: number, totalBytes: number): number {
  return Math.min(totalBytes, Math.max(0, Math.round(ms * BYTES_PER_MS)));
}

/**
 * Build the clean track: keep everything except silence runs longer than
 * MAX_KEPT_SILENCE_MS. Returns raw audio unchanged when no speech is detected.
 */
export async function buildCleanUserAudio(mulaw8k: Buffer): Promise<CleanUserAudio> {
  const totalBytes = mulaw8k.length;
  const rawMs = totalBytes / BYTES_PER_MS;
  if (totalBytes === 0) {
    return { processedMulaw8k: Buffer.alloc(0), rawMs: 0, processedMs: 0, segments: [] };
  }

  const voiced = detectVoicedSegments(mulaw8k);

  // No speech detected → fall back to raw contiguous audio (never emit silence).
  if (voiced.length === 0) {
    return { processedMulaw8k: mulaw8k, rawMs, processedMs: rawMs, segments: [] };
  }

  // Silence intervals are the complement of voiced within [0, rawMs].
  // Excise only those longer than MAX_KEPT_SILENCE_MS; keep the rest verbatim.
  const cuts: VoicedSegment[] = [];
  let cursor = 0;
  for (const v of voiced) {
    if (v.startMs - cursor > MAX_KEPT_SILENCE_MS) cuts.push({ startMs: cursor, endMs: v.startMs });
    cursor = v.endMs;
  }
  if (rawMs - cursor > MAX_KEPT_SILENCE_MS) cuts.push({ startMs: cursor, endMs: rawMs });

  const keptChunks: Buffer[] = [];
  let keepFrom = 0;
  for (const cut of cuts) {
    if (cut.startMs > keepFrom) {
      keptChunks.push(mulaw8k.subarray(msToByteOffset(keepFrom, totalBytes), msToByteOffset(cut.startMs, totalBytes)));
    }
    keepFrom = cut.endMs;
  }
  if (keepFrom < rawMs) {
    keptChunks.push(mulaw8k.subarray(msToByteOffset(keepFrom, totalBytes), totalBytes));
  }

  const processedMulaw8k = keptChunks.length > 0 ? Buffer.concat(keptChunks) : mulaw8k;
  return {
    processedMulaw8k,
    rawMs,
    processedMs: processedMulaw8k.length / BYTES_PER_MS,
    segments: voiced,
  };
}
