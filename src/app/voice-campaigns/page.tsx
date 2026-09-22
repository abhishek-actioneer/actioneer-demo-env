"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Phone, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DataTableFrame,
  DataTableScroll,
  DataTableToolbar,
} from "@/components/ui/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getVoiceCampaignMetrics } from "@/components/voice-campaigns/voice-campaign-studio";
import { apiFetch } from "@/lib/api-client";
import { useDataset } from "@/lib/dataset-context";
import { createVoiceCampaignDraft } from "@/lib/voice-campaign-draft-client";
import type { VoiceCall, VoiceCampaign } from "@/lib/voice-campaign-types";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  launching: "Launching",
  in_progress: "In progress",
  completed: "Completed",
};

function withDataset(path: string, datasetId: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}datasetId=${encodeURIComponent(datasetId)}`;
}

function hasCallTag(call: VoiceCall, tag: string): boolean {
  return (call.tags ?? []).some((value) => value.toLowerCase() === tag);
}

function isCampaignCall(call: VoiceCall): boolean {
  return hasCallTag(call, "campaign");
}

function isTestCall(call: VoiceCall): boolean {
  return hasCallTag(call, "live test") || hasCallTag(call, "test call");
}

function callbackCandidateCalls(campaign: VoiceCampaign): VoiceCall[] {
  const calls = Array.isArray(campaign.calls) ? campaign.calls : [];
  const campaignCalls = calls.filter(isCampaignCall);
  if (campaignCalls.length > 0) return campaignCalls;
  return calls.filter((call) => !isTestCall(call));
}

function isProviderOnlySummary(summary: string | undefined): boolean {
  const text = summary?.trim() ?? "";
  return !text ||
    /^Gemini\b.*\baccepted\b/i.test(text) ||
    /^Browser live test\b/i.test(text);
}

function callText(call: VoiceCall): string {
  const customerTranscript = (call.transcript ?? [])
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.text)
    .join(" ");
  const transcript = customerTranscript || (call.transcript ?? [])
    .filter((turn) => turn.role !== "recording")
    .map((turn) => turn.text)
    .join(" ");
  const summary = call.analysis?.summary ?? (isProviderOnlySummary(call.summary) ? "" : call.summary ?? "");
  return `${summary} ${transcript}`.toLowerCase();
}

function hasCallbackScheduledSignal(call: VoiceCall): boolean {
  if ((call.followUps ?? []).length > 0) return true;
  const text = `${call.analysis?.nextStep ?? ""} ${call.analysis?.summary ?? ""} ${call.analysis?.reason ?? ""} ${callText(call)}`;
  return /\b(callback|call back|advisor|adviser|specialist|appointment|schedule|scheduled|whatsapp follow[-\s]?up)\b/i.test(text);
}

function callbackScheduledCount(campaign: VoiceCampaign): number {
  const calls = callbackCandidateCalls(campaign);
  const observedCallbacks = calls.filter(hasCallbackScheduledSignal).length;
  if (observedCallbacks > 0) return observedCallbacks;
  if (calls.length === 0 && campaign.simulation) {
    return getVoiceCampaignMetrics(campaign).positive;
  }
  return 0;
}

function totalCallsCount(campaign: VoiceCampaign): number {
  const calls = callbackCandidateCalls(campaign);
  if (calls.length > 0) return calls.length;
  if (campaign.simulation) return getVoiceCampaignMetrics(campaign).attempted;
  return 0;
}

export default function VoiceCampaignsPage() {
  const router = useRouter();
  const { datasetId } = useDataset();
  const [campaigns, setCampaigns] = useState<VoiceCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ campaigns: VoiceCampaign[] }>(withDataset("/api/voice-campaigns", datasetId), { skipModel: true, datasetId })
      .then((res) => setCampaigns(res.campaigns))
      .finally(() => setLoading(false));
  }, [datasetId]);

  const filtered = campaigns.filter((campaign) => {
    const haystack = [
      campaign.name,
      campaign.segmentName,
      campaign.purposeName,
      campaign.status,
    ].join(" ").toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  async function handleDeleteCampaign(campaign: VoiceCampaign) {
    setDeletingId(campaign.id);
    setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
    try {
      await apiFetch(withDataset(`/api/voice-campaigns/${encodeURIComponent(campaign.id)}`, datasetId), {
        method: "DELETE",
        skipModel: true,
        datasetId,
      });
    } catch (err) {
      setCampaigns((current) => [campaign, ...current].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ));
      console.warn("[voice-campaigns] Failed to delete campaign", err);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleNewCampaign() {
    if (creatingDraft) return;
    setCreatingDraft(true);
    try {
      const id = await createVoiceCampaignDraft(datasetId);
      router.push(`/voice-campaigns/new?campaignId=${encodeURIComponent(id)}`);
    } finally {
      setCreatingDraft(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-w-0 overflow-y-auto">
      <div className="w-full px-5 py-5">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">Voice Campaigns</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Studio and live-test surface for outbound AI voice calls.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="rounded-[2px]" onClick={handleNewCampaign} disabled={creatingDraft}>
            {creatingDraft ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            New campaign
          </Button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading campaigns...
          </div>
        )}

        {!loading && campaigns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Phone className="mb-4 size-10 text-muted-foreground" />
            <h2 className="text-sm font-medium mb-1">No voice campaigns yet</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Pick a segment and a purpose to launch your first campaign
            </p>
            <Button type="button" variant="outline" size="sm" onClick={handleNewCampaign} disabled={creatingDraft}>
              {creatingDraft ? <Loader2 className="size-3.5 animate-spin" /> : null}
              New Campaign
            </Button>
          </div>
        )}

        {!loading && campaigns.length > 0 && filtered.length === 0 && (
          <div className="flex items-center justify-center rounded-lg py-20 text-sm text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
            No campaigns match this search.
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <DataTableFrame>
            <DataTableToolbar>
              <label className="relative w-full max-w-xs">
                <span className="sr-only">Search campaigns</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search campaigns"
                  className="h-8 rounded-[2px] bg-white pl-8 text-sm"
                />
              </label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {filtered.length} campaign{filtered.length === 1 ? "" : "s"}
              </span>
            </DataTableToolbar>
            <DataTableScroll>
              <div className="grid min-w-[900px] grid-cols-[minmax(280px,1.4fr)_120px_110px_160px_96px_44px] gap-4 border-b border-border bg-neutral-50 px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <div>Campaign</div>
                <div>Status</div>
                <div>Total calls</div>
                <div>Callback scheduled</div>
                <div className="text-right">Updated</div>
                <div>
                  <span className="sr-only">Actions</span>
                </div>
              </div>
              <div className="divide-y divide-border">
                {filtered.map((campaign) => {
                  const totalCalls = totalCallsCount(campaign);
                  const callbacks = callbackScheduledCount(campaign);
                  return (
                    <div
                      key={campaign.id}
                      className="group grid min-h-14 min-w-[900px] grid-cols-[minmax(280px,1.4fr)_120px_110px_160px_96px_44px] gap-4 bg-white px-4 py-3 transition-colors hover:bg-neutral-50/80"
                    >
                    <Link
                      href={`/voice-campaigns/new?campaignId=${encodeURIComponent(campaign.id)}`}
                      className="group/link min-w-0 self-center"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                        <span className="truncate">{campaign.name}</span>
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/link:opacity-100" />
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {campaign.purposeName} · {campaign.segmentName}
                      </span>
                    </Link>

                    <div className="self-center">
                      <span className="inline-flex whitespace-nowrap rounded-[2px] border border-border bg-neutral-50 px-2 py-1 text-xs text-muted-foreground">
                        {STATUS_LABEL[campaign.status] ?? campaign.status}
                      </span>
                    </div>

                    <NumberCell value={totalCalls} />
                    <CallbackScheduled value={callbacks} />

                    <div className="self-center text-right text-xs text-muted-foreground">
                      {relativeTime(campaign.launchedAt ?? campaign.createdAt)}
                    </div>

                    <div className="self-center text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Delete ${campaign.name}`}
                            disabled={deletingId === campaign.id}
                            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {deletingId === campaign.id
                              ? <Loader2 className="size-3.5 animate-spin" />
                              : <Trash2 className="size-3.5" />}
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete voice campaign?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete &ldquo;{campaign.name}&rdquo; and its call logs from this workspace.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteCampaign(campaign)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    </div>
                  );
                })}
              </div>
            </DataTableScroll>
          </DataTableFrame>
        )}
      </div>
    </div>
  );
}

function CallbackScheduled({ value }: { value: number }) {
  if (value <= 0) return <div className="self-center text-sm text-muted-foreground">-</div>;
  return (
    <div className="self-center text-sm tabular-nums text-foreground">
      {value.toLocaleString()}
    </div>
  );
}

function NumberCell({ value }: { value: number }) {
  return (
    <div className="self-center text-sm tabular-nums text-foreground">
      {value.toLocaleString()}
    </div>
  );
}
