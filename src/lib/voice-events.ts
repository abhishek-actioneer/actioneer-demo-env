/**
 * voice-events.ts — Hot-path-safe voice observability emitter + frozen taxonomy.
 *
 * Single module every emitting layer routes through (U1 of the Voice E2E
 * Observability plan). Provides:
 *   - the frozen flat snake_case event taxonomy (KTD1),
 *   - a DEDICATED batched PostHog client (flushAt:20) — NOT the flushAt:1
 *     `getPostHog()` singleton, which would fire an un-batched HTTP POST per
 *     event on the audio event loop (KTD2),
 *   - a NON-awaiting `emitVoiceEvent` with an explicit distinctId (= call_id),
 *     no `flush()`, no Clerk `auth()` — safe to call from the audio hot path,
 *   - the always-on `console.log("[voice/latency] …")` local sink (fail-open,
 *     fires even when POSTHOG_API_KEY is unset — R5/AE4),
 *   - the pure `deriveTurnLatencies` timing helper (consumed by U2),
 *   - env flags and id helpers.
 *
 * HOT-PATH CONTRACT (R6): no `await`, no `flush()`, no `auth()` in this file.
 */

import { PostHog } from "posthog-node";

// ─────────────────────────────────────────────────────────────────────────────
// Env flags (KTD5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Master emit switch, evaluated at IMPORT time. Safe only in Next-runtime code
 * (env already loaded). Do NOT gate emits on this inside the custom WS server /
 * bridges — those import this module before Next loads `.env.local`, so the const
 * freezes `false` and silently drops events. Emits gate themselves dynamically
 * via `latencyEnabled()`; call the typed `emitVoice*` helpers and let them decide.
 */
export const VOICE_LATENCY_METRICS_ENABLED = process.env.VOICE_LATENCY_METRICS === "1";

/** Layer 2 enrichment sample rate (default 1.0 — every call). Spine is never sampled. */
export const VOICE_ENRICHMENT_SAMPLE_RATE = Number(process.env.VOICE_ENRICHMENT_SAMPLE_RATE ?? "1");

/**
 * Read the master switch dynamically so tests can toggle the env without a
 * module reset. Consumers that want the boolean at import time use the const.
 */
function latencyEnabled(): boolean {
  return process.env.VOICE_LATENCY_METRICS === "1";
}

// ─────────────────────────────────────────────────────────────────────────────
// Frozen taxonomy (KTD1) — flat snake_case
// ─────────────────────────────────────────────────────────────────────────────

export type VoicePipeline = "gemini_live" | "openai_realtime" | "sarvam_cascaded";

export const VOICE_EVENTS = {
  triggered: "voice_call_triggered",
  wsConnected: "voice_ws_connected",
  setupComplete: "voice_setup_complete",
  transcriptFinalized: "voice_transcript_finalized",
  turn: "voice_turn",
  enrichment: "voice_call_enrichment",
} as const;

export type VoiceLifecycleEvent =
  | typeof VOICE_EVENTS.triggered
  | typeof VOICE_EVENTS.wsConnected
  | typeof VOICE_EVENTS.setupComplete
  | typeof VOICE_EVENTS.transcriptFinalized;

// `realtime_inline` covers non-Gemini realtime bridges (openai_realtime, sarvam)
// whose transcript is produced inline during the call. Additive to the frozen
// taxonomy — existing gemini_inline / openai_postcall HogQL filters are unaffected.
export type TranscriptSource = "gemini_inline" | "openai_postcall" | "realtime_inline";
export type EouSource = "gemini_vad_proxy" | "raw_frame_proxy";

/** Per-turn record (KTD1 `voice_turn`). */
export interface VoiceTurnRecord {
  speech_id: string;
  turn_index: number;
  eou_proxy_ms: number | null;
  eou_source: EouSource;
  voice_to_voice_ms: number | null;
  detection_think_ms: number | null;
  response_lag_ms: number | null;
  total_turn_ms: number | null;
  interrupted: boolean;
}

/** Derived latency split returned by the pure timing helper. */
export interface DerivedTurnLatencies {
  eou_proxy_ms: number | null;
  detection_think_ms: number | null;
  response_lag_ms: number | null;
  voice_to_voice_ms: number | null;
  total_turn_ms: number | null;
}

export type JudgeStatus = "ok" | "error";

