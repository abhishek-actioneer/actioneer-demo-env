import type { VoiceCallProvider } from "@/lib/voice-campaign-types";

export const CALL_PROVIDER_OPTIONS: Array<{ id: VoiceCallProvider; label: string; description: string }> = [
  { id: "plivo-gemini", label: "Gemini", description: "Use the Gemini calling flow." },
];

export const MODEL_OPTIONS: Array<{ id: VoiceCallProvider; label: string }> = [
  { id: "plivo-gemini", label: "Gemini" },
];
