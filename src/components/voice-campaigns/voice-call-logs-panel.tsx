"use client";

import { Loader2, MessageSquare, PhoneIncoming, ShieldAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CallRecordingWaveform } from "@/components/voice-campaigns/call-recording-waveform";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { VoiceCall, VoiceCallOutcome, VoiceCampaign } from "@/lib/voice-campaign-types";
import type { VoiceForensicsHorizonResult } from "@/lib/voice-forensics/types";
import { findLinkSuccessMetric } from "@/lib/voice-campaign-success";
import type { VoiceCallLogFilter } from "@/components/voice-campaigns/voice-campaign-studio";
import {
  classifyVoiceCallOutcome,
  getVoiceCallStageFacts,
  maskPhone,
  formatDuration,
  callStartedAt,
  callDisplayName,
  callStatusLabel,
  callRuntimeLabel,
  primaryRecording,
  callResponseSummary,
  transcriptTurnTimeLabel,
  displayTranscript,
  recordingHref,
  isLiveTestCall,
  OUTCOME_LABELS,
  SCRIPT_ADHERENCE_CHECKS,
  type ScriptAdherenceCheckKey,
  evaluateScriptAdherenceCall,
  isScriptAdherenceCheckKey,
  turnLatencySamples,
} from "@/lib/voice-campaign-analysis";

type FraudCallAnalysis = import("@/app/api/fraud-alerts/by-call/route").FraudCallAnalysis;

function scriptCheckLabel(key: ScriptAdherenceCheckKey): string {
  return SCRIPT_ADHERENCE_CHECKS.find((check) => check.key === key)?.label ?? key;
}

function formatForensicsSeconds(ms: number | null | undefined): string {
  const seconds = Math.max(0, Number(ms ?? 0) / 1000);
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}


function capturedForensicsMs(analysis: FraudCallAnalysis): number {
  let maxMs = Math.max(0, Number(analysis.vf_user_audio_ms ?? analysis.vf_cumulative_ms ?? 0));
  for (const horizon of Object.values(analysis.vf_results_by_horizon ?? {})) {
    if (!horizon) continue;
    maxMs = Math.max(maxMs, Number(horizon.userAudioMs ?? 0), Number(horizon.analyzedAudioMs ?? 0));
  }
  return maxMs;
}

function forensicsHorizonResult(
  analysis: FraudCallAnalysis,
  key: number | string,
): VoiceForensicsHorizonResult | null {
  return analysis.vf_results_by_horizon?.[String(key)] ??
    analysis.vf_results?.horizons?.[String(key)] ??
    null;
}

/**
 * The call log shows one curated signal per task, computed over the FULL
 * (silence-trimmed) caller audio, as a green/amber/red band. Raw scores,
 * thresholds, and the full model rows stay persisted in vf_results_json —
 * this is a display filter only. Band cut-offs are the operator-agreed table:
 *   LA      0–0.85 green · 0.85–0.95 amber · 0.95+ red
 *   PA      0–0.99 green · 0.99+ red (binary — no amber band)
 *   Gender  0–0.60 female · 0.60–0.80 ambiguous · 0.80+ male
 */
type ForensicsTone = "alert" | "ok" | "neutral";

const FORENSICS_TONE_CLASS: Record<ForensicsTone, string> = {
  alert: "font-medium text-red-600 dark:text-red-400",
  ok: "font-medium text-emerald-600 dark:text-emerald-400",
  neutral: "text-foreground",
};

type ForensicsBand = "green" | "amber" | "red";

const FORENSICS_BAND_CLASS: Record<ForensicsBand, string> = {
  green: "border-emerald-600/40 bg-emerald-600/10 text-emerald-600 dark:text-emerald-400",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "border-red-600/40 bg-red-500/10 text-red-600 dark:text-red-400",
};

interface ForensicsBandStep {
  /** Upper bound (exclusive) of this band; the last step uses Infinity. */
  max: number;
  band: ForensicsBand;
  label: string;
}

