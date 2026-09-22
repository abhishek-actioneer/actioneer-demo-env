import { ensurePlivoConfig, initiatePlivoCall } from "./plivo-client";
import { ensureGeminiLiveConfig } from "./voice-agent-provider";

export function ensureVoiceCallConfig(): void {
  ensurePlivoConfig();
  ensureGeminiLiveConfig();
}

export async function initiateVoiceCall(toNumber: string, callId: string): Promise<string> {
  return initiatePlivoCall(toNumber, callId);
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
