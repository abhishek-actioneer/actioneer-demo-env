"use client";

import { Check, X } from "lucide-react";
import type { Scorecard } from "@/features/roleplay/roleplay-scorer";

/** Renders a completed Assess scorecard — overall score, gates, competencies, feedback. */
export function ScorecardView({ card }: { card: Scorecard }) {
  const competencies = card.items.filter((i) => !i.gate);
  const gates = card.items.filter((i) => i.gate);

  return (
    <div className="rounded-lg border border-border p-5 flex flex-col gap-5">
      {/* Header: overall + pass/fail */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold text-foreground tabular-nums">{card.overallScore}</span>
          <span className="text-sm text-muted-foreground">/ 100 · competency</span>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            card.passed ? "border border-foreground text-foreground" : "bg-foreground text-background"
          }`}
        >
          {card.passed ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
          {card.passed ? "PASS · all gates cleared" : "FAIL · gate not met"}
        </span>
      </div>

      {card.gateFailures.length > 0 && (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground mb-1">Gate failures</p>
          <ul className="flex flex-col gap-0.5">
            {card.gateFailures.map((g) => (
              <li key={g} className="text-sm text-muted-foreground">• {g}</li>
            ))}
          </ul>
        </div>
      )}

      {card.summary && <p className="text-sm text-foreground leading-relaxed">{card.summary}</p>}

      {/* Compliance & required gates */}
      {gates.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Gates</p>
          {gates.map((g) => (
            <div key={g.id} className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0">
                {g.passed ? <Check className="w-4 h-4 text-foreground" /> : <X className="w-4 h-4 text-foreground" />}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  {g.label}
                  {!g.addressed && <span className="text-muted-foreground"> · not raised</span>}
                </p>
                {g.rationale && <p className="text-xs text-muted-foreground">{g.rationale}</p>}
                {g.evidence && <p className="text-xs text-muted-foreground italic">“{g.evidence}”</p>}
                {g.groundTruthRef && (
                  <p className="text-[9.9px] text-muted-foreground/80 mt-0.5">ref: {g.groundTruthRef}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Weighted competencies */}
      {competencies.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Competencies</p>
          {competencies.map((c) => (
            <div key={c.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground min-w-0 truncate">{c.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {Math.round(c.score * 100)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-foreground" style={{ width: `${Math.round(c.score * 100)}%` }} />
              </div>
              {c.rationale && <p className="text-xs text-muted-foreground">{c.rationale}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Strengths / improvements */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {card.strengths.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Strengths</p>
            <ul className="flex flex-col gap-1">
              {card.strengths.map((s, i) => (
                <li key={i} className="text-sm text-muted-foreground">• {s}</li>
              ))}
            </ul>
          </div>
        )}
        {card.improvements.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">To improve</p>
            <ul className="flex flex-col gap-1">
              {card.improvements.map((s, i) => (
                <li key={i} className="text-sm text-muted-foreground">• {s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
