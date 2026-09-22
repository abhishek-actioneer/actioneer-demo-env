import { describe, expect, it } from "vitest";
import {
  analyzeInboundSpeechFrame,
  requiredActivityEndSilenceFrames,
} from "@/lib/plivo-gemini-live-stream-utils";
import { pcm16ToMulaw } from "@/lib/telephony-audio";
import {
  applySuppressedTurnPlan,
  isRedundantLiveTurnPlan,
} from "@/lib/plivo-gemini-live-turn-planner";
import type { CustomerTurnPlan } from "@/lib/plivo-gemini-live-turn-planner";

const SHORT = 28;
const LONG = 14;
const LONG_UTTERANCE = 35;

function frames(openSpeechFrames: number): number {
  return requiredActivityEndSilenceFrames(openSpeechFrames, SHORT, LONG, LONG_UTTERANCE);
}

describe("requiredActivityEndSilenceFrames", () => {
  it("keeps the conservative floor for short answers", () => {
    // A one-word answer must not have its tail clipped — that is the failure
    // mode the 28-frame floor exists for.
    expect(frames(0)).toBe(SHORT);
    expect(frames(10)).toBe(SHORT);
    expect(frames(LONG_UTTERANCE - 1)).toBe(SHORT);
  });

  it("drops to the short tail once the utterance is substantial", () => {
    expect(frames(LONG_UTTERANCE)).toBe(LONG);
    expect(frames(120)).toBe(LONG);
  });

  it("never returns more than the conservative floor when misconfigured", () => {
    // A bad override must not make latency worse than the default path.
    expect(requiredActivityEndSilenceFrames(200, 28, 40, 35)).toBe(28);
  });
});

describe("idle-listening VAD sensitivity", () => {
  function quietSpeechFrame(): string {
    const pcm = Buffer.alloc(160 * 2);
    // Sparse speech-like energy: roughly -30.5 dBFS RMS after mu-law roundtrip.
    for (let index = 0; index < 25; index += 1) {
      pcm.writeInt16LE(2_500, index * 2);
    }
    return pcm16ToMulaw(pcm).toString("base64");
  }

  function duplexVoiceFrame(): string {
    const pcm = Buffer.alloc(160 * 2);
    for (let index = 0; index < 60; index += 1) {
      pcm.writeInt16LE(12_000, index * 2);
    }
    return pcm16ToMulaw(pcm).toString("base64");
  }

  const baseOptions = {
    minRms: 2_400,
    minPeak: 6_500,
    minActiveRatio: 0.28,
    noiseMultiplier: 3.8,
  };

  it("hears a quiet caller when no agent audio is audible", () => {
    const analysis = analyzeInboundSpeechFrame(quietSpeechFrame(), 350, {
      ...baseOptions,
      sensitivityMultiplier: 0.35,
    });

    expect(analysis.speech).toBe(true);
    expect(analysis.rms).toBeLessThan(baseOptions.minRms);
  });

  it("keeps the same quiet frame below the active-playback barge-in gate", () => {
    const analysis = analyzeInboundSpeechFrame(quietSpeechFrame(), 350, {
      ...baseOptions,
      agentSpeakingBoost: 1.55,
    });

    expect(analysis.speech).toBe(false);
    expect(analysis.dynamicRms).toBeGreaterThan(baseOptions.minRms);
  });

  it("marks a caller as a duplex candidate when only the adaptive floor rejects them", () => {
    const analysis = analyzeInboundSpeechFrame(duplexVoiceFrame(), 1_320, {
      ...baseOptions,
      agentSpeakingBoost: 1.55,
      updateNoiseFloor: false,
    });

    expect(analysis.rms).toBeGreaterThan(baseOptions.minRms * 1.55);
    expect(analysis.rms).toBeLessThan(analysis.dynamicRms);
    expect(analysis.speech).toBe(false);
    expect(analysis.speechCandidate).toBe(true);
    expect(analysis.nextNoiseFloorRms).toBe(1_320);
  });

  it("does not teach duplex playback or rejected caller speech into the noise floor", () => {
    const analysis = analyzeInboundSpeechFrame(duplexVoiceFrame(), 980, {
      ...baseOptions,
      agentSpeakingBoost: 1.55,
      updateNoiseFloor: false,
    });

    expect(analysis.nextNoiseFloorRms).toBe(980);
  });
});

function plan(overrides: Partial<CustomerTurnPlan> = {}): CustomerTurnPlan {
  return {
    action: "semantic_yes",
    cutPolicy: "clear_playback",
    instruction: "Semantic resolution: Customer affirmed.",
    instructionReason: "semantic_resolution",
    protectAckMs: 0,
    ...overrides,
  };
}

