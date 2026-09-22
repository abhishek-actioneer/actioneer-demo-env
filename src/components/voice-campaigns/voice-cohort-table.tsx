"use client";

// The cohort table — the working spine of the intelligence page. Sortable,
// scannable, and the primary drill surface: every row expands to its calls.

import { useMemo, useState } from "react";
import type { VoiceCampaignCallDetail } from "@/lib/voice-campaign-insights-types";
import {
  formatPercentShare,
  outcomeShade,
  sortedMix,
  STAGE_LABEL,
  STAGE_ORDER,
  type CohortVM,
} from "./voice-cohort-model";

type SortKey = "count" | "title" | "lane" | "moved" | "stage";

const CAPABILITY_LABEL: Record<string, string> = {
  send_kyc_link: "Send KYC link",
  schedule_retry: "Re-dial on schedule",
  route_human: "Route to human",
  suppress: "Suppress",
};

const STATUS_LABEL: Record<string, string> = {
  requested: "Awaiting approval",
  granted: "Granted",
  rejected: "Rejected",
};

function OutcomeBar({ mix }: { mix: Record<string, number> }) {
  const entries = sortedMix(mix);
  const total = entries.reduce((sum, [, count]) => sum + count, 0) || 1;
  return (
    <div className="flex h-2 w-28 overflow-hidden rounded-full" title={entries.map(([o, c]) => `${o} ${c}`).join(" · ")}>
      {entries.map(([outcome, count]) => (
        <div
          key={outcome}
          style={{ width: `${(count / total) * 100}%`, backgroundColor: outcomeShade(outcome) }}
        />
      ))}
    </div>
  );
}

