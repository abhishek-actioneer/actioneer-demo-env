import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCustomerTurnPlan, planCustomerTurn } from "@/lib/plivo-gemini-live-turn-planner";
import { RAW_MODE_ALLOWED_INSTRUCTION_REASONS, rawModeEnabled } from "@/lib/plivo-gemini-live-config";

// Raw mode is a measurement harness: it silences the scripted steering layered
// on top of Gemini Live so a call shows what the model does unaided. It must
// still clear the playback gates, because an early return on the suppressed
// path is what produced the 15s dead-air bug.

afterEach(() => {
  delete process.env.GEMINI_LIVE_RAW_MODE;
});

function applierSpies() {
  return {
    sessionDump: { event: vi.fn() },
    tryClearAudiblePlayback: vi.fn(() => true),
    interruptCurrentModelAudio: vi.fn(),
    clearModelAudioDropGuard: vi.fn(),
    clearCustomerSpeechMute: vi.fn(),
    activateCustomerPause: vi.fn(),
    noteControlIntentSent: vi.fn(),
    markDecisionResolutionApplied: vi.fn(),
    sendClientInstruction: vi.fn(),
    protectAckUntil: vi.fn(),
    onHostWhatsAppSend: vi.fn(),
  };
}

const NO_DEDUPE = { fingerprint: "", atMs: 0 };

describe("rawModeEnabled", () => {
  it("is off unless explicitly set to 1", () => {
    expect(rawModeEnabled()).toBe(false);
    process.env.GEMINI_LIVE_RAW_MODE = "0";
    expect(rawModeEnabled()).toBe(false);
    process.env.GEMINI_LIVE_RAW_MODE = "1";
    expect(rawModeEnabled()).toBe(true);
  });

  it("keeps the opener and barge-in recovery reachable", () => {
    // Without these there is no call left to measure.
    expect(RAW_MODE_ALLOWED_INSTRUCTION_REASONS.has("opening_line")).toBe(true);
    expect(RAW_MODE_ALLOWED_INSTRUCTION_REASONS.has("opening_fallback")).toBe(true);
    expect(RAW_MODE_ALLOWED_INSTRUCTION_REASONS.has("barge_in_empty_recovery")).toBe(true);
    expect(RAW_MODE_ALLOWED_INSTRUCTION_REASONS.has("post_interrupt_answer")).toBe(true);
  });

  it("does not exempt the steering reasons under test", () => {
    for (const reason of ["semantic_resolution", "direct_customer_answer", "pitch_continuation"]) {
      expect(RAW_MODE_ALLOWED_INSTRUCTION_REASONS.has(reason)).toBe(false);
    }
  });
});

describe("applyCustomerTurnPlan under raw mode", () => {
  const plan = planCustomerTurn({
    userText: "Ma'am, can you please speak a bit slowly?",
    lastAssistantText: "नमस्ते, क्या अभी बात हो पाएगी?",
    source: "live",
    campaignLanguage: "Hindi",
  });

  it("sends no instruction and does not cut playback", () => {
    process.env.GEMINI_LIVE_RAW_MODE = "1";
    const deps = applierSpies();
    applyCustomerTurnPlan(deps, plan, "speak slowly", NO_DEDUPE, "live");

    expect(deps.sendClientInstruction).not.toHaveBeenCalled();
    expect(deps.interruptCurrentModelAudio).not.toHaveBeenCalled();
  });

  it("still clears the gates, so the turn cannot go silent", () => {
    process.env.GEMINI_LIVE_RAW_MODE = "1";
    const deps = applierSpies();
    applyCustomerTurnPlan(deps, plan, "speak slowly", NO_DEDUPE, "live");

    expect(deps.clearModelAudioDropGuard).toHaveBeenCalled();
    expect(deps.clearCustomerSpeechMute).toHaveBeenCalled();
  });

  it("records what it withheld", () => {
    process.env.GEMINI_LIVE_RAW_MODE = "1";
    const deps = applierSpies();
    applyCustomerTurnPlan(deps, plan, "speak slowly", NO_DEDUPE, "live");

    const names = deps.sessionDump.event.mock.calls.map((c) => c[0]);
    expect(names).toContain("gemini.raw_mode_turn_plan_suppressed");
  });

  it("suppresses the flush path too, not just live", () => {
    process.env.GEMINI_LIVE_RAW_MODE = "1";
    const deps = applierSpies();
    applyCustomerTurnPlan(deps, plan, "speak slowly", NO_DEDUPE, "flush");

    expect(deps.sendClientInstruction).not.toHaveBeenCalled();
    expect(deps.interruptCurrentModelAudio).not.toHaveBeenCalled();
  });

  it("leaves normal behaviour untouched when raw mode is off", () => {
    const deps = applierSpies();
    applyCustomerTurnPlan(deps, plan, "speak slowly", NO_DEDUPE, "live");

    expect(deps.sendClientInstruction).toHaveBeenCalled();
    expect(deps.interruptCurrentModelAudio).toHaveBeenCalled();
  });
});
