"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  FlaskConical,
  Link,
  Loader2,
  Phone,
  Target,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  VoiceCampaignSuccessDefinition,
  VoiceCampaignSuccessMetricType,
} from "@/lib/voice-campaign-types";
import { apiFetch } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CRITERION_STARTERS = [
  "Customer explicitly agreed to complete KYC or said they would do it.",
  "Customer expressed clear interest and asked for next steps.",
  "Customer agreed to a callback from an advisor.",
  "Customer requested to stop being called or asked to be removed from the list.",
];

const WINDOW_OPTIONS = [
  { days: 1,  label: "24 hours" },
  { days: 3,  label: "3 days"   },
  { days: 7,  label: "7 days"   },
  { days: 30, label: "30 days"  },
];

type SignalSource = "call" | "link" | "system";
type ActiveDrawer = SignalSource | null;

function toSignalSource(type: VoiceCampaignSuccessMetricType): SignalSource {
  if (type === "link")         return "link";
  if (type === "dataset_event" || type === "sql") return "system";
  return "call";
}

// ---------------------------------------------------------------------------
// Test criterion panel (used inside the "On the call" drawer)
// ---------------------------------------------------------------------------

interface TestResult {
  callId: string;
  summary: string;
  criterionMet: boolean;
  reason: string;
}

