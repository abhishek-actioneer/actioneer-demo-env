import { describe, expect, it } from "vitest";
import { resolveCustomerSpeechMuteAction } from "@/lib/plivo-gemini-live-stream-utils";
import {
  customerSpeechAsrGraceMs,
  modelAudioDropGuardMaxMs,
} from "@/lib/plivo-gemini-live-config";

// The customer-speech mute is normally cleared by a turn plan or nudge. This
// failsafe only runs when that never happened. It used to be one blind
// setTimeout for the whole budget, so a false barge-in (ambient noise,
// speakerphone echo) muted the agent for the full 3.5s before recovery began —
// session dumps measured those turns at ~3850ms to first audio versus ~1750ms
// for clean turns.

const BUDGET = 3_500;

describe("resolveCustomerSpeechMuteAction", () => {
  it("recovers immediately when nothing was said and the caller is silent", () => {
    // The measured failure: noise armed the mute, no transcript ever landed.
    expect(
      resolveCustomerSpeechMuteAction({
        pendingTranscript: "",
        callerSpeechActive: false,
        elapsedMs: 700,
        budgetMs: BUDGET,
      }),
    ).toBe("recover");
  });

  it("keeps waiting while the caller is still speaking", () => {
    // A real speaker must never be cut off early — that is what the long
    // timeout originally existed to protect.
    expect(
      resolveCustomerSpeechMuteAction({
        pendingTranscript: "",
        callerSpeechActive: true,
        elapsedMs: 700,
        budgetMs: BUDGET,
      }),
    ).toBe("wait");
  });

  it("keeps waiting once anything has been transcribed", () => {
    expect(
      resolveCustomerSpeechMuteAction({
        pendingTranscript: "haan",
        callerSpeechActive: false,
        elapsedMs: 700,
        budgetMs: BUDGET,
      }),
    ).toBe("wait");
  });

  it("waits for delayed ASR after a verified activity window closes", () => {
    expect(
      resolveCustomerSpeechMuteAction({
        pendingTranscript: "",
        callerSpeechActive: false,
        elapsedMs: 700,
        budgetMs: BUDGET,
        awaitingVerifiedActivityTranscript: true,
      }),
    ).toBe("wait");
  });

  it("does not let ASR grace exceed the hard mute budget", () => {
    expect(
      resolveCustomerSpeechMuteAction({
        pendingTranscript: "",
        callerSpeechActive: false,
        elapsedMs: BUDGET,
        budgetMs: BUDGET,
        awaitingVerifiedActivityTranscript: true,
      }),
    ).toBe("recover");
  });

  it("treats whitespace-only transcripts as nothing said", () => {
    expect(
      resolveCustomerSpeechMuteAction({
        pendingTranscript: "   ",
        callerSpeechActive: false,
        elapsedMs: 700,
        budgetMs: BUDGET,
      }),
    ).toBe("recover");
  });

  it("answers the pending transcript when the budget expires", () => {
    // Unchanged legacy behaviour at the ceiling.
    expect(
      resolveCustomerSpeechMuteAction({
        pendingTranscript: "haan bolo",
        callerSpeechActive: true,
        elapsedMs: BUDGET,
        budgetMs: BUDGET,
      }),
    ).toBe("answer");
  });

  it("recovers at the budget when still nothing was transcribed", () => {
    expect(
      resolveCustomerSpeechMuteAction({
        pendingTranscript: "",
        callerSpeechActive: true,
        elapsedMs: BUDGET,
        budgetMs: BUDGET,
      }),
    ).toBe("recover");
  });

  it("never recovers early while the caller holds the floor without transcribing", () => {
    // Guards the regression where a quiet/slow speaker gets a "continue"
    // nudge fired over them mid-utterance.
    for (let elapsedMs = 0; elapsedMs < BUDGET; elapsedMs += 100) {
      expect(
        resolveCustomerSpeechMuteAction({
          pendingTranscript: "",
          callerSpeechActive: true,
          elapsedMs,
          budgetMs: BUDGET,
        }),
      ).toBe("wait");
    }
  });
});

/**
 * Timing constants that two separate measured defects depend on. These assert
 * the RELATIONSHIPS rather than the raw numbers, so retuning stays possible but
 * cannot silently reintroduce either failure.
 *
 * Measurements come from tmp/voice-scoreboard.ts over all 299 recorded calls.
 */
describe("barge-in timing constants", () => {
  it("gives ASR grace room to land inside the mute budget", () => {
    // The grace only helps if the probe can actually wait it out. 13 of 43
    // barge_in_empty_recovery events were followed by the caller's real
    // transcript within 1.5s — two of them within 32ms — because the
    // Gemini-initiated interrupt paths armed the mute with no grace at all.
    // armCustomerSpeechMute now arms it on every path; this keeps the window
    // meaningful relative to the budget it lives inside.
    expect(customerSpeechAsrGraceMs()).toBeGreaterThan(0);
    expect(customerSpeechAsrGraceMs()).toBeLessThan(3_500);
  });

  it("caps the drop guard above p95 but below the tail it exists to cut", () => {
    // The guard waits for a turnComplete that a client-side kill may never
    // produce. Measured open window over 300 calls: p50 18ms, p90 183ms,
    // p95 1960ms, p99 9213ms, max 17353ms, with 21 of 483 windows over 3s.
    // The cap must sit above p95 (healthy turns never reach it) and below p99
    // (it actually cuts the tail).
    const cap = modelAudioDropGuardMaxMs();
    expect(cap).toBeGreaterThan(1_960);
    expect(cap).toBeLessThan(9_213);
  });
});
