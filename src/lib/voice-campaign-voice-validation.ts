import type { VoiceCallProvider } from "./voice-campaign-types";
import { normalizeGeminiVoiceName } from "./gemini-voices";

export function canonicalizeCampaignVoice(
  voice: string,
  callProvider: VoiceCallProvider,
): string {
  void callProvider;
  const normalized = normalizeGeminiVoiceName(voice);
  if (!normalized) {
    throw new Error(
      `Invalid Gemini voice "${voice}". Use a canonical Gemini voice id (for example "Sulafat") or known display name (for example "Priya").`,
    );
  }
  return normalized;
}
