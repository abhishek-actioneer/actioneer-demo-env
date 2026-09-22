"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, Circle, Wrench, RotateCcw } from "lucide-react";
import type { PlaybookV2, PlaybookExecutionStateV2 } from "@/lib/playbook-types";

interface RunStatusPaneProps {
  playbook: PlaybookV2;
  execState: PlaybookExecutionStateV2;
  onAutoFix?: (cellId: string) => void;
  onNewRun?: () => void;
  isAutoFixing?: string | null;
}

export function RunStatusPane({
  playbook,
  execState,
  onAutoFix,
  onNewRun,
  isAutoFixing,
}: RunStatusPaneProps) {
  const isRunning = execState.status === "running";
  const isDone = execState.status === "done";
  const isError = execState.status === "error";

  const cellsWithStatus = playbook.cells.map((cell) => ({
    ...cell,
    execStatus: execState.cellStatuses[cell.id] ?? "idle",
    result: execState.cellResults[cell.id],
  }));

  const completedCount = cellsWithStatus.filter((c) => c.execStatus === "done").length;
  const errorCells = cellsWithStatus.filter((c) => c.execStatus === "error");
  const totalRows = cellsWithStatus.reduce((sum, c) => sum + (c.result?.rowCount ?? 0), 0);

  const headerLabel = isRunning
    ? "Running..."
    : isDone && errorCells.length === 0
    ? "Run complete"
    : `${errorCells.length} cell${errorCells.length !== 1 ? "s" : ""} failed`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-5">
        {/* Status header */}
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isRunning && <SpinnerIcon className="w-3.5 h-3.5 text-muted-foreground" />}
              {isDone && errorCells.length === 0 && (
                <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
              )}
              {((isDone && errorCells.length > 0) || isError) && (
                <XCircle className="w-3.5 h-3.5 text-foreground" />
              )}
              <span className="text-sm font-semibold">{headerLabel}</span>
            </div>
            {(isDone || isError) && onNewRun && (
              <button
                onClick={onNewRun}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9.9px] font-medium border border-border rounded-md hover:bg-muted transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Back to Playbook
              </button>
            )}
          </div>
          {(isDone || isError) && (
            <p className="text-[9.9px] text-muted-foreground mt-1">
              {completedCount} of {playbook.cells.length} cells completed
              {totalRows > 0 && ` · ${totalRows.toLocaleString()} rows`}
            </p>
          )}
        </div>

        <div className="border-b border-border" />

        {/* Cell list */}
        <div className="space-y-0">
          {cellsWithStatus.map((cell, idx) => {
            const isFixingThis = isAutoFixing === cell.id;
            const isLast = idx === cellsWithStatus.length - 1;

            return (
              <div key={cell.id} className="relative">
                {/* Connector line between items */}
                {!isLast && (
                  <div className="absolute left-[6px] top-6 w-px bg-border" style={{ height: "calc(100% - 12px)" }} />
                )}

                <div className="flex items-start gap-3 py-2.5">
                  {/* Status icon */}
                  <div className="shrink-0 mt-0.5 w-3.5 flex items-center justify-center">
                    <CellStatusIcon status={cell.execStatus} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[11.7px] font-medium leading-snug ${
                          cell.execStatus === "idle" || cell.execStatus === "waiting"
                            ? "text-muted-foreground/60"
                            : ""
                        }`}
                      >
                        {cell.label}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground/50 uppercase">
                        {cell.type}
                      </span>
                    </div>

                    {cell.execStatus === "running" && (
                      <AnimatedStatusMessage type={cell.type} cellLabel={cell.label} />
                    )}

                    {cell.execStatus === "done" && cell.result && (
                      <p className="text-[9.9px] text-muted-foreground mt-0.5">
                        {[
                          cell.result.rowCount != null
                            ? `${cell.result.rowCount.toLocaleString()} rows`
                            : null,
                          cell.result.timeMs != null ? `${cell.result.timeMs}ms` : null,
                          cell.result.rowCount == null && cell.result.content ? "Done" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}

                    {cell.execStatus === "error" && cell.result?.error && (
                      <div className="mt-1.5">
                        {cell.result.error.length > 120 ? (
                          <details>
                            <summary className="text-[9.9px] text-foreground font-mono leading-relaxed break-words cursor-pointer select-none">
                              {cell.result.error.slice(0, 120)}…
                            </summary>
                            <p className="text-[9.9px] text-foreground font-mono leading-relaxed break-words mt-1">
                              {cell.result.error}
                            </p>
                          </details>
                        ) : (
                          <p className="text-[9.9px] text-foreground font-mono leading-relaxed break-words">
                            {cell.result.error}
                          </p>
                        )}
                        {onAutoFix && cell.type === "sql" && (
                          <button
                            onClick={() => onAutoFix(cell.id)}
                            disabled={!!isAutoFixing}
                            className="mt-2 flex items-center gap-1.5 px-2.5 py-1.5 text-[9.9px] font-medium border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isFixingThis ? (
                              <>
                                <SpinnerIcon className="w-3 h-3" />
                                Analyzing error…
                              </>
                            ) : (
                              <>
                                <Wrench className="w-3 h-3" />
                                Try Auto-Fix
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {cell.execStatus === "blocked" && (
                      <p className="text-[9.9px] text-muted-foreground/40 mt-0.5">
                        Skipped: dependency failed.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──

function CellStatusIcon({ status }: { status: string }) {
  if (status === "running") {
    return <SpinnerIcon className="w-3.5 h-3.5 text-muted-foreground" />;
  }
  if (status === "done") {
    return <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />;
  }
  if (status === "error") {
    return <XCircle className="w-3.5 h-3.5 text-foreground" />;
  }
  // idle / waiting / blocked
  return <Circle className="w-3.5 h-3.5 text-muted-foreground/25" />;
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="28"
        strokeDashoffset="7"
        strokeLinecap="round"
      />
    </svg>
  );
}

const SQL_MESSAGES = [
  "Querying database…",
  "Fetching rows…",
  "Processing results…",
];

const LLM_MESSAGES = [
  "Analyzing data…",
  "Generating insights…",
  "Synthesizing…",
];

function AnimatedStatusMessage({ type, cellLabel }: { type: string; cellLabel?: string }) {
  const messages = type === "sql" ? SQL_MESSAGES : LLM_MESSAGES;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIdx((prev) => (prev + 1) % messages.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [messages.length]);

  // Show actual cell name if available, with a rotating sub-status
  const displayText = cellLabel
    ? `Running: ${cellLabel}…`
    : messages[idx];

  return (
    <p className="text-[9.9px] text-muted-foreground mt-0.5 transition-all duration-300">
      {displayText}
      {cellLabel && (
        <span className="text-muted-foreground/50 ml-1">{messages[idx]}</span>
      )}
    </p>
  );
}
