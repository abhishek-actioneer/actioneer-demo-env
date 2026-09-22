"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { DotmSquare2 } from "@/components/ui/dotm-square-2";
import { DotmSquare3 } from "@/components/ui/dotm-square-3";
import { DotmSquare6 } from "@/components/ui/dotm-square-6";
import { DotmSquare7 } from "@/components/ui/dotm-square-7";
import { DotmSquare9 } from "@/components/ui/dotm-square-9";
import { DotmSquare11 } from "@/components/ui/dotm-square-11";
import { DotmSquare14 } from "@/components/ui/dotm-square-14";
import { DotmSquare15 } from "@/components/ui/dotm-square-15";
import { DotmSquare18 } from "@/components/ui/dotm-square-18";
import { DotmCircular2 } from "@/components/ui/dotm-circular-2";
import { DotmCircular4 } from "@/components/ui/dotm-circular-4";
import { DotmCircular8 } from "@/components/ui/dotm-circular-8";
import { DotMatrixBase } from "@/lib/dotmatrix-core";
import type { DotAnimationResolver, DotMatrixCommonProps } from "@/lib/dotmatrix-core";

// ── Per-agent peak frame: the moment each loader's pattern is most fully expressed ──
// Returns 0..1 opacity for each (row, col) in a 5×5 grid. 0 = dim background, 1 = brightest.

type PeakFn = (row: number, col: number) => number;

const PEAK_FN: Record<string, PeakFn> = {
  // Pulse Ladder — snake fills column-by-column, peak = full ladder visible (left bright → right dim)
  "data-quality": (_r, c) => [0.9, 0.72, 0.55, 0.4, 0.25][c]!,

  // Sound Bars — bars at peak height (varied heights centred on col 2)
  "daily-metrics": (r, c) => {
    const heights = [3, 5, 4, 5, 3];
    const lit = r >= 5 - heights[c]!;
    return lit ? 0.88 : 0.06;
  },

  // Echo Ring — concentric ring at full radius, outer ring brightest
  "cohort-retention": (r, c) => {
    const ring = Math.max(Math.abs(r - 2), Math.abs(c - 2));
    return [0.4, 0.55, 0.92][ring]!;
  },

  // Prism Bloom — radial bloom, center brightest, fading outward
  "rev-opt": (r, c) => {
    const d = Math.hypot(r - 2, c - 2);
    return Math.max(0.18, 0.95 - d * 0.32);
  },

  // Tri Orbit — three orbital clusters
  "user-segmentation": (r, c) => {
    const cluster = (cr: number, cc: number) => Math.hypot(r - cr, c - cc) <= 1.2;
    if (cluster(0, 2) || cluster(3.5, 0.5) || cluster(3.5, 3.5)) {
      const d = Math.min(
        Math.hypot(r - 0, c - 2),
        Math.hypot(r - 3.5, c - 0.5),
        Math.hypot(r - 3.5, c - 3.5),
      );
      return Math.max(0.35, 0.92 - d * 0.4);
    }
    return 0.06;
  },

  // Radar Arc — sweep frozen at top-right quadrant, center bright
  geographic: (r, c) => {
    if (r === 2 && c === 2) return 0.95;
    const dx = c - 2;
    const dy = 2 - r;
    const angle = Math.atan2(dy, dx); // 0 = east, π/2 = north
    const radius = Math.hypot(dx, dy);
    if (radius === 0) return 0.95;
    const inSweep = angle >= 0 && angle <= Math.PI * 0.7;
    return inSweep ? Math.max(0.3, 0.85 - radius * 0.18) : 0.08;
  },

  // Glyph Pulse — full glyph at peak: + cross with bright center
  critique: (r, c) => {
    if (r === 2 && c === 2) return 0.95;
    if (r === 2 || c === 2) return 0.78;
    if (Math.abs(r - 2) === Math.abs(c - 2)) return 0.45;
    return 0.1;
  },

  // Core Spiral — spiral path drawn outward
  research: (r, c) => {
    const spiral: Record<string, number> = {
      "2,2": 0.95, "2,3": 0.88, "1,3": 0.82, "1,2": 0.75, "1,1": 0.68,
      "2,1": 0.6, "3,1": 0.52, "3,2": 0.45, "3,3": 0.38, "3,4": 0.32,
      "2,4": 0.26, "1,4": 0.22, "0,4": 0.18,
    };
    return spiral[`${r},${c}`] ?? 0.06;
  },

  // Flux Columns — alternating columns at peak flow
  "data-analysis": (_r, c) => [0.85, 0.3, 0.85, 0.3, 0.85][c]!,

  // Heart Pulse — heart silhouette at peak
  "marketing-optimization": (r, c) => {
    const heart = [
      [0, 1, 0, 1, 0],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [0, 1, 1, 1, 0],
      [0, 0, 1, 0, 0],
    ];
    return heart[r]![c] === 1 ? 0.88 : 0.06;
  },

  // Helix Glow — twin diagonals crossing through center
  "report-synthesizer": (r, c) => {
    if (r === c) return 0.85;
    if (r + c === 4) return 0.85;
    if (r === 2 && c === 2) return 0.95;
    return 0.08;
  },
};

