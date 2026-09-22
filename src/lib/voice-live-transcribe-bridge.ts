import type { IncomingMessage } from "http";
import { WebSocket } from "ws";
import { appendCallTranscript, findCall, upsertCall } from "./voice-campaign-store";
import { storeRecordingBytes } from "./voice-recording-storage";
import { recordingStorageKeyForScope } from "./voice-storage";
import type { VoiceRecording, VoiceTranscriptTurn } from "./voice-campaign-types";

type TranscriptRole = "user" | "assistant";

interface RoleState {
  role: TranscriptRole;
  openaiWs?: WebSocket;
  ready: boolean;
  queuedAudio: Array<{ data: string; bytes: number }>;
  queuedBytes: number;
  pendingBytes: number;
  commitTimer?: ReturnType<typeof setTimeout>;
}

interface LiveTestRecordingChunk {
  role: TranscriptRole;
  startSample: number;
  pcm: Buffer;
  samples: number;
}

const TAG = "[voice-live-transcribe]";
const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";
const REALTIME_TRANSCRIBE_MODEL = process.env.VOICE_LIVE_TRANSCRIBE_MODEL || "gpt-realtime-whisper";
const REALTIME_TRANSCRIBE_DELAY = process.env.VOICE_LIVE_TRANSCRIBE_DELAY || "low";
const REALTIME_SAMPLE_RATE = 24000;
const COMMIT_MS = numberEnv("VOICE_LIVE_TRANSCRIBE_COMMIT_MS", 1200);
const MIN_COMMIT_MS = numberEnv("VOICE_LIVE_TRANSCRIBE_MIN_COMMIT_MS", 350);
const MAX_PENDING_MS = numberEnv("VOICE_LIVE_TRANSCRIBE_MAX_PENDING_MS", 2500);
const MAX_RECORDING_SECONDS = numberEnv("VOICE_LIVE_TEST_RECORDING_MAX_SECONDS", 60 * 60);
const MAX_RECORDING_SAMPLES = Math.floor(REALTIME_SAMPLE_RATE * MAX_RECORDING_SECONDS);
const MAX_QUEUE_BYTES = REALTIME_SAMPLE_RATE * 2 * 10;

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function log(...args: unknown[]): void {
  console.log(TAG, ...args);
}

function err(...args: unknown[]): void {
  console.error(TAG, ...args);
}

