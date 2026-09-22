import {
  claimPendingCallEvents,
  markCallEventDelivered,
  markCallEventFailed,
  reclaimStaleProcessingCallEvents,
} from "./call-event-outbox-repo";
import { deliverCallEventsToFivetran } from "./fivetran-call-event-client";

const DISPATCHER_SYMBOL = Symbol.for("actioneer-voice.call-event-dispatcher");
const IN_FLIGHT_SYMBOL = Symbol.for("actioneer-voice.call-event-dispatcher.inflight");

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_STALE_PROCESSING_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;

interface DispatcherGlobal {
  [DISPATCHER_SYMBOL]:
    | {
        started: boolean;
        timer: NodeJS.Timeout | null;
        lastTickAt?: string;
        lastSuccessAt?: string;
        lastErrorAt?: string;
        lastErrorMessage?: string;
        lastBatchSize?: number;
      }
    | undefined;
  [IN_FLIGHT_SYMBOL]: boolean | undefined;
}

export interface CallEventDispatcherHealth {
  enabled: boolean;
  started: boolean;
  inFlight: boolean;
  intervalMs: number;
  batchSize: number;
  staleProcessingMs: number;
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastBatchSize: number;
}

function isEnabled(): boolean {
  return process.env.CALL_EVENT_EXPORT_ENABLED === "1";
}

function dispatchIntervalMs(): number {
  const raw = Number.parseInt(process.env.CALL_EVENT_DISPATCH_INTERVAL_MS || "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
  return raw;
}

function dispatchBatchSize(): number {
  const raw = Number.parseInt(process.env.CALL_EVENT_DISPATCH_BATCH_SIZE || "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(raw, 500);
}

function staleProcessingMs(): number {
  const raw = Number.parseInt(process.env.CALL_EVENT_PROCESSING_STALE_MS || "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_STALE_PROCESSING_MS;
  return Math.max(60_000, raw);
}

function backoffMs(attempt: number): number {
  const clamped = Math.min(Math.max(attempt, 1), 8);
  return Math.min(120_000, 1_000 * 2 ** clamped);
}

function dispatcherGlobal(): DispatcherGlobal {
  return globalThis as unknown as DispatcherGlobal;
}

async function tick(): Promise<void> {
  const g = dispatcherGlobal();
  if (g[IN_FLIGHT_SYMBOL]) return;
  g[IN_FLIGHT_SYMBOL] = true;
  const nowIso = new Date().toISOString();
  if (g[DISPATCHER_SYMBOL]) g[DISPATCHER_SYMBOL].lastTickAt = nowIso;

  try {
    const reclaimed = reclaimStaleProcessingCallEvents(staleProcessingMs());
    if (reclaimed > 0) {
      console.warn(`[call-event-dispatcher] reclaimed stale processing rows=${reclaimed}`);
    }

    const batch = claimPendingCallEvents(dispatchBatchSize());
    if (batch.length === 0) return;
    if (g[DISPATCHER_SYMBOL]) g[DISPATCHER_SYMBOL].lastBatchSize = batch.length;

    const result = await deliverCallEventsToFivetran(batch);
    for (const invalid of result.invalidEvents) {
      markCallEventFailed(invalid.id, {
        error: invalid.error,
        responseCode: result.statusCode,
        retryAfterMs: 1_000,
        maxAttempts: 1,
      });
    }

    const sentIds = new Set(result.sentEventIds);
    const sentEvents = batch.filter((event) => sentIds.has(event.id));
    if (sentEvents.length === 0) return;

    if (result.ok) {
      for (const event of sentEvents) {
        markCallEventDelivered(event.id, result.statusCode);
      }
      if (g[DISPATCHER_SYMBOL]) {
        g[DISPATCHER_SYMBOL].lastSuccessAt = new Date().toISOString();
        g[DISPATCHER_SYMBOL].lastErrorAt = undefined;
        g[DISPATCHER_SYMBOL].lastErrorMessage = undefined;
      }
      if (result.invalidEvents.length > 0) {
        console.error(
          `[call-event-dispatcher] dropped invalid payload rows=${result.invalidEvents.length}`,
        );
      }
      return;
    }

    for (const event of sentEvents) {
      markCallEventFailed(event.id, {
        error: result.error || "Fivetran delivery failed",
        responseCode: result.statusCode,
        retryAfterMs: backoffMs(event.attemptCount),
        maxAttempts: MAX_ATTEMPTS,
      });
    }
    console.error(
      `[call-event-dispatcher] delivery failed batch=${sentEvents.length} status=${result.statusCode ?? "(none)"} error=${result.error ?? "(none)"}`,
    );
    if (g[DISPATCHER_SYMBOL]) {
      g[DISPATCHER_SYMBOL].lastErrorAt = new Date().toISOString();
      g[DISPATCHER_SYMBOL].lastErrorMessage = result.error || "Fivetran delivery failed";
    }
  } catch (error) {
    // Never leave claimed rows in processing after an unexpected crash path.
    try {
      const reclaimed = reclaimStaleProcessingCallEvents(60_000);
      if (reclaimed > 0) {
        console.warn(`[call-event-dispatcher] emergency reclaim rows=${reclaimed}`);
      }
    } catch (reclaimError) {
      console.error("[call-event-dispatcher] emergency reclaim failed", reclaimError);
    }
    console.error("[call-event-dispatcher] tick failed", error);
    if (g[DISPATCHER_SYMBOL]) {
      g[DISPATCHER_SYMBOL].lastErrorAt = new Date().toISOString();
      g[DISPATCHER_SYMBOL].lastErrorMessage = error instanceof Error ? error.message : "Unknown tick failure";
    }
  } finally {
    g[IN_FLIGHT_SYMBOL] = false;
  }
}

export function startCallEventDispatcher(): void {
  if (!isEnabled()) return;
  const g = dispatcherGlobal();
  const existing = g[DISPATCHER_SYMBOL];
  if (existing?.started) return;

  const intervalMs = dispatchIntervalMs();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  g[DISPATCHER_SYMBOL] = { started: true, timer, lastBatchSize: 0 };
  console.log(`[call-event-dispatcher] started intervalMs=${intervalMs} batchSize=${dispatchBatchSize()}`);

  // Kick once at startup for low latency on first batch.
  void tick();
}

export function getCallEventDispatcherHealth(): CallEventDispatcherHealth {
  const g = dispatcherGlobal();
  const state = g[DISPATCHER_SYMBOL];
  return {
    enabled: isEnabled(),
    started: Boolean(state?.started),
    inFlight: Boolean(g[IN_FLIGHT_SYMBOL]),
    intervalMs: dispatchIntervalMs(),
    batchSize: dispatchBatchSize(),
    staleProcessingMs: staleProcessingMs(),
    lastTickAt: state?.lastTickAt ?? null,
    lastSuccessAt: state?.lastSuccessAt ?? null,
    lastErrorAt: state?.lastErrorAt ?? null,
    lastErrorMessage: state?.lastErrorMessage ?? null,
    lastBatchSize: state?.lastBatchSize ?? 0,
  };
}
