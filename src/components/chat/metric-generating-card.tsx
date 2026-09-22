"use client";

import { Check, Loader2 } from "lucide-react";

interface MetricGeneratingCardProps {
  data: {
    metricName: string;
    table: string;
    phase: "analyzing" | "generating" | "computing" | "done" | "error";
    error?: string;
  };
}

const PHASES = [
  { key: "analyzing", label: "Analyzing table schema" },
  { key: "generating", label: "Generating SQL & formula" },
  { key: "computing", label: "Computing metric value" },
] as const;

const ORDER = { analyzing: 0, generating: 1, computing: 2, done: 3, error: -1 };

export function MetricGeneratingCard({ data }: MetricGeneratingCardProps) {
  const currentIdx = ORDER[data.phase] ?? 0;
  const isDone = data.phase === "done";
  // Progress: 0→33→66→100
  const progressPct = isDone ? 100 : Math.round((currentIdx / PHASES.length) * 100);

  if (data.phase === "error") {
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-sm font-medium text-foreground mb-1">
          Failed to generate <strong>{data.metricName}</strong>
        </p>
        <p className="text-xs text-muted-foreground">Something went wrong while generating this metric. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      {/* Progress bar */}
      <div className="h-0.5 bg-border/50">
        <div
          className="h-full bg-foreground/40 transition-all duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-foreground mb-0.5">
              Generating <strong>{data.metricName}</strong>
            </p>
            <p className="text-[9.9px] text-muted-foreground">
              Using <code className="bg-muted px-1 rounded text-[9.9px] font-mono border border-border/60">{data.table}</code>
            </p>
          </div>
          {!isDone && (
            <span className="text-[9px] text-muted-foreground/60 tabular-nums">{currentIdx + 1}/{PHASES.length}</span>
          )}
        </div>

        <div className="space-y-1.5">
          {PHASES.map((phase, i) => {
            const isActive = i === currentIdx && !isDone;
            const isComplete = i < currentIdx || isDone;

            return (
              <div
                key={phase.key}
                className={`flex items-center gap-2.5 py-0.5 rounded-md transition-colors duration-200 ${
                  isActive ? "bg-muted/30 px-2 -mx-2" : ""
                }`}
              >
                {isComplete ? (
                  <Check className="w-3.5 h-3.5 text-muted-foreground animate-check-pop" />
                ) : isActive ? (
                  <Loader2 className="w-3.5 h-3.5 text-foreground animate-spin" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border-[1.5px] border-border/60" />
                )}
                <span
                  className={`text-xs transition-colors duration-200 ${
                    isActive
                      ? "text-foreground font-medium"
                      : isComplete
                        ? "text-muted-foreground"
                        : "text-muted-foreground/60"
                  }`}
                >
                  {phase.label}
                  {isActive && <span className="animate-pulse">…</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
