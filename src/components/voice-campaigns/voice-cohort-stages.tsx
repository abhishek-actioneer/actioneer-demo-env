"use client";

// Stage funnel — cohorts as cards in progression-stage columns. The view that
// encodes the variable the operator acts on: a cohort's stage. As waves run,
// each cohort's completed share fills, and the Completed column accumulates.

import {
  formatPercentShare,
  STAGE_LABEL,
  STAGE_ORDER,
  type CohortStage,
  type CohortVM,
} from "./voice-cohort-model";

const STAGE_HINT: Record<CohortStage, string> = {
  no_contact: "Never reached — redial levers move these.",
  stuck: "Willing but blocked — the link/human levers move these.",
  dead_end: "Refused or invalid — suppress to protect effort.",
  completed: "Reached the goal. Fills as granted waves run.",
};

function StageCohortCard({
  cohort,
  selected,
  onSelect,
}: {
  cohort: CohortVM;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const donePct = cohort.count > 0 ? (cohort.completed / cohort.count) * 100 : 0;
  return (
    <button
      className={`group relative w-full overflow-hidden rounded-lg p-3 text-left transition-colors ${
        selected ? "bg-muted/70 shadow-[0_0_0_1px_var(--foreground)]" : "bg-muted/30 shadow-[0_0_0_1px_var(--border)] hover:bg-muted/50"
      }`}
      onClick={() => onSelect(cohort.id)}
      type="button"
    >
      {cohort.completed > 0 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 bg-foreground/10"
          style={{ width: `${donePct}%` }}
        />
      ) : null}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-0.5"
        style={{ backgroundColor: cohort.accent }}
      />
      <div className="relative">
        <p className="text-sm font-medium leading-snug">{cohort.shortTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {cohort.count} calls · {formatPercentShare(cohort.share)}
          {cohort.completed > 0 ? ` · ${cohort.completed} done` : ""}
          {cohort.completed === 0 && cohort.inFlight > 0 ? ` · ${cohort.inFlight} in flight` : ""}
        </p>
        {cohort.projectedMoved !== undefined && cohort.completed === 0 ? (
          <p className="mt-1.5 text-[9.9px] text-muted-foreground">→ ~{cohort.projectedMoved} {cohort.movedLabel}</p>
        ) : null}
      </div>
    </button>
  );
}

export function CohortStages({
  cohorts,
  selectedId,
  onSelect,
}: {
  cohorts: CohortVM[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const totalCompleted = cohorts.reduce((sum, cohort) => sum + cohort.completed, 0);

  const byStage = (stage: CohortStage) =>
    cohorts
      .filter((cohort) => cohort.stage === stage)
      .sort((a, b) => b.count - a.count);

  const stageTotal = (stage: CohortStage) =>
    stage === "completed"
      ? totalCompleted
      : byStage(stage).reduce((sum, cohort) => sum + cohort.count, 0);

  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {STAGE_ORDER.map((stage) => {
        const cards = byStage(stage);
        return (
          <div key={stage} className="flex min-w-0 flex-col rounded-lg bg-muted/15 p-3">
            <div className="mb-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">{STAGE_LABEL[stage]}</p>
                <p className="text-sm font-semibold tabular-nums">{stageTotal(stage)}</p>
              </div>
              <p className="mt-1 text-[9.9px] leading-relaxed text-muted-foreground">{STAGE_HINT[stage]}</p>
            </div>
            <div className="flex flex-col gap-2">
              {stage === "completed" ? (
                <div className="rounded-lg bg-muted/30 p-4 text-center shadow-[0_0_0_1px_var(--border)]">
                  <p className="text-2xl font-semibold tabular-nums">{totalCompleted}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {totalCompleted === 0 ? "Grant a move to start filling this" : "moved to the goal so far"}
                  </p>
                </div>
              ) : cards.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No cohorts here.</p>
              ) : (
                cards.map((cohort) => (
                  <StageCohortCard
                    cohort={cohort}
                    key={cohort.id}
                    onSelect={onSelect}
                    selected={selectedId === cohort.id}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
