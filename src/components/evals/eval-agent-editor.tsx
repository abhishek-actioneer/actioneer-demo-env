"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  AudioLines,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  History,
  ListFilter,
  Loader2,
  Play,
  Plus,
  Save,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useDataset } from "@/lib/dataset-context";
import {
  DEFAULT_VOICE_EVAL_CONTEXT_SOURCES,
  DEFAULT_VOICE_EVAL_SCORE_LEVELS,
  DEFAULT_VOICE_EVAL_SYSTEM_PROMPT,
  VOICE_EVAL_CONTEXT_SOURCES,
  type VoiceEvalAgent,
  type VoiceEvalInputType,
  type VoiceEvalResult,
  type VoiceEvalScoreLevel,
} from "@/lib/voice-evals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { EvalResultDialog } from "@/components/evals/eval-result-dialog";

interface EvalsResponse {
  agents: VoiceEvalAgent[];
  results: VoiceEvalResult[];
  calls: EvalCallSummary[];
}

interface EvalCallSummary {
  id: string;
  campaignId: string;
  campaignName: string;
  agentName: string;
  status: "completed" | "failed" | "no_answer";
  toNumber: string;
  durationSeconds: number;
  startedAt: string | null;
  endedAt: string | null;
  hasRecording: boolean;
  issueCount: number;
}

const SCORE_COLORS: Record<VoiceEvalScoreLevel["color"], string> = {
  red: "bg-[#e51d3b]",
  yellow: "bg-[#f2b705]",
  green: "bg-[#14b87a]",
  gray: "bg-[#9b9b96]",
};

