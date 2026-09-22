"use client";

import { Telescope } from "lucide-react";

interface AutoDeepNoticeCardProps {
  reason: string;
  status: "active" | "committed" | "reverted";
}

/**
 * Inline notice shown when the classifier auto-upgrades a query to deep research.
 * Tells the user explicitly that the upgrade happened and gives a one-line reason.
 *
 * Monochrome (no color tags), borders + muted foreground only.
 */
export function AutoDeepNoticeCard({ reason, status }: AutoDeepNoticeCardProps) {
  if (status === "reverted") return null;

  return (
    <div className="pl-10">
      <div className="inline-flex items-start gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground max-w-[640px]">
        <Telescope className="size-3.5 mt-[1px] shrink-0" />
        <div className="leading-relaxed">
          <span className="text-foreground font-medium">Switched to Deep Research</span>
          <span className="text-muted-foreground">: {reason}.</span>
          <span className="block mt-0.5 text-[9.9px] text-muted-foreground/80">
            6 specialized agents are analyzing your question. This takes longer than a quick answer.
          </span>
        </div>
      </div>
    </div>
  );
}
