import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import {
  createBargeInController,
  type BargeInControllerDeps,
} from "@/lib/plivo-gemini-live-barge-in";
import { LOCAL_BARGE_IN_CANDIDATE_CONFIRM_FRAMES } from "@/lib/plivo-gemini-live-config";
import { pcm16ToMulaw } from "@/lib/telephony-audio";

function constantFrame(amplitude: number, activeSamples = 160): string {
  const pcm = Buffer.alloc(160 * 2);
  for (let index = 0; index < activeSamples; index += 1) {
    pcm.writeInt16LE(amplitude, index * 2);
  }
  return pcm16ToMulaw(pcm).toString("base64");
}

function makeController() {
  let agentLikelyActive = false;
  let agentAudible = false;
  const socket = {
    readyState: 1,
    send: vi.fn(),
  } as unknown as WebSocket;
  const clearPlivoAudio = vi.fn();
  const holdOutboundPlayback = vi.fn();
  const releaseOutboundPlayback = vi.fn();
  const emitEvent = vi.fn();

  const deps: BargeInControllerDeps = {
    isClosed: () => false,
    getSetupComplete: () => true,
    getGeminiWs: () => socket,
    getCallerAudioEnabled: () => true,
    getAwaitingCustomerResponse: () => false,
    releaseAwaitingCustomerResponse: vi.fn(),
    getUserTurnStartMs: () => undefined,
    setUserTurnStartMs: vi.fn(),
    getPendingUserTranscript: () => "",
    agentAudioLikelyActive: () => agentLikelyActive,
    agentAudioAudible: () => agentAudible,
    outboundQueuedBytes: () => (agentAudible ? 3_200 : 0),
    isAgentTurnBargeInProtected: () => false,
    classifySemanticTrap: () => null,
    isClearSemanticDecisionIntent: () => false,
    sendClientInstruction: vi.fn(),
    clearPlivoAudio,
    clearOutputTranscriptBuffer: vi.fn(),
    emitEvent,
    markVoiceInterruptedThisTurn: vi.fn(),
    setVoiceLastSpeechFrameMs: vi.fn(),
    streamOffsetMs: () => 1_000,
    sendGeminiAudio: vi.fn(),
    pauseOutboundPlayback: vi.fn(),
    resumeOutboundPlayback: vi.fn(),
    holdOutboundPlayback,
    releaseOutboundPlayback,
    getFirstResponseRequested: () => true,
    getOpeningTurnComplete: () => true,
    markOpeningTurnComplete: vi.fn(),
    getOpeningAudioStartedAtMs: () => 0,
    enableCallerAudioAfterOpening: vi.fn(),
    getLastAssistantTurnText: () => "The agent is speaking",
    getOutputTranscriptBuffer: () => "The agent is speaking",
  };

  return {
    controller: createBargeInController(deps),
    setAgentAudible(value: boolean) {
      agentAudible = value;
      agentLikelyActive = value;
    },
    setSentPlayoutAudible(value: boolean) {
      agentAudible = value;
    },
    clearPlivoAudio,
    holdOutboundPlayback,
    releaseOutboundPlayback,
    emitEvent,
  };
}

function raiseIdleNoiseFloor(controller: ReturnType<typeof createBargeInController>): void {
  // Carrier comfort noise: energetic enough to establish a high per-call
  // baseline, but without the peak required to count as caller speech.
  const comfortNoise = constantFrame(1_300);
  for (let index = 0; index < 80; index += 1) {
    controller.handleLocalBargeInVad(comfortNoise);
  }
}

describe("adaptive duplex barge-in", () => {
  it("holds sustained duplex evidence until sent playback drains", () => {
    const harness = makeController();
    raiseIdleNoiseFloor(harness.controller);
    harness.setAgentAudible(true);

    const callerSpeech = constantFrame(12_000, 60);
    for (let index = 0; index < LOCAL_BARGE_IN_CANDIDATE_CONFIRM_FRAMES - 1; index += 1) {
      harness.controller.handleLocalBargeInVad(callerSpeech);
    }

    expect(harness.holdOutboundPlayback).toHaveBeenCalledWith("barge_in_candidate");
    expect(harness.clearPlivoAudio).not.toHaveBeenCalled();

    harness.controller.handleLocalBargeInVad(callerSpeech);

    // Sustained evidence alone cannot confirm while sent audio is audible — it
    // may still be speakerphone echo.
    expect(harness.clearPlivoAudio).not.toHaveBeenCalled();

    harness.setSentPlayoutAudible(false);
    for (let index = 0; index < 4; index += 1) {
      harness.controller.handleLocalBargeInVad(callerSpeech);
    }

    expect(harness.releaseOutboundPlayback).toHaveBeenCalledWith("barge_in_candidate");
    expect(harness.clearPlivoAudio).toHaveBeenCalledWith("local_vad_barge_in_activity_start");
    expect(harness.controller.isUserActivityOpen()).toBe(true);
  });

  it("resumes playback when a duplex candidate is not sustained", () => {
    const harness = makeController();
    raiseIdleNoiseFloor(harness.controller);
    harness.setAgentAudible(true);

    const possibleEcho = constantFrame(12_000, 60);
    for (let index = 0; index < 4; index += 1) {
      harness.controller.handleLocalBargeInVad(possibleEcho);
    }
    harness.setSentPlayoutAudible(false);
    for (let index = 0; index < 8; index += 1) {
      harness.controller.handleLocalBargeInVad(constantFrame(0));
    }

    expect(harness.clearPlivoAudio).not.toHaveBeenCalled();
    expect(harness.releaseOutboundPlayback).toHaveBeenCalledWith("barge_in_candidate");
    expect(harness.controller.isUserActivityOpen()).toBe(false);
  });

  it("confirms fragmented duplex speech after the sent playback cushion drains", () => {
    const harness = makeController();
    harness.setAgentAudible(true);

    // A strong onset starts a reversible hold. It is not enough on its own to
    // destroy the model turn.
    harness.controller.handleLocalBargeInVad(constantFrame(12_000, 60));
    expect(harness.holdOutboundPlayback).toHaveBeenCalledWith("barge_in_candidate");
    expect(harness.clearPlivoAudio).not.toHaveBeenCalled();

    // Locally queued model audio still exists, but the already-sent Plivo
    // cushion has drained. The next quiet caller frames are now judged in a
    // no-echo window and open activity without needing 11 perfect frames over
    // playback.
    harness.setSentPlayoutAudible(false);
    const quietCaller = constantFrame(2_500, 80);
    for (let index = 0; index < 4; index += 1) {
      harness.controller.handleLocalBargeInVad(quietCaller);
    }

    expect(harness.clearPlivoAudio).toHaveBeenCalledWith(
      "local_vad_barge_in_activity_start",
    );
    expect(harness.controller.isUserActivityOpen()).toBe(true);
  });
});
