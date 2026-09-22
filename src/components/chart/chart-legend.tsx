"use client";

import { CHART_SHAPES, getSeriesColor, getSeriesShape, type ChartShape } from "@/lib/chart-colors";

// SVG shape renderers for a11y — each series gets a unique shape + color
function ShapeIcon({ shape, color, size = 10 }: { shape: ChartShape; color: string; size?: number }) {
  const half = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden="true">
      {shape === "circle" && <circle cx={half} cy={half} r={half - 1} fill={color} />}
      {shape === "square" && <rect x={1} y={1} width={size - 2} height={size - 2} rx={1} fill={color} />}
      {shape === "triangle" && (
        <polygon points={`${half},1 ${size - 1},${size - 1} 1,${size - 1}`} fill={color} />
      )}
      {shape === "diamond" && (
        <polygon points={`${half},0 ${size},${half} ${half},${size} 0,${half}`} fill={color} />
      )}
      {shape === "cross" && (
        <path
          d={`M${half - 1.5},1 h3 v${half - 2.5} h${half - 2.5} v3 h-${half - 2.5} v${half - 2.5} h-3 v-${half - 2.5} h-${half - 2.5} v-3 h${half - 2.5}z`}
          fill={color}
        />
      )}
    </svg>
  );
}

void CHART_SHAPES; // referenced for type only

export interface ChartLegendProps {
  series: { key: string; label: string }[];
  hiddenSeries: Set<string>;
  onToggle: (key: string) => void;
}

export function ChartLegend({ series, hiddenSeries, onToggle }: ChartLegendProps) {
  if (series.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1" role="group" aria-label="Chart series">
      {series.map((s, i) => {
        const hidden = hiddenSeries.has(s.key);
        const color = getSeriesColor(i);
        const shape = getSeriesShape(i);
        return (
          <button
            key={s.key}
            type="button"
            role="switch"
            aria-checked={!hidden}
            aria-label={`${hidden ? "Show" : "Hide"} ${s.label}`}
            className="relative flex items-center gap-1.5 py-1 min-h-[32px] text-[9.9px] transition-opacity duration-150 ease-out cursor-pointer motion-reduce:transition-none active:scale-[0.97]"
            style={{ opacity: hidden ? 0.35 : 1 }}
            onClick={() => onToggle(s.key)}
          >
            <ShapeIcon shape={shape} color={hidden ? "var(--color-muted-foreground)" : color} size={10} />
            <span className="text-muted-foreground">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