// outcome → customer sentiment (tinted pill, like the call-log reference) and
// call disposition (dot + label). Sentiment is shown only when the customer
// actually spoke: "busy" calls are real conversations (avg 3 customer turns —
// "abhi busy hoon, baad mein call karna"), so they read Neutral. Truly silent
// outcomes (no_answer, failed) and non-customer answers (wrong_number) carry
// no sentiment.
const SENTIMENT: Record<string, { bars: number; label: string; tint: string }> = {
  positive: { bars: 4, label: "Positive", tint: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300" },
  neutral: { bars: 2, label: "Neutral", tint: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200" },
  busy: { bars: 2, label: "Neutral", tint: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200" },
  negative: { bars: 1, label: "Unhappy", tint: "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300" },
};

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

function SignalBars({ filled }: { filled: number }) {
  return (
    <span className="inline-flex items-end gap-0.5" aria-hidden>
      {[3, 6, 9, 12].map((height, index) => (
        <span
          className={`w-0.5 rounded-sm ${index < filled ? "bg-current" : "bg-current/25"}`}
          key={height}
          style={{ height }}
        />
      ))}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      className={`shrink-0 text-muted-foreground transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`}
      fill="none"
      height="12"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="12"
    >
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** How many users this cohort's move has actually or would plausibly progress. */
function movedValue(cohort: CohortVM): number {
  if (cohort.completed > 0) return cohort.completed;
  return cohort.projectedMoved ?? -1;
}

function ClockIcon() {
  return (
    <svg className="text-muted-foreground" fill="none" height="13" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" width="13">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  );
}

function CallIcon() {
  return (
    <svg className="text-muted-foreground" fill="none" height="13" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" width="13">
      <path d="M5 4h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" strokeLinejoin="round" />
    </svg>
  );
}

function CallLogRows({
  callIds,
  callDetails,
  onOpenCall,
}: {
  callIds: string[];
  callDetails: Record<string, VoiceCampaignCallDetail>;
  onOpenCall: (callId: string) => void;
}) {
  const rows = callIds
    .map((id) => callDetails[id])
    .filter((detail): detail is VoiceCampaignCallDetail => Boolean(detail))
    .slice(0, 50);

  return (
    <tr>
      <td className="bg-white p-0" colSpan={6}>
        {rows.length === 0 ? (
          <p className="px-10 py-3 text-xs text-muted-foreground">No call-level detail for this cohort.</p>
        ) : (
          <div className="pl-7">
            {rows.map((detail) => {
              const sentiment = SENTIMENT[detail.outcome];
              const disposition = DISPOSITION[detail.outcome] ?? { label: detail.outcome, dot: "bg-muted-foreground" };
              return (
                <div
                  className="flex cursor-pointer items-center gap-4 bg-white px-4 py-3 shadow-[inset_0_-1px_0_0_var(--border)] transition-colors last:shadow-none hover:bg-neutral-50/80 focus:bg-neutral-50 focus:outline-none"
                  key={detail.callId}
                  onClick={() => onOpenCall(detail.callId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenCall(detail.callId);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="flex w-24 shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    <CallIcon />
                    {detail.callId.split("_").pop()}
                  </span>

                  <span className="w-28 shrink-0">
                    {sentiment ? (
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${sentiment.tint}`}>
                        <SignalBars filled={sentiment.bars} />
                        {sentiment.label}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {detail.evidenceQuotes[0] ? `“${detail.evidenceQuotes[0]}”` : detail.primarySignal}
                  </span>

                  <span className="flex w-32 shrink-0 items-center gap-2 text-sm">
                    <span className={`size-1.5 rounded-full ${disposition.dot}`} />
                    {disposition.label}
                  </span>

                  <span className="flex w-20 shrink-0 items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
                    <ClockIcon />
                    {formatDuration(detail.durationSeconds)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </td>
    </tr>
  );
}

export function CohortTable({
  cohorts,
  selectedId,
  onSelect,
  callDetails,
  onOpenCall,
}: {
  cohorts: CohortVM[];
  selectedId?: string;
  onSelect: (id: string) => void;
  callDetails: Record<string, VoiceCampaignCallDetail>;
  onOpenCall: (callId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [asc, setAsc] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const rows = [...cohorts];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "lane":
          cmp = a.laneLabel.localeCompare(b.laneLabel);
          break;
        case "moved":
          cmp = movedValue(a) - movedValue(b);
          break;
        case "stage":
          cmp = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
          break;
        default:
          cmp = a.count - b.count;
      }
      return asc ? cmp : -cmp;
    });
    return rows;
  }, [cohorts, sortKey, asc]);

  const sort = (key: SortKey) => {
    if (key === sortKey) setAsc((prev) => !prev);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  const arrow = (key: SortKey) => (key === sortKey ? (asc ? " ↑" : " ↓") : "");

  const th = "cursor-pointer select-none px-4 py-2 text-left text-[9.9px] font-medium uppercase text-muted-foreground hover:text-foreground";

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse bg-white text-sm">
        <thead className="bg-neutral-50">
          <tr className="shadow-[inset_0_-1px_0_0_var(--border)]">
            <th className={th} onClick={() => sort("title")}>Cohort{arrow("title")}</th>
            <th className={th} onClick={() => sort("lane")}>Lane{arrow("lane")}</th>
            <th className={`${th} text-right`} onClick={() => sort("count")}>Calls{arrow("count")}</th>
            <th className="px-4 py-2 text-left text-[9.9px] font-medium uppercase text-muted-foreground">How calls ended</th>
            <th className={th} onClick={() => sort("stage")}>Where they are{arrow("stage")}</th>
            <th className={th} onClick={() => sort("moved")}>Next step{arrow("moved")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((cohort) => {
            const isOpen = expanded === cohort.id;
            const isSelected = selectedId === cohort.id;
            return (
              <ExpandableGroup key={cohort.id}>
                <tr
                  aria-expanded={isOpen}
                  className={`cursor-pointer bg-white shadow-[inset_0_-1px_0_0_var(--border)] transition-colors hover:bg-neutral-50/80 focus:bg-neutral-50 focus:outline-none ${isSelected ? "!bg-neutral-100" : ""}`}
                  onClick={() => {
                    onSelect(cohort.id);
                    setExpanded(isOpen ? null : cohort.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(cohort.id);
                      setExpanded(isOpen ? null : cohort.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <Chevron open={isOpen} />
                      <span className="min-w-0 truncate">{cohort.shortTitle}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="inline-block size-2 rounded-full" style={{ backgroundColor: cohort.accent }} />
                      {cohort.laneLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {cohort.count}
                    <span className="ml-1.5 text-xs text-muted-foreground">{formatPercentShare(cohort.share)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2.5">
                      <OutcomeBar mix={cohort.outcomeMix} />
                      <span className="text-xs text-muted-foreground">
                        mostly {(DISPOSITION[cohort.dominantOutcome]?.label ?? cohort.dominantOutcome).toLowerCase()}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{STAGE_LABEL[cohort.stage]}</td>
                  <td className="px-4 py-3">
                    {cohort.capability ? (
                      <span className="block text-xs leading-snug">
                        {CAPABILITY_LABEL[cohort.capability]}
                        <span className="mt-0.5 block text-muted-foreground">
                          {cohort.completed > 0 ? (
                            <>
                              <span className="font-semibold text-foreground tabular-nums">{cohort.completed}</span>
                              {` ${cohort.movedLabel ?? "moved"}`}
                            </>
                          ) : cohort.projectedMoved !== undefined ? (
                            `→ ~${cohort.projectedMoved} ${cohort.movedLabel ?? "moved"}`
                          ) : null}
                          {cohort.status ? ` · ${STATUS_LABEL[cohort.status]}` : null}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
                {isOpen ? (
                  <CallLogRows callDetails={callDetails} callIds={cohort.callIds} onOpenCall={onOpenCall} />
                ) : null}
              </ExpandableGroup>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Fragment wrapper so a row + its expanded call rows share one key. */
function ExpandableGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
