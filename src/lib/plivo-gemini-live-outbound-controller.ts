export interface OutboundControllerConfig {
  frameBytes: number;
  frameDurationMs: number;
  batchBytes: number;
  prerollBytes: number;
  pumpIntervalMs: number;
  /**
   * How far ahead of real time the committed playback deadline is kept.
   *
   * The pump used to emit exactly one batch per `setInterval` tick, which is an
   * open-loop pacer: it assumes the timer fires exactly on schedule. It does
   * not. Inbound VAD runs per 20ms frame, Gemini WS messages arrive in bursts,
   * and ASR/transcript work lands on the same event loop — every slipped tick
   * delivered less audio than real time consumed, and the deficit compounded.
   * The caller hears that as stutter that gets steadily worse the longer an
   * uninterrupted agent turn runs.
   *
   * Pacing against a wall-clock deadline instead is self-correcting: a late
   * tick simply emits more frames to catch up. It also decouples startup
   * latency from jitter tolerance — `prerollBytes` still governs how quickly
   * the first frame leaves (first-word latency), while this governs how much
   * buffer Plivo holds in steady state.
   *
   * Safe to raise: Plivo's clearAudio drops its own buffer regardless of how it
   * was filled, so a deeper cushion does not add barge-in cut residual.
   */
  targetCushionMs: number;
  /** Bounds catch-up work per tick so a long stall cannot burst the whole queue. */
  maxFramesPerTick: number;
}

export interface OutboundControllerDeps {
  isClosed: () => boolean;
  onEmitMulaw: (payloadBase64: string) => void;
  onSyncOutboundCursor: () => void;
}

export interface OutboundAudioController {
  queue(payloadBase64: string): void;
  flushRemainder(): void;
  clear(): void;
  stop(): void;
  /** Soft duck: hold playback without discarding queued audio (avoids stutter holes). */
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  /**
   * Named playback holds. Several subsystems can hold playback at once (soft duck,
   * Spanish language gate); audio resumes only when every holder has released, so
   * one subsystem releasing cannot un-duck another's hold.
   */
  hold(reason: string): void;
  release(reason: string): void;
  isHeld(reason: string): boolean;
  unsyncCursor(): void;
  resetPlaybackDeadline(): void;
  queuedBytes(): number;
  queuedDurationMs(): number;
  /** Best-effort remaining Plivo playout time, including queued frames. */
  estimatedRemainingPlaybackMs(): number;
  /** True only while audio already sent to Plivo may still be audible. */
  isPlayoutActive(): boolean;
  isPumpActive(): boolean;
  isLikelyActive(assistantTurnActive: boolean): boolean;
}

