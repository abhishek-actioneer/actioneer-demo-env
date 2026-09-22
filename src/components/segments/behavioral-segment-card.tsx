"use client";

import { useRouter } from "next/navigation";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SegmentDisplay } from "@/lib/types";

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

interface BehavioralSegmentCardProps {
  segment: SegmentDisplay;
}

export function BehavioralSegmentCard({ segment }: BehavioralSegmentCardProps) {
  const router = useRouter();
  const traits = segment.behavioralTraits ?? [];
  const visibleTraits = traits.slice(0, 3);
  const extraCount = traits.length - 3;

  return (
    <button
      onClick={() => router.push(`/segments/${segment.id}`)}
      className="text-left rounded-lg border bg-card p-4 transition-[box-shadow] hover:shadow-md group"
      style={{ borderTopWidth: 3, borderTopColor: segment.accentColor }}
    >
      {/* Name */}
      <p className="text-sm font-semibold truncate group-hover:text-foreground/80 transition-colors">
        {segment.name}
      </p>

      {/* Summary */}
      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
        {segment.behavioralSummary ?? segment.description}
      </p>

      {/* User count + trend */}
      <div className="flex items-center gap-2 mt-3">
        <span className="text-sm font-semibold">{formatCount(segment.userCount)}</span>
        {segment.trend !== null && segment.trend !== 0 && (
          <span
            className={`flex items-center gap-0.5 text-xs font-medium ${
              segment.trend > 0 ? "text-foreground" : "text-foreground"
            }`}
          >
            {segment.trend > 0 ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            {Math.abs(segment.trend)}%
          </span>
        )}
      </div>

      {/* Trait tags */}
      {visibleTraits.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {visibleTraits.map((trait) => (
            <Badge
              key={trait}
              variant="secondary"
              className="text-[9px] px-1.5 py-0 font-normal"
            >
              {trait}
            </Badge>
          ))}
          {extraCount > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-normal text-muted-foreground">
              +{extraCount} more
            </Badge>
          )}
        </div>
      )}
    </button>
  );
}
