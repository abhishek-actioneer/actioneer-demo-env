"use client";

import { AlertTriangle, X } from "lucide-react";

export function ApprovalModal({
  metricName,
  changedFields,
  affectedMetrics,
  onApprove,
  onCancel,
}: {
  metricName: string;
  changedFields: string[];
  affectedMetrics: { id: string; name: string }[];
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl border border-border shadow-xl w-[440px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4.5 h-4.5 text-muted-foreground" />
            <h2 className="text-sm font-bold">Critical Metric Change</h2>
          </div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <p className="text-sm">
            You are changing the <span className="font-semibold">{changedFields.join(" and ")}</span> of{" "}
            <span className="font-semibold">{metricName}</span>.
          </p>

          <div>
            <p className="text-xs font-semibold mb-2">The following metrics will be affected:</p>
            <div className="flex flex-wrap gap-1.5">
              {affectedMetrics.map((m) => (
                <span
                  key={m.id}
                  className="text-[9.9px] px-2.5 py-1 rounded-full border border-border text-foreground"
                >
                  {m.name}
                </span>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            These dependent metrics derive their values from {metricName}. Changing the definition will require
            recalculation of all dependent metrics.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onCancel}
            className="px-3.5 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onApprove}
            className="px-3.5 py-2 text-xs font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
          >
            Approve Change
          </button>
        </div>
      </div>
    </div>
  );
}
