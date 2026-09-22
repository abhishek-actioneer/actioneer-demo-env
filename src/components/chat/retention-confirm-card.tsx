"use client";

import { useState, useMemo } from "react";
import { Check, ChevronRight, Loader2, AlertTriangle, ExternalLink, Pencil } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { RETENTION_MODE_LABELS } from "@/lib/retention-types";
import { useDataset } from "@/lib/dataset-context";

interface RetentionConfirmCardProps {
  data: NonNullable<ChatMessage["retentionConfirm"]>;
  msgId: string;
  onConfirm: (msgId: string, name: string) => void;
  onCancel: (msgId: string) => void;
  onRefine: (msgId: string, description: string) => void;
  compact?: boolean;
}

export function RetentionConfirmCard({
  data,
  msgId,
  onConfirm,
  onCancel,
  onRefine,
  compact,
}: RetentionConfirmCardProps) {
  const [name, setName] = useState(data.suggestedName);
  const [refineMode, setRefineMode] = useState(false);
  const [refineText, setRefineText] = useState("");
  const [showEvents, setShowEvents] = useState(true);
  const { dataset } = useDataset();

  const textSize = compact ? "text-xs" : "text-sm";
  const smallText = compact ? "text-[9px]" : "text-xs";

  // Build event labels from dataset events
  const startEventLabel = useMemo(() => {
    const events = dataset.events ?? [];
    const ev = events.find((e) => e.id === data.config.startEventId);
    return ev?.displayName || data.config.startEventId;
  }, [data.config.startEventId, dataset.events]);

  const returnEventLabels = useMemo(() => {
    const events = dataset.events ?? [];
    return data.config.returnEventIds.map((id) => {
      const ev = events.find((e) => e.id === id);
      return ev?.displayName || id;
    });
  }, [data.config.returnEventIds, dataset.events]);

  const modeLabel = RETENTION_MODE_LABELS[data.config.mode] || data.config.mode;

  // Cancelled state — collapsed
  if (data.status === "cancelled") {
    return (
      <div className={`${smallText} text-muted-foreground/50 italic py-1`}>
        Retention analysis cancelled
      </div>
    );
  }

  // Confirmed state — success
  if (data.status === "confirmed") {
    return (
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-foreground/10 flex items-center justify-center">
            <Check className="w-3 h-3 text-foreground" />
          </div>
          <span className={`${textSize} font-medium text-foreground`}>
            Retention created: {name}
          </span>
          {data.retentionId && (
            <a
              href={`/retentions/${data.retentionId}`}
              className={`${smallText} text-muted-foreground hover:text-foreground flex items-center gap-0.5 ml-auto`}
            >
              View <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    );
  }

  // Error state
  if (data.status === "error") {
    return (
      <div className="rounded-lg border border-border bg-background p-3 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          <span className={`${textSize} text-foreground`}>
            {data.error || "Failed to create retention analysis"}
          </span>
        </div>
        <button
          onClick={() => onConfirm(msgId, name)}
          className={`${smallText} text-muted-foreground hover:text-foreground underline`}
        >
          Retry
        </button>
      </div>
    );
  }

  // Ready / Confirming state — full card
  const isConfirming = data.status === "confirming";

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border">
        <span className={`${textSize} font-medium text-foreground`}>Create Retention Analysis</span>
      </div>

      <div className="p-3 space-y-3">
        {/* Name field */}
        <div className="space-y-1">
          <label className={`${smallText} text-muted-foreground font-medium`}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isConfirming}
            className={`w-full ${textSize} bg-muted/30 border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20 disabled:opacity-50`}
          />
        </div>

        {/* Events list */}
        <div>
          <button
            onClick={() => setShowEvents(!showEvents)}
            className={`flex items-center gap-1 ${smallText} text-muted-foreground hover:text-foreground transition-colors`}
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${showEvents ? "rotate-90" : ""}`} />
            Events
          </button>
          {showEvents && (
            <div className="mt-1.5 space-y-1.5">
              <div className={`flex items-center gap-2 ${smallText} text-foreground`}>
                <span className="w-4 h-4 rounded-full border border-border flex items-center justify-center text-[9px] text-muted-foreground shrink-0">
                  S
                </span>
                <span className="truncate">{startEventLabel}</span>
              </div>
              {returnEventLabels.map((label, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 ${smallText} text-foreground`}
                >
                  <span className="w-4 h-4 rounded-full border border-border flex items-center justify-center text-[9px] text-muted-foreground shrink-0">
                    R
                  </span>
                  <span className="truncate">{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* D7 Retention rate */}
        <div className={`${textSize}`}>
          {data.d7Retention === null ? (
            <span className="text-muted-foreground">D7 retention rate unavailable</span>
          ) : (
            <span className="text-foreground font-medium">
              {data.d7Retention}% D7 retention
            </span>
          )}
        </div>

        {/* Config summary */}
        <div className={`${smallText} text-muted-foreground`}>
          {modeLabel} &middot; {data.config.returnEventIds.length} return event{data.config.returnEventIds.length > 1 ? "s" : ""}
        </div>

        {/* Refine input */}
        {refineMode && (
          <div className="space-y-1.5">
            <input
              type="text"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              placeholder="Describe the retention differently..."
              autoFocus
              className={`w-full ${textSize} bg-muted/30 border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && refineText.trim()) {
                  onRefine(msgId, refineText.trim());
                  setRefineMode(false);
                  setRefineText("");
                } else if (e.key === "Escape") {
                  setRefineMode(false);
                  setRefineText("");
                }
              }}
            />
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  if (refineText.trim()) {
                    onRefine(msgId, refineText.trim());
                    setRefineMode(false);
                    setRefineText("");
                  }
                }}
                disabled={!refineText.trim()}
                className={`${smallText} px-2 py-1 rounded border border-border hover:bg-muted text-foreground disabled:opacity-40 transition-colors`}
              >
                Regenerate
              </button>
              <button
                onClick={() => { setRefineMode(false); setRefineText(""); }}
                className={`${smallText} px-2 py-1 text-muted-foreground hover:text-foreground transition-colors`}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!refineMode && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onConfirm(msgId, name)}
              disabled={isConfirming || !name.trim()}
              className={`${textSize} px-3 py-1.5 rounded bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors flex items-center gap-1.5 font-medium`}
            >
              {isConfirming ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-3 h-3" />
                  Confirm
                </>
              )}
            </button>
            <button
              onClick={() => setRefineMode(true)}
              disabled={isConfirming}
              className={`${textSize} px-3 py-1.5 rounded border border-border hover:bg-muted text-foreground disabled:opacity-50 transition-colors flex items-center gap-1.5`}
            >
              <Pencil className="w-3 h-3" />
              Refine
            </button>
            <button
              onClick={() => onCancel(msgId)}
              disabled={isConfirming}
              className={`${textSize} px-3 py-1.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors`}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
