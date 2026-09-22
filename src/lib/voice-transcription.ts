import { createReadStream } from "fs";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { appendCallTranscript, appendCallTranscriptTurns, findCall } from "./voice-campaign-store";
import { shouldSkipRecordingDiarization } from "./voice-transcript-display";
import { getOpenAI } from "./openai-client";
import { readRecordingBytes } from "./voice-recording-storage";
import { maybeSendPostCallFollowUp } from "./voice-followup-sms";
import { emitVoiceLifecycle } from "./voice-events";
import type { VoiceTranscriptTurn } from "./voice-campaign-types";

const SAMPLE_RATE = 8000;

function languageCode(language: string | undefined): string | undefined {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return undefined;
  const codes: Record<string, string> = {
    english: "en",
    hinglish: "hi",
    hindi: "hi",
    spanish: "es",
    french: "fr",
    german: "de",
    italian: "it",
    portuguese: "pt",
  };
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  return codes[normalized];
}

function transcriptionPrompt(language: string | undefined): string {
  const languageHint = language?.trim() || "the call language";
  return [
    `This is an Indian outbound phone call in ${languageHint}.`,
    "The topic is a customer support, EMI, payment, loan, or campaign follow-up.",
    "Preserve Hindi/Hinglish wording where spoken. Do not invent idioms, poetic phrases, or unrelated English phrases.",
  ].join(" ");
}

function decodeMuLawSample(sample: number): number {
  const value = ~sample & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let decoded = ((mantissa << 3) + 0x84) << exponent;
  decoded -= 0x84;
  return sign ? -decoded : decoded;
}

