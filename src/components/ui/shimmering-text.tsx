"use client"

import React, { useMemo } from "react"
import type { UseInViewOptions } from "motion/react"

import { cn } from "@/lib/utils"

interface ShimmeringTextProps {
  /** Text to display with shimmer effect */
  text: string
  /** Animation duration in seconds */
  duration?: number
  /** Delay before starting animation */
  delay?: number
  /** Whether to repeat the animation */
  repeat?: boolean
  /** Pause duration between repeats in seconds */
  repeatDelay?: number
  /** Custom className */
  className?: string
  /** Whether to start animation when component enters viewport */
  startOnView?: boolean
  /** Whether to animate only once */
  once?: boolean
  /** Margin for in-view detection (rootMargin) */
  inViewMargin?: UseInViewOptions["margin"]
  /** Shimmer spread multiplier */
  spread?: number
  /** Base text color */
  color?: string
  /** Shimmer gradient color */
  shimmerColor?: string
}

export function ShimmeringText({
  text,
  duration = 2,
  delay = 0,
  repeat: _repeat = true,
  repeatDelay: _repeatDelay = 0.5,
  className,
  startOnView: _startOnView = true,
  once: _once = false,
  inViewMargin: _inViewMargin,
  spread = 2,
  color,
  shimmerColor,
}: ShimmeringTextProps) {
  // Calculate dynamic spread based on text length
  const dynamicSpread = useMemo(() => {
    return text.length * spread
  }, [text, spread])

  return (
    <span
      className={cn(
        "relative inline-block bg-clip-text text-transparent",
        "animate-[shimmer-sweep_3s_linear_infinite]",
        className
      )}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage: `linear-gradient(90deg, var(--base-color) 0%, var(--base-color) calc(50% - var(--spread)), var(--shimmer-color) 50%, var(--base-color) calc(50% + var(--spread)), var(--base-color) 100%), linear-gradient(var(--base-color), var(--base-color))`,
          backgroundSize: "200% 100%, auto",
          backgroundRepeat: "no-repeat, padding-box",
          "--base-color": color ?? "oklch(0.55 0 0)",
          "--shimmer-color": shimmerColor ?? "oklch(0.78 0.005 80)",
          animationDuration: `${duration}s`,
          animationDelay: `${delay}s`,
        } as React.CSSProperties
      }
    >
      {text}
    </span>
  )
}
