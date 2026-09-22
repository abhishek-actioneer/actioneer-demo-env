"use client";

import { useState } from "react";
import {
  Check,
  Loader2,
  ChevronDown,
  CheckCircle2,
} from "lucide-react";
import type { AgentInfo, SubagentInfo, QueryInfo } from "@/lib/types";
import { MarkdownContent } from "@/lib/markdown";
import { SUBAGENT_TASKS } from "@/lib/subagent-config";
import { VoxelOrb } from "@/components/chat/voxel-orb";
import { ShimmeringText } from "@/components/ui/shimmering-text";

function deriveAgentChecklist(subagent: SubagentInfo) {
  const checklist = (SUBAGENT_TASKS[subagent.id] ?? SUBAGENT_TASKS["rev-opt"]).checklist;
  const queries = subagent.queries ?? [];
  const completedQueries = queries.filter((q) => q.rowCount != null || q.error);
  const hasSql = queries.length > 0;
  const someResults = completedQueries.length > 0;
  const allResults = queries.length > 0 && completedQueries.length === queries.length;
  const hasSummary = !!subagent.summary;
  // A completed subagent has, by definition, finished every task — mark the whole
  // checklist done so it never shows a perpetual spinner (e.g. seeded/replayed runs
  // that carry status "complete" without a per-query trace).
  const isComplete = subagent.status === "complete";

  // Each gate checks its own condition OR any later stage being done
  // (e.g. if summary exists, all prior steps must have completed)
  const stages = [hasSql, someResults, allResults, hasSummary, hasSummary];

  return checklist.map((label, idx) => ({
    label,
    checked: isComplete || stages.slice(idx).some(Boolean),
  }));
}

interface ResearchTimelineProps {
  agent: AgentInfo;
  onSubagentClick: (subagentId: string) => void;
}

// ── Derive main agent checklist states ──

function deriveMainChecklist(agent: AgentInfo) {
  const subs = agent.subagents;
  const isComplete = agent.status === "complete";
  const analysis = subs.filter((s) => s.id !== "critique");
  const critique = subs.find((s) => s.id === "critique");

  const hasSql = subs.some((s) => s.queries?.length);
  const allAnalysisResults =
    analysis.length > 0 &&
    analysis.every((s) => s.queries?.every((q) => q.rowCount != null || q.error));
  const hasSummaries = analysis.some((s) => s.summary);
  const allSummaries = analysis.length > 0 && analysis.every((s) => s.summary);
  const hasCritiqueSummary = !!critique?.summary;

  return [
    {
      label: "Read schema and understand available data structure",
      checked: isComplete || hasSql,
    },
    {
      label: `Gather initial data from specialized agents in parallel (${analysis.map((s) => s.name).join(", ")})`,
      checked: isComplete || allAnalysisResults,
    },
    {
      label: "Build and validate hypotheses from initial findings",
      checked: isComplete || hasSummaries,
    },
    {
      label: "Conduct statistical significance tests on top insights",
      checked: isComplete || allSummaries,
    },
    {
      label: "Synthesize findings and create comprehensive report with visualizations",
      checked: isComplete,
    },
    {
      label: "Get critique and refine report",
      checked: isComplete || hasCritiqueSummary,
    },
    {
      label: "Send final report to client",
      checked: isComplete,
    },
  ];
}

// ── Client-side narration ──

function getAgentNarration(sub: SubagentInfo): string | null {
  if (sub.status !== "complete" || !sub.summary) return null;
  const lines = sub.summary.split("\n");
  const bullets: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("---")) continue;
    if (/^\*\*[^*]+:\*\*$/.test(trimmed)) continue;
    if (/^[-*]\s+/.test(trimmed)) {
      const content = trimmed.replace(/^[-*]\s+/, "");
      if (content.length > 15) {
        bullets.push(content);
        if (bullets.length >= 2) break;
      }
      continue;
    }
    if (trimmed.length > 30) {
      return trimmed.length > 200 ? trimmed.slice(0, 200) + "..." : trimmed;
    }
  }
  if (bullets.length > 0) {
    const joined = bullets.join(" ");
    return joined.length > 200 ? joined.slice(0, 200) + "..." : joined;
  }
  return null;
}

// ── Main component ──

