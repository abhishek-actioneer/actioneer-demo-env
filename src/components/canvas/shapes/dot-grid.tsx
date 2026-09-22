"use client";

/**
 * Custom dot grid background for tldraw canvas.
 * Matches the playbook canvas aesthetic: subtle dots, gap=16, size=1.5.
 */
export function DotGrid({ x, y, z }: { x: number; y: number; z: number; size: number }) {
  const gap = 16;
  const dotRadius = 1.5;

  // Scale gap by zoom level
  const scaledGap = gap * z;

  // Don't render dots if too zoomed out (they'd be invisible)
  if (scaledGap < 4) return null;

  // Offset based on camera position
  const offsetX = (x * z) % scaledGap;
  const offsetY = (y * z) % scaledGap;

  return (
    <svg className="tl-grid" width="100%" height="100%">
      <defs>
        <pattern
          id="actioneer-dot-grid"
          width={scaledGap}
          height={scaledGap}
          patternUnits="userSpaceOnUse"
          x={offsetX}
          y={offsetY}
        >
          <circle
            cx={scaledGap / 2}
            cy={scaledGap / 2}
            r={dotRadius * Math.min(z, 1)}
            fill="color-mix(in srgb, var(--muted-foreground) 10%, transparent)"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#actioneer-dot-grid)" />
    </svg>
  );
}
