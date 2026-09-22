"use client";

import { useEffect, useState } from "react";
import { useDataset } from "@/lib/dataset-context";

interface ClockResponse {
  datasetId: string;
  synthesisEnabled: boolean;
  cadence?: { intervalHours: number; syntheticHoursPerTick: number };
  clock: null | {
    currentNow: string;
    lastTickSucceededAt: string | null;
    tickCount: number;
    nextEstimateAt: string | null;
    neverTicked: boolean;
    isStale: boolean;
  };
}

const POLL_INTERVAL_MS = 30_000;

/**
 * Three states:
 *   - never-ticked: dot off, "Live · scheduled" (informational)
 *   - fresh: green dot (monochrome — really white/neutral with subtle pulse)
 *   - stale: amber-tinted (still monochrome — uses border state)
 */
export function LiveDataPill() {
  const { dataset } = useDataset();
  const [data, setData] = useState<ClockResponse | null>(null);
  const [, setTick] = useState(0); // forces re-render every minute for "x ago" text

  useEffect(() => {
    if (!dataset?.id) return;
    let cancelled = false;
    const fetchClock = async () => {
      try {
        const res = await fetch(`/api/synthetic/clock?datasetId=${encodeURIComponent(dataset.id)}`);
        if (!res.ok) return;
        const json: ClockResponse = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // silent — pill just won't update
      }
    };
    fetchClock();
    const id = setInterval(fetchClock, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [dataset?.id]);

  // Rerun every minute so relative timestamps stay accurate.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!data?.synthesisEnabled || !data.clock) return null;

  const { clock } = data;
  let label: string;
  let dotClass = "bg-foreground/40";
  let titleAttr = "";
  if (clock.neverTicked) {
    label = "Scheduled";
    dotClass = "bg-foreground/30";
    titleAttr = "Synthesis enabled. First tick has not run yet.";
  } else if (clock.isStale) {
    label = `Stale · ${formatRelative(clock.lastTickSucceededAt!)}`;
    dotClass = "bg-foreground/40 ring-1 ring-foreground/20";
    titleAttr = `Last successful tick: ${new Date(clock.lastTickSucceededAt!).toLocaleString()}`;
  } else {
    label = `Live · ${formatRelative(clock.lastTickSucceededAt!)}`;
    dotClass = "bg-foreground animate-pulse";
    titleAttr = `Data through ${formatDate(clock.currentNow)} · last tick ${new Date(clock.lastTickSucceededAt!).toLocaleString()}`;
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-muted/30 text-[9.9px] text-muted-foreground select-none"
      title={titleAttr}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      <span>{label}</span>
    </div>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
