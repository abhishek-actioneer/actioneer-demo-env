import { describe, expect, it } from "vitest";
import { UserAudioAccumulator, readyVoiceForensicsHorizons } from "@/lib/voice-forensics";

function mulawPayload(ms: number, byte = 0xff): string {
  return Buffer.alloc(Math.round(ms * 8), byte).toString("base64");
}

describe("UserAudioAccumulator", () => {
  it("does not expose a horizon before enough user-side audio is captured", () => {
    const accumulator = new UserAudioAccumulator();

    accumulator.append(mulawPayload(400));

    expect(accumulator.totalMs).toBe(400);
    expect(accumulator.snapshot(500)).toBeNull();
  });

  it("returns the first requested horizon without consuming later audio", () => {
    const accumulator = new UserAudioAccumulator();

    accumulator.append(mulawPayload(700, 0xfe));
    const snapshot = accumulator.snapshot(500);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.mulaw8k.length).toBe(4000);
    expect(snapshot?.pcm16.length).toBe(8000);
    expect(snapshot?.durationMs).toBe(500);
    expect(accumulator.totalMs).toBe(700);
  });

  it("keeps prefix snapshots available across multiple horizons", () => {
    const accumulator = new UserAudioAccumulator();

    accumulator.append(mulawPayload(500));
    expect(accumulator.snapshot(500)?.durationMs).toBe(500);

    accumulator.append(mulawPayload(500));
    expect(accumulator.snapshot(500)?.durationMs).toBe(500);
    expect(accumulator.snapshot(1000)?.durationMs).toBe(1000);
    expect(accumulator.totalMs).toBe(1000);
  });
});

describe("readyVoiceForensicsHorizons", () => {
  it("triggers only milestones with enough user-side audio", () => {
    expect(readyVoiceForensicsHorizons(499, new Set())).toEqual([]);
    expect(readyVoiceForensicsHorizons(500, new Set())).toEqual([500]);
    expect(readyVoiceForensicsHorizons(1999, new Set([500, 1000]))).toEqual([]);
    expect(readyVoiceForensicsHorizons(5000, new Set([500, 1000]))).toEqual([2000, 5000]);
  });
});