const IDLE = { agentAudioActive: false, awaitingSemanticClarification: false };

describe("isRedundantLiveTurnPlan", () => {
  it("suppresses a plain affirmation while the agent is silent", () => {
    expect(isRedundantLiveTurnPlan(plan(), IDLE)).toBe(true);
    expect(isRedundantLiveTurnPlan(plan({ action: "semantic_no" }), IDLE)).toBe(true);
  });

  it("keeps the instruction while the agent is still speaking", () => {
    // Without it the pitch script rolls straight over the customer's answer.
    expect(
      isRedundantLiveTurnPlan(plan(), { ...IDLE, agentAudioActive: true }),
    ).toBe(false);
  });

  it("keeps the instruction while the semantic trap gate is armed", () => {
    // The instruction is carrying consent correctness there, not just momentum.
    expect(
      isRedundantLiveTurnPlan(plan(), { ...IDLE, awaitingSemanticClarification: true }),
    ).toBe(false);
    expect(
      isRedundantLiveTurnPlan(
        plan({ semantic: { needsClarification: true } as CustomerTurnPlan["semantic"] }),
        IDLE,
      ),
    ).toBe(false);
  });

  it("still releases both playback gates when the instruction is skipped", () => {
    // The regression this exists for: barge-in arms the model-audio drop guard
    // and the customer-speech mute BEFORE a plan is computed, and the plan is
    // what releases them. Skipping the plan wholesale meant Gemini generated a
    // full reply that was discarded chunk-by-chunk — ~15s of dead air until an
    // unrelated timeout rescued playback mid-sentence.
    const clearedDropGuard: string[] = [];
    const clearedMute: string[] = [];
    const instructions: string[] = [];
    const interrupts: string[] = [];

    applySuppressedTurnPlan(
      {
        sessionDump: { event: () => undefined },
        tryClearAudiblePlayback: () => false,
        interruptCurrentModelAudio: (reason) => interrupts.push(reason),
        clearModelAudioDropGuard: (reason) => clearedDropGuard.push(reason),
        clearCustomerSpeechMute: (reason) => clearedMute.push(reason),
        activateCustomerPause: () => undefined,
        noteControlIntentSent: () => undefined,
        markDecisionResolutionApplied: () => undefined,
        sendClientInstruction: (text) => instructions.push(text),
        protectAckUntil: () => undefined,
      },
      plan(),
      "हां जी, बोलो।",
      "live",
    );

    expect(clearedDropGuard).toHaveLength(1);
    expect(clearedMute).toHaveLength(1);
    // The whole point of suppressing — no instruction, and no cut that would
    // restart the in-flight generation we are trying to preserve.
    expect(instructions).toEqual([]);
    expect(interrupts).toEqual([]);
  });

  it("records the decision and ack protection even when suppressed", () => {
    const decisions: string[] = [];
    const ackUntil: number[] = [];
    const now = Date.now();

    applySuppressedTurnPlan(
      {
        sessionDump: { event: () => undefined },
        tryClearAudiblePlayback: () => false,
        interruptCurrentModelAudio: () => undefined,
        clearModelAudioDropGuard: () => undefined,
        clearCustomerSpeechMute: () => undefined,
        activateCustomerPause: () => undefined,
        noteControlIntentSent: () => undefined,
        markDecisionResolutionApplied: (text) => decisions.push(text),
        sendClientInstruction: () => undefined,
        protectAckUntil: (until) => ackUntil.push(until),
      },
      plan({
        protectAckMs: 3000,
        semantic: { intent: "yes" } as CustomerTurnPlan["semantic"],
      }),
      "haan",
      "live",
    );

    expect(decisions).toEqual(["haan"]);
    expect(ackUntil).toHaveLength(1);
    expect(ackUntil[0]).toBeGreaterThanOrEqual(now + 3000);
  });

  it("never suppresses control intents, answers, or link sends", () => {
    expect(isRedundantLiveTurnPlan(plan({ action: "direct_answer" }), IDLE)).toBe(false);
    expect(isRedundantLiveTurnPlan(plan({ action: "whatsapp_send_link" }), IDLE)).toBe(false);
    expect(isRedundantLiveTurnPlan(plan({ action: "control_wait" }), IDLE)).toBe(false);
    expect(isRedundantLiveTurnPlan(plan({ action: "control_stop" }), IDLE)).toBe(false);
    expect(isRedundantLiveTurnPlan(plan({ action: "none" }), IDLE)).toBe(false);
    expect(
      isRedundantLiveTurnPlan(plan({ controlIntent: "wait" }), IDLE),
    ).toBe(false);
  });
});
