"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, PhoneCall, PhoneOff, UserRound } from "lucide-react";
import { VoiceVoxel } from "@/components/voice-campaigns/voice-voxel";
import { mergeIncrementalTranscript } from "@/lib/plivo-gemini-live-transcript-guards";

interface TranscriptEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
}

type SessionState = "idle" | "connecting" | "ready" | "ended" | "error";
const STARTUP_TIMEOUT_MS = 8000;

interface VoiceTestPanelProps {
  campaignId?: string;
  systemPrompt: string;
  firstMessage: string;
  voice: string;
  datasetId?: string;
  modelLabel?: string;
  campaignName?: string;
  autoStart?: boolean;
  onAutoStartConsumed?: () => void;
  onClose?: () => void;
  showVoiceMetadata?: boolean;
  /** "floating" = rounded, shadowed call card (default). "embedded" = flat, sharp
   *  corners, top-border only — for docking flush inside a bordered panel. */
  variant?: "floating" | "embedded";
  /** Fired whenever the running transcript changes (grouped by speaker). Used by
   *  roleplay training to grade the call after it ends. Optional — no-op otherwise. */
  onTranscriptChange?: (turns: { role: "user" | "assistant"; text: string }[]) => void;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function withTimeout<T>(promise: Promise<T>, message: string, ms = STARTUP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

export function VoiceTestPanel({
  campaignId,
  systemPrompt,
  firstMessage,
  voice,
  datasetId,
  modelLabel,
  campaignName,
  autoStart = false,
  onAutoStartConsumed,
  onClose,
  showVoiceMetadata = true,
  onTranscriptChange,
  variant = "floating",
}: VoiceTestPanelProps) {
  const [state, setState] = useState<SessionState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const modelRouteLabel = modelLabel?.trim() || "Model";

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextPlayTimeRef = useRef(0);
  const suppressMicUntilRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptBottomRef = useRef<HTMLDivElement | null>(null);
  const entryIdRef = useRef(0);
  const forceNewTranscriptTurnRef = useRef(false);
  const mutedRef = useRef(false);
  const autoStartedRef = useRef(false);
  const callTimerStartedRef = useRef(false);

  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);

  useEffect(() => {
    transcriptBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    if (!startedAtMs || (state !== "connecting" && state !== "ready")) return;
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAtMs, state]);

  const startCallTimer = useCallback(() => {
    if (callTimerStartedRef.current) return;
    callTimerStartedRef.current = true;
    setStartedAtMs(Date.now());
    setElapsedSeconds(0);
  }, []);

  const stopPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Source may have already ended.
      }
      source.disconnect();
    }
    activeSourcesRef.current.clear();
    nextPlayTimeRef.current = 0;
    suppressMicUntilRef.current = 0;
  }, []);

  const stopSession = useCallback((nextState: SessionState = "ended", options?: { updateState?: boolean }) => {
    stopPlayback();
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    monitorGainRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    wsRef.current?.close();
    wsRef.current = null;
    audioCtxRef.current = null;
    processorRef.current = null;
    sourceRef.current = null;
    monitorGainRef.current = null;
    streamRef.current = null;
    if (options?.updateState !== false) setState(nextState);
  }, [stopPlayback]);

  // Clean up when component unmounts (Back button → showLiveTest = false)
  useEffect(() => () => {
    autoStartedRef.current = false;
    stopSession("ended", { updateState: false });
  }, [stopSession]);

  const playPcm16 = useCallback((base64: string, sampleRate: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const bytes = atob(base64);
    const int16 = new Int16Array(bytes.length / 2);
    for (let i = 0; i < int16.length; i++) {
      int16[i] = (bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8));
    }
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.getChannelData(0).set(float32);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    activeSourcesRef.current.add(src);
    src.onended = () => {
      activeSourcesRef.current.delete(src);
      src.disconnect();
    };
    src.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
    suppressMicUntilRef.current = Math.max(suppressMicUntilRef.current, nextPlayTimeRef.current + 0.15);
  }, []);

  const startSession = useCallback(async () => {
    if (state === "connecting" || state === "ready") return;
    if (!systemPrompt) {
      setError("No prompt compiled yet. Select a template, segment, and offer first.");
      return;
    }
    callTimerStartedRef.current = false;
    setError(null);
    setTranscript([]);
    setState("connecting");
    setStartedAtMs(null);
    setElapsedSeconds(0);

    let stream: MediaStream;
    try {
      stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }),
        "Microphone did not start. Check browser mic permission and try again.",
      );
    } catch (err) {
      setError((err as Error).message || "Microphone permission denied.");
      setState("error");
      return;
    }
    streamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = ctx;
    nextPlayTimeRef.current = 0;
    // Resume AudioContext — browsers block audio until explicitly resumed
    try {
      if (ctx.state === "suspended") {
        await withTimeout(ctx.resume(), "Audio playback was blocked. Click the mic button again.", 4000);
      }
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      audioCtxRef.current = null;
      await ctx.close().catch(() => undefined);
      setError((err as Error).message);
      setState("error");
      return;
    }

    const host = window.location.host;
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${host}/voice-test-stream`);
    wsRef.current = ws;

    // Timeout: if we don't get "ready" within 15s, surface an error
    const readyTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        setError("Connection timed out — Gemini did not respond. Check your API key.");
        stopSession();
      }
    }, 15000);

    ws.onopen = () => {
      console.log("[voice-test] WS open — sending start");
      ws.send(JSON.stringify({ type: "start", campaignId, systemPrompt, firstMessage, voice, datasetId }));

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN || mutedRef.current) return;
        if (wsRef.current !== ws) return;
        if (ctx.currentTime < suppressMicUntilRef.current) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
        }
        const bytes = new Uint8Array(int16.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        ws.send(JSON.stringify({ type: "audio", data: btoa(binary) }));
      };

      source.connect(processor);
      const monitorGain = ctx.createGain();
      monitorGain.gain.value = 0;
      monitorGainRef.current = monitorGain;
      processor.connect(monitorGain);
      monitorGain.connect(ctx.destination);
    };

    ws.onmessage = (e) => {
      if (wsRef.current !== ws) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(e.data as string) as Record<string, unknown>; }
      catch { console.error("[voice-test] bad JSON from server:", e.data); return; }
      console.log("[voice-test] ←", msg.type);
      if (msg.type === "ready") {
        clearTimeout(readyTimeout);
        setState("ready");
      } else if (msg.type === "audio") {
        clearTimeout(readyTimeout);
        setState((current) => current === "connecting" ? "ready" : current);
        startCallTimer();
        playPcm16(msg.data as string, (msg.sampleRate as number) ?? 24000);
      } else if (msg.type === "transcript") {
        clearTimeout(readyTimeout);
        setState((current) => current === "connecting" ? "ready" : current);
        const role = msg.role as "user" | "assistant";
        const text = (msg.text as string).replace(/\s+/g, " ").trim();
        if (!text) return;
        if (role === "assistant") startCallTimer();
        setTranscript((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === role && !forceNewTranscriptTurnRef.current) {
            return [
              ...prev.slice(0, -1),
              { ...last, text: mergeIncrementalTranscript(last.text, text) },
            ];
          }
          forceNewTranscriptTurnRef.current = false;
          return [...prev, { id: ++entryIdRef.current, role, text }];
        });
      } else if (msg.type === "interrupted") {
        forceNewTranscriptTurnRef.current = true;
        stopPlayback();
      } else if (msg.type === "turn_complete") {
        forceNewTranscriptTurnRef.current = true;
      } else if (msg.type === "error") {
        setError(msg.message as string);
        stopSession("error");
      }
    };

    ws.onerror = (ev) => { clearTimeout(readyTimeout); console.error("[voice-test] WS error", ev); setError("WebSocket connection failed."); setState("error"); };
    ws.onclose = (ev) => {
      clearTimeout(readyTimeout);
      console.log("[voice-test] WS closed code=", ev.code, ev.reason);
      if (wsRef.current !== ws) return;
      setState((s) => s !== "ended" && s !== "error" ? "ended" : s);
    };
  }, [state, campaignId, systemPrompt, firstMessage, voice, datasetId, playPcm16, startCallTimer, stopPlayback, stopSession]);

  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    onAutoStartConsumed?.();
    void startSession();
  }, [autoStart, onAutoStartConsumed, startSession]);

  const isActive = state === "connecting" || state === "ready";
  const callTitle = campaignName?.trim() || "browser-live-test";
  const statusText = error
      ? "Connection issue"
      : state === "connecting"
        ? "Connecting"
        : state === "ready"
          ? "Live"
          : state === "ended"
            ? "Ended"
            : "Ready";
  const callSubtitle = state === "ready"
      ? "Live call"
      : state === "connecting"
        ? "Connecting to agent"
        : state === "ended"
          ? "Session ended"
          : state === "error"
            ? "Ready to retry"
            : "Ready to start";
  const visibleTranscript = useMemo(() => {
    const grouped: TranscriptEntry[] = [];
    for (const entry of transcript) {
      const last = grouped.at(-1);
      if (last?.role === entry.role) {
        last.text = `${last.text} ${entry.text}`.replace(/\s+/g, " ").trim();
        continue;
      }
      grouped.push({ ...entry });
    }
    return grouped;
  }, [transcript]);
  useEffect(() => {
    onTranscriptChange?.(visibleTranscript.map((e) => ({ role: e.role, text: e.text })));
  }, [visibleTranscript, onTranscriptChange]);
  const transcriptWeight = visibleTranscript.reduce((total, entry) => total + Math.max(1, Math.ceil(entry.text.length / 72)), 0);
  const showStage = visibleTranscript.length > 0;
  const stageHeight = showStage ? Math.min(384, 64 + visibleTranscript.length * 34 + transcriptWeight * 24) : 0;

  const endLiveTest = () => {
    if (isActive) stopSession();
    onClose?.();
  };
  const canStart = state === "idle" || state === "ended" || state === "error";

  return (
    <div
      className={
        variant === "embedded"
          ? "overflow-hidden border-t border-border bg-background text-foreground"
          : "overflow-hidden rounded-3xl border border-border/70 bg-background/75 text-foreground shadow-2xl shadow-black/20 backdrop-blur-xl"
      }
    >
      <div
        className={`overflow-hidden transition-[height,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
          showStage ? "opacity-100" : "opacity-0"
        }`}
        style={{ height: stageHeight }}
      >
        <div className="h-full overflow-y-auto px-5 pb-3 pt-5">
          <div className="space-y-4">
            {visibleTranscript.map((entry) => (
              <div
                key={entry.id}
                className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`flex max-w-[82%] items-start gap-3 ${
                    entry.role === "user" ? "flex-row" : ""
                  }`}
                >
                  {entry.role === "assistant" && (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/70">
                      <VoiceVoxel voiceName={voice} size={22} animate={state === "ready"} />
                    </span>
                  )}
                  {entry.role === "user" && (
                    <span className="order-2 flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-foreground text-background">
                      <UserRound className="size-4" />
                    </span>
                  )}
                  <div className={`min-w-0 pt-1 ${entry.role === "user" ? "order-1 text-right" : ""}`}>
                    <p className="text-sm leading-relaxed text-foreground">{entry.text}</p>
                  </div>
                </div>
              </div>
            ))}
            <div ref={transcriptBottomRef} />
          </div>
        </div>
      </div>

      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3 ${showStage ? "border-t border-border/60" : ""}`}>
        <div className="flex min-w-0 items-center gap-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{callTitle}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="shrink-0">{callSubtitle}</span>
              <span className="text-muted-foreground/50">·</span>
              <span className="truncate">{modelRouteLabel}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {showVoiceMetadata && (
            <button
              type="button"
              onClick={() => setIsMuted((v) => !v)}
              disabled={!isActive || state === "connecting"}
              aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={isMuted}
              className={`hidden size-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/40 transition-[opacity,transform,border-color] duration-150 ease-out active:scale-[0.96] disabled:cursor-default disabled:opacity-60 sm:flex ${
                isMuted ? "opacity-45" : "opacity-100"
              }`}
            >
              <VoiceVoxel voiceName={voice} size={22} animate={state === "connecting" || state === "ready"} />
            </button>
          )}
          <div className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground md:flex">
            <span className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${isActive ? "bg-foreground/70" : "bg-muted-foreground/30"}`} />
              {statusText}
            </span>
          </div>
          <span className="w-10 text-right font-mono text-sm tabular-nums text-muted-foreground">
            {formatDuration(elapsedSeconds)}
          </span>
          <button
            type="button"
            onClick={canStart ? () => void startSession() : endLiveTest}
            disabled={state === "connecting"}
            className={`flex size-12 items-center justify-center rounded-full text-white transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-70 ${
              canStart
                ? "bg-emerald-600 hover:bg-emerald-500"
                : "bg-destructive hover:bg-destructive/90"
            }`}
            aria-label={canStart ? "Start live test" : "End live test"}
          >
            {state === "connecting" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : canStart ? (
              <PhoneCall className="size-5" />
            ) : (
              <PhoneOff className="size-5" />
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="border-t border-border/60 px-5 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
