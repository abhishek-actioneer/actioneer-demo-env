import { WebSocket } from "ws";
import type { CallConfig } from "./voice-call-state";
import { GEMINI_VOICES, getGeminiVoice } from "./gemini-voices";
import { buildVoiceLanguageDirective } from "./voice-language-policy";
import { hasGupshupWhatsAppTemplateConfig } from "../features/integrations/server/providers/gupshup/whatsapp-client";

export const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
export const GEMINI_LIVE_VOICE = process.env.GEMINI_LIVE_VOICE || "Sulafat";
const GEMINI_LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
export const PLIVO_MULAW_FRAME_BYTES = 160;
export const PLIVO_FRAME_DURATION_MS = 20;
// Single-frame batches keep first-word latency low on telephony (~20ms).
export const OUTBOUND_BATCH_FRAMES = parsePositiveInt(process.env.GEMINI_LIVE_OUTBOUND_BATCH_FRAMES, 1);
export const OUTBOUND_BATCH_BYTES = PLIVO_MULAW_FRAME_BYTES * OUTBOUND_BATCH_FRAMES;
export const OUTBOUND_PREROLL_BYTES = OUTBOUND_BATCH_BYTES;
/**
 * Steady-state playback cushion held in Plivo's buffer — see targetCushionMs in
 * plivo-gemini-live-outbound-controller.ts for why the pump paces against a
 * wall-clock deadline rather than emitting a fixed batch per timer tick.
 *
 * 200ms matches the cushion an earlier attempt at this reached for via
 * GEMINI_LIVE_OUTBOUND_BATCH_FRAMES=10, but without that setting's ~200ms cost
 * to first-word latency: preroll stays at one frame, so the first frame still
 * leaves immediately and the cushion fills by running briefly ahead of real
 * time. Raise if stutter persists on long uninterrupted agent turns.
 *
 * Read LAZILY (per call, at controller construction) so `.env.local` applies —
 * see redundantTurnPlanSuppressionEnabled for why consts here do not.
 */
export function outboundTargetCushionMs(): number {
  return parsePositiveInt(process.env.GEMINI_LIVE_OUTBOUND_CUSHION_MS, 200);
}
/** Catch-up burst ceiling per tick (frames). 25 frames = 500ms of audio. */
export function outboundMaxFramesPerTick(): number {
  return parsePositiveInt(process.env.GEMINI_LIVE_OUTBOUND_MAX_FRAMES_PER_TICK, 25);
}
export const OUTBOUND_PUMP_INTERVAL_MS = PLIVO_FRAME_DURATION_MS * OUTBOUND_BATCH_FRAMES;
export const STORE_REALTIME_TRANSCRIPT = process.env.VOICE_STORE_REALTIME_TRANSCRIPT !== "0";
export const DETECT_AUTOMATED_SCREENING = process.env.VOICE_DETECT_CALL_SCREENING !== "0";
/**
 * Fire the post-call WhatsApp follow-up from the live transcript at call close.
 * Defaults ON: this is the only trigger that trails every Gemini Live call, and
 * defaulting it off silently produced calls with no follow-up at all.
 *
 * Read LAZILY (at call-close time), same reason as redundantTurnPlanSuppressionEnabled
 * above — this module is in server.ts's static import graph, evaluated before
 * Next loads `.env.local`, so a top-level const here would only ever see real
 * shell env and silently ignore the dotenv file.
 */
export function liveTranscriptFollowUpEnabled(): boolean {
  return process.env.VOICE_POST_CALL_FOLLOWUP_FROM_LIVE_TRANSCRIPT !== "0";
}
export const PREWARM_TIMEOUT_MS = 20_000;
export const PREWARM_IDLE_TTL_MS = 90_000;
export const PREWARM_KEEPALIVE_MS = 15_000;
export const OPENING_AUDIO_GRACE_MS = parsePositiveInt(process.env.GEMINI_LIVE_OPENING_AUDIO_GRACE_MS, 400);
// How long the agent's opening line is protected from customer barge-in,
// measured from the first opening audio chunk. Before this elapses, caller audio
// is NOT forwarded to Gemini, so the pickup "hello"/line noise can't cut the
// opening off. After it, caller audio flows and the customer can interrupt the
// rest of the opening — keep this short so pickup "hello?" is not ignored.
export const OPENING_BARGE_IN_DELAY_MS = parsePositiveInt(process.env.GEMINI_LIVE_OPENING_BARGE_IN_DELAY_MS, 400);
export const MULAW_SILENCE_FRAME = Buffer.alloc(PLIVO_MULAW_FRAME_BYTES, 0xff).toString("base64");
export const GEMINI_LIVE_TEMPERATURE = parseGeminiTemperature(process.env.GEMINI_LIVE_TEMPERATURE);
/**
 * Gemini "thinking" budget for the Live session. Thinking runs a reasoning pass
 * before the model emits any audio, which inflates time-to-first-audio by
 * ~1-2s — the dominant term in per-turn voice-to-voice latency. Voice UX needs
 * snappy first audio, not a reasoning trace, so this defaults OFF (budget 0,
 * which disables thinking). Set GEMINI_LIVE_THINKING_BUDGET to a positive token
 * count to re-enable a fixed budget, or "-1" for the model's dynamic budget.
 */
