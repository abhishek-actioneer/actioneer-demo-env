import { WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { getCampaign, upsertCall } from "./voice-campaign-store";
import type { VoiceRecording, VoiceTranscriptTurn } from "./voice-campaign-types";
import { sanitizeFundsIndiaLiveTestPrompt } from "./voice-customer-context";
import { storeRecordingBytes } from "./voice-recording-storage";
import { recordingStorageKeyForScope } from "./voice-storage";
import {
  mergeIncrementalTranscript,
  stripUserCrosstalkFromAssistant,
} from "./plivo-gemini-live-transcript-guards";

const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const GEMINI_LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const DEFAULT_VOICE = process.env.GEMINI_LIVE_VOICE || "Aoede";

const TAG = "[voice-test]";
const log  = (...a: unknown[]) => console.log(TAG, ...a);
const err  = (...a: unknown[]) => console.error(TAG, ...a);
type TranscriptRole = "user" | "assistant";

interface LiveTestRecordingChunk {
  role: TranscriptRole;
  startSample: number;
  pcm: Buffer;
  samples: number;
}

const RECORDING_SAMPLE_RATE = 24000;
const MAX_RECORDING_SECONDS = 60 * 60;
const MAX_RECORDING_SAMPLES = RECORDING_SAMPLE_RATE * MAX_RECORDING_SECONDS;

function geminiApiKey(): string {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is not set");
  return key;
}

function isOpen(ws: WebSocket | undefined): ws is WebSocket {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

function socketCanClose(ws: WebSocket | undefined): boolean {
  return !!ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING;
}

function sendJson(ws: WebSocket | undefined, payload: unknown): void {
  if (!isOpen(ws)) { log("sendJson: ws not open, dropping"); return; }
  ws.send(JSON.stringify(payload), { compress: false });
}

function parseMessage(data: WebSocket.RawData): Record<string, unknown> | null {
  try { return JSON.parse(data.toString()) as Record<string, unknown>; }
  catch (e) { err("JSON parse failed:", e); return null; }
}

function objectValue(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

function stringValue(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function boolValue(v: unknown): boolean {
  return typeof v === "boolean" ? v : false;
}

function arrayValue(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((i): i is Record<string, unknown> => !!i && typeof i === "object") : [];
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, value));
}

function validBase64Pcm(data: string): Buffer | undefined {
  const normalized = data.replace(/\s/g, "");
  if (!normalized || normalized.length > 500_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return undefined;
  let pcm = Buffer.from(normalized, "base64");
  if (pcm.length % 2 === 1) pcm = pcm.subarray(0, pcm.length - 1);
  return pcm.length > 0 ? pcm : undefined;
}

function resamplePcm16(pcm: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return pcm;
  const inputSamples = Math.floor(pcm.length / 2);
  if (inputSamples <= 0 || fromRate <= 0 || toRate <= 0) return Buffer.alloc(0);

  const outputSamples = Math.max(1, Math.round(inputSamples * toRate / fromRate));
  const output = Buffer.alloc(outputSamples * 2);
  for (let i = 0; i < outputSamples; i += 1) {
    const sourcePosition = i * (fromRate / toRate);
    const lower = Math.floor(sourcePosition);
    const upper = Math.min(inputSamples - 1, lower + 1);
    const fraction = sourcePosition - lower;
    const lowerValue = pcm.readInt16LE(lower * 2);
    const upperValue = pcm.readInt16LE(upper * 2);
    output.writeInt16LE(clampInt16(Math.round(lowerValue + (upperValue - lowerValue) * fraction)), i * 2);
  }
  return output;
}

function writeStereoWav(pcm: Buffer): Buffer {
  const channels = 2;
  const bitsPerSample = 16;
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = RECORDING_SAMPLE_RATE * blockAlign;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(RECORDING_SAMPLE_RATE, 24);
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
    durationSeconds: Math.round(totalSamples / RECORDING_SAMPLE_RATE),
  };
}

function outputAudioRate(mimeType: string | undefined): number {
  const m = mimeType?.match(/rate=(\d+)/);
  return m ? Number(m[1]) || 24000 : 24000;
}

function extractModelAudio(event: Record<string, unknown>): Array<{ data: string; mimeType?: string }> {
  const sc = objectValue(event.serverContent);
  const mt = objectValue(sc?.modelTurn);
  const parts = arrayValue(mt?.parts);
  const audio: Array<{ data: string; mimeType?: string }> = [];
  for (const p of parts) {
    const id = objectValue(p.inlineData) ?? objectValue(p.inline_data);
    const data = stringValue(id?.data);
    if (data) audio.push({ data, mimeType: stringValue(id?.mimeType) ?? stringValue(id?.mime_type) });
  }
  return audio;
}

function transcriptionText(event: Record<string, unknown>, key: "inputTranscription" | "outputTranscription"): string | undefined {
  const sc = objectValue(event.serverContent);
  const t = objectValue(sc?.[key]);
  return stringValue(t?.text)?.trim();
}

export function handleVoiceTestStream(browserWs: WebSocket, req: IncomingMessage): void {
  log("browser connected", req.url ?? "");

  let geminiWs: WebSocket | undefined;
  let closed = false;
  let setupComplete = false;
  let systemPrompt = "";
  let firstMessage = "";
  let voiceName = DEFAULT_VOICE;
  let audioChunksSent = 0;
  let audioChunksReceived = 0;
  let campaignId: string | undefined;
  let liveTestCallId: string | undefined;
  let liveTestStartedAtMs = 0;
  let liveTestFinalized = false;
  let transcriptSequence = 0;
  const transcriptTurns: VoiceTranscriptTurn[] = [];
  const liveRecordingChunks: LiveTestRecordingChunk[] = [];
  /** After turnComplete/interrupt, force a new bubble even if role matches. */
  let forceNewTranscriptTurn = false;

  function createLiveTestCall(nextCampaignId: string | undefined): void {
    const cleanCampaignId = nextCampaignId?.trim();
    if (!cleanCampaignId || liveTestCallId) return;

    campaignId = cleanCampaignId;
    liveTestCallId = `live-test-${cleanCampaignId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    liveTestStartedAtMs = Date.now();
    upsertCall(cleanCampaignId, {
      id: liveTestCallId,
      toNumber: "Live test",
      provider: "plivo",
      callConfigId: liveTestCallId,
      providerRequestId: `gemini-browser-${liveTestCallId}`,
      status: "calling",
      engaged: false,
      summary: "Gemini browser live test",
      tags: ["live test"],
      transcript: [],
      startedAt: new Date(liveTestStartedAtMs).toISOString(),
    });
    log(`created live-test call log ${liveTestCallId}`);
  }

  function persistTranscriptTurn(role: "assistant" | "user", rawText: string): void {
    if (!campaignId || !liveTestCallId) return;
    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text) return;

    const last = transcriptTurns.at(-1);
    if (last?.role === role && !forceNewTranscriptTurn) {
      // Overlap-aware merge — Gemini often re-sends cumulative prefixes.
      last.text = mergeIncrementalTranscript(last.text, text);
      last.at = new Date().toISOString();
    } else {
      forceNewTranscriptTurn = false;
      let nextText = text;
      // If user speech leaked into the assistant channel, keep roles clean.
      if (role === "assistant") {
        const lastUser = [...transcriptTurns].reverse().find((t) => t.role === "user");
        if (lastUser) {
          nextText = stripUserCrosstalkFromAssistant(text, lastUser.text);
          if (!nextText.trim()) return;
        }
      }
      transcriptSequence += 1;
      transcriptTurns.push({
        id: `${liveTestCallId}-${transcriptSequence}`,
        role,
        text: nextText,
        at: new Date().toISOString(),
        itemId: `live-test:${liveTestCallId}:${transcriptSequence}`,
        sequence: transcriptSequence,
      });
    }

    upsertCall(campaignId, {
      id: liveTestCallId,
      provider: "plivo",
      status: setupComplete ? "connected" : "calling",
      transcript: [...transcriptTurns],
      summary: "Gemini browser live test in progress",
    });
  }

  function recordLiveTestAudio(role: TranscriptRole, base64Audio: string, sampleRate: number): void {
    if (!liveTestCallId || !liveTestStartedAtMs) return;
    const decoded = validBase64Pcm(base64Audio);
    if (!decoded) return;

    const sourceRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : RECORDING_SAMPLE_RATE;
    const pcm = resamplePcm16(decoded, sourceRate, RECORDING_SAMPLE_RATE);
    const samples = Math.floor(pcm.length / 2);
    if (samples <= 0) return;

    const chunkDurationMs = (samples / RECORDING_SAMPLE_RATE) * 1000;
    const startMs = Math.max(0, Date.now() - liveTestStartedAtMs - chunkDurationMs);
    const startSample = Math.floor((startMs / 1000) * RECORDING_SAMPLE_RATE);
    if (startSample >= MAX_RECORDING_SAMPLES) return;

    const storedSamples = Math.min(samples, MAX_RECORDING_SAMPLES - startSample);
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
    const startedIso = liveTestStartedAtMs ? new Date(liveTestStartedAtMs).toISOString() : undefined;

    try {
      const rendered = renderLiveTestRecording(liveRecordingChunks);
      if (!rendered) return undefined;

      const campaign = campaignId ? getCampaign(campaignId) : undefined;
      const storageKey = recordingStorageKeyForScope({
        userId: campaign?.userId,
        datasetId: campaign?.datasetId,
        campaignId,
      }, liveTestCallId, recordingSid, "wav");
      const stored = await storeRecordingBytes(storageKey, rendered.wav, "audio/wav");
      log(`stored Gemini live-test recording callId=${liveTestCallId} bytes=${rendered.wav.length}`);

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
      err("failed to store Gemini live-test recording", error);
      return {
        sid: recordingSid,
        status: "failed",
        source: "bridge",
        startedAt: startedIso,
        storedAt: new Date().toISOString(),
      };
    }
  }

  async function finalizeLiveTestCall(status: "completed" | "failed" = "completed", summary = "Gemini browser live test completed"): Promise<void> {
    if (!campaignId || !liveTestCallId || liveTestFinalized) return;
    liveTestFinalized = true;
    const durationSeconds = liveTestStartedAtMs
      ? Math.max(1, Math.round((Date.now() - liveTestStartedAtMs) / 1000))
      : undefined;

    const bridgeRecording = await persistLiveTestRecording();
    upsertCall(campaignId, {
      id: liveTestCallId,
      provider: "plivo",
      status,
      durationSeconds,
      engaged: Boolean(durationSeconds && durationSeconds >= 20),
      summary,
      transcript: [...transcriptTurns],
      ...(bridgeRecording ? { bridgeRecording } : {}),
      endedAt: new Date().toISOString(),
    });
  }

  function closeBoth(): void {
    if (closed) return;
    closed = true;
    log(`closing — audioSent=${audioChunksSent} audioReceived=${audioChunksReceived}`);
    void finalizeLiveTestCall();
    if (socketCanClose(geminiWs)) geminiWs?.close();
    if (socketCanClose(browserWs)) browserWs.close();
  }

  function sendToBrowser(payload: unknown): void {
    if (!isOpen(browserWs)) { log("sendToBrowser: browser WS not open"); return; }
    browserWs.send(JSON.stringify(payload));
  }

  function startGemini(): void {
    if (closed || geminiWs) { log("startGemini: skipped — closed=%s geminiWs=%s", closed, !!geminiWs); return; }
    let key: string;
    try { key = geminiApiKey(); }
    catch (e) {
      err("missing API key:", e);
      sendToBrowser({ type: "error", message: "Missing Gemini API key on server" });
      void finalizeLiveTestCall("failed", "Gemini browser live test failed: missing Gemini API key");
      closeBoth();
      return;
    }
    log(`opening Gemini WS model=${GEMINI_LIVE_MODEL} voice=${voiceName}`);

    geminiWs = new WebSocket(
      `${GEMINI_LIVE_URL}?key=${encodeURIComponent(key)}`,
      { perMessageDeflate: false, headers: { "x-goog-api-key": key } },
    );

    geminiWs.on("open", () => {
      log("Gemini WS open — sending setup");
      log(`system prompt length: ${systemPrompt.length} chars`);
      sendJson(geminiWs, {
        setup: {
          model: `models/${GEMINI_LIVE_MODEL}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            temperature: 0.85,
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
          systemInstruction: { parts: [{ text: systemPrompt }] },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
              endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
              prefixPaddingMs: 200,
              silenceDurationMs: 500,
            },
            activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
            turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY",
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: { slidingWindow: {} },
        },
      });
    });

    geminiWs.on("message", (data) => {
      const raw = data.toString();
      const event = parseMessage(data);
      if (!event) { err("unparseable Gemini message:", raw.slice(0, 200)); return; }

      // Log every message type except audio chunks (too noisy)
      const topKeys = Object.keys(event);
      if (!topKeys.includes("serverContent") || !objectValue(event.serverContent)?.modelTurn) {
        log("Gemini →", topKeys.join(","), raw.length > 200 ? `(${raw.length} bytes)` : raw.slice(0, 200));
      }

      if (event.error) {
        err("Gemini API error:", JSON.stringify(event.error));
        void finalizeLiveTestCall("failed", "Gemini browser live test failed: Gemini API error");
        sendToBrowser({ type: "error", message: `Gemini error: ${JSON.stringify(event.error)}` });
        return;
      }

      if (event.setupComplete) {
        setupComplete = true;
        log("setupComplete");
        if (campaignId && liveTestCallId) {
          upsertCall(campaignId, {
            id: liveTestCallId,
            provider: "plivo",
            status: "connected",
            summary: "Gemini browser live test connected",
          });
        }
        {
          const opening = firstMessage.trim();
          sendJson(geminiWs, {
            clientContent: {
              turns: [{
                role: "user",
                parts: [{
                  text: opening
                    ? `Say exactly this opening line and then wait for the customer. Do not add the reason for the call, the offer, or another question in this turn:\n${opening}`
                    : "The call has just connected. Begin the conversation now by greeting the customer and introducing yourself according to your instructions. Speak first; do not wait for the customer.",
                }],
              }],
              turnComplete: true,
            },
          });
        }
        sendToBrowser({ type: "ready" });
        return;
      }

      const sc = objectValue(event.serverContent);
      if (boolValue(sc?.interrupted)) {
        log("agent interrupted");
        forceNewTranscriptTurn = true;
        sendToBrowser({ type: "interrupted" });
      }

      const inputText = transcriptionText(event, "inputTranscription");
      if (inputText) {
        log(`👤 USER: "${inputText}"`);
        persistTranscriptTurn("user", inputText);
        sendToBrowser({ type: "transcript", role: "user", text: inputText });
      }

      const outputText = transcriptionText(event, "outputTranscription");
      if (outputText) {
        log(`🤖 AGENT: "${outputText}"`);
        persistTranscriptTurn("assistant", outputText);
        sendToBrowser({ type: "transcript", role: "assistant", text: outputText });
      }

      const audioChunks = extractModelAudio(event);
      for (const chunk of audioChunks) {
        audioChunksReceived++;
        const sampleRate = outputAudioRate(chunk.mimeType);
        recordLiveTestAudio("assistant", chunk.data, sampleRate);
        sendToBrowser({ type: "audio", data: chunk.data, sampleRate });
      }
      if (audioChunks.length > 0) log(`audio chunks received: ${audioChunksReceived} total`);

      if (boolValue(sc?.turnComplete)) {
        log("turn complete");
        forceNewTranscriptTurn = true;
        sendToBrowser({ type: "turn_complete" });
      }
    });

    geminiWs.on("error", (e) => {
      err("Gemini WS error:", e.message);
      void finalizeLiveTestCall("failed", `Gemini browser live test failed: ${e.message}`);
      sendToBrowser({ type: "error", message: `Gemini WS error: ${e.message}` });
    });
    geminiWs.on("close", (code, reason) => {
      log(`Gemini WS closed code=${code} reason=${reason.toString() || "(none)"}`);
      if (!closed) sendToBrowser({ type: "error", message: `Gemini disconnected (code ${code})` });
      closeBoth();
    });
  }

  browserWs.on("message", (data) => {
    const msg = parseMessage(data);
    if (!msg) { err("bad JSON from browser:", data.toString().slice(0, 100)); return; }

    if (msg.type === "start") {
      systemPrompt = stringValue(msg.systemPrompt) ?? "";
      firstMessage = stringValue(msg.firstMessage) ?? "";
      voiceName = stringValue(msg.voice) ?? DEFAULT_VOICE;
      createLiveTestCall(stringValue(msg.campaignId));
      const datasetId = stringValue(msg.datasetId);
      if (datasetId === "fundsindia") {
        systemPrompt = sanitizeFundsIndiaLiveTestPrompt(systemPrompt);
      }
      log(`start — voice=${voiceName} promptLen=${systemPrompt.length}`);
      startGemini();
      return;
    }

    if (msg.type === "audio") {
      if (!setupComplete) return; // drop audio before ready
      const audioData = stringValue(msg.data);
      if (!audioData) { err("audio message missing data"); return; }
      audioChunksSent++;
      if (audioChunksSent <= 3 || audioChunksSent % 50 === 0) log(`forwarding audio chunk #${audioChunksSent}`);
      recordLiveTestAudio("user", audioData, 16000);
      sendJson(geminiWs, {
        realtimeInput: { audio: { data: audioData, mimeType: "audio/pcm;rate=16000" } },
      });
      return;
    }

    if (msg.type === "stop") {
      log("stop received");
      sendJson(geminiWs, { realtimeInput: { audioStreamEnd: true } });
      setTimeout(closeBoth, 600);
    }
  });

  browserWs.on("error", (e) => {
    err("browser WS error:", e.message);
    void finalizeLiveTestCall("failed", `Gemini browser live test failed: ${e.message}`);
  });
  browserWs.on("close", (code) => { log(`browser disconnected code=${code}`); closeBoth(); });
}
