"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  GitBranch,
  Languages,
  Loader2,
  Mic2,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  Workflow,
} from "lucide-react";
import {
  type VoiceAgentBuildArtifactEvent,
  type VoiceAgentBuildEvent,
  type VoiceAgentGenerationCardData,
} from "@/lib/voice-agent-generation-types";

interface VoiceAgentGenerationCardProps {
  data: VoiceAgentGenerationCardData;
  onRegenerate: () => void;
  onRefine: () => void;
}

export function VoiceAgentGenerationCard({ data, onRegenerate, onRefine }: VoiceAgentGenerationCardProps) {
  const result = data.result;
  const reviewCount = (data.buildEvents ?? []).filter((event) => event.type === "review").length;

  return (
    <section className="w-full space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center border border-border bg-card">
            <Mic2 className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {result?.agentName || "Creating voice agent"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {result?.segment.name || data.segmentName || "Audience selection required"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {reviewCount > 0 && (
            <span className="border border-[#dfcfaf] bg-[#fff8e8] px-2 py-1 text-[9.9px] font-medium text-[#8b642c]">
              Review {reviewCount}
            </span>
          )}
          {data.status === "created" && (
            <span className="border border-[#b9cfb9] bg-[#edf5ed] px-2 py-1 text-[9.9px] font-medium text-[#426142]">
              Draft saved
            </span>
          )}
        </div>
      </div>

      <BuildTranscript data={data} />

      {data.status === "created" && result && (
        <div className="border border-border bg-card">
          <div className="border-b border-border bg-[#f7f5f1] px-4 py-3">
            <p className="text-sm font-semibold">{result.agentName} — built and saved</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{result.summary}</p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
            <Summary icon={Users} label="Audience" value={`${result.segment.userCount.toLocaleString()} people`} />
            <Summary icon={Workflow} label="Workflow" value={`${result.workflow.nodeCount} nodes`} />
            <Summary icon={SlidersHorizontal} label="Routes" value={`${result.workflow.routeCount} total`} />
            <Summary icon={Languages} label="Language / voice" value={`${result.language} · ${result.voiceName || result.voice}`} />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
            <Link
              href={result.openUrl}
              className="inline-flex h-9 items-center gap-2 border border-foreground bg-foreground px-3.5 text-sm font-medium text-background transition-[transform,opacity] duration-150 ease-out active:scale-[0.97] hover:opacity-85"
            >
              Open Agent
              <ExternalLink className="size-3.5" />
            </Link>
            <button
              type="button"
              onClick={onRegenerate}
              className="inline-flex h-9 items-center gap-2 border border-border bg-card px-3.5 text-sm font-medium transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] hover:bg-muted"
            >
              <RotateCcw className="size-3.5" />
              Regenerate
            </button>
            <button
              type="button"
              onClick={onRefine}
              className="inline-flex h-9 items-center gap-2 px-2 text-sm font-medium text-muted-foreground transition-[transform,color] duration-150 ease-out active:scale-[0.97] hover:text-foreground"
            >
              Refine with a prompt
            </button>
            <span className="ml-auto text-xs text-muted-foreground">
              {result.workflow.universalRouteCount} universal routes
            </span>
          </div>
        </div>
      )}

      {data.status === "error" && (
        <div className="flex items-start gap-3 border border-border bg-card px-4 py-4">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Agent creation stopped</p>
            <p className="mt-1 text-sm text-muted-foreground">{data.error || "Please try again."}</p>
          </div>
          <button
            type="button"
            onClick={onRegenerate}
            className="h-8 shrink-0 border border-border bg-card px-3 text-sm font-medium transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] hover:bg-muted"
          >
            {data.segmentId ? "Retry" : "Choose audience"}
          </button>
        </div>
      )}
    </section>
  );
}

function BuildTranscript({ data }: { data: VoiceAgentGenerationCardData }) {
  const events = data.buildEvents ?? [];
  const artifactIndexes = new Map<string, number>();
  let artifactCount = 0;
  for (const event of events) {
    if (event.type === "artifact") artifactIndexes.set(event.id, artifactCount++);
  }

  if (events.length === 0 && data.status !== "generating") return null;

  return (
    <div className="space-y-3">
      {data.status === "generating" && (
        <div className="flex items-start gap-2">
          <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
          <div>
            <p className="text-sm font-medium">{data.currentStatus?.title || "Generating voice agent"}</p>
            {data.currentStatus?.detail && (
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{data.currentStatus.detail}</p>
            )}
          </div>
        </div>
      )}

      {events.map((event) => (
        <BuildEvent
          key={`${event.type}-${event.id}`}
          event={event}
          defaultOpen={event.type === "artifact" && (artifactIndexes.get(event.id) ?? 99) < 2}
        />
      ))}
    </div>
  );
}

function BuildEvent({ event, defaultOpen }: { event: VoiceAgentBuildEvent; defaultOpen: boolean }) {
  if (event.type === "narrative") {
    return <p className="max-w-3xl whitespace-pre-wrap text-[13.5px] leading-7 text-foreground">{event.content}</p>;
  }

  if (event.type === "plan") {
    return (
      <div className="py-1">
        <p className="text-base leading-7">{event.summary}</p>
        <ol className="mt-3 space-y-1.5">
          {event.nodes.map((node, index) => (
            <li key={node.id} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 text-sm">
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
              <span><strong>{node.title}</strong> <span className="text-muted-foreground">({node.kind}) — {node.summary}</span></span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (event.type === "activity") {
    return (
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        {event.status === "running" ? (
          <Loader2 className="size-3.5 animate-spin text-foreground" />
        ) : (
          <Check className="size-3.5 text-[#5f805f]" />
        )}
        <span>{event.label}</span>
      </div>
    );
  }

  if (event.type === "artifact") {
    return <ArtifactChange event={event} defaultOpen={defaultOpen} />;
  }

  if (event.type === "validation") {
    const passed = event.status === "passed";
    const repairing = event.status === "repairing";
    return (
      <div className="border border-border bg-card">
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            {passed ? <ShieldCheck className="size-4 text-[#5f805f]" /> : <TriangleAlert className="size-4 text-[#9a6b27]" />}
            Workflow validation
          </div>
          <span className={passed ? "text-xs text-[#5f805f]" : "text-xs text-[#9a6b27]"}>
            {passed ? "Passed" : repairing ? "Repairing" : event.status}
          </span>
        </div>
        {event.issues.length > 0 && (
          <ul className="border-t border-border px-4 py-3 text-xs leading-5 text-muted-foreground">
            {event.issues.map((issue) => <li key={issue}>• {issue}</li>)}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 border border-[#dfcfaf] bg-[#fff8e8] px-3.5 py-3">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#8b642c]" />
      <div>
        <p className="text-sm font-medium">{event.label}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{event.description}</p>
      </div>
      <span className="ml-auto shrink-0 text-[9px] font-semibold uppercase tracking-[0.06em] text-[#8b642c]">
        Review
      </span>
    </div>
  );
}

function ArtifactChange({ event, defaultOpen }: { event: VoiceAgentBuildArtifactEvent; defaultOpen: boolean }) {
  const ArtifactIcon = event.kind === "edge" || event.kind === "universal_route" ? GitBranch : FileText;
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="group border border-border bg-card" open={open} onToggle={(toggleEvent) => setOpen(toggleEvent.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-transparent px-3.5 py-2.5 group-open:border-border group-open:bg-[#f3f7ef]">
        <ChevronDown className="size-3.5 shrink-0 -rotate-90 transition-transform duration-150 ease-out group-open:rotate-0" />
        <ArtifactIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{event.path}</span>
        <span className="text-xs text-[#5f805f]">+{event.additions}</span>
        <span className="size-1.5 bg-[#5f805f]" />
        <span className="text-xs text-muted-foreground capitalize">{event.change}</span>
      </summary>
      <div className="px-4 py-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">All changes · {event.title}</p>
        <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{event.content}</div>
      </div>
    </details>
  );
}

function Summary({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[9.9px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <p className="mt-1.5 truncate text-sm font-semibold" title={value}>{value}</p>
    </div>
  );
}
