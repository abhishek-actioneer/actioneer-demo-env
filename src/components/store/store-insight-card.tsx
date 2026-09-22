"use client";

import { ArrowRight, AlertTriangle, Lightbulb, Info } from "lucide-react";
import type { StoreInsight } from "@/lib/store-types";

const SEVERITY_ICON = {
  info: Info,
  warning: AlertTriangle,
  opportunity: Lightbulb,
};

interface StoreInsightCardProps {
  insight: StoreInsight;
  onAction: (insight: StoreInsight) => void;
}

export function StoreInsightCard({ insight, onAction }: StoreInsightCardProps) {
  const Icon = SEVERITY_ICON[insight.severity] ?? Info;

  return (
    <div className="border border-border rounded-lg p-4 flex gap-3 group hover:bg-muted/10 transition-colors">
      <div className="shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{insight.title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">{insight.body}</p>
        <button
          onClick={() => onAction(insight)}
          className="mt-2.5 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          {insight.actionLabel}
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
