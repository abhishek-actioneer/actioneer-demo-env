import { resolveSarvamSpeaker } from "@/lib/sarvam-voices";

const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";
export const DEFAULT_SARVAM_TTS_PACE = 1.06;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function ensureSarvamConfig(): void {
  requireEnv("SARVAM_API_KEY");
}

export function sarvamLanguageCode(language: string): "en-IN" | "hi-IN" {
  const normalized = language.trim().toLowerCase();
  return normalized === "english" || normalized === "en" || normalized === "en-in" ? "en-IN" : "hi-IN";
}

function prepareTextForSarvam(text: string): string {
  return text
    .replace(/^[-*]\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s*\.\.\.+\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

type SarvamAudioCodec = "mulaw" | "wav";

interface SarvamTtsOptions {
  speaker?: string;
  pace?: number;
  outputAudioCodec?: SarvamAudioCodec;
}

export async function synthesizeSarvamAudio(
  text: string,
  language: string,
  options: SarvamTtsOptions = {},
): Promise<string> {
  ensureSarvamConfig();
  const speaker = resolveSarvamSpeaker(options.speaker || process.env.SARVAM_TTS_SPEAKER);
  const pace = options.pace ?? Number(process.env.SARVAM_TTS_PACE || DEFAULT_SARVAM_TTS_PACE);
  const temperature = Number(process.env.SARVAM_TTS_TEMPERATURE || "0.7");
  const outputAudioCodec = options.outputAudioCodec ?? "mulaw";
  const spokenText = prepareTextForSarvam(text);

  const res = await fetch(SARVAM_TTS_URL, {
    method: "POST",
    headers: {
      "api-subscription-key": requireEnv("SARVAM_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: spokenText,
      target_language_code: sarvamLanguageCode(language),
      model: "bulbul:v3",
      speaker,
      pace,
      temperature,
      speech_sample_rate: 8000,
      output_audio_codec: outputAudioCodec,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Sarvam TTS failed (${res.status}): ${errorText || res.statusText}`);
  }

  const json = await res.json() as { audios?: unknown[] };
  const audio = json.audios?.[0];
  if (typeof audio !== "string" || !audio) {
    throw new Error("Sarvam TTS response did not include audio");
  }
  return audio;
}

export async function synthesizeSarvamMulaw(
  text: string,
  language: string,
  speaker?: string,
  options: Omit<SarvamTtsOptions, "speaker" | "outputAudioCodec"> = {},
): Promise<string> {
  return synthesizeSarvamAudio(text, language, {
    ...options,
    speaker,
    outputAudioCodec: "mulaw",
  });
}