/** Per-call enrichment record (KTD1 `voice_call_enrichment`). */
export interface VoiceEnrichmentRecord {
  sentiment_trajectory: Array<{ turn_index: number; label: string }>;
  question_types: string[];
  script_adherence_scores: Record<string, unknown> | null;
  interruption_handling: { judge_status: JudgeStatus; [k: string]: unknown } | null;
  compliance_violations: { judge_status: JudgeStatus; [k: string]: unknown } | null;
  enriched: boolean;
  sample_rate: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dedicated voice PostHog client (KTD2) — batched, non-flushAt:1
// ─────────────────────────────────────────────────────────────────────────────

/** Sane batching so per-turn emits do not storm the audio event loop (KTD2). */
export const VOICE_POSTHOG_OPTIONS = {
  flushAt: 20,
  flushInterval: 5000,
  maxQueueSize: 1000,
} as const;

/** Minimal client surface the emitter needs — keeps it injectable for tests. */
export interface VoiceCaptureClient {
  capture: (payload: {
    distinctId: string;
    event: string;
    properties: Record<string, unknown>;
  }) => void;
  flush?: () => Promise<void>;
}

let _client: VoiceCaptureClient | null = null;
let _override: VoiceCaptureClient | null | undefined;

/**
 * Test seam: override the voice client (pass a spy) or `null` to simulate an
 * unconfigured PostHog. Pass `undefined` to clear the override.
 */
export function setVoiceClientForTesting(client: VoiceCaptureClient | null | undefined): void {
  _override = client;
}

function getVoiceClient(): VoiceCaptureClient | null {
  if (_override !== undefined) return _override;
  if (!process.env.POSTHOG_API_KEY) return null;
  if (!_client) {
    _client = new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
      ...VOICE_POSTHOG_OPTIONS,
    }) as unknown as VoiceCaptureClient;
  }
  return _client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Id helpers
// ─────────────────────────────────────────────────────────────────────────────

