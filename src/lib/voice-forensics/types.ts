/**
 * Voice-forensics types for user-side / customer-side audio analysis.
 *
 * The live bridge feeds only Plivo inbound media frames, so the accumulated
 * signal is user audio, not full call audio. Results are generated at fixed QA
 * horizons over the first N milliseconds of user speech: 0.5s, 1s, 2s, 5s.
 */

export const VOICE_FORENSICS_HORIZONS_MS = [500, 1000, 2000, 5000] as const;
export type VoiceForensicsHorizonMs = (typeof VOICE_FORENSICS_HORIZONS_MS)[number];

export type VoiceForensicsTaskStatus = "ready" | "unavailable" | "error";
export type VoiceForensicsHorizonStatus = VoiceForensicsTaskStatus | "pending";

/**
 * One chunk of accumulated user-only audio handed to the model runner. Carries
 * the signal in three shapes so no runner is forced to re-decode:
 *   - `mulaw8k`      raw μ-law exactly as Plivo delivers it (8kHz mono)
 *   - `pcm16`        decoded signed 16-bit PCM, still 8kHz mono
 *   - `float32_16k`  decoded, resampled to 16kHz mono, range [-1, 1]
 */
export interface ForensicAudio {
  /** Raw accumulated μ-law bytes (8kHz mono), clipped to the requested horizon. */
  mulaw8k: Buffer;
  /** Decoded signed 16-bit PCM, little-endian, 8kHz mono. */
  pcm16: Buffer;
  /** Decoded + resampled to 16kHz mono, normalized to [-1, 1]. */
  float32_16k: Float32Array;
  /** Requested QA horizon, milliseconds. */
  horizonMs: number;
  /** Actual user audio duration this chunk represents, milliseconds. */
  durationMs: number;
  /** 8000 — kept explicit so downstream code never assumes a rate. */
  sampleRate: 8000;
}

/** Age head (child/adult) carried by the age+gender models only. */
export interface VoiceForensicsAgeResult {
  /** P(adult). */
  score: number;
  /** Verdict at the fixed 0.5 threshold. */
  verdict: string;
  threshold: number;
  /** Model's native calibrated age threshold, if any. */
  nativeThreshold: number | null;
  /** Verdict at the native calibrated threshold. */
  nativeVerdict: string | null;
}

export interface VoiceForensicsModelRow {
  modelId: string;
  modelName: string;
  /** Task score. Gender uses P(male); LA uses P(spoof); PA uses P(replay). */
  score: number | null;
  /** Verdict at the fixed 0.5 threshold. */
  verdict: string | null;
  threshold: number;
  /** Model's native calibrated threshold (from the checkpoint), if any. */
  nativeThreshold?: number | null;
  /** Verdict at the native calibrated threshold. */
  nativeVerdict?: string | null;
  /** Present only for the age+gender models. */
  age?: VoiceForensicsAgeResult | null;
  status: VoiceForensicsTaskStatus;
  detail?: string;
}

export interface VoiceForensicsTaskRows {
  rows: VoiceForensicsModelRow[];
}

export interface VoiceForensicsBiomarkerMatch {
  rank: number;
  score: number;
  phone: string | null;
  name: string | null;
  userId: string | null;
}

/**
 * Provenance of the biomarker identity key. Drives the enrollment policy:
 * `customer-id` → verify-then-refresh, `pinned-subject` → frozen whole-subject,
 * `phone` → verification-only (never enrolled), `unverified-customer` → a
 * customer identity whose dialed number did NOT match their registered phone:
 * benched against the customer's reference but never enrolled.
 */
export type BiomarkerKeySource = "customer-id" | "pinned-subject" | "phone" | "unverified-customer";

export interface VoiceForensicsBiomarkerResult {
  embeddingSaved: boolean;
  matches: VoiceForensicsBiomarkerMatch[];
  /** Why this call's embedding was not enrolled, when it wasn't. */
  enrollmentSkippedReason?: string | null;
  /**
   * Set when this caller's voice matches a DIFFERENT enrolled identity in the
   * same dataset at/above the duplicate-voice threshold — one voice operating
   * multiple identities is itself a fraud signal.
   */
  duplicateVoiceOf?: { biomarkerId: string; name: string | null; score: number } | null;
  /**
   * Cosine similarity vs the SAME claimed identity's previously enrolled
   * embedding in this horizon bucket (computed before this call's upsert).
   * Null on the identity's first call or when no stable biomarkerId exists.
   */
  selfSimilarity?: number | null;
  /** Display name of the identity this call's voice is being verified against. */
  selfLabel?: string | null;
  /** Expected gender of that identity, when the script is pinned to one person. */
  selfExpectedGender?: "male" | "female" | null;
  modelId?: string;
  detail?: string;
  /**
   * Raw speaker embedding returned by the model (192-d, L2-normalized). Used to
   * enroll + match locally in the DuckDB gallery; not persisted in vf_results.
   */
  embedding?: number[];
}

export interface VoiceForensicsHorizonResult {
  status: VoiceForensicsHorizonStatus;
  horizonMs: number;
  /** Total user audio captured by the bridge when this result was written. */
  userAudioMs: number;
  /** Audio duration actually sent to models for this horizon. */
  analyzedAudioMs: number;
  gender: VoiceForensicsTaskRows;
  la: VoiceForensicsTaskRows;
  pa: VoiceForensicsTaskRows;
  biomarker: VoiceForensicsBiomarkerResult;
  error?: string;
}

export interface VoiceForensicsResult {
  horizons: Record<string, VoiceForensicsHorizonResult>;
  /** ISO timestamp the aggregate was last updated. */
  analyzedAt: string;
  /** Cumulative user speech/audio captured so far this call, milliseconds. */
  cumulativeMs: number;
  /** Alias used by UI/API to make the unit explicit. */
  userAudioMs: number;
}

/** Per-call context the runner may need for lookup/enrollment metadata. */
export interface ForensicContext {
  callId: string;
  datasetId: string;
  campaignId?: string;
  phone?: string;
  name?: string;
  /** Expected gender of the claimed identity, when the script is pinned to one person. */
  gender?: "male" | "female" | null;
  /**
   * Freeze enrollment: once this identity has an enrolled embedding, never
   * overwrite it from later calls. Set for pinned verification subjects so the
   * reference voiceprint stays fixed instead of drifting to the last caller.
   */
  enrollOnce?: boolean;
  userId?: string;
  biomarkerId?: string;
  /** Provenance of `biomarkerId` — selects the gallery's enrollment policy. */
  keySource?: BiomarkerKeySource;
}
