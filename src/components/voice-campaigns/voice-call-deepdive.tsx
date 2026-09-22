"use client";

// Full call deep-dive — opens when an operator clicks a call-log row. Combines
// the analysis-level read (callDetails) with the on-demand full transcript
// (fetched from transcripts.jsonl via the insights/transcript route).

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { VoiceCampaignCallDetail } from "@/lib/voice-campaign-insights-types";
import type { VoiceCallTranscript, VoiceTranscriptTurn } from "@/lib/voice-campaign-transcript-loader";

const FETCH_OPTS = { skipDataset: true, skipModel: true } as const;

const DISPOSITION: Record<string, { label: string; dot: string }> = {
  positive: { label: "Engaged", dot: "bg-emerald-400" },
  neutral: { label: "Unresolved", dot: "bg-amber-400" },
  negative: { label: "Declined", dot: "bg-rose-400" },
  busy: { label: "Busy", dot: "bg-muted-foreground" },
  no_answer: { label: "No answer", dot: "bg-muted-foreground" },
  wrong_number: { label: "Wrong number", dot: "bg-muted-foreground" },
  failed: { label: "Failed", dot: "bg-muted-foreground" },
};

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

function formatClock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatStartedAt(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-semibold leading-none text-foreground tabular-nums">{value}</p>
      <p className="mt-1 text-[9.9px] text-muted-foreground">{label}</p>
    </div>
  );
}

function TranscriptTurn({ turn }: { turn: VoiceTranscriptTurn }) {
  const isAgent = turn.role === "assistant";
  return (
    <div className={`flex ${isAgent ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[82%] ${isAgent ? "" : "text-right"}`}>
        <div className="mb-1 flex items-center gap-2 text-[9px] uppercase text-muted-foreground">
          <span>{isAgent ? "Agent" : "Customer"}</span>
          <span className="tabular-nums">{formatClock(turn.offsetSeconds)}</span>
        </div>
        <div
          className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
            isAgent
              ? "bg-muted/50 text-foreground"
              : "bg-foreground text-background"
          }`}
        >
          {turn.text}
        </div>
      </div>
    </div>
  );
}

export function VoiceCallDeepDive({
  runId,
  callId,
  detail,
  cohortTitle,
  laneChip,
  laneLabel,
  onClose,
}: {
  runId: string;
  callId: string;
  detail?: VoiceCampaignCallDetail;
  cohortTitle: string;
  laneChip: string;
  laneLabel: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<VoiceCallTranscript | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setData(null);
    apiFetch<VoiceCallTranscript>(
      `/api/voice-campaigns/insights/transcript?runId=${encodeURIComponent(runId)}&callId=${encodeURIComponent(callId)}`,
      FETCH_OPTS,
    )
      .then((record) => {
        if (cancelled) return;
        setData(record);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [runId, callId]);

  const outcome = data?.call.outcome ?? detail?.outcome ?? "";
  const disposition = DISPOSITION[outcome] ?? { label: outcome || "—", dot: "bg-muted-foreground" };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <aside className="fixed bottom-3 right-3 top-16 z-50 flex w-[460px] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[9.9px] font-medium uppercase text-muted-foreground">Call deep dive</p>
              <span className={`rounded-full px-2 py-0.5 text-[9.9px] font-medium ${laneChip}`}>{laneLabel}</span>
            </div>
            <p className="mt-1 font-mono text-sm tabular-nums">
              {data ? data.call.toNumber : callId.split("_").pop()}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{cohortTitle}</p>
          </div>
          <button
            className="-m-1 p-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border pb-4">
            <span className="flex items-center gap-2 text-sm">
              <span className={`size-1.5 rounded-full ${disposition.dot}`} />
              {disposition.label}
            </span>
            {data ? (
              <>
                <Stat label="duration" value={formatDuration(data.call.durationSeconds)} />
                <Stat label="turns" value={`${data.measurements.userTurnCount}/${data.measurements.turnCount}`} />
                <Stat label="started" value={formatStartedAt(data.call.startedAt)} />
              </>
            ) : detail ? (
              <>
                <Stat label="duration" value={formatDuration(detail.durationSeconds)} />
                <Stat label="turns" value={`${detail.userTurnCount}/${detail.turnCount}`} />
              </>
            ) : null}
          </div>

          {detail ? (
            <div className="border-b border-border py-4">
              <p className="text-sm font-semibold leading-snug">{detail.primarySignal}</p>
              {detail.observableSummary ? (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail.observableSummary}</p>
              ) : null}
              {detail.customerPosition ? (
                <div className="mt-3">
                  <p className="text-[9.9px] font-medium uppercase text-muted-foreground">Customer position</p>
                  <p className="mt-1 text-sm leading-relaxed">{detail.customerPosition}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="pt-4">
            <p className="mb-3 text-[9.9px] font-medium uppercase text-muted-foreground">Transcript</p>
            {state === "loading" ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <div className={`h-10 animate-pulse rounded-2xl bg-muted/40 ${i % 2 ? "ml-auto w-2/3" : "w-3/4"}`} key={i} />
                ))}
              </div>
            ) : state === "error" ? (
              <p className="text-sm text-muted-foreground">Transcript unavailable for this call.</p>
            ) : data && data.transcript.length > 0 ? (
              <div className="space-y-3">
                {data.transcript
                  .filter((turn) => turn.role !== "recording")
                  .map((turn) => (
                    <TranscriptTurn key={turn.id} turn={turn} />
                  ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No transcript turns recorded.</p>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
