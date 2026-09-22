"use client";

// Owns the journey event log (snapshot + NDJSON tail), the demo clock, and
// dispatch/reset actions for the voice-campaign insights page. Events carry
// virtual timestamps; everything visible is a pure reduction over events with
// at <= virtualNow, so scrub/replay never touches the server.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type {
  CapabilityRequestWithStatus,
  JourneyAction,
  JourneyDispatch,
  JourneyDispatchScope,
  JourneyLogEvent,
} from "@/lib/voice-campaign-journey-types";

export interface JourneyProfileInfo {
  horizonHours: number;
}

interface JourneySnapshot {
  dispatches?: JourneyDispatch[];
  events?: JourneyLogEvent[];
  requests?: CapabilityRequestWithStatus[];
  profile?: JourneyProfileInfo;
}

export interface DispatchResult {
  ok: boolean;
  error?: string;
}

const DEFAULT_PROFILE: JourneyProfileInfo = { horizonHours: 72 };
/** Demo clock speed — the 72h outcome horizon replays in ~36s. */
const PLAYBACK_SPEED = 7200;
const TICK_MS = 200;
const HOUR_MS = 3_600_000;

const FETCH_OPTS = { skipDataset: true, skipModel: true } as const;

function journeyUrl(runId: string, suffix = ""): string {
  return `/api/voice-campaigns/insights/journey${suffix}?runId=${encodeURIComponent(runId)}`;
}

