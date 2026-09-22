"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { ChevronLeft, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CellTypeIcon, StatusDot } from "@/components/playbook/shared-icons";
import type { PlaybookCellV2, CellStatus, PlaybookExecutionStateV2, CellDiff } from "@/lib/playbook-types";

// ── LCS-based line diff ──────────────────────────────────────────────────────

type DiffOp = { type: "same" | "del" | "ins"; line: string };

function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  const m = oldLines.length, n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      ops.push({ type: "same", line: oldLines[i++] });
      j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ type: "ins", line: newLines[j++] });
    } else {
      ops.push({ type: "del", line: oldLines[i++] });
    }
  }
  return ops;
}

type DiffPair = { left: string; right: string; kind: "same" | "del" | "ins" | "changed" };

function toPairs(ops: DiffOp[]): DiffPair[] {
  const pairs: DiffPair[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "same") {
      pairs.push({ left: ops[i].line, right: ops[i].line, kind: "same" });
      i++;
    } else {
      const dels: string[] = [], ins: string[] = [];
      while (i < ops.length && ops[i].type === "del") dels.push(ops[i++].line);
      while (i < ops.length && ops[i].type === "ins") ins.push(ops[i++].line);
      const max = Math.max(dels.length, ins.length);
      for (let k = 0; k < max; k++) {
        const l = dels[k] ?? "", r = ins[k] ?? "";
        if (l && r) pairs.push({ left: l, right: r, kind: "changed" });
        else if (l) pairs.push({ left: l, right: "", kind: "del" });
        else pairs.push({ left: "", right: r, kind: "ins" });
      }
    }
  }
  return pairs;
}

