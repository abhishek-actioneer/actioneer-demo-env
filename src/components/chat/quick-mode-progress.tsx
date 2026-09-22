import { Check } from "lucide-react";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import { useElapsedTime } from "@/hooks/use-elapsed-time";

type Phase = "gathering" | "generating_sql" | "executing" | "synthesizing" | "streaming" | "done";

interface QuickModeProgressProps {
  phase: Phase;
}

export function QuickModeProgress({ phase }: QuickModeProgressProps) {
  const elapsedTime = useElapsedTime(true);
  const steps = ["Generating SQL", "Executing", "Synthesizing"];

  // Map phases to step indices
  const getStepIndex = (phase: Phase): number => {
    switch (phase) {
      case "gathering":
      case "generating_sql":
        return 0;
      case "executing":
        return 1;
      case "synthesizing":
      case "streaming":
      case "done":
        return 2;
      default:
        return 0;
    }
  };

  const currentIndex = getStepIndex(phase);

  return (
    <div className="flex items-center gap-2.5 text-xs">
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div key={step} className="flex items-center gap-2.5">
            {/* Step indicator and label */}
            <div className="flex items-center gap-1.5">
              {/* Indicator — uniform 6px size for all states */}
              {isCompleted ? (
                <Check className="w-3 h-3 text-muted-foreground/60 shrink-0" strokeWidth={2.5} />
              ) : isCurrent ? (
                <div className="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
              ) : (
                <div className="w-1.5 h-1.5 rounded-full border border-muted-foreground/30 shrink-0" />
              )}

              {/* Label */}
              <span
                className={
                  isCompleted
                    ? "text-muted-foreground/60"
                    : isCurrent
                    ? "text-foreground"
                    : "text-muted-foreground/30"
                }
              >
                {isCurrent ? (
                  <ShimmeringText text={step} className="text-xs" duration={3} repeatDelay={0} />
                ) : (
                  step
                )}
              </span>
            </div>

            {/* Connecting line (except for last step) */}
            {index < steps.length - 1 && (
              <div className="w-4 h-px bg-border/60" />
            )}
          </div>
        );
      })}
      {/* Timer — separated from steps */}
      <span className="text-muted-foreground/40 tabular-nums ml-2 text-[9.9px]">{elapsedTime}</span>
    </div>
  );
}