export const GEMINI_LIVE_THINKING_BUDGET = ((): number => {
  const raw = process.env.GEMINI_LIVE_THINKING_BUDGET;
  if (raw == null || raw.trim() === "") return 0;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : 0;
})();
/**
 * Skip turn-plan instructions that only restate what Gemini would already do
 * (see isRedundantLiveTurnPlan). Worth ~850ms of voice-to-voice latency on the
 * turns it applies to.
 *
 * Read LAZILY on purpose. Every other constant in this file is a module-level
 * `const`, and this module is in `server.ts`'s static import graph — so it is
 * evaluated BEFORE Next loads `.env.local`, and those `process.env` reads see
 * only real shell env, never the dotenv file. Reading at call time is what makes
 * this flag actually toggleable from `.env.local` today. Do not "tidy" it into a
 * const without fixing that env-load ordering first.
 */
/**
 * RAW MODE — measurement harness, not a shipping configuration.
 *
 * Silences every piece of scripted steering we layer on top of Gemini Live so a
 * call shows what the model does unaided: no turn plans, no semantic-trap
 * resolutions, no pause/hold or call-screening prompts, no pitch-continuation
 * nudges, no WhatsApp tool instruction.
 *
 * Deliberately KEPT, because without them there is no call to measure:
 *   - the opening line (otherwise the agent never speaks first)
 *   - barge-in and its two recovery instructions (otherwise one false barge-in
 *     leaves the call dead for the rest of its life)
 * See RAW_MODE_ALLOWED_INSTRUCTION_REASONS.
 *
 * Turn plans are routed through applySuppressedTurnPlan rather than skipped, so
 * the gate-clearing still runs — an early return there is what caused the 15s
 * dead-air bug, and raw mode must not reintroduce it.
 *
 * Read LAZILY, same reason as redundantTurnPlanSuppressionEnabled below.
 */
export function rawModeEnabled(): boolean {
  return process.env.GEMINI_LIVE_RAW_MODE === "1";
}
/**
 * Instruction reasons that still reach Gemini while raw mode is on. Everything
 * else is dropped and logged as `gemini.raw_mode_instruction_blocked`, so the
 * session dump shows exactly what the harness withheld.
 */
export const RAW_MODE_ALLOWED_INSTRUCTION_REASONS = new Set([
  "opening_line",
  "opening_fallback",
  "barge_in_empty_recovery",
  "barge_in_unclear_recovery",
  "caller_idle_check",
  "post_interrupt_answer",
]);
export function redundantTurnPlanSuppressionEnabled(): boolean {
  return process.env.GEMINI_LIVE_SUPPRESS_REDUNDANT_TURN_PLAN !== "0";
}
/**
 * Seed few-shot style-demonstration turns (CallConfig.seedTurns) as initial
 * client content right after setupComplete. Default OFF until the transcript
 * eval harness shows they earn their per-call prompt cost.
 *
 * Read LAZILY, same env-load-ordering reason as
 * redundantTurnPlanSuppressionEnabled above — do not "tidy" into a const.
 */
export function seedTurnsEnabled(): boolean {
  return process.env.GEMINI_LIVE_SEED_TURNS === "1";
}
export const CUSTOM_VAD_ENABLED = process.env.GEMINI_LIVE_CUSTOM_VAD === "1";
const VAD_START_SENSITIVITY = parseStartVadSensitivity(process.env.GEMINI_LIVE_VAD_START, "START_SENSITIVITY_LOW");
const VAD_END_SENSITIVITY = parseEndVadSensitivity(process.env.GEMINI_LIVE_VAD_END, "END_SENSITIVITY_HIGH");
const VAD_PREFIX_PADDING_MS = parsePositiveInt(process.env.GEMINI_LIVE_VAD_PREFIX_PADDING_MS, 140);
const VAD_SILENCE_MS = parsePositiveInt(process.env.GEMINI_LIVE_VAD_SILENCE_MS, 450);
export const LOCAL_BARGE_IN_VAD_ENABLED = process.env.GEMINI_LIVE_LOCAL_BARGE_IN_VAD !== "0";
/**
 * Client-controlled turn-taking: disable Gemini's server VAD and send
 * activityStart/activityEnd from our local VAD. Prevents post-opening free-wheel
 * (server VAD treated line noise as a user turn).
 * Set GEMINI_LIVE_CLIENT_ACTIVITY=0 to restore server-side activity detection.
 */