const FULL_AUDIO_FORENSICS_SIGNALS: ReadonlyArray<{
  task: "gender" | "la" | "pa";
  modelId: string;
  label: string;
  bands: ForensicsBandStep[];
}> = [
  // Gender's band color is relative to the expected persona gender (red only on
  // a mismatch, green otherwise) — recomputed in selectedForensicsRows.
  { task: "gender", modelId: "titanet-gender-dec-pooling", label: "Gender",
    bands: [
      { max: 0.6, band: "green", label: "Female" },
      { max: 0.8, band: "amber", label: "Ambiguous" },
      { max: Infinity, band: "green", label: "Male" },
    ] },
  { task: "la", modelId: "titanet-la-dec-pooling", label: "Deepfake & synthetic voice",
    bands: [
      { max: 0.85, band: "green", label: "Liveness pass" },
      { max: 0.95, band: "amber", label: "Inconclusive — retry" },
      { max: Infinity, band: "red", label: "Synthetic voice detected" },
    ] },
  { task: "pa", modelId: "titanet-pa-enc-block4-stats", label: "Recording playback",
    bands: [
      { max: 0.99, band: "green", label: "Liveness pass" },
      { max: Infinity, band: "red", label: "Replay attack detected" },
    ] },
];

const BIOMARKER_MATCH_THRESHOLD = 0.75;

interface DisplayForensicsRow {
  key: string;
  label: string;
  verdict: string;
  band: ForensicsBand | null;
  detail?: string;
}

function selectedForensicsRows(
  result: VoiceForensicsHorizonResult,
  expectedGender: "male" | "female" | null,
): DisplayForensicsRow[] {
  return FULL_AUDIO_FORENSICS_SIGNALS.flatMap((signal) => {
    const row = (result[signal.task]?.rows ?? []).find((r) => r.modelId === signal.modelId);
    if (!row) return [];
    const scored = row.status === "ready" && typeof row.score === "number";
    let step = scored ? signal.bands.find((b) => row.score! < b.max) ?? null : null;
    if (step && signal.task === "gender") {
      const detected = step.label.toLowerCase();
      const band: ForensicsBand = detected === "ambiguous"
        ? "amber"
        : expectedGender && detected !== expectedGender
          ? "red"
          : "green";
      step = { ...step, band };
    }
    return [{
      key: signal.modelId,
      label: signal.label,
      verdict: step ? step.label : row.status === "error" ? "Error" : row.status === "unavailable" ? "Unavailable" : row.verdict ?? "—",
      band: step?.band ?? null,
      detail: row.detail,
    }];
  });
}

