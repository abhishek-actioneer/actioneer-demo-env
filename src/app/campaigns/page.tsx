"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Loader2,
  PhoneCall,
  Plus,
  Send,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import {
  FUNDSINDIA_LIFECYCLE_DATASET_ID,
  type DecisionValue,
  type LifecycleCampaignListItem,
} from "@/lib/lifecycle-campaign-types";
import type { CampaignListItem, CampaignsResponse } from "@/app/api/campaigns/route";

function pct(value: number | null): string {
  if (value === null) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function CampaignsPage() {
  const [items, setItems] = useState<LifecycleCampaignListItem[]>([]);
  const [legacyItems, setLegacyItems] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<CampaignsResponse>("/api/campaigns", {
      skipModel: true,
      datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
    })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setLegacyItems(res.legacyItems);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) =>
      `${item.name} ${item.segmentName ?? ""} ${item.offerName ?? ""} ${item.status} ${item.latestDecision ?? ""}`
        .toLowerCase()
        .includes(term)
    );
  }, [items, search]);

  const totals = useMemo(() => ({
    campaigns: items.length,
    enrolled: items.reduce((sum, item) => sum + item.enrolledCount, 0),
    tasks: items.reduce((sum, item) => sum + item.treatmentTaskCount, 0),
    attempted: items.reduce((sum, item) => sum + item.attemptedCount, 0),
    decisions: items.filter((item) => item.latestDecision).length,
  }), [items]);

  return (
    <div className="flex flex-col h-full min-w-0 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-8 pb-6">
        <h1 className="text-xl font-semibold text-foreground">Campaigns</h1>
        <Link
          href="/campaigns/new"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
        >
          <Plus className="w-4 h-4" />
          New Campaign
        </Link>
      </div>

      <div className="max-w-5xl mx-auto px-6 pb-8 w-full">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <Tile label="Campaigns" value={totals.campaigns.toLocaleString()} />
          <Tile label="Enrolled" value={totals.enrolled.toLocaleString()} />
          <Tile label="Voice tasks" value={totals.tasks.toLocaleString()} />
          <Tile label="Attempted" value={totals.attempted.toLocaleString()} />
          <Tile label="Decisions" value={totals.decisions.toLocaleString()} />
        </div>

        <div className="flex items-center justify-between gap-3 mb-3">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Campaigns"
            className="h-9 w-72 max-w-full rounded border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-foreground/20"
          />
          <div className="text-xs text-muted-foreground">Dataset: fundsindia</div>
        </div>

        {loading ? (
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading campaigns...
          </div>
        ) : error ? (
          <div className="inline-flex items-center gap-2 rounded bg-muted px-3 py-2 text-sm text-foreground">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState hasAny={items.length > 0} />
        ) : (
          <div className="overflow-hidden rounded border border-border">
            <div className="grid grid-cols-[1.5fr_0.9fr_0.7fr_0.7fr_0.7fr_0.8fr_32px] gap-3 border-b border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
              <div>Campaign</div>
              <div>Status</div>
              <div className="text-right">Enrolled</div>
              <div className="text-right">Attempted</div>
              <div className="text-right">OEC rate</div>
              <div>Decision</div>
              <div />
            </div>
            {filtered.map((item, index) => (
              <CampaignRow key={item.id} item={item} divider={index > 0} />
            ))}
          </div>
        )}

        {legacyItems.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-3">
              <Send className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">Legacy Sends</h2>
              <span className="text-xs text-muted-foreground">{legacyItems.length.toLocaleString()}</span>
            </div>
            <div className="rounded border border-border divide-y divide-border">
              {legacyItems.slice(0, 8).map((item) => (
                <Link
                  key={item.id}
                  href={`/campaigns/${item.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">{item.subject || "Untitled send"}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {item.segmentName ?? item.segmentId} · {item.channel ?? "campaign"} · {relativeTime(item.createdAt)}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignRow({ item, divider }: { item: LifecycleCampaignListItem; divider: boolean }) {
  return (
    <Link
      href={`/campaigns/${item.id}`}
      className={`grid grid-cols-[1.5fr_0.9fr_0.7fr_0.7fr_0.7fr_0.8fr_32px] gap-3 px-4 py-3 hover:bg-muted/30 ${divider ? "border-t border-border" : ""}`}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {item.segmentName ?? item.segmentId} · {item.offerName ?? item.offerId} · as of {item.asOfDate}
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm text-foreground">
        {item.status === "completed" ? <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" /> : <PhoneCall className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="capitalize">{item.status}</span>
      </div>
      <div className="text-right text-sm tabular-nums text-foreground">{item.enrolledCount.toLocaleString()}</div>
      <div className="text-right text-sm tabular-nums text-foreground">{item.attemptedCount.toLocaleString()}</div>
      <div className="text-right text-sm tabular-nums text-foreground">{pct(item.conversionRate)}</div>
      <div>
        <DecisionBadge decision={item.latestDecision} status={item.status} />
      </div>
      <div className="flex justify-end">
        <ArrowRight className="w-4 h-4 text-muted-foreground" />
      </div>
    </Link>
  );
}

function DecisionBadge({
  decision,
  status,
}: {
  decision?: DecisionValue;
  status: LifecycleCampaignListItem["status"];
}) {
  const label = decision === "ship"
    ? "Ship"
    : decision === "kill"
      ? "Kill"
      : decision === "iterate"
        ? "Iterate"
        : status === "draft"
          ? "Not ready"
          : "Needs decision";
  return (
    <span className="inline-flex items-center rounded border border-border px-2 py-0.5 text-[9.9px] font-medium text-foreground">
      {label}
    </span>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-background px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-medium tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
      <FlaskConical className="size-10 text-muted-foreground/50 mb-4" />
      <h3 className="text-sm font-medium text-foreground">
        {hasAny ? "No campaigns match this search." : "No lifecycle campaigns yet."}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        Create the FundsIndia KYC recovery pilot to enroll investors, assign control and script arms, and monitor voice-call lift.
      </p>
    </div>
  );
}
