import { afterEach, describe, expect, it, vi } from "vitest";
import { BdrPlayback } from "@/lib/bdr/playback";
const speech = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bdr/cartesia-stream", () => ({ BdrCartesiaStream: class {
  constructor(private language: string, private voiceId: string) {}
  speak(text: string, _turnId: string, signal: AbortSignal) { return speech(text, this.language, this.voiceId, signal); }
  finish() {}
  cancel() {}
  close() {}
} }));
afterEach(() => { speech.mockReset(); });

describe("BDR audio cancellation", () => {
  it("aborts old synthesis, discards its late audio/marks, and lets the next turn stream immediately", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    speech.mockImplementation(async function* (text: string) {
      if (text === "Old sentence.") {
        yield Buffer.from([1]);
        await waiting;
        yield Buffer.from([2]);
      } else yield Buffer.from([3]);
    });
    const send = vi.fn(), played = vi.fn(), interrupted = vi.fn(), failed = vi.fn();
    const playback = new BdrPlayback({ language: "English", voiceId: "voice", send, played, interrupted, failed, firstAudio: vi.fn() });
    playback.speak({ text: "Old sentence.", itemId: "old" });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const signal = speech.mock.calls[0][3] as AbortSignal;
    playback.clear();
    expect(signal.aborted).toBe(true);
    playback.speak({ text: "New sentence.", itemId: "new" });
    await vi.waitFor(() => expect(send.mock.calls.some(([e]) => e.event === "mark")).toBe(true));
    expect(interrupted).toHaveBeenCalledWith(expect.objectContaining({ itemId: "old" }));
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send.mock.calls.filter(([e]) => e.event === "media").map(([e]) => e.media.payload)).toEqual(["AQ==", "Aw=="]);
    playback.acknowledge("bdr-speech-1");
    expect(played).not.toHaveBeenCalled();
    playback.acknowledge("bdr-speech-2");
    expect(played).toHaveBeenCalledWith(expect.objectContaining({ itemId: "new" }));
    expect(playback.pending).toBe(false);
    expect(failed).not.toHaveBeenCalled();
  });
});
