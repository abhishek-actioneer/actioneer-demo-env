"use client";

import { MessageSquareText } from "lucide-react";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";
import {
  buildResponseAggregate,
  aggregateReadout,
  defaultAggregateNextSteps,
  formatResponsePercent,
  OUTCOME_LABELS,
  OUTCOME_ORDER,
} from "@/lib/voice-campaign-analysis";

export function VoiceResponsesPanel({ campaign }: { campaign: VoiceCampaign | null }) {
  const calls = Array.isArray(campaign?.calls) ? campaign.calls : [];
  const aggregate = buildResponseAggregate(calls);
  const outcomeRows = OUTCOME_ORDER.map((outcome) => ({
    key: outcome,
    label: OUTCOME_LABELS[outcome],
    count: aggregate.outcomeCounts[outcome],
    percent: aggregate.classifiedCount > 0
      ? Math.round((aggregate.outcomeCounts[outcome] / aggregate.classifiedCount) * 100)
      : 0,
  })).filter((row) => row.count > 0);
  const nextSteps = aggregate.nextSteps.length > 0
    ? aggregate.nextSteps
    : defaultAggregateNextSteps(aggregate);
  const topSignal = aggregate.topOutcomes.length > 0
    ? aggregate.topOutcomes.map((outcome) => OUTCOME_LABELS[outcome]).join(" + ")
    : "-";

  return (
    <div className="space-y-4">
      {calls.length === 0 ? (
        <section className="flex min-h-[320px] items-center justify-center rounded-lg bg-background text-center shadow-[0_0_0_1px_var(--color-border)]">
          <div>
            <MessageSquareText className="mx-auto mb-3 size-10 text-muted-foreground" />
            <h2 className="text-sm font-medium">No responses yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Run a call or browser live test to populate response analysis.
            </p>
          </div>
        </section>
      ) : (
        <>
          <section className="overflow-hidden rounded-lg bg-background shadow-[0_0_0_1px_var(--color-border)]">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold">Aggregate readout</h2>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                {aggregateReadout(aggregate)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
              <div className="bg-background px-4 py-3">
                <p className="text-xs text-muted-foreground">Leading signal</p>
                <p className="mt-1 text-lg font-semibold">{topSignal}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {aggregate.topOutcomeCount > 0 ? `${aggregate.topOutcomeCount} classified` : "No signal yet"}
                </p>
              </div>
              <div className="bg-background px-4 py-3">
                <p className="text-xs text-muted-foreground">Customer response</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {formatResponsePercent(aggregate.customerRespondedCount, aggregate.classifiedCount)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {aggregate.customerRespondedCount} of {aggregate.classifiedCount} classified
                </p>
              </div>
              <div className="bg-background px-4 py-3">
                <p className="text-xs text-muted-foreground">Positive signal</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {formatResponsePercent(aggregate.outcomeCounts.positive, aggregate.classifiedCount)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {aggregate.outcomeCounts.positive} positive
                </p>
              </div>
              <div className="bg-background px-4 py-3">
                <p className="text-xs text-muted-foreground">Pending analysis</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{aggregate.pendingAnalysisCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Waiting for transcript/status
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 border-t border-border lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">Outcome mix</h3>
                  <span className="text-xs text-muted-foreground">{aggregate.classifiedCount} classified</span>
                </div>
                <div className="mt-4 space-y-3">
                  {outcomeRows.length > 0 ? outcomeRows.map((row) => (
                    <div key={row.key} className="grid grid-cols-[120px_minmax(0,1fr)_52px] items-center gap-3">
                      <p className="truncate text-xs font-medium">{row.label}</p>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-foreground"
                          style={{ width: `${Math.max(row.percent, 4)}%` }}
                        />
                      </div>
                      <p className="text-right text-xs text-muted-foreground tabular-nums">
                        {row.count} · {row.percent}%
                      </p>
                    </div>
                  )) : (
                    <p className="text-xs text-muted-foreground">No classified outcomes yet.</p>
                  )}
                  {aggregate.pendingAnalysisCount > 0 && (
                    <div className="grid grid-cols-[120px_minmax(0,1fr)_52px] items-center gap-3">
                      <p className="truncate text-xs font-medium">Pending</p>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-muted-foreground"
                          style={{ width: `${Math.max(Math.round((aggregate.pendingAnalysisCount / aggregate.totalCalls) * 100), 4)}%` }}
                        />
                      </div>
                      <p className="text-right text-xs text-muted-foreground tabular-nums">
                        {aggregate.pendingAnalysisCount}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-border p-5 lg:border-l lg:border-t-0">
                <h3 className="text-xs font-medium uppercase text-muted-foreground">Source mix</h3>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium">Campaign calls</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{aggregate.campaignCallCount}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium">Live tests</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{aggregate.liveTestCount}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium">Test calls</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{aggregate.testCallCount}</span>
                  </div>
                  <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
                    Test calls and live tests stay out of Spotlight. Spotlight only reads campaign-launch calls.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg bg-background shadow-[0_0_0_1px_var(--color-border)]">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold">Aggregate takeaways</h2>
            </div>
            <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
              <div className="p-5">
                <h3 className="text-xs font-medium uppercase text-muted-foreground">Customer signal</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {aggregateReadout(aggregate)}
                </p>
                {aggregate.customerNeeds.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-muted-foreground">Captured needs</p>
                    <ul className="mt-2 space-y-2">
                      {aggregate.customerNeeds.map((need) => (
                        <li key={need} className="text-xs leading-relaxed text-muted-foreground">
                          {need}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="p-5">
                <h3 className="text-xs font-medium uppercase text-muted-foreground">Recommended next actions</h3>
                <ul className="mt-3 space-y-2">
                  {nextSteps.map((step) => (
                    <li key={step} className="text-sm leading-relaxed text-muted-foreground">
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