function ForensicsBandChip({ band, label }: { band: ForensicsBand | null; label: string }) {
  if (!band) return <span className="text-xs text-muted-foreground">{label}</span>;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
      FORENSICS_BAND_CLASS[band],
    )}>
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function VoiceForensicsResults({
  analysis,
  datasetId,
}: {
  analysis: FraudCallAnalysis;
  datasetId?: string;
}) {
  const capturedMs = capturedForensicsMs(analysis);
  const result =
    forensicsHorizonResult(analysis, "full-processed") ??
    forensicsHorizonResult(analysis, "full-raw");

  const selfSimilarity = result?.biomarker?.selfSimilarity;
  const voiceMismatch =
    typeof selfSimilarity === "number" && selfSimilarity < BIOMARKER_MATCH_THRESHOLD;

  // Expected gender of the claimed identity: prefer the value carried on the
  // forensics result; fall back to the fraud-analysis cardholder gender for
  // rows written before selfExpectedGender existed.
  const expectedGender: "male" | "female" | null =
    result?.biomarker?.selfExpectedGender ??
    (analysis.cardholder_gender === "male" || analysis.cardholder_gender === "female"
      ? analysis.cardholder_gender
      : null);

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
        <p className="text-sm text-muted-foreground">Caller audio captured</p>
        <p className="shrink-0 text-sm font-medium tabular-nums">{formatForensicsSeconds(capturedMs)}</p>
      </div>

      <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
        <p className="text-sm font-medium">Full caller audio</p>
        {analysis.call_id ? (
          <ForensicClipPlayer callId={analysis.call_id} clipKey="full-processed" />
        ) : null}
        {result ? (
          (() => {
            const rows = selectedForensicsRows(result, expectedGender);
            const genderRow = rows.find((r) => r.label === "Gender");
            const livenessRows = rows.filter((r) => r.label !== "Gender");
            return (
          <div className="space-y-3">
            <VoiceForensicsModelTable title="Liveness detection" rows={livenessRows} />
            <VoiceForensicsBiomarkerTable
              biomarker={result.biomarker ?? { embeddingSaved: false, matches: [], detail: "Verification result missing." }}
              genderRow={genderRow}
            />
            {voiceMismatch && analysis.call_id ? (
              <HumanReviewEscalationCta
                callId={analysis.call_id}
                datasetId={datasetId}
                who={result.biomarker?.selfLabel || "the enrolled user"}
                initialStatus={analysis.escalation_status}
                initialAt={analysis.escalated_at}
              />
            ) : null}
          </div>
            );
          })()
        ) : (
          <p className="py-1 text-sm text-muted-foreground">
            {capturedMs > 0
              ? "Verification pending; no result has been written yet."
              : "No caller audio captured for this call."}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Shown when verification verdicts an impostor attempt: the call must not be
 * actioned automatically — it needs a human on the review queue. Escalation is
 * persisted on the call's verification row so the state survives panel reopens
 * and reloads.
 */
function HumanReviewEscalationCta({
  callId,
  datasetId,
  who,
  initialStatus,
  initialAt,
}: {
  callId: string;
  datasetId?: string;
  who: string;
  initialStatus: string | null;
  initialAt: string | null;
}) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
    initialStatus ? "done" : "idle",
  );
  const [escalatedAt, setEscalatedAt] = useState<string | null>(initialAt);

  async function escalate(): Promise<void> {
    setState("sending");
    try {
      const res = await apiFetch<{ escalated_at: string }>("/api/fraud-alerts/escalate", {
        method: "POST",
        body: { callId, datasetId, reason: `Impostor attempt suspected — voice does not match ${who}` },
        skipModel: true,
      });
      setEscalatedAt(res.escalated_at);
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/25 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-medium">Escalated for human review</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Pending verification{formatEscalatedAt(escalatedAt)} — no automated account action will be taken.
          </p>
        </div>
        <ShieldAlert className="size-4 shrink-0 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-red-600/30 bg-red-500/5 px-3 py-2.5">
      <div className="min-w-0">
        <p className={cn("text-xs", FORENSICS_TONE_CLASS.alert)}>
          Impostor attempt suspected — voice does not match {who}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {state === "error"
            ? "Escalation failed — try again."
            : "This attempt requires human verification. No impostor should be accepted."}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void escalate()}
        disabled={state === "sending"}
        className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        {state === "sending" ? "Escalating…" : state === "error" ? "Retry escalation" : "Escalate for review"}
      </button>
    </div>
  );
}

function formatEscalatedAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "";
  return ` since ${date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function ForensicClipPlayer({ callId, clipKey }: { callId: string; clipKey: string }) {
  return (
    <audio
      controls
      preload="none"
      className="h-8 w-full"
      src={`/api/voice-forensics/clip?callId=${encodeURIComponent(callId)}&key=${encodeURIComponent(clipKey)}`}
    >
      Your browser does not support audio playback.
    </audio>
  );
}

function VoiceForensicsModelTable({
  title,
  rows,
}: {
  title: string;
  rows: DisplayForensicsRow[];
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">{title}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No model rows returned.</p>
      ) : rows.map((row) => (
        <div
          key={row.key}
          className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0"
          title={row.detail}
        >
          <span className="text-xs text-muted-foreground">{row.label}</span>
          <ForensicsBandChip band={row.band} label={row.verdict} />
        </div>
      ))}
    </div>
  );
}

/**
 * Same-person check against a fixed enrolled identity (e.g. an inbound
 * collections script that always addresses one named person). Only renders
 * once that identity has an enrolled baseline from a prior call.
 */
function BiomarkerSelfCheckRow({
  biomarker,
}: {
  biomarker: VoiceForensicsHorizonResult["biomarker"];
}) {
  const selfSimilarity = biomarker.selfSimilarity;
  if (typeof selfSimilarity !== "number") return null;

  const isSame = selfSimilarity >= BIOMARKER_MATCH_THRESHOLD;
  const who = biomarker.selfLabel || "enrolled user";

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="text-xs text-muted-foreground">Verification vs {who}</span>
      <ForensicsBandChip
        band={isSame ? "green" : "red"}
        label={isSame ? "Authenticated" : "Impostor attempt"}
      />
    </div>
  );
}

function VoiceForensicsBiomarkerTable({
  biomarker,
  genderRow,
}: {
  biomarker: VoiceForensicsHorizonResult["biomarker"];
  genderRow?: DisplayForensicsRow;
}) {
  const hasSelfCheck = typeof biomarker.selfSimilarity === "number";
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">Verification</p>
        <p className="shrink-0 text-[11px] text-muted-foreground">
          {biomarker.embeddingSaved ? "Enrolment captured" : "Not enrolled"}
        </p>
      </div>
      {genderRow ? (
        <div
          className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0"
          title={genderRow.detail}
        >
          <span className="text-xs text-muted-foreground">{genderRow.label}</span>
          <ForensicsBandChip band={genderRow.band} label={genderRow.verdict} />
        </div>
      ) : null}
      <BiomarkerSelfCheckRow biomarker={biomarker} />
      {!hasSelfCheck ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          First enrolment — no prior enrolment to verify against yet.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported pill component
// ---------------------------------------------------------------------------

export function VoiceOutcomePill({ outcome }: { outcome: VoiceCallOutcome }) {
  return (
    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function callMatchesRef(call: VoiceCall, ref: string): boolean {
  return call.id === ref || call.callConfigId === ref || call.providerRequestId === ref;
}

function callLogFilterLabel(filter: VoiceCallLogFilter): string {
  if (filter.kind === "outcome") {
    return `Outcome: ${OUTCOME_LABELS[filter.outcome]}`;
  }
  if (filter.kind === "script-check" && isScriptAdherenceCheckKey(filter.check)) {
    return `Failed check: ${scriptCheckLabel(filter.check)}`;
  }
  if (filter.kind === "latency") {
    return "Has model response samples";
  }
  if (filter.kind === "retention") {
    return `Retained ${formatDuration(filter.minSeconds)}+`;
  }
  return "Filtered calls";
}

function callMatchesLogFilter(
  call: VoiceCall,
  campaign: VoiceCampaign | null,
  filter: VoiceCallLogFilter,
): boolean {
  if (filter.kind === "outcome") {
    return classifyVoiceCallOutcome(call) === filter.outcome;
  }
  if (filter.kind === "latency") {
    return turnLatencySamples(call).length > 0;
  }
  if (filter.kind === "retention") {
    return (call.durationSeconds ?? 0) >= filter.minSeconds ||
      (filter.minSeconds <= 20 && getVoiceCallStageFacts(call).engaged20s);
  }
  if (!campaign || !isScriptAdherenceCheckKey(filter.check)) {
    return false;
  }
  const evaluation = evaluateScriptAdherenceCall(campaign, call);
  return Boolean(evaluation && !evaluation.checks[filter.check]);
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export function VoiceCallLogsPanel({
  campaign,
  selectedCallRef,
  filter,
  onClearFilter,
}: {
  campaign: VoiceCampaign | null;
  selectedCallRef?: string | null;
  filter?: VoiceCallLogFilter | null;
  onClearFilter?: () => void;
}) {
  const calls = campaign?.calls;
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const handledSelectedCallRef = useRef<string | null>(null);
  const sortedCalls = useMemo(() => [...(calls ?? [])].sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bTime - aTime;
  }), [calls]);
  const filteredCalls = useMemo(() => (
    filter ? sortedCalls.filter((call) => callMatchesLogFilter(call, campaign, filter)) : sortedCalls
  ), [campaign, filter, sortedCalls]);
  const selectedCall = sortedCalls.find((call) => call.id === selectedCallId) ?? null;

  useEffect(() => {
    if (!selectedCallRef || handledSelectedCallRef.current === selectedCallRef) return;
    const match = sortedCalls.find((call) => callMatchesRef(call, selectedCallRef));
    if (!match) return;
    handledSelectedCallRef.current = selectedCallRef;
    setSelectedCallId(match.id);
  }, [selectedCallRef, sortedCalls]);

  if (sortedCalls.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <div>
          <p className="text-sm font-medium">No call history yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Once this campaign places calls, every attempt, recording, and transcript will show here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="min-h-[calc(100dvh-190px)] min-w-0 overflow-hidden border border-border bg-white">
        <div className="flex items-center justify-between border-b border-border bg-white px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Call attempts</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {filter ? `${filteredCalls.length} of ${sortedCalls.length} matching` : `${sortedCalls.length} total`}
            </p>
          </div>
          {filter && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 max-w-[min(52vw,360px)] whitespace-normal rounded-md px-2 py-1 text-xs leading-snug text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
                {callLogFilterLabel(filter)}
              </span>
              {onClearFilter && (
                <button
                  type="button"
                  onClick={onClearFilter}
                  aria-label="Clear call log filter"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] bg-white text-sm">
            <thead className="bg-neutral-50">
              <tr className="border-b border-border text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-3 text-left font-semibold">Phone</th>
                <th className="px-4 py-3 text-left font-semibold">Runtime</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Outcome</th>
                <th className="px-4 py-3 text-right font-semibold">Duration</th>
                <th className="px-4 py-3 text-right font-semibold">Recording</th>
                <th className="px-4 py-3 text-right font-semibold">Transcript</th>
                <th className="px-4 py-3 text-right font-semibold">Started</th>
              </tr>
            </thead>
            <tbody>
              {filteredCalls.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No calls match this drilldown.
                  </td>
                </tr>
              )}
              {filteredCalls.map((call) => {
                const outcome = classifyVoiceCallOutcome(call);
                const transcript = displayTranscript(call);
                const hasRecording = Boolean(recordingHref(call, campaign));
                const isSelected = selectedCall?.id === call.id;

                return (
                  <tr
                    key={call.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedCallId(call.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedCallId(call.id);
                      }
                    }}
                    className={cn(
                      "h-14 cursor-pointer border-b border-border bg-white last:border-0 outline-none transition-colors hover:bg-neutral-50/80 focus:bg-neutral-50",
                      isSelected && "bg-neutral-100",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        {call.direction === "inbound" && (
                          <PhoneIncoming
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-label="Inbound call"
                          />
                        )}
                        <p className="truncate font-mono font-medium">{callDisplayName(call)}</p>
                        {isLiveTestCall(call) && (
                          <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[9.9px] text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
                            Live test
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{callRuntimeLabel(call)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{callStatusLabel(call)}</td>
                    <td className="px-4 py-3"><VoiceOutcomePill outcome={outcome} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatDuration(call.durationSeconds)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{hasRecording ? "Available" : "-"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{transcript.length}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">{callStartedAt(call)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <VoiceCallDetailSheet
        call={selectedCall}
        campaign={campaign}
        onOpenChange={(open) => {
          if (!open) setSelectedCallId(null);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared call-detail sheet
// ---------------------------------------------------------------------------

export function VoiceCallDetailSheet({
  call,
  campaign,
  onOpenChange,
}: {
  call: VoiceCall | null;
  campaign: VoiceCampaign | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={Boolean(call)} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[540px] max-w-[calc(100vw-1rem)] gap-0 p-0 sm:max-w-[540px]"
      >
        {call && (
          <CallLogDetailPanel
            call={call}
            campaign={campaign}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CallLogDetailPanel({
  call,
  campaign,
  onClose,
}: {
  call: VoiceCall;
  campaign: VoiceCampaign | null;
  onClose: () => void;
}) {
  const outcome = classifyVoiceCallOutcome(call);
  const facts = getVoiceCallStageFacts(call);
  const transcript = displayTranscript(call);
  const href = recordingHref(call, campaign);
  const recording = primaryRecording(call);
  const messageFollowUps = (call.followUps ?? []).filter((followUp) =>
    followUp.type === "sms" || followUp.type === "whatsapp"
  );
  const stats = [
    { label: "Runtime", value: callRuntimeLabel(call) },
    { label: "Status", value: callStatusLabel(call) },
    { label: "Outcome", value: OUTCOME_LABELS[outcome] },
    { label: "Duration", value: formatDuration(call.durationSeconds) },
    { label: "Started", value: callStartedAt(call) },
    { label: "Picked up", value: facts.pickedUp ? "Yes" : "No" },
    { label: "20s engaged", value: facts.engaged20s ? "Yes" : "No" },
    { label: "Recording", value: href ? "Available" : "Missing" },
    { label: "Transcript turns", value: transcript.length },
    { label: "Call id", value: call.callConfigId ?? call.id },
    { label: "Provider request", value: call.providerRequestId ?? "-" },
  ];

  const latency = call.latency;
  const fmtMs = (v: number | null | undefined): string =>
    v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;

  const [fraudAnalysis, setFraudAnalysis] = useState<FraudCallAnalysis | null>(null);
  const [fraudState, setFraudState] = useState<"loading" | "ready" | "error">("loading");
  const isFraudCall = call.status === "completed" && Boolean(campaign?.datasetId);

  const hasLinkFollowUp = messageFollowUps.some((f) => f.reason === "send_link_tool");
  const [attribution, setAttribution] = useState<{
    attributed: boolean;
    attributedAt?: string;
    humanClickCount: number;
  } | null>(null);

  useEffect(() => {
    if (!hasLinkFollowUp) return;
    // Attribution tokens are keyed by the live-call UUID, which is the call's `id`
    // (the same id the mid-call send_link follow-up is stored under) — NOT callConfigId.
    const id = call.id;
    if (!id) return;
    let cancelled = false;
    // eslint-disable-next-line prefer-const
    let timer: ReturnType<typeof setInterval>;
    async function poll() {
      try {
        const data = await apiFetch<{ attributed: boolean; attributedAt?: string; humanClickCount: number }>(
          `/api/voice-campaigns/calls/${encodeURIComponent(id)}/attribution`,
          { skipDataset: true, skipModel: true } as Parameters<typeof apiFetch>[1],
        );
        if (!cancelled) {
          setAttribution(data);
          if (data.attributed) clearInterval(timer);
        }
      } catch { /* silent */ }
    }
    void poll();
    timer = setInterval(() => void poll(), 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [call.id, hasLinkFollowUp]);

  useEffect(() => {
    const id = call.callConfigId || call.id;
    if (!id || !isFraudCall) return;
    let cancelled = false;
    let attempts = 0;
    setFraudAnalysis(null);
    setFraudState("loading");
    const dsParam = campaign?.datasetId
      ? `&datasetId=${encodeURIComponent(campaign.datasetId)}`
      : "";
    const url = `/api/fraud-alerts/by-call?callId=${encodeURIComponent(id)}${dsParam}`;
    const opts = { skipDataset: true, skipModel: true } as const;
    // eslint-disable-next-line prefer-const
    let timer: ReturnType<typeof setInterval>;

    // Forensics run entirely post-call (VAD pass + sequential GPU inference per
    // horizon), so results land a minute or two after hangup. For a recent call,
    // a missing row — or a row without vf_results — means "still analyzing":
    // keep polling. For an old call it means results will never arrive: settle
    // immediately with whatever exists instead of spinning.
    const endedMs = Date.parse(call.endedAt ?? call.startedAt ?? "");
    const isRecent = Number.isFinite(endedMs) && Date.now() - endedMs < 10 * 60_000;

    async function poll(): Promise<void> {
      attempts += 1;
      const lastAttempt = attempts >= 45;
      try {
        const data = await apiFetch<FraudCallAnalysis | null>(url, opts);
        if (cancelled) return;
        if (!data?.vf_results && isRecent && !lastAttempt) return;
        clearInterval(timer);
        if (data) {
          setFraudAnalysis(data);
          setFraudState("ready");
        } else {
          setFraudState("error");
        }
      } catch {
        if (!cancelled && lastAttempt) {
          setFraudState("error");
          clearInterval(timer);
        }
      }
    }

    void poll();
    timer = setInterval(() => void poll(), 4000);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.callConfigId, call.id, call.status, campaign?.datasetId]);

  // For link-type success metrics, the call's success is the trackable-link click
  // (deterministic attribution), NOT the free-text criterion LLM check — which has
  // nothing to evaluate and would otherwise show a misleading "No criterion defined".
  const linkMetric = findLinkSuccessMetric(campaign?.successDefinition);
  const isLinkSuccess = Boolean(linkMetric);
  const linkSuccessState: "met" | "pending" | "unmet" = attribution?.attributed
    ? "met"
    : hasLinkFollowUp && attribution === null
      ? "pending"
      : "unmet";
  const linkSuccessReason = !hasLinkFollowUp
    ? "The agent didn't send the link on this call."
    : attribution === null
      ? "Checking for clicks…"
      : attribution.attributed
        ? `Customer clicked ${linkMetric?.label ? `"${linkMetric.label}"` : "the link"}${
            attribution.attributedAt
              ? ` on ${new Date(attribution.attributedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
              : ""
          }.`
        : "Link sent — not clicked yet.";

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <SheetTitle className="truncate font-mono text-sm font-semibold">{callDisplayName(call)}</SheetTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {callStatusLabel(call)} · {formatDuration(call.durationSeconds)}
          </p>
          {isLiveTestCall(call) && (
            <span className="mt-2 inline-flex rounded-md px-1.5 py-0.5 text-[9.9px] text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
              Live test
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close call details"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className="border-b border-border p-5">
          {href ? (
            <div>
              <CallRecordingWaveform
                src={href}
                durationSeconds={recording?.durationSeconds ?? call.durationSeconds}
                contentType={recording?.contentType}
                channels={recording?.channels}
                downloadName={`${call.id}-${recording?.sid ?? "recording"}.${recording?.contentType?.includes("wav") ? "wav" : "mp3"}`}
              />
              {recording?.durationSeconds !== undefined && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatDuration(recording.durationSeconds)} · {recording.contentType ?? "audio"}
                </p>
              )}
            </div>
          ) : (
            <>
              <h3 className="text-xs font-medium uppercase text-muted-foreground">Recording</h3>
              <p className="mt-3 text-sm text-muted-foreground">No recording available.</p>
            </>
          )}
        </section>

        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Transcript</h3>
          {transcript.length > 0 ? (
            <div className="mt-3 space-y-3">
              {transcript.map((turn) => {
                const isUser = turn.role === "user";
                const roleLabel = isUser ? "User" : "Agent";

                return (
                  <div
                    key={turn.id}
                    className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[84%] rounded-lg px-3 py-2.5",
                        isUser ? "bg-muted" : "bg-muted/25",
                      )}
                    >
                      <div className={cn("mb-1 flex items-center gap-3", isUser && "justify-end")}>
                        <p className="text-[9.9px] font-medium uppercase text-muted-foreground">{roleLabel}</p>
                        <p className="text-[9.9px] text-muted-foreground">
                          {transcriptTurnTimeLabel(turn, call.startedAt)}
                        </p>
                      </div>
                      <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed", isUser && "text-right")}>
                        {turn.text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No transcript captured yet.</p>
          )}
        </section>

        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Latency</h3>
          {latency && latency.turnCount > 0 ? (
            <div className="mt-3 space-y-4">
              <div className="grid grid-cols-4 gap-px overflow-hidden rounded-lg bg-border shadow-[0_0_0_1px_var(--color-border)]">
                <div className="bg-background px-3 py-2.5">
                  <p className="text-[9.9px] text-muted-foreground">Median</p>
                  <p className="mt-1 text-sm font-medium tabular-nums">{fmtMs(latency.v2vP50Ms)}</p>
                </div>
                <div className="bg-background px-3 py-2.5">
                  <p className="text-[9.9px] text-muted-foreground">p90</p>
                  <p className="mt-1 text-sm font-medium tabular-nums">{fmtMs(latency.v2vP90Ms)}</p>
                </div>
                <div className="bg-background px-3 py-2.5">
                  <p className="text-[9.9px] text-muted-foreground">Max</p>
                  <p className="mt-1 text-sm font-medium tabular-nums">{fmtMs(latency.v2vMaxMs)}</p>
                </div>
                <div className="bg-background px-3 py-2.5">
                  <p className="text-[9.9px] text-muted-foreground">Turns</p>
                  <p className="mt-1 text-sm font-medium tabular-nums">
                    {latency.measuredCount}/{latency.turnCount}
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[9.9px] uppercase text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Turn</th>
                      <th className="px-3 py-2 text-right font-medium">Voice-to-voice</th>
                      <th className="px-3 py-2 text-right font-medium">Think</th>
                      <th className="px-3 py-2 text-right font-medium">Lag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latency.turns.map((turn) => (
                      <tr key={turn.turnIndex} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {turn.turnIndex + 1}
                          {turn.interrupted && (
                            <span className="ml-1.5 text-[9px] uppercase text-muted-foreground">interrupted</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {fmtMs(turn.voiceToVoiceMs)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                          {fmtMs(turn.detectionThinkMs)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                          {fmtMs(turn.responseLagMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[9.9px] leading-relaxed text-muted-foreground">
                Voice-to-voice = silence the caller heard after finishing speaking before the agent
                replied. End-of-speech is a VAD proxy ({latency.eouSource === "gemini_vad_proxy" ? "speech-gated" : "raw-frame"}),
                since Gemini emits no explicit turn-end signal. Think = model endpointing + generation;
                Lag = our bridge forwarding delay.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Not measured — latency instrumentation was added after this call. New calls capture it automatically.
            </p>
          )}
        </section>

        {isFraudCall && (
          <section className="border-b border-border p-5">
            <h3 className="text-xs font-medium uppercase text-muted-foreground">Voice biometrics</h3>
            {fraudState === "loading" && (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Verifying voice — analysis runs after the call ends and can take a minute or two.
              </p>
            )}
            {fraudState === "error" && (
              <p className="mt-3 text-sm text-muted-foreground">Verification unavailable.</p>
            )}
            {fraudState === "ready" && fraudAnalysis && (
              <VoiceForensicsResults analysis={fraudAnalysis} datasetId={campaign?.datasetId} />
            )}
          </section>
        )}

        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Follow-ups</h3>
          {messageFollowUps.length > 0 ? (
            <div className="mt-3 space-y-2">
              {messageFollowUps.map((followUp) => {
                const isLinkFollowUp = followUp.reason === "send_link_tool";
                return (
                  <div key={followUp.id} className="rounded-lg bg-muted/25 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          <MessageSquare className="size-3.5 text-muted-foreground" />
                          {followUp.type === "whatsapp" ? "WhatsApp" : "SMS"} to {maskPhone(followUp.to)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {followUp.sentAt
                            ? new Date(followUp.sentAt).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })
                            : "Queued after transcript"}
                          {followUp.providerStatus ? ` · ${followUp.providerStatus}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md px-2 py-0.5 text-xs text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
                        {followUp.status}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                      {followUp.body}
                    </p>
                    {followUp.error && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Error: {followUp.error}
                      </p>
                    )}
                    {isLinkFollowUp && followUp.status === "sent" && (
                      <div className="mt-2 flex items-center gap-1.5">
                        {attribution === null ? (
                          <span className="text-xs text-muted-foreground">Checking click…</span>
                        ) : attribution.attributed ? (
                          <span className="rounded-md bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 shadow-[0_0_0_1px_theme(colors.green.500/30%)]">
                            Clicked · {new Date(attribution.attributedAt!).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </span>
                        ) : (
                          <span className="rounded-md px-2 py-0.5 text-xs text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
                            Not clicked yet{attribution.humanClickCount > 0 ? ` · ${attribution.humanClickCount} click${attribution.humanClickCount > 1 ? "s" : ""}` : ""}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No follow-up message triggered yet.</p>
          )}
        </section>

        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Stats</h3>
          <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border shadow-[0_0_0_1px_var(--color-border)]">
            {stats.map((item) => (
              <div key={item.label} className="bg-background px-3 py-2.5">
                <p className="text-[9.9px] text-muted-foreground">{item.label}</p>
                <p className="mt-1 truncate text-sm font-medium tabular-nums">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        {(isLinkSuccess || call.analysis?.criterionMet !== undefined || (call.analysis?.guardrailViolations?.length ?? 0) > 0) && (
          <section className="border-b border-border p-5">
            <h3 className="text-xs font-medium uppercase text-muted-foreground">Success check</h3>
            {isLinkSuccess ? (
              <div className="mt-3 flex items-start gap-2">
                <span className={cn(
                  "mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-xs font-medium",
                  linkSuccessState === "met"
                    ? "bg-green-500/10 text-green-600 shadow-[0_0_0_1px_theme(colors.green.500/30%)]"
                    : linkSuccessState === "pending"
                      ? "bg-muted text-muted-foreground shadow-[0_0_0_1px_theme(colors.border)]"
                      : "bg-red-500/10 text-red-600 shadow-[0_0_0_1px_theme(colors.red.500/30%)]"
                )}>
                  {linkSuccessState === "met" ? "Met" : linkSuccessState === "pending" ? "Pending" : "Not met"}
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">{linkSuccessReason}</p>
              </div>
            ) : call.analysis?.criterionMet !== undefined && (
              <div className="mt-3 flex items-start gap-2">
                <span className={cn(
                  "mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-xs font-medium",
                  call.analysis.criterionMet
                    ? "bg-green-500/10 text-green-600 shadow-[0_0_0_1px_theme(colors.green.500/30%)]"
                    : "bg-red-500/10 text-red-600 shadow-[0_0_0_1px_theme(colors.red.500/30%)]"
                )}>
                  {call.analysis.criterionMet ? "Met" : "Not met"}
                </span>
                {call.analysis.criterionReason && (
                  <p className="text-sm leading-relaxed text-muted-foreground">{call.analysis.criterionReason}</p>
                )}
              </div>
            )}
            {(call.analysis?.guardrailViolations?.length ?? 0) > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">Guardrail violations</p>
                {call.analysis!.guardrailViolations!.map((v, i) => (
                  <div key={i} className="rounded-lg bg-red-500/5 px-3 py-2 shadow-[0_0_0_1px_theme(colors.red.500/20%)]">
                    <p className="text-xs font-medium text-red-600">{v.rule}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Turn {v.turn} · &ldquo;{v.quote}&rdquo;</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Summary</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {callResponseSummary(call)}
          </p>
          {call.analysis?.reason && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {call.analysis.reason}
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}
