"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { CampaignDiagnostic } from "@/lib/voice-diagnostics";

const COLLAPSED_COUNT = 6;

const SEVERITY_LABEL: Record<CampaignDiagnostic["severity"], string> = {
  error: "ERROR",
  warn: "WARN",
  info: "INFO",
};

/**
 * Open-items checklist for a campaign draft — fact-ledger holes, verbatim
 * mismatches, workflow lint. The diagnostics panel is the elicitation surface:
 * each row is something the operator resolves before the campaign dials.
 */
export function CampaignOpenItems({
  items,
  onDismiss,
}: {
  items: CampaignDiagnostic[];
  onDismiss?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;

  const collapsible = items.length > COLLAPSED_COUNT;
  const visible = collapsible && !expanded ? items.slice(0, COLLAPSED_COUNT) : items;
  const errorCount = items.filter((item) => item.severity === "error").length;

  return (
    <div className="mx-auto mb-6 w-full max-w-5xl border border-border bg-muted/30 px-4 py-3">
      <p className="text-sm font-medium text-foreground">
        {items.length} open {items.length === 1 ? "item" : "items"}
        {errorCount > 0 ? ` · ${errorCount} need${errorCount === 1 ? "s" : ""} a fix before calling` : ""}
      </p>

      <ul className="mt-2 space-y-1.5">
        {visible.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-xs leading-relaxed">
            <span
              className={[
                "w-11 shrink-0 pt-px text-[9px] font-semibold uppercase tracking-[0.07em]",
                item.severity === "error" ? "text-foreground" : "text-muted-foreground",
              ].join(" ")}
            >
              {SEVERITY_LABEL[item.severity]}
            </span>
            <span className="min-w-0 flex-1 text-muted-foreground">
              {item.message}
              {item.nodeId ? (
                <span className="ml-1.5 font-mono text-muted-foreground/70">({item.nodeId})</span>
              ) : null}
            </span>
            {onDismiss ? (
              <button
                type="button"
                onClick={() => onDismiss(item.id)}
                aria-label="Dismiss open item"
                className="shrink-0 p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? "Show fewer" : `…and ${items.length - COLLAPSED_COUNT} more`}
        </button>
      ) : null}
    </div>
  );
}
