import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { bdrSpeechChunks } from "./cartesia";

interface SpeechContext { id: string; turnId: string; nextFlushId?: number; idleSince: number }
interface SpeechJob {
  contextId: string;
  flushId?: number;
  final: boolean;
  chunks: Buffer[];
  queuedBytes: number;
  done: boolean;
  error?: Error;
  wake?: () => void;
}

// One connection per phone call, one context per spoken turn. Playback submits
// complete phrases serially; flush_done boundaries preserve Twilio's per-phrase
// marks without throwing away Sonic's voice/prosody context between phrases.
export class BdrCartesiaStream {
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private context?: SpeechContext;
  private active?: SpeechJob;
  private closed = false;
  private useBytes = process.env.BDR_CARTESIA_TRANSPORT === "bytes";

  constructor(private language: string, private voiceId: string) {}

  private parameters() {
    return {
      model_id: process.env.BDR_CARTESIA_MODEL || "sonic-3.6",
      voice: this.voiceId, language: this.language === "English" ? "en" : "hi",
      output_format: { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 },
      // We already aggregate complete phrases. A second server-side buffering
      // delay would add latency. Let the transcript guide emotion naturally.
      max_buffer_delay_ms: 0, generation_config: { speed: 1, volume: 1 },
    };
  }

  private send(message: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("Cartesia speech connection is not open.");
    this.socket.send(JSON.stringify(message));
  }

  private failJob(error: Error) {
    if (!this.active) return;
    this.active.error = error;
    this.active.wake?.();
  }

  private receive(raw: Buffer) {
    let message: { type?: string; context_id?: string; flush_id?: number; data?: string; status_code?: number };
    try { message = JSON.parse(raw.toString()); }
    catch { this.failJob(new Error("Cartesia returned an invalid speech event.")); return; }
    const job = this.active;
    if (!job || job.done || (message.context_id && message.context_id !== job.contextId)) return;
    // Connection-level errors can omit context_id; never log provider payloads
    // because they can contain request text or credential-related information.
    if (message.type === "error" || (message.status_code && message.status_code >= 400)) {
      this.failJob(new Error(`Cartesia speech generation failed (${message.status_code || "provider error"}).`));
      return;
    }
    if (message.context_id !== job.contextId) return;
    if (message.flush_id !== undefined) {
      // Learn the first provider-assigned ID, then reject late packets from
      // earlier flushes. Do not assume all API snapshots start numbering at 1.
      if (job.flushId !== undefined && message.flush_id !== job.flushId) return;
      job.flushId = message.flush_id;
    }
    if (message.type === "chunk" && typeof message.data === "string") {
      const audio = Buffer.from(message.data, "base64");
      job.queuedBytes += audio.length;
      if (job.queuedBytes > 1_000_000) { this.failJob(new Error("Cartesia speech buffer exceeded its limit.")); return; }
      for (let offset = 0; offset < audio.length; offset += 1600) job.chunks.push(audio.subarray(offset, offset + 1600));
    } else if (message.type === "done" || (message.type === "flush_done" && !job.final)) {
      job.done = true;
      if (this.context?.id === job.contextId) {
        if (message.type === "done") this.context = undefined;
        else {
          this.context.idleSince = Date.now();
          this.context.nextFlushId = job.flushId === undefined ? undefined : job.flushId + 1;
        }
      }
    }
    job.wake?.();
  }

