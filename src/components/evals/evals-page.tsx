"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AudioLines,
  Bolt,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Loader2,
  Plus,
  RotateCw,
  Sparkles,
  Target,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useDataset } from "@/lib/dataset-context";
import type {
  VoiceEvalAgent,
  VoiceEvalCategory,
  VoiceEvalResult,
  VoiceEvalWorkbench,
} from "@/lib/voice-evals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { EvalResultDialog } from "@/components/evals/eval-result-dialog";

interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  callCount: number;
}

interface DashboardData {
  agents: VoiceEvalAgent[];
  workbenches: VoiceEvalWorkbench[];
  results: VoiceEvalResult[];
  campaigns: CampaignSummary[];
}

const CATEGORY_LABEL: Record<VoiceEvalCategory, string> = {
  voice: "Voice",
  support: "Support",
  sales: "Sales",
  scheduling: "Scheduling",
  quality: "Quality",
  compliance: "Compliance",
};

const CATEGORY_STYLES: Record<VoiceEvalCategory, string> = {
  voice: "border-violet-200 bg-violet-50 text-violet-700",
  support: "border-sky-200 bg-sky-50 text-sky-700",
  sales: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  scheduling: "border-indigo-200 bg-indigo-50 text-indigo-700",
  quality: "border-amber-200 bg-amber-50 text-amber-800",
  compliance: "border-rose-200 bg-rose-50 text-rose-700",
};

function emptyDashboard(): DashboardData {
  return { agents: [], workbenches: [], results: [], campaigns: [] };
}

function TypeBadge({ agent }: { agent: VoiceEvalAgent }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-cyan-700">
      {agent.inputType === "audio" ? <AudioLines className="size-3" /> : <FileText className="size-3" />}
      {agent.inputType}
    </span>
  );
}

function CategoryBadge({ category }: { category: VoiceEvalCategory }) {
  return (
    <span className={cn("rounded-[2px] border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.15em]", CATEGORY_STYLES[category])}>
      {CATEGORY_LABEL[category]}
    </span>
  );
}

export function EvalsPage() {
  const { datasetId } = useDataset();
  const [tab, setTab] = useState<"evals" | "agents">("evals");
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const dashboard = await apiFetch<DashboardData>("/api/evals", { datasetId });
      setData(dashboard);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load evals.");
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => { void load(); }, [load]);

  const quickRun = async (workbenchId: string) => {
    setRunningId(workbenchId);
    setError("");
    try {
      await apiFetch("/api/evals/quick-run", {
        method: "POST",
        body: { workbenchId, limit: 20 },
        datasetId,
      });
      window.setTimeout(() => void load(), 1200);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Could not queue the eval run.");
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-[#fbfaf7]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/80 bg-background px-4">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="size-5" strokeWidth={1.7} />
          <h1 className="text-[16.2px] font-semibold tracking-[-0.025em]">Evals</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => data.workbenches[0] && void quickRun(data.workbenches[0].id)} disabled={!data.workbenches.length || Boolean(runningId)}>
            {runningId ? <Loader2 className="animate-spin" /> : <Bolt />}
            Quick run
          </Button>
          <Button onClick={() => setWorkbenchOpen(true)}><Plus />New workbench</Button>
        </div>
      </header>

      <div className="shrink-0 border-b border-border/80 bg-background px-6">
        <div className="flex h-12 items-center gap-2">
          <TabButton selected={tab === "evals"} onClick={() => setTab("evals")}>Evals</TabButton>
          <TabButton selected={tab === "agents"} onClick={() => setTab("agents")}>Eval agents</TabButton>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="mx-auto mt-5 flex max-w-6xl items-center justify-between border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <span>{error}</span><Button size="sm" variant="ghost" onClick={() => void load()}><RotateCw />Retry</Button>
          </div>
        )}
        {loading ? (
          <div className="flex h-[60vh] items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
        ) : tab === "evals" ? (
          <WorkbenchView
            data={data}
            runningId={runningId}
            onNew={() => setWorkbenchOpen(true)}
            onRun={(id) => void quickRun(id)}
            onBrowse={() => setTab("agents")}
          />
        ) : (
          <AgentLibrary agents={data.agents} onNew={() => setAgentOpen(true)} />
        )}
      </main>

      <WorkbenchDialog
        open={workbenchOpen}
        onOpenChange={setWorkbenchOpen}
        agents={data.agents}
        campaigns={data.campaigns}
        datasetId={datasetId}
        onSaved={load}
      />
      <AgentDialog
        open={agentOpen}
        onOpenChange={setAgentOpen}
        datasetId={datasetId}
        onSaved={load}
      />
    </div>
  );
}

function TabButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative h-10 border px-3 text-[9.9px] font-semibold uppercase tracking-[0.04em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        selected ? "border-[#c8c7c0] bg-[#dfded8] text-foreground" : "border-[#d8d7d0] bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function WorkbenchView({
  data,
  runningId,
  onNew,
  onRun,
  onBrowse,
}: {
  data: DashboardData;
  runningId: string | null;
  onNew: () => void;
  onRun: (id: string) => void;
  onBrowse: () => void;
}) {
  return (
    <div className="w-full pb-10">
      <section className="flex min-h-[410px] flex-col justify-center overflow-hidden border-y border-[#d8deed] bg-gradient-to-r from-[#e8f3ff] via-[#eef2ff] to-[#f4eaff] px-6 text-center shadow-[0_1px_0_rgba(20,30,60,0.03)] sm:px-12">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full border border-violet-200 bg-white/75 text-violet-600 shadow-sm">
          <ClipboardCheck className="size-5" />
        </div>
        <h2 className="text-balance text-3xl font-semibold tracking-[-0.045em] text-[#10131a]">Define what good calls sound like.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-[13.5px] leading-6 text-[#5e6677]">
          Build workbenches from opinionated eval agents, run them on real calls, and see which behaviors are helping or hurting quality.
        </p>
        <div className="mt-7 flex justify-center gap-3">
          <Button onClick={onNew}>New workbench</Button>
          <Button variant="ghost" onClick={onBrowse}>Browse eval agents <ChevronRight /></Button>
        </div>
      </section>

      <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 border border-border bg-background [&>div]:min-h-[196px] sm:grid-cols-3">
        <Feature icon={AudioLines} title="Grade audio experience" text="Judge clarity, pacing, interruptions, and whether the call felt usable." className="bg-violet-50/50" />
        <Feature icon={FileText} title="Score behavior" text="Measure discovery, empathy, objections, resolution, and adherence." className="border-y border-border bg-sky-50/40 sm:border-x sm:border-y-0" />
        <Feature icon={Target} title="Quantify patterns" text="Turn recurring failure modes into stable evaluators across every call." />
      </div>

      {data.workbenches.length > 0 && (
        <section className="mx-auto mt-12 max-w-4xl">
          <div className="mb-4 flex items-end justify-between">
            <div><h3 className="text-xl font-semibold tracking-[-0.03em]">Active workbenches</h3><p className="mt-1 text-sm text-muted-foreground">Every completed call is automatically evaluated against matching workbenches.</p></div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.workbenches.map((workbench) => (
              <WorkbenchCard key={workbench.id} workbench={workbench} data={data} running={runningId === workbench.id} onRun={() => onRun(workbench.id)} />
            ))}
          </div>
        </section>
      )}

      {data.results.length > 0 && <div className="mx-auto max-w-4xl"><RecentEvaluations data={data} /></div>}

      <section className="mx-auto mt-11 max-w-4xl pb-10">
        <div className="mb-4 flex items-end justify-between">
          <div><h3 className="text-xl font-semibold tracking-[-0.03em]">Built-in eval agents</h3><p className="mt-1 text-sm text-muted-foreground">Start with focused measures, then add only the custom checks your team needs.</p></div>
          <Button variant="ghost" size="sm" onClick={onBrowse}>View all <ChevronRight /></Button>
        </div>
        <div className="divide-y divide-border border border-border bg-background">
          {data.agents.filter((agent) => agent.source === "built_in").slice(0, 7).map((agent) => <AgentRow key={agent.id} agent={agent} />)}
        </div>
      </section>
    </div>
  );
}

