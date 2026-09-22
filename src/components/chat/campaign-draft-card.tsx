"use client";

import { useState } from "react";
import { Check, Loader2, AlertTriangle, ExternalLink, Pencil, Send, X, Mail, Bell, MessageSquare, Globe, MessageCircle } from "lucide-react";
import { EmailEditor } from "./email-editor";

type Channel = "email" | "push" | "sms" | "webpush" | "whatsapp";

interface CampaignDraftData {
  segmentId: string;
  segmentName: string;
  userCount: number | null;
  channel: Channel;
  subject: string;
  body: string;
  senderName?: string;
  senderEmailId?: string;
  replyTo?: string;
  rationale?: string;
  status: "ready" | "firing" | "sent" | "cancelled" | "error";
  error?: string;
  campaignId?: number;
  dashboardUrl?: string;
}

interface Props {
  data: CampaignDraftData;
  msgId: string;
  onFire: (msgId: string, edited: { subject: string; body: string; senderName?: string; templateId?: string }) => void;
  onCancel: (msgId: string) => void;
  onRefine: (msgId: string, refineIntent: string) => void;
  compact?: boolean;
}

const CHANNEL_META: Record<Channel, { icon: typeof Mail; label: string }> = {
  email: { icon: Mail, label: "Email" },
  push: { icon: Bell, label: "Push" },
  sms: { icon: MessageSquare, label: "SMS" },
  webpush: { icon: Globe, label: "Web Push" },
  whatsapp: { icon: MessageCircle, label: "WhatsApp" },
};

