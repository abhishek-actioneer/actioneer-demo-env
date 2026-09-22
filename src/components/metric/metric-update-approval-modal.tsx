"use client";

import { X } from "lucide-react";

export function MetricUpdateApprovalModal({
  metricName,
  affectedMetrics,
  onApproveAll,
  onApproveCurrent,
  onCancel,
  isNewMetric = false,
}: {
  metricName: string;
  affectedMetrics: { id: string; name: string }[];
  onApproveAll: () => void;
  onApproveCurrent?: () => void;
  onCancel: () => void;
  isNewMetric?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl border border-border shadow-xl w-[460px] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-bold">Confirm Metric Update</h2>
          <button onClick={onCancel} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm">
            Approve the definition update for <span className="font-semibold">{metricName}</span>?
          </p>
          {!isNewMetric && affectedMetrics.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2">The following metrics will also be updated:</p>
              <div className="flex flex-wrap gap-1.5">
                {affectedMetrics.map((m) => (
                  <span key={m.id} className="text-[9.9px] px-2.5 py-1 rounded-full border border-border text-foreground">
                    {m.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          {isNewMetric ? (
            <>
              <button onClick={onCancel} className="px-3.5 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={onApproveAll} className="px-3.5 py-2 text-xs font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors">
                Approve
              </button>
            </>
          ) : (
            <>
              <button onClick={onCancel} className="px-3.5 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors">
                Dismiss
              </button>
              {onApproveCurrent && (
                <button onClick={onApproveCurrent} className="px-3.5 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors">
                  Approve only {metricName}
                </button>
              )}
              <button onClick={onApproveAll} className="px-3.5 py-2 text-xs font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors">
                Approve All
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