function RecentEvaluations({ data }: { data: DashboardData }) {
  const [selectedResults, setSelectedResults] = useState<VoiceEvalResult[]>([]);
  const rows = useMemo(() => {
    const groups = new Map<string, VoiceEvalResult[]>();
    for (const result of data.results) {
      const key = `${result.workbenchId}:${result.callId}`;
      const current = groups.get(key) ?? [];
      current.push(result);
      groups.set(key, current);
    }
    return Array.from(groups.values())
      .sort((a, b) => b[0].createdAt.localeCompare(a[0].createdAt))
      .slice(0, 12);
  }, [data.results]);
  const campaignNames = new Map(data.campaigns.map((campaign) => [campaign.id, campaign.name]));
  const workbenchNames = new Map(data.workbenches.map((workbench) => [workbench.id, workbench.name]));
  return (
    <section className="mt-12">
      <div className="mb-4"><h3 className="text-xl font-semibold tracking-[-0.03em]">Recent call evaluations</h3><p className="mt-1 text-sm text-muted-foreground">Post-call results from your active workbenches.</p></div>
      <div className="overflow-x-auto border border-border bg-background">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-muted/35 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <tr><th className="px-4 py-3">Call</th><th className="px-4 py-3">Campaign</th><th className="px-4 py-3">Workbench</th><th className="px-4 py-3">Checks</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Evaluated</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((results) => {
              const first = results[0];
              const failures = results.filter((result) => result.verdict === "fail").length;
              const passes = results.filter((result) => result.verdict === "pass").length;
              const scored = results.filter((result) => result.score !== null);
              const score = scored.length ? Math.round(scored.reduce((sum, result) => sum + (result.score ?? 0), 0) / scored.length) : null;
              return (
                <tr
                  key={`${first.workbenchId}:${first.callId}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedResults(results)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedResults(results); }}
                  className="cursor-pointer hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
                >
                  <td className="max-w-40 truncate px-4 py-3 font-mono text-xs">{first.callId}</td>
                  <td className="max-w-44 truncate px-4 py-3">{campaignNames.get(first.campaignId) ?? first.campaignId}</td>
                  <td className="max-w-44 truncate px-4 py-3">{workbenchNames.get(first.workbenchId) ?? (first.workbenchId.startsWith("agent-test:") ? "Agent quick run" : "Archived workbench")}</td>
                  <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 text-xs font-medium", failures ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>{failures ? `${failures} failed` : `${passes}/${results.length} passed`}</span></td>
                  <td className="px-4 py-3 font-semibold tabular-nums">{score ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(first.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <EvalResultDialog results={selectedResults} open={selectedResults.length > 0} onOpenChange={(value) => { if (!value) setSelectedResults([]); }} />
    </section>
  );
}

function Feature({ icon: Icon, title, text, className }: { icon: typeof AudioLines; title: string; text: string; className?: string }) {
  return (
    <div className={cn("p-5", className)}>
      <Icon className="mb-4 size-5 text-violet-600" strokeWidth={1.7} />
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-2 text-[11.7px] leading-5 text-muted-foreground">{text}</p>
    </div>
  );
}

function WorkbenchCard({ workbench, data, running, onRun }: { workbench: VoiceEvalWorkbench; data: DashboardData; running: boolean; onRun: () => void }) {
  const results = data.results.filter((result) => result.workbenchId === workbench.id);
  const calls = new Set(results.map((result) => result.callId)).size;
  const scored = results.filter((result) => result.score !== null);
  const average = scored.length ? Math.round(scored.reduce((sum, result) => sum + (result.score ?? 0), 0) / scored.length) : null;
  const campaignLabel = workbench.campaignIds.length === 0 ? "All campaigns" : `${workbench.campaignIds.length} campaign${workbench.campaignIds.length === 1 ? "" : "s"}`;
  return (
    <article className="group border border-border bg-background p-5 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-foreground/25 hover:shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0"><h4 className="truncate text-[13.5px] font-semibold">{workbench.name}</h4><p className="mt-1 line-clamp-2 text-[11.7px] leading-5 text-muted-foreground">{workbench.description || "A reusable quality scorecard for completed calls."}</p></div>
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">Active</span>
      </div>
      <div className="mt-5 grid grid-cols-3 divide-x divide-border border-y border-border py-3 text-center">
        <Metric value={String(workbench.evalAgentIds.length)} label="Evaluators" />
        <Metric value={String(calls)} label="Calls" />
        <Metric value={average === null ? "—" : `${average}`} label="Avg score" />
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground"><span>{campaignLabel}</span><Button size="sm" variant="outline" onClick={onRun} disabled={running}>{running ? <Loader2 className="animate-spin" /> : <Bolt />}Run recent calls</Button></div>
    </article>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div><p className="text-lg font-semibold tracking-[-0.03em]">{value}</p><p className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p></div>;
}

function AgentLibrary({ agents, onNew }: { agents: VoiceEvalAgent[]; onNew: () => void }) {
  const grouped = useMemo(() => {
    return agents.reduce<Record<string, VoiceEvalAgent[]>>((acc, agent) => {
      (acc[agent.category] ??= []).push(agent);
      return acc;
    }, {});
  }, [agents]);
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-9">
      <div className="mb-7 flex items-end justify-between">
        <div><h2 className="text-2xl font-semibold tracking-[-0.04em]">Eval agents</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Reusable judges with one clear responsibility. Built-ins are ready to use; custom agents encode the standards unique to your team.</p></div>
        <Button onClick={onNew}><Plus />New eval agent</Button>
      </div>
      <div className="space-y-8">
        {Object.entries(grouped).map(([category, items]) => (
          <section key={category}>
            <div className="mb-2 flex items-center gap-2"><CategoryBadge category={category as VoiceEvalCategory} /><span className="text-xs text-muted-foreground">{items.length}</span></div>
            <div className="divide-y divide-border border border-border bg-background">{items.map((agent) => <AgentRow key={agent.id} agent={agent} />)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent }: { agent: VoiceEvalAgent }) {
  return (
    <Link href={`/evals/agents/${encodeURIComponent(agent.id)}`} className="flex items-start gap-4 px-5 py-4 transition-[background-color,transform] duration-150 hover:bg-muted/25 active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><p className="text-[12.6px] font-semibold">{agent.name}</p><TypeBadge agent={agent} />{agent.source === "custom" && <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Custom</span>}</div>
        <p className="mt-1.5 text-[11.7px] leading-5 text-muted-foreground">{agent.description}</p>
      </div>
      <CategoryBadge category={agent.category} />
    </Link>
  );
}

function WorkbenchDialog({ open, onOpenChange, agents, campaigns, datasetId, onSaved }: { open: boolean; onOpenChange: (value: boolean) => void; agents: VoiceEvalAgent[]; campaigns: CampaignSummary[]; datasetId: string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toggle = (value: string, list: string[], setList: (value: string[]) => void) => setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const save = async () => {
    if (!name.trim() || selectedAgents.length === 0) { setError("Add a name and select at least one eval agent."); return; }
    setSaving(true); setError("");
    try {
      await apiFetch("/api/evals", { method: "POST", datasetId, body: { kind: "workbench", name, description, evalAgentIds: selectedAgents, campaignIds: selectedCampaigns } });
      setName(""); setDescription(""); setSelectedAgents([]); setSelectedCampaigns([]); onOpenChange(false); await onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save workbench."); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 py-5"><DialogTitle>New workbench</DialogTitle><DialogDescription>Choose the evaluators that should run automatically after matching calls.</DialogDescription></DialogHeader>
        <div className="space-y-6 overflow-y-auto px-6 py-5">
          <Field label="Name"><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Sales call quality" /></Field>
          <Field label="Description"><Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this scorecard is designed to measure" /></Field>
          <Field label="Eval agents" hint={`${selectedAgents.length} selected`}>
            <div className="max-h-64 divide-y divide-border overflow-y-auto border border-border">
              {agents.map((agent) => (
                <button key={agent.id} type="button" onClick={() => toggle(agent.id, selectedAgents, setSelectedAgents)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30">
                  <span className={cn("flex size-4 shrink-0 items-center justify-center border", selectedAgents.includes(agent.id) ? "border-foreground bg-foreground text-background" : "border-input bg-background")}>{selectedAgents.includes(agent.id) && <Check className="size-3" />}</span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{agent.name}</span><span className="block truncate text-xs text-muted-foreground">{agent.description}</span></span>
                  <CategoryBadge category={agent.category} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Campaign scope" hint={selectedCampaigns.length === 0 ? "All campaigns" : `${selectedCampaigns.length} selected`}>
            <div className="grid gap-2 sm:grid-cols-2">
              {campaigns.map((campaign) => (
                <button key={campaign.id} type="button" onClick={() => toggle(campaign.id, selectedCampaigns, setSelectedCampaigns)} className={cn("flex items-center gap-3 border px-3 py-3 text-left transition-colors", selectedCampaigns.includes(campaign.id) ? "border-foreground bg-muted/60" : "border-border bg-background hover:bg-muted/30")}>
                  <span className={cn("flex size-4 items-center justify-center border", selectedCampaigns.includes(campaign.id) ? "border-foreground bg-foreground text-background" : "border-input")}>{selectedCampaigns.includes(campaign.id) && <Check className="size-3" />}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{campaign.name}</span><span className="text-xs text-muted-foreground">{campaign.callCount} calls</span></span>
                </button>
              ))}
              {campaigns.length === 0 && <p className="col-span-2 border border-dashed border-border p-4 text-sm text-muted-foreground">No campaigns yet. Leave this empty and the workbench will apply to all future campaigns.</p>}
            </div>
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="border-t border-border px-6 py-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="animate-spin" />}Create workbench</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentDialog({ open, onOpenChange, datasetId, onSaved }: { open: boolean; onOpenChange: (value: boolean) => void; datasetId: string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<VoiceEvalCategory>("quality");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!name.trim() || !description.trim() || !prompt.trim()) { setError("Complete all fields before saving."); return; }
    setSaving(true); setError("");
    try {
      await apiFetch("/api/evals", { method: "POST", datasetId, body: { kind: "eval_agent", name, description, prompt, inputType: "text", category } });
      setName(""); setDescription(""); setPrompt(""); onOpenChange(false); await onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save eval agent."); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>New eval agent</DialogTitle><DialogDescription>Give this judge one clear responsibility and an evidence-based passing standard.</DialogDescription></DialogHeader>
        <div className="space-y-4 py-2">
          <Field label="Name"><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Consent confirmation" /></Field>
          <Field label="Description"><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Checks whether the customer explicitly consented" /></Field>
          <Field label="Category"><select value={category} onChange={(event) => setCategory(event.target.value as VoiceEvalCategory)} className="h-9 w-full border border-input bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20">{Object.entries(CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Evaluation instruction"><Textarea className="min-h-32" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Pass only when… Fail when… Return not applicable when…" /></Field>
          <div className="flex gap-3 border border-violet-200 bg-violet-50/60 p-3 text-xs leading-5 text-violet-900"><Sparkles className="mt-0.5 size-4 shrink-0" /><span>Strong evaluators say what counts as pass, fail, insufficient evidence, and not applicable.</span></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="animate-spin" />}Create eval agent</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 flex items-center justify-between text-sm font-medium"><span>{label}</span>{hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}</span>{children}</label>;
}
