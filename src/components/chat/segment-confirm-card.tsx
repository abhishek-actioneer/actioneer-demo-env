"use client";

import { useState } from "react";
import { Check, ChevronRight, Loader2, AlertTriangle, ExternalLink, Pencil, PhoneCall } from "lucide-react";

interface SegmentConfirmData {
  suggestedName: string;
  sql: string;
  description: string;
  userCount: number | null;
  status: "ready" | "confirming" | "confirmed" | "cancelled" | "error";
  error?: string;
  segmentId?: string;
  voiceCampaignStatus?: "idle" | "creating" | "created" | "error";
  voiceCampaignId?: string;
  voiceCampaignUrl?: string;
  voiceCampaignError?: string;
}

interface SegmentConfirmCardProps {
  data: SegmentConfirmData;
  msgId: string;
  onConfirm: (msgId: string, name: string) => void;
  onCancel: (msgId: string) => void;
  onRefine: (msgId: string, newDescription: string) => void;
  onCreateVoiceCampaign?: (msgId: string) => void;
  compact?: boolean;
}

export function SegmentConfirmCard({
  data,
  msgId,
  onConfirm,
  onCancel,
  onRefine,
  onCreateVoiceCampaign,
  compact,
}: SegmentConfirmCardProps) {
  const [name, setName] = useState(data.suggestedName);
  const [showSql, setShowSql] = useState(false);
  const [refineMode, setRefineMode] = useState(false);
  const [refineText, setRefineText] = useState("");

  const textSize = compact ? "text-xs" : "text-sm";
  const smallText = compact ? "text-[9px]" : "text-xs";

  // Cancelled state — collapsed
  if (data.status === "cancelled") {
    return (
      <div className={`${smallText} text-muted-foreground/50 italic py-1`}>
        Segment creation cancelled
      </div>
    );
  }

  // Confirmed state — success
  if (data.status === "confirmed") {
    const isCreatingVoiceCampaign = data.voiceCampaignStatus === "creating";
    const voiceCampaignCreated = data.voiceCampaignStatus === "created" && data.voiceCampaignUrl;
    return (
      <div className="rounded-lg border border-border bg-background p-3 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-full bg-foreground/10 flex items-center justify-center">
            <Check className="w-3 h-3 text-foreground" />
          </div>
          <span className={`${textSize} font-medium text-foreground truncate`}>
            Segment created: {name}
          </span>
          {voiceCampaignCreated ? (
            <a
              href={data.voiceCampaignUrl}
              className={`${smallText} text-muted-foreground hover:text-foreground flex items-center gap-0.5 ml-auto shrink-0`}
            >
              Configure voice <ExternalLink className="w-3 h-3" />
            </a>
          ) : data.segmentId ? (
            <a
              href={`/segments/${data.segmentId}`}
              className={`${smallText} text-muted-foreground hover:text-foreground flex items-center gap-0.5 ml-auto shrink-0`}
            >
              View <ExternalLink className="w-3 h-3" />
            </a>
          ) : null}
        </div>
        {data.voiceCampaignStatus === "error" && (
          <div className={`${smallText} text-muted-foreground`}>
            {data.voiceCampaignError || "Could not prepare voice campaign setup."}
          </div>
        )}
        {onCreateVoiceCampaign && data.segmentId && !voiceCampaignCreated && (
          <button
            onClick={() => onCreateVoiceCampaign(msgId)}
            disabled={isCreatingVoiceCampaign}
            className={`${smallText} px-2.5 py-1.5 rounded border border-border hover:bg-muted text-foreground disabled:opacity-50 transition-colors flex items-center gap-1.5`}
          >
            {isCreatingVoiceCampaign ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Creating voice draft...
              </>
            ) : (
              <>
                <PhoneCall className="w-3 h-3" />
                Configure Voice Campaign
              </>
            )}
          </button>
        )}
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
            {data.error || "Failed to create segment"}
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
        <span className={`${textSize} font-medium text-foreground`}>Create Segment</span>
      </div>

      <div className="p-3 space-y-3">
        {data.description && (
          <p className={`${smallText} text-muted-foreground leading-relaxed`}>
            {data.description}
          </p>
        )}

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

        {/* SQL toggle */}
        {!compact && (
          <div>
            <button
              onClick={() => setShowSql(!showSql)}
              className={`flex items-center gap-1 ${smallText} text-muted-foreground hover:text-foreground transition-colors`}
            >
              <ChevronRight className={`w-3 h-3 transition-transform ${showSql ? "rotate-90" : ""}`} />
              SQL Query
            </button>
            {showSql && (
              <pre className={`mt-1.5 ${smallText} bg-muted/30 border border-border rounded p-2 overflow-x-auto text-muted-foreground font-mono whitespace-pre-wrap`}>
                {data.sql}
              </pre>
            )}
          </div>
        )}

        {/* User count */}
        <div className={`${textSize}`}>
          {data.userCount === null ? (
            <span className="text-muted-foreground">Count unavailable</span>
          ) : data.userCount === 0 ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>No users match this criteria</span>
            </div>
          ) : data.userCount < 10 ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Only {data.userCount.toLocaleString()} user{data.userCount !== 1 ? "s" : ""} match. Is this intended?</span>
            </div>
          ) : (
            <span className="text-foreground font-medium">{data.userCount.toLocaleString()} users</span>
          )}
        </div>

        {/* Refine input */}
        {refineMode && (
          <div className="space-y-1.5">
            <input
              type="text"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              placeholder="Describe the segment differently..."
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