export function useVoiceJourney(runId: string) {
  const [dispatches, setDispatches] = useState<JourneyDispatch[]>([]);
  const [events, setEvents] = useState<JourneyLogEvent[]>([]);
  const [requests, setRequests] = useState<CapabilityRequestWithStatus[]>([]);
  const [profile, setProfile] = useState<JourneyProfileInfo>(DEFAULT_PROFILE);
  const [virtualNow, setVirtualNow] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const seenEventIds = useRef(new Set<string>());

  const mergeEvents = useCallback((incoming: JourneyLogEvent[]) => {
    const fresh = incoming.filter((event) => event.id && !seenEventIds.current.has(event.id));
    if (fresh.length === 0) return;
    for (const event of fresh) seenEventIds.current.add(event.id);
    setEvents((prev) =>
      [...prev, ...fresh].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
    );
  }, []);

  const applySnapshot = useCallback(
    (snapshot: JourneySnapshot) => {
      setDispatches(snapshot.dispatches ?? []);
      setRequests(snapshot.requests ?? []);
      if (snapshot.profile) setProfile(snapshot.profile);
      mergeEvents(snapshot.events ?? []);
    },
    [mergeEvents],
  );

  // Initial snapshot (dispatches + profile live only here; the stream is events-only).
  useEffect(() => {
    seenEventIds.current.clear();
    setEvents([]);
    setDispatches([]);
    setVirtualNow(null);
    setPlaying(false);
    let cancelled = false;
    apiFetch<JourneySnapshot>(journeyUrl(runId), FETCH_OPTS)
      .then((snapshot) => {
        if (!cancelled) applySnapshot(snapshot);
      })
      .catch(() => {
        // Journey is additive — the insights page works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [runId, applySnapshot]);

  // NDJSON replay-then-tail. Future real (webhook) events arrive through the
  // same pipe; reconnect with backoff if the stream drops.
  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;

    const consume = async () => {
      while (!stopped) {
        try {
          const res = await apiFetch(journeyUrl(runId, "/stream"), {
            ...FETCH_OPTS,
            stream: true,
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error("stream unavailable");
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            const batch: JourneyLogEvent[] = [];
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const parsed = JSON.parse(trimmed) as { type?: string; event?: JourneyLogEvent };
                if (parsed.type === "journey" && parsed.event) batch.push(parsed.event);
              } catch {
                // Torn line — skip.
              }
            }
            if (batch.length > 0) mergeEvents(batch);
          }
        } catch {
          // Aborted or network error — retry below unless unmounted.
        }
        if (stopped) return;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    };

    void consume();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [runId, mergeEvents]);

  const range = useMemo(() => {
    if (dispatches.length === 0) return null;
    const starts = dispatches.map((dispatch) => Date.parse(dispatch.createdAt));
    return {
      start: Math.min(...starts),
      end: Math.max(...starts) + profile.horizonHours * HOUR_MS,
    };
  }, [dispatches, profile.horizonHours]);

  // On load with existing journey state, land on the final picture; the
  // scrubber replays from there.
  useEffect(() => {
    if (range && virtualNow === null) setVirtualNow(range.end);
  }, [range, virtualNow]);

  useEffect(() => {
    if (!playing || !range) return;
    const timer = setInterval(() => {
      setVirtualNow((prev) => Math.min((prev ?? range.start) + TICK_MS * PLAYBACK_SPEED, range.end));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, range]);

  useEffect(() => {
    if (playing && range && virtualNow !== null && virtualNow >= range.end) setPlaying(false);
  }, [playing, range, virtualNow]);

  const play = useCallback(() => {
    if (!range) return;
    setVirtualNow((prev) => (prev !== null && prev < range.end ? prev : range.start));
    setPlaying(true);
  }, [range]);

  const pause = useCallback(() => setPlaying(false), []);

  const scrub = useCallback((ms: number) => {
    setPlaying(false);
    setVirtualNow(ms);
  }, []);

  const jumpToEnd = useCallback(() => {
    setPlaying(false);
    if (range) setVirtualNow(range.end);
  }, [range]);

  const dispatchAction = useCallback(
    async (
      scope: JourneyDispatchScope,
      action: JourneyAction,
      opts?: { wave?: 2; grantRequestId?: string },
    ): Promise<DispatchResult> => {
      setPending(true);
      try {
        const result = await apiFetch<{ dispatch: JourneyDispatch }>(
          "/api/voice-campaigns/insights/dispatch",
          {
            ...FETCH_OPTS,
            method: "POST",
            body: {
              runId,
              scope,
              action,
              ...(opts?.wave ? { wave: opts.wave, grantRequestId: opts.grantRequestId } : {}),
              ...(virtualNow !== null ? { virtualAt: new Date(virtualNow).toISOString() } : {}),
            },
          },
        );
        const snapshot = await apiFetch<JourneySnapshot>(journeyUrl(runId), FETCH_OPTS);
        applySnapshot(snapshot);
        setVirtualNow(Date.parse(result.dispatch.createdAt));
        setPlaying(true);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Dispatch failed" };
      } finally {
        setPending(false);
      }
    },
    [runId, applySnapshot, virtualNow],
  );

  /** Grant/reject a derived capability request; the decision lands as an event. */
  const decideCapability = useCallback(
    async (requestId: string, decision: "grant" | "reject", reason?: string): Promise<DispatchResult> => {
      setPending(true);
      try {
        await apiFetch("/api/voice-campaigns/insights/capability", {
          ...FETCH_OPTS,
          method: "POST",
          body: {
            runId,
            requestId,
            decision,
            ...(reason ? { reason } : {}),
            ...(virtualNow !== null ? { virtualAt: new Date(virtualNow).toISOString() } : {}),
          },
        });
        const snapshot = await apiFetch<JourneySnapshot>(journeyUrl(runId), FETCH_OPTS);
        applySnapshot(snapshot);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Decision failed" };
      } finally {
        setPending(false);
      }
    },
    [runId, applySnapshot, virtualNow],
  );

  const reset = useCallback(async () => {
    try {
      await apiFetch(journeyUrl(runId), { ...FETCH_OPTS, method: "DELETE" });
    } catch {
      // Reset is best-effort; clear local state regardless.
    }
    seenEventIds.current.clear();
    setEvents([]);
    setDispatches([]);
    setVirtualNow(null);
    setPlaying(false);
    // Re-fetch: requests re-derive from analysis and outlive a journey reset.
    apiFetch<JourneySnapshot>(journeyUrl(runId), FETCH_OPTS)
      .then(applySnapshot)
      .catch(() => {});
  }, [runId, applySnapshot]);

  return {
    active: dispatches.length > 0,
    dispatches,
    events,
    requests,
    profile,
    virtualNow,
    playing,
    range,
    pending,
    play,
    pause,
    scrub,
    jumpToEnd,
    dispatchAction,
    decideCapability,
    reset,
  };
}

export type VoiceJourney = ReturnType<typeof useVoiceJourney>;