export const CLIENT_CONTROLLED_ACTIVITY_ENABLED =
  process.env.GEMINI_LIVE_CLIENT_ACTIVITY !== "0";
/**
 * Silence frames (~20ms each) before activityEnd after customer stops speaking.
 * Google's Live API docs explicitly warn that with manual (client-controlled)
 * VAD the server applies zero silence tolerance of its own on activityEnd, and
 * that thresholds below 500ms "often cause fragmented audio that degrades
 * transcription and model response quality." We were at 20 frames (400ms) —
 * under that floor — which lines up with short single-word answers ("Tamil",
 * "Kannada") intermittently producing zero inputTranscription while full
 * sentences transcribed reliably. 28 frames (560ms) clears the documented
 * minimum with margin. Do not drop this back below 25 frames (500ms).
 */
export const CLIENT_ACTIVITY_END_SILENCE_FRAMES = parsePositiveInt(
  process.env.GEMINI_LIVE_CLIENT_ACTIVITY_END_FRAMES,
  28,
);
/** Lazy equivalent used by the custom server after Next has loaded .env.local. */
export function clientActivityEndSilenceFrames(): number {
  return parsePositiveInt(process.env.GEMINI_LIVE_CLIENT_ACTIVITY_END_FRAMES, 28);
}
/**
 * Silence frames before activityEnd for an utterance that already carried a
 * substantial amount of speech (see CLIENT_ACTIVITY_END_LONG_UTTERANCE_FRAMES).
 *
 * The 28-frame floor above exists for ONE failure mode: very short answers,
 * where clipping the tail leaves Gemini too little audio to transcribe at all.
 * A multi-word utterance is not at risk of that — by the time the caller has
 * produced ~700ms of speech, the ASR has plenty to work with, and the extra
 * 280ms of trailing silence is pure dead air on the critical path. This is the
 * single largest fixed cost in per-turn voice-to-voice latency that we own.
 *
 * 14 frames (280ms) still exceeds typical intra-phrase pauses, and the
 * ACTIVITY_MIN_OPEN_SPEECH_FRAMES guard in the barge-in controller separately
 * prevents a mid-sentence breath from closing the window.
 *
 * Raise this if callers report being cut off mid-thought — it is the direct
 * trade against per-turn latency.
 *
 * Read LAZILY so it is tunable from `.env.local` — see the note on
 * redundantTurnPlanSuppressionEnabled for why module-level consts in this file
 * silently ignore that file. Called once per 20ms silence frame; negligible.
 */
export function activityEndSilenceFramesLong(): number {
  return parsePositiveInt(process.env.GEMINI_LIVE_CLIENT_ACTIVITY_END_FRAMES_LONG, 14);
}
/**
 * Speech frames inside an open activity window above which the utterance counts
 * as "long" and the shorter end-silence threshold applies. 35 frames ≈ 700ms of
 * actual speech — comfortably past the one-word answers the 28-frame floor
 * protects, while still covering short phrases like "haan theek hai".
 */
export function activityEndLongUtteranceFrames(): number {
  return parsePositiveInt(process.env.GEMINI_LIVE_CLIENT_ACTIVITY_LONG_UTTERANCE_FRAMES, 35);
}
/**
 * Neural (Silero, via avr-vad) VAD running client-side alongside the RMS/energy
 * heuristic above. Only ever ADDS a trigger to open Gemini's activity window
 * during the awaiting-customer / no-echo state — see notifySileroSpeechStart
 * in plivo-gemini-live-barge-in.ts.
 *
 * Default OFF, opt-in via GEMINI_LIVE_SILERO_VAD=1. Two things confirmed
 * against a real call recording changed the calculus here: (1) the RMS
 * heuristic alone was ALREADY correctly detecting the customer's real speech
 * in this call (26/300 frames flagged across 5 separate "Tamil" utterances) —
 * the original "missed short answers" bug turned out to live entirely in
 * isOutOfDomainTranscript discarding the transcript downstream, not in VAD
 * detection. (2) Even after tightening thresholds, Silero opened activity
 * windows on pure ambient/room noise later in the same call, and Gemini's ASR
 * fabricated full plausible-sounding English sentences from it — a false
 * positive here is not "cheap," it derails the conversation. Net: for the bug
 * that was actually reported, Silero added cost without adding benefit. Left
 * wired and working (see plivo-gemini-live-vad.ts) for future opt-in use once
 * there's a way to tune it against a larger set of real recordings.
 */
