"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { deltaColorClass } from "@/lib/delta-colors";
import type { SegmentDisplay } from "@/lib/types";

function formatMetricValue(key: string, value: number): string {
  if (key === "revenue") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value}`;
  }
  if (key === "aov") return `$${value}`;
  if (key === "retention") return `${value}%`;
  if (key === "users") {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString();
  }
  return String(value);
}

const METRIC_LABELS: Record<string, string> = {
  users: "Users",
  revenue: "Revenue",
  retention: "Retention",
  aov: "AOV",
};

interface BehavioralProfileSectionProps {
  segment: SegmentDisplay;
  onAskAbout: () => void;
}

export function BehavioralProfileSection({ segment, onAskAbout }: BehavioralProfileSectionProps) {
  const metrics = segment.performanceMetrics;

  return (
    <div className="space-y-6">
      {/* Behavioral Profile */}
      <div
        className="rounded-lg border bg-card p-5"
        style={{ borderLeftWidth: 4, borderLeftColor: segment.accentColor }}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-semibold">{segment.name}</h3>
          <button
            onClick={onAskAbout}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 transition-colors shrink-0 ml-3"
          >
            Ask About This Segment
          </button>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          {segment.behavioralSummary}
        </p>

        {/* Trait tags */}
        {segment.behavioralTraits && segment.behavioralTraits.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {segment.behavioralTraits.map((trait) => (
              <Badge key={trait} variant="secondary" className="text-xs px-2 py-0.5">
                {trait}
              </Badge>
            ))}
          </div>
        )}

        {/* Differentiator */}
        {segment.differentiator && (
          <div className="border-l-2 border-muted-foreground/20 pl-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">What makes them different</p>
            <p className="text-sm italic text-foreground/80">
              &ldquo;{segment.differentiator}&rdquo;
            </p>
          </div>
        )}
      </div>

      {/* Performance Metrics */}
      {metrics && (
        <div>
          <h3 className="text-sm font-medium mb-3">Performance</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(["users", "revenue", "retention", "aov"] as const).map((key) => {
              const m = metrics[key];
              return (
                <div key={key} className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground mb-1">
                    {METRIC_LABELS[key]}
                  </div>
                  <div className="text-lg font-semibold">
                    {formatMetricValue(key, m.value)}
                  </div>
                  <div
                    className={`flex items-center gap-0.5 text-xs font-medium mt-1 ${deltaColorClass(m.delta)}`}
                  >
                    {m.delta > 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : m.delta < 0 ? (
                      <TrendingDown className="w-3 h-3" />
                    ) : (
                      <Minus className="w-3 h-3" />
                    )}
                    {m.delta === 0 ? "No change" : `${Math.abs(m.delta)}%`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
