"use client";

import { useCallback, useState } from "react";
import { Loader2, Check, X, ExternalLink, Send } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CampaignResult {
  campaignId?: number;
  dashboardUrl?: string;
  estimates?: Record<string, number>;
  attributeKey?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segmentId: string;
  segmentName: string;
  onNotConnected?: () => void;
}

type Channel = "email" | "push" | "sms" | "webpush" | "whatsapp";

const CHANNEL_NOTES: Record<Channel, string> = {
  email: "Works end-to-end on Trial. Creates a visible campaign in CleverTap's Campaigns list.",
  push: "Requires users to have device tokens (CleverTap SDK integration in a native app).",
  sms: "Requires an SMS provider configured in CleverTap.",
  webpush: "Requires users to have subscribed to web push on a site with CleverTap's SDK.",
  whatsapp: "Requires WhatsApp BSP + approved template in CleverTap.",
};

export function CampaignDialog({ open, onOpenChange, segmentId, segmentName, onNotConnected }: Props) {
  const [channel, setChannel] = useState<Channel>("email");
  const [subject, setSubject] = useState("We miss you");
  const [messageBody, setMessageBody] = useState(`<p>Hi there, we noticed you haven't been around lately. Here's 20% off your next booking.</p>`);
  const [senderName, setSenderName] = useState("Actioneer");
  const [senderEmailId, setSenderEmailId] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CampaignResult | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setResult(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    setSubmitting(true);
    try {
      const res = await apiFetch<CampaignResult>(`/api/segments/${segmentId}/campaign`, {
        method: "POST",
        body: {
          channel,
          subject,
          body: messageBody,
          senderName,
          senderEmailId: channel === "email" ? senderEmailId : undefined,
          replyTo: channel === "email" ? replyTo : undefined,
          title: subject,
        },
        skipModel: true,
      });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError && err.code === "not_connected") {
        onOpenChange(false);
        onNotConnected?.();
      } else {
        setError((err as Error).message || "Campaign creation failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) reset();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send Campaign to {segmentName}</DialogTitle>
          <DialogDescription>
            Fires a CleverTap campaign targeting only users in this segment (via the <code className="px-1 rounded bg-muted font-mono text-[9.9px]">ct_segment_*</code> profile attribute).
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 text-sm">
            <div className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border">
              <Check className="h-3 w-3" /> Campaign #{result.campaignId} created in CleverTap
            </div>
            {result.estimates && (
              <div className="text-xs text-muted-foreground">
                Audience estimate:{" "}
                {Object.entries(result.estimates).map(([k, v]) => (
                  <span key={k} className="font-mono mr-2">
                    {k}: {v}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              {result.dashboardUrl && (
                <a
                  href={result.dashboardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border bg-foreground text-background hover:opacity-90"
                >
                  <ExternalLink className="h-3 w-3" />
                  View in CleverTap
                </a>
              )}
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-muted"
              >
                Send Another
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 text-sm">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Channel</label>
              <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email (recommended, works on Trial)</SelectItem>
                  <SelectItem value="push">Push</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="webpush">Web Push</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[9.9px] text-muted-foreground">{CHANNEL_NOTES[channel]}</p>
            </div>

            {channel === "email" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Subject</label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
              </div>
            )}

            {(channel === "push" || channel === "webpush") && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Title</label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {channel === "email" ? "Body (HTML)" : "Message body"}
              </label>
              <Textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                rows={5}
                className="font-mono text-[10.8px]"
                required
              />
            </div>

            {(channel === "email" || channel === "sms") && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Sender name</label>
                <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} />
              </div>
            )}

            {channel === "email" && (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Sender email <span className="text-muted-foreground/70">(must be a verified sender in CleverTap)</span>
                  </label>
                  <Input
                    type="email"
                    value={senderEmailId}
                    onChange={(e) => setSenderEmailId(e.target.value)}
                    placeholder="hello@yourdomain.com"
                  />
                  <p className="text-[9.9px] text-muted-foreground">
                    Set up at CleverTap → Settings → Channels → Email → Sender Addresses. Without this, CleverTap will create the campaign but auto-pause it.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Reply-to (optional)</label>
                  <Input
                    type="email"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                    placeholder="support@yourdomain.com"
                  />
                </div>
              </>
            )}

            {error && (
              <div className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-border text-foreground">
                <X className="h-3 w-3" /> {error}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border bg-foreground text-background hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Fire Campaign
              </button>
              <button
                type="button"
                onClick={() => handleClose(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
