"use client";

import { useEffect, useState } from "react";
import { useDataset } from "@/lib/dataset-context";

interface ClockState {
  lastTickSucceededAt: string | null;
  isStale: boolean;
  enabled: boolean;
}

const POLL_MS = 60_000;

/**
 * Module-cached clock state per datasetId so multiple consumers (segment cards,
 * funnel cards, charts) share one HTTP poll instead of each component issuing
 * its own request every 30s.
 */
const cache = new Map<string, ClockState>();
const subscribers = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();

function notify(datasetId: string) {
  for (const cb of subscribers.get(datasetId) ?? []) cb();
}

async function fetchClock(datasetId: string): Promise<void> {
  if (inflight.has(datasetId)) return inflight.get(datasetId)!;
  const p = (async () => {
    try {
      const res = await fetch(`/api/synthetic/clock?datasetId=${encodeURIComponent(datasetId)}`);
      if (!res.ok) return;
      const json = await res.json();
      cache.set(datasetId, {
        lastTickSucceededAt: json.clock?.lastTickSucceededAt ?? null,
        isStale: !!json.clock?.isStale,
        enabled: !!json.synthesisEnabled,
      });
      notify(datasetId);
    } finally {
      inflight.delete(datasetId);
    }
  })();
  inflight.set(datasetId, p);
  return p;
}

const pollTimers = new Map<string, NodeJS.Timeout>();

function ensurePolling(datasetId: string) {
  if (pollTimers.has(datasetId)) return;
  void fetchClock(datasetId);
  const id = setInterval(() => fetchClock(datasetId), POLL_MS);
  pollTimers.set(datasetId, id);
}

/** Returns the last successful tick ISO string, or null if synthesis is off / never ticked. */
export function useLiveFreshness(): { lastTickAt: string | null; isStale: boolean; enabled: boolean } {
  const { dataset } = useDataset();
  const datasetId = dataset?.id;
  const [, setBump] = useState(0);

  useEffect(() => {
    if (!datasetId) return;
    ensurePolling(datasetId);
    const subs = subscribers.get(datasetId) ?? new Set();
    const cb = () => setBump((b) => b + 1);
    subs.add(cb);
    subscribers.set(datasetId, subs);
    return () => {
      subs.delete(cb);
    };
  }, [datasetId]);

  // Re-render every minute so "Nm ago" labels stay accurate.
  useEffect(() => {
    const id = setInterval(() => setBump((b) => b + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!datasetId) return { lastTickAt: null, isStale: false, enabled: false };
  const c = cache.get(datasetId);
  return {
    lastTickAt: c?.lastTickSucceededAt ?? null,
    isStale: c?.isStale ?? false,
    enabled: c?.enabled ?? false,
  };
}

export function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