export function CampaignDraftCard({ data, msgId, onFire, onCancel, onRefine, compact }: Props) {
  const [subject, setSubject] = useState(data.subject);
  const [body, setBody] = useState(data.body);
  const [senderName, setSenderName] = useState(data.senderName ?? "Actioneer");
  const [refineMode, setRefineMode] = useState(false);
  const [refineText, setRefineText] = useState("");
  const [sendable, setSendable] = useState<{ html: string; templateId: string | null }>({
    html: data.body,
    templateId: null,
  });
  const TEMPLATE_LABELS: Record<string, string> = {
    marketing: "Marketing",
    announcement: "Announcement",
    newsletter: "Newsletter",
  };

  const textSize = compact ? "text-xs" : "text-sm";
  const smallText = compact ? "text-[9px]" : "text-xs";
  const ChannelIcon = CHANNEL_META[data.channel].icon;

  // Cancelled — collapsed
  if (data.status === "cancelled") {
    return (
      <div className={`${smallText} text-muted-foreground/50 italic py-1`}>
        Campaign dismissed
      </div>
    );
  }

  // Sent — success
  if (data.status === "sent") {
    return (
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-foreground/10 flex items-center justify-center">
            <Check className="w-3 h-3 text-foreground" />
          </div>
          <span className={`${textSize} font-medium text-foreground`}>
            Campaign fired to {data.segmentName}
            {data.userCount !== null && data.userCount > 0 ? ` · ${data.userCount.toLocaleString()} users` : ""}
          </span>
          {data.dashboardUrl && (
            <a
              href={data.dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${smallText} text-muted-foreground hover:text-foreground flex items-center gap-0.5 ml-auto`}
            >
              View in CleverTap <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    );
  }

  // Error
  if (data.status === "error") {
    return (
      <div className="rounded-lg border border-border bg-background p-3 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          <span className={`${textSize} text-foreground`}>
            {data.error || "Failed to send campaign"}
          </span>
        </div>
        <button
          onClick={() => onFire(msgId, { subject, body: sendable.html || body, senderName, templateId: sendable.templateId ?? undefined })}
          className={`${smallText} text-muted-foreground hover:text-foreground underline`}
        >
          Retry
        </button>
      </div>
    );
  }

  const isFiring = data.status === "firing";
  const isEmail = data.channel === "email";

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <ChannelIcon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className={`${textSize} font-medium text-foreground`}>
          {CHANNEL_META[data.channel].label} draft · {data.segmentName}
        </span>
        {data.userCount !== null && (
          <span className={`${smallText} text-muted-foreground ml-auto`}>
            {data.userCount.toLocaleString()} users
          </span>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* Rationale */}
        {data.rationale && !refineMode && (
          <div className={`${smallText} text-muted-foreground italic`}>
            {data.rationale}
          </div>
        )}

        {/* Refine input */}
        {refineMode && (
          <div className="space-y-1.5">
            <input
              type="text"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              placeholder="e.g. make it shorter, warmer tone, offer 30% instead..."
              autoFocus
              disabled={isFiring}
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
                disabled={!refineText.trim() || isFiring}
                className={`${smallText} px-2 py-1 rounded border border-border hover:bg-muted text-foreground disabled:opacity-40 transition-colors`}
              >
                Redraft
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

        {/* Subject / Title */}
        {!refineMode && (isEmail || data.channel === "push" || data.channel === "webpush") && (
          <div className="space-y-1">
            <label className={`${smallText} text-muted-foreground font-medium`}>
              {isEmail ? "Subject" : "Title"}
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isFiring}
              className={`w-full ${textSize} bg-muted/30 border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20 disabled:opacity-50`}
            />
          </div>
        )}

        {/* Body */}
        {!refineMode && (
          <div className="space-y-1">
            <label className={`${smallText} text-muted-foreground font-medium`}>
              {isEmail ? "Body" : "Message"}
            </label>
            {isEmail ? (
              <EmailEditor
                value={body}
                onChange={setBody}
                disabled={isFiring}
                compact={compact}
                imageContext={{ subject, body, segmentName: data.segmentName }}
                onSendableChange={setSendable}
              />
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={isFiring}
                rows={4}
                className={`w-full ${textSize} bg-muted/30 border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20 disabled:opacity-50`}
              />
            )}
          </div>
        )}

        {/* Sender details — collapsed advanced */}
        {!refineMode && isEmail && (
          <details className="group">
            <summary className={`${smallText} text-muted-foreground hover:text-foreground cursor-pointer list-none flex items-center gap-1`}>
              <span className="group-open:rotate-90 transition-transform inline-block">▸</span>
              Sender details
            </summary>
            <div className="mt-2 space-y-2 pl-3">
              <div className="space-y-1">
                <label className={`${smallText} text-muted-foreground`}>Sender name</label>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  disabled={isFiring}
                  className={`w-full ${textSize} bg-muted/30 border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 disabled:opacity-50`}
                />
              </div>
              {data.senderEmailId && (
                <div className={`${smallText} text-muted-foreground`}>
                  From: <span className="font-mono text-foreground">{data.senderEmailId}</span>
                </div>
              )}
              {data.replyTo && (
                <div className={`${smallText} text-muted-foreground`}>
                  Reply-to: <span className="font-mono text-foreground">{data.replyTo}</span>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Audience notice */}
        {!refineMode && data.userCount !== null && data.userCount > 0 && (
          <div className={`${smallText} text-muted-foreground`}>
            Will fire to {data.userCount.toLocaleString()} users in {data.segmentName}.
          </div>
        )}

        {/* Action buttons */}
        {!refineMode && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onFire(msgId, { subject, body: sendable.html || body, senderName, templateId: sendable.templateId ?? undefined })}
              disabled={isFiring || !(sendable.html || body).trim() || (isEmail && !subject.trim())}
              className={`${textSize} px-3 py-1.5 rounded bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors flex items-center gap-1.5 font-medium`}
            >
              {isFiring ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-3 h-3" />
                  {sendable.templateId
                    ? `Send as ${TEMPLATE_LABELS[sendable.templateId] ?? sendable.templateId}`
                    : "Send Campaign"}
                </>
              )}
            </button>
            <button
              onClick={() => setRefineMode(true)}
              disabled={isFiring}
              className={`${textSize} px-3 py-1.5 rounded border border-border hover:bg-muted text-foreground disabled:opacity-50 transition-colors flex items-center gap-1.5`}
            >
              <Pencil className="w-3 h-3" />
              Redraft
            </button>
            <button
              onClick={() => onCancel(msgId)}
              disabled={isFiring}
              className={`${textSize} px-3 py-1.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors flex items-center gap-1.5`}
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