export const SILERO_VAD_ENABLED = process.env.GEMINI_LIVE_SILERO_VAD === "1";
/**
 * Thresholds tuned between avr-vad's defaults (0.5 / 0.35, minSpeechFrames 9 —
 * confirmed via a real recording to produce zero detections on genuine
 * telephony speech) and maximally permissive. A real call recording also
 * confirmed the cost on the other side: at 0.35 / 4 frames, Silero opened
 * activity windows on pure room/ambient noise during "awaiting customer"
 * silence, and Gemini's ASR fabricated full plausible-sounding English
 * sentences from it (confirmed hallucination, not a real transcript) — a
 * false positive here is NOT free. 0.42 / 6 frames (~192ms) is a middle
 * ground: still well below the stock threshold that missed real words, but
 * requires a more sustained, more confident speech-like signal than a
 * transient noise blip.
 */
export const SILERO_VAD_POSITIVE_THRESHOLD = parseRatio(
  process.env.GEMINI_LIVE_SILERO_VAD_POSITIVE_THRESHOLD,
  0.42,
);
export const SILERO_VAD_NEGATIVE_THRESHOLD = parseRatio(
  process.env.GEMINI_LIVE_SILERO_VAD_NEGATIVE_THRESHOLD,
  0.25,
);
/** minSpeechFrames at 512 samples/frame @16kHz = 32ms/frame; 6 frames ≈192ms. */
export const SILERO_VAD_MIN_SPEECH_FRAMES = parsePositiveInt(
  process.env.GEMINI_LIVE_SILERO_VAD_MIN_SPEECH_FRAMES,
  6,
);
export const SILERO_VAD_REDEMPTION_FRAMES = parsePositiveInt(
  process.env.GEMINI_LIVE_SILERO_VAD_REDEMPTION_FRAMES,
  24,
);
// Slightly softer absolute floors so quiet talkers can still interrupt; echo
// resistance comes from the agent-speaking multiplier + shared cut cooldown.
export const LOCAL_BARGE_IN_MIN_RMS = parsePositiveInt(process.env.GEMINI_LIVE_LOCAL_BARGE_IN_RMS, 2400);
export const LOCAL_BARGE_IN_MIN_PEAK = parsePositiveInt(process.env.GEMINI_LIVE_LOCAL_BARGE_IN_PEAK, 6500);
export const LOCAL_BARGE_IN_MIN_ACTIVE_RATIO = parseRatio(process.env.GEMINI_LIVE_LOCAL_BARGE_IN_ACTIVE_RATIO, 0.28);
export const LOCAL_BARGE_IN_MIN_SPEECH_FRAMES = parsePositiveInt(process.env.GEMINI_LIVE_LOCAL_BARGE_IN_FRAMES, 4);
export const LOCAL_BARGE_IN_RESET_SILENCE_FRAMES = parsePositiveInt(process.env.GEMINI_LIVE_LOCAL_BARGE_IN_RESET_FRAMES, 8);
/**
 * Sustained voice-like frames needed when only the adaptive RMS bar failed.
 * At ~20ms/frame, 12 frames gives the outbound 200ms Plivo cushion time to
 * drain after a soft hold: playback echo disappears, while a real caller keeps
 * speaking and is confirmed without per-call threshold tuning.
 */
