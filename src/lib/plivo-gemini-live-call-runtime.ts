import type { CallConfig } from "./voice-call-state";
import type { VoiceSessionDumpLogger } from "./voice-debug-dump";
import { extractLastSentence } from "./plivo-gemini-live-text-utils";
import {
  isLikelyAutomatedScreeningMessage,
  type RuntimeControlIntent,
} from "./plivo-gemini-live-transcript-guards";
import {
  buildControlIntentInstructionText,
  buildPauseResumeInstructionText,
  shouldSkipControlIntentAsDuplicate,
} from "./plivo-gemini-live-user-turn";
import type { ModelAudioDropReason } from "./plivo-gemini-live-gemini-handler";

/**
 * Everything `createCallControlRuntime` needs from the owning stream session.
 * Mirrors the get/set accessor-pair pattern used by the sibling
 * plivo-gemini-live-* controllers — actions/state that stay stream-owned
 * (instruction dispatch, model-audio dropping, transcript buffer clearing)
 * are passed through as closures instead of being reimplemented here.
 */
export interface CallControlRuntimeDeps {
  sessionDump: VoiceSessionDumpLogger;
  getCallConfig(): CallConfig | undefined;
  sendClientInstruction(
    text: string,
    reason?: string,
    options?: { deferUntilIdle?: boolean },
  ): void;
  setDropModelAudio(reason: ModelAudioDropReason): void;
  clearPlivoAudio(reason?: string): void;
  clearOutputTranscriptBuffer(): void;
}

export interface CallControlRuntime {
  getCustomerPauseActive(): boolean;
  setCustomerPauseActive(value: boolean): void;
  getCustomerPauseAckPending(): boolean;
  setCustomerPauseAckPending(value: boolean): void;

  getScreeningReplyQueued(): boolean;
  setScreeningReplyQueued(value: boolean): void;
  getAutomatedScreeningHandled(): boolean;

  sendControlIntentInstruction(
    intent: RuntimeControlIntent,
    sourceText: string,
    source: "live" | "flush",
  ): boolean;
  noteControlIntentSent(intent: RuntimeControlIntent): void;
  activateCustomerPause(): void;
  sendResumeFromPauseInstruction(source: "live" | "flush", userText: string): void;
  sendAutomatedScreeningReply(): void;
  handleAutomatedScreeningInput(inputText: string): void;
}

/**
 * Owns the pause/resume + control-intent instruction dispatch and the
 * automated call-screening detection/reply.
 *
 * This was formerly plivo-gemini-live-language-runtime.ts, which bundled these
 * two concerns together with active-language tracking, language switching, the
 * hard lock, and the language-lock instruction. The runtime language checker
 * has been removed — the campaign's configured language reaches Gemini once via
 * the setup systemInstruction and is never re-asserted mid-call — so only the
 * genuinely language-independent behaviour survives here.
 */
export function createCallControlRuntime(deps: CallControlRuntimeDeps): CallControlRuntime {
  let customerPauseActive = false;
  let customerPauseAckPending = false;
  let customerPauseResumeInstructionSentAtMs = 0;

  let lastControlIntentSentAtMs = 0;
  let lastControlIntentKey = "";

  let screeningReplyQueued = false;
  let automatedScreeningHandled = false;

  function noteControlIntentSent(intent: RuntimeControlIntent): void {
    lastControlIntentKey = `${intent}:`;
    lastControlIntentSentAtMs = Date.now();
  }

  function activateCustomerPause(): void {
    customerPauseActive = true;
    customerPauseAckPending = true;
  }

  function sendControlIntentInstruction(
    intent: RuntimeControlIntent,
    sourceText: string,
    source: "live" | "flush",
  ): boolean {
    if ((intent === "wait" || intent === "stop") && customerPauseActive && !customerPauseAckPending) {
      deps.sessionDump.event("gemini.control_intent_ignored_pause_already_active", {
        intent,
        source,
      });
      return false;
    }

    const now = Date.now();
    const dedupe = shouldSkipControlIntentAsDuplicate({
      intent,
      sourceText: extractLastSentence(sourceText),
      lastControlIntentKey,
      lastControlIntentSentAtMs,
      nowMs: now,
    });
    if (dedupe.skip) return false;

    deps.sendClientInstruction(
      buildControlIntentInstructionText(intent),
      `control_intent_${intent}`,
    );
    if (intent === "wait" || intent === "stop") {
      customerPauseActive = true;
      customerPauseAckPending = true;
    }
    lastControlIntentKey = dedupe.dedupeKey;
    lastControlIntentSentAtMs = now;
    deps.sessionDump.event("gemini.control_intent_instruction", {
      intent,
      source,
      tail: dedupe.tail,
    });
    return true;
  }

  function sendResumeFromPauseInstruction(source: "live" | "flush", userText: string): void {
    const now = Date.now();
    if (now - customerPauseResumeInstructionSentAtMs < 1200) return;
    customerPauseResumeInstructionSentAtMs = now;
    deps.sendClientInstruction(buildPauseResumeInstructionText(), "pause_resume");
    deps.sessionDump.event("gemini.customer_pause_resume_instruction", {
      source,
      userText,
    });
  }

  function sendAutomatedScreeningReply(): void {
    const callConfig = deps.getCallConfig();
    if (!callConfig) return;
    deps.sendClientInstruction([
      "The last caller audio was an automated call-screening or voicemail system, not the customer.",
      "Reply with exactly one short sentence that states your name/company and a broad reason for the call.",
      "Do not mention product details, pricing, eligibility, offers, or campaign logic.",
      "Do not ask a question. After this one sentence, wait silently for a real customer.",
    ].join(" "));
  }

  function handleAutomatedScreeningInput(inputText: string): void {
    if (automatedScreeningHandled || !isLikelyAutomatedScreeningMessage(inputText)) return;
    automatedScreeningHandled = true;
    deps.setDropModelAudio("screening");
    screeningReplyQueued = true;
    deps.clearOutputTranscriptBuffer();
    deps.clearPlivoAudio("automated_screening");
    console.log(`[voice/gemini-live] automated call screening detected: "${inputText.slice(0, 160)}"`);
    deps.sessionDump.event("screening.detected", {
      inputText,
    });
  }

  return {
    noteControlIntentSent,
    activateCustomerPause,

    getCustomerPauseActive: () => customerPauseActive,
    setCustomerPauseActive: (value) => { customerPauseActive = value; },
    getCustomerPauseAckPending: () => customerPauseAckPending,
    setCustomerPauseAckPending: (value) => { customerPauseAckPending = value; },

    getScreeningReplyQueued: () => screeningReplyQueued,
    setScreeningReplyQueued: (value) => { screeningReplyQueued = value; },
    getAutomatedScreeningHandled: () => automatedScreeningHandled,

    sendControlIntentInstruction,
    sendResumeFromPauseInstruction,
    sendAutomatedScreeningReply,
    handleAutomatedScreeningInput,
  };
}
