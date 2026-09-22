"use client";

import { ArrowRight } from "lucide-react";

interface AutofixDiffCardProps {
  cellLabel: string;
  oldSql: string;
  newSql: string;
  explanation: string;
  onApply: () => void;
  onDiscard: () => void;
  isApplying?: boolean;
}

export function AutofixDiffCard({
  cellLabel,
  oldSql,
  newSql,
  explanation,
  onApply,
  onDiscard,
  isApplying,
}: AutofixDiffCardProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-5">
        {/* Header */}
        <div>
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Auto-Fix Ready
          </p>
          <h2 className="text-sm font-semibold leading-snug">{cellLabel}</h2>
          <p className="text-[10.8px] text-muted-foreground mt-1.5 leading-relaxed">
            {explanation}
          </p>
        </div>

        <div className="border-b border-border" />

        {/* Before */}
        <div>
          <p className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">
            Before
          </p>
          <div className="rounded-md border border-border bg-muted overflow-hidden">
            <pre className="p-3 text-[9.9px] font-mono leading-relaxed text-muted-foreground/70 overflow-x-auto whitespace-pre-wrap">
              {oldSql}
            </pre>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center justify-center">
          <ArrowRight className="w-4 h-4 text-muted-foreground/40" />
        </div>

        {/* After */}
        <div>
          <p className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">
            After
          </p>
          <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
            <pre className="p-3 text-[9.9px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
              {newSql}
            </pre>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onDiscard}
            disabled={isApplying}
            className="px-3 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Discard
          </button>
          <button
            onClick={onApply}
            disabled={isApplying}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground hover:bg-foreground/90 active:scale-[0.98] text-background text-xs font-medium rounded-md transition-[background-color,transform] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isApplying ? (
              <>
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="28"
                    strokeDashoffset="7"
                    strokeLinecap="round"
                  />
                </svg>
                Applying…
              </>
            ) : (
              <>
                Apply Fix
                <ArrowRight className="w-3 h-3" />
              </>
            )}
          </button>
          <p className="text-[9.9px] text-muted-foreground ml-auto">
            Re-run to verify.
          </p>
        </div>
      </div>
    </div>
  );
}
