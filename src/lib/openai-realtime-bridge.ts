import { parse } from "url";
import { WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { resolveCallConfig } from "./voice-call-config-resolver";
import { removeCallConfig } from "./voice-call-state";
import { appendCallTranscript, upsertCall } from "./voice-campaign-store";
import { createVoiceBridgeRecorder, type VoiceBridgeRecorder } from "./voice-bridge-recorder";
import { transcribePcmuFrames } from "./voice-transcription";
import {
  deriveTurnLatencies,
  emitVoiceLifecycle,
  emitVoiceTurn,
  makeSpeechId,
} from "./voice-events";

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

function getApiKey(): string {
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

function sendTwilioJson(ws: WebSocket, payload: Record<string, unknown>): void {
  if (!isOpen(ws)) return;
  const message = JSON.stringify(payload);
  const label = typeof payload.event === "string" ? payload.event : "unknown";
  const media = objectValue(payload, "media");
  const payloadSize = media ? eventString(media, "payload")?.length ?? 0 : 0;
  console.log(`[voice/realtime] -> Twilio ${label} bytes=${message.length} mediaPayload=${payloadSize}`);
  ws.send(message, { compress: false, binary: false, fin: true }, (err) => {
    if (err) console.error(`[voice/realtime] Twilio send failed (${label}):`, err);
  });
}

function parseEvent(data: WebSocket.RawData): Record<string, unknown> | null {
  try {
    return JSON.parse(data.toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function eventType(event: Record<string, unknown>): string {
  return typeof event.type === "string" ? event.type : "";
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

function normalizeBase64Audio(value: string): string | undefined {
  const normalized = value.replace(/\s/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    return undefined;
  }
  return Buffer.from(normalized, "base64").toString("base64");
}

function openRealtimeSocket(): WebSocket {
  return new WebSocket(REALTIME_URL, {
    perMessageDeflate: false,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
    },
  });
}

function languageCode(language: string): string | undefined {
  const normalized = language.trim().toLowerCase();
  const codes: Record<string, string> = {
    english: "en",
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

export function handleMediaStream(twilioWs: WebSocket, req: IncomingMessage): void {
  console.log(`[voice/realtime] Media stream connected url=${req.url ?? ""}`);
  const { query } = parse(req.url || "", true);
  let callId = typeof query.callId === "string" ? query.callId : "";
  let callConfig = callId ? resolveCallConfig(callId) : undefined;

  let streamSid: string | undefined;
  let currentCallSid: string | undefined;
  let latestTwilioTimestamp = 0;
  let responseStartTimestamp: number | undefined;
  let lastAssistantItemId: string | undefined;
  let closed = false;
  let openAiWs: WebSocket | undefined;
  let firstResponseRequested = false;
  let activeResponseId: string | undefined;
  let transcriptSequence = 0;
  let bridgeRecorder: VoiceBridgeRecorder | undefined;
  const mediaConnectedAt = Date.now();
  let firstResponseRequestedAt: number | undefined;
  let firstAudioDeltaAt: number | undefined;
  const rollingInboundFrames: Array<{ timestampMs: number; audio: Buffer }> = [];
  let activeUserSpeech: { itemId?: string; frames: Buffer[] } | undefined;
  const outboundAudioQueue: string[] = [];
  let outboundAudioTimer: NodeJS.Timeout | undefined;

  // ── U4: additive voice-observability locals (openai_realtime parity, R7).
  //    No speech-gated VAD here → eou_source is a raw-frame proxy. Stream-relative
  //    offsets via rtOffset() keep the KTD4 single-clock / wall-clock guard happy.
  let rtVoiceTurnIndex = 0;
  let rtEouMs: number | null = null;
  let rtModelStartMs: number | undefined;
  let rtFirstAudioMs: number | undefined;
  let rtInterrupted = false;
  const rtOffset = (): number => Date.now() - mediaConnectedAt;
  function rtFlushVoiceTurn(): void {
    if (!callId) return;
    const d = deriveTurnLatencies(rtEouMs, rtModelStartMs ?? null, rtFirstAudioMs ?? null, rtOffset());
    emitVoiceTurn(
      {
        speech_id: makeSpeechId(callId, rtVoiceTurnIndex),
        turn_index: rtVoiceTurnIndex,
        eou_proxy_ms: d.eou_proxy_ms,
        eou_source: "raw_frame_proxy",
        voice_to_voice_ms: d.voice_to_voice_ms,
        detection_think_ms: d.detection_think_ms,
        response_lag_ms: d.response_lag_ms,
        total_turn_ms: d.total_turn_ms,
        interrupted: rtInterrupted,
      },
      callId,
      "openai_realtime",
    );
    rtVoiceTurnIndex += 1;
    rtModelStartMs = undefined;
    rtFirstAudioMs = undefined;
    rtInterrupted = false;
  }

  function socketCanClose(ws: WebSocket | undefined): boolean {
    return !!ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING;
  }

  function closeBoth(): void {
    if (closed) return;
    closed = true;
    if (outboundAudioTimer) clearInterval(outboundAudioTimer);
    // U4: transcript-finalized lifecycle event (realtime_inline). This bridge
    // records an inline realtime transcript, so U5's post-call path skips it.
    if (callId) {
      const triggeredAtMs = callConfig?.triggeredAtMs;
      emitVoiceLifecycle(
        "voice_transcript_finalized",
        {
          transcript_source: "realtime_inline",
          trigger_to_transcript_ms: typeof triggeredAtMs === "number" ? Date.now() - triggeredAtMs : null,
        },
        callId,
        "openai_realtime",
      );
    }
    bridgeRecorder?.finalize();
    if (callId) removeCallConfig(callId);
    if (socketCanClose(openAiWs)) openAiWs?.close();
    if (socketCanClose(twilioWs)) twilioWs.close();
  }

  function pumpOutboundAudio(): void {
    if (outboundAudioTimer || !streamSid) return;
    outboundAudioTimer = setInterval(() => {
      if (!streamSid || !isOpen(twilioWs)) {
        if (outboundAudioTimer) clearInterval(outboundAudioTimer);
        outboundAudioTimer = undefined;
        outboundAudioQueue.length = 0;
        return;
      }

      const payload = outboundAudioQueue.shift();
      if (!payload) {
        if (outboundAudioTimer) clearInterval(outboundAudioTimer);
        outboundAudioTimer = undefined;
        return;
      }

      sendTwilioJson(twilioWs, {
        event: "media",
        streamSid,
        media: { payload },
      });
      bridgeRecorder?.recordOutbound(payload);
    }, 20);
  }

  function enqueueTwilioAudio(base64Audio: string): void {
    const audio = Buffer.from(base64Audio, "base64");
    // Twilio streams PCMU as 8 kHz, 8-bit audio: 160 bytes is one 20 ms frame.
    for (let offset = 0; offset < audio.length; offset += 160) {
      outboundAudioQueue.push(audio.subarray(offset, offset + 160).toString("base64"));
    }
    pumpOutboundAudio();
  }

  function clearOutboundAudio(): void {
    outboundAudioQueue.length = 0;
    if (outboundAudioTimer) clearInterval(outboundAudioTimer);
    outboundAudioTimer = undefined;
  }

  function markConnected(callSid: string): void {
    if (!callConfig) return;
    currentCallSid = callSid;
    bridgeRecorder = createVoiceBridgeRecorder(callSid);
    upsertCall(callConfig.campaignId, {
      id: callSid,
      toNumber: callConfig.toNumber,
      status: "connected",
      engaged: false,
      startedAt: new Date().toISOString(),
    });
  }

  function recordTranscriptTurn(
    role: "assistant" | "user",
    text: string | undefined,
    itemId?: string,
    responseId?: string,
  ): void {
    if (!callConfig || !currentCallSid) return;
    const trimmed = text?.trim();
    if (!trimmed) return;
    transcriptSequence += 1;
    appendCallTranscript(callConfig.campaignId, currentCallSid, {
      id: `${currentCallSid}_${itemId ?? role}_${transcriptSequence}`,
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
    const startMs = audioStartMs ?? latestTwilioTimestamp;
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
    if (!speech || speech.frames.length === 0 || !callConfig || !currentCallSid) return;

    const campaignId = callConfig.campaignId;
    const callSid = currentCallSid;
    const transcriptItemId = itemId ?? speech.itemId;
    const inputLanguage = languageCode(callConfig.language);
    void transcribePcmuFrames(speech.frames, inputLanguage)
      .then((text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        transcriptSequence += 1;
        appendCallTranscript(campaignId, callSid, {
          id: `${callSid}_${transcriptItemId ?? "user-audio"}_${transcriptSequence}`,
          role: "user",
          text: trimmed,
          at: new Date().toISOString(),
          itemId: transcriptItemId,
          sequence: transcriptSequence,
        });
      })
      .catch((err) => {
        console.error("[voice/realtime] User utterance transcription failed:", err);
      });
  }

  function startRealtime(): void {
    if (closed || openAiWs || !callConfig || !streamSid) return;
    openAiWs = openRealtimeSocket();
    console.log(`[voice/realtime] Opening OpenAI Realtime WS model=${REALTIME_MODEL} t=+${Date.now() - mediaConnectedAt}ms`);

    openAiWs.on("open", () => {
      if (closed || !callConfig || !openAiWs || !isOpen(twilioWs)) {
        closeBoth();
        return;
      }
      const inputLanguage = languageCode(callConfig.language);
      console.log("[voice/realtime] OpenAI Realtime WS open; sending session.update");
      sendJson(openAiWs, {
        type: "session.update",
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: `${callConfig.systemPrompt}

Language: ${callConfig.language}.
Before speaking, render every response for a real Indian phone call:
- Do not sound like written marketing copy.
- Use short spoken chunks, usually under 8 to 12 words.
- For Hindi or Hinglish, use natural spoken Hinglish/Hindi with simple words.
- Light fillers are allowed when natural: "haan", "achha", "theek hai", "ek sec", "samjha".
- Start with a tiny acknowledgement when helpful, then answer.
- Prefer "haan, samjha... ek sec, main check karta hoon" over "I understand your concern, let me check that for you."
- If the user interrupts, stop the current pitch and answer them directly.
- Never overuse fillers, fake laughter, or exaggerated enthusiasm.
If the user is busy, acknowledge it and ask for a callback. Never mention that you are an AI unless directly asked.`,
          output_modalities: ["audio"],
          audio: {
            input: {
              format: { type: "audio/pcmu" },
              transcription: {
                model: "gpt-4o-mini-transcribe",
                ...(inputLanguage ? { language: inputLanguage } : {}),
              },
              turn_detection: { type: "server_vad" },
            },
            output: {
              format: { type: "audio/pcmu" },
              voice: callConfig.voice,
            },
          },
        },
      });
      requestFirstResponse();
    });

    function requestFirstResponse(): void {
      if (firstResponseRequested || closed || !callConfig || !openAiWs || !isOpen(openAiWs)) return;
      firstResponseRequested = true;
      firstResponseRequestedAt = Date.now();
      sendJson(openAiWs, {
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          input: [],
          instructions: `Say exactly this opening line and nothing else: "${callConfig.firstMessage}"`,
        },
      });
      console.log(`[voice/realtime] OpenAI first response requested t=+${firstResponseRequestedAt - mediaConnectedAt}ms`);
    }

    openAiWs.on("message", (data) => {
      if (!openAiWs) return;
      const event = parseEvent(data);
      if (!event) return;

      const type = eventType(event);
      if (type === "error") {
        console.error("[voice/realtime] OpenAI error:", JSON.stringify(event));
        return;
      }

      if (type === "session.updated") {
        console.log("[voice/realtime] OpenAI session updated");
        if (callId) emitVoiceLifecycle("voice_setup_complete", { prewarmed: null }, callId, "openai_realtime");
        requestFirstResponse();
        return;
      }

      if (type === "response.output_item.created") {
        const item = event.item as Record<string, unknown> | undefined;
        if (item && item.role === "assistant" && typeof item.id === "string") {
          lastAssistantItemId = item.id;
        }
        return;
      }

      if (type === "response.output_audio.delta") {
        const delta = eventString(event, "delta");
        if (!delta || !streamSid) return;
        const payload = normalizeBase64Audio(delta);
        if (!payload) {
          console.error("[voice/realtime] Skipping invalid OpenAI audio delta");
          return;
        }
        if (firstAudioDeltaAt === undefined) {
          firstAudioDeltaAt = Date.now();
          console.log(
            `[voice/realtime] first OpenAI audio delta t=+${firstAudioDeltaAt - mediaConnectedAt}ms` +
            (firstResponseRequestedAt ? ` afterRequest=${firstAudioDeltaAt - firstResponseRequestedAt}ms` : ""),
          );
        }
        // U4: first model audio of THIS turn → freeze EOU + anchor model/first-audio.
        if (rtModelStartMs === undefined) {
          rtModelStartMs = rtOffset();
          rtFirstAudioMs = rtOffset();
        }
        if (responseStartTimestamp === undefined) responseStartTimestamp = latestTwilioTimestamp;
        if (responseStartTimestamp === latestTwilioTimestamp) {
          bridgeRecorder?.syncOutboundCursor(latestTwilioTimestamp);
        }
        lastAssistantItemId = eventString(event, "item_id") ?? lastAssistantItemId;
        activeResponseId = eventString(event, "response_id") ?? activeResponseId;
        enqueueTwilioAudio(payload);
        return;
      }

      if (type === "conversation.item.input_audio_transcription.completed") {
        recordTranscriptTurn(
          "user",
          eventString(event, "transcript"),
          eventString(event, "item_id"),
        );
        return;
      }

      if (type === "response.output_audio_transcript.done") {
        recordTranscriptTurn(
          "assistant",
          eventString(event, "transcript"),
          eventString(event, "item_id"),
          eventString(event, "response_id"),
        );
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
        if (role === "assistant" || role === "user") {
          recordTranscriptTurn(role, text, itemId);
        }
        return;
      }

      if (type === "response.output_audio.done") {
        activeResponseId = undefined;
        rtFlushVoiceTurn(); // U4: emit one voice_turn at the turn-audio boundary
        return;
      }

      if (type === "input_audio_buffer.speech_started") {
        rtInterrupted = true; // U4: deterministic barge-in flag (R4 parity)
        startUserSpeech(eventString(event, "item_id"), eventNumber(event, "audio_start_ms"));
        if (lastAssistantItemId && responseStartTimestamp !== undefined) {
          sendJson(openAiWs, {
            type: "conversation.item.truncate",
            item_id: lastAssistantItemId,
            content_index: 0,
            audio_end_ms: Math.max(0, latestTwilioTimestamp - responseStartTimestamp),
          });
        }
        clearOutboundAudio();
        if (streamSid) sendTwilioJson(twilioWs, { event: "clear", streamSid });
        responseStartTimestamp = undefined;
        lastAssistantItemId = undefined;
        return;
      }

      if (type === "input_audio_buffer.speech_stopped") {
        rtEouMs = rtOffset(); // U4: end-of-utterance proxy (raw-frame, no speech VAD)
        finishUserSpeech(eventString(event, "item_id"));
      }
    });

    openAiWs.on("close", (code, reason) => {
      console.log(`[voice/realtime] OpenAI WS close code=${code} reason=${reason.toString() || "(empty)"}`);
      closeBoth();
    });
    openAiWs.on("error", (err) => {
      console.error("[voice/realtime] OpenAI WS error:", err);
      closeBoth();
    });
  }

  /*
   * Twilio usually exposes <Parameter> values in the start event as
   * start.customParameters. Some tunnels/proxies do not preserve the query string
   * on the WebSocket upgrade, so do not close until the start message arrives.
   */
  function resolveCallConfigFromStart(start: Record<string, unknown> | undefined): boolean {
    if (callConfig) {
      startRealtime();
      return true;
    }
    const customParameters = start ? objectValue(start, "customParameters") : undefined;
    callId = (customParameters ? eventString(customParameters, "callId") : undefined) ?? callId;
    callConfig = callId ? resolveCallConfig(callId) : undefined;
    if (callConfig) {
      startRealtime();
      return true;
    }
    console.error(`[voice/realtime] Missing call config for callId=${callId || "(empty)"}`);
    closeBoth();
    return false;
  }

  twilioWs.on("message", (data) => {
    const event = parseEvent(data);
    if (!event || typeof event.event !== "string") return;

    if (event.event === "connected") {
      console.log(
        `[voice/realtime] connected protocol=${eventString(event, "protocol") ?? "(missing)"} version=${eventString(event, "version") ?? "(missing)"}`,
      );
      return;
    }

    if (event.event === "start") {
      const start = objectValue(event, "start");
      streamSid = eventString(event, "streamSid") ?? (start ? eventString(start, "streamSid") : undefined);
      const twilioCallSid = start ? eventString(start, "callSid") : undefined;
      const customParameters = start ? objectValue(start, "customParameters") : undefined;
      const mediaFormat = start ? objectValue(start, "mediaFormat") : undefined;
      console.log(
        `[voice/realtime] start StreamSid=${streamSid ?? "(missing)"} CallSid=${twilioCallSid ?? "(missing)"} callId=${customParameters ? eventString(customParameters, "callId") ?? "(missing)" : "(missing)"} media=${mediaFormat ? JSON.stringify(mediaFormat) : "(missing)"}`,
      );
      if (!resolveCallConfigFromStart(start)) return;
      if (twilioCallSid) markConnected(twilioCallSid);
      if (callId) emitVoiceLifecycle("voice_ws_connected", {}, callId, "openai_realtime");
      return;
    }

    if (event.event === "media") {
      if (!openAiWs) return;
      const media = objectValue(event, "media");
      const payload = media ? eventString(media, "payload") : undefined;
      if (!payload) return;
      latestTwilioTimestamp = Number(media ? eventString(media, "timestamp") : undefined) || latestTwilioTimestamp;
      rememberInboundFrame(latestTwilioTimestamp, payload);
      bridgeRecorder?.recordInbound(latestTwilioTimestamp, payload);
      sendJson(openAiWs, {
        type: "input_audio_buffer.append",
        audio: payload,
      });
      return;
    }

    if (event.event === "stop") {
      closeBoth();
    }
  });

  twilioWs.on("close", (code, reason) => {
    console.log(`[voice/realtime] Twilio WS close code=${code} reason=${reason.toString() || "(empty)"}`);
    closeBoth();
  });
  twilioWs.on("error", (err) => {
    console.error("[voice/realtime] Twilio WS error:", err);
    closeBoth();
  });
}
