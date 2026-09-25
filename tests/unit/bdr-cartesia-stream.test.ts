import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BdrCartesiaStream } from "@/lib/bdr/cartesia-stream";
import { BdrPlayback } from "@/lib/bdr/playback";

interface Socket {
  sent: Array<Record<string, unknown>>;
  readyState: number;
  url: string;
  options: { headers: Record<string, string> };
  emit: (event: string, value?: unknown) => boolean;
}
const mocks = vi.hoisted(() => ({ sockets: [] as Socket[], fallback: vi.fn() }));
vi.mock("@/lib/bdr/cartesia", () => ({ bdrSpeechChunks: mocks.fallback }));
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 0;
    sent: Array<Record<string, unknown>> = [];
    constructor(public url: string, public options: { headers: Record<string, string> }) { super(); mocks.sockets.push(this); }
    send(message: string) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; this.emit("close"); }
  }
  return { WebSocket: FakeSocket };
});

const streams: BdrCartesiaStream[] = [];
function stream() { const instance = new BdrCartesiaStream("English", "daniel"); streams.push(instance); return instance; }
function message(socket: Socket, data: object) { socket.emit("message", Buffer.from(JSON.stringify(data))); }
function audio(socket: Socket, context: unknown, flushId = 1, data = Buffer.from([1, 2])) {
  message(socket, { type: "chunk", context_id: context, flush_id: flushId, data: data.toString("base64") });
}
function complete(socket: Socket, context: unknown, flushId = 1) {
  message(socket, { type: "flush_done", context_id: context, flush_id: flushId });
}
async function begin(instance: BdrCartesiaStream, text = "A complete sentence.", turn = "turn-1", controller = new AbortController(), final = false) {
  const generator = instance.speak(text, turn, controller.signal, final);
  const first = generator.next();
  const socket = mocks.sockets.at(-1)!;
  if (socket.readyState === 0) { socket.readyState = 1; socket.emit("open"); }
  await vi.waitFor(() => expect(socket.sent.some((s) => s.transcript === (final ? text : `${text} `))).toBe(true));
  const context = socket.sent.findLast((s) => s.transcript === (final ? text : `${text} `))!.context_id;
  return { generator, first, socket, context, controller };
}

