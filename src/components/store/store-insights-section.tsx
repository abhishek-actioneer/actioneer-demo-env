"use client";

import { Sparkles } from "lucide-react";
import { StoreInsightCard } from "./store-insight-card";
import type { StoreInsight } from "@/lib/store-types";

interface StoreInsightsSectionProps {
  insights: StoreInsight[];
  onAction: (insight: StoreInsight) => void;
}

export function StoreInsightsSection({ insights, onAction }: StoreInsightsSectionProps) {
  if (insights.length === 0) return null;

  const warnings = insights.filter((i) => i.severity === "warning");
  const opportunities = insights.filter((i) => i.severity === "opportunity");
  const info = insights.filter((i) => i.severity === "info");

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Actioneer Insights</h2>
        <span className="text-[9px] text-muted-foreground px-1.5 py-0.5 border border-border rounded-md">
          {insights.length}
        </span>
      </div>

      {/* Warnings first */}
      {warnings.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          {warnings.map((insight) => (
            <StoreInsightCard key={insight.id} insight={insight} onAction={onAction} />
          ))}
        </div>
      )}

      {/* Opportunities */}
      {opportunities.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          {opportunities.map((insight) => (
            <StoreInsightCard key={insight.id} insight={insight} onAction={onAction} />
          ))}
        </div>
      )}

      {/* Info */}
      {info.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {info.map((insight) => (
            <StoreInsightCard key={insight.id} insight={insight} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}
