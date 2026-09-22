"use client";

import { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  BarChart3,
} from "lucide-react";
import { SqlHighlighted, getAgentIcon } from "@/lib/sql-highlight";
import type { TraceState, SubagentTrace, QueryInfo } from "@/lib/types";

interface WorkingTraceProps {
  trace: TraceState;
  status: "processing" | "complete" | "error";
  startedAt: number;
  completedAt?: number;
  answerStarted: boolean;
}

export function WorkingTrace({
  trace,
  status,
  startedAt,
  completedAt,
  answerStarted,
}: WorkingTraceProps) {
  const [expanded, setExpanded] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  // Auto-collapse when answer starts streaming
  useEffect(() => {
    if (answerStarted && status === "processing") {
      setExpanded(false);
    }
  }, [answerStarted, status]);

  // Auto-collapse when complete
  useEffect(() => {
    if (status === "complete") {
      setExpanded(false);
    }
  }, [status]);

  // Elapsed timer
  useEffect(() => {
    if (status !== "processing") {
      if (completedAt && startedAt) {
        setElapsed(Math.round((completedAt - startedAt) / 1000));
      }
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, startedAt, completedAt]);

  const totalQueries = trace.subagents.reduce((sum, s) => sum + s.queries.length, 0);
  const completedQueries = trace.subagents.reduce(
    (sum, s) => sum + s.queries.filter((q) => q.rowCount != null || q.error).length,
    0
  );
  const totalAgents = trace.subagents.length;

  const isComplete = status === "complete";
  const isError = status === "error";

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        {isComplete ? (
          <CheckCircle2 className="w-4 h-4 text-foreground shrink-0" />
        ) : isError ? (
          <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
        )}

        <span className="text-sm font-medium flex-1">
          {isComplete
            ? `Worked for ${elapsed}s`
            : isError
              ? "Analysis failed"
              : `Working...  ${elapsed}s`}
        </span>

        {(isComplete || totalQueries > 0) && (
          <span className="text-xs text-muted-foreground">
            {totalQueries > 0 && `${completedQueries}/${totalQueries} queries`}
            {totalAgents > 0 && ` · ${totalAgents} agents`}
          </span>
        )}

        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Expanded trace body */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {/* Phase: Generating SQL */}
          {trace.phase !== "gathering" && (
            <TracePhase
              label="Generating SQL queries"
              done={trace.phase !== "generating_sql"}
              active={trace.phase === "generating_sql"}
            >
              {trace.subagents.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Created {totalQueries} queries across {totalAgents} agents
                </p>
              )}
            </TracePhase>
          )}

          {/* Phase: Executing queries */}
          {(trace.phase === "executing" ||
            trace.phase === "synthesizing" ||
            trace.phase === "complete") && (
            <TracePhase
              label="Executing queries"
              done={trace.phase !== "executing"}
              active={trace.phase === "executing"}
            >
              <div className="space-y-1.5">
                {trace.subagents.map((agent) => (
                  <TraceAgentRow key={agent.id} agent={agent} />
                ))}
              </div>
            </TracePhase>
          )}

          {/* Phase: Analyzing results */}
          {(trace.phase === "synthesizing" || trace.phase === "complete") && (
            <TracePhase
              label="Analyzing results"
              done={trace.phase === "complete"}
              active={trace.phase === "synthesizing"}
            >
              {trace.critiqueAgent && (
                <TraceAgentRow agent={trace.critiqueAgent} />
              )}
              {trace.phase === "synthesizing" && (
                <p className="text-xs text-muted-foreground">
                  Synthesizing insights from all agents...
                </p>
              )}
            </TracePhase>
          )}

          {/* Gathering phase (initial) */}
          {trace.phase === "gathering" && (
            <TracePhase label="Preparing analysis" active done={false}>
              <p className="text-xs text-muted-foreground">
                Classifying query and setting up workspace...
              </p>
            </TracePhase>
          )}
        </div>
      )}
    </div>
  );
}

// ── Phase section ──

function TracePhase({
  label,
  done,
  active,
  children,
}: {
  label: string;
  done: boolean;
  active: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <div className="pt-0.5 shrink-0">
        {done ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-foreground" />
        ) : active ? (
          <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
        ) : (
          <Circle className="w-3.5 h-3.5 text-muted-foreground/40" />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className={`text-xs font-medium ${done ? "text-muted-foreground" : "text-foreground"}`}>
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}

// ── Agent row ──

function TraceAgentRow({ agent }: { agent: SubagentTrace }) {
  const [sqlExpanded, setSqlExpanded] = useState(false);
  const Icon = getAgentIcon(agent.id) || BarChart3;
  const isComplete = agent.status === "complete";
  const isError = agent.status === "error";

  const completedCount = agent.queries.filter((q) => q.rowCount != null || q.error).length;
  const totalCount = agent.queries.length;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Icon className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate">{agent.name}</span>
        {isComplete && <CheckCircle2 className="w-3 h-3 text-foreground shrink-0" />}
        {isError && <AlertCircle className="w-3 h-3 text-muted-foreground shrink-0" />}
        {!isComplete && !isError && totalCount > 0 && (
          <span className="text-[9px] text-muted-foreground ml-auto shrink-0">
            {completedCount}/{totalCount}
          </span>
        )}
      </div>

      {/* Query results */}
      {agent.queries.map((q, i) => (
        <TraceQueryRow key={i} query={q} index={i} />
      ))}

      {/* Expandable SQL */}
      {agent.queries.length > 0 && agent.queries.some((q) => q.sql) && (
        <button
          onClick={() => setSqlExpanded((e) => !e)}
          className="text-[9px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 ml-5"
        >
          {sqlExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
          {sqlExpanded ? "Hide SQL" : "View SQL"}
        </button>
      )}
      {sqlExpanded && (
        <div className="ml-5 bg-zinc-900 text-xs font-mono p-2.5 rounded overflow-x-auto max-h-48 overflow-y-auto">
          {agent.queries.map((q, i) => (
            <div key={i} className="mb-2">
              <div className="text-zinc-500 mb-0.5">-- Q{i + 1}: {q.description}</div>
              <SqlHighlighted sql={q.sql} />
            </div>
          ))}
        </div>
      )}

      {/* Summary preview */}
      {agent.summary && isComplete && (
        <p className="text-[9px] text-muted-foreground ml-5 line-clamp-2">
          {agent.summary.slice(0, 150)}...
        </p>
      )}
    </div>
  );
}

// ── Query row ──

function TraceQueryRow({ query, index }: { query: QueryInfo; index: number }) {
  const hasResult = query.rowCount != null;
  const hasError = !!query.error;

  return (
    <div className="flex items-center gap-2 ml-5 text-[9.9px]">
      {hasError ? (
        <AlertCircle className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
      ) : hasResult ? (
        <CheckCircle2 className="w-2.5 h-2.5 text-foreground shrink-0" />
      ) : (
        <Loader2 className="w-2.5 h-2.5 text-muted-foreground animate-spin shrink-0" />
      )}
      <span className="text-muted-foreground truncate flex-1">
        Q{index + 1}: {query.description}
      </span>
      {hasResult && !hasError && (
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {query.rowCount?.toLocaleString()} rows · {query.executionTimeMs}ms
        </span>
      )}
      {hasError && (
        <span className="text-muted-foreground shrink-0">Error</span>
      )}
    </div>
  );
}