  private connect(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Cartesia speech stream is closed."));
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const key = process.env.CARTESIA_API_KEY;
    if (!key) return Promise.reject(new Error("Cartesia is not configured."));
    const socket = new WebSocket("wss://api.cartesia.ai/tts/websocket?cartesia_version=2026-08-14", {
      headers: { Authorization: `Bearer ${key}` }, perMessageDeflate: false, handshakeTimeout: 5000, maxPayload: 2_000_000,
    });
    this.socket = socket;
    socket.on("message", (raw: Buffer) => { if (this.socket === socket) this.receive(raw); });
    this.connecting = new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.on("error", () => {
        const error = new Error("Cartesia speech WebSocket connection failed.");
        reject(error);
        if (this.socket === socket) this.failJob(error);
      });
      socket.on("close", () => {
        const error = new Error("Cartesia speech WebSocket connection closed.");
        reject(error);
        if (this.socket === socket) { this.context = undefined; this.failJob(error); }
      });
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private async *stream(text: string, turnId: string, signal: AbortSignal, final: boolean): AsyncGenerator<Buffer> {
    signal.throwIfAborted();
    // Abort must also wake a generation still waiting for the handshake.
    let onConnectingAbort!: () => void;
    try {
      await Promise.race([this.connect(), new Promise<never>((_, reject) => {
        onConnectingAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onConnectingAbort, { once: true });
      })]);
    } finally { signal.removeEventListener("abort", onConnectingAbort); }
    signal.throwIfAborted();
    if (this.closed) throw new Error("Cartesia speech stream is closed.");
    // Cartesia contexts expire one second after their last output. A stalled
    // model turn gets a fresh context instead of trying to revive an expired one.
    if (this.context && (this.context.turnId !== turnId || Date.now() - this.context.idleSince > 700)) this.finish(this.context.turnId);
    const context = this.context ||= { id: randomUUID(), turnId, idleSince: Date.now() };
    const job: SpeechJob = { contextId: context.id, flushId: context.nextFlushId, final, chunks: [], queuedBytes: 0, done: false };
    this.active = job;
    const abort = () => { if (this.active === job) this.cancel(); };
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { if (this.active === job) this.failJob(new Error("Cartesia speech generation timed out.")); }, 20_000);
    let bytes = 0;
    try {
      this.send({ ...this.parameters(), context_id: context.id, transcript: final ? text : `${text} `, continue: !final });
      if (!final) this.send({ ...this.parameters(), context_id: context.id, transcript: "", continue: true, flush: true });
      while (true) {
        signal.throwIfAborted();
        if (job.error) throw job.error;
        const chunk = job.chunks.shift();
        if (chunk) { bytes += chunk.length; job.queuedBytes -= chunk.length; yield chunk; }
        else if (job.done) break;
        else await new Promise<void>((resolve) => { job.wake = resolve; });
      }
      if (!bytes) throw new Error("Cartesia returned empty audio.");
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      if (this.active === job) this.active = undefined;
    }
  }

  async *speak(text: string, turnId: string, signal: AbortSignal, final = false): AsyncGenerator<Buffer> {
    if (this.closed) throw new Error("Cartesia speech stream is closed.");
    let emitted = false;
    if (!this.useBytes) {
      try {
        for await (const chunk of this.stream(text, turnId, signal, final)) { emitted = true; yield chunk; }
        return;
      } catch (error) {
        // Only fall back before any audio was sent. Replaying a partial utterance
        // would repeat words and make an interruption sound like a restart.
        if (signal.aborted || this.closed || emitted) throw error;
        this.cancel();
        this.socket?.close();
        this.socket = undefined;
        this.useBytes = true;
        console.warn("[bdr] Cartesia WebSocket unavailable before audio; using HTTP speech for this call.");
      }
    }
    yield* bdrSpeechChunks(text, this.language, this.voiceId, signal);
  }

  finish(turnId: string): void {
    if (this.context?.turnId !== turnId) return;
    const context = this.context;
    this.context = undefined;
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ ...this.parameters(), context_id: context.id, transcript: "", continue: false });
  }

  cancel(): void {
    const context = this.context;
    this.context = undefined;
    if (context && this.socket?.readyState === WebSocket.OPEN) this.send({ context_id: context.id, cancel: true });
    this.failJob(new Error("Cartesia speech canceled."));
    this.active = undefined; // Discard even late audio from a canceled context.
  }

  close(): void { this.closed = true; this.cancel(); this.socket?.close(); }
}
