"use client";

import { useMemo } from "react";

const GRID = 7;

const PALETTES = [
  ["#60a5fa", "#2563eb", "#93c5fd", "#1d4ed8", "#dbeafe"],
  ["#a78bfa", "#7c3aed", "#ddd6fe", "#6d28d9", "#ede9fe"],
  ["#34d399", "#059669", "#a7f3d0", "#047857", "#d1fae5"],
  ["#fbbf24", "#d97706", "#fde68a", "#b45309", "#fef3c7"],
  ["#fb7185", "#e11d48", "#fda4af", "#be123c", "#ffe4e6"],
  ["#38bdf8", "#0284c7", "#bae6fd", "#0369a1", "#e0f2fe"],
  ["#f97316", "#ea580c", "#fdba74", "#c2410c", "#fed7aa"],
  ["#14b8a6", "#0d9488", "#5eead4", "#0f766e", "#ccfbf1"],
];

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  return h;
}

function inCircle(x: number, y: number): boolean {
  const cx = (x + 0.5) / GRID - 0.5;
  const cy = (y + 0.5) / GRID - 0.5;
  return cx * cx + cy * cy <= 0.25;
}

function buildPixels(voiceName: string) {
  let h = hash(voiceName);
  const palette = PALETTES[Math.abs(h) % PALETTES.length]!;
  const pixels: Array<{ x: number; y: number; color: string; delay: number }> = [];

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!inCircle(x, y)) continue;
      h = ((h << 5) - h + x * 11 + y * 17) | 0;
      const raw = Math.abs(h) % 8;
      const colorIndex = raw < 2 ? 0 : raw < 4 ? 1 : raw < 5 ? 2 : raw < 7 ? 3 : 4;
      const delay = (Math.abs(h >> 3) % 9) * 0.08;
      pixels.push({ x, y, color: palette[colorIndex]!, delay });
    }
  }

  return pixels;
}

export function VoiceVoxel({
  voiceName,
  size = 24,
  animate = false,
}: {
  voiceName: string;
  size?: number;
  animate?: boolean;
}) {
  const pixels = useMemo(() => buildPixels(voiceName), [voiceName]);
  const cellSize = size / GRID;
  const gap = Math.max(0.5, cellSize * 0.12);

  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {pixels.map(({ x, y, color, delay }) => (
        <span
          key={`${x}-${y}`}
          className={animate ? "voice-voxel-pixel-animate" : undefined}
          style={{
            position: "absolute",
            left: x * cellSize + gap / 2,
            top: y * cellSize + gap / 2,
            width: cellSize - gap,
            height: cellSize - gap,
            backgroundColor: color,
            borderRadius: Math.max(1, size * 0.035),
            animationDelay: animate ? `${delay}s` : undefined,
          }}
        />
      ))}
    </span>
  );
}
