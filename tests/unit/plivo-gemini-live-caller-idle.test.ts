import { afterEach, describe, expect, it, vi } from "vitest";
import { createCallerIdleController } from "@/lib/plivo-gemini-live-caller-idle";

describe("caller idle prompt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits five seconds after agent playback finishes", () => {
    vi.useFakeTimers();
    const releaseAwaitingCustomerResponse = vi.fn();
    const sendClientInstruction = vi.fn();
    const controller = createCallerIdleController({
      isClosed: () => false,
      agentAudioLikelyActive: () => false,
      estimatedRemainingPlaybackMs: () => 300,
      releaseAwaitingCustomerResponse,
      sendClientInstruction,
      emitEvent: vi.fn(),
    });

    controller.armAfterAgentTurn("assistant_turn_complete");
    vi.advanceTimersByTime(5_299);
    expect(sendClientInstruction).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(releaseAwaitingCustomerResponse).toHaveBeenCalledWith(
      "caller_idle_check",
    );
    expect(sendClientInstruction).toHaveBeenCalledWith(
      expect.stringContaining("still on the line"),
      "caller_idle_check",
    );
  });

  it("cancels when verified caller activity begins", () => {
    vi.useFakeTimers();
    const sendClientInstruction = vi.fn();
    const controller = createCallerIdleController({
      isClosed: () => false,
      agentAudioLikelyActive: () => false,
      estimatedRemainingPlaybackMs: () => 0,
      releaseAwaitingCustomerResponse: vi.fn(),
      sendClientInstruction,
      emitEvent: vi.fn(),
    });

    controller.armAfterAgentTurn("assistant_turn_complete");
    vi.advanceTimersByTime(4_999);
    controller.cancel("user_activity:local_vad_speech");
    vi.advanceTimersByTime(10_000);

    expect(sendClientInstruction).not.toHaveBeenCalled();
  });

  it("prompts only once for an unanswered waiting turn", () => {
    vi.useFakeTimers();
    const sendClientInstruction = vi.fn();
    const controller = createCallerIdleController({
      isClosed: () => false,
      agentAudioLikelyActive: () => false,
      estimatedRemainingPlaybackMs: () => 0,
      releaseAwaitingCustomerResponse: vi.fn(),
      sendClientInstruction,
      emitEvent: vi.fn(),
    });

    controller.armAfterAgentTurn("assistant_turn_complete");
    vi.advanceTimersByTime(30_000);

    expect(sendClientInstruction).toHaveBeenCalledTimes(1);
  });
});
