import { WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { geminiPcm16ToPlivoMulaw, plivoMulawToGeminiPcm16 } from "./telephony-audio";

const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const GEMINI_LIVE_VOICE = process.env.PROBE_GEMINI_VOICE || process.env.GEMINI_LIVE_VOICE || "Aoede";
const GEMINI_LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

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
  if (isOpen(ws)) ws.send(JSON.stringify(payload), { compress: false });
}

function parseEvent(data: WebSocket.RawData): Record<string, unknown> | null {
  try {
    return JSON.parse(data.toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function boolValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function arrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function outputAudioRate(mimeType: string | undefined): number {
  const match = mimeType?.match(/rate=(\d+)/);
  return match ? Number(match[1]) || 24000 : 24000;
}

function extractModelAudio(event: Record<string, unknown>): Array<{ data: string; mimeType?: string }> {
  const serverContent = objectValue(event.serverContent);
  const modelTurn = objectValue(serverContent?.modelTurn);
  const parts = arrayValue(modelTurn?.parts);
  const audio: Array<{ data: string; mimeType?: string }> = [];
  for (const part of parts) {
    const inlineData = objectValue(part.inlineData) ?? objectValue(part.inline_data);
    const data = stringValue(inlineData?.data);
    if (!data) continue;
    audio.push({
      data,
      mimeType: stringValue(inlineData?.mimeType) ?? stringValue(inlineData?.mime_type),
    });
  }
  return audio;
}

function transcriptionText(event: Record<string, unknown>, key: "inputTranscription" | "outputTranscription"): string | undefined {
  const serverContent = objectValue(event.serverContent);
  const transcription = objectValue(serverContent?.[key]);
  return stringValue(transcription?.text)?.trim();
}

const PROBE_SYSTEM_PROMPT = `You are having a free-flowing casual phone conversation.
Be warm, natural, and spontaneous — like talking to a close friend.

Language: Speak in natural Indian Hinglish unless the other person switches language.
Use natural fillers: haan, achha, arey, yaar, toh, matlab, suno, waise.
Self-reference feminine forms: bol rahi hoon, samajh rahi hoon, dekh rahi hoon.

Rhythm:
- Keep each turn short — usually one or two sentences.
- Pause naturally after a thought. Do not rush.
- React before answering: "haan... achha" or "arey yaar" before jumping in.
- Match the other person's energy and pace.
- If they are brief, be brief. If they expand, you can too.

Feel:
- Curious, warm, present.
- Ask follow-up questions naturally.
- Share your own take sometimes.
- No agenda. No script. Just conversation.

Never:
- Sound like a salesperson.
- Use "Absolutely!", "Great question!", "Of course!".
- Give long monologues.
- Use markdown, bullet points, or stage directions.`;

export function handlePlivoGeminiProbeStream(plivoWs: WebSocket, req: IncomingMessage): void {
  console.log(`[probe] Media stream connected url=${req.url ?? ""}`);

  let geminiWs: WebSocket | undefined;
  let closed = false;
  let setupComplete = false;
  let outboundQueue = Buffer.alloc(0);
  let outboundPump: NodeJS.Timeout | undefined;
  let outboundAudioChunks = 0;
  let outputTranscriptBuffer = "";

  function closeBoth(): void {
    if (closed) return;
    closed = true;
    if (outboundPump) clearInterval(outboundPump);
    if (socketCanClose(geminiWs)) geminiWs?.close();
    if (socketCanClose(plivoWs)) plivoWs.close();
  }

  function sendPlivoJson(payload: Record<string, unknown>): void {
    if (!isOpen(plivoWs)) return;
    plivoWs.send(JSON.stringify(payload), { compress: false, binary: false, fin: true });
  }

  function queuePlivoMulaw(payload: string): void {
    outboundQueue = Buffer.concat([outboundQueue, Buffer.from(payload, "base64")]);
    if (!outboundPump && !closed) {
      outboundPump = setInterval(() => {
        if (closed) { clearInterval(outboundPump); outboundPump = undefined; return; }
        if (outboundQueue.length < 160) return;
        const frame = outboundQueue.subarray(0, 160);
        outboundQueue = outboundQueue.subarray(160);
        sendPlivoJson({ event: "playAudio", media: { contentType: "audio/x-mulaw", sampleRate: 8000, payload: frame.toString("base64") } });
      }, 20);
    }
  }

  function flushOutboundRemainder(): void {
    if (outboundQueue.length === 0) return;
    const padded = Buffer.alloc(Math.ceil(outboundQueue.length / 160) * 160, 0xff);
    outboundQueue.copy(padded);
    outboundQueue = padded;
  }

  function clearPlivoAudio(): void {
    outboundQueue = Buffer.alloc(0);
    sendPlivoJson({ event: "clearAudio" });
  }

  function startGemini(): void {
    if (closed || geminiWs) return;

    const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!key) { console.error("[probe] Missing Gemini API key"); closeBoth(); return; }

    geminiWs = new WebSocket(
      `${GEMINI_LIVE_URL}?key=${encodeURIComponent(geminiApiKey())}`,
      { perMessageDeflate: false, headers: { "x-goog-api-key": key } },
    );

    geminiWs.on("open", () => {
      console.log(`[probe] Gemini WS open model=${GEMINI_LIVE_MODEL} voice=${GEMINI_LIVE_VOICE}`);
      sendJson(geminiWs, {
        setup: {
          model: `models/${GEMINI_LIVE_MODEL}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            temperature: 0.9,
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: GEMINI_LIVE_VOICE },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: PROBE_SYSTEM_PROMPT }],
          },
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
      const event = parseEvent(data);
      if (!event) return;

      if (event.error) {
        console.error("[probe] Gemini error:", JSON.stringify(event.error));
        return;
      }

      if (event.setupComplete) {
        setupComplete = true;
        console.log("[probe] Setup complete — sending greeting prompt");
        // Kick off with a natural opening instead of a scripted hello
        sendJson(geminiWs, {
          clientContent: {
            turns: [{ role: "user", parts: [{ text: "Start the conversation with a warm natural Indian greeting. Keep it short — one line only." }] }],
            turnComplete: true,
          },
        });
        return;
      }

      const serverContent = objectValue(event.serverContent);
      if (boolValue(serverContent?.interrupted)) {
        outputTranscriptBuffer = "";
        clearPlivoAudio();
      }

      const inputText = transcriptionText(event, "inputTranscription");
      if (inputText) console.log(`[probe] 👤 CALLER: "${inputText}"`);

      const outputText = transcriptionText(event, "outputTranscription");
      if (outputText) outputTranscriptBuffer += outputText;

      for (const chunk of extractModelAudio(event)) {
        const payload = geminiPcm16ToPlivoMulaw(chunk.data, outputAudioRate(chunk.mimeType));
        outboundAudioChunks += 1;
        queuePlivoMulaw(payload);
      }

      if (boolValue(serverContent?.turnComplete)) {
        flushOutboundRemainder();
        const said = outputTranscriptBuffer.trim();
        if (said) console.log(`[probe] 🤖 AGENT: "${said}"`);
        console.log(`[probe] turn complete audioChunks=${outboundAudioChunks}`);
        outputTranscriptBuffer = "";
      }
    });

    geminiWs.on("error", (err) => console.error("[probe] Gemini WS error:", err));
    geminiWs.on("close", (code, reason) => {
      console.log(`[probe] Gemini WS closed code=${code} reason=${reason.toString()}`);
      closeBoth();
    });
  }

  plivoWs.on("message", (data) => {
    const event = parseEvent(data);
    if (!event) return;

    if (event.event === "connected") {
      console.log("[probe] Plivo connected");
      startGemini();
      return;
    }

    if (event.event === "media" && setupComplete) {
      const media = objectValue(event.media);
      const payload = stringValue(media?.payload);
      if (!payload) return;
      const audio = plivoMulawToGeminiPcm16(payload);
      sendJson(geminiWs, {
        realtimeInput: { audio: { data: audio, mimeType: "audio/pcm;rate=16000" } },
      });
      return;
    }

    if (event.event === "stop") {
      console.log("[probe] Plivo stop");
      sendJson(geminiWs, { realtimeInput: { audioStreamEnd: true } });
      setTimeout(closeBoth, 800);
    }
  });

  plivoWs.on("error", (err) => console.error("[probe] Plivo WS error:", err));
  plivoWs.on("close", () => { console.log("[probe] Plivo WS closed"); closeBoth(); });
}
