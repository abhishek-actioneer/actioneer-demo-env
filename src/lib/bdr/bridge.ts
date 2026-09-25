import { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import twilio from "twilio";
import { requirePublicBaseUrl } from "@/lib/public-base-url";
import { BdrPlayback } from "./playback";
import { applyBdrCallStatus, bdrTwilio, validBdrStreamToken } from "./telephony";
import { findBdrCall, suppressBdrPhone, updateBdrCall } from "./store";
import { personalizeBdr } from "./types";
import { BDR_SCREENING_IDENTITY, getBdrTemplate } from "./templates";
import { detectBdrAnswerMode, isBdrScreeningHold } from "./answer-mode";
import { BDR_SPEAKING_STYLE, takeBdrSpeechPhrase } from "./speaking-style";

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
  let answerMode: "conversation" | "screening" | "voicemail_wait" | "voicemail" = "conversation";
  let humanConfirmed = false;
  let screeningIdentitySent = false;
  let resumedFromScreening = false;
  let lastAmdResult = "";
  let pendingAmdResult = "";
  let pendingAmdSince = 0;
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
  let screeningTimeout: ReturnType<typeof setTimeout> | undefined;
  let voicemailTimeout: ReturnType<typeof setTimeout> | undefined;
  let amdPoll: ReturnType<typeof setInterval> | undefined;

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
    clearTimeout(screeningTimeout);
    clearTimeout(voicemailTimeout);
    clearInterval(amdPoll);
    playback?.clear(false);
    realtime?.close();
    socket.close();
  }
  function transcript(role: "user" | "assistant", text: string, delivery?: "played" | "interrupted", source?: "screening" | "voicemail") {
    if (!text.trim()) return;
    updateBdrCall(callId, (row) => {
      row.transcript = [...(row.transcript || []), { role, text: text.slice(0, 8000), ...(delivery ? { delivery } : {}), ...(source ? { source } : {}) }].slice(-120);
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

${BDR_SPEAKING_STYLE}

Runtime speaking rules:
- Your name is Daniel from Actioneer. Introduce yourself that way, not as "an AI assistant". If directly asked whether you are AI, answer truthfully that you are Actioneer's voice agent.
- The opening is handled by the phone server. Do not repeat the introduction or ask permission twice.
- Speak ${context.campaign.language}. Return only the words to say aloud, with no stage directions.
- Follow the campaign script in order, keeping track of points actually covered. Respond to the answer, then advance to the next relevant point. Do not restart the pitch.
- Use one or two concise sentences per turn and at most one question; let the prospect answer before moving on.
- If interrupted, answer the prospect's question, then resume the unfinished point naturally. Never assume unheard text was delivered. Do not repeatedly ask them to say the same thing.
- Use opt_out when asked not to contact them again. Use end_call only after a clear decline, goodbye, or agreed follow-up outcome; never just because one response is finished.
- For an agreed follow-up, call end_call with outcome="follow_up". The server says "Someone from my team shall reach out shortly." Do not refer to "a human colleague" or repeat that closing. A meeting has not been booked or a message sent.
- Automated screening: call screen_call, then wait for the actual person. Voicemail greeting: call voicemail_detected; do not pitch until the server detects the greeting ending.
- Current phone state: ${answerMode}.${resumedFromScreening ? " The person has now picked up after screening; greet them briefly and start the campaign discovery question." : ""}`;
  }
  function respond() {
    if (!ready || closed || ending || answerMode !== "conversation" || speaking || awaitingTranscripts.size || responseActive || playback?.pending || !pendingTurn || (!openingPlayed && !openingInterrupted)) return;
    repairInterruptedReply();
    const interrupted = reply?.interrupted || (!reply && openingInterrupted);
    pendingTurn = false;
    responseActive = true;
    reply = { id: "", itemId: "", parentId: lastUserId, spoken: [], interrupted: false, repaired: false, firstAudio: false, requestedAt: Date.now(), inputEndedAt: lastSpeechStoppedAt, text: "" };
    send(realtime, { type: "response.create", response: {
      output_modalities: ["text"],
      instructions: `${instructions()}${interrupted ? "\nThe previous spoken turn was interrupted. Only the retained assistant text was fully heard. Briefly address the prospect and continue the unfinished point." : ""}`,
    } });
    resumedFromScreening = false;
    log("response requested");
  }
  function flush(force = false) {
    if (!reply || reply.interrupted) return;
    while (buffer) {
      const phrase = takeBdrSpeechPhrase(buffer, force);
      if (!phrase) break;
      buffer = phrase.rest;
      playback?.speak({ text: phrase.text, itemId: reply.itemId });
    }
  }
  function endConversation(optOut: boolean, followUp = false) {
    if (optOut) {
      interrupt();
      suppressBdrPhone(context!.recipient.phone);
      updateBdrCall(callId, (row) => { row.detail = "Prospect opted out. Suppressed from future Actioneer calls."; });
    } else { flush(true); if (reply?.itemId) playback?.finishTurn(reply.itemId); }
    ending = true;
    clearTimeout(interruptionTimeout);
    const hindi = context!.campaign.language !== "English";
    if (followUp && !optOut) updateBdrCall(callId, (row) => { row.followUpRequested = true; });
    const farewell = optOut
      ? hindi ? "समझ गया। हम आपको दोबारा कॉल नहीं करेंगे। धन्यवाद।" : "Understood. We won't call you again. Goodbye."
      : followUp ? hindi ? "मेरी टीम से कोई जल्द ही आपसे संपर्क करेगा। आपके समय के लिए धन्यवाद। आपका दिन शुभ हो।" : "Someone from my team shall reach out shortly. Thank you for your time, and have a wonderful day."
        : hindi ? "आपके समय के लिए धन्यवाद। आपका दिन शुभ हो।" : "Thank you for your time, and have a wonderful day.";
    // A normal hangup drains queued script audio and the farewell. It must not
    // clear the response that the model just generated but the caller hasn't heard.
    playback?.speak({ text: farewell, itemId: "farewell", kind: "farewell" });
    hangupTimeout = setTimeout(finishCall, 60_000);
  }
  function pausePitch() {
    interrupt();
    playback?.clear();
    buffer = "";
    pendingTurn = false;
    openingInterrupted = true;
    clearTimeout(openingTimeout);
    clearTimeout(interruptionTimeout);
  }
  function screenCall() {
    if (closed || ending || answerMode === "voicemail") return;
    if (answerMode === "screening" && screeningIdentitySent) return;
    pausePitch();
    answerMode = "screening";
    humanConfirmed = false;
    updateBdrCall(callId, (row) => { row.callOutcome = "screening"; });
    clearTimeout(voicemailTimeout);
    if (!screeningIdentitySent) {
      screeningIdentitySent = true;
      playback?.speak({ text: BDR_SCREENING_IDENTITY, itemId: "screening_identity", kind: "screening" });
    }
    clearTimeout(screeningTimeout);
    screeningTimeout = setTimeout(finishCall, 90_000);
    log("waiting for person after screening");
  }
  function leaveVoicemail() {
    if (closed || ending || !context) return;
    pausePitch();
    answerMode = "voicemail";
    ending = true;
    clearTimeout(screeningTimeout);
    clearTimeout(voicemailTimeout);
    updateBdrCall(callId, (row) => { row.callOutcome = "voicemail"; row.sentiment = undefined; row.sentimentState = "not_applicable"; });
    const message = context.campaign.voicemail || getBdrTemplate(context.campaign.templateId).voicemail;
    playback?.speak({ text: personalizeBdr(message, context.recipient), itemId: "voicemail", kind: "voicemail" });
    hangupTimeout = setTimeout(finishCall, 60_000);
    log("leaving voicemail");
  }
  function awaitVoicemailEnd() {
    if (closed || ending) return;
    pausePitch();
    answerMode = "voicemail_wait";
    humanConfirmed = false;
    clearTimeout(screeningTimeout);
    updateBdrCall(callId, (row) => { row.callOutcome = "voicemail"; });
    scheduleVoicemailFallback();
  }
  function scheduleVoicemailFallback() {
    clearTimeout(voicemailTimeout);
    // AMD's beep/end result is preferred. A completed, recognized greeting
    // followed by quiet is a fallback for machines AMD reports as unknown.
    if (answerMode === "voicemail_wait" && !speaking && !awaitingTranscripts.size) {
      voicemailTimeout = setTimeout(leaveVoicemail, 2500);
    }
  }
  function checkAnsweringMachine() {
    if (closed || ending) return;
    const result = findBdrCall(callId)?.recipient.answeredBy;
    if (!result || result === lastAmdResult) return;
    if (result !== pendingAmdResult) { pendingAmdResult = result; pendingAmdSince = Date.now(); }
    if (result.startsWith("machine_end_") && (speaking || awaitingTranscripts.size || Date.now() - pendingAmdSince < 1500)) return;
    lastAmdResult = result;
    // Silence while Apple is finding the person is not a voicemail greeting.
    // Never let a late AMD verdict interrupt an established human conversation.
    if (result.startsWith("machine_end_") && !humanConfirmed && (answerMode !== "screening" || result === "machine_end_beep")) leaveVoicemail();
    else if (result === "fax" && !humanConfirmed) finishCall();
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
          { type: "function", name: "end_call", description: "End after a clear goodbye, decline, or agreed follow-up. Use follow_up only when the prospect explicitly accepts a team follow-up. The server speaks the closing.", parameters: { type: "object", properties: { outcome: { type: "string", enum: ["follow_up", "declined", "finished"] } }, required: ["outcome"], additionalProperties: false } },
          { type: "function", name: "screen_call", description: "An automated Apple/Google call screener asked for name or reason. Identify Daniel once, then wait silently for the person. Not for a human asking about screening features.", parameters: { type: "object", properties: {}, additionalProperties: false } },
          { type: "function", name: "voicemail_detected", description: "A recorded voicemail greeting asks to leave a message. Wait for the end of the greeting, then leave the campaign voicemail. Not for a human asking about voicemail features.", parameters: { type: "object", properties: {}, additionalProperties: false } },
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
        if (reply?.itemId) playback?.finishTurn(reply.itemId);
      } else if (event.type === "response.done") {
        const response = event.response as { id: string; status: string };
        if (response.id !== reply?.id) return;
        responseActive = false;
        if (response.status === "failed") { failConversation("Conversation response failed. Check OpenAI credits and model limits."); return; }
        if (!reply?.interrupted && !ending) { flush(true); if (reply?.itemId) playback?.finishTurn(reply.itemId); }
        repairInterruptedReply();
        respond();
      } else if (event.type === "input_audio_buffer.committed" && !ending) {
        const itemId = String(event.item_id);
        // For an ordinary caller turn, Realtime already has the audio. Start
        // the reply immediately; transcription is only a gate when deciding
        // whether overlapping speech is a backchannel or an interruption.
        if (humanConfirmed && answerMode === "conversation" && !speaking && openingPlayed && !overlappedItems.has(itemId) && !responseActive && !playback?.pending) {
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
        const detected = !humanConfirmed || answerMode !== "conversation" ? detectBdrAnswerMode(text) : undefined;
        if (detected === "screening") { transcript("user", text, undefined, "screening"); screenCall(); return; }
        if (detected === "voicemail") { transcript("user", text, undefined, "voicemail"); awaitVoicemailEnd(); return; }
        if (answerMode === "screening" && isBdrScreeningHold(text)) { transcript("user", text, undefined, "screening"); return; }
        if (answerMode === "voicemail_wait") { transcript("user", text, undefined, "voicemail"); scheduleVoicemailFallback(); return; }
        if (answerMode === "screening") {
          answerMode = "conversation";
          resumedFromScreening = true;
          clearTimeout(screeningTimeout);
        }
        humanConfirmed = true;
        updateBdrCall(callId, (row) => { row.callOutcome = "conversation"; });
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
        clearTimeout(voicemailTimeout);
        awaitingTranscripts.add(String(event.item_id));
        clearTimeout(interruptionTimeout);
        if (answerMode === "conversation" && (playback?.pending || responseActive)) {
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
        scheduleVoicemailFallback();
        respond();
      } else if (event.type === "response.function_call_arguments.done" && !ending && event.response_id === reply?.id && !reply?.interrupted) {
        if (event.name === "screen_call" || event.name === "voicemail_detected") {
          send(realtime, { type: "conversation.item.create", item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify({ status: "waiting", instruction: "The phone server handles this mode. Wait for the actual person or voicemail completion." }) } });
          if (event.name === "screen_call") screenCall();
          else awaitVoicemailEnd();
        }
        else if (event.name === "opt_out" || event.name === "end_call") {
          let args: { outcome?: string } = {};
          try { args = JSON.parse(String(event.arguments || "{}")); } catch { /* Missing outcome uses the generic closing. */ }
          endConversation(event.name === "opt_out", args.outcome === "follow_up");
        }
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
          transcript("assistant", segment.text, "played", segment.kind === "screening" || segment.kind === "voicemail" ? segment.kind : undefined);
          if (reply?.itemId === segment.itemId) reply.spoken.push(segment.text);
          if (segment.kind === "opening") {
            openingPlayed = true;
            clearTimeout(openingTimeout);
            log("opening playback acknowledged");
            if (conversationFailure) fail(conversationFailure);
            else respond();
          } else if (segment.kind === "farewell" || segment.kind === "voicemail") finishCall();
          else respond();
        },
        interrupted: (segment) => transcript("assistant", segment.text, "interrupted", segment.kind === "screening" || segment.kind === "voicemail" ? segment.kind : undefined),
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
      amdPoll = setInterval(checkAnsweringMachine, 500);
      checkAnsweringMachine();
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
