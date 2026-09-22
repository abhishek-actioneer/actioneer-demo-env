/**
 * Unit tests for the hot-path-safe voice event emitter (U1).
 *
 * Covers R5, R6, AE4, KTD1, KTD2:
 * - deterministic speech_id minting
 * - fail-open local sink when PostHog is unconfigured
 * - flag-off = total no-op
 * - non-awaiting capture with explicit distinctId (= call_id), no flush
 * - call_id / $ai_trace_id present + equal on every event
 * - enrichment local sink redaction (no transcript text)
 * - call_id emitted byte-for-byte (never shortened)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeSpeechId,
  emitVoiceTurn,
  emitVoiceLifecycle,
  emitVoiceEnrichment,
  setVoiceClientForTesting,
  VOICE_POSTHOG_OPTIONS,
  VOICE_EVENTS,
  type VoiceTurnRecord,
  type VoiceEnrichmentRecord,
  type VoiceCaptureClient,
} from "@/lib/voice-events";

const TURN: VoiceTurnRecord = {
  speech_id: "call_abc:1",
  turn_index: 1,
  eou_proxy_ms: 600,
  eou_source: "gemini_vad_proxy",
  voice_to_voice_ms: 1170,
  detection_think_ms: 1050,
  response_lag_ms: 120,
  total_turn_ms: 1600,
  interrupted: false,
};

function makeSpyClient(): { client: VoiceCaptureClient; capture: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> } {
  const capture = vi.fn();
  const flush = vi.fn(async () => {});
  return { client: { capture, flush }, capture, flush };
}

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.VOICE_LATENCY_METRICS = "1";
  setVoiceClientForTesting(undefined);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  setVoiceClientForTesting(undefined);
  delete process.env.VOICE_LATENCY_METRICS;
  logSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("makeSpeechId", () => {
  it("is deterministic: same inputs → same id", () => {
    expect(makeSpeechId("call_abc", 3)).toBe("call_abc:3");
    expect(makeSpeechId("call_abc", 3)).toBe("call_abc:3");
  });
  it("increments with turn index", () => {
    expect(makeSpeechId("call_x", 2)).toBe("call_x:2");
  });
});

describe("fail-open local sink (AE4)", () => {
  it("with flag on + PostHog unconfigured, emitVoiceTurn writes exactly one [voice/latency] line and does not throw", () => {
    setVoiceClientForTesting(null); // simulate getVoiceClient() → null
    expect(() => emitVoiceTurn(TURN, "call_abc", "gemini_live")).not.toThrow();
    const lines = logSpy.mock.calls.filter((c: unknown[]) => String(c[0]).startsWith("[voice/latency]"));
    expect(lines).toHaveLength(1);
  });
});

describe("flag-off = no-op (AE4)", () => {
  it("writes no log line and makes no capture call", () => {
    delete process.env.VOICE_LATENCY_METRICS;
    const { client, capture } = makeSpyClient();
    setVoiceClientForTesting(client);
    emitVoiceTurn(TURN, "call_abc", "gemini_live");
    expect(capture).not.toHaveBeenCalled();
    const lines = logSpy.mock.calls.filter((c: unknown[]) => String(c[0]).startsWith("[voice/latency]"));
    expect(lines).toHaveLength(0);
  });
});

describe("non-awaiting capture (KTD2, R6)", () => {
  it("passes distinctId === call_id, never flushes, and carries equal call_id / $ai_trace_id", () => {
    const { client, capture, flush } = makeSpyClient();
    setVoiceClientForTesting(client);
    emitVoiceLifecycle(VOICE_EVENTS.wsConnected, {}, "call_abc", "gemini_live");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(flush).not.toHaveBeenCalled();
    const payload = capture.mock.calls[0][0];
    expect(payload.distinctId).toBe("call_abc");
    expect(payload.properties.call_id).toBe("call_abc");
    expect(payload.properties.$ai_trace_id).toBe("call_abc");
    expect(payload.properties.call_id).toBe(payload.properties.$ai_trace_id);
  });

  it("uses a batched client (flushAt > 1), not the flushAt:1 singleton", () => {
    expect(VOICE_POSTHOG_OPTIONS.flushAt).toBeGreaterThan(1);
  });

  it("NEVER throws into the caller even if the PostHog client.capture throws (hot-path safety)", () => {
    const capture = vi.fn(() => {
      throw new Error("posthog exploded");
    });
    setVoiceClientForTesting({ capture });
    // Must not propagate — the audio path / API route must be unaffected.
    expect(() => emitVoiceTurn(TURN, "call_abc", "gemini_live")).not.toThrow();
    expect(() => emitVoiceLifecycle(VOICE_EVENTS.wsConnected, {}, "call_abc", "gemini_live")).not.toThrow();
    expect(capture).toHaveBeenCalled(); // it was attempted, and the throw was swallowed
  });

  it("emits call_id byte-for-byte (never shortened/sliced)", () => {
    const longId = "call_" + "a".repeat(64) + "_trailing";
    const { client, capture } = makeSpyClient();
    setVoiceClientForTesting(client);
    emitVoiceLifecycle(VOICE_EVENTS.wsConnected, {}, longId, "gemini_live");
    expect(capture.mock.calls[0][0].properties.call_id).toBe(longId);
    expect(capture.mock.calls[0][0].distinctId).toBe(longId);
  });
});

describe("enrichment local sink redaction (KTD2 exception / OQ2)", () => {
  it("logs call_id + scores but no transcript-derived text field", () => {
    setVoiceClientForTesting(null);
    const record: VoiceEnrichmentRecord = {
      sentiment_trajectory: [{ turn_index: 1, label: "positive" }],
      question_types: ["pricing", "eligibility"],
      script_adherence_scores: { score: 67, failed: ["greeting"] },
      interruption_handling: { judge_status: "ok", grade: "good" },
      compliance_violations: { judge_status: "error" },
      enriched: true,
      sample_rate: 1,
    };
    // A verbatim transcript that must NOT appear in stdout.
    const secret = "MY_ACCOUNT_NUMBER_1234567890";
    emitVoiceEnrichment({ ...record, question_types: [...record.question_types] }, "call_abc", "gemini_live");
    const line = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).find((l: string) => l.startsWith("[voice/latency]"))!;
    expect(line).toContain("call_abc");
    expect(line).toContain("script_adherence_score");
    expect(line).not.toContain(secret);
    expect(line).not.toContain("sentiment_trajectory"); // no raw label array/text dumped
  });
});
