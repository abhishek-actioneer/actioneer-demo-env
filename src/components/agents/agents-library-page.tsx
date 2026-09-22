"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  ChevronRight,
  GitBranch,
  Loader2,
  PhoneCall,
  Plus,
  RefreshCw,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { VoiceVoxel } from "@/components/voice-campaigns/voice-voxel";
import { apiFetch } from "@/lib/api-client";
import { useDataset } from "@/lib/dataset-context";
import type { Agent } from "@/lib/agent-types";

interface AgentView {
  id: string;
  name: string;
  role: string;
  voiceName: string;
  voice: string;
  language: string;
  systemPrompt: string;
  firstMessage: string;
  campaignCount: number;
  callCount: number;
  workflowNodes: number;
  version: number;
  updatedAt: string;
  source: "campaign" | "custom";
  /** Representative campaign id — the persona source when deploying this agent (e.g. inbound). */
  campaignId?: string;
  avatarSeed?: string;
}

const AVATAR_BACKGROUNDS = [
  "bg-[#123524]",
  "bg-[#4c0b78]",
  "bg-[#0f3f75]",
  "bg-[#9a3412]",
  "bg-[#6b1535]",
  "bg-[#0f5b62]",
];

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result);
}

function avatarBackground(name: string): string {
  return AVATAR_BACKGROUNDS[hash(name) % AVATAR_BACKGROUNDS.length] ?? AVATAR_BACKGROUNDS[0];
}

function displayDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Recently updated";
  return `Updated ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)}`;
}

/** Agent enriched with live aggregates from the /api/agents read model. */
type AgentApi = Agent & { callCount?: number; workflowNodes?: number };

/** Map a persisted Agent (+ live aggregates) into the card/detail view model. */
function agentToView(a: AgentApi): AgentView {
  return {
    id: a.id,
    name: a.name,
    role: a.role || "Voice Agent",
    voiceName: a.voiceName || a.name,
    voice: a.voice,
    language: a.language,
    systemPrompt: a.systemPrompt,
    firstMessage: a.firstMessage,
    campaignCount: a.campaignCount ?? 0,
    callCount: a.callCount ?? 0,
    workflowNodes: a.workflowNodes ?? 0,
    // Real agent version. Versioning proper (draft/published) is Phase 3; until
    // then every agent is v1 — no longer the old "campaign count" stand-in.
    version: 1,
    updatedAt: a.updatedAt,
    source: "campaign",
    campaignId: a.primaryCampaignId,
    avatarSeed: a.avatarSeed,
  };
}

