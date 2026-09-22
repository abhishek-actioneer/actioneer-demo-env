// On-demand single-call transcript loader. transcripts.jsonl is one JSON record
// per call (~1.6MB for 450 calls), so the deep-dive fetches one call's record
// by scanning lines rather than parsing the whole file into memory.

import { createReadStream, existsSync } from "fs";
import { createInterface } from "readline";
import { resolve, sep } from "path";
import { getVoiceStorageRoot } from "@/lib/voice-storage";

export interface VoiceTranscriptTurn {
  role: "assistant" | "user" | "recording";
  offsetSeconds: number;
  text: string;
  id: string;
  sequence?: number;
}

export interface VoiceCallTranscript {
  runId: string;
  call: {
    id: string;
    index: number;
    status: string;
    outcome: string;
    toNumber: string;
    phoneHash: string;
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
    engaged: boolean;
  };
  measurements: {
    turnCount: number;
    userTurnCount: number;
    assistantTurnCount: number;
    firstUserOffsetSeconds?: number;
    lastTurnOffsetSeconds?: number;
  };
  campaign?: { id: string; name: string; segmentName?: string; objective?: string; language?: string };
  transcript: VoiceTranscriptTurn[];
}

function transcriptPath(runId: string): string | undefined {
  const root = resolve(getVoiceStorageRoot(), "voice-simulation-runs");
  const path = resolve(root, runId, "transcripts.jsonl");
  if (path === root || !path.startsWith(`${root}${sep}`)) return undefined;
  return existsSync(path) ? path : undefined;
}

/** Mask a phone like +917000007919 → +9170•••••919 for display. */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.length < 7) return digits;
  return `${digits.slice(0, 5)}•••••${digits.slice(-3)}`;
}

export async function loadCallTranscript(
  runId: string,
  callId: string,
): Promise<VoiceCallTranscript | undefined> {
  const path = transcriptPath(runId);
  if (!path) return undefined;

  // Cheap pre-filter: the callId appears verbatim in its line, so skip lines
  // that can't match before paying for JSON.parse.
  const needle = `"${callId}"`;
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (!line.includes(needle)) continue;
      let record: VoiceCallTranscript;
      try {
        record = JSON.parse(line) as VoiceCallTranscript;
      } catch {
        continue;
      }
      if (record.call?.id === callId) return record;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return undefined;
}