export function EvalAgentEditor() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { datasetId } = useDataset();
  const agentId = decodeURIComponent(params.id);
  const [agent, setAgent] = useState<VoiceEvalAgent | null>(null);
  const [results, setResults] = useState<VoiceEvalResult[]>([]);
  const [calls, setCalls] = useState<EvalCallSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [inputType, setInputType] = useState<VoiceEvalInputType>("text");
  const [contextSources, setContextSources] = useState<string[]>(DEFAULT_VOICE_EVAL_CONTEXT_SOURCES);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_VOICE_EVAL_SYSTEM_PROMPT);
  const [task, setTask] = useState("");
  const [scoreLevels, setScoreLevels] = useState<VoiceEvalScoreLevel[]>(DEFAULT_VOICE_EVAL_SCORE_LEVELS);
  const [callPickerOpen, setCallPickerOpen] = useState(false);
  const [selectedCallKeys, setSelectedCallKeys] = useState<string[]>([]);
  const [runningCalls, setRunningCalls] = useState(false);
  const [selectedResult, setSelectedResult] = useState<VoiceEvalResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch<EvalsResponse>("/api/evals", { datasetId });
      const found = response.agents.find((item) => item.id === agentId);
      if (!found) {
        setError("Eval agent not found.");
        return;
      }
      setAgent(found);
      setResults(response.results.filter((result) => result.evalAgentId === found.id));
      setCalls(response.calls ?? []);
      setInputType(found.inputType);
      setContextSources(found.contextSources ?? DEFAULT_VOICE_EVAL_CONTEXT_SOURCES);
      setSystemPrompt(found.systemPrompt ?? DEFAULT_VOICE_EVAL_SYSTEM_PROMPT);
      setTask(found.prompt);
      setScoreLevels(found.scoreLevels ?? DEFAULT_VOICE_EVAL_SCORE_LEVELS);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load this eval agent.");
    } finally {
      setLoading(false);
    }
  }, [agentId, datasetId]);

  useEffect(() => { void load(); }, [load]);

  const tokenCount = Math.ceil(systemPrompt.length / 4);
  const taskTokenCount = Math.ceil(task.length / 4);
  const recentResults = results.slice(0, 4);

  const saveAgent = async () => {
    if (!agent || !task.trim()) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await apiFetch<{ agent: VoiceEvalAgent }>("/api/evals", {
        method: "POST",
        datasetId,
        body: {
          kind: "eval_agent",
          ...(agent.source === "custom" ? { id: agent.id } : {}),
          name: agent.name,
          description: agent.description,
          prompt: task,
          inputType,
          category: agent.category,
          systemPrompt,
          contextSources,
          scoreLevels,
        },
      });
      setAgent(response.agent);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      if (response.agent.id !== agent.id) {
        router.replace(`/evals/agents/${encodeURIComponent(response.agent.id)}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this eval agent.");
    } finally {
      setSaving(false);
    }
  };

  const runSelectedCalls = async () => {
    if (!agent || selectedCallKeys.length === 0) return;
    const selected = calls.filter((call) => selectedCallKeys.includes(callKey(call)));
    if (selected.length === 0) return;
    setRunningCalls(true);
    setError("");
    try {
      await apiFetch("/api/evals/run", {
        method: "POST",
        datasetId,
        body: {
          evalAgentId: agent.id,
          calls: selected.map((call) => ({ campaignId: call.campaignId, callId: call.id })),
        },
      });
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Could not run the selected calls.");
    } finally {
      setRunningCalls(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center bg-[#f5f4ef] text-[#76756e]"><Loader2 className="size-5 animate-spin" /></div>;
  }

  if (!agent) {
    return <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#f5f4ef]"><p className="text-sm text-[#6f6e67]">{error || "Eval agent not found."}</p><Button variant="outline" onClick={() => router.push("/evals")}>Back to evals</Button></div>;
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-[#f5f4ef] text-[#24241f]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#d8d7d0] bg-[#faf9f5] px-1.5">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <button aria-label="Back to evals" onClick={() => router.push("/evals")} className="flex size-8 items-center justify-center rounded-[2px] text-[#77766f] transition-colors hover:bg-[#ecebe5] hover:text-[#24241f] active:scale-[0.97]">
            <ArrowLeft className="size-4" />
          </button>
          <span className="text-[#77766f]">Eval Agent</span>
          <span className="text-[#aaa9a2]">/</span>
          <span className="truncate font-semibold">{agent.name}</span>
          <span className="ml-1 border border-[#efc97a] bg-[#fff7df] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#ae7000]">Draft</span>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled variant="outline" size="sm" className="hidden border-[#d8d7d0] bg-[#faf9f5] text-[#77766f] lg:inline-flex"><Check />Saved</Button>
          <Button size="sm" className="bg-[#24241f] text-white hover:bg-black active:scale-[0.97]" onClick={() => void saveAgent()} disabled={saving || !task.trim()}>
            {saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : <Save />}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto bg-white">
          <div className="mx-auto max-w-[960px] px-5 py-8 sm:px-8 sm:py-10">
            <EditorSection title="Eval mode" description="Pick the lane this agent runs in. Each agent uses one — stand up a separate agent in the other lane if you need both kinds of evidence." meta={inputType === "text" ? "Transcript · LLM reads transcript" : "Audio · Non-LLM listens to audio"}>
              <div className="grid gap-3 sm:grid-cols-2">
                <ModeCard
                  selected={inputType === "text"}
                  icon={FileText}
                  title="Transcript"
                  eyebrow="LLM · reads transcript"
                  description="An LLM reads the speaker-labelled transcript. Best for what-was-said checks — script adherence, claims, intent, disclosures."
                  onClick={() => setInputType("text")}
                />
                <ModeCard
                  selected={inputType === "audio"}
                  icon={AudioLines}
                  title="Audio"
                  eyebrow="Non-LLM · listens to audio"
                  description="Audio-only pipeline. Best for read-back number accuracy, audio corruption or noise, tone, pace, and hesitation."
                  onClick={() => setInputType("audio")}
                />
              </div>
            </EditorSection>

            <EditorSection title="Context" description="Choose what evidence this eval agent can see when it judges a call." meta={`${contextSources.length}/18 sources`}>
              <div className="grid gap-2 sm:grid-cols-2">
                {VOICE_EVAL_CONTEXT_SOURCES.map((source) => {
                  const selected = contextSources.includes(source.id);
                  return (
                    <button
                      key={source.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setContextSources((current) => selected ? current.filter((id) => id !== source.id) : [...current, source.id])}
                      className="group flex min-h-[96px] items-start gap-3 border border-[#d8d7d0] bg-white p-4 text-left transition-[background-color,border-color,transform] duration-150 hover:border-[#bbb9b0] hover:bg-[#faf9f5] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e51d3b]/25"
                    >
                      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center border", selected ? "border-[#e51d3b] bg-[#e51d3b] text-white" : "border-[#aaa9a2] bg-white")}>
                        {selected && <Check className="size-3" strokeWidth={3} />}
                      </span>
                      <span><span className="block text-[11.7px] font-semibold">{source.name}</span><span className="mt-1.5 block text-[10.8px] leading-5 text-[#7b7a73]">{source.description}</span></span>
                    </button>
                  );
                })}
              </div>
            </EditorSection>

            <EditorSection title="System prompt" description="The judge persona and rules every transcript sees. Optional but recommended for complex graders — keeps verdicts consistent across calls." meta={`${systemPrompt.length} chars · ≈${tokenCount} tokens`}>
              <RichPromptEditor key={agent.id} initialValue={systemPrompt} onChange={setSystemPrompt} />
            </EditorSection>

            <EditorSection title="Eval task" description="The criterion this agent answers, phrased as a question to the judge. Required to publish." meta={`${task.length} chars · ≈${taskTokenCount} tokens`}>
              <div className="border border-[#d8d7d0] bg-[#efeee8] p-4">
                <Input value={agent.name} onChange={(event) => setAgent({ ...agent, name: event.target.value })} className="mb-3 h-9 border-transparent bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:border-transparent focus-visible:ring-0" aria-label="Eval agent name" />
                <Textarea value={task} onChange={(event) => setTask(event.target.value)} className="min-h-28 resize-y border-0 bg-transparent p-0 text-[11.7px] leading-6 shadow-none focus-visible:ring-0" />
              </div>
            </EditorSection>

            <EditorSection title="Scoring" description="The buckets the judge picks between, ordered worst to best. Mark one or more as the target." meta={`${scoreLevels.length} levels`}>
              <div className="divide-y divide-[#d8d7d0] border border-[#d8d7d0] bg-[#faf9f5]">
                {scoreLevels.map((level, index) => (
                  <div key={level.id} className="grid grid-cols-[38px_16px_minmax(120px,160px)_1fr_34px] items-center gap-2 px-3 py-2.5">
                    <span className="font-mono text-[9px] text-[#9b9a93]">L{index + 1}</span>
                    <span className={cn("size-3", SCORE_COLORS[level.color])} />
                    <Input value={level.label} onChange={(event) => setScoreLevels((current) => current.map((item) => item.id === level.id ? { ...item, label: event.target.value } : item))} className="h-8 border-transparent bg-transparent px-1 text-[10.8px] font-semibold focus-visible:border-[#c9c8c1] focus-visible:ring-0" />
                    <Input value={level.description} onChange={(event) => setScoreLevels((current) => current.map((item) => item.id === level.id ? { ...item, description: event.target.value } : item))} className="h-8 border-transparent bg-transparent px-1 text-[9.9px] text-[#6f6e67] focus-visible:border-[#c9c8c1] focus-visible:ring-0" />
                    <button aria-label={`Delete ${level.label} level`} disabled={scoreLevels.length <= 2} onClick={() => setScoreLevels((current) => current.filter((item) => item.id !== level.id))} className="flex size-8 items-center justify-center text-[#999891] hover:bg-[#ecebe5] hover:text-[#e51d3b] disabled:opacity-30"><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
              </div>
              <button type="button" disabled={scoreLevels.length >= 8} onClick={() => setScoreLevels((current) => [...current, { id: `level-${Date.now()}`, label: "New level", description: "Describe when the judge should choose this level.", color: "gray" }])} className="mt-3 inline-flex h-9 items-center gap-2 px-2 text-xs font-medium text-[#77766f] transition-colors hover:text-[#24241f] disabled:opacity-40"><Plus className="size-3.5" />Add level</button>
            </EditorSection>

            <details className="group mb-14 border-t border-[#d8d7d0] pt-5 text-xs text-[#77766f]">
              <summary className="flex cursor-pointer list-none items-center gap-2 font-mono uppercase tracking-[0.14em]"><ChevronDown className="size-3 transition-transform group-open:rotate-180" />Advanced · weight · intrinsic target</summary>
            </details>
            {error && <p role="alert" className="mb-8 border border-[#e51d3b]/30 bg-[#fff0f2] px-4 py-3 text-sm text-[#b20e29]">{error}</p>}
          </div>
        </main>

        <aside className="hidden w-[460px] shrink-0 border-l border-[#d8d7d0] bg-[#f7f6f1] xl:flex xl:flex-col">
          <div className="flex items-center justify-between border-b border-[#d8d7d0] px-4 py-3 font-mono text-[9px] uppercase tracking-[0.15em] text-[#8b8a83]"><span>Agent</span><span className="inline-flex items-center gap-1 normal-case tracking-normal"><History className="size-3" />History</span></div>
          <div className="p-4">
            <div className="flex items-center gap-3 border border-[#d8d7d0] bg-white p-4">
              <span className="flex size-9 items-center justify-center bg-[#c95838] text-white"><Archive className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[11.7px] font-semibold">{agent.name}</span><span className="mt-0.5 block truncate font-mono text-[8.1px] text-[#9b9a93]">{agent.id}</span></span>
              <span className="border border-[#9fc7ff] bg-[#edf5ff] px-1.5 py-0.5 font-mono text-[8.1px] font-semibold uppercase text-[#3477c7]">{inputType === "text" ? "Text" : "Audio"}</span>
            </div>
            <p className="mt-5 text-[9.9px] leading-5 text-[#7b7a73]">Runs automatically after completed calls in workbenches that include this agent. Results include a verdict, score, rationale, and cited evidence.</p>
          </div>
          <div className="min-h-0 flex-1 border-t border-[#d8d7d0]">
            <div className="flex items-center justify-between border-b border-[#d8d7d0] px-4 py-3"><span className="font-mono text-[9px] uppercase tracking-[0.15em] text-[#8b8a83]">Recent runs</span><Clock3 className="size-3.5 text-[#9b9a93]" /></div>
            <div className="max-h-64 divide-y divide-[#d8d7d0] overflow-y-auto">
              {recentResults.map((result) => <button type="button" onClick={() => setSelectedResult(result)} key={result.id} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#24241f]/15"><div className="min-w-0"><p className="truncate font-mono text-[9px]">{result.callId}</p><p className="mt-1 text-[9px] text-[#8b8a83]">{new Date(result.createdAt).toLocaleDateString()}</p></div><span className={cn("px-1.5 py-1 text-[8.1px] font-semibold uppercase", result.verdict === "pass" ? "bg-[#e9f8f2] text-[#087b53]" : result.verdict === "fail" ? "bg-[#fff0f2] text-[#c41431]" : "bg-[#ecebe5] text-[#6f6e67]")}>{result.verdict.replaceAll("_", " ")}</span></button>)}
              {recentResults.length === 0 && <div className="px-4 py-8 text-center text-[9.9px] leading-5 text-[#8b8a83]">No runs yet for this agent. Completed-call results will appear here.</div>}
            </div>
          </div>
          <div className="shrink-0 border-t border-[#d8d7d0] bg-white p-4">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[#8b8a83]">Run on</p>
            <button type="button" onClick={() => setCallPickerOpen(true)} className="flex h-11 w-full items-center justify-between border border-[#c9c8c1] bg-white px-3 text-left text-[10.8px] text-[#77766f] transition-colors hover:border-[#999891] hover:text-[#24241f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24241f]/15">
              <span>{selectedCallKeys.length > 0 ? `${selectedCallKeys.length} call${selectedCallKeys.length === 1 ? "" : "s"} selected` : "Pick calls or load a saved set"}</span>
              <ChevronDown className="size-3.5" />
            </button>
            <Button variant="outline" className="mt-3 h-11 w-full border-[#d8d7d0] bg-[#efeee8] font-mono text-[9px] uppercase tracking-[0.16em]" disabled={selectedCallKeys.length === 0 || runningCalls} onClick={() => void runSelectedCalls()}>
              {runningCalls ? <Loader2 className="animate-spin" /> : <Play />}
              {runningCalls ? "Running calls" : selectedCallKeys.length > 0 ? `Run ${selectedCallKeys.length} calls` : "Pick calls to run"}
            </Button>
          </div>
        </aside>
      </div>
      <CallPickerDialog open={callPickerOpen} onOpenChange={setCallPickerOpen} calls={calls} selectedKeys={selectedCallKeys} onConfirm={setSelectedCallKeys} />
      <EvalResultDialog results={selectedResult ? [selectedResult] : []} open={Boolean(selectedResult)} onOpenChange={(value) => { if (!value) setSelectedResult(null); }} />
    </div>
  );
}

function callKey(call: Pick<EvalCallSummary, "campaignId" | "id">): string {
  return `${call.campaignId}:${call.id}`;
}

function formatCallDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function CallPickerDialog({ open, onOpenChange, calls, selectedKeys, onConfirm }: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  calls: EvalCallSummary[];
  selectedKeys: string[];
  onConfirm: (keys: string[]) => void;
}) {
  const [draftKeys, setDraftKeys] = useState<string[]>(selectedKeys);
  const [windowDays, setWindowDays] = useState<"week" | "7" | "30">("7");
  const [sampleSize, setSampleSize] = useState<10 | 50 | 100>(10);
  const [dayType, setDayType] = useState<"all" | "business" | "non-business">("business");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (open) setDraftKeys(selectedKeys);
  }, [open, selectedKeys]);

  const cutoff = windowDays === "30" ? now - 30 * 86_400_000 : now - 7 * 86_400_000;
  const visibleCalls = calls.filter((call) => {
    const timestamp = new Date(call.endedAt ?? call.startedAt ?? 0).getTime();
    if (Number.isFinite(timestamp) && timestamp > 0 && timestamp < cutoff) return false;
    if (dayType === "all" || !timestamp) return true;
    const day = new Date(timestamp).getDay();
    return dayType === "business" ? day >= 1 && day <= 5 : day === 0 || day === 6;
  }).slice(0, sampleSize);
  const visibleKeys = visibleCalls.map(callKey);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => draftKeys.includes(key));
  const toggle = (key: string) => setDraftKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const toggleVisible = () => setDraftKeys((current) => allVisibleSelected ? current.filter((key) => !visibleKeys.includes(key)) : Array.from(new Set([...current, ...visibleKeys])));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} overlayClassName="bg-black/55" className="flex h-[86vh] max-h-[900px] w-[calc(100%-2rem)] max-w-[1240px] flex-col gap-0 overflow-hidden rounded-none border-[#d8d7d0] bg-white p-0 sm:max-w-[1240px]">
        <DialogHeader className="relative border-b border-[#d8d7d0] px-7 py-5 text-left">
          <DialogTitle className="text-2xl tracking-[-0.035em]">Pick calls to test</DialogTitle>
          <DialogDescription className="mt-1 text-[11.7px]">Reuse a saved test config, browse calls, or filter and sample a random subset.</DialogDescription>
          <button aria-label="Close call picker" onClick={() => onOpenChange(false)} className="absolute right-5 top-5 flex size-9 items-center justify-center text-[#88877f] hover:bg-[#efeee8] hover:text-[#24241f]"><X className="size-5" /></button>
        </DialogHeader>

        <div className="flex items-center gap-3 border-b border-[#d8d7d0] px-7 py-4">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#8b8a83]">Audit window</span>
          {(["week", "7", "30"] as const).map((value) => <button key={value} onClick={() => setWindowDays(value)} className={cn("h-9 border px-4 font-mono text-[9px] font-semibold uppercase tracking-[0.12em]", windowDays === value ? "border-[#24241f] bg-[#24241f] text-white" : "border-[#d8d7d0] bg-white text-[#6f6e67] hover:border-[#aaa9a2]")}>{value === "week" ? "Last full week" : `Last ${value} days`}</button>)}
          <span className="text-xs text-[#8b8a83]">Completed calls</span>
        </div>

        <div className="border-b border-[#d8d7d0] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-2"><Button variant="outline" className="border-[#d8d7d0]"><Shuffle />Quick filters <ChevronDown /></Button><Button disabled variant="outline" className="border-[#d8d7d0]"><ListFilter />Load filters</Button></div>
            <Button disabled variant="outline" className="border-[#d8d7d0]"><Plus />Add filter</Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 inline-flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-[#77766f]"><Shuffle className="size-3.5" />Sample</span>
            {([10, 50, 100] as const).map((size) => <button key={size} onClick={() => setSampleSize(size)} className={cn("h-8 min-w-12 border px-3 text-xs font-semibold", sampleSize === size ? "border-[#24241f] bg-[#24241f] text-white" : "border-[#d8d7d0] bg-white")}>{size}</button>)}
            <div className="ml-1 flex">{(["all", "business", "non-business"] as const).map((value) => <button key={value} onClick={() => setDayType(value)} className={cn("h-8 border border-r-0 px-3 text-xs font-medium last:border-r", dayType === value ? "border-[#24241f] bg-[#24241f] text-white" : "border-[#d8d7d0] bg-white text-[#6f6e67]")}>{value === "all" ? "All days" : value === "business" ? "Business days" : "Non-business days"}</button>)}</div>
            <span className="ml-1 text-xs text-[#999891]">balanced across selected days in the current filter</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[980px] table-fixed text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-[#d8d7d0] bg-[#faf9f5] text-[9.9px] font-semibold uppercase text-[#6f6e67]"><tr><th className="w-14 px-5 py-3"><input aria-label="Select visible calls" type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} className="size-4 accent-[#24241f]" /></th><th className="w-24 px-3 py-3">Recording</th><th className="w-44 px-3 py-3">ID</th><th className="w-24 px-3 py-3">Status</th><th className="w-28 px-3 py-3">Direction</th><th className="w-36 px-3 py-3">To</th><th className="px-3 py-3">Agent</th><th className="w-24 px-3 py-3">Duration</th><th className="w-20 px-3 py-3">Issues</th></tr></thead>
            <tbody className="divide-y divide-[#e3e2dc]">
              {visibleCalls.map((call) => {
                const key = callKey(call);
                return <tr key={key} className={cn("transition-colors hover:bg-[#faf9f5]", draftKeys.includes(key) && "bg-[#f3f6fa]")}><td className="px-5 py-4"><input aria-label={`Select call ${call.id}`} type="checkbox" checked={draftKeys.includes(key)} onChange={() => toggle(key)} className="size-4 accent-[#24241f]" /></td><td className="px-3 py-4 text-[#77766f]">{call.hasRecording ? "Available" : "—"}</td><td className="truncate px-3 py-4 font-mono text-xs" title={call.id}>{call.id}</td><td className="px-3 py-4"><span className="bg-[#e6e5df] px-2 py-1 text-xs capitalize">{call.status.replaceAll("_", " ")}</span></td><td className="px-3 py-4">↗ Out</td><td className="truncate px-3 py-4 font-mono text-xs">{call.toNumber}</td><td className="truncate px-3 py-4 font-medium" title={call.agentName}>{call.agentName}</td><td className="px-3 py-4 tabular-nums">{formatCallDuration(call.durationSeconds)}</td><td className="px-3 py-4 text-center">{call.issueCount || "—"}</td></tr>;
              })}
              {visibleCalls.length === 0 && <tr><td colSpan={9} className="px-6 py-20 text-center text-sm text-[#8b8a83]">No completed calls match this audit window.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-[#d8d7d0] bg-[#faf9f5] px-7 py-4">
          <div><p className="font-mono text-[9px] uppercase tracking-[0.15em] text-[#8b8a83]">Selection</p><p className="mt-1 text-sm font-semibold">{draftKeys.length} calls</p></div>
          <div className="flex gap-2"><Button disabled variant="outline" className="border-[#d8d7d0]">Save as new</Button><Button className="bg-[#24241f] font-mono text-[9.9px] uppercase tracking-[0.13em] text-white hover:bg-black" disabled={draftKeys.length === 0} onClick={() => { onConfirm(draftKeys); onOpenChange(false); }}>Use {draftKeys.length} calls</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditorSection({ title, description, meta, children }: { title: string; description: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="mb-12 border-b border-[#d8d7d0] pb-12">
      <div className="mb-6 flex items-start justify-between gap-6">
        <div><h2 className="text-[16.2px] font-semibold tracking-[-0.025em]">{title}</h2><p className="mt-1.5 max-w-[700px] text-[11.7px] leading-5 text-[#7b7a73]">{description}</p></div>
        {meta && <span className="shrink-0 pt-1 font-mono text-[8.1px] text-[#aaa9a2]">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function ModeCard({ selected, icon: Icon, title, eyebrow, description, onClick }: { selected: boolean; icon: typeof FileText; title: string; eyebrow: string; description: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cn("flex min-h-[120px] items-start gap-4 border p-4 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82d0]/25", selected ? "border-[#9ec8f7] bg-[#edf6ff]" : "border-[#d8d7d0] bg-[#eeede7] hover:bg-[#f5f4ef]")}>
      <span className={cn("flex size-8 shrink-0 items-center justify-center border bg-white", selected ? "border-[#9ec8f7] text-[#397cc5]" : "border-[#d8d7d0] text-[#87867f]")}><Icon className="size-4" /></span>
      <span><span className="flex flex-wrap items-baseline gap-2"><span className="text-[13.5px] font-semibold">{title}</span><span className="font-mono text-[8.1px] text-[#9a9992]">{eyebrow}</span></span><span className="mt-1.5 block text-[11.7px] leading-5 text-[#73726b]">{description}</span></span>
    </button>
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatInline(value: string, boldLead = false): string {
  let safe = escapeHtml(value);
  if (boldLead) {
    const colon = safe.indexOf(":");
    if (colon > 0 && colon < 80) {
      safe = `<strong>${safe.slice(0, colon + 1)}</strong>${safe.slice(colon + 1)}`;
    }
  }
  return safe.replaceAll(/\b(On-brand|Off-brand|Acceptable|Inconclusive)\b/g, "<strong>$1</strong>");
}

function promptToHtml(value: string): string {
  const headings = new Set([
    "Calibration baseline",
    "Anti-patterns to escalate",
    "Anti-patterns (cite these to escalate)",
    "What is not a defect",
    "What is NOT a defect",
    "Reasoning requirements",
    "Inconclusive (escape hatch)",
    "Insufficient evidence (different from Inconclusive)",
    "Shared context-reading guidance",
  ]);
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  const html: string[] = [];
  let listOpen = false;
  const closeList = () => {
    if (!listOpen) return;
    html.push("</ul>");
    listOpen = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("- ")) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${formatInline(line.slice(2), true)}</li>`);
      continue;
    }
    closeList();
    if (headings.has(line)) {
      html.push(`<h3>${escapeHtml(line)}</h3>`);
    } else {
      html.push(`<p>${formatInline(line)}</p>`);
    }
  }
  closeList();
  return html.join("");
}

