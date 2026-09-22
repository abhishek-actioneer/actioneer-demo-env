import { describe, expect, it, vi } from "vitest";
import { createOutboundAudioController } from "@/lib/plivo-gemini-live-outbound-controller";

const FRAME_BYTES = 160;
const FRAME_MS = 20;

function makeController(emitted: string[], overrides: Partial<{ targetCushionMs: number }> = {}) {
  return createOutboundAudioController(
    {
      frameBytes: FRAME_BYTES,
      frameDurationMs: FRAME_MS,
      batchBytes: FRAME_BYTES,
      prerollBytes: FRAME_BYTES,
      pumpIntervalMs: FRAME_MS,
      targetCushionMs: 200,
      maxFramesPerTick: 25,
      ...overrides,
    },
    {
      isClosed: () => false,
      onEmitMulaw: (payload) => emitted.push(payload),
      onSyncOutboundCursor: () => undefined,
    },
  );
}

function frames(n: number): string {
  return Buffer.alloc(FRAME_BYTES * n, 0x7f).toString("base64");
}

function emittedFrames(emitted: string[]): number {
  return emitted.reduce(
    (total, payload) => total + Buffer.byteLength(payload, "base64") / FRAME_BYTES,
    0,
  );
}

describe("outbound pacing", () => {
  it("does not under-deliver when the pump timer slips", () => {
    // The regression: an open-loop "one frame per tick" pump assumes the timer
    // fires exactly on schedule. Under audio + ASR load it does not, and every
    // late tick permanently loses audio — heard as stutter that worsens over a
    // long uninterrupted agent turn. Here the loop runs at 30ms instead of 20ms.
    vi.useFakeTimers();
    const emitted: string[] = [];
    const controller = makeController(emitted);

    controller.queue(frames(150)); // 3s of audio

    const SLIPPED_TICK_MS = 30;
    for (let i = 0; i < 100; i += 1) {
      vi.advanceTimersByTime(SLIPPED_TICK_MS);
    }

    // 100 ticks * 30ms = 3000ms of wall clock, so all 3s of audio must be out.
    // The old pump would have emitted only 100 frames (2s) and lost the rest.
    expect(emittedFrames(emitted)).toBe(150);
    expect(controller.queuedBytes()).toBe(0);
    vi.useRealTimers();
  });

  it("keeps first-frame latency at one tick regardless of cushion", () => {
    // The cushion must not behave like preroll — the first frame still leaves on
    // the first tick, which is what protects first-word latency.
    vi.useFakeTimers();
    const emitted: string[] = [];
    makeController(emitted, { targetCushionMs: 1000 }).queue(frames(1));

    vi.advanceTimersByTime(FRAME_MS);
    expect(emitted).toHaveLength(1);
    vi.useRealTimers();
  });

  it("bounds catch-up work per tick", () => {
    // A long stall must not burst an entire queue into Plivo in one tick.
    vi.useFakeTimers();
    const emitted: string[] = [];
    const controller = makeController(emitted);
    controller.queue(frames(500));

    vi.advanceTimersByTime(FRAME_MS);
    expect(emittedFrames(emitted)).toBeLessThanOrEqual(25);
    expect(controller.queuedBytes()).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("stops running ahead once the cushion is satisfied", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    makeController(emitted).queue(frames(500));

    // One tick fills toward the cushion; it must not keep draining unboundedly
    // on subsequent ticks — steady state is real-time pacing plus the cushion.
    vi.advanceTimersByTime(FRAME_MS * 10); // 200ms of wall clock
    // 200ms elapsed + 200ms cushion = at most ~400ms (20 frames) committed.
    expect(emittedFrames(emitted)).toBeLessThanOrEqual(22);
    vi.useRealTimers();
  });
});