function VoxelAvatar({ agent, size = 52 }: { agent: Pick<AgentView, "name" | "voiceName" | "avatarSeed">; size?: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[8px] shadow-sm ${avatarBackground(agent.name)}`}
      style={{ width: size, height: size }}
      aria-label={`${agent.name} avatar`}
      role="img"
    >
      <VoiceVoxel voiceName={agent.avatarSeed || `${agent.name}-${agent.voiceName}`} size={Math.round(size * 0.78)} />
    </span>
  );
}

function AgentStat({ icon: Icon, value, label }: { icon: typeof Workflow; value: number | string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={`${label}: ${value}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="tabular-nums">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function AgentCard({ agent, onSelect, inboundLive }: { agent: AgentView; onSelect: () => void; inboundLive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex min-h-24 w-full items-center gap-4 border-b border-border px-4 py-4 text-left transition-colors hover:bg-[#fff8e5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-amber-border)]"
    >
      <VoxelAvatar agent={agent} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{agent.name}</span>
          {inboundLive && (
            <span className="inline-flex shrink-0 items-center gap-1 border border-border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              <span className="size-1.5 rounded-full bg-foreground" aria-hidden="true" />
              Inbound
            </span>
          )}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground" title={`${agent.role} · ${displayDate(agent.updatedAt)}`}>
          {agent.role} · {displayDate(agent.updatedAt)}
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-3 sm:flex">
        <AgentStat icon={GitBranch} value={agent.campaignCount} label="Campaigns" />
        <AgentStat icon={Workflow} value={agent.workflowNodes} label="Workflow nodes" />
        <AgentStat icon={PhoneCall} value={agent.callCount} label="Calls" />
        <AgentStat icon={RefreshCw} value={`v${agent.version}`} label="Version" />
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
    </button>
  );
}

function CreateAgentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [voiceName, setVoiceName] = useState("Priya");
  const [language, setLanguage] = useState("Hinglish");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ agent: { id: string } }>("/api/agents", {
        method: "POST",
        skipModel: true,
        body: { name: trimmedName, role: role.trim(), voiceName: voiceName.trim(), language: language.trim() },
      });
      setName("");
      setRole("");
      onOpenChange(false);
      onCreated(res.agent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create agent.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} autoComplete="off">
          <DialogHeader>
            <DialogTitle>Create Agent</DialogTitle>
            <DialogDescription>Create a reusable voice identity, then configure it in the editor.</DialogDescription>
          </DialogHeader>
          <div className="mt-5 space-y-4">
            <label className="grid gap-1.5 text-sm font-medium">
              Name
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer Service Agent" autoFocus autoComplete="off" data-1p-ignore data-lpignore="true" />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Role
              <Input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Customer support" autoComplete="off" data-1p-ignore data-lpignore="true" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Voice name
                <Input value={voiceName} onChange={(event) => setVoiceName(event.target.value)} autoComplete="off" data-1p-ignore data-lpignore="true" />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Language
                <Input value={language} onChange={(event) => setLanguage(event.target.value)} autoComplete="off" data-1p-ignore data-lpignore="true" />
              </label>
            </div>
            {error && <p className="text-sm text-foreground">{error}</p>}
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="submit"
              disabled={!name.trim() || saving}
              className="border-[var(--brand-amber-border)] bg-[var(--brand-amber)] text-[var(--brand-amber-foreground)] hover:bg-[var(--brand-amber-hover)]"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Create Agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


function sameAgent(a?: string | null, b?: string | null): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}





export function AgentsLibraryPage() {
  const router = useRouter();
  const { datasetId } = useDataset();
  const [campaignAgents, setCampaignAgents] = useState<AgentView[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [liveInboundAgentName, setLiveInboundAgentName] = useState<string | null>(null);

  const refreshInbound = useCallback(() => {
    apiFetch<{ live: boolean; agentName: string | null }>("/api/inbound-agent", { skipModel: true })
      .then((s) => setLiveInboundAgentName(s.live ? s.agentName : null))
      .catch(() => setLiveInboundAgentName(null));
  }, []);
  useEffect(() => { refreshInbound(); }, [refreshInbound]);

  const loadAgents = useCallback(() => {
    setLoading(true);
    setError(false);
    apiFetch<{ agents?: AgentApi[] }>("/api/agents", { skipModel: true, datasetId })
      .then((response) => setCampaignAgents((response.agents ?? []).map(agentToView)))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [datasetId]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const agents = campaignAgents;

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="w-full px-5 py-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Agents</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Manage reusable voice identities independently from campaigns.</p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-10 border-[var(--brand-amber-border)] bg-[var(--brand-amber)] px-4 text-[var(--brand-amber-foreground)] hover:bg-[var(--brand-amber-hover)]"
          >
            <Plus className="size-4" aria-hidden="true" />
            Create Agent
          </Button>
        </header>

        <section className="mt-5 border border-border bg-background" aria-labelledby="agents-list-title">
          <div className="border-b border-border px-5 py-5">
            <h2 id="agents-list-title" className="text-base font-semibold">Your Agents</h2>
            <p className="mt-1 text-sm text-muted-foreground">Manage, customize, and evaluate your organization&apos;s agents.</p>
          </div>

          {loading ? (
            <div className="grid min-h-52 place-items-center text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Loading agents…</span>
            </div>
          ) : error ? (
            <div className="grid min-h-52 place-items-center px-6 text-center">
              <div>
                <p className="text-sm font-medium">Could not load agents</p>
                <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={loadAgents}>Retry</Button>
              </div>
            </div>
          ) : agents.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-6 text-center">
              <div>
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#fff1bd] text-[#7a4a00]"><Bot className="size-5" /></span>
                <h3 className="mt-4 text-sm font-semibold">Create your first agent</h3>
                <p className="mt-1 text-sm text-muted-foreground">Build a reusable voice identity before attaching it to a campaign.</p>
                <Button
                  className="mt-4 border-[var(--brand-amber-border)] bg-[var(--brand-amber)] text-[var(--brand-amber-foreground)] hover:bg-[var(--brand-amber-hover)]"
                  onClick={() => setCreateOpen(true)}
                >
                  Create Agent
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid lg:grid-cols-2 2xl:grid-cols-3">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onSelect={() => router.push(`/agents/${agent.id}`)}
                  inboundLive={sameAgent(liveInboundAgentName, agent.name)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <CreateAgentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => router.push(`/agents/${id}`)}
      />
    </div>
  );
}