const DEFAULT_PEAK_FN: PeakFn = (r, _c) => {
  // Block Drop — block landed at the bottom rows
  return r >= 2 ? 0.78 : 0.12;
};

function makePeakResolver(agentId: string): DotAnimationResolver {
  const peakFn = PEAK_FN[agentId] ?? DEFAULT_PEAK_FN;
  return ({ isActive, row, col }) => {
    if (!isActive) return { className: "dmx-inactive" };
    return { style: { opacity: peakFn(row, col) } };
  };
}

type LoaderComponent = (props: DotMatrixCommonProps) => React.ReactElement;

const AGENT_LOADER: Record<string, LoaderComponent> = {
  "data-quality": DotmSquare2,
  "daily-metrics": DotmSquare18,
  "cohort-retention": DotmSquare11,
  "rev-opt": DotmSquare14,
  "user-segmentation": DotmCircular2,
  geographic: DotmCircular4,
  critique: DotmSquare9,
  research: DotmSquare3,
  "data-analysis": DotmSquare6,
  "marketing-optimization": DotmCircular8,
  "report-synthesizer": DotmSquare15,
};

const DEFAULT_LOADER: LoaderComponent = DotmSquare7;

const AGENT_COLOR_TOKEN: Record<string, string> = {
  "data-quality": "var(--agent-data-quality)",
  "daily-metrics": "var(--agent-daily-metrics)",
  "cohort-retention": "var(--agent-cohort-retention)",
  "rev-opt": "var(--agent-rev-opt)",
  "user-segmentation": "var(--agent-user-segmentation)",
  geographic: "var(--agent-geographic)",
  critique: "var(--agent-critique)",
  research: "var(--agent-research)",
  "data-analysis": "var(--agent-data-analysis)",
  "marketing-optimization": "var(--agent-marketing-optimization)",
  "report-synthesizer": "var(--agent-report-synthesizer)",
};

const DEFAULT_COLOR_TOKEN = "var(--agent-default)";

interface AgentOrbProps {
  agentId: string;
  size?: number;
  animate?: boolean;
}

export function AgentOrb({ agentId, size = 18, animate = true }: AgentOrbProps) {
  const Loader = AGENT_LOADER[agentId] ?? DEFAULT_LOADER;
  const color = AGENT_COLOR_TOKEN[agentId] ?? DEFAULT_COLOR_TOKEN;
  const dotSize = Math.max(1.5, Math.round(size * 0.13));
  const peakResolver = useMemo(() => makePeakResolver(agentId), [agentId]);

  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const showStatic = !animate;

  return (
    <span
      ref={wrapperRef}
      className="shrink-0 inline-flex items-center justify-center pointer-events-none select-none"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {showStatic ? (
        <DotMatrixBase
          size={size}
          dotSize={dotSize}
          color={color}
          pattern="full"
          phase="idle"
          animated={false}
          reducedMotion
          animationResolver={peakResolver}
          ariaLabel={`${agentId} complete`}
        />
      ) : (
        <Loader
          size={size}
          dotSize={dotSize}
          color={color}
          speed={0.5}
          animated={isVisible}
          opacityPeak={0.6}
          opacityMid={0.22}
          opacityBase={0.05}
          ariaLabel={`${agentId} working`}
        />
      )}
    </span>
  );
}
