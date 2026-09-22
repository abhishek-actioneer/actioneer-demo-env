import type { WebSocket } from "ws";
import type { VoiceSessionDumpLogger } from "./voice-debug-dump";
import { sendJson } from "./plivo-gemini-live-ws-utils";
import { RAW_MODE_ALLOWED_INSTRUCTION_REASONS, rawModeEnabled } from "./plivo-gemini-live-config";

/**
 * Everything `createInstructionQueue` needs from the owning stream session.
 * Mirrors the get/set accessor-pair pattern used elsewhere in the
 * plivo-gemini-live-* controllers — closures over the stream's mutable
 * state, so reads always reflect the latest values.
 */
export interface InstructionQueueDeps {
  isClosed(): boolean;
  getGeminiWs(): WebSocket | undefined;
  getSetupComplete(): boolean;
  isDropModelAudioActive(): boolean;
  getAwaitingCustomerResponse(): boolean;
  agentAudioLikelyActive(): boolean;
  /** Lift barge-in mute when we intentionally ask the model to speak. */
  clearCustomerSpeechMute?(reason: string): void;
  sessionDump: VoiceSessionDumpLogger;
}

export interface InstructionQueue {
  sendClientInstruction(
    text: string,
    reason?: string,
    options?: { deferUntilIdle?: boolean },
  ): void;
  flushPendingRealtimeInstructions(reason: string): void;
  getLastInstruction(): string;
  getLastInstructionReason(): string;
  /** Clear WHY(...) ownership after the turn that consumed this instruction completes or is dropped. */
  clearLastInstructionOwnership(reason?: string): void;
  /** True when a drop must keep the already-queued follow-up instruction's WHY(...). */
  shouldPreserveOwnershipOnDrop(droppedReason: string): boolean;
}

/**
 * Owns the "send a realtime text instruction to Gemini" primitive plus its
 * defer-until-idle queue: instructions requested while the model is mid-turn
 * (or the caller is being awaited) are buffered and flushed once the session
 * goes idle, instead of racing the in-flight model turn. Extracted verbatim
 * from plivo-gemini-live-stream.ts.
 */
export function createInstructionQueue(deps: InstructionQueueDeps): InstructionQueue {
  let lastInstruction = "";
  let lastInstructionReason = "none";
  let pendingRealtimeInstructions: Array<{ text: string; reason: string }> = [];

  function sendRealtimeInstructionNow(text: string, reason: string): void {
    lastInstruction = text;
    lastInstructionReason = reason;
    // Any intentional speak instruction ends the post-barge-in mute window.
    deps.clearCustomerSpeechMute?.(`instruction:${reason}`);
    console.log(`[voice/gemini-live] ▶ INSTRUCTION → "${text.slice(0, 120).replace(/\n/g, " ")}${text.length > 120 ? "…" : ""}"`);
    deps.sessionDump.event("gemini.realtime_instruction", {
      text,
      reason,
    });
    sendJson(deps.getGeminiWs(), {
      realtimeInput: {
        text,
      },
    });
  }

  function flushPendingRealtimeInstructions(reason: string): void {
    if (
      deps.isClosed() ||
      pendingRealtimeInstructions.length === 0 ||
      !deps.getSetupComplete() ||
      deps.isDropModelAudioActive() ||
      deps.getAwaitingCustomerResponse()
    ) {
      return;
    }
    // After a language_switch / control interrupt drop, assistantTurnStartMs can
    // still be set even though Plivo was cleared — agentAudioLikelyActive() then
    // blocks forever and the deferred language_update never sends (customer must
    // speak again). Force-flush those post-interrupt queues.
    const forceAfterInterrupt = reason.startsWith("turn_dropped_after_interrupt");
    if (!forceAfterInterrupt && deps.agentAudioLikelyActive()) {
      return;
    }

    const queued = pendingRealtimeInstructions;
    pendingRealtimeInstructions = [];
    const text = queued.length === 1
      ? queued[0].text
      : queued.map((item, index) => `Notice ${index + 1}: ${item.text}`).join("\n");
    sendRealtimeInstructionNow(text, `queued:${reason}:${queued.map((item) => item.reason).join(",")}`);
  }

  function sendClientInstruction(
    text: string,
    reason = "generic_instruction",
    options?: { deferUntilIdle?: boolean },
  ): void {
    // Raw-mode harness: withhold every steering instruction except the opener
    // and barge-in recovery, and record what was withheld so the resulting call
    // can be read as "Gemini unaided". See rawModeEnabled().
    if (rawModeEnabled() && !RAW_MODE_ALLOWED_INSTRUCTION_REASONS.has(reason)) {
      console.log(`[voice/gemini-live] ⨯ RAW MODE blocked instruction reason=${reason}`);
      deps.sessionDump.event("gemini.raw_mode_instruction_blocked", { text, reason });
      return;
    }
    if (
      options?.deferUntilIdle &&
      (!deps.getSetupComplete() ||
        deps.isDropModelAudioActive() ||
        deps.getAwaitingCustomerResponse() ||
        deps.agentAudioLikelyActive())
    ) {
      pendingRealtimeInstructions.push({ text, reason });
      console.log(`[voice/gemini-live] queued instruction until idle reason=${reason}`);
      deps.sessionDump.event("gemini.realtime_instruction_queued", { text, reason });
      return;
    }
    sendRealtimeInstructionNow(text, reason);
  }

  function clearLastInstructionOwnership(reason = "consumed"): void {
    if (lastInstructionReason === "none" && !lastInstruction) return;
    deps.sessionDump.event("gemini.instruction_ownership_cleared", {
      previousReason: lastInstructionReason,
      reason,
    });
    lastInstruction = "";
    lastInstructionReason = "none";
  }

  /**
   * Drop handlers must not wipe a follow-up instruction that was already queued
   * for the interrupt (semantic confirm, control slow-down, language switch).
   */
  function shouldPreserveOwnershipOnDrop(droppedReason: string): boolean {
    return (
      droppedReason === "semantic_trap" ||
      droppedReason === "control_intent" ||
      droppedReason === "language_switch" ||
      droppedReason === "assistant_language_drift_live" ||
      droppedReason === "barge_in_empty_recovery" ||
      lastInstructionReason === "barge_in_empty_recovery"
    );
  }

  return {
    sendClientInstruction,
    flushPendingRealtimeInstructions,
    getLastInstruction: () => lastInstruction,
    getLastInstructionReason: () => lastInstructionReason,
    clearLastInstructionOwnership,
    shouldPreserveOwnershipOnDrop,
  };
}
