import { WebSocket } from "ws";
import type { CallConfig } from "./voice-call-state";
import { resolveCallConfig } from "./voice-call-config-resolver";
import { ensureGeminiLiveConfig } from "./voice-agent-provider";
import { plivoMulawToGeminiPcm16 } from "./telephony-audio";
import {
  CLIENT_CONTROLLED_ACTIVITY_ENABLED,
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_VOICE,
  MULAW_SILENCE_FRAME,
  PREWARM_IDLE_TTL_MS,
  PREWARM_KEEPALIVE_MS,
  PREWARM_TIMEOUT_MS,
  geminiSetupPayload,
  logGeminiLiveSystemInstruction,
  buildGeminiLiveSystemInstruction,
  openGeminiSocket,
  resolveGeminiVoice,
} from "./plivo-gemini-live-config";
import { isOpen, parseEvent, sendJson, socketCanClose } from "./plivo-gemini-live-ws-utils";

export interface WarmGeminiSession {
  callId: string;
  callConfig: CallConfig;
  ws: WebSocket;
  createdAt: number;
  setupComplete: boolean;
  claimed: boolean;
  ready: Promise<void>;
  idleTimer?: NodeJS.Timeout;
  keepaliveTimer?: NodeJS.Timeout;
  onOpen: () => void;
  onMessage: (data: WebSocket.RawData) => void;
  onClose: (code: number, reason: Buffer) => void;
  onError: (err: Error) => void;
}

// IMPORTANT: this Map MUST be a process-wide singleton.
const warmSessions: Map<string, WarmGeminiSession> =
  ((globalThis as { __voiceWarmGeminiSessions?: Map<string, WarmGeminiSession> }).__voiceWarmGeminiSessions ??=
    new Map<string, WarmGeminiSession>());

function detachWarmSessionListeners(session: WarmGeminiSession): void {
  session.ws.off("open", session.onOpen);
  session.ws.off("message", session.onMessage);
  session.ws.off("close", session.onClose);
  session.ws.off("error", session.onError);
  if (session.idleTimer) clearTimeout(session.idleTimer);
  if (session.keepaliveTimer) clearInterval(session.keepaliveTimer);
}

function sendPrewarmKeepalive(ws: WebSocket): void {
  // With client-controlled activity, audio outside activityStart is ignored / errors —
  // skip silence keepalive (setupComplete alone keeps the warm socket usable).
  if (CLIENT_CONTROLLED_ACTIVITY_ENABLED) return;
  sendJson(ws, {
    realtimeInput: {
      audio: {
        data: plivoMulawToGeminiPcm16(MULAW_SILENCE_FRAME),
        mimeType: "audio/pcm;rate=16000",
      },
    },
  });
}

function startPrewarmKeepalive(session: WarmGeminiSession): void {
  if (CLIENT_CONTROLLED_ACTIVITY_ENABLED) return;
  if (session.keepaliveTimer) clearInterval(session.keepaliveTimer);
  session.keepaliveTimer = setInterval(() => {
    if (session.claimed || !session.setupComplete || !isOpen(session.ws)) return;
    sendPrewarmKeepalive(session.ws);
  }, PREWARM_KEEPALIVE_MS);
}

function closeWarmSession(callId: string, reason: string): void {
  const session = warmSessions.get(callId);
  if (!session) return;
  warmSessions.delete(callId);
  detachWarmSessionListeners(session);
  console.log(`[voice/gemini-live] prewarm closed callId=${callId} reason=${reason}`);
  if (!socketCanClose(session.ws)) return;
  try {
    session.ws.close();
  } catch {
    // ws can throw "closed before the connection was established" when still CONNECTING
  }
}

export function claimWarmGeminiSession(callId: string): WarmGeminiSession | undefined {
  const session = warmSessions.get(callId);
  if (!session || session.claimed) return undefined;
  if (!session.setupComplete) return undefined;
  if (!isOpen(session.ws)) {
    closeWarmSession(callId, "claim-not-open");
    return undefined;
  }
  warmSessions.delete(callId);
  session.claimed = true;
  detachWarmSessionListeners(session);
  return session;
}

/**
 * Move a ready, unclaimed warm session from one callId key to another.
 * Used by the public inbound demo: a DID-level standby session is rekeyed to
 * the real callId minted in the answer webhook so startGemini can claim it.
 */
