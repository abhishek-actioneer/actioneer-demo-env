"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Check, ChevronRight, AlertCircle, Pencil, Loader2, ArrowRight } from "lucide-react";
import { SqlHighlighted } from "@/lib/sql-highlight";
import { apiFetch } from "@/lib/api-client";

interface MetricUpdateConfirmData {
  metricId: string;
  metricName: string;
  oldDescription: string;
  newDescription: string;
  oldSql: string;
  newSql: string;
  oldFormula: string;
  newFormula: string;
  explanation: string;
  affectedMetrics: string[];
  userRequest: string;
  status: "ready" | "published" | "dismissed" | "editing";
  suggestedRelatedMetrics?: string[];
  table?: string;
  valueSql?: string;
  timeSeriesSql?: string;
  computedValue?: number | null;
  sqlValid?: boolean;
  sqlErrors?: { valueSql?: string | null; timeSeriesSql?: string | null };
  newName?: string;
}

interface ManualSqlUpdateData {
  newSql: string;
  valueSql?: string;
  computedValue?: number | null;
  sqlValid: boolean;
  sqlErrors?: { valueSql?: string | null; timeSeriesSql?: string | null };
  newFormula?: string;
}

interface MetricUpdateConfirmCardProps {
  data: MetricUpdateConfirmData;
  msgId: string;
  onPublish: (msgId: string) => void;
  onEdit: (msgId: string, editRequest: string) => void;
  onManualSqlUpdate?: (msgId: string, data: ManualSqlUpdateData) => void;
  onNameChange?: (msgId: string, newName: string) => void;
  compact?: boolean;
}

const EDIT_CHIPS = [
  "Change aggregation",
  "Exclude nulls",
  "Use different column",
  "Add a filter",
  "Change time grain",
];

// ── Line-based diff (like Claude Code / git diff) ──

/** Line-based diff: red lines for removed, green lines for added */
function LineDiff({ label, before, after, mono }: { label: string; before: string; after: string; mono?: boolean }) {
  if (!after && !before) return null;
  const hasDiff = before.trim().length > 0 && before !== after;

  return (
    <div>
      {label && <p className="text-[9.9px] text-muted-foreground font-medium uppercase tracking-wider mb-2">{label}</p>}
      {hasDiff ? (
        <div className="rounded-sm overflow-hidden border border-border/40">
          {/* Removed line(s) */}
          <div className="bg-muted px-2.5 py-1.5 border-b border-border/30">
            <p className={`text-xs text-muted-foreground whitespace-pre-wrap break-words ${mono ? "font-mono" : ""}`}>
              <span className="text-muted-foreground/50 select-none mr-2">−</span>{before}
            </p>
          </div>
          {/* Added line(s) */}
          <div className="bg-muted px-2.5 py-1.5">
            <p className={`text-xs text-foreground whitespace-pre-wrap break-words ${mono ? "font-mono" : ""}`}>
              <span className="text-foreground/50 select-none mr-2">+</span>{after}
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-muted rounded-sm px-2.5 py-2">
          <p className={`text-xs text-foreground whitespace-pre-wrap break-words ${mono ? "font-mono" : ""}`}>{after}</p>
        </div>
      )}
    </div>
  );
}

