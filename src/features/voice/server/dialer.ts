import { activeVoiceCallProvider } from "./call-provider";
import { resolveVoiceDialerProvider } from "./dialer-provider";
import type { VoiceCallProvider } from "@/lib/voice-campaign-types";

export function ensureVoiceCallConfig(provider?: VoiceCallProvider): void {
  resolveVoiceDialerProvider(activeVoiceCallProvider(provider)).ensureConfig();
}

export async function prepareOpeningAudio(
  firstMessage: string,
  language: string,
  speaker?: string,
): Promise<string | undefined> {
  void firstMessage;
  void language;
  void speaker;
  return undefined;
}