export const LOCAL_BARGE_IN_CANDIDATE_CONFIRM_FRAMES = parsePositiveInt(
  process.env.GEMINI_LIVE_LOCAL_BARGE_IN_CANDIDATE_FRAMES,
  12,
);
/** Was 2200 — felt like barge-in "didn't work" on back-to-back interrupts. */
export const LOCAL_BARGE_IN_COOLDOWN_MS = parsePositiveInt(process.env.GEMINI_LIVE_LOCAL_BARGE_IN_COOLDOWN_MS, 1400);
/** Shared cooldown across VAD / transcript / server interrupt cut paths. */
export const PLAYBACK_CUT_COOLDOWN_MS = parsePositiveInt(process.env.GEMINI_LIVE_PLAYBACK_CUT_COOLDOWN_MS, 750);
export const OPENING_LOCAL_BARGE_IN_MIN_AUDIO_MS = parsePositiveInt(process.env.GEMINI_LIVE_OPENING_LOCAL_BARGE_IN_MS, 350);
export const LOCAL_BARGE_IN_PREFIX_FRAMES = parsePositiveInt(process.env.GEMINI_LIVE_LOCAL_BARGE_IN_PREFIX_FRAMES, 15);
export const LOCAL_BARGE_IN_SPEECH_HANGOVER_MS = parsePositiveInt(process.env.GEMINI_LIVE_LOCAL_BARGE_IN_HANGOVER_MS, 550);
// Keep outbound ducking short so we don't clip the first assistant word.
export const LOCAL_BARGE_IN_PLAYBACK_DUCK_MS = parsePositiveInt(process.env.GEMINI_LIVE_LOCAL_BARGE_IN_PLAYBACK_DUCK_MS, 180);
export const POST_BARGE_IN_NUDGE_MS = parsePositiveInt(process.env.GEMINI_LIVE_POST_BARGE_IN_NUDGE_MS, 1800);
/** Window after any user barge-in where flush prefers a direct answer nudge. */
export const POST_INTERRUPT_ANSWER_WINDOW_MS = parsePositiveInt(
  process.env.GEMINI_LIVE_POST_INTERRUPT_ANSWER_WINDOW_MS,
  12_000,
);
/**
 * After barge-in empty recovery, ignore ambient_noise interrupts for this long
 * so the "continue speaking" turn is not immediately dropped (dry call).
 */
export const BARGE_IN_RECOVERY_PROTECT_MS = parsePositiveInt(
  process.env.GEMINI_LIVE_BARGE_IN_RECOVERY_PROTECT_MS,
  3_000,
);
/**
 * Hard budget for the customer-speech mute failsafe: if no plan/nudge clears
 * the mute, force a reply after this long so the call cannot die silently.
 *
 * This is a *ceiling*, not a wait — see customerSpeechMuteProbeMs(). Session
 * dumps showed false barge-ins (ambient noise, speakerphone echo) arming the
 * mute and then sitting on the full 3.5s before `customer_speech_mute_timeout`
 * fired the recovery, which is why dropped-audio turns measured ~3850ms to
 * first audio against ~1750ms for clean turns.
 *
 * Read LAZILY — module-level consts in this file are evaluated before Next
 * loads `.env.local` (server.ts statically imports the bridge graph), so an
 * eager const would silently ignore any override.
 */
export function customerSpeechMuteTimeoutMs(): number {
  return parsePositiveInt(process.env.GEMINI_LIVE_CUSTOMER_SPEECH_MUTE_TIMEOUT_MS, 3_500);
}
/**
 * How often the mute failsafe re-checks for evidence before its budget expires.
 *
 * A barge-in that produced no transcript AND whose caller-speech hangover has
 * already lapsed was noise, and waiting out the remaining budget is pure dead
 * air. 700ms sits just past LOCAL_BARGE_IN_SPEECH_HANGOVER_MS (550ms) so a real
 * speaker is still counted as active on the first probe.
 *
 * Read LAZILY for the same reason as customerSpeechMuteTimeoutMs().
 */
export function customerSpeechMuteProbeMs(): number {
  return parsePositiveInt(process.env.GEMINI_LIVE_CUSTOMER_SPEECH_MUTE_PROBE_MS, 700);
}
/**
 * Grace after a locally verified activity window closes for delayed Live ASR.
 *
 * The mute probe must not declare an interruption empty merely because the
 * acoustic hangover expired before Gemini delivered its transcript. This is a
 * bounded grace, not added response latency: a transcript/model response
 * cancels it immediately, while a genuine false trigger still recovers well
 * before the hard customer-speech mute budget.
 */
export function customerSpeechAsrGraceMs(): number {
  return parsePositiveInt(process.env.GEMINI_LIVE_CUSTOMER_SPEECH_ASR_GRACE_MS, 1_200);
}
export const INTERRUPT_QUESTION_RE =
  /[?？]|\b(kahan|kahaan|kaise|kyon|kyun|kya|kab|kis|कहां|कहाँ|क्यों|क्या|कैसे|कब|where|why|how|what|when|which)\b/i;
/** After semantic clarify/resolution/fallback, ignore barge-in so agent audio is not cut by caller tail or echo.
 * Keep short enough that "wait/stop" still works; control intents bypass this guard. */
