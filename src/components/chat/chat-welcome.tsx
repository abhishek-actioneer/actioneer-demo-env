"use client";

import { useMemo, type ReactNode } from "react";
import { useDataset } from "@/lib/dataset-context";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Activity, Megaphone, PhoneCall, Users } from "lucide-react";
import { useSidebarContext } from "@/components/sidebar-context";
import {
  callStartedAt,
  callStatusLabel,
  classifyVoiceCallOutcome,
  formatDuration,
  maskPhone,
} from "@/lib/voice-campaign-analysis";
import type { VoiceCall, VoiceCampaign } from "@/lib/voice-campaign-types";
import type { VoiceAgentPrompt } from "@/lib/voice-agent-generation-types";

interface ChatWelcomeProps {
  onPromptClick?: (prompt: VoiceAgentPrompt) => void;
  hidePrompts?: boolean;
  overridePrompts?: string[];
  children?: ReactNode;
}

export function ChatWelcome({ onPromptClick, hidePrompts, overridePrompts, children }: ChatWelcomeProps) {
  const { dataset, datasetId } = useDataset();
  const { segments, voiceCampaigns } = useSidebarContext();
  const { user } = useUser();
  const entityName = dataset.entityName?.trim() || "customers";

  const prompts = useMemo(() => {
    if (overridePrompts?.length) {
      return overridePrompts.map((text) => ({ text, goal: text, context: { datasetId } }));
    }

    const segmentPrompts = [...segments]
      .sort((a, b) => b.userCount - a.userCount)
      .slice(0, 3)
      .map((segment, index) => {
        const actions = ["welcome and onboard", "follow up with", "collect feedback from"];
        const goal = `${actions[index]} the ${segment.name} segment`;
        return {
          text: `Create a voice agent to ${goal} (${segment.userCount.toLocaleString()} ${entityName})`,
          goal,
          context: {
            datasetId,
            segmentId: segment.id,
            segmentName: segment.name,
            segmentUserCount: segment.userCount,
          },
        };
      });

    const datasetPrompts = [
      `Create an outbound voice agent for ${dataset.label} ${entityName}`,
      `Build a support voice agent that escalates unresolved ${entityName} questions`,
      `Create a voice agent to verify details and schedule callbacks for ${entityName}`,
      `Build a concise multilingual voice agent for ${dataset.label}`,
      `Create a voice workflow with wrong-person, busy, do-not-call, and escalation routes`,
    ].map((text) => ({ text, goal: text, context: { datasetId } }));

    return [...segmentPrompts, ...datasetPrompts].slice(0, 5);
  }, [dataset.label, datasetId, entityName, overridePrompts, segments]);

  const dashboard = useMemo(() => buildDashboard(voiceCampaigns), [voiceCampaigns]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <section
        className="flex min-h-[610px] shrink-0 flex-col items-center px-4 pt-16"
        style={{
          backgroundColor: "#f9f8f2",
          backgroundImage:
            "linear-gradient(rgba(92,92,84,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(92,92,84,0.055) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
        }}
      >
        <h1 className="mb-8 mt-10 text-[30.6px] font-semibold tracking-[-0.035em]">Create a Voice Agent</h1>

        {children && <div className="w-full max-w-[760px]">{children}</div>}

        <div
          suppressHydrationWarning
          className={`mt-1 flex w-full max-w-[760px] flex-wrap justify-center gap-2 px-4 transition-[opacity,transform] duration-300 ease-out ${
            hidePrompts ? "pointer-events-none translate-y-2 opacity-0" : "translate-y-0 opacity-100"
          }`}
        >
          {prompts.slice(0, 5).map((prompt) => (
            <button
              key={prompt.text}
              type="button"
              title={prompt.text}
              onClick={() => onPromptClick?.(prompt)}
              className="max-w-[360px] truncate rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground"
            >
              {prompt.text}
            </button>
          ))}
        </div>

      </section>

      <section className="border-t border-border bg-card px-8 pb-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="py-7">
            <h2 className="text-2xl font-semibold tracking-[-0.03em]">Welcome back, {user?.firstName || "there"}</h2>
            <p className="mt-1 text-base text-[#b48d58]">Continue where you left off</p>
          </div>

          <div className="grid grid-cols-2 border border-border bg-border md:grid-cols-4">
            <HomeStat icon={Megaphone} label="Voice campaigns" value={voiceCampaigns.length.toLocaleString()} />
            <HomeStat icon={PhoneCall} label="Calls attempted" value={dashboard.calls.length.toLocaleString()} />
            <HomeStat icon={Activity} label="Connected calls" value={dashboard.connectedCalls.toLocaleString()} />
            <HomeStat icon={Users} label={`Dataset ${entityName}`} value={dataset.reportMeta.totalUsers} />
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,0.8fr)]">
            <RecentCallActivity rows={dashboard.recentCalls} />
            <CallVolumeChart points={dashboard.volume} />
          </div>

          <div className="mt-5 border border-border bg-card">
            <div className="border-b border-border bg-[#f7f5f1] px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Audience segments</h3>
            </div>
            {segments.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No saved segments for this dataset yet.</p>
            ) : (
              <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
                {[...segments]
                  .sort((a, b) => b.userCount - a.userCount)
                  .slice(0, 6)
                  .map((segment) => (
                    <Link key={segment.id} href={`/segments/${segment.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50">
                      <span className="min-w-0 truncate text-sm font-medium">{segment.name}</span>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{segment.userCount.toLocaleString()} {entityName}</span>
                    </Link>
                  ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

type CampaignCall = { campaign: VoiceCampaign; call: VoiceCall; timestamp: number };

function callTimestamp(campaign: VoiceCampaign, call: VoiceCall): number {
  if (call.startedAt) return new Date(call.startedAt).getTime();
  if (call.endedAt) return new Date(call.endedAt).getTime();
  if (call.triggeredAtMs) return call.triggeredAtMs;
  return new Date(campaign.launchedAt || campaign.createdAt).getTime();
}

function buildDashboard(campaigns: VoiceCampaign[]) {
  const calls: CampaignCall[] = campaigns
    .flatMap((campaign) => campaign.calls.map((call) => ({ campaign, call, timestamp: callTimestamp(campaign, call) })))
    .sort((a, b) => b.timestamp - a.timestamp);
  const connectedCalls = calls.filter(({ call }) => call.status === "connected" || call.status === "completed").length;
  const anchor = calls[0]?.timestamp || Date.now();
  const volume = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(anchor);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const dayStart = date.getTime();
    const dayEnd = dayStart + 86_400_000;
    return {
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      value: calls.filter(({ timestamp }) => timestamp >= dayStart && timestamp < dayEnd).length,
    };
  });
  return { calls, connectedCalls, recentCalls: calls.slice(0, 6), volume };
}

function HomeStat({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className="size-3.5" />{label}</div>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function RecentCallActivity({ rows }: { rows: CampaignCall[] }) {
  return (
    <section className="overflow-hidden border border-border bg-card">
      <div className="border-b border-border bg-[#f7f5f1] px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recent call activity</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">Calls will appear here after a campaign or live test runs.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border text-left text-[9.9px] uppercase tracking-[0.06em] text-muted-foreground">
              <tr><th className="px-4 py-2.5 font-medium">Campaign</th><th className="px-4 py-2.5 font-medium">Recipient</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Outcome</th><th className="px-4 py-2.5 font-medium">Duration</th><th className="px-4 py-2.5 font-medium">Created</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ campaign, call }) => (
                <tr key={`${campaign.id}-${call.id}`} className="hover:bg-muted/35">
                  <td className="max-w-48 truncate px-4 py-3 font-medium">{campaign.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{maskPhone(call.toNumber)}</td>
                  <td className="px-4 py-3">{callStatusLabel(call)}</td>
                  <td className="px-4 py-3 capitalize">{classifyVoiceCallOutcome(call).replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 tabular-nums">{formatDuration(call.durationSeconds)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{callStartedAt(call)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CallVolumeChart({ points }: { points: Array<{ label: string; value: number }> }) {
  const max = Math.max(...points.map((point) => point.value), 1);
  const coordinates = points.map((point, index) => {
    const x = 24 + index * (252 / Math.max(points.length - 1, 1));
    const y = 130 - (point.value / max) * 100;
    return { ...point, x, y };
  });
  return (
    <section className="border border-border bg-card">
      <div className="border-b border-border bg-[#f7f5f1] px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Call volume</h3>
      </div>
      <div className="px-4 py-5">
        <svg viewBox="0 0 300 164" className="h-44 w-full" role="img" aria-label="Call volume over the last seven active days">
          <line x1="24" y1="130" x2="276" y2="130" stroke="var(--border)" />
          <polyline points={coordinates.map(({ x, y }) => `${x},${y}`).join(" ")} fill="none" stroke="#c96d4f" strokeWidth="2" />
          {coordinates.map(({ label, value, x, y }) => (
            <g key={label}><circle cx={x} cy={y} r="3" fill="#c96d4f" /><text x={x} y="151" textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{label}</text><title>{label}: {value} calls</title></g>
          ))}
        </svg>
        <p className="text-center text-xs text-muted-foreground">{points.reduce((sum, point) => sum + point.value, 0).toLocaleString()} calls across the displayed period</p>
      </div>
    </section>
  );
}
