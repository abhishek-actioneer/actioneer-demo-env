import type { VoiceCall, VoiceTranscriptTurn } from "./voice-campaign-types";
import { hasGeminiRealtimeTranscript, isGeminiRealtimeTurn, sortTranscriptTurns } from "./voice-transcript-sort";

function isLiveTestCall(call: TranscriptSourceCall): boolean {
  return call.tags?.some((tag) => tag.toLowerCase() === "live test") ||
    call.id.startsWith("live-test-");
}

function dialogueTurns(turns: VoiceTranscriptTurn[]): VoiceTranscriptTurn[] {
  return turns.filter((turn) => turn.role === "assistant" || turn.role === "user");
}

function sidecarTurns(transcript: VoiceTranscriptTurn[]): VoiceTranscriptTurn[] {
  return dialogueTurns(transcript).filter((turn) =>
    typeof turn.itemId === "string" &&
    (turn.itemId.startsWith("live-test:") || turn.itemId.startsWith("live-") || turn.itemId.startsWith("live_")),
  );
}

function geminiRealtimeTurns(transcript: VoiceTranscriptTurn[], callStartedAt?: string): VoiceTranscriptTurn[] {
  return sortTranscriptTurns(dialogueTurns(transcript).filter(isGeminiRealtimeTurn), { callStartedAt });
}

function legacyRealtimeTurns(transcript: VoiceTranscriptTurn[], callStartedAt?: string): VoiceTranscriptTurn[] {
  return sortTranscriptTurns(
    dialogueTurns(transcript).filter((turn) =>
      !(typeof turn.itemId === "string" && turn.itemId.includes("_split_")),
    ),
    { callStartedAt },
  );
}

export type TranscriptSourceCall = Pick<VoiceCall, "id" | "transcript" | "tags" | "startedAt">;

/** Canonical transcript for UI + analysis: Gemini realtime first, timestamp-sorted. */
export function selectDisplayTranscript(call: TranscriptSourceCall): VoiceTranscriptTurn[] {
  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  const callStartedAt = call.startedAt;
  const geminiRealtime = geminiRealtimeTurns(transcript, callStartedAt);
  if (geminiRealtime.length > 0) return geminiRealtime;

  if (isLiveTestCall(call)) {
    const sidecar = sidecarTurns(transcript);
    if (sidecar.length > 0) return sortTranscriptTurns(sidecar, { callStartedAt });
  }

  const realtime = legacyRealtimeTurns(transcript, callStartedAt);
  if (realtime.length > 0) return realtime;

  return sortTranscriptTurns(transcript.filter((turn) => turn.role !== "recording"), { callStartedAt });
}

export function shouldSkipRecordingDiarization(transcript: VoiceTranscriptTurn[] | undefined): boolean {
  return hasGeminiRealtimeTranscript(transcript);
}
