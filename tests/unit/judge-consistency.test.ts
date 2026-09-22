/**
 * Unit tests for U6: pass^k reliability primitive + the two-site compliance
 * "timeout scored as safe" fix.
 *
 * Covers R14:
 * - passAtK strict-consensus semantics + empty-array case
 * - checkGuardrailCompliance returns status:"error" on a judge timeout (inner)
 * - analyzeVoiceCallResponse never yields a clean verdict from a compliance
 *   throw/timeout (outer caller)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { passAtK } from "@/lib/judge-consistency";

// ── Mock the LLM layer so we can force timeouts/throws per feature ───────────
const generateJsonMock = vi.fn();
vi.mock("@/lib/llm", () => ({
  generateJson: (opts: unknown) => generateJsonMock(opts),
}));

import {
  checkGuardrailCompliance,
  analyzeVoiceCallResponse,
} from "@/lib/voice-response-analysis";
import type { VoiceCall, VoiceCampaign, VoiceTranscriptTurn } from "@/lib/voice-campaign-types";

beforeEach(() => {
  generateJsonMock.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// passAtK
// ─────────────────────────────────────────────────────────────────────────────

describe("passAtK", () => {
  it("all-pass → passK true, passRate 1", () => {
    expect(passAtK([true, true, true])).toEqual({ passK: true, passRate: 1 });
  });

  it("one dissent in k=3 → passK false, passRate ~0.667 (strict consensus)", () => {
    const r = passAtK([true, false, true]);
    expect(r.passK).toBe(false);
    expect(r.passRate).toBeCloseTo(0.667, 2);
  });

  it("empty array → passK false, passRate 0 (explicit)", () => {
    expect(passAtK([])).toEqual({ passK: false, passRate: 0 });
  });

  it("a single dissenting run flips passK to false", () => {
    expect(passAtK([true, true, true, false]).passK).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inner site: checkGuardrailCompliance
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_TURNS: VoiceTranscriptTurn[] = [
  { id: "t1", at: "2026-07-08T00:00:00Z", role: "assistant", text: "Hello, this is a compliance-sensitive pitch." },
  { id: "t2", at: "2026-07-08T00:00:05Z", role: "user", text: "Okay, tell me more." },
];

describe("checkGuardrailCompliance (inner site, R14)", () => {
  it("a judge timeout returns status:'error' and is NOT counted as clean", async () => {
    generateJsonMock.mockRejectedValueOnce(new Error("timeout"));
    const res = await checkGuardrailCompliance(["Never promise guaranteed returns"], AGENT_TURNS, "ds");
    expect(res.status).toBe("error");
    expect(res.violations).toEqual([]);
  });

  it("a genuine empty-violations result returns status:'ok' with []", async () => {
    generateJsonMock.mockResolvedValueOnce({ violations: [] });
    const res = await checkGuardrailCompliance(["Never promise guaranteed returns"], AGENT_TURNS, "ds");
    expect(res.status).toBe("ok");
    expect(res.violations).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Outer site: analyzeVoiceCallResponse
// ─────────────────────────────────────────────────────────────────────────────

function makeCall(): VoiceCall {
  return {
    id: "call_reg_1",
    status: "completed",
    durationSeconds: 42,
    transcript: [
      { role: "assistant", text: "Hi, I'm calling about your loan pre-approval." },
      { role: "user", text: "Yes, I'm interested, send me the details." },
    ],
  } as unknown as VoiceCall;
}

function makeCampaign(): VoiceCampaign {
  return {
    name: "Loan Pre-Approval",
    segmentName: "warm-leads",
    purposeName: "loan-preapproval",
    language: "en",
    datasetId: "banking-lending",
    successDefinition: {
      primary: { criterion: "Customer agrees to a follow-up" },
      guardrails: ["Never promise guaranteed returns"],
    },
  } as unknown as VoiceCampaign;
}

describe("analyzeVoiceCallResponse (outer caller, R14)", () => {
  it("a compliance throw/timeout marks complianceStatus:'error', never 'no violations'", async () => {
    generateJsonMock.mockImplementation((opts: { feature?: string }) => {
      if (opts.feature === "voice-campaigns.guardrail-compliance") {
        return Promise.reject(new Error("timeout"));
      }
      if (opts.feature === "voice-campaigns.criterion-check") {
        return Promise.resolve({ met: true, reason: "agreed" });
      }
      // outcome analysis
      return Promise.resolve({
        outcome: "positive",
        summary: "Customer interested",
        reason: "Asked for details",
        customerNeed: "loan details",
        nextStep: "Send details",
        callbackPreference: "",
        confidence: 0.8,
      });
    });

    const result = await analyzeVoiceCallResponse(makeCampaign(), makeCall());
    expect(result.complianceStatus).toBe("error");
    // errored compliance must NOT surface as a clean/no-violations verdict
    expect(result.guardrailViolations).toBeUndefined();
  });

  it("a clean compliance pass marks complianceStatus:'ok'", async () => {
    generateJsonMock.mockImplementation((opts: { feature?: string }) => {
      if (opts.feature === "voice-campaigns.guardrail-compliance") {
        return Promise.resolve({ violations: [] });
      }
      if (opts.feature === "voice-campaigns.criterion-check") {
        return Promise.resolve({ met: true, reason: "agreed" });
      }
      return Promise.resolve({
        outcome: "positive",
        summary: "Customer interested",
        reason: "Asked for details",
        customerNeed: "loan details",
        nextStep: "Send details",
        callbackPreference: "",
        confidence: 0.8,
      });
    });

    const result = await analyzeVoiceCallResponse(makeCampaign(), makeCall());
    expect(result.complianceStatus).toBe("ok");
  });
});
