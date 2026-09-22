"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { ShieldCheck, ShieldAlert, Loader2, GitBranch, RefreshCw, Trash2, Sparkles } from "lucide-react";
import {
  Calendar as CalendarIcon,
  FlaskConical,
  ChevronRight,
  FileText,
  History,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { format, parse } from "date-fns";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type {
  PlaybookV2,
  PlaybookExecutionStateV2,
  PlaybookParam,
  PlaybookRunHistory,
  AnyPlaybook,
} from "@/lib/playbook-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Display date — handles ISO strings (new runs) and legacy human-readable strings */
function formatRunDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr; // legacy format — return as-is
  return format(d, "MMM d, yyyy · h:mm a");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface PlaybookInfoPanelProps {
  playbook: PlaybookV2;
  onRun?: (paramOverrides: Record<string, string>) => void;
  executionState?: PlaybookExecutionStateV2;
  onPlaybookUpdate?: (changes: Partial<AnyPlaybook>) => void;
  completedRunKey?: number;
  /** Increments when LLM applies changes — auto-switches to Changelog tab */
  pendingChangesKey?: number;
  /** Navigate canvas to a cell when user clicks a diff or audit error */
  onCellClick?: (cellId: string) => void;
  /** Re-run the audit on pending changes */
  onRerunAudit?: () => void;
  /** Open a new chat pre-loaded with output tables from a specific run */
  onChatWithRunData?: (run: PlaybookRunHistory) => void;
  /** Open the consumer-facing output artifact in the main workspace */
  onOpenLatestOutput?: () => void;
  /** Delete this playbook */
  onDelete?: () => void;
  /** Auto-fix a cell's SQL using LLM — takes cellId and error string */
  onAutoFixCell?: (cellId: string, error: string) => Promise<void>;
  /** Callback when validation results change — used to reflect status on canvas */
  onValidationResults?: (results: Array<{ cellId: string; valid: boolean; error?: string }> | null) => void;
  /** True while the wizard is streaming cells in. Disables Dry Run since cell bodies arrive after type tags. */
  isGenerating?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PlaybookInfoPanel({
  playbook,
  onRun,
  executionState,
  onPlaybookUpdate,
  completedRunKey,
  pendingChangesKey,
  onCellClick,
  onRerunAudit,
  onChatWithRunData,
  onOpenLatestOutput,
  onDelete,
  onAutoFixCell,
  onValidationResults,
  isGenerating = false,
}: PlaybookInfoPanelProps) {
  const isRunning = executionState?.status === "running";
  const editable = !!onPlaybookUpdate;

  // Param values — only applied at runtime (not saved to playbook)
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const p of playbook.params) map[p.name] = p.defaultVal;
    return map;
  });

  const [validating, setValidating] = useState(false);
  const [fixingCellIds, setFixingCellIds] = useState<Set<string>>(new Set());
  const [validationResults, setValidationResults] = useState<
    Array<{ cellId: string; valid: boolean; error?: string }> | null
  >(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Run confirmation (B1)
  const [confirmRun, setConfirmRun] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup confirm timeout on unmount
  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, []);

  // Tab state
  const [activeTab, setActiveTab] = useState<"description" | "changelog">("description");

  // When a run completes, hand off the consumer-facing output to the main workspace.
  useEffect(() => {
    if (!completedRunKey) return;
    onOpenLatestOutput?.();
  }, [completedRunKey, onOpenLatestOutput]);

  // When LLM applies pending changes: auto-switch to Changelog tab
  useEffect(() => {
    if (!pendingChangesKey) return;
    setActiveTab("changelog");
  }, [pendingChangesKey]);

  const paramGroups = useMemo(() => {
    const groups = new Map<string, PlaybookParam[]>();
    for (const p of playbook.params) {
      const key = p.group ?? "Parameters";
      const list = groups.get(key) ?? [];
      list.push(p);
      groups.set(key, list);
    }
    return groups;
  }, [playbook.params]);

  function handleRunClick() {
    if (hasValidationErrors) {
      toast.error("Fix validation issues before running the playbook.");
      return;
    }
    // Show inline confirmation first
    setConfirmRun(true);
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    confirmTimeoutRef.current = setTimeout(() => setConfirmRun(false), 5000);
  }

  function handleConfirmRun() {
    setConfirmRun(false);
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    onRun?.(paramValues);
  }

  function handleResetDefaults() {
    const map: Record<string, string> = {};
    for (const p of playbook.params) map[p.name] = p.defaultVal;
    setParamValues(map);
  }

  async function handleDryRun() {
    setValidating(true);
    setValidationResults(null);
    setValidationError(null);
    onValidationResults?.(null);
    try {
      const data = await apiFetch<{
        results?: Array<{ cellId: string; valid: boolean; error?: string }>;
        error?: string;
        reason?: string;
      }>("/api/playbook/validate", {
        method: "POST",
        body: {
          cells: playbook.cells,
          params: playbook.params,
          paramOverrides: paramValues,
          datasetId: playbook.datasetId,
        },
        skipModel: true,
      });
      const results = data.results ?? [];
      setValidationResults(results);
      if (data.error) setValidationError(data.error);
      onValidationResults?.(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Dry run failed.";
      setValidationError(message);
      setValidationResults([]);
      onValidationResults?.([]);
      toast.error(message);
    } finally {
      setValidating(false);
    }
  }

  async function handleFixCell(cellId: string, error: string) {
    if (!onAutoFixCell) return;
    setFixingCellIds((prev) => new Set([...prev, cellId]));
    try {
      await onAutoFixCell(cellId, error);
    } catch {
      // error handled by parent
    } finally {
      setFixingCellIds((prev) => {
        const next = new Set(prev);
        next.delete(cellId);
        // Re-run validation when all fixes complete
        if (next.size === 0) setTimeout(handleDryRun, 100);
        return next;
      });
    }
  }

  async function handleFixAll() {
    if (!onAutoFixCell || !validationResults) return;
    const failed = validationResults.filter((r) => !r.valid && r.error);
    if (failed.length === 0) return;
    // Fire all fix requests in parallel
    await Promise.allSettled(failed.map((r) => handleFixCell(r.cellId, r.error!)));
  }

  // Whether validation found errors (B7 — warning above Run button)
  const hasValidationErrors = Boolean(validationError) || (validationResults?.some((r) => !r.valid) ?? false);

  // Shared Run Playbook button (reused in header and bottom of Inputs)
  const RunButton = ({ full = false }: { full?: boolean }) => {
    if (confirmRun && !isRunning) {
      // Inline confirmation state (B1)
      return (
        <div className={`space-y-1.5 ${full ? "w-full" : ""}`}>
          <div className="text-[9.9px] text-muted-foreground">
            {Object.keys(paramValues).length > 0 ? (
              <span>
                Run with{" "}
                {Object.entries(paramValues)
                  .slice(0, 3)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(", ")}
                {Object.keys(paramValues).length > 3 ? ` +${Object.keys(paramValues).length - 3} more` : ""}
              </span>
            ) : (
              <span>Run with default parameters?</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleConfirmRun}
              className={`flex items-center gap-1.5 px-4 py-2.5 bg-foreground hover:bg-foreground/90 active:scale-[0.97] text-background text-sm font-medium rounded-lg transition-[background-color,transform] ${full ? "flex-1 justify-center" : ""}`}
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmRun(false)}
              className="text-[9.9px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={`${full ? "w-full" : ""}`}>
        {/* B7: Validation warning */}
        {hasValidationErrors && (
          <p className="text-[9.9px] text-muted-foreground mb-1.5">
            {"\u26A0"} Validation issues found.
          </p>
        )}
        <button
          onClick={handleRunClick}
          disabled={isRunning || hasValidationErrors}
          className={`flex items-center gap-1.5 px-4 py-2.5 bg-foreground hover:bg-foreground/90 active:scale-[0.97] text-background text-sm font-medium rounded-lg transition-[background-color,transform] disabled:opacity-50 disabled:cursor-not-allowed ${full ? "w-full justify-center" : ""}`}
        >
          {isRunning ? (
            <>
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="7" strokeLinecap="round" />
              </svg>
              Running...
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M4 2L13 8L4 14V2Z" fill="currentColor" />
              </svg>
              Run Playbook
            </>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ─── TAB BAR + delete ────────────────────────────── */}
      <div className="border-b border-border shrink-0 px-5">
        <div className="flex items-center">
          {(["description", "changelog"] as const).map((tab, i) => {
            const hasPendingReview = tab === "changelog" && playbook.pendingChanges?.reviewStatus === "pending_review";
            const hasDraft = tab === "changelog" && (playbook.pendingChanges?.cellDiffs.length ?? 0) > 0 && playbook.pendingChanges?.reviewStatus !== "pending_review";
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative pr-3 py-2.5 text-[10.8px] font-medium border-b-2 transition-colors -mb-px ${i === 0 ? "pl-0" : "pl-3"} ${
                  activeTab === tab
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "description" ? "Description & Inputs" : "Changelog"}
                {hasPendingReview && (
                  <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-foreground align-middle mb-0.5" />
                )}
                {hasDraft && (
                  <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-foreground align-middle mb-0.5" />
                )}
              </button>
            );
          })}
          {onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 -mb-px">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Playbook?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete &ldquo;{playbook.name}&rdquo; and all its run history. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* ─── TAB CONTENT ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-5">

          {activeTab === "description" && (
            <div className="space-y-3">

              {/* Description card */}
              <div className="rounded-lg overflow-hidden" style={{ boxShadow: "0 0 0 1px var(--color-border)" }}>
                <div className="px-3.5 py-3 space-y-2">
                  {editable ? (
                    <EditableText
                      value={playbook.description}
                      onSave={(v) => onPlaybookUpdate?.({ description: v })}
                      className="text-[11.7px] text-muted-foreground leading-relaxed"
                      multiline
                    />
                  ) : (
                    <p className="text-[11.7px] text-muted-foreground leading-relaxed">
                      {playbook.description || <span className="italic">No description</span>}
                    </p>
                  )}
                  <div className="flex items-center justify-end pt-1.5 border-t border-border/40">
                    <button
                      onClick={handleDryRun}
                      disabled={validating || isRunning || isGenerating}
                      title={isGenerating ? "Generation in progress. Cell bodies are still streaming" : undefined}
                      className="flex items-center gap-1 text-[9.9px] text-muted-foreground hover:text-foreground active:scale-[0.97] transition-[color,transform] disabled:opacity-40"
                    >
                      <FlaskConical className="w-2.5 h-2.5" />
                      {isGenerating ? "Generating…" : validating ? "Validating…" : "Dry Run"}
                    </button>
                  </div>
                </div>

                {/* Dry run results inside card */}
                {validationResults && (
                  <div className="border-t border-border px-3.5 py-3 space-y-2 bg-muted/20">
                    {validationResults.length === 0 ? (
                      <p className="text-[9.9px] text-muted-foreground">
                        {isGenerating
                          ? "Generation still in progress. Wait for cells to finish building before validating."
                          : (validationError ?? "No SQL cells to validate.")}
                      </p>
                    ) : (
                      <>
                        {validationResults.map((r) => {
                          const cell = playbook.cells.find((c) => c.id === r.cellId);
                          const isFixing = fixingCellIds.has(r.cellId);
                          return (
                            <div key={r.cellId} className="flex items-start gap-2">
                              <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${r.valid ? "bg-emerald-500" : "bg-red-500"}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-[10.8px] font-medium">{cell?.label ?? r.cellId}</p>
                                  {!r.valid && r.error && onAutoFixCell && (
                                    <button
                                      onClick={() => handleFixCell(r.cellId, r.error!)}
                                      disabled={isFixing || fixingCellIds.size > 0}
                                      className="ml-auto shrink-0 flex items-center gap-1 px-2 py-0.5 text-[9px] font-medium text-foreground bg-background border border-border rounded-md hover:bg-muted active:scale-[0.97] transition-[background-color,transform] disabled:opacity-40"
                                    >
                                      {isFixing ? (
                                        <>
                                          <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 16 16" fill="none">
                                            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="7" strokeLinecap="round" />
                                          </svg>
                                          Fixing...
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles className="w-2.5 h-2.5" />
                                          Fix
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>
                                {r.error && (() => {
                                  // Parse "Did you mean" suggestion from DuckDB error
                                  const suggestion = r.error!.match(/Did you mean "(\w+)"/)?.[1];
                                  const wrongName = r.error!.match(/Table with name (\w+) does not exist/i)?.[1]
                                    ?? r.error!.match(/column[:\s]+"?(\w+)"?.*not found/i)?.[1];
                                  return (
                                    <>
                                      <p className="text-[9.9px] text-muted-foreground mt-0.5 font-mono break-all">{r.error}</p>
                                      {suggestion && wrongName && onAutoFixCell && (
                                        <button
                                          onClick={() => {
                                            // Direct find-replace, no LLM call
                                            const cell = playbook.cells.find((c) => c.id === r.cellId);
                                            if (cell?.sql) {
                                              const fixed = cell.sql.replace(new RegExp(`\\b${wrongName}\\b`, "gi"), suggestion);
                                              if (fixed !== cell.sql) {
                                                onPlaybookUpdate?.({
                                                  cells: playbook.cells.map((c) =>
                                                    c.id === r.cellId ? { ...c, sql: fixed } : c
                                                  ),
                                                } as Partial<AnyPlaybook>);
                                                handleDryRun();
                                              }
                                            }
                                          }}
                                          className="mt-1 flex items-center gap-1 px-2 py-1 text-[9px] font-medium rounded-md bg-muted/50 hover:bg-muted text-foreground active:scale-[0.97] transition-[background-color,transform]"
                                        >
                                          Use <span className="font-mono">{suggestion}</span> instead
                                        </button>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}
                        {validationResults.filter((r) => !r.valid).length > 1 && onAutoFixCell && (
                          <button
                            onClick={handleFixAll}
                            disabled={fixingCellIds.size > 0}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[9.9px] font-medium text-foreground bg-background border border-border rounded-md hover:bg-muted active:scale-[0.97] transition-[background-color,transform] disabled:opacity-40 mt-1"
                          >
                            {fixingCellIds.size > 1 ? (
                              <>
                                <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="7" strokeLinecap="round" />
                                </svg>
                                Fixing {fixingCellIds.size} cells...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3" />
                                Fix All Errors
                              </>
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {playbook.runHistory.length > 0 && (
                <button
                  onClick={onOpenLatestOutput}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 border border-border rounded-lg hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <FileText className="w-3 h-3 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10.8px] font-medium">Latest output artifact</p>
                    <p className="text-[9.9px] text-muted-foreground truncate">
                      {formatRunDate(playbook.runHistory[0].date)}
                      {playbook.runHistory[0].durationMs != null ? ` · ${formatDuration(playbook.runHistory[0].durationMs)}` : ""}
                    </p>
                  </div>
                  {onChatWithRunData && (playbook.runHistory[0].cellSummaries ?? []).some((s) => s.preview && s.preview.length > 0) && (
                    <span
                      onClick={(event) => {
                        event.stopPropagation();
                        onChatWithRunData(playbook.runHistory[0]);
                      }}
                      role="button"
                      tabIndex={0}
                      className="shrink-0 rounded border border-border px-2 py-1 text-[9px] text-muted-foreground hover:text-foreground"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          onChatWithRunData(playbook.runHistory[0]);
                        }
                      }}
                    >
                      Chat
                    </span>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                </button>
              )}

              {/* Inputs section card */}
              {playbook.params.length > 0 && (
                <div className="rounded-lg overflow-hidden" style={{ boxShadow: "0 0 0 1px var(--color-border)" }}>
                  <div className="px-3.5 py-2 border-b border-border/40 flex items-center">
                    <span className="text-[9.9px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Inputs
                    </span>
                    <span className="text-[9.9px] text-muted-foreground/40 ml-1.5">{playbook.params.length}</span>
                    <button
                      onClick={handleResetDefaults}
                      className="ml-auto text-[9px] text-muted-foreground/50 hover:text-foreground transition-colors"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="px-3.5 py-3 space-y-3">
                    {Array.from(paramGroups.entries()).map(([group, params]) => (
                      <div key={group}>
                        {paramGroups.size > 1 && (
                          <p className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-2">
                            {group}
                          </p>
                        )}
                        <div className="space-y-3">
                          {params.map((param) => (
                            <ParamInput
                              key={param.name}
                              param={param}
                              value={paramValues[param.name] ?? param.defaultVal}
                              onChange={(val) =>
                                setParamValues((prev) => ({ ...prev, [param.name]: val }))
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tables Used — all tables referenced across all cells */}
              {(() => {
                // SQL noise words that can appear after FROM/JOIN but aren't table names
                const SQL_NOISE = new Set([
                  "select", "where", "group", "order", "having", "limit", "as", "on",
                  "and", "or", "not", "in", "is", "null", "true", "false", "case",
                  "when", "then", "else", "end", "between", "like", "exists", "all",
                  "any", "union", "except", "intersect", "values", "set", "into",
                  // Common English words that leak through SQL comments or malformed queries
                  "the", "a", "an", "of", "to", "for", "with", "by", "at", "it",
                  "this", "that", "each", "every", "both", "its", "are", "were",
                  "being", "been", "have", "has", "had", "will", "would", "could",
                  "should", "may", "might", "can", "did", "does", "do", "but",
                  "which", "what", "who", "how", "than", "more", "most", "some",
                  "only", "also", "just", "above", "below", "over", "under",
                  "using", "based", "within", "across", "through", "during",
                  "after", "before", "since", "until", "about", "into",
                  "lateral", "unnest", "generate_series", "range",
                ]);

                const tables = new Set<string>();
                for (const cell of playbook.cells) {
                  if (cell.sql) {
                    // Collect ALL CTE alias names — handles WITH x AS, comma-separated CTEs, and RECURSIVE
                    const cteAliases = new Set<string>();
                    const allCtePattern = /(?:WITH\s+(?:RECURSIVE\s+)?|,\s*)([a-z_]\w*)\s+AS\s*\(/gi;
                    let cm: RegExpExecArray | null;
                    while ((cm = allCtePattern.exec(cell.sql)) !== null) {
                      cteAliases.add(cm[1].toLowerCase());
                    }

                    const pattern = /\b(?:FROM|JOIN)\s+([a-z_]\w*)/gi;
                    let m: RegExpExecArray | null;
                    while ((m = pattern.exec(cell.sql)) !== null) {
                      const name = m[1].toLowerCase();
                      // Real table names: have underscores, or are long enough to not be English words
                      if (!SQL_NOISE.has(name) && !cteAliases.has(name) && name.length > 1 && (name.includes("_") || name.length >= 5)) {
                        tables.add(name);
                      }
                    }
                  }
                }
                if (tables.size === 0) return null;
                return (
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">
                      Data Sources
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(tables).sort().map((t) => (
                        <span key={t} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-[9.9px] font-mono text-muted-foreground">
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0">
                            <ellipse cx="8" cy="4" rx="5.5" ry="2.5" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M2.5 4v8c0 1.38 2.46 2.5 5.5 2.5s5.5-1.12 5.5-2.5V4" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M2.5 8c0 1.38 2.46 2.5 5.5 2.5s5.5-1.12 5.5-2.5" stroke="currentColor" strokeWidth="1.2" />
                          </svg>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Changelog link — directs to Changelog tab */}
              {((playbook.changelog?.length ?? 0) > 0 || (playbook.pendingChanges?.cellDiffs.length ?? 0) > 0) && (
                <button
                  onClick={() => setActiveTab("changelog")}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 border border-border rounded-lg hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <History className="w-3 h-3 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10.8px] font-medium">Changelog</p>
                    <p className="text-[9.9px] text-muted-foreground truncate">
                      {(playbook.pendingChanges?.cellDiffs.length ?? 0) > 0
                        ? `${playbook.pendingChanges!.cellDiffs.length} pending change${playbook.pendingChanges!.cellDiffs.length !== 1 ? "s" : ""}`
                        : playbook.changelog[0]?.summary ?? ""}
                    </p>
                  </div>
                  {playbook.pendingChanges?.reviewStatus === "pending_review" ? (
                    <span className="w-2 h-2 rounded-full bg-foreground shrink-0" />
                  ) : (playbook.pendingChanges?.cellDiffs.length ?? 0) > 0 ? (
                    <span className="w-2 h-2 rounded-full bg-foreground shrink-0" />
                  ) : (
                    <span className="text-[9px] text-muted-foreground/60 tabular-nums shrink-0">
                      {playbook.changelog?.length ?? 0}
                    </span>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                </button>
              )}
            </div>
          )}

          {activeTab === "changelog" && (
            <ChangelogTab
              playbook={playbook}
              onPlaybookUpdate={onPlaybookUpdate}
              onCellClick={onCellClick}
              onRerunAudit={onRerunAudit}
            />
          )}

        </div>
    </div>

      {/* ─── STICKY RUN FOOTER ─────────────────────────────── */}
      <div className="shrink-0 px-5 py-3" style={{ boxShadow: "0 -1px 0 var(--color-border)" }}>
        <RunButton full />
      </div>

    </div>
  );
}

// ── Changelog Tab ────────────────────────────────────────────────────────────

function ChangelogTab({
  playbook,
  onPlaybookUpdate,
  onCellClick,
  onRerunAudit,
}: {
  playbook: PlaybookV2;
  onPlaybookUpdate?: (changes: Partial<AnyPlaybook>) => void;
  onCellClick?: (cellId: string) => void;
  onRerunAudit?: () => void;
}) {
  const pending = playbook.pendingChanges;
  const hasDiffs = (pending?.cellDiffs.length ?? 0) > 0;
  const isPendingReview = pending?.reviewStatus === "pending_review";

  function handleSubmitForReview() {
    if (!pending) return;
    onPlaybookUpdate?.({
      pendingChanges: {
        ...pending,
        reviewStatus: "pending_review" as const,
        submittedAt: new Date().toISOString(),
        submittedBy: "You",
      },
    } as Partial<AnyPlaybook>);
  }

  function handleApprove() {
    if (!pending) return;
    // Bump minor version
    const [, major, minor] = playbook.version.match(/v?(\d+)\.(\d+)/) ?? ["", "1", "0"];
    const newVersion = `v${major}.${parseInt(minor, 10) + 1}`;
    onPlaybookUpdate?.({ pendingChanges: undefined, version: newVersion });
  }

  function handleRequestChanges() {
    if (!pending) return;
    onPlaybookUpdate?.({
      pendingChanges: { ...pending, reviewStatus: "none" as const },
    });
  }

  return (
    <div className="space-y-5">

      {/* ── Pending Changes section ── */}
      {hasDiffs && (
        <div className="border border-border rounded-lg overflow-hidden">
          {/* Section header */}
          <div className={`px-3.5 py-2.5 flex items-center gap-2 border-b border-border ${
            isPendingReview ? "bg-muted" : "bg-muted"
          }`}>
            <div className={`w-2 h-2 rounded-full shrink-0 ${isPendingReview ? "bg-foreground" : "bg-foreground"}`} />
            <span className="text-[9.9px] font-semibold uppercase tracking-wider text-muted-foreground flex-1">
              {isPendingReview ? "Pending Approval" : "Pending Changes"}
            </span>
            {/* Audit status badge */}
            {pending?.auditStatus === "running" && (
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Auditing...
              </span>
            )}
            {pending?.auditStatus === "pass" && (
              <span className="flex items-center gap-1 text-[9px] text-foreground">
                <ShieldCheck className="w-3 h-3" />
                Audit passed
              </span>
            )}
            {pending?.auditStatus === "fail" && (
              <span className="flex items-center gap-1 text-[9px] text-foreground">
                <ShieldAlert className="w-3 h-3" />
                Audit issues
              </span>
            )}
            {pending?.auditStatus === "pending" && (
              <span className="text-[9px] text-muted-foreground/60">Audit pending</span>
            )}
          </div>

          {/* Submitted by (when in review) */}
          {isPendingReview && !!pending?.submittedAt && (
            <div className="px-3.5 py-2 border-b border-border/50 bg-muted/10">
              <p className="text-[9.9px] text-muted-foreground">
                Submitted by <span className="font-medium text-foreground">{pending?.submittedBy ?? "You"}</span>
                {" · "}{formatRunDate(pending.submittedAt)}
              </p>
            </div>
          )}

          {/* Audit errors */}
          {pending?.auditStatus === "fail" && (pending?.auditErrors?.length ?? 0) > 0 && (
            <div className="px-3.5 py-2.5 border-b border-border bg-muted space-y-1.5">
              {pending.auditErrors?.map((e) => (
                <div
                  key={e.cellId}
                  className="flex items-start gap-2 cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1 py-0.5"
                  onClick={() => onCellClick?.(e.cellId)}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground shrink-0 mt-1.5" />
                  <div className="min-w-0">
                    <p className="text-[10.8px] font-medium text-foreground">{e.cellLabel}</p>
                    <p className="text-[9.9px] text-muted-foreground truncate">{e.error}</p>
                  </div>
                </div>
              ))}
              {onRerunAudit && (
                <button
                  onClick={onRerunAudit}
                  className="mt-1 flex items-center gap-1.5 text-[9.9px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  Re-run Audit
                </button>
              )}
            </div>
          )}

          {/* Cell diff summaries */}
          <div className="divide-y divide-border/50">
            {pending?.cellDiffs.map((diff) => (
              <div
                key={diff.cellId}
                className="px-3.5 py-2.5 flex items-start gap-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => onCellClick?.(diff.cellId)}
              >
                <span className={`text-[9.9px] font-mono font-bold shrink-0 mt-0.5 w-3 ${
                  diff.changeType === "added" ? "text-foreground" :
                  diff.changeType === "removed" ? "text-foreground" :
                  "text-foreground"
                }`}>
                  {diff.changeType === "added" ? "+" : diff.changeType === "removed" ? "−" : "~"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10.8px] font-medium">{diff.cellLabel}</p>
                  <p className="text-[9.9px] text-muted-foreground">
                    {diff.changeType === "added" ? "New cell added" :
                     diff.changeType === "removed" ? "Cell removed" :
                     [
                       diff.sqlDiff && "SQL",
                       diff.promptDiff && "Prompt",
                       diff.labelDiff && "Label",
                       diff.descriptionDiff && "Description",
                     ].filter(Boolean).join(", ") + " updated"}
                  </p>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${
                  diff.changeType === "added" ? "text-foreground border-border bg-muted" :
                  diff.changeType === "removed" ? "text-foreground border-border bg-muted" :
                  "text-foreground border-border bg-muted"
                }`}>
                  {diff.changeType}
                </span>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className={`px-3.5 py-2.5 border-t border-border ${isPendingReview ? "bg-muted/10" : ""}`}>
            {!isPendingReview ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[9.9px] text-muted-foreground">
                  Review changes above, then submit for approval.
                </p>
                <button
                  onClick={handleSubmitForReview}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background text-[9.9px] font-medium rounded-md hover:bg-foreground/90 transition-colors shrink-0"
                >
                  <GitBranch className="w-3 h-3" />
                  Submit for Review
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-[9.9px] text-muted-foreground flex-1">
                  Approve to apply as version {(() => {
                    const [, major, minor] = playbook.version.match(/v?(\d+)\.(\d+)/) ?? ["", "1", "0"];
                    return `v${major}.${parseInt(minor, 10) + 1}`;
                  })()}
                </p>
                <button
                  onClick={handleRequestChanges}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-border text-[9.9px] font-medium rounded-md hover:bg-muted/40 transition-colors text-muted-foreground"
                >
                  <RefreshCw className="w-3 h-3" />
                  Request Changes
                </button>
                <button
                  onClick={handleApprove}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background text-[9.9px] font-medium rounded-md hover:bg-foreground/90 transition-colors"
                >
                  <ShieldCheck className="w-3 h-3" />
                  Approve
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Approved history (existing changelog entries) ── */}
      {(playbook.changelog?.length ?? 0) > 0 ? (
        <div className="space-y-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {hasDiffs ? "Approved History" : "Change History"}
          </p>
          <div className="relative">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
            <div className="space-y-5">
              {playbook.changelog.map((entry, idx) => (
                <div key={idx} className="relative pl-7">
                  <div className="absolute left-0 top-[5px] w-[15px] h-[15px] rounded-full border-2 border-border bg-background flex items-center justify-center">
                    <div className="w-[5px] h-[5px] rounded-full bg-muted-foreground/50" />
                  </div>
                  <p className="text-[9.9px] font-medium text-muted-foreground mb-1">{entry.date}</p>
                  <p className="text-[11.7px] font-medium leading-snug mb-1.5">{entry.summary}</p>
                  <div className="space-y-1">
                    {entry.changes.map((change, cIdx) => (
                      <div key={cIdx} className="flex items-start gap-2">
                        <span className={`text-[9.9px] font-mono font-semibold mt-px shrink-0 ${
                          change.type === "add" ? "text-foreground" :
                          change.type === "remove" ? "text-foreground" :
                          "text-muted-foreground"
                        }`}>
                          {change.type === "add" ? "+" : change.type === "remove" ? "−" : "~"}
                        </span>
                        <div className="text-[10.8px]">
                          <span className="font-medium">{change.cellLabel}</span>
                          {change.detail && <span className="text-muted-foreground">: {change.detail}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {idx < playbook.changelog.length - 1 && (
                    <div className="border-b border-border/40 mt-4" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : !hasDiffs && (
        <p className="text-[11.7px] text-muted-foreground italic py-2">
          No change history yet. Apply AI suggestions to track changes here.
        </p>
      )}

    </div>
  );
}

// ── Inline editable text ──────────────────────────────────────────────────────

function EditableText({
  value,
  onSave,
  className = "",
  multiline = false,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  function startEdit() {
    setDraft(value);
    setEditing(true);
    setTimeout(() => ref.current?.focus(), 0);
  }

  function commit() {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  }

  if (!editing) {
    return (
      <div
        onClick={startEdit}
        className={`cursor-text rounded px-1 -mx-1 hover:bg-muted/50 transition-colors ${className}`}
      >
        {value || <span className="text-muted-foreground/50 italic">Click to edit</span>}
      </div>
    );
  }

  if (multiline) {
    return (
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
        rows={3}
        className={`w-full rounded px-1 -mx-1 bg-muted/30 border border-border focus:outline-none focus:ring-1 focus:ring-ring/30 resize-y ${className}`}
      />
    );
  }

  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className={`w-full rounded px-1 -mx-1 bg-muted/30 border border-border focus:outline-none focus:ring-1 focus:ring-ring/30 ${className}`}
    />
  );
}

// ── Parameter Input ───────────────────────────────────────────────────────────

// Common presets for numeric "days" type params
const DAYS_PRESETS = [7, 14, 30, 60, 90];

function ParamInput({
  param,
  value,
  onChange,
}: {
  param: PlaybookParam;
  value: string;
  onChange: (val: string) => void;
}) {
  // Detect date-like params: explicit date type OR string params with date-like names and values
  const isDateParam = param.type === "date" ||
    (param.type === "string" && /date|start|end|from|until|since/i.test(param.label + param.name) && /^\d{4}-\d{2}-\d{2}/.test(value || param.defaultVal));

  const dateValue = useMemo(() => {
    if (!isDateParam || !value) return undefined;
    try {
      return parse(value.slice(0, 10), "yyyy-MM-dd", new Date());
    } catch {
      return undefined;
    }
  }, [isDateParam, value]);

  const isDaysParam = (param.type === "integer") &&
    /day|period|window|lookback|range/i.test(param.label + param.name);

  return (
    <div>
      <label className="block mb-1.5">
        <span className="text-xs font-medium">{param.label}</span>
      </label>

      {isDateParam ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              data-empty={!value}
              className="w-full justify-start text-left text-xs font-normal h-auto px-2.5 py-1.5 data-[empty=true]:text-muted-foreground"
            >
              <CalendarIcon className="w-3 h-3 mr-1.5 text-muted-foreground" />
              {dateValue ? format(dateValue, "PPP") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateValue}
              onSelect={(d) => { if (d) onChange(format(d, "yyyy-MM-dd")); }}
            />
          </PopoverContent>
        </Popover>

      ) : param.type === "boolean" ? (
        <button
          onClick={() => onChange(value === "true" ? "false" : "true")}
          className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
            value === "true"
              ? "bg-foreground/10 text-foreground"
              : "bg-muted/50 text-muted-foreground"
          }`}
          style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
        >
          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center transition-colors ${
            value === "true" ? "bg-foreground" : "bg-transparent"
          }`} style={{ boxShadow: value === "true" ? "none" : "0 0 0 1px var(--color-border)" }}>
            {value === "true" && (
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="var(--color-background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          {value === "true" ? "Enabled" : "Disabled"}
        </button>

      ) : isDaysParam ? (
        /* Days-type integer: chip presets + editable value */
        <div className="flex items-center gap-1.5">
          {DAYS_PRESETS.map((d) => (
            <button
              key={d}
              onClick={() => onChange(String(d))}
              className={`px-2 py-1 text-[9.9px] font-medium rounded-md transition-colors ${
                value === String(d)
                  ? "bg-foreground text-background"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              {d}d
            </button>
          ))}
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-14 px-2 py-1 text-[9.9px] text-center rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
          />
        </div>

      ) : param.type === "integer" || param.type === "float" ? (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          step={param.type === "float" ? "0.01" : undefined}
          className="w-full px-2.5 py-1.5 text-xs rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
        />

      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring/20"
          style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
        />
      )}
    </div>
  );
}