function SideBySideDiff({ oldCode, newCode }: { oldCode: string; newCode: string }) {
  const ops = useMemo(() => diffLines(oldCode.split("\n"), newCode.split("\n")), [oldCode, newCode]);
  const pairs = useMemo(() => toPairs(ops), [ops]);

  const changedCount = pairs.filter((p) => p.kind !== "same").length;

  // Check if lines are too long for side-by-side — use unified diff if avg > 40 chars
  const allLines = useMemo(() => {
    const lines = [...oldCode.split("\n"), ...newCode.split("\n")];
    if (lines.length === 0) return 0;
    return lines.reduce((sum, l) => sum + l.length, 0) / lines.length;
  }, [oldCode, newCode]);
  const useUnified = allLines > 40;

  if (useUnified) {
    return (
      <div className="border border-border rounded-md overflow-hidden text-[9.9px] font-mono">
        <div className="border-b border-border text-[9px] font-sans font-medium text-muted-foreground px-3 py-1.5 flex items-center gap-2">
          <span>Unified diff</span>
          <span className="ml-auto">{changedCount} change{changedCount !== 1 ? "s" : ""}</span>
        </div>
        <div className="max-h-72 overflow-y-auto overflow-x-hidden">
          {ops.map((op, idx) => (
            <div
              key={idx}
              className={`px-3 py-[2px] min-w-0 ${
                op.type === "del" ? "bg-muted" : op.type === "ins" ? "bg-muted" : ""
              }`}
            >
              <code className={`block whitespace-pre-wrap break-all ${
                op.type === "del" ? "text-foreground" : op.type === "ins" ? "text-foreground" : "text-muted-foreground"
              }`}>
                {op.type === "del" ? "- " : op.type === "ins" ? "+ " : "  "}{op.line || "\u00a0"}
              </code>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-md overflow-hidden text-[9.9px] font-mono">
      {/* Column headers */}
      <div className="grid grid-cols-2 border-b border-border text-[9px] font-sans font-medium text-muted-foreground">
        <div className="px-3 py-1.5 bg-muted border-r border-border flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
          Previous
        </div>
        <div className="px-3 py-1.5 bg-muted flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
          Updated · {changedCount} change{changedCount !== 1 ? "s" : ""}
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto overflow-x-hidden">
        {pairs.map((pair, idx) => (
          <div key={idx} className="grid grid-cols-2 min-w-0">
            <div className={`px-3 py-[2px] border-r border-border/50 min-w-0 ${
              pair.kind === "del" ? "bg-muted" : pair.kind === "changed" ? "bg-muted" : ""
            }`}>
              <code className={`block truncate ${
                pair.kind === "del" || pair.kind === "changed" ? "text-foreground" : "text-muted-foreground"
              }`}>{pair.left || "\u00a0"}</code>
            </div>
            <div className={`px-3 py-[2px] min-w-0 ${
              pair.kind === "ins" ? "bg-muted" : pair.kind === "changed" ? "bg-muted" : ""
            }`}>
              <code className={`block truncate ${
                pair.kind === "ins" || pair.kind === "changed" ? "text-foreground" : "text-muted-foreground"
              }`}>{pair.right || "\u00a0"}</code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SQL helpers ──

/** Extract table names referenced in SQL (FROM / JOIN clauses) */
function extractTables(sql: string): string[] {
  // Extract CTE alias names to exclude them from table list
  const cteAliases = new Set<string>();
  if (/^\s*WITH\b/i.test(sql)) {
    const ctePattern = /\bWITH\s+([a-z_][a-z0-9_]*)\s+AS\b/gi;
    let cm: RegExpExecArray | null;
    while ((cm = ctePattern.exec(sql)) !== null) {
      cteAliases.add(cm[1].toLowerCase());
    }
    // Also match subsequent CTE definitions: , alias AS (
    const commaCtePattern = /,\s*([a-z_][a-z0-9_]*)\s+AS\s*\(/gi;
    while ((cm = commaCtePattern.exec(sql)) !== null) {
      cteAliases.add(cm[1].toLowerCase());
    }
  }

  const tables = new Set<string>();
  // Match FROM <table> and JOIN <table>, skip subqueries
  const pattern = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(sql)) !== null) {
    const name = m[1].toLowerCase();
    // Skip common CTE/subquery aliases and SQL keywords
    if (!["select", "where", "group", "order", "having", "limit", "as", "on", "and", "or", "case", "when", "then", "else", "end"].includes(name) && !cteAliases.has(name)) {
      tables.add(name);
    }
  }
  return Array.from(tables);
}

/** Infer a variable's type from its name */
function inferVarType(name: string): string {
  const n = name.toLowerCase();
  if (/\b(?:date|time|period|day|month|year|week)\b/.test(n)) return "date";
  if (/\b(?:count|total|sum|num|quantity|amount)\b/.test(n)) return "number";
  if (/\b(?:rate|ratio|percent|pct|score|index)\b/.test(n)) return "float";
  if (/\b(?:is_|has_|flag|valid|active|enabled)\b/.test(n)) return "boolean";
  if (/\bid$|\b_id\b|\buuid\b/.test(n)) return "id";
  return "string";
}

/** Extract column names from the outermost SELECT clause of a SQL query */
function extractSqlColumns(sql: string): string[] {
  // Strip CTE-level WITH blocks to isolate the final SELECT
  let strippedSql = sql;
  const withMatch = strippedSql.match(/^\s*WITH\b/i);
  if (withMatch) {
    // Find the last top-level SELECT (after all CTE definitions)
    let depth = 0;
    let lastSelectIdx = -1;
    const upper = strippedSql.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
      if (upper[i] === "(") depth++;
      else if (upper[i] === ")") depth--;
      else if (depth === 0 && upper.startsWith("SELECT", i) && (i === 0 || /\s/.test(upper[i - 1]))) {
        lastSelectIdx = i;
      }
    }
    if (lastSelectIdx > 0) {
      strippedSql = strippedSql.slice(lastSelectIdx);
    }
  }

  // Find the SELECT ... FROM in the (possibly stripped) SQL
  const selectPattern = /\bSELECT\b\s+([\s\S]*?)\bFROM\b/gi;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = selectPattern.exec(strippedSql)) !== null) lastMatch = m;
  if (!lastMatch) return [];

  // Strip DISTINCT, ALL, TOP N after SELECT before parsing columns
  let selectBody = lastMatch[1].trim();
  selectBody = selectBody.replace(/^(?:DISTINCT|ALL)\s+/i, "");
  selectBody = selectBody.replace(/^TOP\s+\d+\s+/i, "");

  if (selectBody === "*") return ["*"];

  // Split by commas (respecting parentheses depth and CASE...END depth)
  const cols: string[] = [];
  let parenDepth = 0, caseDepth = 0, current = "";
  const bodyUpper = selectBody.toUpperCase();
  for (let i = 0; i < selectBody.length; i++) {
    const ch = selectBody[i];
    // Track CASE...END keyword depth
    if (bodyUpper.startsWith("CASE", i) && (i === 0 || /[\s,(]/.test(selectBody[i - 1])) && (i + 4 >= selectBody.length || /[\s]/.test(selectBody[i + 4]))) {
      caseDepth++;
    } else if (bodyUpper.startsWith("END", i) && (i === 0 || /[\s,(]/.test(selectBody[i - 1])) && (i + 3 >= selectBody.length || /[\s,)]/.test(selectBody[i + 3]))) {
      caseDepth = Math.max(0, caseDepth - 1);
    }
    if (ch === "(") parenDepth++;
    if (ch === ")") parenDepth--;
    if (ch === "," && parenDepth === 0 && caseDepth === 0) {
      cols.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) cols.push(current.trim());

  // Extract alias or column name from each item
  return cols.map((col) => {
    // Match "... AS alias" pattern
    const asMatch = col.match(/\bAS\s+([a-z_][a-z0-9_]*)\s*$/i);
    if (asMatch) return asMatch[1];
    // Simple column reference: "table.column" or "column"
    const simple = col.match(/^([a-z_][a-z0-9_.]*)\s*$/i);
    if (simple) {
      const parts = simple[1].split(".");
      return parts[parts.length - 1];
    }
    return col.length > 30 ? col.slice(0, 27) + "..." : col;
  }).filter(Boolean);
}

/** Build a short "produces" line from description + outputs */
function buildProducesLine(cell: PlaybookCellV2, result?: { rowCount?: number }): string {
  const parts: string[] = [];
  if (result?.rowCount != null) {
    parts.push(`${result.rowCount} row${result.rowCount !== 1 ? "s" : ""}`);
  }
  if (cell.outputs?.length) {
    parts.push(cell.outputs.join(", "));
  }
  if (cell.description) {
    // Use first sentence as a short summary
    const short = cell.description.split(/[.!]/)[0].trim().toLowerCase();
    if (short && parts.length > 0) parts.push(": " + short);
    else if (short) parts.push(short);
  }
  return parts.join(" ") || "query results";
}

interface PlaybookNodeDetailProps {
  cells: PlaybookCellV2[];
  allCells?: PlaybookCellV2[];
  owner: string;
  ownerInitials: string;
  onBack: () => void;
  onCellClick?: (cellId: string) => void;
  executionState?: PlaybookExecutionStateV2;
  onCellUpdate?: (cellId: string, changes: Partial<PlaybookCellV2>) => void;
  /** Pending cell diffs from the last LLM-applied change set */
  cellDiffs?: CellDiff[];
}

export function PlaybookNodeDetail({
  cells,
  allCells,
  owner,
  ownerInitials,
  onBack,
  onCellClick,
  executionState,
  onCellUpdate,
  cellDiffs,
}: PlaybookNodeDetailProps) {
  const isGroup = cells.length > 1;
  const [showAllProduces, setShowAllProduces] = useState(false);
  const [showAllOutputs, setShowAllOutputs] = useState(false);

  // All hooks MUST be above early returns
  const allTables = useMemo(() => {
    const tables = new Set<string>();
    for (const c of cells) {
      if (c.sql) for (const t of extractTables(c.sql)) tables.add(t);
    }
    return Array.from(tables).sort();
  }, [cells]);

  const allOutputs = useMemo(() => {
    return cells.flatMap((c) => c.outputs ?? []);
  }, [cells]);

  if (cells.length === 0) return null;

  // Single cell view
  if (!isGroup) {
    return (
      <SingleCellDetail
        cell={cells[0]}
        allCells={allCells ?? cells}
        owner={owner}
        ownerInitials={ownerInitials}
        onBack={onBack}
        executionState={executionState}
        onCellUpdate={onCellUpdate}
        pendingDiff={cellDiffs?.find((d) => d.cellId === cells[0].id)}
      />
    );
  }

  // Group view — list of cells with expandable detail
  const role = cells[0].role;
  const roleLabel = role === "query" ? "Queries" : role === "guardrail" ? "Guardrails" : `${role} Steps`;
  const sqlCount = cells.filter((c) => c.type === "sql").length;
  const llmCount = cells.filter((c) => c.type === "llm").length;

  // Build summary
  const summaryParts: string[] = [];
  if (sqlCount > 0) summaryParts.push(`${sqlCount} SQL quer${sqlCount === 1 ? "y" : "ies"}`);
  if (llmCount > 0) summaryParts.push(`${llmCount} LLM step${llmCount === 1 ? "" : "s"}`);
  const summaryLine = `Runs ${summaryParts.join(" and ")} in parallel during execution.`;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="p-6 space-y-4 min-w-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back to Overview
        </button>

        <div>
          <h1 className="text-lg font-semibold mb-1">
            {cells.length} {roleLabel}
          </h1>
          <p className="text-[11.7px] text-muted-foreground leading-relaxed">
            {summaryLine}
          </p>
        </div>

        {/* Owner */}
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium text-muted-foreground">
            {ownerInitials}
          </div>
          <span className="text-[11.7px]">{owner}</span>
        </div>

        <div className="border-b border-border" />

        {/* READS */}
        {allTables.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Tables Used</h2>
            <div className="flex flex-wrap gap-1.5">
              {allTables.map((t) => <code key={t} className="text-[10.8px] font-mono bg-muted px-1.5 py-0.5 rounded">{t}</code>)}
            </div>
          </div>
        )}

        {/* PRODUCES */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Produces</h2>
          <p className="text-[11.7px] text-muted-foreground leading-relaxed">
            {cells.length} result sets: {(showAllProduces ? cells : cells.slice(0, 4)).map((c) => c.label.toLowerCase()).join(", ")}
            {cells.length > 4 && (
              <button
                onClick={() => setShowAllProduces((v) => !v)}
                className="ml-1 text-[11.7px] text-foreground/70 hover:text-foreground underline underline-offset-2 decoration-border hover:decoration-foreground/40 transition-colors"
              >
                {showAllProduces ? "show less" : `+${cells.length - 4} more`}
              </button>
            )}
          </p>
        </div>

        {/* OUTPUTS */}
        {allOutputs.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Outputs</h2>
            <div className="flex flex-wrap gap-1.5">
              {(showAllOutputs ? allOutputs : allOutputs.slice(0, 6)).map((o) => (
                <span key={o} className="text-[9.9px] px-2 py-0.5 rounded-full border border-border text-muted-foreground font-mono truncate max-w-full">{o}</span>
              ))}
              {allOutputs.length > 6 && (
                <button
                  onClick={() => setShowAllOutputs((v) => !v)}
                  className="text-[9.9px] px-2 py-0.5 text-foreground/70 hover:text-foreground underline underline-offset-2 decoration-border hover:decoration-foreground/40 transition-colors"
                >
                  {showAllOutputs ? "show less" : `+${allOutputs.length - 6} more`}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="border-b border-border" />

        {/* Cell list */}
        <div className="space-y-2">
          {cells.map((cell) => {
            const cellStatus = executionState?.cellStatuses[cell.id] ?? cell.status;
            const cellResult = executionState?.cellResults[cell.id];

            return (
              <button
                key={cell.id}
                onClick={() => onCellClick?.(cell.id)}
                className="w-full border border-border rounded-lg px-3.5 py-3 hover:bg-muted/30 hover:border-foreground/20 transition-colors text-left space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <StatusDot status={cellStatus} />
                  <CellTypeIcon type={cell.type} size={12} />
                  <span className="text-xs font-medium truncate">{cell.label}</span>
                  {cellResult?.rowCount != null && (
                    <span className="text-[9px] text-muted-foreground ml-auto shrink-0">
                      {cellResult.rowCount} rows · {cellResult.timeMs}ms
                    </span>
                  )}
                  {cellResult?.error && (
                    <span className="text-[9px] text-foreground ml-auto shrink-0">Error</span>
                  )}
                  <svg
                    className="w-3 h-3 text-muted-foreground/40 shrink-0"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-[9.9px] text-muted-foreground leading-relaxed line-clamp-2 pl-5">
                  {cell.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Single cell full detail view ──

function SingleCellDetail({
  cell,
  allCells,
  owner,
  ownerInitials,
  onBack,
  executionState,
  onCellUpdate,
  pendingDiff,
}: {
  cell: PlaybookCellV2;
  allCells: PlaybookCellV2[];
  owner: string;
  ownerInitials: string;
  onBack: () => void;
  executionState?: PlaybookExecutionStateV2;
  onCellUpdate?: (cellId: string, changes: Partial<PlaybookCellV2>) => void;
  pendingDiff?: CellDiff;
}) {
  const [activeTab, setActiveTab] = useState<"description" | "outputs">("description");
  const cellStatus = executionState?.cellStatuses[cell.id] ?? cell.status;
  const cellResult = executionState?.cellResults[cell.id];
  const streamingText = executionState?.streamingText[cell.id];
  const editable = !!onCellUpdate;

  const handleUpdate = useCallback(
    (changes: Partial<PlaybookCellV2>) => {
      onCellUpdate?.(cell.id, changes);
    },
    [cell.id, onCellUpdate]
  );

  const tables = cell.sql ? extractTables(cell.sql) : [];

  // Resolve dependency cell labels from allCells
  const depCells = (cell.dependsOn ?? [])
    .map((depId) => allCells.find((c) => c.id === depId))
    .filter((c): c is PlaybookCellV2 => !!c);

  const hasOutputs =
    (cell.outputs?.length ?? 0) > 0 ||
    !!cellResult?.columns ||
    !!streamingText ||
    !!cellResult?.error ||
    !!cellResult?.content;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header — outside tabs */}
      <div className="px-5 pt-5 pb-3 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back to Overview
        </button>

        <div className="flex items-center gap-2 mb-1.5">
          <StatusDot status={cellStatus} />
          {editable ? (
            <InlineInput
              value={cell.label}
              onSave={(v) => handleUpdate({ label: v })}
              className="text-base font-semibold"
            />
          ) : (
            <h1 className="text-base font-semibold leading-snug">{cell.label}</h1>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-[9px] px-2 py-0.5 font-semibold uppercase">
            <span className="flex items-center gap-1.5">
              <CellTypeIcon type={cell.type} size={12} />
              {cell.type === "sql" ? "SQL" : "LLM"}
            </span>
          </Badge>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-medium capitalize text-muted-foreground">
            {cell.role}
          </Badge>
          {pendingDiff && (
            <span className="inline-flex items-center gap-1 text-[9px] font-medium bg-muted text-foreground border border-border px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
              {pendingDiff.changeType === "added" ? "Added" : pendingDiff.changeType === "removed" ? "Removed" : "Modified"}
            </span>
          )}
          {pendingDiff?.labelDiff && (
            <span className="text-[9.9px] text-muted-foreground">
              Label: <span className="line-through text-muted-foreground">{pendingDiff.labelDiff.old}</span>{" "}
              <span className="text-foreground/70">&rarr;</span>{" "}
              <span className="text-foreground">{pendingDiff.labelDiff.new}</span>
            </span>
          )}
          {cellResult?.timeMs != null && (
            <span className="text-[9.9px] text-muted-foreground ml-auto">
              {cellResult.timeMs}ms
              {cellResult.rowCount != null && ` · ${cellResult.rowCount} rows`}
            </span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="border-b border-border shrink-0 px-5">
        <div className="flex gap-0">
          {(["description", "outputs"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-[10.8px] font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "description" ? "Description & Inputs" : "Outputs"}
              {tab === "outputs" && hasOutputs && activeTab !== "outputs" && (
                <span className={`ml-1.5 inline-flex items-center justify-center w-1.5 h-1.5 rounded-full ${
                  cellResult?.error ? "bg-foreground" : cellResult ? "bg-foreground" : "bg-muted-foreground/40"
                }`} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="p-5 space-y-4 min-w-0">

          {activeTab === "description" && (
            <>
              {/* Description */}
              <div>
                {pendingDiff?.descriptionDiff ? (
                  <div className="space-y-1.5">
                    <div className="px-2.5 py-1.5 rounded-md bg-muted border border-border">
                      <p className="text-[11.7px] text-muted-foreground leading-relaxed line-through">{pendingDiff.descriptionDiff.old}</p>
                    </div>
                    <div className="px-2.5 py-1.5 rounded-md bg-muted border border-border">
                      <p className="text-[11.7px] text-foreground leading-relaxed">{pendingDiff.descriptionDiff.new}</p>
                    </div>
                  </div>
                ) : editable ? (
                  <InlineInput
                    value={cell.description}
                    onSave={(v) => handleUpdate({ description: v })}
                    className="text-[11.7px] text-muted-foreground leading-relaxed"
                    multiline
                  />
                ) : (
                  <p className="text-[11.7px] text-muted-foreground leading-relaxed">{cell.description}</p>
                )}
              </div>

              {/* Inputs: individual variables from dependency cells */}
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Inputs</h2>
                {depCells.length > 0 ? (
                  <div className="space-y-1.5">
                    {depCells.flatMap((dep) =>
                      (dep.outputs ?? []).map((varName) => (
                        <div key={`${dep.id}-${varName}`} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border border-border bg-muted/20">
                          <span className="text-[10.8px] font-mono font-medium text-foreground truncate">{varName}</span>
                          <span className="text-[9px] text-muted-foreground/60 ml-auto shrink-0 uppercase font-medium">
                            {inferVarType(varName)}
                          </span>
                        </div>
                      ))
                    )}
                    {depCells.every((d) => !d.outputs?.length) && (
                      <p className="text-[10.8px] text-muted-foreground italic">Depends on upstream cells (no named variables).</p>
                    )}
                  </div>
                ) : (
                  <p className="text-[10.8px] text-muted-foreground italic">No upstream dependencies. Runs first.</p>
                )}
              </div>

              {/* Tables read (SQL cells) — shown as data source cards */}
              {tables.length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tables Used</h2>
                  <div className="space-y-1.5">
                    {tables.map((t) => (
                      <div key={t} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-muted/20">
                        <Database className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-[10.8px] font-mono font-medium text-foreground">{t}</span>
                        <span className="text-[9px] text-muted-foreground/60 ml-auto shrink-0 uppercase font-medium">table</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Owner */}
              <div className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium text-muted-foreground">
                  {ownerInitials}
                </div>
                <span className="text-[11.7px]">{owner}</span>
              </div>

              <div className="border-b border-border" />

              {/* Code / Prompt — show diff when pending, otherwise normal view */}
              {cell.type === "sql" && (cell.sql || pendingDiff?.sqlDiff) && (
                <div className="min-w-0">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Code</h2>
                  {pendingDiff?.sqlDiff ? (
                    <SideBySideDiff oldCode={pendingDiff.sqlDiff.old} newCode={pendingDiff.sqlDiff.new} />
                  ) : editable && cell.sql ? (
                    <CodeEditor code={cell.sql} language="sql" onSave={(v) => handleUpdate({ sql: v })} />
                  ) : (
                    <div className={`border border-border rounded-md overflow-hidden min-w-0${editable ? " cursor-pointer" : ""}`}>
                      <div className="flex items-center px-3 py-1.5 bg-muted/50 border-b border-border">
                        <span className="text-[9.9px] font-medium uppercase text-muted-foreground">SQL</span>
                        {editable && <span className="ml-auto text-[9px] text-muted-foreground/50">Click to edit</span>}
                      </div>
                      <pre className="p-3 bg-muted/80 text-foreground text-[9.9px] leading-relaxed overflow-x-auto font-mono whitespace-pre-wrap break-all">
                        <code>{cell.sql}</code>
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {cell.type === "llm" && (cell.prompt || pendingDiff?.promptDiff) && (
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Prompt</h2>
                  {pendingDiff?.promptDiff ? (
                    <SideBySideDiff oldCode={pendingDiff.promptDiff.old} newCode={pendingDiff.promptDiff.new} />
                  ) : editable && cell.prompt ? (
                    <InlineInput value={cell.prompt} onSave={(v) => handleUpdate({ prompt: v })} className="text-[11.7px] text-muted-foreground leading-relaxed" multiline />
                  ) : (
                    <div className="px-3 py-2.5 bg-muted/30 border border-border rounded-md">
                      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{cell.prompt}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === "outputs" && (
            <>
              {/* Output columns — extracted from SQL or from output variables */}
              {(() => {
                const sqlCols = cell.sql ? extractSqlColumns(cell.sql) : [];
                const displayCols = sqlCols.length > 0 ? sqlCols : (cell.outputs ?? []);
                if (displayCols.length === 0) return null;
                const isFromSql = sqlCols.length > 0;
                return (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {isFromSql ? "Output Columns" : "Output Variables"}
                      </h2>
                      {pendingDiff?.changeType === "added" && (
                        <span className="text-[9px] font-medium text-foreground bg-muted border border-border px-1.5 py-0.5 rounded-full">New cell</span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {displayCols.map((col) => (
                        <div key={col} className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border ${
                          pendingDiff?.changeType === "added"
                            ? "border-border bg-muted"
                            : "border-border bg-muted/20"
                        }`}>
                          <span className={`text-[10.8px] font-mono font-medium truncate ${
                            pendingDiff?.changeType === "added" ? "text-foreground" : "text-foreground"
                          }`}>{col}</span>
                          <span className="text-[9px] text-muted-foreground/60 ml-auto shrink-0 uppercase font-medium">
                            {inferVarType(col)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Results table */}
              {cellResult?.columns && cellResult.preview && cellResult.preview.length > 0 && (
                <ResultsTable result={cellResult} />
              )}

              {/* Streaming / LLM output */}
              {streamingText && (
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    {cellStatus === "running" ? "Live Output" : "Output"}
                  </h2>
                  <div className="px-3 py-2.5 bg-muted/50 border border-border rounded-md max-h-64 overflow-y-auto">
                    <p className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
                      {streamingText}
                      {cellStatus === "running" && <span className="animate-pulse">|</span>}
                    </p>
                  </div>
                </div>
              )}

              {/* LLM result content */}
              {cellResult?.content && !streamingText && (
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Result</h2>
                  <div className="px-3 py-2.5 bg-muted/50 border border-border rounded-md">
                    <p className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">{cellResult.content}</p>
                  </div>
                </div>
              )}

              {/* Error */}
              {cellResult?.error && (
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground mb-3">Error</h2>
                  <div className="px-3 py-2.5 bg-muted border border-border rounded-md">
                    <p className="text-xs font-mono text-foreground whitespace-pre-wrap break-all">{cellResult.error}</p>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!hasOutputs && (
                <p className="text-[10.8px] text-muted-foreground italic">
                  {cellStatus === "idle"
                    ? "Run the playbook to see results here."
                    : cellStatus === "done"
                      ? "Cell completed with no output."
                      : "No output data yet. Run the playbook to see results."}
                </p>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Shared components ──

function ResultsTable({ result }: { result: PlaybookExecutionStateV2["cellResults"][string] }) {
  if (!result?.columns || !result.preview) return null;
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Results <span className="font-normal">{result.rowCount} rows · {result.timeMs}ms</span>
      </h2>
      <div className="border border-border rounded-md overflow-hidden">
        <div className="overflow-x-auto max-h-60">
          <table className="w-full text-[9.9px]">
            <thead>
              <tr className="bg-muted/50 sticky top-0">
                {result.columns!.map((col) => (
                  <th key={col} className="text-left py-1.5 px-2.5 font-medium text-muted-foreground whitespace-nowrap border-b border-border">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {result.preview!.map((row, i) => (
                <tr key={i} className={i < result.preview!.length - 1 ? "border-b border-border/50" : ""}>
                  {result.columns!.map((col) => (
                    <td key={col} className="py-1.5 px-2.5 whitespace-nowrap text-muted-foreground">{formatCell(row[col])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InlineInput({ value, onSave, className = "", multiline = false }: {
  value: string; onSave: (v: string) => void; className?: string; multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  function startEdit() { setDraft(value); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }
  function commit() { setEditing(false); if (draft.trim() !== value) onSave(draft.trim()); }

  if (!editing) {
    return (
      <div onClick={startEdit} className={`cursor-text rounded px-1 -mx-1 hover:bg-muted/50 transition-colors ${className}`}>
        {value || <span className="text-muted-foreground/50 italic">Click to edit</span>}
      </div>
    );
  }
  if (multiline) {
    return <textarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }} rows={3} className={`w-full rounded px-1 -mx-1 bg-muted/30 border border-border focus:outline-none focus:ring-1 focus:ring-ring/30 resize-y ${className}`} />;
  }
  return <input ref={inputRef as React.RefObject<HTMLInputElement>} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} className={`w-full rounded px-1 -mx-1 bg-muted/30 border border-border focus:outline-none focus:ring-1 focus:ring-ring/30 ${className}`} />;
}

function CodeEditor({ code, language, onSave }: { code: string; language: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(code);
  const ref = useRef<HTMLTextAreaElement>(null);
  function commit() { if (draft !== code) onSave(draft); }
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="flex items-center px-3 py-1.5 bg-muted/50 border-b border-border">
        <span className="text-[9.9px] font-medium uppercase text-muted-foreground">{language}</span>
        {draft !== code && <span className="ml-auto text-[9px] text-muted-foreground">unsaved</span>}
      </div>
      <textarea ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => {
        if (e.key === "Tab") { e.preventDefault(); const s = ref.current!.selectionStart; setDraft(draft.slice(0, s) + "  " + draft.slice(ref.current!.selectionEnd)); setTimeout(() => { ref.current!.selectionStart = ref.current!.selectionEnd = s + 2; }, 0); }
      }} spellCheck={false} className="w-full p-3 bg-muted/80 text-foreground text-[9.9px] leading-relaxed font-mono resize-y min-h-[150px] focus:outline-none" rows={Math.max(6, draft.split("\n").length + 1)} />
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") {
    if (Number.isInteger(value) && Math.abs(value) >= 1000) return value.toLocaleString();
    if (!Number.isInteger(value)) return Number(value.toFixed(4)).toString();
  }
  return String(value);
}
