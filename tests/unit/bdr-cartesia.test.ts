import { afterEach, describe, expect, it, vi } from "vitest";
import { bdrSpeechChunks } from "@/lib/bdr/cartesia";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Cartesia phone audio streaming", () => {
  it("yields raw phone audio before the HTTP response finishes", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "test-key");
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
    const fetch = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal("fetch", fetch);
    const audio = bdrSpeechChunks("A complete sentence.", "English", "daniel", new AbortController().signal);
    const first = audio.next();
    body.enqueue(new Uint8Array(2000).fill(0xff));
    expect((await first).value).toEqual(Buffer.alloc(1600, 0xff));
    expect((await audio.next()).value).toEqual(Buffer.alloc(400, 0xff));
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.output_format).toEqual({ container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 });
    body.close();
    expect((await audio.next()).done).toBe(true);
  });

  it("rejects empty output instead of pretending the sentence played", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array())));
    const audio = bdrSpeechChunks("Hello.", "English", "daniel", new AbortController().signal);
    await expect(audio.next()).rejects.toThrow("empty audio");
  });
});