export function rekeyWarmGeminiSession(fromCallId: string, toCallId: string): boolean {
  if (!fromCallId || !toCallId || fromCallId === toCallId) return false;
  const session = warmSessions.get(fromCallId);
  if (!session || session.claimed || !session.setupComplete) return false;
  if (!isOpen(session.ws)) {
    closeWarmSession(fromCallId, "rekey-not-open");
    return false;
  }
  // Don't clobber an already-ready session for the destination callId.
  const existing = warmSessions.get(toCallId);
  if (existing && !existing.claimed && existing.setupComplete && isOpen(existing.ws)) {
    return false;
  }
  if (existing) closeWarmSession(toCallId, "rekey-replace");
  warmSessions.delete(fromCallId);
  session.callId = toCallId;
  warmSessions.set(toCallId, session);
  console.log(`[voice/gemini-live] prewarm rekeyed from=${fromCallId} to=${toCallId}`);
  return true;
}

export function dropPendingWarmSessionBeforeClaim(callId: string): void {
  const pendingWarmSession = warmSessions.get(callId);
  if (pendingWarmSession && !pendingWarmSession.claimed && !pendingWarmSession.setupComplete) {
    closeWarmSession(callId, "claim-before-ready");
  }
}

export async function prewarmGeminiLiveCallSession(callId: string, callConfig: CallConfig): Promise<void> {
  const existing = warmSessions.get(callId);
  if (existing && !existing.claimed) return existing.ready;

  ensureGeminiLiveConfig();
  const createdAt = Date.now();
  const ws = openGeminiSocket();
  const geminiVoice = resolveGeminiVoice(callConfig.voice || GEMINI_LIVE_VOICE);
  console.log(
    `[voice/gemini-live] prewarm start callId=${callId} model=${GEMINI_LIVE_MODEL} voice=${geminiVoice}`,
  );
  const systemInstructionText = buildGeminiLiveSystemInstruction(callConfig);
  logGeminiLiveSystemInstruction(systemInstructionText, {
    language: callConfig.language,
    campaignId: callConfig.campaignId,
    callId,
    source: "prewarm",
  });

  let settled = false;
  const timeoutRef: { current?: NodeJS.Timeout } = {};
  let resolveReady: () => void = () => {};
  let rejectReady: (err: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const session: WarmGeminiSession = {
    callId,
    callConfig,
    ws,
    createdAt,
    setupComplete: false,
    claimed: false,
    ready,
    onOpen: () => {
      sendJson(ws, geminiSetupPayload(callConfig));
    },
    onMessage: (data) => {
      const event = parseEvent(data);
      if (!event) return;
      if (event.error) {
        const err = new Error(`Gemini prewarm error: ${JSON.stringify(event.error)}`);
        if (!settled) {
          settled = true;
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          warmSessions.delete(callId);
          rejectReady(err);
        }
        return;
      }
      if (event.setupComplete) {
        session.setupComplete = true;
        if (!settled) {
          settled = true;
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          console.log(`[voice/gemini-live] prewarm ready callId=${callId} t=+${Date.now() - createdAt}ms`);
          session.idleTimer = setTimeout(() => closeWarmSession(callId, "idle-timeout"), PREWARM_IDLE_TTL_MS);
          startPrewarmKeepalive(session);
          resolveReady();
        }
      }
    },
    onClose: (code, reason) => {
      if (session.claimed) return;
      warmSessions.delete(callId);
      if (!settled) {
        settled = true;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        rejectReady(new Error(`Gemini prewarm closed code=${code} reason=${reason.toString() || "(empty)"}`));
      }
    },
    onError: (err) => {
      if (session.claimed) return;
      warmSessions.delete(callId);
      if (!settled) {
        settled = true;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        rejectReady(err);
      }
    },
  };

  warmSessions.set(callId, session);
  ws.on("open", session.onOpen);
  ws.on("message", session.onMessage);
  ws.on("close", session.onClose);
  ws.on("error", session.onError);

  timeoutRef.current = setTimeout(() => {
    if (settled) return;
    settled = true;
    warmSessions.delete(callId);
    detachWarmSessionListeners(session);
    if (socketCanClose(ws)) ws.close();
    rejectReady(new Error(`Gemini prewarm timed out after ${PREWARM_TIMEOUT_MS}ms`));
  }, PREWARM_TIMEOUT_MS);

  return ready;
}

export function refreshGeminiPrewarmOnAnswer(callId: string): void {
  const cleanCallId = callId.trim();
  if (!cleanCallId) return;

  const callConfig = resolveCallConfig(cleanCallId);
  if (!callConfig) return;

  const existing = warmSessions.get(cleanCallId);
  if (existing && !existing.claimed && existing.setupComplete && isOpen(existing.ws)) {
    return;
  }

  void prewarmGeminiLiveCallSession(cleanCallId, callConfig).catch((error) => {
    console.error(`[voice/gemini-live] answer-time prewarm failed callId=${cleanCallId}:`, error);
  });
}
