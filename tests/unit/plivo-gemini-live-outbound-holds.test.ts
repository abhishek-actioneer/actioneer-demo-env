import { describe, expect, it, vi } from "vitest";
import { createOutboundAudioController } from "@/lib/plivo-gemini-live-outbound-controller";

function makeController(emitted: string[]) {
  return createOutboundAudioController(
    {
      frameBytes: 160,
      frameDurationMs: 20,
      batchBytes: 160,
      prerollBytes: 160,
      pumpIntervalMs: 20,
      targetCushionMs: 200,
      maxFramesPerTick: 25,
    },
    {
      isClosed: () => false,
      onEmitMulaw: (payload) => emitted.push(payload),
      onSyncOutboundCursor: () => undefined,
    },
  );
}

const FRAME = Buffer.alloc(160, 0x7f).toString("base64");

describe("outbound named playback holds", () => {
  it("keeps audio held until every holder releases", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const controller = makeController(emitted);

    controller.queue(FRAME);
    controller.hold("language_gate");
    controller.hold("soft_duck");
    vi.advanceTimersByTime(100);
    expect(emitted).toHaveLength(0);

    // One holder releasing must NOT resume playback the other still holds.
    controller.release("language_gate");
    vi.advanceTimersByTime(100);
    expect(emitted).toHaveLength(0);

    controller.release("soft_duck");
    vi.advanceTimersByTime(100);
    expect(emitted.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("does not let a legacy resume() clear a named hold", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const controller = makeController(emitted);

    controller.queue(FRAME);
    controller.hold("language_gate");
    controller.pause();
    controller.resume();
    vi.advanceTimersByTime(100);
    expect(emitted).toHaveLength(0);
    expect(controller.isPaused()).toBe(true);

    controller.release("language_gate");
    vi.advanceTimersByTime(100);
    expect(emitted.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("releasing an unheld reason is a no-op and does not resume", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const controller = makeController(emitted);

    controller.queue(FRAME);
    controller.hold("soft_duck");
    controller.release("never_held");
    vi.advanceTimersByTime(100);
    expect(emitted).toHaveLength(0);
    expect(controller.isHeld("soft_duck")).toBe(true);
    vi.useRealTimers();
  });

  it("clear() drops every hold so the next turn is not stuck silent", () => {
    const controller = makeController([]);
    controller.hold("language_gate");
    controller.hold("soft_duck");
    controller.clear();
    expect(controller.isPaused()).toBe(false);
    expect(controller.isHeld("language_gate")).toBe(false);
  });

  it("isPaused reflects any hold, preserving legacy duck checks", () => {
    const controller = makeController([]);
    expect(controller.isPaused()).toBe(false);
    controller.hold("language_gate");
    expect(controller.isPaused()).toBe(true);
    controller.release("language_gate");
    expect(controller.isPaused()).toBe(false);
  });

  it("distinguishes held local queue from audio already sent to Plivo", () => {
    vi.useFakeTimers();
    const controller = makeController([]);
    const longTurn = Buffer.alloc(160 * 50, 0x7f).toString("base64");

    controller.queue(longTurn);
    vi.advanceTimersByTime(20);
    controller.hold("barge_in_candidate");

    expect(controller.isPlayoutActive()).toBe(true);
    expect(controller.queuedBytes()).toBeGreaterThan(0);

    // The unsent queue remains intact, but the cushion already committed to
    // Plivo has drained. This is the clean no-echo confirmation window.
    vi.advanceTimersByTime(500);
    expect(controller.queuedBytes()).toBeGreaterThan(0);
    expect(controller.isPlayoutActive()).toBe(false);

    controller.clear();
    vi.useRealTimers();
  });
});