/** Collapsible section wrapper with smooth height transition */
function Collapsible({ label, defaultOpen, className, children }: { label: string; defaultOpen: boolean; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[9.9px] text-muted-foreground font-medium uppercase tracking-wider hover:text-foreground transition-colors duration-150"
      >
        <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        {label}
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="mt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** SQL section with line-based diff + editable mode */
function SqlSection({
  oldSql,
  newSql,
  defaultOpen,
  disabled,
  onSqlValidated,
  metricName,
  description,
}: {
  oldSql: string;
  newSql: string;
  defaultOpen: boolean;
  disabled?: boolean;
  onSqlValidated?: (data: ManualSqlUpdateData) => void;
  metricName?: string;
  description?: string;
}) {
  const [isEditingSql, setIsEditingSql] = useState(false);
  const [sqlDraft, setSqlDraft] = useState(newSql);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [formulaSyncing, setFormulaSyncing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formulaAbortRef = useRef<AbortController | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (isEditingSql && textareaRef.current) {
      const ta = textareaRef.current;
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, [isEditingSql, sqlDraft]);

  const handleStartEdit = useCallback(() => {
    if (disabled) return;
    setSqlDraft(newSql);
    setIsEditingSql(true);
    setValidationError(null);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [newSql, disabled]);

  const handleCancel = useCallback(() => {
    setIsEditingSql(false);
    setSqlDraft(newSql);
    setValidationError(null);
  }, [newSql]);

  const handleValidate = useCallback(async () => {
    if (!sqlDraft.trim() || validating) return;
    setValidating(true);
    setValidationError(null);

    try {
      const result = await apiFetch<{
        sqlValid: boolean;
        sqlErrors: { valueSql?: string | null; timeSeriesSql?: string | null };
        computedValue: number | null;
        timeSeries: { date: string; value: number }[];
      }>("/api/metric-validate", {
        method: "POST",
        body: { timeSeriesSql: sqlDraft.trim() },
      });

      if (!result.sqlValid) {
        setValidationError(result.sqlErrors?.timeSeriesSql || "SQL validation failed");
        setValidating(false);
        return;
      }

      // SQL is valid — close editor and notify parent
      setIsEditingSql(false);
      setValidating(false);

      const updateData: ManualSqlUpdateData = {
        newSql: sqlDraft.trim(),
        computedValue: result.computedValue,
        sqlValid: true,
        sqlErrors: { valueSql: null, timeSeriesSql: null },
      };
      onSqlValidated?.(updateData);

      // Background formula sync
      if (metricName) {
        // Abort previous formula request
        formulaAbortRef.current?.abort();
        const abort = new AbortController();
        formulaAbortRef.current = abort;
        setFormulaSyncing(true);

        apiFetch<{ formula: string }>("/api/metric-formula", {
          method: "POST",
          body: { sql: sqlDraft.trim(), metricName, description: description || "" },
          signal: abort.signal,
        })
          .then((res) => {
            if (!abort.signal.aborted && res.formula) {
              onSqlValidated?.({ ...updateData, newFormula: res.formula });
            }
          })
          .catch(() => {
            // Formula sync is non-critical — silently fail
          })
          .finally(() => {
            if (!abort.signal.aborted) setFormulaSyncing(false);
          });
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Validation failed");
      setValidating(false);
    }
  }, [sqlDraft, validating, onSqlValidated, metricName, description]);

  if (!newSql) return null;
  const hasDiff = oldSql.trim().length > 0 && oldSql !== newSql;
  const sqlHasChanges = isEditingSql && sqlDraft.trim() !== newSql;

  return (
    <Collapsible label="SQL Query" defaultOpen={defaultOpen}>
      {isEditingSql ? (
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={sqlDraft}
            onChange={(e) => { setSqlDraft(e.target.value); setValidationError(null); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCancel();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleValidate();
            }}
            className="w-full px-2.5 py-2 text-[9.9px] font-mono bg-muted/30 border border-border rounded-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring/30 whitespace-pre-wrap break-words leading-relaxed"
            style={{ minHeight: "60px", maxHeight: "200px" }}
            spellCheck={false}
          />
          {validationError && (
            <p className="text-[9.9px] text-muted-foreground px-1">{validationError}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleValidate}
              disabled={!sqlDraft.trim() || validating}
              className="text-[9.9px] px-2.5 py-1 rounded-md bg-foreground text-background hover:bg-foreground/90 active:scale-[0.97] transition-all duration-150 flex items-center gap-1.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {validating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              {validating ? "Validating…" : "Validate"}
            </button>
            <button
              onClick={handleCancel}
              className="text-[9.9px] px-2 py-1 text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              Cancel
            </button>
            <span className="text-[9px] text-muted-foreground/40 ml-auto">⌘↵ to validate</span>
          </div>
        </div>
      ) : (
        <div
          onClick={handleStartEdit}
          className={`${disabled ? "" : "cursor-pointer hover:ring-1 hover:ring-ring/20 rounded-sm transition-all duration-150"}`}
          title={disabled ? undefined : "Click to edit SQL"}
        >
          {hasDiff ? (
            <div className="rounded-sm overflow-hidden border border-border/40">
              <pre className="px-2.5 py-1.5 bg-muted text-[9.9px] font-mono whitespace-pre-wrap break-all leading-relaxed border-b border-border/30">
                <span className="text-muted-foreground/50 select-none mr-2">−</span><span className="text-muted-foreground">{oldSql}</span>
              </pre>
              <pre className="px-2.5 py-1.5 bg-muted text-[9.9px] font-mono whitespace-pre-wrap break-all leading-relaxed"><span className="text-foreground/50 select-none mr-2">+</span><SqlHighlighted sql={newSql} /></pre>
            </div>
          ) : (
            <div className="bg-muted rounded-sm overflow-hidden">
              <pre className="px-2.5 py-2 text-[9.9px] font-mono whitespace-pre-wrap break-all leading-relaxed">
                <SqlHighlighted sql={newSql} />
              </pre>
            </div>
          )}
        </div>
      )}
      {formulaSyncing && (
        <p className="text-[9px] text-muted-foreground/50 mt-1.5 flex items-center gap-1">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
          Updating formula…
        </p>
      )}
    </Collapsible>
  );
}

export function MetricUpdateConfirmCard({
  data,
  msgId,
  onPublish,
  onEdit,
  onManualSqlUpdate,
  onNameChange,
}: MetricUpdateConfirmCardProps) {
  const [showEditInput, setShowEditInput] = useState(false);
  const [editText, setEditText] = useState("");
  const [sqlHasUnvalidatedChanges, setSqlHasUnvalidatedChanges] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(data.newName || data.metricName);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const displayName = data.newName || data.metricName;
  const isCreation = !data.oldSql && !data.oldFormula && !data.oldDescription;
  const isEditing = data.status === "editing";

  const handleNameClick = useCallback(() => {
    if (isEditing) return;
    setNameDraft(displayName);
    setIsEditingName(true);
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 50);
  }, [displayName, isEditing]);

  const commitNameChange = useCallback(() => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed.length > 100) {
      // Revert on empty or too long
      setNameDraft(displayName);
      setIsEditingName(false);
      return;
    }
    setIsEditingName(false);
    if (trimmed !== displayName) {
      onNameChange?.(msgId, trimmed);
    }
  }, [nameDraft, displayName, msgId, onNameChange]);

  const submitEdit = (text: string) => {
    if (!text.trim()) return;
    setShowEditInput(false);
    setEditText("");
    onEdit(msgId, text.trim());
  };

  const handleSqlValidated = useCallback((updateData: ManualSqlUpdateData) => {
    setSqlHasUnvalidatedChanges(false);
    onManualSqlUpdate?.(msgId, updateData);
  }, [msgId, onManualSqlUpdate]);

  if (data.status === "published") {
    return (
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Check className="w-3 h-3 text-foreground" />
            </div>
            <span className="text-sm font-medium">Metric update published for review</span>
          </div>
          <a
            href={`/metrics/${data.metricId}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 flex items-center gap-1 shrink-0"
          >
            View metric
            <ArrowRight className="w-3 h-3" />
          </a>
        </div>
      </div>
    );
  }

  if (data.status === "dismissed") {
    return (
      <div className="text-xs text-muted-foreground/50 italic py-1">
        Metric update dismissed
      </div>
    );
  }

  const hasValue = data.computedValue != null;
  const hasSqlError = data.sqlValid === false;
  const publishDisabled = hasSqlError || sqlHasUnvalidatedChanges;

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden w-full">
      {/* Progress bar when editing */}
      {isEditing && (
        <div className="h-0.5 bg-border/50 overflow-hidden">
          <div className="h-full w-full bg-foreground/30 animate-[shimmer-sweep_1.5s_ease-in-out_infinite]" />
        </div>
      )}

      {/* Header: name + value */}
      <div className={`px-4 py-3 border-b border-border bg-muted/30 transition-opacity duration-200 ${isEditing ? "opacity-50" : ""}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isEditingName ? (
                <input
                  ref={nameInputRef}
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitNameChange}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitNameChange();
                    if (e.key === "Escape") { setNameDraft(displayName); setIsEditingName(false); }
                  }}
                  maxLength={100}
                  className="text-sm font-bold bg-transparent border-b border-foreground/20 focus:border-foreground/50 outline-none py-0 px-0 w-full min-w-0"
                />
              ) : (
                <p
                  className={`text-sm font-bold truncate ${isEditing ? "" : "cursor-pointer hover:text-foreground/70 transition-colors duration-150"}`}
                  onClick={handleNameClick}
                  title={isEditing ? undefined : "Click to rename"}
                >
                  {displayName}
                </p>
              )}
              {isEditing && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />}
            </div>
            {data.userRequest && data.oldSql ? (
              <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">
                Edit: &ldquo;{data.userRequest}&rdquo;
              </p>
            ) : data.explanation ? (
              <p className="text-xs text-muted-foreground/60 mt-0.5 line-clamp-1">{data.explanation}</p>
            ) : null}
          </div>
          {hasValue && (
            <p className="text-lg font-semibold tabular-nums shrink-0 text-foreground">
              {data.computedValue!.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          )}
        </div>
      </div>

      {/* SQL error banner */}
      {hasSqlError && !isEditing && (
        <div className="px-4 py-2.5 bg-muted border-b border-border">
          <p className="text-xs font-medium text-foreground mb-1">SQL validation failed</p>
          {data.sqlErrors?.valueSql && (
            <p className="text-[9.9px] text-muted-foreground">Value SQL: {data.sqlErrors.valueSql}</p>
          )}
          {data.sqlErrors?.timeSeriesSql && (
            <p className="text-[9.9px] text-muted-foreground">Time series SQL: {data.sqlErrors.timeSeriesSql}</p>
          )}
          <p className="text-[9.9px] text-muted-foreground mt-1">Click the SQL to edit directly, or use a suggested edit.</p>
        </div>
      )}

      {/* Body — visible in both ready and editing (dimmed) states */}
      <div className={`p-4 space-y-4 transition-opacity duration-200 ${isEditing ? "opacity-40 pointer-events-none" : ""}`}>
        {/* Formula */}
        <LineDiff label="Formula" before={data.oldFormula} after={data.newFormula} mono />

        {/* Description — always collapsible */}
        {isCreation && !data.oldDescription ? (
          <Collapsible label="Details" defaultOpen={false}>
            <div className="space-y-3">
              <LineDiff label="Description" before="" after={data.newDescription} />
              {data.table && (
                <div>
                  <p className="text-[9.9px] text-muted-foreground font-medium uppercase tracking-wider mb-2">Table</p>
                  <div className="bg-muted/40 rounded-sm px-2.5 py-2">
                    <p className="text-xs text-foreground/80 font-mono">{data.table}</p>
                  </div>
                </div>
              )}
            </div>
          </Collapsible>
        ) : (
          <Collapsible label="Description" defaultOpen={false}>
            <LineDiff label="" before={data.oldDescription} after={data.newDescription} />
          </Collapsible>
        )}

        {/* SQL — editable */}
        <SqlSection
          oldSql={data.oldSql}
          newSql={data.newSql}
          defaultOpen={isCreation || data.oldSql !== data.newSql}
          disabled={isEditing}
          onSqlValidated={handleSqlValidated}
          metricName={data.metricName}
          description={data.newDescription}
        />

        {/* Affected metrics */}
        {data.affectedMetrics.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <AlertCircle className="w-3 h-3 text-muted-foreground" />
              <p className="text-[9.9px] text-muted-foreground font-medium uppercase tracking-wider">
                Affected Metrics ({data.affectedMetrics.length})
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.affectedMetrics.map((name, i) => (
                <span
                  key={i}
                  className="text-[9.9px] px-2 py-0.5 rounded-full border border-border text-muted-foreground bg-muted/40"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions — hidden while editing */}
      {!isEditing && (
        <div className="px-4 py-3 border-t border-border space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onPublish(msgId)}
              disabled={publishDisabled}
              className="text-sm px-3.5 py-1.5 rounded-lg bg-foreground text-background hover:bg-foreground/90 active:scale-[0.97] transition-all duration-150 flex items-center gap-1.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_1px_3px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.06)]"
            >
              <Check className="w-3.5 h-3.5" />
              Publish for Review
            </button>
            <button
              onClick={() => {
                setShowEditInput(true);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className="text-sm px-3.5 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted active:scale-[0.98] transition-all duration-150 flex items-center gap-1.5"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          </div>

          {/* Inline edit input */}
          {showEditInput && (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitEdit(editText);
                  if (e.key === "Escape") { setShowEditInput(false); setEditText(""); }
                }}
                placeholder="Describe the change…"
                className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring/30 placeholder:text-muted-foreground/50"
              />
              <button
                onClick={() => submitEdit(editText)}
                disabled={!editText.trim()}
                className="p-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 active:scale-[0.95] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Suggested edits */}
          <div>
            <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider mb-1.5">Suggested edits</p>
            <div className="flex flex-wrap gap-1.5">
              {EDIT_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => submitEdit(chip.toLowerCase())}
                  className="text-[9.9px] px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30 active:scale-[0.97] transition-all duration-150"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
