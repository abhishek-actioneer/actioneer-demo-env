"use client";

import { useState, useEffect, useRef } from "react";
import {
  X,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  BarChart3,
} from "lucide-react";
import type { SubagentInfo } from "@/lib/types";
import { SqlHighlighted, AGENT_ICONS } from "@/lib/sql-highlight";

// ── SourcesPanel ──

interface SourcesPanelProps {
  agents: SubagentInfo[];
  highlightedQuery?: string | null; // "daily-metrics:Q1"
  onClose: () => void;
}

export function SourcesPanel({
  agents,
  highlightedQuery,
  onClose,
}: SourcesPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to highlighted query
  useEffect(() => {
    if (highlightedQuery && scrollRef.current) {
      const el = scrollRef.current.querySelector(`[data-query-id="${highlightedQuery}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [highlightedQuery]);

  // Filter out agents with no queries (except critique which has pseudo-queries)
  const queryAgents = agents.filter((a) => a.id !== "critique" && a.queries?.length);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3">
        <Database className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold flex-1">Sources</h2>

        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto" ref={scrollRef}>
        <div className="p-3 space-y-2">
          {queryAgents.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3">
              No query data available yet.
            </p>
          ) : (
            queryAgents.map((agent) => (
              <AgentQueryGroup
                key={agent.id}
                agent={agent}
                highlightedQuery={highlightedQuery}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Per-agent query group (accordion) ──

function AgentQueryGroup({
  agent,
  highlightedQuery,
}: {
  agent: SubagentInfo;
  highlightedQuery?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const Icon = AGENT_ICONS[agent.id] || BarChart3;
  const queries = agent.queries || [];
  const completedCount = queries.filter((q) => q.rowCount != null || q.error).length;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Agent header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 w-full px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold flex-1 text-left">{agent.name}</span>
        <span className="text-[9px] text-muted-foreground">
          {completedCount}/{queries.length} queries
        </span>
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        )}
      </button>

      {/* Query cards */}
      {expanded && (
        <div className="divide-y divide-border/50">
          {queries.map((q, i) => {
            const queryId = `${agent.id}:Q${i + 1}`;
            const isHighlighted = highlightedQuery === queryId;

            return (
              <QueryCard
                key={i}
                queryId={queryId}
                index={i}
                description={q.description}
                sql={q.sql}
                rowCount={q.rowCount}
                executionTimeMs={q.executionTimeMs}
                error={q.error}
                isHighlighted={isHighlighted}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Individual query card ──

function QueryCard({
  queryId,
  index,
  description,
  sql,
  rowCount,
  executionTimeMs,
  error,
  isHighlighted,
}: {
  queryId: string;
  index: number;
  description: string;
  sql: string;
  rowCount?: number;
  executionTimeMs?: number;
  error?: string;
  isHighlighted: boolean;
}) {
  const [sqlExpanded, setSqlExpanded] = useState(false);

  useEffect(() => {
    if (isHighlighted) {
      setSqlExpanded(true);
    }
  }, [isHighlighted]);

  return (
    <div
      data-query-id={queryId}
      className={`px-3 py-2.5 transition-colors ${
        isHighlighted
          ? "bg-muted ring-1 ring-inset ring-border"
          : ""
      }`}
    >
      {/* Query header */}
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center shrink-0 ${
            error
              ? "bg-muted text-foreground"
              : rowCount != null
                ? isHighlighted ? "bg-foreground/15 text-foreground ring-1 ring-foreground/20" : "bg-muted text-foreground"
                : "bg-muted text-muted-foreground"
          }`}
        >
          Q{index + 1}
        </span>
        <span className="text-[9.9px] text-foreground flex-1 truncate font-medium">
          {description}
        </span>
      </div>

      {/* Metadata */}
      <div className="flex items-center gap-3 ml-7 text-[9px] text-muted-foreground">
        {rowCount != null && (
          <>
            <span className="font-mono">{rowCount.toLocaleString()} rows</span>
            {executionTimeMs != null && (
              <span className="font-mono">{executionTimeMs}ms</span>
            )}
          </>
        )}
        {error && (
          <span className="text-muted-foreground font-mono">Failed: {error}</span>
        )}
      </div>

      {/* SQL toggle */}
      <button
        onClick={() => setSqlExpanded((e) => !e)}
        className="flex items-center gap-1 mt-1.5 ml-7 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <FileText className="w-3 h-3" />
        {sqlExpanded ? "Hide SQL" : "View SQL"}
      </button>
      {sqlExpanded && (
        <pre className="mt-1.5 ml-7 px-2.5 py-2 text-[9px] font-mono bg-zinc-950 rounded-md whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto leading-relaxed">
          {sql ? <SqlHighlighted sql={sql} /> : <span className="text-muted-foreground">SQL not available</span>}
        </pre>
      )}
    </div>
  );
}