export const AGENT_SEMANTIC_RESPONSE_BARGE_IN_COOLDOWN_MS = parsePositiveInt(
  process.env.GEMINI_LIVE_SEMANTIC_BARGE_IN_COOLDOWN_MS,
  700,
);
export const DECISION_RESOLUTION_DEDUPE_MS = parsePositiveInt(
  process.env.GEMINI_LIVE_DECISION_RESOLUTION_DEDUPE_MS,
  45_000,
);
// Brief guard after user speech to avoid stale/echo interrupts killing the next assistant turn.
export const POST_USER_TURN_BARGE_IN_GRACE_MS = parsePositiveInt(
  process.env.GEMINI_LIVE_POST_USER_TURN_BARGE_IN_GRACE_MS,
  600,
);
export const LOCAL_BARGE_IN_NOISE_MULTIPLIER = parsePositiveNumber(process.env.GEMINI_LIVE_LOCAL_BARGE_IN_NOISE_MULTIPLIER, 3.8);
/** Extra RMS/peak multiplier while agent audio is playing — fights speakerphone echo false barge-ins. */
/** Was 2.1 — too high made real barge-ins fail while the agent was talking. */
export const LOCAL_BARGE_IN_ECHO_RMS_MULTIPLIER = parsePositiveNumber(
  process.env.GEMINI_LIVE_LOCAL_BARGE_IN_ECHO_RMS_MULTIPLIER,
  1.55,
);
export const LOCAL_BARGE_IN_INITIAL_NOISE_RMS = parsePositiveInt(process.env.GEMINI_LIVE_LOCAL_BARGE_IN_INITIAL_NOISE_RMS, 350);
/**
 * Local VAD energy-gate relaxation while the agent is not audible.
 *
 * This is deliberately based on acoustic state, not campaign text or a list
 * of expected replies. A customer can answer quietly after any agent turn,
 * even when a higher-level "awaiting customer" flag was not re-armed. The
 * strict barge-in gate still applies while agent audio is active, where echo
 * rejection matters.
 *
 * Production recordings contained real replies around -32 dBFS while the old
 * 0.6 multiplier imposed an effective floor around -27 dBFS. 0.35 covers that
 * range without weakening the active-playback barge-in gate.
 */
export const AWAITING_CUSTOMER_VAD_SENSITIVITY = parsePositiveNumber(
  process.env.GEMINI_LIVE_AWAITING_CUSTOMER_VAD_SENSITIVITY,
  0.35,
);

/**
 * Hard cap on how long the model-audio drop guard may stay armed.
 *
 * The guard normally releases on Gemini's turnComplete, but we killed that turn
 * from the client and Gemini may never send one. Measured across 300 recorded
 * calls the common case is fine — p50 18ms, p90 183ms, p95 1960ms — but the
 * tail is not: p99 9213ms, max 17353ms, 21 of 483 windows over 3s, 18 never
 * released at all. For that whole window agent audio is discarded and barge-in
 * is refused — dead air the caller cannot interrupt.
 *
 * 3000ms sits above p95, so healthy turns never reach it; it only ends windows
 * the normal release already failed to close.
 */
export function modelAudioDropGuardMaxMs(): number {
  return parsePositiveInt(process.env.GEMINI_LIVE_MODEL_AUDIO_DROP_GUARD_MAX_MS, 3_000);
}

/**
 * Safety net for a completed, locally verified caller activity window that
 * produces neither accepted transcript handling nor model output. The timer
 * runs off the critical path and is cancelled as soon as a response begins.
 */
export function userActivityRecoveryTimeoutMs(): number {
  return parsePositiveInt(
    process.env.GEMINI_LIVE_USER_ACTIVITY_RECOVERY_TIMEOUT_MS,
    3_500,
  );
}

/** Keep acoustic evidence alive long enough for delayed Live ASR partials. */
export function userActivityEvidenceWindowMs(): number {
  return parsePositiveInt(process.env.GEMINI_LIVE_USER_ACTIVITY_EVIDENCE_MS, 5_000);
}

/** Silence after agent playback before checking whether the caller is present. */
export function callerIdlePromptMs(): number {
  return parsePositiveInt(process.env.GEMINI_LIVE_CALLER_IDLE_PROMPT_MS, 5_000);
}
/**
 * Consecutive local-VAD speech frames (~20ms) before opening a Gemini activity
 * window. Higher = harder for ambient TV / room chatter to start a turn.
 */
export const ACTIVITY_START_MIN_SPEECH_FRAMES = parsePositiveInt(
  process.env.GEMINI_LIVE_ACTIVITY_START_FRAMES,
  4,
);
const EFFECTIVE_VAD_START_SENSITIVITY = LOCAL_BARGE_IN_VAD_ENABLED ? "START_SENSITIVITY_LOW" : VAD_START_SENSITIVITY;