export function createOutboundAudioController(
  config: OutboundControllerConfig,
  deps: OutboundControllerDeps,
): OutboundAudioController {
  let queue = Buffer.alloc(0);
  let pump: NodeJS.Timeout | undefined;
  let playbackPrimed = false;
  let flushRequested = false;
  let cursorSynced = false;
  let playbackDeadlineMs = 0;
  // Named playback holds. `pause()`/`resume()` are the legacy single-owner API,
  // reimplemented over this set so both styles compose safely.
  const playbackHolds = new Set<string>();
  const LEGACY_PAUSE_HOLD = "legacy_pause";

  const stop = (): void => {
    if (pump) clearInterval(pump);
    pump = undefined;
    playbackPrimed = false;
    flushRequested = false;
  };

  const emitMulaw = (payloadBase64: string): void => {
    deps.onEmitMulaw(payloadBase64);
    const bytes = Buffer.byteLength(payloadBase64, "base64");
    const durationMs = Math.ceil(bytes / config.frameBytes) * config.frameDurationMs;
    playbackDeadlineMs = Math.max(playbackDeadlineMs, Date.now()) + durationMs;
  };

  const pumpOutboundAudio = (): void => {
    if (pump || deps.isClosed()) return;
    pump = setInterval(() => {
      if (deps.isClosed()) {
        stop();
        return;
      }
      if (playbackHolds.size > 0) return;
      if (queue.length < config.frameBytes) return;

      const canPlay = playbackPrimed || flushRequested || queue.length >= config.prerollBytes;
      if (!canPlay) return;

      playbackPrimed = true;

      // Emit until the committed playback deadline sits `targetCushionMs` ahead
      // of now, rather than one fixed batch per tick. See targetCushionMs — this
      // is what makes a slipped timer self-correcting instead of cumulative.
      let framesEmitted = 0;
      while (
        queue.length >= config.frameBytes &&
        framesEmitted < config.maxFramesPerTick &&
        playbackDeadlineMs - Date.now() < config.targetCushionMs
      ) {
        const frameAlignedBytes = queue.length - (queue.length % config.frameBytes);
        if (frameAlignedBytes <= 0) break;

        const chunkBytes = Math.min(frameAlignedBytes, config.batchBytes);
        const chunk = queue.subarray(0, chunkBytes);
        queue = queue.subarray(chunkBytes);
        emitMulaw(chunk.toString("base64"));
        framesEmitted += Math.ceil(chunkBytes / config.frameBytes);
      }

      if (queue.length === 0) {
        stop();
      }
    }, config.pumpIntervalMs);
  };

  return {
    queue(payloadBase64: string): void {
      if (!cursorSynced) {
        deps.onSyncOutboundCursor();
        cursorSynced = true;
      }
      queue = Buffer.concat([queue, Buffer.from(payloadBase64, "base64")]);
      pumpOutboundAudio();
    },

    flushRemainder(): void {
      if (queue.length === 0) return;
      const padded = Buffer.alloc(
        Math.ceil(queue.length / config.frameBytes) * config.frameBytes,
        0xff,
      );
      queue.copy(padded);
      queue = padded;
      flushRequested = true;
      pumpOutboundAudio();
    },

    clear(): void {
      queue = Buffer.alloc(0);
      cursorSynced = false;
      playbackDeadlineMs = 0;
      playbackHolds.clear();
      stop();
    },

    stop,

    pause(): void {
      playbackHolds.add(LEGACY_PAUSE_HOLD);
    },

    resume(): void {
      if (!playbackHolds.delete(LEGACY_PAUSE_HOLD)) return;
      pumpOutboundAudio();
    },

    isPaused(): boolean {
      return playbackHolds.size > 0;
    },

    hold(reason: string): void {
      playbackHolds.add(reason);
    },

    release(reason: string): void {
      if (!playbackHolds.delete(reason)) return;
      pumpOutboundAudio();
    },

    isHeld(reason: string): boolean {
      return playbackHolds.has(reason);
    },

    unsyncCursor(): void {
      cursorSynced = false;
    },

    resetPlaybackDeadline(): void {
      playbackDeadlineMs = 0;
    },

    queuedBytes(): number {
      return queue.length;
    },

    queuedDurationMs(): number {
      if (queue.length <= 0) return 0;
      return Math.ceil(queue.length / config.frameBytes) * config.frameDurationMs;
    },

    estimatedRemainingPlaybackMs(): number {
      const alreadySentMs = Math.max(0, playbackDeadlineMs - Date.now());
      const queuedMs = queue.length <= 0
        ? 0
        : Math.ceil(queue.length / config.frameBytes) * config.frameDurationMs;
      return alreadySentMs + queuedMs;
    },

    isPlayoutActive(): boolean {
      // Deliberately ignore locally queued/held audio. A provisional duplex
      // hold keeps that queue intact while the already-sent Plivo cushion
      // drains; once the deadline passes there is no far-end playback left to
      // echo, even though unsent model audio is still waiting locally.
      return Date.now() < playbackDeadlineMs + 150;
    },

    isPumpActive(): boolean {
      return pump !== undefined;
    },

    isLikelyActive(assistantTurnActive: boolean): boolean {
      // A paused pump with an empty queue is not audible — treating it as active
      // blocked language-pref mic collection after the first duck.
      const pumpDraining = pump !== undefined && queue.length > 0 && playbackHolds.size === 0;
      return queue.length > 0 ||
        pumpDraining ||
        assistantTurnActive ||
        Date.now() < playbackDeadlineMs + 150;
    },
  };
}
