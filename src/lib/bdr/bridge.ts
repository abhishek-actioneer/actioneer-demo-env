import { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import twilio from "twilio";
import { requirePublicBaseUrl } from "@/lib/public-base-url";
import { BdrPlayback } from "./playback";
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

interface Reply {
  id: string;
  itemId: string;
  parentId: string;
  spoken: string[];
  interrupted: boolean;
  repaired: boolean;
  firstAudio: boolean;
  requestedAt: number;
  inputEndedAt: number;
  text: string;
}

// These are listening acknowledgements only when they overlap the agent's
// speech. The same "yes" after a question is a real answer and gets a reply.
const BACKCHANNEL = /^(?:yes|yeah|yep|ok|okay|right|sure|uh huh|mm hmm|mhm|got it|hello|hi|हाँ|हां|जी|ठीक है)$/iu;
const isBackchannel = (text: string) => BACKCHANNEL.test(text.toLowerCase().replace(/[.,!?।-]/g, " ").replace(/\s+/g, " ").trim());

export function handleBdrStream(socket: WebSocket): void {
  let realtime: WebSocket | undefined;
  let playback: BdrPlayback | undefined;
  let callId = "";
  let callSid = "";
  let streamSid = "";
  let ready = false;
  let closed = false;
  let ending = false;
  let openingPlayed = false;
  let openingInterrupted = false;
  let openingItemCreated = false;
  let conversationFailure = "";
  let speaking = false;
  let pendingTurn = false;
  let lastUserId = "";
  let lastSpeechStoppedAt = 0;
  let responseActive = false;
  let reply: Reply | undefined;
  let buffer = "";
  let context: ReturnType<typeof findBdrCall>;
  const pendingAudio: string[] = [];
  const completedItems = new Set<string>();
  const overlappedItems = new Set<string>();
  const awaitingTranscripts = new Set<string>();
  const respondedFromAudio = new Set<string>();
  const startTimeout = setTimeout(() => close(), 10_000);
  let openingTimeout: ReturnType<typeof setTimeout> | undefined;
  let realtimeTimeout: ReturnType<typeof setTimeout> | undefined;
  let hangupTimeout: ReturnType<typeof setTimeout> | undefined;
  let interruptionTimeout: ReturnType<typeof setTimeout> | undefined;

  function send(ws: WebSocket | undefined, value: unknown) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); }
  function log(event: string, data: Record<string, unknown> = {}) { console.info(`[bdr] ${event}`, { callId, ...data }); }
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(startTimeout);
    clearTimeout(openingTimeout);
    clearTimeout(realtimeTimeout);
    clearTimeout(hangupTimeout);
    clearTimeout(interruptionTimeout);
    playback?.clear(false);
    realtime?.close();
    socket.close();
  }
  function transcript(role: "user" | "assistant", text: string, delivery?: "played" | "interrupted") {
    if (!text.trim()) return;
    updateBdrCall(callId, (row) => {
      row.transcript = [...(row.transcript || []), { role, text: text.slice(0, 8000), ...(delivery ? { delivery } : {}) }].slice(-120);
    });
  }
  function fail(message: string) {
    if (closed) return;
    console.error("[bdr] call bridge failed", { callId, message });
    if (callId) updateBdrCall(callId, (row, campaign) => { row.detail = message; campaign.status = "paused"; campaign.error = message; });
    if (callSid) void bdrTwilio().calls(callSid).update({ status: "completed" }).catch(() => undefined);
    close();
  }
  function failConversation(message: string) {
    conversationFailure = message;
    // Opening playback is independent of the conversation service.
    if (openingPlayed || openingInterrupted) fail(message);
  }
  function finishCall() {
    if (closed) return;
    if (callSid) void bdrTwilio().calls(callSid).update({ status: "completed" }).catch(() => undefined).finally(close);
    else close();
  }
  function repairInterruptedReply() {
    if (!reply?.interrupted || reply.repaired || responseActive || !reply.itemId) return;
    reply.repaired = true;
    // Text output runs ahead of phone playback. Remove unheard text from the
    // model's history, retaining only sentences Twilio acknowledged as played.
    send(realtime, { type: "conversation.item.delete", item_id: reply.itemId });
    if (reply.spoken.length) send(realtime, { type: "conversation.item.create", previous_item_id: reply.parentId, item: {
      type: "message", role: "assistant", content: [{ type: "output_text", text: reply.spoken.join(" ") }],
    } });
  }
  function interrupt() {
    if (closed || ending || (!playback?.pending && !responseActive)) return;
    log("confirmed interruption", { responseId: reply?.id });
    if (reply) reply.interrupted = true;
    buffer = "";
    playback?.clear();
    if (!openingPlayed) {
      openingInterrupted = true;
      clearTimeout(openingTimeout);
      if (openingItemCreated) send(realtime, { type: "conversation.item.delete", item_id: "bdr_opening" });
      openingItemCreated = false;
    }
    if (responseActive && reply?.id) send(realtime, { type: "response.cancel", response_id: reply.id });
    repairInterruptedReply();
  }
  function instructions(): string {
    if (!context) return "";
    return `${personalizeBdr(context.campaign.script, context.recipient)}

Runtime speaking rules:
- The opening is handled by the phone server. Do not repeat the introduction or ask permission twice.
- Speak ${context.campaign.language}. Return only the words to say aloud, with no stage directions.
- Follow the campaign script in order, keeping track of points actually covered. Acknowledge the answer briefly, then advance to the next relevant point. Do not restart the pitch.
- Use one or two concise sentences per turn and at most one question; let the prospect answer before moving on.
- If interrupted, answer the prospect's question, then resume the unfinished point naturally. Never assume unheard text was delivered. Do not repeatedly ask them to say the same thing.
- Use opt_out when asked not to contact them again. Use end_call only after a clear decline, goodbye, or agreed follow-up outcome; never just because one response is finished.
- Never claim a meeting is booked or a message sent; those actions are not available.`;
  }
  function respond() {
    if (!ready || closed || ending || speaking || awaitingTranscripts.size || responseActive || playback?.pending || !pendingTurn || (!openingPlayed && !openingInterrupted)) return;
    repairInterruptedReply();
    const interrupted = reply?.interrupted || (!reply && openingInterrupted);
    pendingTurn = false;
    responseActive = true;
    reply = { id: "", itemId: "", parentId: lastUserId, spoken: [], interrupted: false, repaired: false, firstAudio: false, requestedAt: Date.now(), inputEndedAt: lastSpeechStoppedAt, text: "" };
    send(realtime, { type: "response.create", response: {
      output_modalities: ["text"],
      ...(interrupted ? { instructions: `${instructions()}\nThe previous spoken turn was interrupted. Only the retained assistant text was fully heard. Briefly address the prospect and continue the unfinished point.` } : {}),
    } });
    log("response requested");
  }
  function flush(force = false) {
    if (!reply || reply.interrupted) return;
    while (buffer) {
      const boundary = buffer.search(/[.!?।](?:\s|$)/);
      if (boundary < 0 && !force && buffer.length < 120) break;
      const end = boundary >= 0 ? boundary + 1 : force ? buffer.length : Math.max(1, buffer.lastIndexOf(" ", 120));
      const chunk = buffer.slice(0, end).trim();
      buffer = buffer.slice(end).trimStart();
      if (chunk) playback?.speak({ text: chunk, itemId: reply.itemId });
    }
  }
  function endConversation(optOut: boolean) {
    if (optOut) {
      interrupt();
      suppressBdrPhone(context!.recipient.phone);
      updateBdrCall(callId, (row) => { row.detail = "Prospect opted out. Suppressed from future Actioneer calls."; });
    } else flush(true);
    ending = true;
    clearTimeout(interruptionTimeout);
    const hindi = context!.campaign.language !== "English";
    const farewell = optOut
      ? hindi ? "समझ गया। हम आपको दोबारा कॉल नहीं करेंगे। धन्यवाद।" : "Understood. We won't call you again. Goodbye."
      : hindi ? "आपके समय के लिए धन्यवाद। नमस्ते।" : "Thank you for your time. Goodbye.";
    // A normal hangup drains queued script audio and the farewell. It must not
    // clear the response that the model just generated but the caller hasn't heard.
    playback?.speak({ text: farewell, itemId: "farewell", kind: "farewell" });
    hangupTimeout = setTimeout(finishCall, 60_000);
  }
  function startRealtime() {
    if (!context || closed || realtime) return;
    const model = process.env.BDR_REALTIME_MODEL || "gpt-realtime-mini";
    realtime = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, perMessageDeflate: false });
    realtimeTimeout = setTimeout(() => failConversation("Conversation setup timed out. Check OpenAI Realtime access and Railway logs."), 10_000);
    realtime.on("open", () => {
      send(realtime, { type: "session.update", session: {
        type: "realtime", model, output_modalities: ["text"], instructions: instructions(),
        audio: { input: {
          format: { type: "audio/pcmu" }, noise_reduction: { type: "near_field" },
          transcription: { model: "gpt-4o-mini-transcribe" },
          // The phone playback queue, not text generation, owns turn-taking.
          turn_detection: { type: "server_vad", threshold: 0.65, silence_duration_ms: 650, prefix_padding_ms: 300, create_response: false, interrupt_response: false },
        } },
        tools: [
          { type: "function", name: "opt_out", description: "The prospect explicitly asked not to be contacted again. Stop the pitch and end the call.", parameters: { type: "object", properties: {}, additionalProperties: false } },
          { type: "function", name: "end_call", description: "End after a clear goodbye, decline, or completed follow-up agreement. Never use this merely because a single reply is complete.", parameters: { type: "object", properties: {}, additionalProperties: false } },
        ], tool_choice: "auto",
      } });
    });
    realtime.on("message", (raw) => {
      if (closed || !context) return;
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === "session.updated" && !ready) {
        ready = true;
        clearTimeout(realtimeTimeout);
        log("conversation ready");
        if (!openingInterrupted) {
          openingItemCreated = true;
          send(realtime, { type: "conversation.item.create", item: { id: "bdr_opening", type: "message", role: "assistant", content: [{ type: "output_text", text: personalizeBdr(context.campaign.opening, context.recipient) }] } });
        }
        for (const audio of pendingAudio.splice(0)) send(realtime, { type: "input_audio_buffer.append", audio });
        respond();
      } else if (event.type === "response.created") {
        const response = event.response as { id: string };
        if (!reply) return;
        reply.id = response.id;
        if (reply.interrupted) send(realtime, { type: "response.cancel", response_id: reply.id });
      } else if (event.type === "response.output_item.added" && event.response_id === reply?.id) {
        const item = event.item as { id: string; type: string };
        if (item.type === "message") reply!.itemId = item.id;
      } else if (event.type === "response.output_text.delta" && !ending && event.response_id === reply?.id && !reply?.interrupted) {
        reply!.itemId = String(event.item_id || reply!.itemId);
        const delta = String(event.delta || "");
        reply!.text += delta;
        buffer += delta; flush();
      } else if (event.type === "response.output_text.done" && !ending && event.response_id === reply?.id && !reply?.interrupted) {
        flush(true);
      } else if (event.type === "response.done") {
        const response = event.response as { id: string; status: string };
        if (response.id !== reply?.id) return;
        responseActive = false;
        if (response.status === "failed") { failConversation("Conversation response failed. Check OpenAI credits and model limits."); return; }
        repairInterruptedReply();
        respond();
      } else if (event.type === "input_audio_buffer.committed" && !ending) {
        const itemId = String(event.item_id);
        // For an ordinary caller turn, Realtime already has the audio. Start
        // the reply immediately; transcription is only a gate when deciding
        // whether overlapping speech is a backchannel or an interruption.
        if (!speaking && openingPlayed && !overlappedItems.has(itemId) && !responseActive && !playback?.pending) {
          awaitingTranscripts.delete(itemId);
          respondedFromAudio.add(itemId);
          lastUserId = itemId;
          pendingTurn = true;
          respond();
        }
      } else if (event.type === "conversation.item.input_audio_transcription.completed" && !ending) {
        const itemId = String(event.item_id);
        const text = String(event.transcript || "").trim();
        awaitingTranscripts.delete(itemId);
        if (completedItems.has(itemId)) return;
        completedItems.add(itemId);
        const overlapped = overlappedItems.delete(itemId);
        if (!text) { respond(); return; }
        transcript("user", text);
        if (respondedFromAudio.delete(itemId)) return;
        if (overlapped && isBackchannel(text) && !reply?.interrupted && !(openingInterrupted && !reply)) {
          const question = reply?.text || personalizeBdr(context.campaign.opening, context.recipient);
          if (/[?？]\s*$/.test(question) && !/^(?:hello|hi)$/i.test(text)) {
            // A short answer near the end of a question is real input. Let the
            // question finish, then answer once its playback marks arrive.
            lastUserId = itemId;
            pendingTurn = true;
            respond();
            return;
          }
          log("listening acknowledgement", { itemId });
          return;
        }
        interrupt();
        lastUserId = itemId;
        pendingTurn = true;
        respond();
      } else if (event.type === "conversation.item.input_audio_transcription.failed") {
        const itemId = String(event.item_id);
        awaitingTranscripts.delete(itemId);
        log("caller transcription failed", { itemId });
        // Transcription is supplementary; the conversation model still has
        // the caller's audio. Do not disconnect a working phone conversation.
        if (!respondedFromAudio.delete(itemId) && !ending) {
          interrupt(); lastUserId = itemId; pendingTurn = true; respond();
        }
      } else if (event.type === "input_audio_buffer.speech_started" && !ending) {
        speaking = true;
        awaitingTranscripts.add(String(event.item_id));
        clearTimeout(interruptionTimeout);
        if (playback?.pending || responseActive) {
          overlappedItems.add(String(event.item_id));
          // Wait through brief noises/backchannels. Longer speech can barge in
          // before its transcript arrives; short substantive speech interrupts
          // as soon as its transcript is available.
          interruptionTimeout = setTimeout(() => { if (speaking) interrupt(); }, 1200);
        }
      } else if (event.type === "input_audio_buffer.speech_stopped" && !ending) {
        speaking = false;
        lastSpeechStoppedAt = Date.now();
        clearTimeout(interruptionTimeout);
        respond();
      } else if (event.type === "response.function_call_arguments.done" && !ending && event.response_id === reply?.id && !reply?.interrupted && (event.name === "opt_out" || event.name === "end_call")) {
        endConversation(event.name === "opt_out");
      } else if (event.type === "error") {
        const error = event.error as { code?: string; message?: string } | undefined;
        if (error?.code !== "response_cancel_not_active") {
          console.error("[bdr] OpenAI Realtime error", { callId, code: error?.code, message: error?.message });
          failConversation(`Conversation service failed${error?.code ? ` (${error.code})` : ""}. Check the OpenAI key, model access, and credits.`);
        }
      }
    });
    realtime.on("error", (error: Error) => {
      console.error("[bdr] OpenAI Realtime connection error", { callId, message: error.message });
      const status = /Unexpected server response: (\d{3})/.exec(error.message)?.[1];
      failConversation(`Conversation connection failed${status ? ` (OpenAI HTTP ${status})` : ""}. Check the OpenAI key, billing, model access, and Railway logs.`);
    });
    realtime.on("close", () => { if (!closed && !ending) failConversation("Conversation connection closed unexpectedly."); });
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
      log("media stream started", { streamSid });
      clearTimeout(startTimeout);
      playback = new BdrPlayback({
        language: context.campaign.language, voiceId: context.campaign.voiceId,
        send: (event) => { if (!closed) send(socket, { ...event, streamSid }); },
        played: (segment) => {
          transcript("assistant", segment.text, "played");
          if (reply?.itemId === segment.itemId) reply.spoken.push(segment.text);
          if (segment.kind === "opening") {
            openingPlayed = true;
            clearTimeout(openingTimeout);
            log("opening playback acknowledged");
            if (conversationFailure) fail(conversationFailure);
            else respond();
          } else if (segment.kind === "farewell") finishCall();
          else respond();
        },
        interrupted: (segment) => transcript("assistant", segment.text, "interrupted"),
        firstAudio: (segment, synthesisMs) => {
          if (segment.kind === "opening") log("opening first audio", { synthesisMs });
          else if (reply && !reply.firstAudio && reply.itemId === segment.itemId) {
            reply.firstAudio = true;
            log("reply first audio", { responseId: reply.id, synthesisMs, responseToAudioMs: Date.now() - reply.requestedAt, turnToAudioMs: reply.inputEndedAt ? Date.now() - reply.inputEndedAt : undefined });
          }
        },
        failed: (error) => {
          console.error("[bdr] Cartesia speech failed", { callId, error: error instanceof Error ? error.message : "Unknown error" });
          fail("Speech generation failed. Check Cartesia credentials, voice, and credits before resuming.");
        },
      });
      openingTimeout = setTimeout(() => fail("Opening audio was not acknowledged by Twilio. Check the media stream and Railway logs."), 35_000);
      playback.speak({ text: personalizeBdr(context.campaign.opening, context.recipient), itemId: "bdr_opening", kind: "opening" });
      // Warm up the conversation connection while the opening is being spoken.
      startRealtime();
    } else if (event.event === "media" && context && !ending) {
      const audio = event.media?.payload;
      if (typeof audio !== "string" || audio.length > 16_000) return;
      if (ready) send(realtime, { type: "input_audio_buffer.append", audio });
      else {
        pendingAudio.push(audio);
        if (pendingAudio.length > 50) pendingAudio.shift(); // at most 1s, never replay 10s of stale audio
      }
    } else if (event.event === "mark") playback?.acknowledge(String(event.mark?.name || ""));
    else if (event.event === "stop") close();
  });
  socket.on("close", (code: number) => { log("media stream closed", { code, openingPlayed, conversationReady: ready }); close(); });
  socket.on("error", (error: Error) => { console.error("[bdr] media stream error", { callId, message: error.message }); close(); });
}