beforeEach(() => {
  vi.stubEnv("CARTESIA_API_KEY", "test-key");
  vi.stubEnv("BDR_CARTESIA_TRANSPORT", "websocket");
  mocks.fallback.mockImplementation(async function* () { yield Buffer.from([9]); });
});
afterEach(() => {
  for (const instance of streams.splice(0)) instance.close();
  mocks.sockets.length = 0;
  mocks.fallback.mockReset();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Cartesia per-turn streaming contexts", () => {
  it("integrates context flushes with playback marks and closes the turn after queued phrases", async () => {
    const send = vi.fn(), played = vi.fn(), failed = vi.fn();
    const playback = new BdrPlayback({ language: "English", voiceId: "daniel", send, played, failed, firstAudio: vi.fn(), interrupted: vi.fn() });
    try {
      playback.speak({ text: "First sentence.", itemId: "reply" });
      playback.speak({ text: "Second sentence.", itemId: "reply" });
      playback.finishTurn("reply");
      await vi.waitFor(() => expect(mocks.sockets).toHaveLength(1));
      const socket = mocks.sockets[0]; socket.readyState = 1; socket.emit("open");
      await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
      const context = socket.sent[0].context_id;
      audio(socket, context);
      await vi.waitFor(() => expect(send.mock.calls.filter(([e]) => e.event === "media")).toHaveLength(1));
      expect(send.mock.calls.some(([e]) => e.event === "mark")).toBe(false);
      complete(socket, context);
      await vi.waitFor(() => expect(socket.sent).toHaveLength(4));
      expect(socket.sent[2]).toMatchObject({ transcript: "Second sentence. ", context_id: context });
      expect(played).not.toHaveBeenCalled();
      audio(socket, context, 2); complete(socket, context, 2);
      await vi.waitFor(() => expect(socket.sent.at(-1)).toMatchObject({ transcript: "", continue: false }));
      expect(send.mock.calls.filter(([e]) => e.event === "mark")).toHaveLength(2);
      playback.acknowledge("bdr-speech-1"); playback.acknowledge("bdr-speech-2");
      expect(played).toHaveBeenCalledTimes(2);
      expect(playback.pending).toBe(false);
      expect(failed).not.toHaveBeenCalled();
    } finally { playback.clear(false); }
  });

  it("preserves one context across phrases and maintains flush boundaries and raw phone format", async () => {
    const instance = stream();
    const a = await begin(instance);
    expect(a.socket.url).not.toContain("test-key");
    expect(a.socket.options.headers.Authorization).toBe("Bearer test-key");
    expect(a.socket.sent[0]).toMatchObject({ voice: "daniel", continue: true, max_buffer_delay_ms: 0, generation_config: { speed: 1, volume: 1 }, output_format: { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 } });
    expect(a.socket.sent[1]).toMatchObject({ transcript: "", flush: true, continue: true, context_id: a.context });
    audio(a.socket, a.context, 1, Buffer.alloc(2000, 0xff));
    expect((await a.first).value).toHaveLength(1600);
    expect((await a.generator.next()).value).toHaveLength(400);
    complete(a.socket, a.context);
    expect((await a.generator.next()).done).toBe(true);
    const b = await begin(instance, "The next complete sentence.");
    expect(b.context).toBe(a.context);
    expect(mocks.sockets).toHaveLength(1);
    // Late packets from the previous flush cannot leak into this phrase.
    audio(b.socket, b.context, 1, Buffer.from([7]));
    audio(b.socket, b.context, 2, Buffer.from([3]));
    complete(b.socket, b.context, 2);
    expect((await b.first).value).toEqual(Buffer.from([3]));
    expect((await b.generator.next()).done).toBe(true);
    instance.finish("turn-1");
    expect(b.socket.sent.at(-1)).toMatchObject({ transcript: "", continue: false, context_id: a.context });
  });

  it("gives a new turn its own context, but reuses the connection", async () => {
    const instance = stream();
    const a = await begin(instance); audio(a.socket, a.context); complete(a.socket, a.context);
    await a.first; await a.generator.next(); instance.finish("turn-1");
    const b = await begin(instance, "Another turn.", "turn-2");
    expect(b.context).not.toBe(a.context);
    expect(mocks.sockets).toHaveLength(1);
    audio(b.socket, b.context); complete(b.socket, b.context);
    await b.first; await b.generator.next();
  });

  it.each([0, 1])("follows the provider flush sequence when it starts at %s", async (initial) => {
    const instance = stream(); const a = await begin(instance);
    audio(a.socket, a.context, initial); complete(a.socket, a.context, initial);
    await a.first; await a.generator.next();
    const b = await begin(instance, "A second phrase.");
    audio(b.socket, b.context, initial, Buffer.from([8]));
    audio(b.socket, b.context, initial + 1, Buffer.from([3])); complete(b.socket, b.context, initial + 1);
    expect((await b.first).value).toEqual(Buffer.from([3]));
    await b.generator.next();
  });

  it("finishes standalone openings and farewells only on done, not flush_done", async () => {
    const a = await begin(stream(), "Hello.", "opening", undefined, true);
    expect(a.socket.sent).toHaveLength(1);
    expect(a.socket.sent[0].continue).toBe(false);
    audio(a.socket, a.context); await a.first;
    complete(a.socket, a.context);
    let ended = false;
    const pending = a.generator.next().then((result) => { ended = !!result.done; });
    await Promise.resolve(); expect(ended).toBe(false);
    message(a.socket, { type: "done", context_id: a.context });
    await pending; expect(ended).toBe(true);
  });

  it("aborts promptly and ignores old-context audio even after a new turn starts", async () => {
    const instance = stream();
    const a = await begin(instance);
    const rejected = expect(a.first).rejects.toThrow();
    a.controller.abort(); await rejected;
    expect(a.socket.sent.at(-1)).toEqual({ context_id: a.context, cancel: true });
    const b = await begin(instance, "New response.", "turn-2");
    audio(a.socket, a.context, 1, Buffer.from([7])); complete(a.socket, a.context);
    audio(b.socket, b.context, 1, Buffer.from([3])); complete(b.socket, b.context);
    expect((await b.first).value).toEqual(Buffer.from([3]));
    await b.generator.next();
    expect(mocks.fallback).not.toHaveBeenCalled();
  });

  it("falls back before first audio and uses HTTP for the rest of that call", async () => {
    const instance = stream();
    const a = await begin(instance);
    a.socket.emit("error", new Error("connection failed"));
    expect((await a.first).value).toEqual(Buffer.from([9]));
    await a.generator.next();
    const next = instance.speak("Next turn.", "turn-2", new AbortController().signal);
    expect((await next.next()).value).toEqual(Buffer.from([9]));
    await next.next();
    expect(mocks.fallback).toHaveBeenCalledTimes(2);
    expect(mocks.sockets).toHaveLength(1);
  });

  it("does not replay a partially heard phrase through the HTTP fallback", async () => {
    const a = await begin(stream());
    audio(a.socket, a.context); await a.first;
    a.socket.emit("error", new Error("connection failed"));
    await expect(a.generator.next()).rejects.toThrow("connection failed");
    expect(mocks.fallback).not.toHaveBeenCalled();
  });

  it("does not pretend empty generation was spoken", async () => {
    mocks.fallback.mockImplementation(async function* () { throw new Error("Cartesia returned empty audio."); yield Buffer.alloc(0); });
    const a = await begin(stream());
    complete(a.socket, a.context);
    await expect(a.first).rejects.toThrow("empty audio");
  });

  it("renews an idle context rather than reusing one that may have expired", async () => {
    vi.useFakeTimers();
    const instance = stream(); const a = await begin(instance);
    audio(a.socket, a.context); complete(a.socket, a.context); await a.first; await a.generator.next();
    await vi.advanceTimersByTimeAsync(800);
    const b = await begin(instance, "A later phrase.");
    expect(b.context).not.toBe(a.context);
    audio(b.socket, b.context); complete(b.socket, b.context); await b.first; await b.generator.next();
  });

  it("times out a silent generation without waiting forever", async () => {
    vi.useFakeTimers();
    const a = await begin(stream());
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await a.first).value).toEqual(Buffer.from([9]));
    await a.generator.next();
    expect(mocks.fallback).toHaveBeenCalledOnce();
  });

  it("can be closed during the handshake without falling back or keeping a call alive", async () => {
    const instance = stream();
    const generator = instance.speak("Hello.", "opening", new AbortController().signal, true);
    const rejected = expect(generator.next()).rejects.toThrow("closed");
    instance.close(); await rejected;
    expect(mocks.fallback).not.toHaveBeenCalled();
  });

  it("supports the explicit HTTP rollback switch", async () => {
    vi.stubEnv("BDR_CARTESIA_TRANSPORT", "bytes");
    const generator = stream().speak("Hello.", "opening", new AbortController().signal, true);
    expect((await generator.next()).value).toEqual(Buffer.from([9]));
    await generator.next();
    expect(mocks.sockets).toHaveLength(0);
  });
});
