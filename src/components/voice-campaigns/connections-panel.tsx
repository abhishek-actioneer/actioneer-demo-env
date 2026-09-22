"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, CheckCircle2, Circle, Clock, Globe, Link2, MessageSquare, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { TenantConnection } from "@/lib/tenant-connections-store";

// ---------------------------------------------------------------------------
// Activity log types (populated in a later phase)
// ---------------------------------------------------------------------------

type ActivityRow = {
  id: string;
  recipient: string;
  channel: "whatsapp" | "sms" | "crm";
  action: string;
  status: "delivered" | "failed" | "pending" | "synced";
  time: string;
};

const CHANNEL_LABEL: Record<ActivityRow["channel"], string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  crm: "CRM",
};

const STATUS_ICON: Record<ActivityRow["status"], React.ComponentType<{ className?: string }>> = {
  delivered: CheckCircle2,
  synced: CheckCircle2,
  pending: Clock,
  failed: XCircle,
};

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: TenantConnection["status"] | undefined }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-[9px] font-medium text-foreground border border-border rounded-full px-2 py-0.5">
        <CheckCircle2 className="size-2.5" />
        Connected
      </span>
    );
  }
  if (status === "coming_soon") {
    return (
      <span className="text-[9px] font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5">
        Coming soon
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5">
      <Circle className="size-2.5" />
      Not connected
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ConnectionsPanel({ campaignId: _campaignId }: { campaignId?: string }) {
  const router = useRouter();
  const [connections, setConnections] = useState<TenantConnection[]>([]);
  const activityRows: ActivityRow[] = [];

  useEffect(() => {
    apiFetch<{ connections?: TenantConnection[] }>("/api/connections", { skipModel: true })
      .then((d) => setConnections(d.connections ?? []))
      .catch(() => {});
  }, []);

  const getConn = (type: TenantConnection["type"]) =>
    connections.find((c) => c.type === type);

  const sms = getConn("sms");
  const whatsapp = getConn("whatsapp");
  const crm = getConn("zoho") ?? getConn("hubspot");
  const whatsappTemplateReady = Boolean(whatsapp?.meta.templateId);

  const goToSettings = () => router.push("/settings/connections");

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-8">

      {/* Config section */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link2 className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Connections</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Automations triggered after each call. Configure credentials once in{" "}
          <button onClick={goToSettings} className="underline hover:text-foreground transition-colors">
            Settings → Connections
          </button>
          .
        </p>

        <div className="space-y-3">
          {/* WhatsApp */}
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-2">
                <Globe className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">WhatsApp follow-up</p>
              </div>
              <StatusBadge status={whatsapp?.status} />
            </div>
            <div className={cn("space-y-2", whatsapp?.status !== "connected" && "opacity-40 pointer-events-none select-none")}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-28 shrink-0">Sender →</span>
                <span className="flex-1 rounded border border-border/50 px-2 py-1 bg-muted/20">
                  {whatsapp?.meta.from ?? "Not configured"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-28 shrink-0">Template →</span>
                <span className="flex-1 rounded border border-border/50 px-2 py-1 bg-muted/20">
                  {whatsappTemplateReady ? whatsapp?.meta.templateId : "Template ID not set"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-28 shrink-0">Post-call →</span>
                <span className="flex-1 rounded border border-border/50 px-2 py-1 bg-muted/20">
                  Transcript consent or explicit WhatsApp request
                </span>
              </div>
            </div>
            {whatsapp?.status !== "connected" ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Connect WhatsApp Business API in{" "}
                <button onClick={goToSettings} className="underline hover:text-foreground transition-colors">
                  Settings → Connections
                </button>
              </p>
            ) : !whatsappTemplateReady && (
              <p className="mt-3 text-xs text-muted-foreground">
                Add a default Gupshup template ID in{" "}
                <button onClick={goToSettings} className="underline hover:text-foreground transition-colors">
                  Settings → Connections
                </button>
                {" "}for sandbox-safe post-call sends.
              </p>
            )}
          </div>

          {/* SMS */}
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">SMS follow-up</p>
              </div>
              <StatusBadge status={sms?.status} />
            </div>
            {sms?.status === "connected" ? (
              <div className="space-y-2">
                {["On success →", "On no answer →", "On objection →"].map((trigger) => (
                  <div key={trigger} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-28 shrink-0">{trigger}</span>
                    <span className="flex-1 rounded border border-border/50 px-2 py-1 bg-muted/20">
                      Configure template…
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Connect Twilio in{" "}
                <button onClick={goToSettings} className="underline hover:text-foreground transition-colors">
                  Settings → Connections
                </button>
              </p>
            )}
          </div>

          {/* CRM */}
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">CRM sync</p>
              </div>
              <StatusBadge status={crm?.status} />
            </div>
            <div className="space-y-2 opacity-40 pointer-events-none select-none">
              {[["On call end →", `Push to ${crm?.provider || "CRM"}`], ["Map outcome to", "Deal Stage"], ["Transcript to", "Activity notes"]].map(([trigger, val]) => (
                <div key={trigger} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="w-28 shrink-0">{trigger}</span>
                  <span className="flex-1 rounded border border-border/50 px-2 py-1 bg-muted/20">{val}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Connect your CRM in{" "}
              <button onClick={goToSettings} className="underline hover:text-foreground transition-colors">
                Settings → Connections
              </button>
            </p>
          </div>
        </div>
      </div>

      {/* Activity log */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Activity className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Activity log</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Outbound messages and CRM syncs triggered by this campaign.
        </p>

        <div className="flex items-center gap-2 mb-4">
          {["All", "WhatsApp", "SMS", "CRM"].map((f, i) => (
            <button
              key={f}
              type="button"
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                i === 0
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {activityRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center rounded-lg border border-dashed border-border">
            <Activity className="size-7 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No messages sent yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Configure templates above to start logging activity here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {activityRows.map((row) => {
              const Icon = STATUS_ICON[row.status];
              return (
                <div key={row.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{row.recipient}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{row.action}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
                    {CHANNEL_LABEL[row.channel]}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Icon className={cn("size-3.5", row.status === "failed" ? "text-destructive" : "text-muted-foreground")} />
                    <span className="text-xs text-muted-foreground capitalize">{row.status}</span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.time}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
