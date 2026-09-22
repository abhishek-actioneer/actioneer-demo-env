/**
 * Unit tests for U2's pure timing derivation (deriveTurnLatencies) and the
 * speech-gating helper — testable without telephony.
 *
 * Covers AE1, R3, KTD4.
 */

import { describe, it, expect } from "vitest";
import { deriveTurnLatencies, updateLastSpeechFrame, makeSpeechId } from "@/lib/voice-events";

describe("deriveTurnLatencies (AE1 / R3)", () => {
  it("splits a clean turn: eou=0, model=1050, audio=1170, complete=1600", () => {
    const d = deriveTurnLatencies(0, 1050, 1170, 1600);
    expect(d.detection_think_ms).toBe(1050);
    expect(d.response_lag_ms).toBe(120);
    expect(d.voice_to_voice_ms).toBe(1170);
    expect(d.total_turn_ms).toBe(1600);
    // identity holds
    expect(d.voice_to_voice_ms).toBe((d.detection_think_ms ?? 0) + (d.response_lag_ms ?? 0));
  });

  it("speech-gating: last SPEECH frame at 600 → detection_think 450, not ~1030 or ~0", () => {
    // Simulate a frame stream: speech 0..600, silence 620..1040, model-start 1050.
    let lastSpeech: number | null = null;
    for (const t of [0, 200, 400, 600]) lastSpeech = updateLastSpeechFrame(lastSpeech, t, true);
    for (const t of [620, 820, 1040]) lastSpeech = updateLastSpeechFrame(lastSpeech, t, false);
    expect(lastSpeech).toBe(600); // silence never advanced it

    const d = deriveTurnLatencies(lastSpeech, 1050, 1170, 1600);
    expect(d.detection_think_ms).toBe(450);
    expect(d.detection_think_ms).not.toBe(0);
  });

  it("single-clock guard: a wall-clock Date.now()-scaled input throws (KTD4 c.3)", () => {
    expect(() => deriveTurnLatencies(0, 1_750_000_000_000, 1170, 1600)).toThrow();
  });

  it("clamps to ≥0 when clocks arrive out of order (barge-in/reconnect edge)", () => {
    const d = deriveTurnLatencies(1200, 1000, 900, 1300);
    expect(d.detection_think_ms).toBeGreaterThanOrEqual(0);
    expect(d.response_lag_ms).toBeGreaterThanOrEqual(0);
    expect(d.voice_to_voice_ms).toBeGreaterThanOrEqual(0);
  });

  it("interrupted turn with no outbound audio → response_lag_ms null, not 0", () => {
    const d = deriveTurnLatencies(600, 1050, null, 1600);
    expect(d.response_lag_ms).toBeNull();
    expect(d.voice_to_voice_ms).toBeNull();
    expect(d.detection_think_ms).toBe(450);
  });

  it("opening turn with no prior speech → eou/detection null, response_lag still computed", () => {
    const d = deriveTurnLatencies(null, 200, 320, 900);
    expect(d.eou_proxy_ms).toBeNull();
    expect(d.detection_think_ms).toBeNull();
    expect(d.response_lag_ms).toBe(120);
  });
});

describe("makeSpeechId (turn index)", () => {
  it("speech_id for turn 2 of call_x === call_x:2", () => {
    expect(makeSpeechId("call_x", 2)).toBe("call_x:2");
  });
});
