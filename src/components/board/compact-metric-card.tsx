import { deltaColorClass } from "@/lib/delta-colors";

interface CompactMetricCardProps {
  title: string;
  value: string;
  delta?: string;
  sparklineValues?: number[];
  category?: string;
}

function buildSparklinePath(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 48;
  const h = 20;
  const pad = 2;

  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = pad + (1 - (v - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function CompactMetricCard({
  title,
  value,
  delta,
  sparklineValues,
  category,
}: CompactMetricCardProps) {
  const sparkline =
    sparklineValues && sparklineValues.length > 1
      ? buildSparklinePath(sparklineValues)
      : null;

  const deltaNum = delta ? parseFloat(delta) : undefined;

  return (
    <div className="rounded-lg border border-border bg-card w-full">
      <div className="px-3 pt-2.5 pb-2">
        {/* Name */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-muted-foreground/50" />
          <span className="text-xs font-semibold truncate flex-1">
            {title}
          </span>
        </div>

        {/* Value + sparkline */}
        <div className="flex items-end justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-semibold leading-none">
              {value || "—"}
            </span>
            {delta && deltaNum !== undefined && !isNaN(deltaNum) && (
              <span
                className={`text-[9px] font-medium ${deltaColorClass(deltaNum)}`}
              >
                {delta}
              </span>
            )}
          </div>

          {sparkline && (
            <svg
              width="48"
              height="20"
              viewBox="0 0 48 20"
              className="shrink-0 text-muted-foreground/40"
            >
              <polyline
                points={sparkline}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        {/* Category */}
        {category && (
          <div className="mt-1.5">
            <span className="text-[9px] text-muted-foreground">
              {category}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
