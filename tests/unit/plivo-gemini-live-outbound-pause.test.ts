import { describe, expect, it, vi } from "vitest";
import { createOutboundAudioController } from "@/lib/plivo-gemini-live-outbound-controller";

describe("outbound pause/resume duck", () => {
  it("holds queued audio while paused and resumes without dropping", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const controller = createOutboundAudioController(
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

    const frame = Buffer.alloc(160, 0x7f).toString("base64");
    controller.queue(frame);
    controller.pause();
    expect(controller.isPaused()).toBe(true);

    vi.advanceTimersByTime(100);
    expect(emitted).toHaveLength(0);
    expect(controller.queuedBytes()).toBe(160);

    controller.resume();
    vi.advanceTimersByTime(40);
    expect(emitted.length).toBeGreaterThan(0);
    expect(controller.queuedBytes()).toBe(0);

    controller.stop();
    vi.useRealTimers();
  });
});