function richPromptToText(root: HTMLDivElement): string {
  return Array.from(root.children).map((element) => {
    if (element.tagName === "UL") {
      return Array.from(element.children)
        .map((item) => `- ${(item.textContent ?? "").trim()}`)
        .join("\n");
    }
    return (element.textContent ?? "").trim();
  }).filter(Boolean).join("\n\n");
}

function RichPromptEditor({ initialValue, onChange }: { initialValue: string; onChange: (value: string) => void }) {
  const initialized = useRef(false);
  return (
    <div
      ref={(node) => {
        if (!node || initialized.current) return;
        node.innerHTML = promptToHtml(initialValue);
        initialized.current = true;
      }}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="System prompt"
      aria-multiline="true"
      spellCheck
      onInput={(event) => onChange(richPromptToText(event.currentTarget))}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
      }}
      className="min-h-[520px] border border-[#d8d7d0] bg-[#f8f7f2] px-6 py-6 text-[12.6px] leading-7 text-[#2f2f2b] outline-none transition-[border-color,box-shadow] duration-150 focus:border-[#aaa9a2] focus:ring-2 focus:ring-[#aaa9a2]/20 [&_h3]:mb-3 [&_h3]:mt-7 [&_h3]:text-[15.3px] [&_h3]:font-semibold [&_h3]:leading-6 [&_h3:first-child]:mt-0 [&_li]:mb-2 [&_li]:pl-1 [&_p]:mb-5 [&_p]:max-w-none [&_strong]:font-semibold [&_ul]:mb-6 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ul]:marker:text-[#aaa9a2]"
    />
  );
}
