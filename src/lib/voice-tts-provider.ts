import { synthesizeCartesiaMulaw } from "./cartesia-tts-client";
import { DEFAULT_SARVAM_TTS_PACE, synthesizeSarvamMulaw } from "./sarvam-tts-client";

export type VoiceTtsProvider = "sarvam" | "cartesia";

export function activeVoiceTtsProvider(): VoiceTtsProvider {
  return process.env.VOICE_TTS_PROVIDER === "cartesia" ? "cartesia" : "sarvam";
}

export async function synthesizeVoiceMulaw(
  text: string,
  language: string,
  speaker?: string,
): Promise<string> {
  if (activeVoiceTtsProvider() === "cartesia") {
    return synthesizeCartesiaMulaw(text, language, { voiceId: speaker });
  }

  return synthesizeSarvamMulaw(text, language, speaker, {
    pace: DEFAULT_SARVAM_TTS_PACE,
  });
}
