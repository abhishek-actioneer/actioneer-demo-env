import { parse } from "url";
import { WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { resolveCallConfig } from "./voice-call-config-resolver";
import { removeCallConfig } from "./voice-call-state";
import { appendCallTranscript, upsertCall } from "./voice-campaign-store";
import { createVoiceBridgeRecorder, type VoiceBridgeRecorder } from "./voice-bridge-recorder";
import { transcribePcmuFrames } from "./voice-transcription";
import { activeVoiceTtsProvider, synthesizeVoiceMulaw } from "./voice-tts-provider";
import {
  deriveTurnLatencies,
  emitVoiceLifecycle,
  emitVoiceTurn,
  makeSpeechId,
} from "./voice-events";

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;
const STORE_REALTIME_TRANSCRIPT = process.env.VOICE_STORE_REALTIME_TRANSCRIPT === "1";

function getOpenAiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

function isOpen(ws: WebSocket): boolean {
  return ws.readyState === WebSocket.OPEN;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (isOpen(ws)) ws.send(JSON.stringify(payload), { compress: false });
}

function parseEvent(data: WebSocket.RawData): Record<string, unknown> | null {
  try {
    return JSON.parse(data.toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function objectValue(event: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = event[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function arrayValue(event: Record<string, unknown>, key: string): Record<string, unknown>[] | undefined {
  const value = event[key];
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => {
    return !!item && typeof item === "object" && !Array.isArray(item);
  }) : undefined;
}

function eventString(event: Record<string, unknown>, key: string): string | undefined {
  const value = event[key];
  return typeof value === "string" ? value : undefined;
}

function eventNumber(event: Record<string, unknown>, key: string): number | undefined {
  const value = event[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function eventType(event: Record<string, unknown>): string {
  return typeof event.type === "string" ? event.type : "";
}

function wordMatches(text: string): RegExpMatchArray[] {
  return Array.from(text.matchAll(/\S+\s*/g));
}

function trimSpokenChunk(text: string): string {
  return text
    .replace(/^[-*\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function takeSpeechChunks(buffer: string, force = false): { chunks: string[]; remainder: string } {
  const chunks: string[] = [];
  let remainder = buffer.trimStart();

  while (remainder) {
    let boundaryEnd = -1;
    for (let index = 0; index < remainder.length; index += 1) {
      if (!/[.!?।,;:]/.test(remainder[index])) continue;
      if (remainder.slice(0, index).trim().split(/\s+/).filter(Boolean).length < 2) continue;
      boundaryEnd = index + 1;
      break;
    }

    if (boundaryEnd > -1) {
      const chunk = trimSpokenChunk(remainder.slice(0, boundaryEnd));
      if (chunk) chunks.push(chunk);
      remainder = remainder.slice(boundaryEnd).trimStart();
      continue;
    }

    const words = wordMatches(remainder);
    if (!force && words.length >= 9) {
      const chunkEnd = words.slice(0, 8).reduce((length, match) => length + match[0].length, 0);
      const chunk = trimSpokenChunk(remainder.slice(0, chunkEnd));
      if (chunk) chunks.push(chunk);
      remainder = remainder.slice(chunkEnd).trimStart();
      continue;
    }

    if (force) {
      const chunk = trimSpokenChunk(remainder);
      if (chunk) chunks.push(chunk);
      remainder = "";
    }

    break;
  }

  return { chunks, remainder };
}

function languageCode(language: string): string | undefined {
  const normalized = language.trim().toLowerCase();
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

function openRealtimeSocket(): WebSocket {
  return new WebSocket(REALTIME_URL, {
    perMessageDeflate: false,
    headers: { Authorization: `Bearer ${getOpenAiKey()}` },
  });
}

function callIdFromRequest(req: IncomingMessage): string {
  const { pathname, query } = parse(req.url || "", true);
  if (typeof query.callId === "string") return query.callId;
  const match = pathname?.match(/^\/(?:api\/voice\/plivo-ws|plivo-media-stream)\/([^/?#]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function handlePlivoMediaStream(plivoWs: WebSocket, req: IncomingMessage): void {
  console.log(`[voice/plivo] Media stream connected url=${req.url ?? ""}`);
  const callId = callIdFromRequest(req);
  const callConfig = callId ? resolveCallConfig(callId) : undefined;
  const connectedAt = Date.now();

  let streamId: string | undefined;
  let currentCallUuid: string | undefined;
  let latestTimestamp = 0;
  let lastAssistantItemId: string | undefined;
  let activeResponseId: string | undefined;
  let closed = false;
  let openAiWs: WebSocket | undefined;
  let transcriptSequence = 0;
  let speechEpoch = 0;
  let bridgeRecorder: VoiceBridgeRecorder | undefined;
  let activeUserSpeech: { itemId?: string; frames: Buffer[] } | undefined;
  let assistantTextBuffer = "";
  let assistantTranscriptText = "";
  let assistantTranscriptRecorded = false;
  let assistantItemId: string | undefined;
  let assistantResponseId: string | undefined;
  let ttsSequence = 0;
  let nextTtsSequenceToPlay = 0;
  let outboundCursorSynced = false;
  const pendingTtsChunks = new Map<number, { payload: string; text: string }>();
  const rollingInboundFrames: Array<{ timestampMs: number; audio: Buffer }> = [];

  // ── U4: additive voice-observability locals (sarvam_cascaded parity, R7).
  //    DORMANT bridge — instrumented for schema parity, typecheck-verified only
  //    (A-R7). No speech-gated VAD → raw-frame EOU proxy; stream-relative offsets.
  let srVoiceTurnIndex = 0;
  let srEouMs: number | null = null;
  let srModelStartMs: number | undefined;
  let srFirstAudioMs: number | undefined;
  let srInterrupted = false;
  const srOffset = (): number => Date.now() - connectedAt;
  function srFlushVoiceTurn(): void {
    if (!callId) return;
    const d = deriveTurnLatencies(srEouMs, srModelStartMs ?? null, srFirstAudioMs ?? null, srOffset());
    emitVoiceTurn(
      {
        speech_id: makeSpeechId(callId, srVoiceTurnIndex),
        turn_index: srVoiceTurnIndex,
        eou_proxy_ms: d.eou_proxy_ms,
        eou_source: "raw_frame_proxy",
        voice_to_voice_ms: d.voice_to_voice_ms,
        detection_think_ms: d.detection_think_ms,
        response_lag_ms: d.response_lag_ms,
        total_turn_ms: d.total_turn_ms,
        interrupted: srInterrupted,
      },
      callId,
      "sarvam_cascaded",
    );
    srVoiceTurnIndex += 1;
    srModelStartMs = undefined;
    srFirstAudioMs = undefined;
    srInterrupted = false;
  }

  function socketCanClose(ws: WebSocket | undefined): boolean {
    return !!ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING;
  }

  function closeBoth(): void {
    if (closed) return;
    closed = true;
    // U4: transcript-finalized lifecycle event (realtime_inline), parity with U2.
    if (callId) {
      const triggeredAtMs = callConfig?.triggeredAtMs;
      emitVoiceLifecycle(
        "voice_transcript_finalized",
        {
          transcript_source: "realtime_inline",
          trigger_to_transcript_ms: typeof triggeredAtMs === "number" ? Date.now() - triggeredAtMs : null,
        },
        callId,
        "sarvam_cascaded",
      );
    }
    bridgeRecorder?.finalize();
    if (callId) removeCallConfig(callId);
    if (socketCanClose(openAiWs)) openAiWs?.close();
    if (socketCanClose(plivoWs)) plivoWs.close();
  }

  function sendPlivoJson(payload: Record<string, unknown>): void {
    if (!isOpen(plivoWs)) return;
    plivoWs.send(JSON.stringify(payload), { compress: false, binary: false, fin: true }, (err) => {
      if (err) console.error("[voice/plivo] send failed:", err);
    });
  }

  function playPlivoMulaw(payload: string): void {
    sendPlivoJson({
      event: "playAudio",
      media: {
        contentType: "audio/x-mulaw",
        sampleRate: 8000,
        payload,
      },
    });
    bridgeRecorder?.recordOutbound(payload);
  }

  function clearPlivoAudio(): void {
    speechEpoch += 1;
    resetAssistantSpeechState();
    sendPlivoJson({
      event: "clearAudio",
      ...(streamId ? { streamId } : {}),
    });
  }

  function resetAssistantSpeechState(): void {
    assistantTextBuffer = "";
    assistantTranscriptText = "";
    assistantTranscriptRecorded = false;
    assistantItemId = undefined;
    assistantResponseId = undefined;
    ttsSequence = 0;
    nextTtsSequenceToPlay = 0;
    outboundCursorSynced = false;
    pendingTtsChunks.clear();
  }

  function playReadyTtsChunks(): void {
    while (pendingTtsChunks.has(nextTtsSequenceToPlay)) {
      const chunk = pendingTtsChunks.get(nextTtsSequenceToPlay);
      if (!chunk) return;
      pendingTtsChunks.delete(nextTtsSequenceToPlay);
      nextTtsSequenceToPlay += 1;
      if (!outboundCursorSynced) {
        bridgeRecorder?.syncOutboundCursor(latestTimestamp);
        outboundCursorSynced = true;
      }
      playPlivoMulaw(chunk.payload);
    }
  }

  function queueTtsChunk(text: string, label = "chunk"): void {
    if (!callConfig || closed) return;
    const chunk = trimSpokenChunk(text);
    if (!chunk) return;

    const sequence = ttsSequence;
    ttsSequence += 1;
    const generation = speechEpoch;
    const startedAt = Date.now();

    void synthesizeVoiceMulaw(chunk, callConfig.language, callConfig.voice)
      .then((payload) => {
        if (closed || generation !== speechEpoch) {
          console.log(`[voice/plivo] ${activeVoiceTtsProvider()} ${label} skipped after interruption`);
          return;
        }
        pendingTtsChunks.set(sequence, { payload, text: chunk });
        console.log(
          `[voice/plivo] ${activeVoiceTtsProvider()} ${label} ready seq=${sequence} synth=${Date.now() - startedAt}ms chars=${chunk.length}`,
        );
        playReadyTtsChunks();
      })
      .catch((err) => console.error(`[voice/plivo] ${activeVoiceTtsProvider()} ${label} failed:`, err));
  }

  function flushAssistantTextBuffer(force = false): void {
    const result = takeSpeechChunks(assistantTextBuffer, force);
    assistantTextBuffer = result.remainder;
    for (const chunk of result.chunks) queueTtsChunk(chunk);
  }

  function appendAssistantText(delta: string | undefined, itemId?: string, responseId?: string): void {
    if (!delta) return;
    assistantItemId = itemId ?? assistantItemId;
    assistantResponseId = responseId ?? assistantResponseId;
    assistantTextBuffer += delta;
    assistantTranscriptText += delta;
    flushAssistantTextBuffer(false);
  }

  function finalizeAssistantText(
    text: string | undefined,
    itemId?: string,
    responseId?: string,
  ): void {
    assistantItemId = itemId ?? assistantItemId;
    assistantResponseId = responseId ?? assistantResponseId;
    if (!assistantTranscriptText.trim() && text) {
      assistantTextBuffer += text;
      assistantTranscriptText = text;
    }
    flushAssistantTextBuffer(true);

    const transcriptText = (text || assistantTranscriptText).trim();
    if (!assistantTranscriptRecorded && transcriptText) {
      assistantTranscriptRecorded = true;
      recordTranscriptTurn("assistant", transcriptText, assistantItemId, assistantResponseId);
    }
  }

  function recordTranscriptTurn(
    role: "assistant" | "user",
    text: string | undefined,
    itemId?: string,
    responseId?: string,
  ): void {
    if (!STORE_REALTIME_TRANSCRIPT) return;
    if (!callConfig || !currentCallUuid) return;
    const trimmed = text?.trim();
    if (!trimmed) return;
    transcriptSequence += 1;
    appendCallTranscript(callConfig.campaignId, currentCallUuid, {
      id: `${currentCallUuid}_${itemId ?? role}_${transcriptSequence}`,
      role,
      text: trimmed,
      at: new Date().toISOString(),
      itemId,
      responseId,
      sequence: transcriptSequence,
    });
  }

  function rememberInboundFrame(timestampMs: number, payload: string): Buffer {
    const audio = Buffer.from(payload, "base64");
    rollingInboundFrames.push({ timestampMs, audio });
    const minTimestamp = timestampMs - 1500;
    while (rollingInboundFrames.length > 0 && rollingInboundFrames[0].timestampMs < minTimestamp) {
      rollingInboundFrames.shift();
    }
    if (activeUserSpeech) activeUserSpeech.frames.push(audio);
    return audio;
  }

  function startUserSpeech(itemId: string | undefined, audioStartMs: number | undefined): void {
    const startMs = audioStartMs ?? latestTimestamp;
    activeUserSpeech = {
      itemId,
      frames: rollingInboundFrames
        .filter((frame) => frame.timestampMs >= startMs - 500)
        .map((frame) => frame.audio),
    };
  }

  function finishUserSpeech(itemId: string | undefined): void {
    const speech = activeUserSpeech;
    activeUserSpeech = undefined;
    if (!STORE_REALTIME_TRANSCRIPT) return;
    if (!speech || speech.frames.length === 0 || !callConfig || !currentCallUuid) return;
    const campaignId = callConfig.campaignId;
    const callUuid = currentCallUuid;
    const inputLanguage = languageCode(callConfig.language);
    void transcribePcmuFrames(speech.frames, inputLanguage)
      .then((text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        transcriptSequence += 1;
        appendCallTranscript(campaignId, callUuid, {
          id: `${callUuid}_${itemId ?? speech.itemId ?? "user-audio"}_${transcriptSequence}`,
          role: "user",
          text: trimmed,
          at: new Date().toISOString(),
          itemId: itemId ?? speech.itemId,
          sequence: transcriptSequence,
        });
      })
      .catch((err) => console.error("[voice/plivo] User utterance transcription failed:", err));
  }

  function startRealtime(): void {
    if (closed || openAiWs || !callConfig) return;
    openAiWs = openRealtimeSocket();
    console.log(`[voice/plivo] Opening OpenAI Realtime WS model=${REALTIME_MODEL} t=+${Date.now() - connectedAt}ms`);

    openAiWs.on("open", () => {
      if (closed || !callConfig || !openAiWs || !isOpen(plivoWs)) {
        closeBoth();
        return;
      }
      const inputLanguage = languageCode(callConfig.language);
      sendJson(openAiWs, {
        type: "session.update",
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: `${callConfig.systemPrompt}

Runtime context:
- The greeting has already been spoken.
- Do not greet again.
- Stay in ${callConfig.language}.
- Return only the next spoken line.`,
          output_modalities: ["text"],
          audio: {
            input: {
              format: { type: "audio/pcmu" },
              ...(STORE_REALTIME_TRANSCRIPT ? {
                transcription: {
                  model: "gpt-4o-mini-transcribe",
                  ...(inputLanguage ? { language: inputLanguage } : {}),
                },
              } : {}),
              turn_detection: {
                type: "server_vad",
                threshold: 0.6,
                silence_duration_ms: 250,
                prefix_padding_ms: 100,
              },
            },
          },
        },
      });
    });

    openAiWs.on("message", (data) => {
      if (!openAiWs) return;
      const event = parseEvent(data);
      if (!event) return;
      const type = eventType(event);

      if (type === "error") {
        console.error("[voice/plivo] OpenAI error:", JSON.stringify(event));
        return;
      }

      if (type === "session.updated") {
        console.log(`[voice/plivo] OpenAI session updated t=+${Date.now() - connectedAt}ms`);
        if (callId) emitVoiceLifecycle("voice_setup_complete", { prewarmed: null }, callId, "sarvam_cascaded");
        return;
      }

      if (type === "response.created") {
        resetAssistantSpeechState();
        const response = objectValue(event, "response");
        activeResponseId = response ? eventString(response, "id") : undefined;
        assistantResponseId = activeResponseId;
        if (srModelStartMs === undefined) srModelStartMs = srOffset(); // U4: model-start anchor
        return;
      }

      if (type === "response.done") {
        finalizeAssistantText(undefined);
        activeResponseId = undefined;
        srFlushVoiceTurn(); // U4: emit one voice_turn at the response boundary
        return;
      }

      if (type === "response.output_item.created") {
        const item = event.item as Record<string, unknown> | undefined;
        if (item && item.role === "assistant" && typeof item.id === "string") {
          lastAssistantItemId = item.id;
          assistantItemId = item.id;
        }
        return;
      }

      if (type === "response.output_text.delta" || type === "response.text.delta") {
        if (srFirstAudioMs === undefined) srFirstAudioMs = srOffset(); // U4: first output anchor
        lastAssistantItemId = eventString(event, "item_id") ?? lastAssistantItemId;
        appendAssistantText(
          eventString(event, "delta") ?? eventString(event, "text"),
          eventString(event, "item_id") ?? lastAssistantItemId,
          eventString(event, "response_id") ?? activeResponseId,
        );
        return;
      }

      if (type === "response.output_text.done") {
        lastAssistantItemId = eventString(event, "item_id") ?? lastAssistantItemId;
        finalizeAssistantText(
          eventString(event, "text"),
          eventString(event, "item_id"),
          eventString(event, "response_id"),
        );
        return;
      }

      if (type === "conversation.item.input_audio_transcription.completed") {
        recordTranscriptTurn("user", eventString(event, "transcript"), eventString(event, "item_id"));
        return;
      }

      if (type === "conversation.item.done") {
        const item = objectValue(event, "item");
        const role = item ? eventString(item, "role") : undefined;
        const itemId = item ? eventString(item, "id") : undefined;
        const content = item ? arrayValue(item, "content") : undefined;
        const text = content
          ?.map((part) => eventString(part, "transcript") ?? eventString(part, "text"))
          .filter(Boolean)
          .join(" ");
        if (role === "user") recordTranscriptTurn(role, text, itemId);
        return;
      }

      if (type === "input_audio_buffer.speech_started") {
        srInterrupted = true; // U4: deterministic barge-in flag (R4 parity)
        startUserSpeech(eventString(event, "item_id"), eventNumber(event, "audio_start_ms"));
        if (activeResponseId) {
          sendJson(openAiWs, { type: "response.cancel" });
        }
        clearPlivoAudio();
        activeResponseId = undefined;
        lastAssistantItemId = undefined;
        return;
      }

      if (type === "input_audio_buffer.speech_stopped") {
        srEouMs = srOffset(); // U4: end-of-utterance proxy (raw-frame, no speech VAD)
        finishUserSpeech(eventString(event, "item_id"));
      }
    });

    openAiWs.on("close", (code, reason) => {
      console.log(`[voice/plivo] OpenAI WS close code=${code} reason=${reason.toString() || "(empty)"}`);
      closeBoth();
    });
    openAiWs.on("error", (err) => {
      console.error("[voice/plivo] OpenAI WS error:", err);
      closeBoth();
    });
  }

  async function playTtsGreeting(): Promise<void> {
    if (!callConfig || closed) return;
    const startedAt = Date.now();
    const generation = speechEpoch;
    try {
      const payload = callConfig.sarvamOpeningAudio ||
        await synthesizeVoiceMulaw(callConfig.firstMessage, callConfig.language, callConfig.voice);
      if (closed || generation !== speechEpoch) {
        console.log(`[voice/plivo] ${activeVoiceTtsProvider()} opener skipped after interruption`);
        return;
      }
      console.log(
        `[voice/plivo] ${activeVoiceTtsProvider()} opener ready t=+${Date.now() - connectedAt}ms` +
          (callConfig.sarvamOpeningAudio ? " cached=true" : ` synth=${Date.now() - startedAt}ms`),
      );
      bridgeRecorder?.syncOutboundCursor(latestTimestamp);
      playPlivoMulaw(payload);
      recordTranscriptTurn("assistant", callConfig.firstMessage, "sarvam-opener");
    } catch (err) {
      console.error(`[voice/plivo] ${activeVoiceTtsProvider()} opener failed:`, err);
      if (openAiWs && isOpen(openAiWs)) {
        sendJson(openAiWs, {
          type: "response.create",
          response: {
            output_modalities: ["text"],
            input: [],
            instructions: `Return exactly this opening line and nothing else: "${callConfig.firstMessage}"`,
          },
        });
      }
    }
  }

  if (!callConfig) {
    console.error(`[voice/plivo] Missing call config for callId=${callId || "(empty)"}`);
    closeBoth();
    return;
  }

  plivoWs.on("message", (data) => {
    const event = parseEvent(data);
    if (!event || typeof event.event !== "string") return;

    if (event.event === "start") {
      const start = objectValue(event, "start");
      streamId = start ? eventString(start, "streamId") : undefined;
      currentCallUuid = start ? eventString(start, "callId") : undefined;
      const mediaFormat = start ? objectValue(start, "mediaFormat") : undefined;
      console.log(
        `[voice/plivo] start StreamID=${streamId ?? "(missing)"} CallUUID=${currentCallUuid ?? "(missing)"}` +
          ` media=${mediaFormat ? JSON.stringify(mediaFormat) : "(missing)"}`,
      );
      if (currentCallUuid) {
        bridgeRecorder = createVoiceBridgeRecorder(currentCallUuid);
        upsertCall(callConfig.campaignId, {
          id: currentCallUuid,
          callConfigId: callId,
          provider: "plivo",
          toNumber: callConfig.toNumber,
          status: "connected",
          engaged: false,
          startedAt: new Date().toISOString(),
        });
      }
      if (callId) emitVoiceLifecycle("voice_ws_connected", {}, callId, "sarvam_cascaded");
      startRealtime();
      void playTtsGreeting();
      return;
    }

    if (event.event === "media") {
      const media = objectValue(event, "media");
      const payload = media ? eventString(media, "payload") : undefined;
      if (!payload) return;
      latestTimestamp = Number(media ? eventString(media, "timestamp") : undefined) || latestTimestamp;
      rememberInboundFrame(latestTimestamp, payload);
      bridgeRecorder?.recordInbound(latestTimestamp, payload);
      if (openAiWs && isOpen(openAiWs)) {
        sendJson(openAiWs, {
          type: "input_audio_buffer.append",
          audio: payload,
        });
      }
      return;
    }

    if (event.event === "stop") {
      closeBoth();
    }
  });

  plivoWs.on("close", (code, reason) => {
    console.log(`[voice/plivo] Plivo WS close code=${code} reason=${reason.toString() || "(empty)"}`);
    closeBoth();
  });
  plivoWs.on("error", (err) => {
    console.error("[voice/plivo] Plivo WS error:", err);
    closeBoth();
  });
}
