/**
 * Unit tests for U7 (enrichment orchestrator + sample gate) and U8 (live
 * script-adherence scoring routed into the record).
 *
 * Covers R8, R9, R10, R11, R12, R14, AE3.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the LLM layer; dispatch by feature so we can count per-judge calls ──
const generateJsonMock = vi.fn();
vi.mock("@/lib/llm", () => ({
  generateJson: (opts: { feature?: string }) => generateJsonMock(opts),
}));

// ── Spy the enrichment emit; keep the real sample-rate + types ──────────────
const emitEnrichmentMock = vi.fn();
vi.mock("@/lib/voice-events", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/voice-events")>();
  return { ...actual, emitVoiceEnrichment: (...a: unknown[]) => emitEnrichmentMock(...a) };
});

// ── Mock the live script-adherence rubric (single source, U8) ───────────────
const adherenceMock = vi.fn();
vi.mock("@/lib/voice-campaign-analysis", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/voice-campaign-analysis")>();
  return { ...actual, evaluateScriptAdherenceCall: (...a: unknown[]) => adherenceMock(...a) };
});

import { runVoiceEnrichment } from "@/lib/voice-enrichment";
import type { VoiceCall, VoiceCampaign, VoiceTranscriptTurn } from "@/lib/voice-campaign-types";

const TRANSCRIPT: VoiceTranscriptTurn[] = [
  { id: "a1", role: "assistant", text: "Hi, calling about your loan.", at: "2026-07-08T00:00:00Z" },
  { id: "u1", role: "user", text: "How much can I borrow?", at: "2026-07-08T00:00:03Z" },
  { id: "a2", role: "assistant", text: "Up to five lakh.", at: "2026-07-08T00:00:06Z" },
  { id: "u2", role: "user", text: "Wait, stop — what's the rate?", at: "2026-07-08T00:00:08Z" },
];

function makeCall(transcript = TRANSCRIPT): VoiceCall {
  return { id: "calluuid_1", status: "completed", transcript } as unknown as VoiceCall;
}

function makeCampaign(): VoiceCampaign {
  return {
    name: "Loan",
    datasetId: "banking-lending",
    successDefinition: { guardrails: ["No guaranteed returns"] },
  } as unknown as VoiceCampaign;
}

function wireHappyJudges() {
  generateJsonMock.mockImplementation((opts: { feature?: string }) => {
    switch (opts.feature) {
      case "voice-enrichment.sentiment-trajectory":
        return Promise.resolve({ trajectory: [{ turn_index: 1, label: "positive" }, { turn_index: 2, label: "confused" }] });
      case "voice-enrichment.question-types":
        return Promise.resolve({ question_types: ["eligibility", "pricing"] });
      case "voice-enrichment.interruption-handling":
        return Promise.resolve({ grade: "good", notes: "stopped and addressed" });
      case "voice-campaigns.guardrail-compliance":
        return Promise.resolve({ violations: [] });
      default:
        return Promise.resolve({});
    }
  });
  adherenceMock.mockReturnValue({
    callId: "calluuid_1",
    label: "Call 1",
    outcome: "positive",
    score: 67,
    failedKeys: ["discovery", "concern_handling"],
    checks: {},
  });
}

beforeEach(() => {
  generateJsonMock.mockReset();
  emitEnrichmentMock.mockReset();
  adherenceMock.mockReset();
});

describe("sample gate (KTD5, R8)", () => {
  it("rate 0 → one enriched:false event, sample_rate:0, and NO judge calls", async () => {
    await runVoiceEnrichment({
      callId: "vc-abc-1",
      campaign: makeCampaign(),
      call: makeCall(),
      interruptedTurnIndices: [],
      sampleRate: 0,
      rng: () => 0.5,
    });
    expect(emitEnrichmentMock).toHaveBeenCalledTimes(1);
    const [record, callId] = emitEnrichmentMock.mock.calls[0];
    expect(record.enriched).toBe(false);
    expect(record.sample_rate).toBe(0);
    expect(callId).toBe("vc-abc-1");
    expect(generateJsonMock).not.toHaveBeenCalled();
    expect(adherenceMock).not.toHaveBeenCalled();
  });
});

describe("enriched pass (R10, R11, R14, AE3)", () => {
  it("hands exactly the spine's interrupted turns to the interruption judge; each judge runs once", async () => {
    wireHappyJudges();
    await runVoiceEnrichment({
      callId: "vc-abc-1",
      campaign: makeCampaign(),
      call: makeCall(),
      interruptedTurnIndices: [1, 3],
      sampleRate: 1,
      rng: () => 0.0,
    });

    // Each judge invoked exactly once (no k-sampling — KTD8)
    const byFeature = (f: string) => generateJsonMock.mock.calls.filter((c) => c[0].feature === f).length;
    expect(byFeature("voice-enrichment.sentiment-trajectory")).toBe(1);
    expect(byFeature("voice-enrichment.question-types")).toBe(1);
    expect(byFeature("voice-enrichment.interruption-handling")).toBe(1);
    expect(byFeature("voice-campaigns.guardrail-compliance")).toBe(1);

    const record = emitEnrichmentMock.mock.calls[0][0];
    expect(record.interruption_handling.judge_status).toBe("ok");
    expect(record.interruption_handling.interrupted_turn_indices).toEqual([1, 3]);
    expect(record.interruption_handling.interrupted_turn_count).toBe(2);
  });

  it("with no interrupted turns, the interruption judge makes no LLM call and grades 'none'", async () => {
    wireHappyJudges();
    await runVoiceEnrichment({
      callId: "vc-abc-1",
      campaign: makeCampaign(),
      call: makeCall(),
      interruptedTurnIndices: [],
      sampleRate: 1,
      rng: () => 0.0,
    });
    const byFeature = (f: string) => generateJsonMock.mock.calls.filter((c) => c[0].feature === f).length;
    expect(byFeature("voice-enrichment.interruption-handling")).toBe(0);
    expect(emitEnrichmentMock.mock.calls[0][0].interruption_handling.interrupted_turn_count).toBe(0);
  });

  it("sentiment is a per-turn trajectory array of {turn_index,label} (R10 flagship cross-cut)", async () => {
    wireHappyJudges();
    await runVoiceEnrichment({
      callId: "vc-abc-1",
      campaign: makeCampaign(),
      call: makeCall(),
      interruptedTurnIndices: [1],
      sampleRate: 1,
      rng: () => 0.0,
    });
    const traj = emitEnrichmentMock.mock.calls[0][0].sentiment_trajectory;
    expect(Array.isArray(traj)).toBe(true);
    expect(traj[0]).toEqual({ turn_index: 1, label: "positive" });
  });

  it("a compliance judge error lands as judge_status:'error', never empty/clean (R14)", async () => {
    wireHappyJudges();
    generateJsonMock.mockImplementation((opts: { feature?: string }) => {
      if (opts.feature === "voice-campaigns.guardrail-compliance") return Promise.reject(new Error("timeout"));
      if (opts.feature === "voice-enrichment.sentiment-trajectory") return Promise.resolve({ trajectory: [] });
      if (opts.feature === "voice-enrichment.question-types") return Promise.resolve({ question_types: [] });
      if (opts.feature === "voice-enrichment.interruption-handling") return Promise.resolve({ grade: "good", notes: "" });
      return Promise.resolve({});
    });
    await runVoiceEnrichment({
      callId: "vc-abc-1",
      campaign: makeCampaign(),
      call: makeCall(),
      interruptedTurnIndices: [1],
      sampleRate: 1,
      rng: () => 0.0,
    });
    expect(emitEnrichmentMock.mock.calls[0][0].compliance_violations.judge_status).toBe("error");
  });

  it("a judge throwing mid-pass is caught; a partial record still emits, keyed by untruncated call_id", async () => {
    wireHappyJudges();
    generateJsonMock.mockImplementation((opts: { feature?: string }) => {
      if (opts.feature === "voice-enrichment.sentiment-trajectory") return Promise.reject(new Error("boom"));
      if (opts.feature === "voice-enrichment.question-types") return Promise.resolve({ question_types: ["pricing"] });
      if (opts.feature === "voice-enrichment.interruption-handling") return Promise.resolve({ grade: "good", notes: "" });
      if (opts.feature === "voice-campaigns.guardrail-compliance") return Promise.resolve({ violations: [] });
      return Promise.resolve({});
    });
    const longId = "vc-" + "a".repeat(80);
    await expect(
      runVoiceEnrichment({
        callId: longId,
        campaign: makeCampaign(),
        call: makeCall(),
        interruptedTurnIndices: [1],
        sampleRate: 1,
        rng: () => 0.0,
      }),
    ).resolves.toBeUndefined();
    expect(emitEnrichmentMock).toHaveBeenCalledTimes(1);
    const [record, callId] = emitEnrichmentMock.mock.calls[0];
    expect(callId).toBe(longId); // untruncated
    expect(record.sentiment_trajectory).toEqual([]); // failed dimension degraded, not dropped
    expect(record.question_types).toEqual(["pricing"]); // other dimensions survive
  });
});

describe("U8 — script adherence routed into the record (R9)", () => {
  it("a 4-of-6 call yields score 67 via evaluateScriptAdherenceCall and names the failed keys", async () => {
    wireHappyJudges();
    await runVoiceEnrichment({
      callId: "vc-abc-1",
      campaign: makeCampaign(),
      call: makeCall(),
      interruptedTurnIndices: [],
      sampleRate: 1,
      rng: () => 0.0,
    });
    expect(adherenceMock).toHaveBeenCalledTimes(1); // single source, no new rubric copy
    const scores = emitEnrichmentMock.mock.calls[0][0].script_adherence_scores;
    expect(scores.score).toBe(67);
    expect(scores.failed_keys).toEqual(["discovery", "concern_handling"]);
  });

  it("an empty/degenerate transcript yields score 0 rather than throwing", async () => {
    wireHappyJudges();
    adherenceMock.mockReturnValue(null); // rubric returns null on empty transcript
    await runVoiceEnrichment({
      callId: "vc-abc-1",
      campaign: makeCampaign(),
      call: makeCall([]),
      interruptedTurnIndices: [],
      sampleRate: 1,
      rng: () => 0.0,
    });
    expect(emitEnrichmentMock.mock.calls[0][0].script_adherence_scores.score).toBe(0);
  });
});
