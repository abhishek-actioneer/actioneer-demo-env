import { DEFAULT_CARTESIA_VOICE_ID } from "@/lib/cartesia-voices";

const CARTESIA_TTS_BYTES_URL = "https://api.cartesia.ai/tts/bytes";
const CARTESIA_VERSION = "2026-03-01";
const DEFAULT_CARTESIA_MODEL = "sonic-3";

interface CartesiaTtsOptions {
  voiceId?: string;
  modelId?: string;
  speed?: number;
  emotion?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function cartesiaLanguageCode(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized === "english" || normalized === "en" || normalized === "en-in") return "en";
  if (normalized === "hindi" || normalized === "hinglish" || normalized === "hi" || normalized === "hi-in") {
    return "hi";
  }
  return "en";
}

function resolvedVoiceId(options?: CartesiaTtsOptions): string {
  return options?.voiceId || process.env.CARTESIA_VOICE_ID || DEFAULT_CARTESIA_VOICE_ID;
}

function resolvedModelId(options?: CartesiaTtsOptions): string {
  return options?.modelId || process.env.CARTESIA_MODEL_ID || DEFAULT_CARTESIA_MODEL;
}

export function ensureCartesiaConfig(): void {
  requireEnv("CARTESIA_API_KEY");
}

export async function synthesizeCartesiaMulaw(
  text: string,
  language: string,
  options: CartesiaTtsOptions = {},
): Promise<string> {
  ensureCartesiaConfig();

  const res = await fetch(CARTESIA_TTS_BYTES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("CARTESIA_API_KEY")}`,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: resolvedModelId(options),
      transcript: text,
      voice: {
        mode: "id",
        id: resolvedVoiceId(options),
      },
      output_format: {
        container: "raw",
        encoding: "pcm_mulaw",
        sample_rate: 8000,
      },
      language: cartesiaLanguageCode(language),
      save: false,
      generation_config: {
        volume: 1,
        speed: options.speed ?? Number(process.env.CARTESIA_TTS_SPEED || "1"),
        emotion: options.emotion || process.env.CARTESIA_TTS_EMOTION || "neutral",
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Cartesia TTS failed (${res.status}): ${errorText || res.statusText}`);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length === 0) throw new Error("Cartesia TTS response was empty");
  return audio.toString("base64");
}
