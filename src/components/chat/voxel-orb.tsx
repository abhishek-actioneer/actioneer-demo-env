"use client";

import { useMemo } from "react";

// ── Color palettes per agent ──

const PALETTES: Record<string, string[]> = {
  "data-quality": ["#60a5ff", "#3b82f6", "#93c5fd", "#2563eb", "#bfdbfe"],
  "daily-metrics": ["#4ade80", "#22c55e", "#86efac", "#16a34a", "#bbf7d0"],
  "cohort-retention": ["#f472b6", "#ec4899", "#f9a8d4", "#db2777", "#fbcfe8"],
  "rev-opt": ["#fbbf24", "#f59e0b", "#fcd34d", "#d97706", "#fde68a"],
  "user-segmentation": ["#c084fc", "#a855f7", "#d8b4fe", "#9333ea", "#e9d5ff"],
  geographic: ["#2dd4bf", "#14b8a6", "#5eead4", "#0d9488", "#99f6e4"],
  critique: ["#f87171", "#ef4444", "#fca5a5", "#dc2626", "#fecaca"],
  research: ["#fb923c", "#f97316", "#fdba74", "#ea580c", "#fed7aa"],
  "data-analysis": ["#818cf8", "#6366f1", "#a5b4fc", "#4f46e5", "#c7d2fe"],
  "marketing-optimization": ["#fb7185", "#f43f5e", "#fda4af", "#e11d48", "#fecdd3"],
};

const DEFAULT_PALETTE = ["#d4d4d8", "#a1a1aa", "#e4e4e7", "#71717a", "#f4f4f5"];

const GRID = 7;

function getPalette(agentId: string): string[] {
  return PALETTES[agentId] || DEFAULT_PALETTE;
}

// Deterministic hash
function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

// Check if cell is inside circle
function inCircle(x: number, y: number): boolean {
  const cx = (x + 0.5) / GRID - 0.5;
  const cy = (y + 0.5) / GRID - 0.5;
  return cx * cx + cy * cy <= 0.25;
}

// Build deterministic pixel grid
function buildPixels(agentId: string, palette: string[]): { x: number; y: number; color: string; delay: number }[] {
  let h = hash(agentId);
  const pixels: { x: number; y: number; color: string; delay: number }[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!inCircle(x, y)) continue;
      h = ((h << 5) - h + x * 7 + y * 13) | 0;
      // Bias toward saturated colors (indices 0-3), use pastel (4) rarely
      const raw = Math.abs(h) % 7;
      const colorIdx = raw < 2 ? 0 : raw < 4 ? 1 : raw < 5 ? 2 : raw < 6 ? 3 : 4;
      // Stagger animation delays for organic shimmer
      const delay = ((Math.abs(h >> 4) % 8) * 0.15);
      pixels.push({ x, y, color: palette[colorIdx], delay });
    }
  }
  return pixels;
}

interface VoxelOrbProps {
  agentId: string;
  size?: number;
  animate?: boolean;
}

export function VoxelOrb({ agentId, size = 20, animate = true }: VoxelOrbProps) {
  const palette = getPalette(agentId);
  const pixels = useMemo(() => buildPixels(agentId, palette), [agentId, palette]);
  const cellSize = size / GRID;
  const gap = Math.max(0.5, cellSize * 0.12);

  return (
    <div
      className="shrink-0 relative"
      style={{ width: size, height: size }}
    >
      {pixels.map(({ x, y, color, delay }) => (
        <div
          key={`${x}-${y}`}
          className={animate ? "voxel-pixel-animate" : undefined}
          style={{
            position: "absolute",
            left: x * cellSize + gap / 2,
            top: y * cellSize + gap / 2,
            width: cellSize - gap,
            height: cellSize - gap,
            backgroundColor: color,
            borderRadius: 1,
            animationDelay: animate ? `${delay}s` : undefined,
          }}
        />
      ))}
    </div>
  );
}