function isOpen(ws: WebSocket | undefined): ws is WebSocket {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

function sendJson(ws: WebSocket | undefined, payload: unknown): void {
  if (!isOpen(ws)) return;
  ws.send(JSON.stringify(payload), { compress: false });
}

function parseMessage(data: WebSocket.RawData): Record<string, unknown> | null {
  try {
    return JSON.parse(data.toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function roleValue(value: unknown): TranscriptRole | undefined {
  return value === "user" || value === "assistant" ? value : undefined;
}

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

function sameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function audioDurationMs(bytes: number): number {
  return Math.floor((bytes / 2 / REALTIME_SAMPLE_RATE) * 1000);
}

function pcmSampleCount(pcm: Buffer): number {
  return Math.floor(pcm.length / 2);
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, value));
}

function writeStereoWav(pcm: Buffer): Buffer {
  const channels = 2;
  const bitsPerSample = 16;
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = REALTIME_SAMPLE_RATE * blockAlign;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(REALTIME_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

function renderLiveTestRecording(chunks: LiveTestRecordingChunk[]): { wav: Buffer; durationSeconds: number } | undefined {
  let totalSamples = 0;
  for (const chunk of chunks) {
    totalSamples = Math.max(totalSamples, chunk.startSample + chunk.samples);
  }
  totalSamples = Math.min(totalSamples, MAX_RECORDING_SAMPLES);
  if (totalSamples <= 0) return undefined;

  const stereoPcm = Buffer.alloc(totalSamples * 2 * 2);
  for (const chunk of chunks) {
    const channelOffset = chunk.role === "assistant" ? 2 : 0;
    const writableSamples = Math.min(chunk.samples, totalSamples - chunk.startSample);
    for (let i = 0; i < writableSamples; i += 1) {
      const sourceOffset = i * 2;
      const targetOffset = (chunk.startSample + i) * 4 + channelOffset;
      const mixed = clampInt16(stereoPcm.readInt16LE(targetOffset) + chunk.pcm.readInt16LE(sourceOffset));
      stereoPcm.writeInt16LE(mixed, targetOffset);
    }
  }

  return {
    wav: writeStereoWav(stereoPcm),
    durationSeconds: Math.round(totalSamples / REALTIME_SAMPLE_RATE),
  };
}

function hasAudibleSignal(pcm: Buffer): boolean {
  if (pcm.length < 2) return false;
  let peak = 0;
  let sum = 0;
  const samples = Math.floor(pcm.length / 2);
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const sample = Math.abs(pcm.readInt16LE(offset));
    if (sample > peak) peak = sample;
    sum += sample;
  }
  const avg = sum / Math.max(1, samples);
  return peak >= 500 || avg >= 35;
}

function validBase64Pcm(data: string): Buffer | undefined {
  const normalized = data.replace(/\s/g, "");
  if (!normalized || normalized.length > 400_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    return undefined;
  }
  let pcm = Buffer.from(normalized, "base64");
  if (pcm.length % 2 === 1) pcm = pcm.subarray(0, pcm.length - 1);
  return pcm.length > 0 ? pcm : undefined;
}

function openRealtimeSocket(): WebSocket {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new WebSocket(`${OPENAI_REALTIME_URL}?intent=transcription`, {
    perMessageDeflate: false,
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });
}

function openaiErrorMessage(event: Record<string, unknown>): string {
  const error = objectValue(event.error);
  return stringValue(error?.message) || stringValue(error?.code) || JSON.stringify(event.error ?? event);
}

export function handleVoiceLiveTranscribeStream(browserWs: WebSocket, req: IncomingMessage): void {
  log("browser connected", req.url ?? "");

  if (!sameOriginRequest(req)) {
    sendJson(browserWs, { type: "error", message: "Cross-origin transcription socket rejected." });
    browserWs.close(1008, "cross-origin");
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    sendJson(browserWs, { type: "error", message: "OPENAI_API_KEY is missing on the server." });
    browserWs.close(1011, "missing-openai-key");
    return;
  }

  let closed = false;
  let language: string | undefined;
  let liveTestCallId: string | undefined;
  let startedAt = Date.now();
  let transcriptSequence = 0;
  let readySent = false;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let completedLogged = false;
  const liveRecordingChunks: LiveTestRecordingChunk[] = [];

  const roles: Record<TranscriptRole, RoleState> = {
    user: { role: "user", ready: false, queuedAudio: [], queuedBytes: 0, pendingBytes: 0 },
    assistant: { role: "assistant", ready: false, queuedAudio: [], queuedBytes: 0, pendingBytes: 0 },
  };

  function maybeSendReady(): void {
    if (readySent || !roles.user.ready || !roles.assistant.ready) return;
    readySent = true;
    sendJson(browserWs, {
      type: "ready",
      model: REALTIME_TRANSCRIBE_MODEL,
      sampleRate: REALTIME_SAMPLE_RATE,
    });
  }

  function commitRole(role: TranscriptRole, force = false): void {
    const state = roles[role];
    if (state.commitTimer) {
      clearTimeout(state.commitTimer);
      state.commitTimer = undefined;
    }
    if (!isOpen(state.openaiWs) || state.pendingBytes === 0) return;

    const pendingMs = audioDurationMs(state.pendingBytes);
    if (!force && pendingMs < MIN_COMMIT_MS) {
      state.commitTimer = setTimeout(() => commitRole(role), Math.max(100, MIN_COMMIT_MS - pendingMs));
      return;
    }

    sendJson(state.openaiWs, { type: "input_audio_buffer.commit" });
    state.pendingBytes = 0;
  }

  function scheduleCommit(role: TranscriptRole): void {
    const state = roles[role];
    if (audioDurationMs(state.pendingBytes) >= MAX_PENDING_MS) {
      commitRole(role);
      return;
    }
    if (!state.commitTimer) {
      state.commitTimer = setTimeout(() => commitRole(role), COMMIT_MS);
    }
  }

  function sendAudioToOpenAI(role: TranscriptRole, data: string, bytes: number): void {
    const state = roles[role];
    if (!state.ready || !isOpen(state.openaiWs)) {
      state.queuedAudio.push({ data, bytes });
      state.queuedBytes += bytes;
      while (state.queuedBytes > MAX_QUEUE_BYTES && state.queuedAudio.length > 0) {
        const dropped = state.queuedAudio.shift();
        state.queuedBytes -= dropped?.bytes ?? 0;
      }
      return;
    }

    sendJson(state.openaiWs, { type: "input_audio_buffer.append", audio: data });
    state.pendingBytes += bytes;
    scheduleCommit(role);
  }

  function flushQueuedAudio(role: TranscriptRole): void {
    const state = roles[role];
    const queued = state.queuedAudio;
    state.queuedAudio = [];
    state.queuedBytes = 0;
    for (const chunk of queued) {
      sendAudioToOpenAI(role, chunk.data, chunk.bytes);
    }
  }

  function closeOpenAI(role: TranscriptRole): void {
    const state = roles[role];
    if (state.commitTimer) {
      clearTimeout(state.commitTimer);
      state.commitTimer = undefined;
    }
    if (isOpen(state.openaiWs)) state.openaiWs.close();
    state.openaiWs = undefined;
    state.ready = false;
    state.queuedAudio = [];
    state.queuedBytes = 0;
    state.pendingBytes = 0;
  }

  function closeAllOpenAI(): void {
    closeOpenAI("user");
    closeOpenAI("assistant");
  }

  function finishAfterFinals(): void {
    if (finishTimer) return;
    finishTimer = setTimeout(() => {
      void completeLiveTestLog();
      sendJson(browserWs, { type: "done" });
      closeAllOpenAI();
      if (isOpen(browserWs)) browserWs.close(1000, "done");
    }, 6500);
  }

  async function completeLiveTestLog(): Promise<void> {
    if (completedLogged || !liveTestCallId) return;
    completedLogged = true;
    const found = findCall(liveTestCallId);
    if (!found) return;
    const endedAt = new Date().toISOString();
    const startedTime = found.call.startedAt ? new Date(found.call.startedAt).getTime() : startedAt;
    const durationSeconds = Math.max(0, Math.round((Date.now() - startedTime) / 1000));
    const bridgeRecording = await persistLiveTestRecording();
    upsertCall(found.campaign.id, {
      id: liveTestCallId,
      status: "completed",
      engaged: durationSeconds >= 20 || found.call.engaged,
      durationSeconds,
      endedAt,
      summary: "Browser live test transcript captured",
      tags: Array.from(new Set([...(found.call.tags ?? []), "live test"])),
      ...(bridgeRecording ? { bridgeRecording } : {}),
    });
  }

  function recordLiveTestAudio(role: TranscriptRole, pcm: Buffer): void {
    if (!liveTestCallId) return;
    const samples = pcmSampleCount(pcm);
    if (samples <= 0) return;

    const receivedAt = Date.now();
    const chunkDurationMs = audioDurationMs(pcm.length);
    const startMs = Math.max(0, receivedAt - startedAt - chunkDurationMs);
    const startSample = Math.floor((startMs / 1000) * REALTIME_SAMPLE_RATE);
    if (startSample >= MAX_RECORDING_SAMPLES) return;

    const maxSamples = MAX_RECORDING_SAMPLES - startSample;
    const storedSamples = Math.min(samples, maxSamples);
    if (storedSamples <= 0) return;

    liveRecordingChunks.push({
      role,
      startSample,
      pcm: Buffer.from(pcm.subarray(0, storedSamples * 2)),
      samples: storedSamples,
    });
  }

  async function persistLiveTestRecording(): Promise<VoiceRecording | undefined> {
    if (!liveTestCallId || liveRecordingChunks.length === 0) return undefined;
    const recordingSid = `bridge-${liveTestCallId}`;
    const startedIso = new Date(startedAt).toISOString();

    try {
      const rendered = renderLiveTestRecording(liveRecordingChunks);
      if (!rendered) return undefined;

      const found = findCall(liveTestCallId);
      const storageKey = recordingStorageKeyForScope({
        userId: found?.campaign.userId,
        datasetId: found?.campaign.datasetId,
        campaignId: found?.campaign.id,
      }, liveTestCallId, recordingSid, "wav");
      const stored = await storeRecordingBytes(storageKey, rendered.wav, "audio/wav");

      log(`stored live-test recording callId=${liveTestCallId} bytes=${rendered.wav.length}`);
      return {
        sid: recordingSid,
        status: "completed",
        source: "bridge",
        storageKey,
        recordingUri: stored.recordingUri,
        durationSeconds: rendered.durationSeconds,
        channels: 2,
        contentType: "audio/wav",
        sizeBytes: rendered.wav.length,
        startedAt: startedIso,
        storedAt: new Date().toISOString(),
      };
    } catch (error) {
      err("failed to store live-test recording", error);
      return {
        sid: recordingSid,
        status: "failed",
        source: "bridge",
        startedAt: startedIso,
        storedAt: new Date().toISOString(),
      };
    }
  }

  function persistTranscriptTurn(role: TranscriptRole, text: string, itemId: string | undefined): void {
    if (!liveTestCallId) return;
    const found = findCall(liveTestCallId);
    if (!found) return;
    transcriptSequence += 1;
    const sequence = transcriptSequence;
    const turn: VoiceTranscriptTurn = {
      id: `${liveTestCallId}_${role}_${itemId ?? sequence}`,
      role,
      text,
      at: new Date().toISOString(),
      itemId: `live-test:${itemId ?? sequence}`,
      sequence,
    };
    appendCallTranscript(found.campaign.id, liveTestCallId, turn);
  }

  function handleOpenAIMessage(role: TranscriptRole, data: WebSocket.RawData): void {
    const event = parseMessage(data);
    if (!event) return;

    if (event.type === "session.updated") {
      roles[role].ready = true;
      log(`OpenAI ${role} transcription session ready`);
      maybeSendReady();
      flushQueuedAudio(role);
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.delta") {
      const text = stringValue(event.delta);
      const itemId = stringValue(event.item_id);
      if (text && itemId) {
        sendJson(browserWs, {
          type: "transcript_delta",
          role,
          text,
          itemId,
          final: false,
          atMs: Date.now() - startedAt,
        });
      }
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const text = stringValue(event.transcript)?.replace(/\s+/g, " ").trim();
      const itemId = stringValue(event.item_id);
      if (text) {
        persistTranscriptTurn(role, text, itemId);
        sendJson(browserWs, {
          type: "transcript",
          role,
          text,
          itemId,
          final: true,
          atMs: Date.now() - startedAt,
        });
      }
      return;
    }

    if (event.type === "error" || event.error) {
      const message = openaiErrorMessage(event);
      err(`OpenAI ${role} transcription error:`, message);
      sendJson(browserWs, { type: "error", message: `${role} transcription error: ${message}` });
    }
  }

  function connectRole(role: TranscriptRole): void {
    let ws: WebSocket;
    try {
      ws = openRealtimeSocket();
    } catch (error) {
      sendJson(browserWs, {
        type: "error",
        message: error instanceof Error ? error.message : "Failed to open transcription session.",
      });
      return;
    }

    roles[role].openaiWs = ws;
    log(`opening OpenAI realtime transcription role=${role} model=${REALTIME_TRANSCRIBE_MODEL}`);

    ws.on("open", () => {
      const inputLanguage = languageCode(language);
      sendJson(ws, {
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE },
              transcription: {
                model: REALTIME_TRANSCRIBE_MODEL,
                ...(inputLanguage ? { language: inputLanguage } : {}),
                ...(REALTIME_TRANSCRIBE_MODEL.includes("realtime-whisper") && REALTIME_TRANSCRIBE_DELAY
                  ? { delay: REALTIME_TRANSCRIBE_DELAY }
                  : {}),
              },
              turn_detection: null,
            },
          },
        },
      });
    });

    ws.on("message", (data) => handleOpenAIMessage(role, data));
    ws.on("error", (error) => {
      err(`OpenAI ${role} websocket error`, error);
      sendJson(browserWs, {
        type: "error",
        message: `${role} transcription websocket failed.`,
      });
    });
    ws.on("close", (code, reason) => {
      roles[role].ready = false;
      log(`OpenAI ${role} websocket closed code=${code} reason=${reason.toString() || "(none)"}`);
      if (!closed && code !== 1000) {
        sendJson(browserWs, {
          type: "error",
          message: `${role} transcription disconnected (${code}).`,
        });
      }
    });
  }

  browserWs.on("message", (data) => {
    const msg = parseMessage(data);
    if (!msg) {
      sendJson(browserWs, { type: "error", message: "Invalid transcription message JSON." });
      return;
    }

    if (msg.type === "start") {
      startedAt = Date.now();
      language = typeof msg.language === "string" ? msg.language : undefined;
      liveTestCallId = typeof msg.liveTestCallId === "string" ? msg.liveTestCallId : undefined;
      connectRole("user");
      connectRole("assistant");
      return;
    }

    if (msg.type === "audio") {
      const role = roleValue(msg.role);
      const audio = typeof msg.data === "string" ? msg.data : "";
      const sampleRate = typeof msg.sampleRate === "number" ? msg.sampleRate : REALTIME_SAMPLE_RATE;
      if (!role || !audio) return;
      if (sampleRate !== REALTIME_SAMPLE_RATE) {
        sendJson(browserWs, {
          type: "error",
          message: `Live transcription expects ${REALTIME_SAMPLE_RATE}Hz PCM, got ${sampleRate}Hz.`,
        });
        return;
      }
      const pcm = validBase64Pcm(audio);
      if (!pcm || !hasAudibleSignal(pcm)) return;
      recordLiveTestAudio(role, pcm);
      sendAudioToOpenAI(role, audio, pcm.length);
      return;
    }

    if (msg.type === "flush") {
      const role = roleValue(msg.role);
      if (role) {
        commitRole(role, true);
      } else {
        commitRole("user", true);
        commitRole("assistant", true);
      }
      return;
    }

    if (msg.type === "stop") {
      commitRole("user", true);
      commitRole("assistant", true);
      finishAfterFinals();
    }
  });

  browserWs.on("close", (code, reason) => {
    closed = true;
    if (finishTimer) clearTimeout(finishTimer);
    void completeLiveTestLog();
    closeAllOpenAI();
    log(`browser closed code=${code} reason=${reason.toString() || "(none)"}`);
  });

  browserWs.on("error", (error) => {
    closed = true;
    if (finishTimer) clearTimeout(finishTimer);
    void completeLiveTestLog();
    closeAllOpenAI();
    err("browser websocket error", error);
  });
}
