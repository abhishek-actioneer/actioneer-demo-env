"use client";

/**
 * Live tick toast — fires once per detected tickCount increase.
 *
 * Strategy:
 *   - Polls the public clock endpoint every 30s.
 *   - Tracks the last tickCount seen across mounts (sessionStorage so it survives
 *     route changes but resets on tab close).
 *   - When tickCount increases, shows a small toast with deltas like
 *     "Live update: +192 bookings · +192 sessions · +68 funnel events".
 *   - Suppresses if document is hidden (Page Visibility API).
 *   - Auto-dismisses after 4s; click to dismiss early.
 */

import { useEffect, useRef, useState } from "react";
import { useDataset } from "@/lib/dataset-context";

interface ClockResponse {
  synthesisEnabled: boolean;
  clock: null | {
    tickCount: number;
    lastTickSucceededAt: string | null;
    lastDeltas: Record<string, number> | null;
  };
}

const STORAGE_PREFIX = "synthetic.lastSeenTickCount.";

interface ToastState {
  id: number;
  deltas: Record<string, number>;
}

export function LiveTickToast() {
  const { dataset } = useDataset();
  const [toast, setToast] = useState<ToastState | null>(null);
  const lastSeenRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const datasetId = dataset?.id;
    if (!datasetId) return;

    const stored = sessionStorage.getItem(STORAGE_PREFIX + datasetId);
    lastSeenRef.current = stored == null ? null : Number(stored);
    initializedRef.current = false;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/synthetic/clock?datasetId=${encodeURIComponent(datasetId)}`);
        if (!res.ok) return;
        const data: ClockResponse = await res.json();
        if (cancelled || !data.synthesisEnabled || !data.clock) return;

        const { tickCount, lastDeltas } = data.clock;

        if (!initializedRef.current) {
          initializedRef.current = true;
          if (lastSeenRef.current == null) {
            lastSeenRef.current = tickCount;
            sessionStorage.setItem(STORAGE_PREFIX + datasetId, String(tickCount));
          }
          return;
        }

        if (tickCount > (lastSeenRef.current ?? 0)) {
          lastSeenRef.current = tickCount;
          sessionStorage.setItem(STORAGE_PREFIX + datasetId, String(tickCount));
          if (!document.hidden && lastDeltas) {
            setToast({ id: Date.now(), deltas: lastDeltas });
          }
        }
      } catch {
        /* silent */
      }
    };
    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dataset?.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  const parts: string[] = [];
  for (const [key, val] of Object.entries(toast.deltas)) {
    if (val <= 0) continue;
    parts.push(`+${val.toLocaleString()} ${key.replace(/_/g, " ")}`);
  }
  if (parts.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 max-w-sm bg-card border border-border rounded-lg shadow-lg px-4 py-3 text-sm text-foreground cursor-pointer"
      onClick={() => setToast(null)}
      title="Click to dismiss"
    >
      <div className="text-[9.9px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-foreground animate-pulse" />
        Live update
      </div>
      <div className="text-foreground/90 leading-snug">{parts.join(" · ")}</div>
    </div>
  );
}