function geminiApiKey(): string {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is not set");
  return key;
}

function geminiWsUrl(): string {
  return `${GEMINI_LIVE_URL}?key=${encodeURIComponent(geminiApiKey())}`;
}

/**
 * Ceiling is 2, not 1: gemini-3.1-flash-live-preview accepts temperatures above
 * 1.0 (probed directly — setup with temperature 1.4 returns setupComplete, and
 * an invalid value would have closed the socket 1007 the way an unknown field
 * does). The old Math.min(1, …) silently rewrote anything higher to 1.0, so the
 * top of the model's prosodic range was unreachable from `.env.local`.
 *
 * Default stays 0.55. Above ~1.0 expect noticeably more lexical and prosodic
 * variance — and correspondingly more improvisation away from the script.
 */
function parseGeminiTemperature(value: string | undefined): number {
  if (!value) return 0.55;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.55;
  return Math.min(2, Math.max(0, parsed));
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseRatio(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return fallback;
  return parsed;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// NOTE: Gemini Live only accepts HIGH / LOW (and UNSPECIFIED) for speech
// sensitivity — there is NO *_MEDIUM value. Sending MEDIUM closes the socket
// with code 1007 ("Invalid value") and breaks the ENTIRE session (prewarm dies
// and every call falls back to a slower no-VAD setup). So we reject anything
// that isn't HIGH/LOW here rather than pass it through.
function parseStartVadSensitivity(
  value: string | undefined,
  fallback: "START_SENSITIVITY_HIGH" | "START_SENSITIVITY_LOW",
): "START_SENSITIVITY_HIGH" | "START_SENSITIVITY_LOW" {
  if (!value) return fallback;
  const normalized = value.trim().toUpperCase();
  if (normalized === "START_SENSITIVITY_HIGH" || normalized === "START_SENSITIVITY_LOW") {
    return normalized;
  }
  console.warn(
    `[voice/gemini-live] Invalid GEMINI_LIVE_VAD_START="${value}" (only HIGH/LOW are supported by Gemini), using fallback ${fallback}`,
  );
  return fallback;
}

function parseEndVadSensitivity(
  value: string | undefined,
  fallback: "END_SENSITIVITY_HIGH" | "END_SENSITIVITY_LOW",
): "END_SENSITIVITY_HIGH" | "END_SENSITIVITY_LOW" {
  if (!value) return fallback;
  const normalized = value.trim().toUpperCase();
  if (normalized === "END_SENSITIVITY_HIGH" || normalized === "END_SENSITIVITY_LOW") {
    return normalized;
  }
  console.warn(
    `[voice/gemini-live] Invalid GEMINI_LIVE_VAD_END="${value}" (only HIGH/LOW are supported by Gemini), using fallback ${fallback}`,
  );
  return fallback;
}

export function openGeminiSocket(): WebSocket {
  const key = geminiApiKey();
  return new WebSocket(geminiWsUrl(), {
    perMessageDeflate: false,
    headers: {
      "x-goog-api-key": key,
    },
  });
}

export function resolveGeminiVoice(rawVoice: string | undefined): string {
  const fallback = GEMINI_LIVE_VOICE;
  const candidate = rawVoice?.trim();
  if (!candidate) return fallback;

  const byName = getGeminiVoice(candidate);
  if (byName) return byName.name;

  const byDisplayName = GEMINI_VOICES.find(
    (voice) => voice.displayName.toLowerCase() === candidate.toLowerCase(),
  );
  if (byDisplayName) return byDisplayName.name;

  console.warn(
    `[voice/gemini-live] Unknown Gemini voice "${candidate}", falling back to ${fallback}`,
  );
  return fallback;
}

/**
 * Prepend the campaign's delivery-language directive to the authored script.
 *
 * This is the ONLY place a language is asserted for a call. It is written once
 * into the setup systemInstruction and never re-sent, re-derived, or corrected
 * mid-call — the runtime language checker (detection, drift guards, switching,
 * preference gate, hard lock) was removed.
 *
 * The policy itself lives in voice-language-policy.ts, which decides between a
 * monolingual lock and the trilingual {regional + Hindi + English} shape based
 * on the campaign's selected language. Keep it prompt-only — see the design
 * constraint documented at the top of that module.
 */
function withCampaignLanguageDirective(systemPrompt: string, language: string | undefined): string {
  const header = [
    buildVoiceLanguageDirective(language),
    "",
    "---",
    `Conversation script (authoritative workflow and approved spoken copy):`,
  ].join("\n");
  return `${header}\n${systemPrompt}`;
}

/**
 * Exact systemInstruction text sent to Gemini Live on setup.
 * = campaign language directive + campaign systemPrompt (+ optional semantic-trap block).
 */
export function buildGeminiLiveSystemInstruction(callConfig: CallConfig): string {
  return withCampaignLanguageDirective(callConfig.systemPrompt, callConfig.language);
}

/** Log the setup system instruction. Full text when VOICE_LOG_SYSTEM_PROMPT=1. */
export function logGeminiLiveSystemInstruction(
  systemInstruction: string,
  context: {
    language?: string;
    campaignId?: string;
    callId?: string;
    source: "setup" | "prewarm" | "prewarmed_claim";
    minimalSetup?: boolean;
  },
): void {
  const previewLimit = 500;
  const preview =
    systemInstruction.length > previewLimit
      ? `${systemInstruction.slice(0, previewLimit)}…`
      : systemInstruction;
  console.log(
    `[voice/gemini-live] SYSTEM INSTRUCTION (${context.source}` +
      `${context.minimalSetup ? ", minimal" : ""}` +
      ` lang=${context.language || "Hinglish"}` +
      `${context.campaignId ? ` campaign=${context.campaignId}` : ""}` +
      `${context.callId ? ` call=${context.callId}` : ""}` +
      ` chars=${systemInstruction.length})`,
  );
  console.log(`[voice/gemini-live] SYSTEM INSTRUCTION preview:\n${preview}`);
  if (process.env.VOICE_LOG_SYSTEM_PROMPT === "1") {
    console.log(`[voice/gemini-live] SYSTEM INSTRUCTION full:\n${systemInstruction}`);
  }
}

export function geminiSetupPayload(
  callConfig: CallConfig,
  options?: { minimalSetup?: boolean; voiceOverride?: string },
): Record<string, unknown> {
  const geminiVoice = resolveGeminiVoice(options?.voiceOverride || callConfig.voice || GEMINI_LIVE_VOICE);
  const systemInstructionText = buildGeminiLiveSystemInstruction(callConfig);
  const realtimeInputConfig: Record<string, unknown> = {
    activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
    turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY",
  };

  if (!options?.minimalSetup && CLIENT_CONTROLLED_ACTIVITY_ENABLED) {
    // Local VAD owns turn boundaries — Gemini must not auto-start turns from noise.
    realtimeInputConfig.automaticActivityDetection = {
      disabled: true,
    };
  } else if (CUSTOM_VAD_ENABLED && !options?.minimalSetup) {
    realtimeInputConfig.automaticActivityDetection = {
      disabled: false,
      startOfSpeechSensitivity: EFFECTIVE_VAD_START_SENSITIVITY,
      endOfSpeechSensitivity: VAD_END_SENSITIVITY,
      prefixPaddingMs: VAD_PREFIX_PADDING_MS,
      silenceDurationMs: VAD_SILENCE_MS,
    };
  }

  return {
    setup: {
      model: `models/${GEMINI_LIVE_MODEL}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        temperature: GEMINI_LIVE_TEMPERATURE,
        // Disable the pre-response thinking pass — it adds ~1-2s to first audio.
        thinkingConfig: { thinkingBudget: GEMINI_LIVE_THINKING_BUDGET },
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: geminiVoice,
            },
          },
        },
      },
      systemInstruction: {
        parts: [
          {
            text: systemInstructionText,
          },
        ],
      },
      realtimeInputConfig,
      ...((STORE_REALTIME_TRANSCRIPT || DETECT_AUTOMATED_SCREENING) && !options?.minimalSetup
        ? { inputAudioTranscription: {} }
        : {}),
      ...(STORE_REALTIME_TRANSCRIPT && !options?.minimalSetup ? { outputAudioTranscription: {} } : {}),
      ...(!options?.minimalSetup
        ? {
            contextWindowCompression: {
              slidingWindow: {},
            },
          }
        : {}),
      ...(!options?.minimalSetup && hasGupshupWhatsAppTemplateConfig(callConfig.userId)
        ? {
            tools: [
              {
                functionDeclarations: [
                  {
                    name: "send_link",
                    description:
                      "Send a message to the customer on WhatsApp right now, during the call — including a trackable link when the campaign has one configured. Call this immediately when the customer asks to receive details/link/brochure/message on WhatsApp, or agrees to receive it. Do not call it proactively without the customer asking. Never promise WhatsApp delivery without calling this tool.",
                    behavior: "NON_BLOCKING",
                    parameters: { type: "OBJECT", properties: {}, required: [] },
                  },
                ],
              },
            ],
          }
        : {}),
    },
  };
}
