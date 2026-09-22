import type { CallConfig } from "./voice-call-state";

export interface OpeningControllerDeps {
  isClosed: () => boolean;
  getCallConfig: () => CallConfig | undefined;
  setAwaitingCustomerResponse: (value: boolean) => void;
  sendClientInstruction: (text: string, reason: string) => void;
  emitEvent: (event: string, payload?: Record<string, unknown>) => void;
}

export interface OpeningController {
  isOpeningTurnComplete(): boolean;
  /** Raw state setter — used by the barge-in controller when audio is cleared mid-opening. */
  setOpeningTurnComplete(value: boolean): void;
  isCallerAudioEnabled(): boolean;
  isFirstResponseRequested(): boolean;
  getOpeningAudioStartedAtMs(): number | undefined;
  enableCallerAudioAfterOpening(): void;
  armOpeningBargeInWindow(): void;
  markOpeningTurnComplete(): void;
  requestFirstResponse(): void;
  /** Clears any pending opening timers — call from the session teardown path. */
  clearTimers(): void;
}

/**
 * Owns the call-opening lifecycle: requesting the first agent response,
 * arming the protective barge-in window around the opening line, and
 * enabling caller audio once the opening has played out (or been
 * interrupted).
 *
 * The language-preference opener gate was removed along with the runtime
 * language checker. The campaign opening line is spoken verbatim and the call
 * proceeds straight into the workflow — there is no "which language?" exchange,
 * no free-wheel muting while waiting for a named language, and no forced
 * spoken re-ask.
 */
export function createOpeningController(deps: OpeningControllerDeps): OpeningController {
  let openingTurnComplete = false;
  let callerAudioEnabled = false;
  let openingBargeInArmed = false;
  let openingAudioStartedAtMs: number | undefined;
  let firstResponseRequested = false;

  function enableCallerAudioAfterOpening(): void {
    if (callerAudioEnabled || deps.isClosed()) return;
    callerAudioEnabled = true;
    console.log("[voice/gemini-live] caller audio enabled (always-on ASR)");
    deps.emitEvent("plivo.caller_audio_enabled", { mode: "always_on" });
  }

  // Always-on ASR: unmute as soon as opening audio starts.
  // Echo of the opener is filtered in the transcript path; muting was losing answers.
  function armOpeningBargeInWindow(): void {
    if (openingBargeInArmed || deps.isClosed()) return;
    openingBargeInArmed = true;
    openingAudioStartedAtMs = Date.now();
    enableCallerAudioAfterOpening();
    console.log("[voice/gemini-live] opening ASR live — caller can speak through the greeting");
    deps.emitEvent("gemini.opening_asr_always_on");
  }

  function markOpeningTurnComplete(): void {
    if (openingTurnComplete || deps.isClosed()) return;
    openingTurnComplete = true;
    const callConfig = deps.getCallConfig();
    // Mic should already be live; keep it on.
    enableCallerAudioAfterOpening();
    if (callConfig?.firstMessage.trim()) {
      deps.setAwaitingCustomerResponse(true);
    }
  }

  function requestFirstResponse(): void {
    const callConfig = deps.getCallConfig();
    if (firstResponseRequested || deps.isClosed() || !callConfig) return;
    firstResponseRequested = true;
    // Unmute before the opener speaks — ASR must never wait for the greeting to finish.
    enableCallerAudioAfterOpening();
    const opening = callConfig.firstMessage.trim();
    if (opening) {
      console.log("[voice/gemini-live] sending campaign opening line");
      deps.emitEvent("gemini.opening_requested", { firstMessage: opening });
      deps.sendClientInstruction(`Say exactly this, nothing more, then stop:\n${opening}`, "opening_line");
    } else {
      console.log("[voice/gemini-live] no firstMessage — prompting agent to open call");
      deps.emitEvent("gemini.opening_requested", { firstMessage: "" });
      deps.sendClientInstruction("Call connected. Greet the customer and introduce yourself per your instructions. Speak first.", "opening_fallback");
    }
  }

  return {
    isOpeningTurnComplete: () => openingTurnComplete,
    setOpeningTurnComplete: (value) => { openingTurnComplete = value; },
    isCallerAudioEnabled: () => callerAudioEnabled,
    isFirstResponseRequested: () => firstResponseRequested,
    getOpeningAudioStartedAtMs: () => openingAudioStartedAtMs,
    enableCallerAudioAfterOpening,
    armOpeningBargeInWindow,
    markOpeningTurnComplete,
    requestFirstResponse,
    clearTimers(): void {
      // No deferred mic timers in always-on ASR mode.
    },
  };
}