export function ResearchTimeline({
  agent,
  onSubagentClick,
}: ResearchTimelineProps) {
  const [taskCardExpanded, setTaskCardExpanded] = useState(false);
  const [detailsHidden, setDetailsHidden] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  const isComplete = agent.status === "complete";
  const analysis = agent.subagents.filter((s) => s.id !== "critique");
  const critique = agent.subagents.find((s) => s.id === "critique");
  const hasContent = agent.planText || agent.subagents.length > 0;

  const mainChecklist = deriveMainChecklist(agent);
  const completedCount = mainChecklist.filter((c) => c.checked).length;

  const toggleAgent = (id: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-t border-b border-border/30 py-3">
        {isComplete ? (
          <Check className="w-4 h-4 text-foreground/70 shrink-0" />
        ) : (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-foreground/40" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-foreground/70" />
          </span>
        )}
        <span className="text-[13.5px] font-semibold text-foreground">
          {isComplete ? "Task completed" : <ShimmeringText text="Working.." className="text-[13.5px] font-semibold" />}
        </span>
        {hasContent && (
          <button
            onClick={() => setDetailsHidden(!detailsHidden)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ml-auto transition-colors"
          >
            {detailsHidden ? "Show details" : "Hide details"}
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${detailsHidden ? "-rotate-90" : ""}`} />
          </button>
        )}
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: detailsHidden ? "0fr" : "1fr" }}
      >
        <div className="overflow-hidden">
          <div className="space-y-3">
            {agent.planText && (
              <div className="text-sm leading-relaxed animate-fade-in-up">
                {isComplete
                  ? <p className="text-foreground/80">{agent.planText}</p>
                  : <ShimmeringText text={agent.planText} className="text-sm leading-relaxed" />}
              </div>
            )}

            {agent.subagents.length > 0 && (
              <TaskProgressCard
                checklist={mainChecklist}
                completedCount={completedCount}
                total={mainChecklist.length}
                isExpanded={taskCardExpanded}
                onToggle={() => setTaskCardExpanded((v) => !v)}
                isComplete={isComplete}
              />
            )}

            <StreamZone
              analysis={analysis}
              critique={critique}
              agent={agent}
              isComplete={isComplete}
              expandedAgents={expandedAgents}
              onToggleAgent={toggleAgent}
              onSubagentClick={onSubagentClick}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Task progress card with animated progress line ──

function TaskProgressCard({
  checklist,
  completedCount,
  total,
  isExpanded,
  onToggle,
  isComplete,
}: {
  checklist: { label: string; checked: boolean }[];
  completedCount: number;
  total: number;
  isExpanded: boolean;
  onToggle: () => void;
  isComplete: boolean;
}) {
  const activeIdx = checklist.findIndex((c) => !c.checked);
  const progressPercent = total > 0 ? (completedCount / total) * 100 : 0;

  return (
    <div className="animate-fade-in-up rounded-lg bg-muted/20 border border-border/30 overflow-hidden relative">
      <button
        onClick={onToggle}
        className={`flex items-center gap-3 w-full text-left px-3.5 py-2.5 group ${
          isExpanded ? "border-b border-border/30" : ""
        }`}
      >
        <div className="shrink-0">
          {isComplete ? (
            <CheckCircle2 className="w-4 h-4 text-foreground/60" />
          ) : (
            <Loader2 className="w-4 h-4 text-foreground animate-spin" />
          )}
        </div>
        <span className="text-sm font-medium">
          {isComplete ? "Task completed" : <ShimmeringText text="Task progress" className="text-sm font-medium" />}
        </span>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {Math.round(progressPercent)}%
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0 ${
            isExpanded ? "" : "-rotate-90"
          }`}
        />
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
        <div className="px-3.5 pb-3 pt-2">
          <div className="relative ml-[7px] pl-5 space-y-1.5">
            {/* Static track */}
            <div className="absolute left-0 top-0 bottom-0 w-px bg-border/40" />
            {/* Animated fill */}
            <div
              className="absolute left-0 top-0 w-px bg-foreground/30 transition-all duration-700 ease-out"
              style={{ height: `${progressPercent}%` }}
            />
            {/* Active pulse dot at progress edge */}
            {!isComplete && activeIdx >= 0 && (
              <div
                className="absolute left-[-2.5px] w-[6px] h-[6px] rounded-full bg-foreground transition-all duration-700 ease-out"
                style={{ top: `${progressPercent}%` }}
              >
                <div className="absolute inset-0 rounded-full bg-foreground/50 animate-ping" />
              </div>
            )}

            {checklist.map((item, idx) => {
              const isCurrent = idx === activeIdx && !isComplete;
              return (
                <div key={idx} className="flex items-start gap-2.5 relative">
                  <div className={`absolute -left-5 top-[9px] w-[13px] h-px transition-colors duration-500 ${item.checked ? "bg-foreground/20" : "bg-border/30"}`} />
                  {item.checked ? (
                    <Check className="w-3.5 h-3.5 text-foreground/50 shrink-0 mt-0.5" />
                  ) : isCurrent ? (
                    <Loader2 className="w-3.5 h-3.5 text-foreground animate-spin shrink-0 mt-0.5" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/20 shrink-0 mt-0.5" />
                  )}
                  <span
                    className={`text-[11.7px] leading-relaxed transition-colors duration-300 ${
                      item.checked
                        ? "text-muted-foreground"
                        : isCurrent
                          ? "text-foreground"
                          : "text-muted-foreground/30"
                    }`}
                  >
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        </div>
      </div>

      {/* Bottom border progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-border/20">
        <div
          className="h-full bg-foreground transition-all duration-700 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}

// ── Stream zone ──

function StreamZone({
  analysis,
  critique,
  agent,
  isComplete,
  expandedAgents,
  onToggleAgent,
  onSubagentClick,
}: {
  analysis: SubagentInfo[];
  critique: SubagentInfo | undefined;
  agent: AgentInfo;
  isComplete: boolean;
  expandedAgents: Set<string>;
  onToggleAgent: (id: string) => void;
  onSubagentClick: (id: string) => void;
}) {
  const hasSql = agent.subagents.some((s) => (s.queries?.length ?? 0) > 0);
  const allQueriesDone =
    analysis.length > 0 &&
    analysis.every((s) => s.queries?.every((q) => q.rowCount != null || q.error) ?? true);
  const allSummaries =
    analysis.length > 0 && analysis.every((s) => s.summary);

  const visibleAgents = analysis.filter(
    (s) => s.status !== "pending" || isComplete
  );

  return (
    <div className="space-y-0.5">
      {/* Pre-SQL thinking */}
      {!isComplete && agent.subagents.length > 0 && !hasSql && (
        <div className="flex items-center gap-2.5 py-1 animate-fade-in-up">
          <Loader2 className="w-4 h-4 text-foreground animate-spin shrink-0" />
          <ShimmeringText text="Thinking..." className="text-sm" />
        </div>
      )}

      {visibleAgents.map((sub) => (
        <div key={sub.id} className="animate-fade-in-up">
          <AgentGroup
            subagent={sub}
            isExpanded={expandedAgents.has(sub.id)}
            onToggle={() => onToggleAgent(sub.id)}
            onNameClick={() => onSubagentClick(sub.id)}
            isOverallComplete={isComplete}
          />
          {sub.status === "complete" && sub.summary && (
            <NarrationText text={getAgentNarration(sub)} />
          )}
        </div>
      ))}

      {hasSql && !allSummaries && !isComplete && allQueriesDone && (
        <StatusLine text="Generating analysis summaries..." isLoading />
      )}

      {allSummaries && !critique && !isComplete && (
        <StatusLine
          text={`All ${analysis.length} agent summaries generated`}
          isLoading={false}
        />
      )}

      {critique && (critique.status !== "pending" || isComplete) && (
        <div>
          <NarrationText text="All agents have completed their analysis. Validating findings..." />
          <div className="animate-fade-in-up">
            <AgentGroup
              subagent={critique}
              isExpanded={expandedAgents.has("critique")}
              onToggle={() => onToggleAgent("critique")}
              onNameClick={() => onSubagentClick("critique")}
              isOverallComplete={isComplete}
            />
            {critique.summary && (
              <NarrationText text={getAgentNarration(critique)} />
            )}
          </div>
        </div>
      )}

      {critique?.summary && !isComplete && (
        <StatusLine text="Synthesizing final report..." isLoading />
      )}

      {!agent.planText && agent.subagents.length === 0 && !isComplete && (
        <div className="flex items-center gap-2.5 py-1 animate-fade-in-up">
          <Loader2 className="w-4 h-4 text-foreground animate-spin shrink-0" />
          <ShimmeringText text="Reading schema and planning analysis..." className="text-sm" />
        </div>
      )}

      {isComplete && <QuerySummary analysis={analysis} />}
    </div>
  );
}

// ── Agent group ──

function AgentGroup({
  subagent,
  isExpanded,
  onToggle,
  onNameClick,
  isOverallComplete,
}: {
  subagent: SubagentInfo;
  isExpanded: boolean;
  onToggle: () => void;
  onNameClick: () => void;
  isOverallComplete: boolean;
}) {
  const isCritique = subagent.id === "critique";
  const isActive = subagent.status === "active";

  return (
    <div className="relative rounded-lg">
      <button
        onClick={onToggle}
        className="flex items-center gap-3 w-full text-left group py-1.5 px-2 rounded-lg hover:bg-muted/10 transition-colors"
      >
        <VoxelOrb agentId={subagent.id} size={20} animate={!isOverallComplete} />

        <span
          onClick={(e) => {
            e.stopPropagation();
            onNameClick();
          }}
          className={`text-sm font-medium hover:underline underline-offset-2 cursor-pointer truncate transition-colors duration-300 ${
            isActive ? "text-foreground" : ""
          }`}
        >
          {isActive ? <ShimmeringText text={subagent.name} className="text-sm font-medium" /> : subagent.name}
        </span>

        {!isCritique && (
          <span className="text-xs text-muted-foreground ml-auto tabular-nums">
            {(SUBAGENT_TASKS[subagent.id] ?? SUBAGENT_TASKS["rev-opt"]).checklist.length} tasks
          </span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0 ${
            isExpanded ? "" : "-rotate-90"
          }`}
        />
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="ml-[21px] mt-0.5 pl-5 pb-1.5 mb-0.5">
            {/* Per-agent task checklist — with animated progress line */}
            <AgentChecklist subagent={subagent} />
            {/* Query results — no tree line, just indented mono output */}
            {subagent.queries && subagent.queries.length > 0 && (
              <div className="mt-1 space-y-0 ml-3">
                {subagent.queries.map((q, i) => (
                  <QueryResult key={i} query={q} subagent={subagent} index={i} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Per-agent inline checklist (compact task plan) ──

function AgentChecklist({ subagent }: { subagent: SubagentInfo }) {
  const items = deriveAgentChecklist(subagent);
  const checkedCount = items.filter((i) => i.checked).length;
  const allDone = checkedCount === items.length;
  const activeIdx = items.findIndex((i) => !i.checked);
  const progressPercent = items.length > 0 ? (checkedCount / items.length) * 100 : 0;

  return (
    <div className="py-1 relative ml-[7px] pl-5 space-y-0.5">
      {/* Static track */}
      <div className="absolute left-0 top-0 bottom-0 w-px bg-border/40" />
      {/* Animated fill */}
      <div
        className="absolute left-0 top-0 w-px bg-foreground/30 transition-all duration-700 ease-out"
        style={{ height: `${progressPercent}%` }}
      />
      {/* Active pulse dot */}
      {!allDone && activeIdx >= 0 && (
        <div
          className="absolute left-[-2.5px] w-[6px] h-[6px] rounded-full bg-foreground transition-all duration-700 ease-out"
          style={{ top: `${progressPercent}%` }}
        >
          <div className="absolute inset-0 rounded-full bg-foreground/50 animate-ping" />
        </div>
      )}

      {items.map((item, i) => {
        // Show spinner on first unchecked item whenever work is still in progress
        const isCurrent = i === activeIdx && !allDone;
        return (
          <div key={i} className="flex items-start gap-2.5 py-0.5 relative">
            <div className={`absolute -left-5 top-[9px] w-[13px] h-px transition-colors duration-500 ${item.checked ? "bg-foreground/20" : "bg-border/30"}`} />
            {item.checked ? (
              <Check className="w-3.5 h-3.5 text-foreground/50 shrink-0 mt-0.5" />
            ) : isCurrent ? (
              <Loader2 className="w-3.5 h-3.5 text-foreground animate-spin shrink-0 mt-0.5" />
            ) : (
              <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/20 shrink-0 mt-0.5" />
            )}
            <span className={`text-[11.7px] leading-relaxed transition-colors duration-300 ${
              item.checked ? "text-muted-foreground" : isCurrent ? "text-foreground" : "text-muted-foreground/30"
            }`}>
              {isCurrent ? <ShimmeringText text={item.label} className="text-[11.7px]" /> : item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Query result row (execution output style) ──

function QueryResult({
  query,
  subagent,
  index,
}: {
  query: QueryInfo;
  subagent: SubagentInfo;
  index: number;
}) {
  const isDone = query.rowCount != null;
  const isError = !!query.error;
  const doneCount = subagent.queries.filter(
    (q) => q.rowCount != null || q.error
  ).length;
  const isActive =
    !isDone && !isError && subagent.status === "active" && index === doneCount;

  return (
    <div className="flex items-center gap-2.5 py-1 px-1 rounded-md">
      <span className="shrink-0 text-[9.9px] font-mono text-muted-foreground/35 w-5 text-right tabular-nums">
        {isActive ? (
          <Loader2 className="w-3.5 h-3.5 text-foreground animate-spin inline" />
        ) : (
          `Q${index + 1}`
        )}
      </span>
      <span className={`text-[11.7px] leading-snug truncate flex-1 font-mono ${
        isError ? "text-muted-foreground" : isActive ? "text-foreground/70" : "text-muted-foreground/50"
      }`}>
        {isActive ? <ShimmeringText text={query.description} className="text-[11.7px] font-mono" /> : query.description}
      </span>
      {(isDone || isError) && (
        <span className="text-[9.9px] font-mono text-muted-foreground/30 shrink-0 tabular-nums">
          {isDone && `${query.rowCount!.toLocaleString()} rows`}
          {isError && "error"}
        </span>
      )}
    </div>
  );
}

// ── Narration text ──

function NarrationText({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="text-[11.7px] text-foreground/50 leading-relaxed animate-fade-in-up pl-[44px] pr-2 pb-1">
      <MarkdownContent content={text} />
    </div>
  );
}

// ── Status line ──

function StatusLine({ text, isLoading }: { text: string; isLoading: boolean }) {
  return (
    <div className="flex items-center gap-3 py-1 px-2 animate-fade-in-up">
      {isLoading ? (
        <Loader2 className="w-4 h-4 text-foreground animate-spin shrink-0" />
      ) : (
        <Check className="w-4 h-4 text-foreground/50 shrink-0" />
      )}
      {isLoading
        ? <ShimmeringText text={text} className="text-sm" />
        : <span className="text-sm text-muted-foreground">{text}</span>}
    </div>
  );
}

// ── Query summary ──

function QuerySummary({ analysis }: { analysis: SubagentInfo[] }) {
  const [expanded, setExpanded] = useState(false);

  const agentsWithQueries = analysis.filter((s) => s.queries && s.queries.length > 0);
  if (agentsWithQueries.length === 0) return null;

  const totalQueries = agentsWithQueries.reduce(
    (sum, s) => sum + s.queries.filter((q) => q.rowCount != null).length,
    0
  );
  const totalTimeMs = agentsWithQueries.reduce(
    (sum, s) =>
      sum +
      s.queries
        .filter((q) => q.executionTimeMs != null)
        .reduce((a, q) => a + (q.executionTimeMs || 0), 0),
    0
  );

  return (
    <div className="animate-fade-in-up">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-3 py-1 px-2 text-sm text-muted-foreground hover:text-foreground transition-colors group w-full text-left rounded-lg hover:bg-muted/10"
      >
        <Check className="w-4 h-4 text-foreground/50 shrink-0" />
        <span>
          Executed {totalQueries} queries in {formatTime(totalTimeMs)}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform shrink-0 ml-auto ${
            expanded ? "" : "-rotate-90"
          }`}
        />
      </button>
      {expanded && (
        <div className="ml-[21px] mt-0.5 border-l border-foreground/15 pl-5 space-y-0 pb-1">
          {agentsWithQueries.map((sub) => {
            const done = sub.queries.filter((q) => q.rowCount != null).length;
            const total = sub.expectedQueryCount || sub.queries.length;
            const time = sub.queries
              .filter((q) => q.executionTimeMs != null)
              .reduce((a, q) => a + (q.executionTimeMs || 0), 0);
            return (
              <div key={sub.id} className="flex items-center gap-2.5 py-0.5 relative">
                <div className="absolute -left-5 top-[9px] w-[13px] h-px bg-foreground/15" />
                <Check className="w-3.5 h-3.5 text-foreground/50 shrink-0" />
                <span className="text-[11.7px] text-muted-foreground truncate">
                  {sub.name}
                </span>
                <span className="text-xs text-muted-foreground/40 ml-auto tabular-nums">
                  {done}/{total} · {formatTime(time)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

function formatTime(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}
