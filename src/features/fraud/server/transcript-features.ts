import type { VoiceTranscriptTurn } from "@/lib/voice-campaign-types";
import type { TranscriptFeatures } from "./analysis-service-client";

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function wordOverlap(a: string, b: string): number {
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const bWords = b.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (aWords.size === 0 || bWords.length === 0) return 0;
  return bWords.filter((w) => aWords.has(w)).length / bWords.length;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function mean(nums: number[]): number {
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

export function computeTranscriptFeatures(turns: VoiceTranscriptTurn[]): TranscriptFeatures {
  const agentTurns = turns.filter((turn) => turn.role === "assistant");
  const customerTurns = turns.filter((turn) => turn.role === "user");

  const onsets: number[] = [];
  const elaborationRatios: number[] = [];
  const echoScores: number[] = [];

  for (const agentTurn of agentTurns) {
    const agentAt = new Date(agentTurn.at).getTime();
    const response = customerTurns.find((turn) => new Date(turn.at).getTime() > agentAt);
    if (!response) continue;

    const gap = new Date(response.at).getTime() - agentAt;
    if (gap > 0 && gap < 10_000) onsets.push(gap);

    const agentWords = wordCount(agentTurn.text);
    const customerWords = wordCount(response.text);
    if (agentWords > 0) elaborationRatios.push(customerWords / agentWords);

    echoScores.push(wordOverlap(agentTurn.text, response.text));
  }

  return {
    voice_onset_ms: onsets.length > 0 ? median(onsets) : null,
    elaboration_ratio: elaborationRatios.length > 0 ? mean(elaborationRatios) : null,
    echo_score: echoScores.length > 0 ? mean(echoScores) : null,
  };
}
