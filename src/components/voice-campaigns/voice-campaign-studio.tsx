"use client";

import { type ComponentType } from "react";
import { BarChart3, FileText, ListChecks, Mic, Shield, Target, Link2, Workflow } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VoiceVoxel } from "@/components/voice-campaigns/voice-voxel";
import { VoicePromptsFullView } from "@/components/voice-campaigns/voice-prompt-inspector";
import { cn } from "@/lib/utils";
import type { VoiceCallOutcome, VoiceCampaign } from "@/lib/voice-campaign-types";

// ---------------------------------------------------------------------------
// Types & interfaces (canonical — imported by hooks, panels, and studio-utils)
// ---------------------------------------------------------------------------

export type VoiceCampaignStudioTab =
  | "script"
  | "workflow"
  | "overview"
  | "call-logs"
  | "voice-analysis"
  | "guardrails"
  | "success-metrics"
  | "connections";

export type VoiceCallLogFilter =
  | { kind: "outcome"; outcome: VoiceCallOutcome }
  | { kind: "script-check"; check: string }
  | { kind: "latency" }
  | { kind: "retention"; minSeconds: number };

export interface VoiceOverviewDrilldown {
  filter?: VoiceCallLogFilter;
  callRef?: string;
}

export interface VoiceCampaignMetrics {
  attempted: number;
  rang: number;
  pickedUp: number;
  aiConnected: number;
  engaged20s: number;
  positive: number;
  outcomes: Record<VoiceCallOutcome, number>;
}

export interface PromptPreview {
  firstMessage?: string;
  systemPrompt?: string;
  reasoning?: string;
  datasetName?: string;
  segmentName?: string;
  purposeName?: string;
  voice?: string;
  voiceName?: string;
  language?: string;
}

export const VOICE_CAMPAIGN_TABS: Array<{
  id: VoiceCampaignStudioTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
  requiresLaunch?: boolean;
}> = [
  { id: "script",          label: "Script",          icon: FileText },
  { id: "workflow",        label: "Workflow",         icon: Workflow },
  { id: "overview",        label: "Spotlight",        icon: BarChart3 },
  { id: "call-logs",       label: "Call Logs",        icon: ListChecks, requiresLaunch: true },
  { id: "voice-analysis",  label: "Voice Analysis",   icon: Mic,        requiresLaunch: true },
  { id: "guardrails",      label: "Guardrails",       icon: Shield },
  { id: "success-metrics", label: "Success Metrics",  icon: Target },
  { id: "connections",     label: "Connections",      icon: Link2 },
];

// ---------------------------------------------------------------------------
// Re-exports from extracted panel files
// ---------------------------------------------------------------------------

export { VoiceOverviewPanel, VoicePerformancePanel } from "@/components/voice-campaigns/voice-overview-panel";
export { VoiceResponsesPanel } from "@/components/voice-campaigns/voice-responses-panel";
export { VoiceCallLogsPanel, VoiceOutcomePill } from "@/components/voice-campaigns/voice-call-logs-panel";

// Re-export analysis utilities that external consumers import from here
export {
  classifyVoiceCallOutcome,
  getVoiceCallStageFacts,
  getVoiceCampaignMetrics,
  formatVoicePercent,
} from "@/lib/voice-campaign-analysis";

// ---------------------------------------------------------------------------
// VoiceCampaignTabList — tab bar used in the studio header
// ---------------------------------------------------------------------------

export function VoiceCampaignTabList({
  isLaunched = false,
  disabledTabs,
  hiddenTabs,
}: {
  isLaunched?: boolean;
  disabledTabs?: Partial<Record<VoiceCampaignStudioTab, boolean>>;
  hiddenTabs?: Partial<Record<VoiceCampaignStudioTab, boolean>>;
}) {
  return (
    <TabsList
      variant="line"
      className="grid h-11 w-full auto-cols-fr grid-flow-col items-stretch justify-stretch gap-0 rounded-none bg-[#f1f1ed] p-0"
    >
      {VOICE_CAMPAIGN_TABS.filter((tab) => !hiddenTabs?.[tab.id]).map((tab) => {
        const Icon = tab.icon;
        const locked = tab.requiresLaunch && !isLaunched;
        const disabled = locked || disabledTabs?.[tab.id];
        return (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            disabled={disabled}
            title={locked ? "Launch campaign to unlock" : undefined}
            className={cn(
              "group/voice-tab h-auto min-w-0 self-stretch rounded-none border-0 border-l border-border px-2 text-[9.9px] font-semibold uppercase tracking-[0.075em] text-muted-foreground after:hidden first:border-l-0 hover:bg-background/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_2px_0_var(--brand-amber)]",
              locked && "opacity-35",
            )}
          >
            <Icon className="size-3.5 opacity-70" />
            {tab.label}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-[-1px] hidden h-px bg-foreground group-data-[state=active]/voice-tab:block"
            />
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}

export function isVoiceCampaignLaunched(campaign: VoiceCampaign | null | undefined): boolean {
  return Boolean(campaign?.audienceLaunchedAt);
}

// ---------------------------------------------------------------------------
// VoicePromptsPanel — shows compiled LLM prompts for a campaign
// ---------------------------------------------------------------------------

export function VoicePromptsPanel({ prompt }: { prompt: PromptPreview }) {
  return <VoicePromptsFullView prompt={prompt} />;
}

// ---------------------------------------------------------------------------
// VoiceSettingsGrid — key/value grid used on the settings tab
// ---------------------------------------------------------------------------

export function VoiceSettingsGrid({
  items,
}: {
  items: Array<{ label: string; value: string | number | undefined; voiceName?: string }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-background px-4 py-3 shadow-[0_0_0_1px_var(--color-border)]">
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <div className={cn("mt-1 flex min-w-0 items-center gap-2 text-sm font-medium", item.value === undefined && "text-muted-foreground")}>
            {item.voiceName && <VoiceVoxel voiceName={item.voiceName} size={22} />}
            <span className="min-w-0 truncate">{item.value ?? "-"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
