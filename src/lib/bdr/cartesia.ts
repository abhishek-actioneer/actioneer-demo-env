async function requestSpeech(text: string, language: string, voiceId: string, preview: boolean, signal?: AbortSignal): Promise<Response> {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) throw new Error("Cartesia is not configured.");
  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": "2026-08-14", "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: process.env.BDR_CARTESIA_MODEL || "sonic-3.6", transcript: text, voice: voiceId,
      language: language === "English" ? "en" : "hi",
      output_format: preview ? { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 } : { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 },
      generation_config: { speed: 1, volume: 1 },
    }),
  });
  if (!response.ok) throw new Error(`Cartesia speech generation failed (${response.status}). Check the voice ID, credits, and API key.`);
  return response;
}

// /tts/bytes streams raw audio. Forward it as it arrives instead of waiting for
// arrayBuffer(), which adds the full synthesis/download time to every sentence.
export async function* bdrSpeechChunks(text: string, language: string, voiceId: string, signal: AbortSignal): AsyncGenerator<Buffer> {
  const response = await requestSpeech(text, language, voiceId, false, signal);
  if (!response.body) throw new Error("Cartesia returned no audio stream.");
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      signal.throwIfAborted();
      bytes += value.length;
      // 200 ms of 8 kHz mu-law per message; no WAV headers in Media Streams.
      for (let offset = 0; offset < value.length; offset += 1600) {
        yield Buffer.from(value.subarray(offset, offset + 1600));
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!bytes) throw new Error("Cartesia returned empty audio.");
}

export async function bdrSpeech(text: string, language: string, voiceId: string, preview = false): Promise<Buffer> {
  const response = await requestSpeech(text, language, voiceId, preview);
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new Error("Cartesia returned empty audio.");
  return audio;
}
