import { UserAudioAccumulator, bytesForMs, forensicAudioFromMulaw } from "./accumulator";
import { matchAndEnroll } from "./biomarker-store";
import { saveForensicClip } from "./clip-storage";
import { updateVoiceForensics, updateVoiceForensicsProgress } from "./persistence";
import { runVoiceForensics } from "./runner";
import { VOICE_FORENSICS_HORIZONS_MS } from "./types";
import type { ForensicContext, VoiceForensicsHorizonResult, VoiceForensicsResult } from "./types";
import { buildCleanUserAudio } from "./vad-segmenter";

const ENABLED = process.env.VOICE_FORENSICS_ENABLED !== "false";

/**
 * Per-call forensics session. The call bridge feeds it user-only μ-law frames;
 * it runs each QA horizon once when enough user audio exists and upserts the
 * latest aggregate. All errors are swallowed so forensics cannot affect a call.
 */
export interface VoiceForensicsSession {
  /** Feed one base64 μ-law frame. `speech` gates silence out of the accumulator. */
  feed(payload: string, speech?: boolean): void;
  /** Persist final user-audio duration and wait for any active horizon writes. */
  finalize(): Promise<void>;
  /** Most recent aggregate, if any (in-memory, for callers that want it). */
  latest(): VoiceForensicsResult | null;
}

export function readyVoiceForensicsHorizons(
  userAudioMs: number,
  startedOrCompleted: ReadonlySet<number>,
): number[] {
  return VOICE_FORENSICS_HORIZONS_MS.filter((horizonMs) =>
    userAudioMs >= horizonMs && !startedOrCompleted.has(horizonMs)
  );
}

export function createVoiceForensicsSession(context: ForensicContext): VoiceForensicsSession {
  if (!ENABLED || !context.callId) return NOOP_SESSION;

  const accumulator = new UserAudioAccumulator();
  let last: VoiceForensicsResult = emptyResult(0);

  function saveClip(key: string, pcm16: Buffer): void {
    try {
      saveForensicClip(context.callId, key, pcm16);
    } catch (err) {
      console.warn(`[voice-forensics] clip save failed callId=${context.callId} key=${key}:`, err instanceof Error ? err.message : err);
    }
  }

  /**
   * Post-call pipeline: take the entire contiguous caller audio, run the VAD to
   * strip long silences, then analyze the horizon prefixes of the CLEAN track.
   * Saves the raw-full, processed-full, and per-horizon clips for playback.
   */
  async function analyzePostCall(): Promise<void> {
    const fullMulaw = accumulator.fullMulaw();
    if (fullMulaw.length === 0) return;

    const horizons: Record<string, VoiceForensicsHorizonResult> = {};
    const analyze = async (key: string, audio: ReturnType<typeof forensicAudioFromMulaw>, cumulativeMs: number): Promise<void> => {
      saveClip(key, audio.pcm16);
      try {
        horizons[key] = await runVoiceForensics(audio, context, cumulativeMs);
      } catch (err) {
        console.warn(`[voice-forensics] analysis failed callId=${context.callId} key=${key}:`, err instanceof Error ? err.message : err);
        return;
      }
      // Expected gender of the claimed identity travels with the result so the
      // UI can verdict "detected vs expected" without re-resolving the persona.
      if (horizons[key]?.biomarker) {
        horizons[key].biomarker.selfExpectedGender = context.gender ?? null;
      }
      // Enroll + match locally against the global DuckDB gallery (per-horizon
      // bucket, self excluded). Overwrites the model's empty `matches`.
      // Fault-isolated: a gallery failure must never break the call.
      const emb = horizons[key]?.biomarker?.embedding;
      if (emb && emb.length > 0) {
        try {
          const matched = await matchAndEnroll(context, key, emb);
          horizons[key].biomarker.matches = matched.matches;
          horizons[key].biomarker.selfSimilarity = matched.selfSimilarity;
          horizons[key].biomarker.selfLabel = context.name ?? context.biomarkerId ?? null;
          horizons[key].biomarker.embeddingSaved = matched.enrolled;
          horizons[key].biomarker.enrollmentSkippedReason = matched.enrollmentSkippedReason;
          horizons[key].biomarker.duplicateVoiceOf = matched.duplicateVoiceOf;
        } catch (err) {
          console.warn(`[voice-forensics] biomarker match failed callId=${context.callId} key=${key}:`, err instanceof Error ? err.message : err);
        }
      }
      // Drop the raw embedding so it never bloats vf_results_json / the UI payload.
      if (horizons[key]?.biomarker) delete horizons[key].biomarker.embedding;
    };

    // Full raw (wall-clock, with silence) — saved + analyzed.
    const rawMs = fullMulaw.length / 8;
    const rawAudio = forensicAudioFromMulaw(fullMulaw, rawMs);
    await analyze("full-raw", rawAudio, rawMs);

    // Full processed (long silences removed) — saved + analyzed. Horizons below
    // are all sliced from THIS clean track.
    const clean = await buildCleanUserAudio(fullMulaw);
    const processed = clean.processedMulaw8k;
    const processedFull = forensicAudioFromMulaw(processed, clean.processedMs);
    await analyze("full-processed", processedFull, clean.processedMs);

    // 0.5s / 1s / 2s / 5s prefixes of the CLEAN track.
    for (const horizonMs of VOICE_FORENSICS_HORIZONS_MS) {
      if (clean.processedMs < horizonMs) continue;
      const slice = processed.subarray(0, bytesForMs(horizonMs));
      await analyze(String(horizonMs), forensicAudioFromMulaw(slice, horizonMs), clean.processedMs);
    }

    last = {
      horizons,
      analyzedAt: new Date().toISOString(),
      cumulativeMs: clean.processedMs,
      userAudioMs: clean.processedMs,
    };

    if (Object.keys(horizons).length > 0) {
      await updateVoiceForensics(context.callId, context.datasetId, context.campaignId, last);
    } else {
      await updateVoiceForensicsProgress(context.callId, context.datasetId, context.campaignId, clean.processedMs);
    }
  }

  return {
    feed(payload: string, speech = true): void {
      try {
        accumulator.append(payload, speech);
      } catch (err) {
        console.warn(`[voice-forensics] feed failed callId=${context.callId}:`, err instanceof Error ? err.message : err);
      }
    },
    async finalize(): Promise<void> {
      try {
        await analyzePostCall();
      } catch (err) {
        console.warn(`[voice-forensics] finalize failed callId=${context.callId}:`, err instanceof Error ? err.message : err);
      }
    },
    latest(): VoiceForensicsResult | null {
      return last.userAudioMs > 0 || Object.keys(last.horizons).length > 0 ? last : null;
    },
  };
}

function emptyResult(userAudioMs: number): VoiceForensicsResult {
  return {
    horizons: {},
    analyzedAt: new Date().toISOString(),
    cumulativeMs: userAudioMs,
    userAudioMs,
  };
}

const NOOP_SESSION: VoiceForensicsSession = {
  feed() {},
  async finalize() {},
  latest() {
    return null;
  },
};
