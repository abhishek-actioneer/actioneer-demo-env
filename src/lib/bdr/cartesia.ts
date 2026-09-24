export async function bdrSpeech(text: string, language: string, voiceId: string, preview = false): Promise<Buffer> {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) throw new Error("Cartesia is not configured.");
  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": "2026-08-14", "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: process.env.BDR_CARTESIA_MODEL || "sonic-3.6", transcript: text, voice: voiceId,
      language: language === "English" ? "en" : "hi",
      output_format: preview ? { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 } : { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 },
      generation_config: { speed: 1, volume: 1 },
    }),
  });
  if (!response.ok) throw new Error(`Cartesia speech generation failed (${response.status}). Check the voice ID, credits, and API key.`);
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new Error("Cartesia returned empty audio.");
  return audio;
}
