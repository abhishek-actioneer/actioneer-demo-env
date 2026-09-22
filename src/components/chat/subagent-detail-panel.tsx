"use client";

import { useState } from "react";
import {
  X,
  CheckCircle2,
  Loader2,
  Code2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Package,
  Database,
  ListChecks,
} from "lucide-react";
import type { SubagentInfo } from "@/lib/types";
import { MarkdownContent } from "@/lib/markdown";
import { SqlHighlighted } from "@/lib/sql-highlight";
import { SUBAGENT_TASKS } from "@/lib/subagent-config";

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

// ── Subagent Detail Panel ──

export function SubagentDetailPanel({
  subagent,
  onClose,
}: {
  subagent: SubagentInfo;
  onClose: () => void;
}) {
  const [checklistExpanded, setChecklistExpanded] = useState(true);
  const [sqlExpanded, setSqlExpanded] = useState(false);
  const [dbQueryExpanded, setDbQueryExpanded] = useState(false);

  const isComplete = subagent.status === "complete";
  const isError = subagent.status === "error";
  const hasRealData = !!subagent.queries?.length;
  const hasSummary = !!subagent.summary;
  const queries = subagent.queries || [];
  const completedQueries = queries.filter((q) => q.rowCount != null || q.error);
  const hasResults = completedQueries.length > 0;
  const allQueriesDone = completedQueries.length === queries.length && queries.length > 0;
  const isCritique = subagent.id === "critique";
  const totalTimeMs = completedQueries.reduce((sum, q) => sum + (q.executionTimeMs || 0), 0);
  const successfulQueries = completedQueries.filter((q) => !q.error);

  // Get agent-specific task definition
  const taskDef = SUBAGENT_TASKS[subagent.id] ?? SUBAGENT_TASKS["rev-opt"];

  // Progressive checklist — items check off based on processing state
  const checklistStates = taskDef.checklist.map((label, idx) => {
    if (isComplete || hasSummary) return { label, checked: true }; // All done when summary exists
    if (idx === 0) return { label, checked: hasRealData }; // Read schema → SQL generated
    if (idx === 1) return { label, checked: hasRealData }; // Define dimensions → SQL generated
    if (idx === 2) return { label, checked: hasResults }; // Execute queries → results received
    return { label, checked: false }; // Later items pending
  });

  // Progressive message count
  const msgCount =
    3 +
    (hasRealData ? 2 : 0) +
    (hasResults ? 2 : 0) +
    (hasSummary ? 3 : 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">{subagent.name}</h2>
          <p className="text-xs text-muted-foreground">
            {isComplete
              ? "Tasks complete"
              : isError
                ? "Error"
                : "Tasks in progress › Processing"}
            {" · "}{msgCount} messages
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
          {!isComplete && !isError && hasRealData && (
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

          {/* ── Mini-checklist (matches original subagent panels) ── */}
          {hasRealData && (
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
                <ol className="mt-3 space-y-2.5">
                  {checklistStates.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      {item.checked ? (
                        <CheckCircle2 className="w-4.5 h-4.5 text-foreground shrink-0 mt-0.5" />
                      ) : (
                        <div className="w-4.5 h-4.5 rounded-full border-[1.5px] border-dashed border-muted-foreground/30 shrink-0 mt-0.5" />
                      )}
                      <span
                        className={`text-xs leading-relaxed ${
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

          {/* ── Narrative text (agent thinking) ── */}
          {hasRealData && (
            <TimelineBlock>
              <p className="text-xs leading-relaxed">
                {hasSummary ? taskDef.narrativeDone : taskDef.narrativeActive}
              </p>
            </TimelineBlock>
          )}

          {/* ── Database Query Execution block (multi-query) ── */}
          {hasRealData && !isCritique && (
            <TimelineBlock>
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/50">
                  <Database className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">Database Query Execution</span>
                </div>
                <button
                  onClick={() => setDbQueryExpanded((e) => !e)}
                  className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted/20 transition-colors"
                >
                  {allQueriesDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-foreground" />
                  ) : hasResults ? (
                    <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                  )}
                  <span className="text-xs font-medium flex-1">
                    {allQueriesDone
                      ? "Batch Queries Complete"
                      : `Executing Batch Queries (${completedQueries.length}/${queries.length})`}
                  </span>
                  {dbQueryExpanded ? (
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  )}
                </button>
                {hasResults && (
                  <div className="px-3 py-2 border-t border-border/50 space-y-2">
                    <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {successfulQueries.length}/{queries.length} queries succeeded
                      </span>
                      <span>⏱ {totalTimeMs}ms total</span>
                    </div>
                    {/* Query rows — Q1, Q2, Q3 */}
                    {queries.map((q, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span
                          className={`w-4 h-4 rounded-full text-[8.1px] font-bold flex items-center justify-center shrink-0 ${
                            q.error
                              ? "bg-muted text-foreground"
                              : q.rowCount != null
                                ? "bg-muted text-foreground"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          Q{i + 1}
                        </span>
                        <span className="text-[9px] text-muted-foreground flex-1 truncate">
                          {q.description}
                        </span>
                        {q.rowCount != null && (
                          <>
                            <span className="text-[9px] text-muted-foreground font-mono whitespace-nowrap">
                              {q.rowCount} rows
                            </span>
                            <span className="text-[9px] text-muted-foreground font-mono whitespace-nowrap">
                              ⏱{q.executionTimeMs}ms
                            </span>
                          </>
                        )}
                        {q.error && (
                          <span className="text-[9px] text-muted-foreground font-mono whitespace-nowrap">
                            failed
                          </span>
                        )}
                        {!q.rowCount && !q.error && (
                          <Loader2 className="w-3 h-3 text-muted-foreground animate-spin shrink-0" />
                        )}
                      </div>
                    ))}
                    {/* Expandable SQL for all queries */}
                    {dbQueryExpanded && (
                      <div className="mt-1">
                        <p className="text-[9px] text-muted-foreground mb-1">SQL</p>
                        <pre className="px-2.5 py-2 text-[9px] font-mono bg-zinc-950 rounded-md overflow-x-auto leading-relaxed max-h-[300px] overflow-y-auto">
                          {queries.map((q, i) => (
                            <div key={i} className={i > 0 ? "mt-3 pt-3 border-t border-zinc-800" : ""}>
                              <span className="text-zinc-500">-- Q{i + 1}: {q.description}</span>
                              {"\n"}
                              <SqlHighlighted sql={q.sql} />
                            </div>
                          ))}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
                {/* Per-query errors */}
                {queries.some((q) => q.error) && (
                  <div className="px-3 py-2 border-t border-border/50 space-y-1">
                    {queries.filter((q) => q.error).map((q, i) => (
                      <div key={i} className="flex items-center gap-2 text-[9px] text-muted-foreground">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span>Q{queries.indexOf(q) + 1}: {q.error}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TimelineBlock>
          )}

          {/* ── LLM-generated summary (primary analysis content) ── */}
          {hasSummary && (
            <TimelineBlock>
              <div className="text-sm leading-relaxed prose prose-sm prose-neutral max-w-none">
                <MarkdownContent content={subagent.summary!} />
              </div>
            </TimelineBlock>
          )}

          {/* ── Loading states (no summary yet) ── */}
          {!hasSummary && hasRealData && (
            <>
              {subagent.status === "active" && (
                <TimelineBlock>
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      {hasResults ? "Generating analysis summary..." : "Executing query against DuckDB..."}
                    </span>
                  </div>
                </TimelineBlock>
              )}
              {isComplete && (
                <TimelineBlock>
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      Generating analysis summary...
                    </span>
                  </div>
                </TimelineBlock>
              )}
            </>
          )}

          {/* ── Critique-specific: collapsible SQL reference ── */}
          {isCritique && hasRealData && queries[0]?.sql && queries[0].sql !== "-- Validate analysis quality and cross-check findings" && (
            <div className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setSqlExpanded((e) => !e)}
                className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 w-full text-left"
              >
                <Code2 className="w-3 h-3 text-muted-foreground" />
                <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                  SQL Query
                </span>
                <span className="text-[9px] text-muted-foreground ml-auto">
                  {sqlExpanded ? "Hide" : "Show"}
                </span>
              </button>
              {sqlExpanded && (
                <pre className="px-3 py-2.5 text-[9.9px] font-mono bg-zinc-950 overflow-x-auto leading-relaxed max-h-[300px] overflow-y-auto">
                  <SqlHighlighted sql={queries[0].sql} />
                </pre>
              )}
            </div>
          )}

          {/* ── Fallback for preloaded conversations (no real data) ── */}
          {!hasRealData && (
            <>
              <div>
                <h3 className="text-lg font-bold mb-1.5">Analysis Complete</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  The {subagent.name} has completed its analysis.
                  Detailed execution data and query results are available for live queries.
                </p>
              </div>
              {isComplete && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      Analysis complete
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      Results passed to synthesis agent
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Data source footer */}
          {(hasSummary || isComplete) && hasRealData && (
            <div className="pt-2 border-t border-border">
              <p className="text-[9px] text-muted-foreground">
                <strong>Connection:</strong> DuckDB |{" "}
                <strong>Analysis Date:</strong> {new Date().toLocaleDateString()}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
