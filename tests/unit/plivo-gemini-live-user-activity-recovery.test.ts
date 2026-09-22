import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import {
  createBargeInController,
  type BargeInControllerDeps,
} from "@/lib/plivo-gemini-live-barge-in";
import { pcm16ToMulaw } from "@/lib/telephony-audio";

function audioFrame(amplitude: number): string {
  const pcm = Buffer.alloc(160 * 2);
  if (amplitude > 0) {
    for (let index = 0; index < 25; index += 1) {
      pcm.writeInt16LE(amplitude, index * 2);
    }
  }
  return pcm16ToMulaw(pcm).toString("base64");
}

type SendClientInstruction = BargeInControllerDeps["sendClientInstruction"];

function createDeps(sendClientInstruction: SendClientInstruction): BargeInControllerDeps {
  const socket = {
    readyState: 1,
    send: vi.fn(),
  } as unknown as WebSocket;

  return {
    isClosed: () => false,
    getSetupComplete: () => true,
    getGeminiWs: () => socket,
    getCallerAudioEnabled: () => true,
    getAwaitingCustomerResponse: () => false,
    releaseAwaitingCustomerResponse: vi.fn(),
    getUserTurnStartMs: () => undefined,
    setUserTurnStartMs: vi.fn(),
    getPendingUserTranscript: () => "",
    agentAudioLikelyActive: () => false,
    agentAudioAudible: () => false,
    outboundQueuedBytes: () => 0,
    isAgentTurnBargeInProtected: () => false,
    classifySemanticTrap: () => null,
    isClearSemanticDecisionIntent: () => false,
    sendClientInstruction,
    clearPlivoAudio: vi.fn(),
    clearOutputTranscriptBuffer: vi.fn(),
    emitEvent: vi.fn(),
    markVoiceInterruptedThisTurn: vi.fn(),
    setVoiceLastSpeechFrameMs: vi.fn(),
    streamOffsetMs: () => 0,
    sendGeminiAudio: vi.fn(),
    pauseOutboundPlayback: vi.fn(),
    resumeOutboundPlayback: vi.fn(),
    getFirstResponseRequested: () => true,
    getOpeningTurnComplete: () => true,
    markOpeningTurnComplete: vi.fn(),
    getOpeningAudioStartedAtMs: () => undefined,
    enableCallerAudioAfterOpening: vi.fn(),
    getLastAssistantTurnText: () => "How can I help?",
    getOutputTranscriptBuffer: () => "",
  };
}

function completeQuietActivity(
  controller: ReturnType<typeof createBargeInController>,
): void {
  const speech = audioFrame(2_500);
  const silence = audioFrame(0);
  for (let index = 0; index < 4; index += 1) {
    controller.handleLocalBargeInVad(speech);
  }
  expect(controller.isUserActivityOpen()).toBe(true);
  for (let index = 0; index < 28; index += 1) {
    controller.handleLocalBargeInVad(silence);
  }
  expect(controller.isUserActivityOpen()).toBe(false);
}

describe("caller activity recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers a verified caller turn only after the response budget expires", () => {
    vi.useFakeTimers();
    const sendClientInstruction = vi.fn<SendClientInstruction>();
    const controller = createBargeInController(createDeps(sendClientInstruction));

    completeQuietActivity(controller);
    expect(controller.hasRecentUserActivityEvidence()).toBe(true);
    vi.advanceTimersByTime(3_499);
    expect(sendClientInstruction).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(sendClientInstruction).toHaveBeenCalledWith(
      expect.stringContaining("ask them to repeat"),
      "barge_in_unclear_recovery",
    );
  });

  it("cancels recovery as soon as a real model response starts", () => {
    vi.useFakeTimers();
    const sendClientInstruction = vi.fn<SendClientInstruction>();
    const controller = createBargeInController(createDeps(sendClientInstruction));

    completeQuietActivity(controller);
    controller.resolveUserActivityResponse("outbound_audio");
    vi.advanceTimersByTime(10_000);
    expect(sendClientInstruction).not.toHaveBeenCalled();
  });
});
