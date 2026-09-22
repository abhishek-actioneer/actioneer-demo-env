"use client";

import { useMemo } from "react";
import { CheckCircle2, Sparkles, MessageSquare } from "lucide-react";
import { CellTypeIcon } from "@/components/playbook/shared-icons";

interface PlanCell {
  id: string;
  label: string;
  description: string;
  type: string;
  role: string;
  dependsOn: string[];
}

interface PlaybookPlanReviewCardProps {
  cells: PlanCell[];
  status: "pending" | "approved" | "generating" | "superseded";
  changeSummary?: string;
  onApprove: () => void;
}

// ── Compute DAG levels ──

function computeLevels(cells: PlanCell[]): Map<string, number> {
  const cellMap = new Map(cells.map((c) => [c.id, c]));
  const memo = new Map<string, number>();

  function getLevel(id: string): number {
    if (memo.has(id)) return memo.get(id)!;
    const cell = cellMap.get(id);
    if (!cell || cell.dependsOn.length === 0) {
      memo.set(id, 0);
      return 0;
    }
    const deps = cell.dependsOn.filter((dep) => cellMap.has(dep));
    const level = deps.length > 0 ? Math.max(...deps.map(getLevel)) + 1 : 0;
    memo.set(id, level);
    return level;
  }

  for (const cell of cells) getLevel(cell.id);
  return memo;
}

const ROLE_LABEL: Record<string, string> = {
  guardrail: "Guardrail",
  parameter: "Parameters",
  query: "Data Queries",
  analysis: "Analysis",
  summary: "Summary",
};

interface LevelGroup {
  level: number;
  role: string;
  roleLabel: string;
  cells: PlanCell[];
}

function groupByLevel(cells: PlanCell[]): LevelGroup[] {
  const levels = computeLevels(cells);
  const grouped = new Map<number, PlanCell[]>();

  for (const cell of cells) {
    const lvl = levels.get(cell.id) ?? 0;
    if (!grouped.has(lvl)) grouped.set(lvl, []);
    grouped.get(lvl)!.push(cell);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([level, grpCells]) => {
      const role = grpCells[0].role;
      return {
        level,
        role,
        roleLabel: ROLE_LABEL[role] ?? role,
        cells: grpCells,
      };
    });
}

// ── Short description ──

function shortDesc(desc: string): string {
  // Take first sentence, max 80 chars
  const first = desc.split(/[.!]/)[0]?.trim() ?? desc;
  return first.length > 80 ? first.slice(0, 77) + "..." : first;
}

// ── Component ──

export function PlaybookPlanReviewCard({ cells, status, changeSummary, onApprove }: PlaybookPlanReviewCardProps) {
  const groups = useMemo(() => groupByLevel(cells), [cells]);

  if (status === "superseded") {
    return (
      <div className="border border-border/30 rounded-lg px-4 py-2.5 bg-muted/10 opacity-60">
        <p className="text-[9.9px] text-muted-foreground">Previous plan, superseded by a newer version below.</p>
      </div>
    );
  }

  if (status === "approved") {
    return (
      <div className="border border-border/50 rounded-lg px-4 py-3 bg-muted/20 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-foreground shrink-0" />
        <p className="text-xs text-muted-foreground">Plan approved. Generating SQL queries...</p>
      </div>
    );
  }

  if (status === "generating") {
    return (
      <div className="border border-border/50 rounded-lg px-4 py-3 bg-muted/20 flex items-center gap-2">
        <svg className="w-4 h-4 animate-spin text-muted-foreground shrink-0" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" className="text-border" />
          <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-foreground" />
        </svg>
        <p className="text-xs text-muted-foreground">Generating SQL. Cells will fill in on the canvas...</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden bg-card" style={{ boxShadow: "0 0 0 1px var(--color-border)" }}>
      {/* Header */}
      <div className="px-4 py-2.5 flex items-center gap-2" style={{ boxShadow: "0 1px 0 var(--color-border)" }}>
        <Sparkles className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-[9.9px] font-semibold uppercase tracking-wider text-muted-foreground">
          Playbook Plan
        </span>
        <span className="text-[9.9px] text-muted-foreground/50 ml-auto">{cells.length} cells</span>
      </div>

      {/* Structured sections by DAG level */}
      <div className="px-4 py-3 space-y-3">
        {groups.map((group, gIdx) => (
          <div key={group.level}>
            {/* Section header */}
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="text-[9.9px] font-semibold text-muted-foreground">
                Step {gIdx + 1}
              </span>
              <span className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                {group.roleLabel}
              </span>
              {group.cells.length > 1 && (
                <span className="text-[9px] text-muted-foreground/40">
                  ({group.cells.length} cells)
                </span>
              )}
            </div>

            {/* Cells in this level */}
            <div className="space-y-1.5 pl-1">
              {group.cells.map((cell) => (
                <div key={cell.id} className="flex items-start gap-2">
                  <span className="shrink-0 mt-[3px]">
                    <CellTypeIcon type={cell.type} size={12} />
                  </span>
                  <div className="min-w-0">
                    <span className="text-[10.8px] font-medium">{cell.label}</span>
                    <span className="text-[9.9px] text-muted-foreground">: {shortDesc(cell.description)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Separator between sections */}
            {gIdx < groups.length - 1 && (
              <div className="border-b border-border/30 mt-3" />
            )}
          </div>
        ))}
      </div>

      {/* Guidance + Actions */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ boxShadow: "0 -1px 0 var(--color-border)" }}>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <MessageSquare className="w-3 h-3 text-muted-foreground/40 shrink-0" />
          <p className="text-[9px] text-muted-foreground/60 leading-snug truncate">
            Review the structure on the canvas. Chat or add comments to suggest changes before generating.
          </p>
        </div>
        <button
          onClick={onApprove}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 text-[10.8px] font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 active:scale-[0.97] transition-[background-color,transform]"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Approve &amp; Generate
        </button>
      </div>

      {/* Change summary (shown when plan was updated via chat) */}
      {changeSummary && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-md bg-muted/30" style={{ boxShadow: "0 0 0 1px color-mix(in srgb, var(--color-foreground) 10%, transparent)" }}>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Changes from last revision</p>
          <p className="text-[9.9px] text-muted-foreground leading-relaxed">{changeSummary}</p>
        </div>
      )}
    </div>
  );
}