/** speech_id = `${call_id}:${turn_index}` — deterministic, no clock/random. */
export function makeSpeechId(callId: string, turnIndex: number): string {
  return `${callId}:${turnIndex}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure timing derivation (KTD4) — unit-testable without telephony
// ─────────────────────────────────────────────────────────────────────────────

/** Above this a value is almost certainly a wall-clock `Date.now()` read, not a
 *  stream offset — guard rather than silently clamp (KTD4 constraint 3). */
const STREAM_OFFSET_SANITY_MS = 1e10;

function assertStreamOffset(name: string, v: number | null): void {
  if (v === null) return;
  if (!Number.isFinite(v) || v > STREAM_OFFSET_SANITY_MS) {
    throw new Error(
      `[voice/latency] ${name}=${v} is not a stream offset (KTD4: all clocks must read streamOffsetMs())`,
    );
  }
}

/**
 * Derive the per-turn latency split from four stream-relative offsets.
 *
 *   detection_think_ms = modelStart − lastSpeech   (Gemini VAD + think window)
 *   response_lag_ms    = firstAudio − modelStart   (the movable component)
 *   voice_to_voice_ms  = firstAudio − lastSpeech   (primary KPI)
 *   total_turn_ms      = turnComplete − lastSpeech
 *
 * `lastSpeech` is the frozen `eouProxy` (last SPEECH frame before model-start).
 * `firstAudio`/`turnComplete` may be null (interrupted turn with no outbound
 * audio) → the dependent latencies are null, never a misleading 0.
 * All inputs must be `streamOffsetMs()` reads; a wall-clock value throws.
 */
export function deriveTurnLatencies(
  lastSpeechMs: number | null,
  modelStartMs: number | null,
  firstAudioMs: number | null,
  turnCompleteMs: number | null,
): DerivedTurnLatencies {
  assertStreamOffset("lastSpeechMs", lastSpeechMs);
  assertStreamOffset("modelStartMs", modelStartMs);
  assertStreamOffset("firstAudioMs", firstAudioMs);
  assertStreamOffset("turnCompleteMs", turnCompleteMs);

  const clamp = (n: number) => (n < 0 ? 0 : n);

  const detection_think_ms =
    lastSpeechMs !== null && modelStartMs !== null ? clamp(modelStartMs - lastSpeechMs) : null;
  const response_lag_ms =
    firstAudioMs !== null && modelStartMs !== null ? clamp(firstAudioMs - modelStartMs) : null;
  const voice_to_voice_ms =
    firstAudioMs !== null && lastSpeechMs !== null ? clamp(firstAudioMs - lastSpeechMs) : null;
  const total_turn_ms =
    turnCompleteMs !== null && lastSpeechMs !== null ? clamp(turnCompleteMs - lastSpeechMs) : null;

  return {
    eou_proxy_ms: lastSpeechMs,
    detection_think_ms,
    response_lag_ms,
    voice_to_voice_ms,
    total_turn_ms,
  };
}

/**
 * Speech-gated end-of-utterance tracker (KTD4 constraint 1). Only advances the
 * frozen `lastSpeechFrameMs` on speech-classified frames; silence frames are
 * ignored so `eouProxy` does not collapse to ~modelStart.
 */
export function updateLastSpeechFrame(prev: number | null, frameMs: number, isSpeech: boolean): number | null {
  return isSpeech ? frameMs : prev;
}

// ─────────────────────────────────────────────────────────────────────────────
// Emitter core — NON-awaiting, explicit distinctId, no flush/auth (KTD2/R6)
// ─────────────────────────────────────────────────────────────────────────────

function emitVoiceEvent(
  event: string,
  props: Record<string, unknown>,
  callId: string,
  pipeline: VoicePipeline,
  localSink: (line: Record<string, unknown>) => void,
): void {
  if (!latencyEnabled()) return;

  // Observability must NEVER throw into a caller — this runs in the audio hot
  // path and in the pre-dial API route. Any failure (a throwing PostHog client,
  // a bad key, JSON issues) is swallowed and logged; the call is untouched.
  try {
    // Local sink first — always fires when the flag is on, even if PostHog is
    // unconfigured (fail-open, R5/AE4).
    localSink({ event, call_id: callId, pipeline, ...props });

    const client = getVoiceClient();
    if (!client) return;
    // Fire-and-forget. No await, no flush, no auth() — hot-path safe (R6).
    client.capture({
      distinctId: callId,
      event,
      properties: {
        call_id: callId,
        $ai_trace_id: callId,
        pipeline,
        ...props,
      },
    });
  } catch (err) {
    try {
      console.warn(`[voice/latency] emit failed (non-fatal): ${(err as Error)?.message ?? err}`);
    } catch {
      /* never let the failure handler itself throw */
    }
  }
}

function defaultLocalSink(line: Record<string, unknown>): void {
  console.log("[voice/latency] " + JSON.stringify(line));
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed public helpers — fix each event's property shape at compile time
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle events (voice_call_triggered / ws_connected / setup_complete / transcript_finalized). */
export function emitVoiceLifecycle(
  event: VoiceLifecycleEvent,
  props: Record<string, unknown>,
  callId: string,
  pipeline: VoicePipeline = "gemini_live",
): void {
  emitVoiceEvent(event, props, callId, pipeline, defaultLocalSink);
}

/** Per-turn latency record. */
export function emitVoiceTurn(record: VoiceTurnRecord, callId: string, pipeline: VoicePipeline): void {
  emitVoiceEvent(VOICE_EVENTS.turn, { ...record }, callId, pipeline, defaultLocalSink);
}

/**
 * Per-call enrichment record. The local sink is REDACTED — it logs only
 * `call_id` + numeric/label scores, never verbatim transcript-derived text
 * (KTD2 exception / OQ2 data governance).
 */
export function emitVoiceEnrichment(
  record: VoiceEnrichmentRecord,
  callId: string,
  pipeline: VoicePipeline = "gemini_live",
): void {
  emitVoiceEvent(VOICE_EVENTS.enrichment, { ...record }, callId, pipeline, (line) => {
    // Redacted local sink — scores + status only, no transcript text.
    console.log(
      "[voice/latency] " +
        JSON.stringify({
          event: line.event,
          call_id: line.call_id,
          pipeline: line.pipeline,
          enriched: record.enriched,
          sample_rate: record.sample_rate,
          question_type_count: record.question_types.length,
          sentiment_turns: record.sentiment_trajectory.length,
          script_adherence_score:
            record.script_adherence_scores && typeof record.script_adherence_scores.score === "number"
              ? record.script_adherence_scores.score
              : null,
          interruption_judge_status: record.interruption_handling?.judge_status ?? null,
          compliance_judge_status: record.compliance_violations?.judge_status ?? null,
        }),
    );
  });
}
