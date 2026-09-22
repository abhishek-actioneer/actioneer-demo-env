import type { MetricType } from "@/lib/metric-types";
import { METRIC_TYPE_ICONS, METRIC_TYPE_LABELS } from "@/lib/metric-types";

export function MetricTypeIcon({
  type,
  showLabel = true,
  size = "sm",
}: {
  type: MetricType;
  showLabel?: boolean;
  size?: "xs" | "sm";
}) {
  const icon = METRIC_TYPE_ICONS[type];
  const label = METRIC_TYPE_LABELS[type];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium border border-border text-muted-foreground ${
        size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[9.9px]"
      }`}
    >
      <span className={size === "xs" ? "text-[8.1px]" : "text-[9px]"}>{icon}</span>
      {showLabel && label}
    </span>
  );
}