function monoWavFromPcmu(frames: Buffer[]): Buffer {
  const audio = Buffer.concat(frames);
  const pcm = Buffer.alloc(audio.length * 2);
  for (let i = 0; i < audio.length; i += 1) {
    pcm.writeInt16LE(decodeMuLawSample(audio[i]), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export async function transcribePcmuFrames(frames: Buffer[], language?: string): Promise<string> {
  if (frames.length === 0) return "";
  const dir = mkdtempSync(join(tmpdir(), "actioneer-voice-turn-"));
  const path = join(dir, "turn.wav");

  try {
    writeFileSync(path, monoWavFromPcmu(frames));
    const transcript = await getOpenAI().audio.transcriptions.create({
      file: createReadStream(path),
      model: "gpt-4o-mini-transcribe",
      ...(language ? { language } : {}),
    });
    return transcript.text?.trim() ?? "";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface DiarizedTurn {
  role: "assistant" | "user";
  text: string;
}

function storedDialogueTurns(turns: VoiceTranscriptTurn[] | undefined): VoiceTranscriptTurn[] {
  return (turns ?? []).filter((turn) =>
    (turn.role === "assistant" || turn.role === "user") &&
    !(typeof turn.itemId === "string" && turn.itemId.includes("_split_"))
  );
}

function parseDiarizedTurns(raw: string): DiarizedTurn[] {
  const parsed = JSON.parse(raw) as { turns?: Array<{ role?: string; text?: string }> };
  return (parsed.turns ?? [])
    .map((turn) => ({
      role: turn.role === "user" ? "user" as const : "assistant" as const,
      text: typeof turn.text === "string" ? turn.text.trim() : "",
    }))
    .filter((turn) => turn.text.length > 0);
}

export async function diarizeTranscriptText(text: string): Promise<DiarizedTurn[]> {
  const completion = await getOpenAI().chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-5.4",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "Split an outbound phone-call transcript into ordered chat turns.",
          "Return only JSON with a turns array.",
          "Use role assistant for the sales/loan agent, and role user for the customer.",
          "Do not summarize, translate, add facts, or remove content.",
          "Keep the original language and wording as much as possible.",
          "If the speaker changes mid-sentence, split into separate turns.",
          "Never merge multiple agent questions or monologue segments into one assistant turn.",
          "When the agent greets, asks permission, then asks a follow-up question, emit separate assistant turns.",
          "Schema: {\"turns\":[{\"role\":\"assistant\"|\"user\",\"text\":\"...\"}]}",
        ].join("\n"),
      },
      {
        role: "user",
        content: text,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Transcript diarization returned empty content");
  return parseDiarizedTurns(content);
}

export async function diarizeStoredCallTranscript(callId: string, recordingSid?: string): Promise<VoiceTranscriptTurn[]> {
  const found = findCall(callId);
  if (!found) throw new Error("Call not found");

  const recordingTurn = found.call.transcript?.find((turn) =>
    turn.role === "recording" && (!recordingSid || turn.itemId === recordingSid)
  );
  if (!recordingTurn) throw new Error("Full-call transcript not found");

  const diarized = await diarizeTranscriptText(recordingTurn.text);
  const now = new Date().toISOString();
  const turns: VoiceTranscriptTurn[] = diarized.map((turn, index) => ({
    id: `${callId}_${recordingTurn.itemId ?? "recording"}_split_${index}`,
    role: turn.role,
    text: turn.text,
    at: now,
    itemId: `${recordingTurn.itemId ?? "recording"}_split_${index}`,
    sequence: index + 1,
  }));

  appendCallTranscriptTurns(found.campaign.id, callId, turns);
  const sourceRecordingSid = recordingSid ?? recordingTurn.itemId;
  if (sourceRecordingSid) {
    await maybeSendPostCallFollowUp(callId, sourceRecordingSid, turns).catch((err) => {
      console.error("[voice/transcription] Failed to process post-call follow-up:", err);
    });
  }
  return turns;
}

export async function transcribeStoredCallRecording(callId: string, recordingSid: string): Promise<string> {
  const found = findCall(callId);
  const recording = found?.call.bridgeRecording?.sid === recordingSid
    ? found.call.bridgeRecording
    : found?.call.recording;
  if (!found || !recording?.storageKey || recording.sid !== recordingSid) {
    throw new Error("Stored recording not found");
  }

  if (shouldSkipRecordingDiarization(found.call.transcript)) {
    console.log(
      `[voice/transcription] skipping post-call recording transcript callId=${callId} (Gemini realtime transcript present)`,
    );
    // Skipping re-transcription must NOT skip the follow-up. Every Gemini Live
    // call lands here, so returning early without this left the post-call
    // WhatsApp message unsent for the entire realtime pipeline.
    const realtimeTurns = storedDialogueTurns(found.call.transcript);
    if (realtimeTurns.length > 0) {
      await maybeSendPostCallFollowUp(callId, recordingSid, realtimeTurns).catch((err) => {
        console.error("[voice/transcription] Failed to process realtime transcript follow-up:", err);
      });
    }
    return "";
  }

  // U5: emit exactly one `voice_transcript_finalized` (openai_postcall) on
  // successful completion. This path runs ONLY when there is no realtime
  // transcript (skip-when-realtime early-return above) — the exact inverse of
  // U2's gemini_inline finalize, so exactly one finalize fires per call_id.
  // trigger_to_transcript_ms is derived from the durable per-call triggeredAtMs
  // (U3); if absent, emit null rather than a created-at-derived substitute.
  let finalizeEmitted = false;
  const finalizeOpenAI = (t: string): string => {
    if (!finalizeEmitted) {
      finalizeEmitted = true;
      const triggeredAtMs = found.call.triggeredAtMs;
      emitVoiceLifecycle(
        "voice_transcript_finalized",
        {
          transcript_source: "openai_postcall",
          trigger_to_transcript_ms: typeof triggeredAtMs === "number" ? Date.now() - triggeredAtMs : null,
        },
        callId,
        "gemini_live",
      );
    }
    return t;
  };

  const dir = mkdtempSync(join(tmpdir(), "actioneer-voice-recording-"));
  const extension = recording.contentType?.includes("wav") ? "wav" : "mp3";
  const path = join(dir, `recording.${extension}`);
  try {
    const { bytes } = await readRecordingBytes(recording.storageKey);
    writeFileSync(path, bytes);

    const transcript = await getOpenAI().audio.transcriptions.create({
      file: createReadStream(path),
      model: "gpt-4o-mini-transcribe",
      ...(languageCode(found.campaign.language) ? { language: languageCode(found.campaign.language) } : {}),
      prompt: transcriptionPrompt(found.campaign.language),
    });

    const text = transcript.text?.trim();
    if (!text) throw new Error("Transcription returned empty text");

    appendCallTranscript(found.campaign.id, callId, {
      id: `${callId}_${recordingSid}_recording`,
      role: "recording",
      text,
      at: new Date().toISOString(),
      itemId: recordingSid,
      sequence: 10_000,
    });

    if (process.env.VOICE_POST_CALL_DIARIZE === "0") {
      return finalizeOpenAI(text);
    }

    try {
      await diarizeStoredCallTranscript(callId, recordingSid);
      return finalizeOpenAI(text);
    } catch (err) {
      console.error("[voice/transcription] Failed to diarize full-call transcript:", err);
    }

    const refreshed = findCall(callId) ?? found;
    const realtimeTurns = storedDialogueTurns(refreshed.call.transcript);
    if (realtimeTurns.length > 0) {
      await maybeSendPostCallFollowUp(callId, recordingSid, realtimeTurns).catch((smsErr) => {
        console.error("[voice/transcription] Failed to process realtime transcript follow-up:", smsErr);
      });
    }

    return finalizeOpenAI(text);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
