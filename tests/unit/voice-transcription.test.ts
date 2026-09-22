/**
 * Unit tests for U5: `voice_transcript_finalized` (openai_postcall) on the
 * post-call OpenAI transcription path.
 *
 * Covers R1, AE2, and the single-finalize invariant (Verification Contract #8).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock module boundaries ──────────────────────────────────────────────────
const emitVoiceLifecycleMock = vi.fn();
vi.mock("@/lib/voice-events", () => ({
  emitVoiceLifecycle: (...args: unknown[]) => emitVoiceLifecycleMock(...args),
}));

const findCallMock = vi.fn();
vi.mock("@/lib/voice-campaign-store", () => ({
  findCall: (id: string) => findCallMock(id),
  appendCallTranscript: vi.fn(),
  appendCallTranscriptTurns: vi.fn(),
}));

const transcriptionsCreateMock = vi.fn();
vi.mock("@/lib/openai-client", () => ({
  getOpenAI: () => ({
    audio: { transcriptions: { create: (...a: unknown[]) => transcriptionsCreateMock(...a) } },
    chat: { completions: { create: vi.fn() } },
  }),
}));

vi.mock("@/lib/voice-recording-storage", () => ({
  readRecordingBytes: vi.fn(async () => ({ bytes: Buffer.from("fake-audio-bytes") })),
}));

vi.mock("@/lib/voice-followup-sms", () => ({
  maybeSendPostCallFollowUp: vi.fn(async () => {}),
}));

// Keep real fs (mkdtempSync/writeFileSync/rmSync) but stub the lazy read stream
// so it never races the finally-block cleanup on a temp file it never consumes.
vi.mock("fs", async (importActual) => {
  const actual = await importActual<typeof import("fs")>();
  return { ...actual, createReadStream: vi.fn(() => ({ path: "stub" })) };
});

import { transcribeStoredCallRecording } from "@/lib/voice-transcription";
import type { VoiceTranscriptTurn } from "@/lib/voice-campaign-types";

const RECORDING_SID = "rec_123";

function foundWith(transcript: VoiceTranscriptTurn[], triggeredAtMs?: number) {
  return {
    campaign: { id: "camp_1", language: "English" },
    call: {
      id: "calluuid_1",
      callConfigId: "vc-abc-1-xyz",
      transcript,
      triggeredAtMs,
      recording: { sid: RECORDING_SID, storageKey: "s3://key", contentType: "mp3" },
    },
  };
}

// A plain (non-realtime) recording transcript → hasGeminiRealtimeTranscript false.
const NON_REALTIME: VoiceTranscriptTurn[] = [
  { id: "r1", role: "recording", text: "prior recording", at: "2026-07-08T00:00:00Z", itemId: "rec_prev" },
];
// A realtime transcript (itemId starts with "live-") → skip-when-realtime true.
const REALTIME: VoiceTranscriptTurn[] = [
  { id: "l1", role: "assistant", text: "hi", at: "2026-07-08T00:00:00Z", itemId: "live-assistant-0-1" },
  { id: "l2", role: "user", text: "hello", at: "2026-07-08T00:00:01Z", itemId: "live-user-1-2" },
];

beforeEach(() => {
  emitVoiceLifecycleMock.mockReset();
  findCallMock.mockReset();
  transcriptionsCreateMock.mockReset();
  process.env.VOICE_POST_CALL_DIARIZE = "0"; // skip diarize for a clean single path
  process.env.VOICE_LATENCY_METRICS = "1";
});

describe("transcribeStoredCallRecording → voice_transcript_finalized (U5)", () => {
  it("emits exactly one openai_postcall finalize with a positive trigger_to_transcript_ms (AE2)", async () => {
    const triggeredAtMs = Date.now() - 30_000; // 30s ago
    findCallMock.mockReturnValue(foundWith(NON_REALTIME, triggeredAtMs));
    transcriptionsCreateMock.mockResolvedValue({ text: "full call transcript" });

    const text = await transcribeStoredCallRecording("calluuid_1", RECORDING_SID);
    expect(text).toBe("full call transcript");

    const finalizeCalls = emitVoiceLifecycleMock.mock.calls.filter(
      (c) => c[0] === "voice_transcript_finalized",
    );
    expect(finalizeCalls).toHaveLength(1);
    const [, props, callId] = finalizeCalls[0];
    expect(props.transcript_source).toBe("openai_postcall");
    expect(props.trigger_to_transcript_ms).toBeGreaterThan(0);
    expect(callId).toBe("calluuid_1");
  });

  it("emits trigger_to_transcript_ms: null when triggeredAtMs is absent (never a substitute)", async () => {
    findCallMock.mockReturnValue(foundWith(NON_REALTIME, undefined));
    transcriptionsCreateMock.mockResolvedValue({ text: "full call transcript" });

    await transcribeStoredCallRecording("calluuid_1", RECORDING_SID);
    const finalize = emitVoiceLifecycleMock.mock.calls.find((c) => c[0] === "voice_transcript_finalized");
    expect(finalize?.[1].trigger_to_transcript_ms).toBeNull();
  });

  it("does NOT emit the openai finalize when a realtime transcript is present (no double finalize)", async () => {
    findCallMock.mockReturnValue(foundWith(REALTIME, Date.now() - 1000));
    // transcription should be skipped entirely
    const text = await transcribeStoredCallRecording("calluuid_1", RECORDING_SID);
    expect(text).toBe("");
    expect(transcriptionsCreateMock).not.toHaveBeenCalled();
    expect(emitVoiceLifecycleMock).not.toHaveBeenCalled();
  });

  it("a transcription failure emits no finalize and does not throw into caller unexpectedly", async () => {
    findCallMock.mockReturnValue(foundWith(NON_REALTIME, Date.now() - 1000));
    transcriptionsCreateMock.mockResolvedValue({ text: "" }); // empty → throws internally

    await expect(transcribeStoredCallRecording("calluuid_1", RECORDING_SID)).rejects.toThrow();
    const finalize = emitVoiceLifecycleMock.mock.calls.filter((c) => c[0] === "voice_transcript_finalized");
    expect(finalize).toHaveLength(0);
  });
});
