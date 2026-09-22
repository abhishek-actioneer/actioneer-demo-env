"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Loader2, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { HOLD_TO_LAUNCH_MS } from "@/lib/voice-campaign-studio-utils";

export function HoldToLaunchButton({
  disabled,
  busy,
  onComplete,
}: {
  disabled?: boolean;
  busy?: boolean;
  onComplete: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHolding(false);
  }, []);

  const startHold = useCallback(() => {
    if (disabled || busy || holdTimerRef.current) return;
    setHolding(true);
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      setHolding(false);
      onComplete();
    }, HOLD_TO_LAUNCH_MS);
  }, [busy, disabled, onComplete]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (disabled || busy) stopHold();
  }, [busy, disabled, stopHold]);

  const label = busy ? "Launching" : "Launch campaign";

  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-label="Hold for 3 seconds to launch campaign"
      title="Hold for 3 seconds to launch campaign"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        startHold();
      }}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat) startHold();
      }}
      onKeyUp={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        stopHold();
      }}
      onClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        "relative flex h-10 w-full select-none items-center justify-center gap-2 overflow-hidden rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground outline-none transition-[border-color,box-shadow,opacity,transform] duration-150 ease-out focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] active:scale-[0.99]",
        "cursor-pointer touch-none disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 bg-[#0a8f0a] text-white"
        style={{
          clipPath: holding ? "inset(0 0 0 0%)" : "inset(0 100% 0 0)",
          transitionProperty: "clip-path",
          transitionDuration: holding ? `${HOLD_TO_LAUNCH_MS}ms` : "160ms",
          transitionTimingFunction: holding ? "linear" : "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}
        {label}
      </span>
      <span className="relative z-10 flex items-center justify-center gap-2">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}
        {label}
      </span>
    </button>
  );
}
