"use client";

import { useState, useEffect, useRef } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  getOnboardingState,
  isOnboardingComplete,
  dismissOnboarding,
  STEP_IDS,
  type OnboardingState,
} from "@/lib/onboarding-store";

// ── Step definitions ──

const STEPS: { id: (typeof STEP_IDS)[number]; title: string; description: string }[] = [
  { id: "send-query", title: "Send your first query", description: "Ask a question about your data" },
  { id: "view-report", title: "View a research report", description: "Run a deep analysis to see the full report" },
  { id: "explore-data", title: "Explore the data", description: "Browse your data catalog" },
];

// ── Progress ring SVG ──

function ProgressRing({ completed, total }: { completed: number; total: number }) {
  const size = 28;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? completed / total : 0;
  const dashOffset = circumference * (1 - progress);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={strokeWidth}
      />
      {/* Filled arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-[stroke-dashoffset] duration-300 ease-out"
      />
      {/* Center text */}
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground"
        fontSize="9"
        fontWeight="600"
      >
        {completed}/{total}
      </text>
    </svg>
  );
}

// ── Widget ──

export function OnboardingWidget() {
  // Start hidden to prevent hydration flash
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [open, setOpen] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [hidden, setHidden] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hydrate from localStorage
  useEffect(() => {
    const s = getOnboardingState();
    setState(s);
    if (!isOnboardingComplete()) {
       
      setHydrated(true);
    }
    // else: keep hydrated=false so we never flash
  }, []);

  // Poll localStorage for changes (from other components calling markStepComplete)
  useEffect(() => {
    if (!hydrated) return;
    pollRef.current = setInterval(() => {
      const fresh = getOnboardingState();
      setState((prev) => {
        if (!prev) return fresh;
        // Only update if steps actually changed
        const changed = STEP_IDS.some((id) => prev.steps[id] !== fresh.steps[id]);
        return changed ? fresh : prev;
      });
    }, 500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hydrated]);

  // Completion sequence
  const completedCount = state ? STEP_IDS.filter((id) => state.steps[id]).length : 0;
  const allDone = completedCount === STEP_IDS.length;

  useEffect(() => {
    if (!allDone || !hydrated) return;
    // Step 1: show "all done" after 500ms
    const t1 = setTimeout(() => setShowAllDone(true), 500);
    // Step 2: start fade out after 2000ms
    const t2 = setTimeout(() => {
      setOpen(false);
      setFadingOut(true);
    }, 2000);
    // Step 3: hide permanently after fade (300ms)
    const t3 = setTimeout(() => {
      dismissOnboarding();
      setHidden(true);
    }, 2300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [allDone, hydrated]);

  // Don't render if not hydrated, already hidden, or already dismissed on mount
  if (!hydrated || hidden) return null;

  return (
    <div
      className="transition-opacity duration-300"
      style={{ opacity: fadingOut ? 0 : 1 }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-muted/50 transition-colors"
            aria-label="Onboarding progress"
          >
            <ProgressRing completed={completedCount} total={STEP_IDS.length} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          sideOffset={12}
          align="end"
          className="w-[280px] p-0"
        >
          {showAllDone ? (
            <div className="px-4 py-5 text-center">
              <CheckCircle2 className="w-8 h-8 text-foreground mx-auto mb-2" />
              <p className="text-sm font-semibold">You&apos;re all set</p>
              <p className="text-xs text-muted-foreground mt-1">
                You&apos;ve completed the getting started guide.
              </p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">Get Started</h4>
                <span className="text-xs text-muted-foreground">
                  {completedCount}/{STEP_IDS.length}
                </span>
              </div>
              {/* Steps */}
              <div className="px-4 pb-4 space-y-3">
                {STEPS.map((step) => {
                  const done = state?.steps[step.id] ?? false;
                  return (
                    <div key={step.id} className="flex items-start gap-2.5">
                      {done ? (
                        <CheckCircle2 className="w-[18px] h-[18px] text-foreground shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="w-[18px] h-[18px] text-muted-foreground/40 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-medium leading-tight ${
                            done ? "text-muted-foreground line-through" : ""
                          }`}
                        >
                          {step.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
