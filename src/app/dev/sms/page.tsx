"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface SendSmsResult {
  sid: string;
  status: string;
  from: string;
  to: string;
}

function normalizePhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return trimmed;
}

export default function SmsDevPage() {
  const [to, setTo] = useState("");
  const [body, setBody] = useState("Test SMS from Actioneer.");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendSmsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setSending(true);
    setResult(null);
    setError(null);
    try {
      const normalizedTo = normalizePhoneNumber(to);
      const response = await apiFetch<SendSmsResult>("/api/dev/send-sms", {
        method: "POST",
        body: {
          to: normalizedTo,
          body,
        },
        skipModel: true,
      });
      setResult(response);
      setTo(normalizedTo);
    } catch (err) {
      setError((err as Error).message || "SMS send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">SMS Test</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Send one Twilio SMS from the configured sender number.
          </p>
        </div>

        <section className="space-y-4 rounded-lg bg-background p-5 shadow-[0_0_0_1px_var(--color-border)]">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="sms-to">
              Recipient
            </label>
            <Input
              id="sms-to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="+15551234567"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="sms-body">
              Message
            </label>
            <Textarea
              id="sms-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={5}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">{body.trim().length}/1000 characters</p>
          </div>

          {error && (
            <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-sm">
              <p className="font-medium">SMS request accepted</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">SID: {result.sid}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {result.from} to {result.to} · {result.status}
              </p>
            </div>
          )}

          <Button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !to.trim() || !body.trim()}
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send SMS
          </Button>
        </section>
      </div>
    </div>
  );
}
