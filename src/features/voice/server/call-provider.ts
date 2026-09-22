import type { VoiceCallProvider } from "@/lib/voice-campaign-types";

const DEFAULT_CALL_PROVIDER: VoiceCallProvider = "plivo-gemini";

export function normalizeVoiceCallProvider(value: string | null | undefined): VoiceCallProvider {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_CALL_PROVIDER;
  if (["mulberry", "mulberry-pipecat", "pipecat"].includes(normalized)) {
    return "mulberry-pipecat";
  }
  if (["plivo", "plivo-gemini", "gemini-live", "our-plivo"].includes(normalized)) {
    return "plivo-gemini";
  }
  return DEFAULT_CALL_PROVIDER;
}

export function activeVoiceCallProvider(override?: string | null): VoiceCallProvider {
  return normalizeVoiceCallProvider(override ?? process.env.VOICE_CALL_PROVIDER);
}

export function voiceCallProviderLabel(provider: VoiceCallProvider): string {
  switch (provider) {
    case "mulberry-pipecat":
      return "Mulberry";
    case "plivo-gemini":
    default:
      return "Actioneer Voice";
  }
}
