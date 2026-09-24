import { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import twilio from "twilio";
import { requirePublicBaseUrl } from "@/lib/public-base-url";
import { bdrSpeech } from "./cartesia";
import { applyBdrCallStatus, bdrTwilio, validBdrStreamToken } from "./telephony";
import { findBdrCall, suppressBdrPhone, updateBdrCall } from "./store";
import { personalizeBdr } from "./types";

export function authorizeBdrUpgrade(req: IncomingMessage): boolean {
  const signature = req.headers["x-twilio-signature"];
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (typeof signature !== "string" || !token) return false;
  try {
    const url = `${requirePublicBaseUrl()}/bdr-media-stream`;
    return twilio.validateRequest(token, signature, url, {}) || twilio.validateRequest(token, signature, url.replace(/^https:/, "wss:"), {});
  } catch { return false; }
}

export function handleBdrStream(socket: WebSocket): void {
  let realtime: WebSocket | undefined;
  let callId = "";
  let callSid = "";
  let streamSid = "";
  let ready = false;
  let closed = false;
  let ending = false;
  let epoch = 0;
  let buffer = "";
  let speech = Promise.resolve();
  let activeResponse = false;
  let context: ReturnType<typeof findBdrCall>;
  const pendingAudio: string[] = [];
  const completedItems = new Set<string>();
  const startTimeout = setTimeout(() => close(), 10_000);
  let openingTimeout: ReturnType<typeof setTimeout> | undefined;
  let realtimeTimeout: ReturnType<typeof setTimeout> | undefined;
  let hangupTimeout: ReturnType<typeof setTimeout> | undefined;
  let openingPlayed = false;

  function send(ws: WebSocket | undefined, value: unknown) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); }
  function close() {
    if (closed) return;
    closed = true;
    epoch += 1;
    clearTimeout(startTimeout);
    if (openingTimeout) clearTimeout(openingTimeout);
    if (realtimeTimeout) clearTimeout(realtimeTimeout);
    if (hangupTimeout) clearTimeout(hangupTimeout);
    realtime?.close();
    socket.close();
  }
  function transcript(role: "user" | "assistant", text: string, itemId: string) {
    if (!text.trim() || completedItems.has(itemId)) return;
    completedItems.add(itemId);
    updateBdrCall(callId, (row) => { row.transcript = [...(row.transcript || []), { role, text: text.slice(0, 8000) }].slice(-120); });
  }
  function fail(message: string) {
    console.error("[bdr] call bridge failed", { callId, message });
    if (callId) updateBdrCall(callId, (row, campaign) => {
      row.detail = message;
      campaign.status = "paused";
      campaign.error = message;
    });
    if (callSid) void bdrTwilio().calls(callSid).update({ status: "completed" }).catch(() => undefined);
    close();
  }
  function speak(text: string, markName?: "bdr-opening" | "bdr-end") {
    const capturedEpoch = epoch;
    speech = speech.then(async () => {
      if (!context || closed || capturedEpoch !== epoch) return;
      const audio = await bdrSpeech(text, context.campaign.language, context.campaign.voiceId);
      if (closed || capturedEpoch !== epoch) return;
      send(socket, { event: "media", streamSid, media: { payload: audio.toString("base64") } });
      if (markName === "bdr-opening") console.info("[bdr] opening audio sent", { callId, bytes: audio.length });
      if (markName) send(socket, { event: "mark", streamSid, mark: { name: markName } });
      if (markName === "bdr-end") {
        hangupTimeout = setTimeout(() => finishCall(), 15_000);
      }
    }).catch((error: unknown) => {
      console.error("[bdr] Cartesia speech failed", { callId, error: error instanceof Error ? error.message : "Unknown error" });
      fail("Speech generation failed. Check Cartesia credentials, voice, and credits before resuming.");
    });
  }
  function finishCall() {
    if (closed) return;
    if (callSid) void bdrTwilio().calls(callSid).update({ status: "completed" }).catch(() => undefined).finally(close);
    else close();
  }
  function flush(force = false) {
    while (buffer) {
      const boundary = buffer.search(/[.!?।]\s/);
      if (boundary < 0 && !force && buffer.length < 160) break;
      const end = boundary >= 0 ? boundary + 1 : force ? buffer.length : Math.max(1, buffer.lastIndexOf(" "));
      const chunk = buffer.slice(0, end).trim();
      buffer = buffer.slice(end).trimStart();
      if (chunk) speak(chunk);
    }
  }
  function startRealtime() {
    if (!context || closed || realtime) return;
    const model = process.env.BDR_REALTIME_MODEL || "gpt-realtime-mini";
    realtime = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, perMessageDeflate: false });
    realtimeTimeout = setTimeout(() => fail("Conversation setup timed out. Check OpenAI Realtime access and Railway logs."), 10_000);
    realtime.on("open", () => {
      if (!context) return;
      send(realtime, { type: "session.update", session: {
        type: "realtime", model, output_modalities: ["text"],
        instructions: `${personalizeBdr(context.campaign.script, context.recipient)}\n\nRuntime instructions: Your opening has already been spoken. Do not repeat it. Speak ${context.campaign.language}. Return only natural spoken replies. Use opt_out immediately when the person asks not to be contacted. Use end_call when the conversation is finished. Never claim to have booked a meeting or sent a message; those actions are not available.`,
        audio: { input: { format: { type: "audio/pcmu" }, transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 450, prefix_padding_ms: 300 } } },
        tools: [
          { type: "function", name: "opt_out", description: "The prospect explicitly asked not to be contacted again. Stop the pitch and end the call.", parameters: { type: "object", properties: {}, additionalProperties: false } },
          { type: "function", name: "end_call", description: "End a finished conversation politely.", parameters: { type: "object", properties: {}, additionalProperties: false } },
        ], tool_choice: "auto",
      } });
    });
    realtime.on("message", (raw) => {
      if (closed || !context) return;
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === "session.updated" && !ready) {
        ready = true;
        if (realtimeTimeout) clearTimeout(realtimeTimeout);
        const opening = personalizeBdr(context.campaign.opening, context.recipient);
        // Let the model know what the prospect has already heard.
        send(realtime, { type: "conversation.item.create", item: { type: "message", role: "assistant", content: [{ type: "output_text", text: opening }] } });
        for (const audio of pendingAudio.splice(0)) send(realtime, { type: "input_audio_buffer.append", audio });
      } else if (event.type === "response.created") {
        activeResponse = true;
      } else if (event.type === "response.output_text.delta" && !ending) {
        buffer += String(event.delta || ""); flush();
      } else if (event.type === "response.output_text.done" && !ending) {
        flush(true); transcript("assistant", String(event.text || ""), String(event.item_id || event.response_id));
      } else if (event.type === "response.done") {
        activeResponse = false;
      } else if (event.type === "conversation.item.input_audio_transcription.completed") {
        transcript("user", String(event.transcript || ""), String(event.item_id));
      } else if (event.type === "input_audio_buffer.speech_started" && !ending) {
        epoch += 1; buffer = "";
        send(socket, { event: "clear", streamSid });
        if (activeResponse) send(realtime, { type: "response.cancel" });
        activeResponse = false;
      } else if (event.type === "response.function_call_arguments.done" && !ending && (event.name === "opt_out" || event.name === "end_call")) {
        ending = true; epoch += 1; buffer = "";
        send(socket, { event: "clear", streamSid });
        if (event.name === "opt_out") {
          suppressBdrPhone(context.recipient.phone);
          updateBdrCall(callId, (row) => { row.detail = "Prospect opted out. Suppressed from future Actioneer calls."; });
        }
        const hindi = context.campaign.language !== "English";
        const farewell = event.name === "opt_out"
          ? hindi ? "समझ गई। हम आपको दोबारा कॉल नहीं करेंगे। धन्यवाद।" : "Understood. We won't call you again. Goodbye."
          : hindi ? "आपके समय के लिए धन्यवाद। नमस्ते।" : "Thank you for your time. Goodbye.";
        transcript("assistant", farewell, "farewell");
        speak(farewell, "bdr-end");
      } else if (event.type === "error") {
        const error = event.error as { code?: string; message?: string } | undefined;
        if (error?.code !== "response_cancel_not_active") {
          console.error("[bdr] OpenAI Realtime error", { callId, code: error?.code, message: error?.message });
          fail(`Conversation service failed${error?.code ? ` (${error.code})` : ""}. Check the OpenAI key, model access, and credits.`);
        }
      }
    });
    realtime.on("error", (error: Error) => {
      console.error("[bdr] OpenAI Realtime connection error", { callId, message: error.message });
      const status = /Unexpected server response: (\d{3})/.exec(error.message)?.[1];
      fail(`Conversation connection failed${status ? ` (OpenAI HTTP ${status})` : ""}. Check the OpenAI key, billing, model access, and Railway logs.`);
    });
    realtime.on("close", () => { if (!closed && !ending) fail("Conversation connection closed unexpectedly."); });
  }
  socket.on("message", (raw) => {
    let event;
    try { event = JSON.parse(raw.toString()); } catch { close(); return; }
    if (event.event === "start") {
      if (context) return;
      callId = event.start?.customParameters?.callId || "";
      if (!validBdrStreamToken(callId, event.start?.customParameters?.token || "")) { close(); return; }
      context = findBdrCall(callId);
      callSid = event.start?.callSid || "";
      streamSid = event.start?.streamSid || "";
      if (!context || !["dispatching", "calling", "connected"].includes(context.recipient.status) || !callSid || !streamSid || event.start?.accountSid !== process.env.TWILIO_ACCOUNT_SID || (context.recipient.providerSid && context.recipient.providerSid !== callSid)) { close(); return; }
      applyBdrCallStatus(callId, callSid, "in-progress");
      console.info("[bdr] media stream started", { callId, streamSid });
      clearTimeout(startTimeout);
      const opening = personalizeBdr(context.campaign.opening, context.recipient);
      transcript("assistant", opening, "opening");
      openingTimeout = setTimeout(() => fail("Opening audio was not acknowledged by Twilio. Check the media stream and Railway logs."), 35_000);
      speak(opening, "bdr-opening");
    } else if (event.event === "media" && context && !ending) {
      const audio = event.media?.payload;
      if (typeof audio !== "string" || audio.length > 16_000) return;
      if (ready) send(realtime, { type: "input_audio_buffer.append", audio });
      else if (pendingAudio.length < 500) pendingAudio.push(audio);
    } else if (event.event === "mark" && event.mark?.name === "bdr-opening" && !openingPlayed) {
      openingPlayed = true;
      console.info("[bdr] opening playback acknowledged", { callId });
      if (openingTimeout) clearTimeout(openingTimeout);
      startRealtime();
    } else if (event.event === "mark" && event.mark?.name === "bdr-end") finishCall();
    else if (event.event === "stop") close();
  });
  socket.on("close", (code: number) => {
    console.info("[bdr] media stream closed", { callId, code, openingPlayed, conversationReady: ready });
    close();
  });
  socket.on("error", (error: Error) => {
    console.error("[bdr] media stream error", { callId, message: error.message });
    close();
  });
}
