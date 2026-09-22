"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { X, AlertCircle, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import type { ConnectorIssue } from "@/lib/connector-issues";

/* ── Agent icon (matches the Agents tab icon in connector page) ── */
function AgentsIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="currentColor" className={className}>
      <path d="M62.79 98.1a2.81 2.81 0 0 1-3 2.81A46.77 46.77 0 0 1 16 54.21V42.94A18.94 18.94 0 0 1 34.94 24h58.13A18.94 18.94 0 0 1 112 42.93v11.28a102.22 102.22 0 0 1-.68 11.71 2.8 2.8 0 0 1-3.24 2.43l-4.34-.73a2.79 2.79 0 0 1-2.33-3.06 92.85 92.85 0 0 0 .59-10.35V42.94A8.94 8.94 0 0 0 93.06 34H34.93A8.93 8.93 0 0 0 26 42.93v11.28a36.68 36.68 0 0 0 19.94 32.71 36.1 36.1 0 0 0 14.21 4 2.81 2.81 0 0 1 2.64 2.79z" />
      <path d="M69 29H59V14.8a2.8 2.8 0 0 1 2.8-2.8h4.4a2.8 2.8 0 0 1 2.8 2.8z" />
      <circle cx="48" cy="56" r="8" />
      <circle cx="80" cy="56" r="8" />
      <path d="m110.94 103.87-5.66-5.67a16 16 0 1 0-7.08 7.08l5.67 5.66a2.81 2.81 0 0 0 4 0l3.11-3.11a2.81 2.81 0 0 0-.04-3.96zm-15.7-8.63a6 6 0 1 1 0-8.48 6 6 0 0 1 0 8.48z" />
    </svg>
  );
}

/* ── Issue pill ─────────────────────────────────────────────────── */

interface IssuePillProps {
  issues: ConnectorIssue[];
  onClick: (e: React.MouseEvent) => void;
}

export function IssuePill({ issues, onClick }: IssuePillProps) {
  const hasError = issues.some(i => i.severity === "error");
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onClick(e as never); }}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9.9px] font-medium shrink-0 transition-colors cursor-pointer ${
        hasError
          ? "bg-foreground text-background hover:bg-foreground/90"
          : "bg-muted text-foreground hover:bg-muted/80"
      }`}
    >
      View Issues
    </span>
  );
}

/* ── Issue modal ────────────────────────────────────────────────── */

interface IssueModalProps {
  issues: ConnectorIssue[];
  initialIndex?: number;
  onClose: () => void;
}

export function IssueModal({ issues, initialIndex = 0, onClose }: IssueModalProps) {
  const [index, setIndex] = useState(initialIndex);
  const issue = issues[index];
  const total = issues.length;

  return (
    <div
      className="fixed inset-0 bg-background/60 backdrop-blur-[2px] flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <motion.div
        className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-[600px] h-[480px] overflow-hidden flex flex-col"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <span className="text-[11.7px] font-medium text-foreground">Issues</span>
            {total > 1 && (
              <span className="text-[9.9px] text-muted-foreground tabular-nums">
                {index + 1} of {total}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4 flex-1 overflow-y-auto">

          {/* Severity badge */}
          <div>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9.9px] font-medium border ${
                issue.severity === "error"
                  ? "bg-foreground border-foreground text-background"
                  : "bg-muted border-border text-foreground"
              }`}
            >
              {issue.severity === "error"
                ? <AlertCircle className="w-3 h-3" />
                : <AlertTriangle className="w-3 h-3" />
              }
              {issue.severity === "error" ? "Error" : "Warning"}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-[13.5px] font-semibold text-foreground leading-snug">
            {issue.title}
          </h3>

          {/* Breadcrumb path */}
          <div className="flex items-center flex-wrap gap-1 text-[9.9px] text-muted-foreground">
            <span>{issue.connectorName}</span>
            {issue.datasetName && <><span>›</span><span className="font-mono">{issue.datasetName}</span></>}
            {issue.tableName && <><span>›</span><span className="font-mono">{issue.tableName}</span></>}
            {issue.columnName && <><span>›</span><span className="font-mono">{issue.columnName}</span></>}
          </div>

          <div className="border-t border-border" />

          {/* Agent + timestamp — above the detail */}
          <div className="flex items-center gap-2 text-[9.9px] text-muted-foreground">
            <AgentsIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="font-medium text-foreground/70">{issue.agentName}</span>
            <span>·</span>
            <span>Detected {issue.detectedAt}</span>
          </div>

          {/* Description */}
          <p className="text-[11.7px] text-foreground/80 leading-relaxed">
            {issue.description}
          </p>

          {/* Suggested fix */}
          {issue.suggestedFix && (
            <div
              className="rounded-lg px-4 py-3 space-y-1"
              style={{ background: "var(--connector-surface)", border: "1px solid var(--connector-border)" }}
            >
              <p className="text-[9.9px] font-medium text-muted-foreground uppercase tracking-wide">
                Suggested fix
              </p>
              <p className="text-[10.8px] text-foreground/80 leading-relaxed">
                {issue.suggestedFix}
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        {total > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-border">
            <button
              onClick={() => setIndex(i => Math.max(0, i - 1))}
              disabled={index === 0}
              className="flex items-center gap-1.5 text-[10.8px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </button>

            <div className="flex items-center gap-1.5">
              {issues.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIndex(i)}
                  className={`rounded-full transition-all duration-150 ${
                    i === index
                      ? "w-2 h-2 bg-foreground"
                      : "w-1.5 h-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                  }`}
                />
              ))}
            </div>

            <button
              onClick={() => setIndex(i => Math.min(total - 1, i + 1))}
              disabled={index === total - 1}
              className="flex items-center gap-1.5 text-[10.8px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