function TestCriterionPanel({
  criterion,
  campaignId,
  datasetId,
}: {
  criterion: string;
  campaignId?: string;
  datasetId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [callCount, setCallCount] = useState(5);

  if (!campaignId) return null;

  async function runTest() {
    setLoading(true);
    setResults(null);
    setMessage(null);
    try {
      const data = await apiFetch<{ results: TestResult[]; message?: string }>(
        "/api/voice-campaigns/test-criterion",
        { method: "POST", body: { criterion, campaignId, callCount }, ...(datasetId ? { datasetId } : {}) },
      );
      setResults(data.results);
      setMessage(data.message ?? null);
    } catch {
      setMessage("Test failed — check the API logs.");
    } finally {
      setLoading(false);
    }
  }

  const metCount   = results?.filter((r) => r.criterionMet).length ?? 0;
  const totalCount = results?.length ?? 0;

  return (
    <div className="mt-4 rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <FlaskConical className="size-3.5 shrink-0" />
        <span className="flex-1 text-left font-medium">Test against past calls</span>
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Run this criterion against the last N calls to verify it before launch.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Last</span>
              <div className="flex rounded-md border border-border overflow-hidden">
                {[5, 10, 20].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCallCount(n)}
                    className={cn(
                      "px-3 py-1.5 text-xs transition-colors",
                      callCount === n ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">calls</span>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => void runTest()} disabled={loading || !criterion.trim()}>
              {loading && <Loader2 className="size-3.5 animate-spin" />}
              Run test
            </Button>
            {results && (
              <span className="ml-auto text-xs text-muted-foreground">{metCount} / {totalCount} met</span>
            )}
          </div>
          {message && !results && <p className="text-xs text-muted-foreground">{message}</p>}
          {results && results.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
              {results.map((r) => (
                <div key={r.callId} className="flex items-start gap-3 px-4 py-3">
                  <span className={cn("mt-0.5 shrink-0 size-2 rounded-full", r.criterionMet ? "bg-foreground" : "bg-muted-foreground/30")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground line-clamp-1">{r.summary}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{r.reason}</p>
                  </div>
                  <span className="shrink-0 text-[9.9px] text-muted-foreground font-mono">{r.callId.slice(0, 8)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer panels (content shown in the slide-in drawer)
// ---------------------------------------------------------------------------

function OnTheCallDrawer({
  criterion,
  onCriterionChange,
  campaignId,
  datasetId,
}: {
  criterion: string;
  onCriterionChange: (v: string) => void;
  campaignId?: string;
  datasetId?: string;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium mb-1">What should the LLM look for?</p>
        <p className="text-xs text-muted-foreground mb-2">
          Be specific. Evaluated against every call transcript after the call ends.
        </p>
        <textarea
          value={criterion}
          onChange={(e) => onCriterionChange(e.target.value)}
          rows={4}
          placeholder="e.g. Customer explicitly agreed to complete KYC or said they would do it within the next 24 hours."
          className="w-full resize-none rounded-md border border-border bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/30 focus:ring-1 focus:ring-border"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CRITERION_STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => onCriterionChange(starter)}
              className="rounded-full border border-border px-2.5 py-1 text-[9.9px] text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors"
            >
              {starter.slice(0, 44)}{starter.length > 44 ? "…" : ""}
            </button>
          ))}
        </div>
      </div>
      <TestCriterionPanel criterion={criterion} campaignId={campaignId} datasetId={datasetId} />
    </div>
  );
}

interface WhatsAppTemplateStatus {
  connected: boolean;
  templateId?: string;
}

function WhatsAppTemplateStatusBanner() {
  const [status, setStatus] = useState<WhatsAppTemplateStatus | "loading" | "error">("loading");

  useState(() => {
    void (async () => {
      try {
        const data = await apiFetch<{ connections: Array<{ type: string; status: string; meta?: Record<string, string> }> }>(
          "/api/connections",
          { skipModel: true },
        );
        const wa = data.connections.find((c) => c.type === "whatsapp");
        setStatus({ connected: wa?.status === "connected", templateId: wa?.meta?.templateId });
      } catch {
        setStatus("error");
      }
    })();
  });

  if (status === "loading") return null;

  if (status === "error" || !status.connected || !status.templateId) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
        <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
        <span>
          No approved WhatsApp template is configured yet. Mid-call and follow-up sends will fail until you
          add one in{" "}
          <a href="/settings/connections" className="underline underline-offset-2 hover:text-foreground">
            Settings → Connections
          </a>.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground flex items-start gap-2">
      <CheckCircle2 className="size-3.5 shrink-0 mt-0.5 text-foreground" />
      <span>
        Approved WhatsApp template configured (<code className="font-mono">{status.templateId}</code>). Every
        mid-call and follow-up send uses this template — reachable regardless of whether the customer has
        messaged you before.
      </span>
    </div>
  );
}

function ViaLinkDrawer({
  destinationUrl,
  followUpTemplate,
  windowDays,
  onDestChange,
  onTemplateChange,
  onWindowChange,
}: {
  destinationUrl: string;
  followUpTemplate: string;
  windowDays: number;
  onDestChange: (v: string) => void;
  onTemplateChange: (v: string | undefined) => void;
  onWindowChange: (days: number) => void;
}) {
  return (
    <div className="space-y-5">
      <WhatsAppTemplateStatusBanner />

      <div>
        <p className="text-sm font-medium mb-1">
          Destination URL <span className="text-destructive">*</span>
        </p>
        <input
          type="url"
          value={destinationUrl}
          onChange={(e) => onDestChange(e.target.value)}
          placeholder="https://app.yourcompany.com/kyc"
          className="w-full rounded-md border border-border bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-border"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Where the customer lands after clicking. UTM params are added automatically.
        </p>
      </div>

      <div>
        <p className="text-sm font-medium mb-1">Attribution window</p>
        <div className="flex rounded-lg border border-border overflow-hidden w-fit">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              onClick={() => onWindowChange(opt.days)}
              className={cn(
                "px-4 py-2 text-sm transition-colors border-r border-border last:border-r-0",
                windowDays === opt.days ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          How long after the call should a click count as attributed.
        </p>
      </div>

      <div>
        <p className="text-sm font-medium mb-1">
          Message text <span className="text-muted-foreground font-normal text-xs">(optional)</span>
        </p>
        <textarea
          value={followUpTemplate}
          onChange={(e) => onTemplateChange(e.target.value || undefined)}
          rows={3}
          placeholder={"Your KYC is pending. Complete it here: {link}"}
          className="w-full resize-none rounded-md border border-border bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/30 focus:ring-1 focus:ring-border"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Use <code className="rounded bg-muted px-1 py-0.5 font-mono">{"{link}"}</code> where
          the trackable URL should appear. This isn&apos;t sent as free-form text — it fills the
          message placeholder inside your approved WhatsApp template. Leave blank to fall back to
          the AI-generated follow-up text.
        </p>
      </div>

      <div className="rounded-md bg-muted/30 border border-border px-3 py-2.5 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">How it works</p>
        <p>
          A unique trackable URL is generated per recipient when the message is sent. WhatsApp
          sends always use your Meta-approved template — a phone call never opens WhatsApp&apos;s
          24-hour session window, so every recipient can be reached, not just ones who messaged
          you first. WhatsApp preview bots are filtered automatically. First human click = attributed.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// In your system drawer
// ---------------------------------------------------------------------------

interface InboundEvent {
  id: string;
  event: string;
  phone: string;
  timestamp: string;
  receivedAt: string;
  matchedCallId?: string;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "•".repeat(phone.length);
  return `${digits.slice(0, 3)}${"•".repeat(digits.length - 5)}${digits.slice(-2)}`;
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="shrink-0 rounded border border-border px-2 py-1 text-[9.9px] text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? "Copied" : (label ?? "Copy")}
    </button>
  );
}

function InYourSystemDrawer({
  campaignId,
  windowDays,
  onWindowChange,
}: {
  campaignId?: string;
  windowDays: number;
  onWindowChange: (days: number) => void;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [loadingSecret, setLoadingSecret] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [events, setEvents] = useState<InboundEvent[] | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const endpointUrl = `${baseUrl}/api/events/inbound`;

  async function loadSecret() {
    if (!campaignId || secret) return;
    setLoadingSecret(true);
    try {
      const res = await apiFetch<{ secret: string }>(`/api/voice-campaigns/${campaignId}/webhook-secret`);
      setSecret(res.secret);
    } catch {
      setSecret(null);
    } finally {
      setLoadingSecret(false);
    }
  }

  async function regenerate() {
    if (!campaignId) return;
    setRegenerating(true);
    try {
      const res = await apiFetch<{ secret: string }>(`/api/voice-campaigns/${campaignId}/webhook-secret`, { method: "POST" });
      setSecret(res.secret);
      setSecretVisible(true);
    } finally {
      setRegenerating(false);
    }
  }

  async function loadEvents() {
    if (!campaignId) return;
    setLoadingEvents(true);
    try {
      const res = await apiFetch<{ events: InboundEvent[] }>(`/api/dev/inbound-events?campaignId=${campaignId}`);
      setEvents(res.events);
    } catch {
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }

  // Load secret on mount
  useState(() => { void loadSecret(); });

  const exampleBody = JSON.stringify({ event: "kyc_completed", phone: "+91XXXXXXXXXX", timestamp: new Date().toISOString().slice(0, 19) + "Z" }, null, 2);
  const curlExample = `curl -X POST ${endpointUrl} \\
  -H "Content-Type: application/json" \\
  -H "X-Actioneer-Campaign-Id: ${campaignId ?? "<campaign-id>"}" \\
  -H "X-Actioneer-Signature: sha256=<hmac>" \\
  -d '${JSON.stringify({ event: "kyc_completed", phone: "+91XXXXXXXXXX" })}'`;

  return (
    <div className="space-y-6">
      {/* Attribution window */}
      <div>
        <p className="text-sm font-medium mb-2">Attribution window</p>
        <div className="flex rounded-lg border border-border overflow-hidden w-fit">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              onClick={() => onWindowChange(opt.days)}
              className={cn(
                "px-4 py-2 text-sm transition-colors border-r border-border last:border-r-0",
                windowDays === opt.days ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Events received within this window after a call are counted as attributed.
        </p>
      </div>

      {/* Webhook endpoint */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Webhook endpoint</p>

        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden text-xs font-mono">
          {/* Endpoint URL */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="text-muted-foreground shrink-0">POST</span>
            <span className="flex-1 truncate text-foreground">{endpointUrl}</span>
            <CopyButton value={endpointUrl} />
          </div>

          {/* Campaign ID header */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="text-muted-foreground shrink-0 select-none">HDR</span>
            <span className="flex-1 truncate">
              <span className="text-muted-foreground">X-Actioneer-Campaign-Id: </span>
              <span className="text-foreground">{campaignId ?? "—"}</span>
            </span>
            {campaignId && <CopyButton value={campaignId} label="Copy ID" />}
          </div>

          {/* Secret */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="text-muted-foreground shrink-0 select-none">KEY</span>
            <span className="flex-1 truncate text-foreground font-mono">
              {loadingSecret ? "Loading…" : secret
                ? (secretVisible ? secret : `${secret.slice(0, 8)}${"•".repeat(20)}`)
                : "—"}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {secret && (
                <button
                  type="button"
                  onClick={() => setSecretVisible((v) => !v)}
                  className="rounded border border-border px-2 py-1 text-[9.9px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {secretVisible ? "Hide" : "Show"}
                </button>
              )}
              {secret && secretVisible && <CopyButton value={secret} />}
              <button
                type="button"
                onClick={() => void regenerate()}
                disabled={regenerating || !campaignId}
                className="rounded border border-border px-2 py-1 text-[9.9px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              >
                {regenerating ? "…" : "Regenerate"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Payload */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Payload</p>
          <CopyButton value={exampleBody} label="Copy JSON" />
        </div>
        <pre className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-foreground overflow-x-auto leading-relaxed">{exampleBody}</pre>
        <p className="mt-1.5 text-xs text-muted-foreground">
          <code className="font-mono">timestamp</code> is optional — defaults to time of receipt. Sign the raw JSON body with HMAC-SHA256 using the secret above, prefix with <code className="font-mono">sha256=</code>.
        </p>
      </div>

      {/* cURL example */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">cURL example</p>
          <CopyButton value={curlExample} label="Copy cURL" />
        </div>
        <pre className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[9.9px] text-muted-foreground overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">{curlExample}</pre>
      </div>

      {/* CSV fallback */}
      <div className="rounded-lg border border-border/50 px-4 py-3">
        <p className="text-sm font-medium mb-0.5">No backend access?</p>
        <p className="text-xs text-muted-foreground">
          Export a CSV from your database after the campaign ends — columns: <code className="font-mono">phone_number, event_name, event_date</code>. Upload it here to close the attribution loop manually.
        </p>
        <button type="button" className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors opacity-50 cursor-not-allowed">
          Upload CSV — coming soon
        </button>
      </div>

      {/* Recent events */}
      {campaignId && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Recent events</p>
            <button
              type="button"
              onClick={() => void loadEvents()}
              disabled={loadingEvents}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {loadingEvents ? "Loading…" : "Refresh"}
            </button>
          </div>
          {events === null ? (
            <button
              type="button"
              onClick={() => void loadEvents()}
              className="w-full rounded-lg border border-dashed border-border py-4 text-xs text-muted-foreground hover:border-foreground/30 transition-colors"
            >
              Load recent events
            </button>
          ) : events.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
              No events received yet
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
              {events.map((ev) => (
                <div key={ev.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className={cn(
                    "shrink-0 size-1.5 rounded-full",
                    ev.matchedCallId ? "bg-foreground" : "bg-muted-foreground/40",
                  )} />
                  <span className="text-xs font-mono text-muted-foreground shrink-0">{new Date(ev.receivedAt).toLocaleTimeString()}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{maskPhone(ev.phone)}</span>
                  <span className="text-xs text-foreground flex-1 truncate">{ev.event}</span>
                  <span className={cn("text-[9px] font-medium shrink-0", ev.matchedCallId ? "text-foreground" : "text-muted-foreground/60")}>
                    {ev.matchedCallId ? "matched" : "unmatched"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer (slides in from the right, same pattern as GuardrailsPanel)
// ---------------------------------------------------------------------------

function DetailDrawer({
  open,
  source,
  onClose,
  criterion,
  onCriterionChange,
  destinationUrl,
  followUpTemplate,
  windowDays,
  onDestChange,
  onTemplateChange,
  onWindowChange,
  campaignId,
  datasetId,
}: {
  open: boolean;
  source: ActiveDrawer;
  onClose: () => void;
  criterion: string;
  onCriterionChange: (v: string) => void;
  destinationUrl: string;
  followUpTemplate: string;
  windowDays: number;
  onDestChange: (v: string) => void;
  onTemplateChange: (v: string | undefined) => void;
  onWindowChange: (days: number) => void;
  campaignId?: string;
  datasetId?: string;
}) {
  const title = source === "call" ? "On the call" : source === "link" ? "Via our link" : "In your system";
  const Icon  = source === "call" ? Phone : source === "link" ? Link : Database;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-background/60 backdrop-blur-[2px] transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex w-[440px] flex-col bg-background border-l border-border transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
          {source && <Icon className="size-4 shrink-0 text-muted-foreground" />}
          <p className="flex-1 text-sm font-semibold">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {source === "call" && (
            <OnTheCallDrawer
              criterion={criterion}
              onCriterionChange={onCriterionChange}
              campaignId={campaignId}
              datasetId={datasetId}
            />
          )}
          {source === "link" && (
            <ViaLinkDrawer
              destinationUrl={destinationUrl}
              followUpTemplate={followUpTemplate}
              windowDays={windowDays}
              onDestChange={onDestChange}
              onTemplateChange={onTemplateChange}
              onWindowChange={onWindowChange}
            />
          )}
          {source === "system" && (
            <InYourSystemDrawer
              campaignId={campaignId}
              windowDays={windowDays}
              onWindowChange={onWindowChange}
            />
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end border-t border-border px-5 py-3">
          <Button type="button" size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Signal source row (category row — click opens the drawer)
// ---------------------------------------------------------------------------

function SourceRow({
  icon: Icon,
  label,
  description,
  status,
  selected,
  disabled,
  comingSoon,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  status?: string;
  selected: boolean;
  disabled?: boolean;
  comingSoon?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
        selected ? "bg-muted/40" : "hover:bg-muted/20",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      {comingSoon && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
          Soon
        </span>
      )}
      {!comingSoon && (
        <span className={cn("shrink-0 text-xs", selected ? "text-foreground font-medium" : "text-muted-foreground")}>
          {status ?? "Not configured"}
        </span>
      )}
      {!disabled && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SuccessMetricsPanel
// ---------------------------------------------------------------------------

export function SuccessMetricsPanel({
  successDefinition,
  onChangeSuccessDefinition,
  onSave,
  saving = false,
  canSave = false,
  campaignId,
  datasetId,
  footer,
}: {
  successDefinition: VoiceCampaignSuccessDefinition;
  onChangeSuccessDefinition: (next: VoiceCampaignSuccessDefinition) => void;
  onSave?: () => void;
  saving?: boolean;
  canSave?: boolean;
  campaignId?: string;
  datasetId?: string;
  footer?: React.ReactNode;
}) {
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>(null);

  const primary      = successDefinition.primary;
  const signalSource = toSignalSource(primary.type);

  function setPrimary(patch: Partial<typeof primary>) {
    onChangeSuccessDefinition({ ...successDefinition, primary: { ...primary, ...patch } });
  }

  function openDrawer(source: SignalSource) {
    const type: VoiceCampaignSuccessMetricType =
      source === "call"   ? "call_outcome"   :
      source === "link"   ? "link"           :
                            "dataset_event";
    setPrimary({
      type,
      outcome:   type === "call_outcome" ? (primary.outcome ?? "positive") : undefined,
    });
    setActiveDrawer(source);
  }

  // Status labels shown on each row
  const callStatus   = primary.criterion?.trim() ? "Criterion defined" : "Not configured";
  const linkStatus   = (() => {
    try { return primary.destinationUrl?.trim() ? new URL(primary.destinationUrl).hostname : "Not configured"; }
    catch { return "Not configured"; }
  })();
  const systemStatus = campaignId ? "Webhook ready" : "Save campaign first";

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden">
      {/* Main scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl mx-auto space-y-8">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Target className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Success Metrics</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Define what this campaign needs to achieve and how you&apos;ll measure it.
              </p>
            </div>
            {canSave && onSave && (
              <Button type="button" size="sm" variant="outline" onClick={onSave} disabled={saving} className="shrink-0">
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Save
              </Button>
            )}
          </div>

          {/* Goal */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70 mb-3">Goal</p>
            <input
              value={primary.label}
              onChange={(e) => setPrimary({ label: e.target.value })}
              placeholder="e.g. Customer completes KYC, Customer makes a deposit"
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-border"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              The business outcome this campaign should drive. Becomes the label on your results card.
            </p>
          </div>

          {/* Signal source — rows */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70 mb-3">
              How will we detect it?
            </p>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              <SourceRow
                icon={Phone}
                label="On the call"
                description="LLM reads the transcript and checks for a criterion you define."
                status={callStatus}
                selected={signalSource === "call"}
                onClick={() => openDrawer("call")}
              />
              <SourceRow
                icon={Link}
                label="Via our link"
                description="Customer clicks the trackable link in your SMS or WhatsApp follow-up."
                status={linkStatus}
                selected={signalSource === "link"}
                onClick={() => openDrawer("link")}
              />
              <SourceRow
                icon={Database}
                label="In your system"
                description="Client backend calls our webhook when the event fires. No app code required."
                status={systemStatus}
                selected={signalSource === "system"}
                onClick={() => openDrawer("system")}
              />
            </div>
          </div>

          {/* Footer slot (delete section etc.) */}
          {footer}

        </div>
      </div>

      {/* Slide-in detail drawer */}
      <DetailDrawer
        open={activeDrawer !== null}
        source={activeDrawer}
        onClose={() => setActiveDrawer(null)}
        criterion={primary.criterion ?? ""}
        onCriterionChange={(v) => setPrimary({ criterion: v })}
        destinationUrl={primary.destinationUrl ?? ""}
        followUpTemplate={primary.followUpTemplate ?? ""}
        windowDays={successDefinition.attributionWindowDays}
        onDestChange={(v) => setPrimary({ destinationUrl: v })}
        onTemplateChange={(v) => setPrimary({ followUpTemplate: v })}
        onWindowChange={(days) => onChangeSuccessDefinition({ ...successDefinition, attributionWindowDays: days })}
        campaignId={campaignId}
        datasetId={datasetId}
      />
    </div>
  );
}
