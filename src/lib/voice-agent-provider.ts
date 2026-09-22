export type VoiceAgentProvider = "gemini-live";

export function activeVoiceAgentProvider(): VoiceAgentProvider {
  return "gemini-live";
}

export function ensureGeminiLiveConfig(): void {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is not set");
}
