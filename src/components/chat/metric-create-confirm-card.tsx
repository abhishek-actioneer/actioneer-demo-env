"use client";

import { Check, X, MessageSquarePlus } from "lucide-react";

interface MetricCreateConfirmData {
  metricId: string;
  metricName: string;
  description: string;
  status: "ready" | "approved" | "dismissed";
}

interface MetricCreateConfirmCardProps {
  data: MetricCreateConfirmData;
  msgId: string;
  onApprove: (msgId: string) => void;
  onDismiss: (msgId: string) => void;
  onSuggestEdits: (metricName: string) => void;
}

export function MetricCreateConfirmCard({
  data,
  msgId,
  onApprove,
  onDismiss,
  onSuggestEdits,
}: MetricCreateConfirmCardProps) {
  if (data.status === "approved") {
    return (
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
            <Check className="w-3 h-3 text-foreground" />
          </div>
          <span className="text-sm font-medium">Metric created successfully</span>
        </div>
      </div>
    );
  }

  if (data.status === "dismissed") {
    return (
      <div className="text-xs text-muted-foreground/50 italic py-1">
        Metric creation dismissed
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">Metric Ready for Review</span>
          <span className="text-xs text-muted-foreground">{data.metricName}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Actioneer has built the SQL and formula. Review below.
        </p>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <p className="text-[9.9px] text-muted-foreground font-medium uppercase tracking-wider mb-1">Name</p>
          <p className="text-sm font-semibold">{data.metricName}</p>
        </div>
        {data.description && (
          <div>
            <p className="text-[9.9px] text-muted-foreground font-medium uppercase tracking-wider mb-1">Description</p>
            <p className="text-xs text-muted-foreground">{data.description}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-border flex items-center gap-2">
        <button
          onClick={() => onApprove(msgId)}
          className="text-sm px-3.5 py-1.5 rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors flex items-center gap-1.5 font-medium"
        >
          <Check className="w-3.5 h-3.5" />
          Approve
        </button>
        <button
          onClick={() => onSuggestEdits(data.metricName)}
          className="text-sm px-3.5 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
          Suggest Edits
        </button>
        <button
          onClick={() => onDismiss(msgId)}
          className="text-sm px-3.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 ml-auto"
        >
          <X className="w-3.5 h-3.5" />
          Dismiss
        </button>
      </div>
    </div>
  );
}
