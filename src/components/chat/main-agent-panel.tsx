"use client";

import { useState } from "react";
import {
  X,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Users,
  Package,
  Wrench,
  Brain,
  ListChecks,
} from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { MarkdownContent } from "@/lib/markdown";
import { SUBAGENT_TASK_PROMPTS } from "@/lib/subagent-config";

// ── Timeline Block — agent icon on left, content on right ──

function TimelineBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-muted/50 border border-border flex items-center justify-center shrink-0 mt-0.5">
        <Package className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ── Main Agent Panel ──

export function MainAgentPanel({
  agent,
  messages,
  onClose,
  onSubagentClick: _onSubagentClick,
}: {
  agent?: ChatMessage["agent"];
  messages: ChatMessage[];
  onClose: () => void;
  onSubagentClick: (subagentId: string) => void;
}) {
  const [checklistExpanded, setChecklistExpanded] = useState(true);
  const [toolExpanded, setToolExpanded] = useState(false);
  const [reportToolExpanded, setReportToolExpanded] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const subagents = agent?.subagents ?? [];
  const isComplete = agent?.status === "complete";
  const hasSubagents = subagents.length > 0;

  // Agent groups
  const analysisAgents = subagents.filter((s) => s.id !== "critique");
  const critiqueAgent = subagents.find((s) => s.id === "critique");

  // Progressive state detection from subagent data
  const hasSql = subagents.some((s) => s.queries?.length);
  const hasResults = analysisAgents.some((s) => s.queries?.some((q) => q.rowCount != null));
  const allAnalysisResults =
    analysisAgents.length > 0 &&
    analysisAgents.every((s) => s.queries?.every((q) => q.rowCount != null));
  const hasSummaries = analysisAgents.some((s) => s.summary);
  const allSummaries =
    analysisAgents.length > 0 && analysisAgents.every((s) => s.summary);
  const hasCritiqueSummary = !!critiqueAgent?.summary;

  // Static 7-item checklist — progressive checking based on processing state
  // When isComplete (including preloaded convos), all items force-checked
  const checklist = [
    {
      label: "Read schema and understand available data structure",
      checked: isComplete || hasSql,
    },
    {
      label:
        "Gather initial data from specialized agents in parallel (Data Quality, Daily Metrics, Cohort Retention, Revenue Optimization, User Segmentation, Geographic)",
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
      label:
        "Synthesize findings and create comprehensive report with visualizations",
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

  // Progressive message count (approximates original: 5 → 6 → 11 → 15)
  const msgCount =
    5 +
    subagents.filter((s) => s.queries?.length).length +
    subagents.filter((s) => s.queries?.some((q) => q.rowCount != null)).length +
    subagents.filter((s) => s.summary).length * 2 +
    (isComplete ? 1 : 0);

  // Find the final sentinel response
  const finalResponse = [...messages]
    .reverse()
    .find((m) => m.role === "sentinel" && !m.variant && m.content.length > 50);

  // Quick answer detection (0-1 subagents)
  const isQuickAnswer = subagents.length <= 1;

  // Tool execution data for JSON output
  const sqlQueries = analysisAgents
    .filter((s) => s.queries?.length)
    .flatMap((s) =>
      (s.queries || []).map((q, i) => ({
        agent: s.name,
        query: `Q${i + 1}: ${q.description}`,
        rowCount: q.rowCount,
        timeMs: q.executionTimeMs,
        error: q.error,
      }))
    );

  return (
    <div className="flex flex-col h-full">
      {/* Header — green-tinted banner matching original */}
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-muted border border-border flex items-center justify-center shrink-0">
          <Package className="w-5 h-5 text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold">Main Agent</h2>
          <p className="text-xs text-muted-foreground">
            {isComplete
              ? "Tasks complete"
              : "Tasks in progress › Processing"}{" "}
            · {msgCount} messages
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Thinking indicator (during processing) */}
          {!isComplete && (
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-muted/50 border border-border flex items-center justify-center shrink-0">
                <Package className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-foreground animate-pulse" />
                <span className="text-sm">Thinking...</span>
              </div>
            </div>
          )}

          {/* Final response (shown at top when complete) */}
          {isComplete && finalResponse && (
            <div className="text-sm leading-relaxed prose prose-sm prose-neutral max-w-none">
              <MarkdownContent content={finalResponse.content} />
            </div>
          )}

          {/* ── Static Checklist (matches original 7-item list) ── */}
          {(hasSubagents || isComplete) && (
            <div>
              <button
                onClick={() => setChecklistExpanded((c) => !c)}
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <ListChecks className="w-4 h-4 text-muted-foreground" />
                Completed tasks
                {checklistExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>
              {checklistExpanded && (
                <ol className="mt-3 space-y-3">
                  {checklist.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      {item.checked ? (
                        <CheckCircle2 className="w-5 h-5 text-foreground shrink-0 mt-0.5" />
                      ) : (
                        <div className="w-5 h-5 rounded-full border-[1.5px] border-dashed border-muted-foreground/30 shrink-0 mt-0.5" />
                      )}
                      <span
                        className={`text-sm leading-relaxed ${
                          item.checked ? "" : "text-muted-foreground"
                        }`}
                      >
                        {idx + 1}. {item.label}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* ── Progressive Timeline Blocks ── */}

          {/* Tool Execution: Get Computed Metrics */}
          {sqlQueries.length > 0 && (
            <TimelineBlock>
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/50">
                  <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">Tool Execution</span>
                </div>
                <button
                  onClick={() => setToolExpanded((e) => !e)}
                  className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted/20 transition-colors"
                >
                  <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium flex-1">
                    Get Computed Metrics
                  </span>
                  {toolExpanded ? (
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  )}
                </button>
                {toolExpanded && (
                  <div className="px-3 py-2 border-t border-border/50">
                    <p className="text-[9px] text-muted-foreground mb-2">
                      Output
                    </p>
                    <pre className="px-2.5 py-2 text-[9px] font-mono bg-zinc-950 rounded-md text-zinc-100 overflow-x-auto max-h-[200px] overflow-y-auto leading-relaxed">
{JSON.stringify(
  {
    success: true,
    queries: sqlQueries.map((q) => ({
      agent: q.agent,
      query: q.query,
      status: q.error
        ? "error"
        : q.rowCount != null
          ? "success"
          : "executing",
      ...(q.rowCount != null
        ? { rowCount: q.rowCount, executionTimeMs: q.timeMs }
        : {}),
      ...(q.error ? { error: q.error } : {}),
    })),
    totalQueries: sqlQueries.length,
  },
  null,
  2
)}
                    </pre>
                  </div>
                )}
              </div>
            </TimelineBlock>
          )}

          {/* Internal Reasoning: Thought Complete (after query results) */}
          {hasResults && (
            <TimelineBlock>
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/50">
                  <Brain className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">
                    Internal Reasoning
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2">
                  <Brain className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium flex-1">
                    Thought Complete
                  </span>
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                </div>
              </div>
            </TimelineBlock>
          )}

          {/* Narrative + Spawning Analysis Subagents (accordion with task details) */}
          {analysisAgents.length > 0 && (hasResults || isComplete) && (
            <TimelineBlock>
              <p className="text-xs leading-relaxed mb-2">
                Now let me spawn the specialized analysis agents to gather
                comprehensive data across multiple dimensions:
              </p>
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/50">
                  <span className="text-xs font-semibold">
                    Spawning Subagents
                  </span>
                </div>
                <div className="px-3 py-1 divide-y divide-border/50">
                  {analysisAgents.map((s) => (
                    <div key={s.id}>
                      <button
                        onClick={() => setExpandedTaskId((prev) => prev === s.id ? null : s.id)}
                        className="flex items-center gap-2 w-full text-left hover:bg-muted/30 rounded-md px-1 py-2 -mx-1 transition-colors"
                      >
                        <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs font-medium flex-1">{s.name}</span>
                        {expandedTaskId === s.id ? (
                          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        )}
                      </button>
                      {expandedTaskId === s.id && SUBAGENT_TASK_PROMPTS[s.id] && (
                        <div className="px-1 pb-3 pt-1">
                          <div className="bg-muted/20 border border-border/50 rounded-lg px-3 py-3 text-xs leading-relaxed prose prose-xs prose-neutral max-w-none">
                            <MarkdownContent content={SUBAGENT_TASK_PROMPTS[s.id]} />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </TimelineBlock>
          )}

          {/* Internal Reasoning: Analysis Summary Complete */}
          {allSummaries && (
            <TimelineBlock>
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/50">
                  <Brain className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">
                    Internal Reasoning
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2">
                  <Brain className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium flex-1">
                    Analysis Summary Complete
                  </span>
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                </div>
              </div>
            </TimelineBlock>
          )}

          {/* Narrative + Spawning Critique Agent (accordion with task details) */}
          {critiqueAgent && (
            <TimelineBlock>
              <p className="text-xs leading-relaxed mb-2">
                Now let me run the critique agent to validate the report quality
                and cross-check the analysis findings:
              </p>
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/50">
                  <span className="text-xs font-semibold">
                    Spawning Subagents
                  </span>
                </div>
                <div className="px-3 py-1">
                  <button
                    onClick={() => setExpandedTaskId((prev) => prev === "critique" ? null : "critique")}
                    className="flex items-center gap-2 w-full text-left hover:bg-muted/30 rounded-md px-1 py-2 -mx-1 transition-colors"
                  >
                    {critiqueAgent.status === "complete" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-foreground shrink-0" />
                    ) : (
                      <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
                    )}
                    <span className="text-xs font-medium flex-1">Critique Agent</span>
                    {expandedTaskId === "critique" ? (
                      <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    )}
                  </button>
                  {expandedTaskId === "critique" && SUBAGENT_TASK_PROMPTS["critique"] && (
                    <div className="px-1 pb-3 pt-1">
                      <div className="bg-muted/20 border border-border/50 rounded-lg px-3 py-3 text-xs leading-relaxed prose prose-xs prose-neutral max-w-none">
                        <MarkdownContent content={SUBAGENT_TASK_PROMPTS["critique"]} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </TimelineBlock>
          )}

          {/* Tool Execution: Send Report To Client (when complete, deep mode) */}
          {isComplete && !isQuickAnswer && (
            <TimelineBlock>
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/50">
                  <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">Tool Execution</span>
                </div>
                <button
                  onClick={() => setReportToolExpanded((e) => !e)}
                  className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted/20 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-foreground" />
                  <span className="text-xs font-medium flex-1">
                    Send Report To Client
                  </span>
                  {reportToolExpanded ? (
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  )}
                </button>
                {reportToolExpanded && (
                  <div className="px-3 py-2 border-t border-border/50">
                    <p className="text-[9px] text-muted-foreground mb-1">
                      Arguments:
                    </p>
                    <pre className="px-2.5 py-2 text-[9px] font-mono bg-zinc-950 rounded-md text-zinc-100 overflow-x-auto">
{`{
  "report_path": "/workspace/final_report.md",
  "title": "Analysis Report",
  "format": "markdown"
}`}
                    </pre>
                  </div>
                )}
              </div>
            </TimelineBlock>
          )}
        </div>
      </div>
    </div>
  );
}
