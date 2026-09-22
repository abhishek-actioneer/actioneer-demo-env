"use client";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function Sparkline({ data, width = 64, height = 20, className }: SparklineProps) {
  if (!data.length || data.every((v) => v === 0)) {
    return (
      <svg width={width} height={height} className={className}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          opacity={0.15}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const padding = 2;
  const usableH = height - padding * 2;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = padding + usableH - ((v - min) / range) * usableH;
      return `${x},${y}`;
    })
    .join(" ");

  // Determine trend color based on first half vs second half average
  const mid = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const secondHalf = data.slice(mid).reduce((s, v) => s + v, 0) / (data.length - mid);
  const isUp = secondHalf >= firstHalf;

  return (
    <svg width={width} height={height} className={className}>
      <polyline
        points={points}
        fill="none"
        stroke={isUp ? "var(--color-foreground)" : "var(--color-muted-foreground)"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={isUp ? 0.7 : 0.4}
      />
    </svg>
  );
}
