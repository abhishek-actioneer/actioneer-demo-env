"use client";

import { useMemo, useState } from "react";
import { FileText, Table2 } from "lucide-react";
import { MarkdownContent } from "@/lib/markdown";
import type { PlaybookRunHistory, PlaybookV2 } from "@/lib/playbook-types";
import { inferChartSpec } from "@/lib/chart-inference";

type OutputTab = "report" | "queries";
type CellSummary = NonNullable<PlaybookRunHistory["cellSummaries"]>[number];

interface PlaybookOutputArtifactProps {
  playbook: PlaybookV2;
  run?: PlaybookRunHistory;
}

export function PlaybookOutputArtifact({
  playbook,
  run,
}: PlaybookOutputArtifactProps) {
  const [activeTab, setActiveTab] = useState<OutputTab>("report");
  const finalOutput = useMemo(() => buildFinalOutputMarkdown(playbook, run), [playbook, run]);
  const queryOutputs = useMemo(() => buildQueryOutputs(run), [run]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("report")}
            className={`h-8 rounded-md px-2.5 text-xs font-medium transition-colors ${
              activeTab === "report" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Report
          </button>
          <button
            onClick={() => setActiveTab("queries")}
            className={`h-8 rounded-md px-2.5 text-xs font-medium transition-colors ${
              activeTab === "queries" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Query Outputs
            {queryOutputs.length > 0 && (
              <span className="ml-1 text-muted-foreground">({queryOutputs.length})</span>
            )}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "report" ? (
          <ReportOutput content={finalOutput} />
        ) : (
          <QueryOutputs outputs={queryOutputs} />
        )}
      </div>
    </div>
  );
}

function buildFinalOutputMarkdown(playbook: PlaybookV2, run?: PlaybookRunHistory): string {
  if (!run) return "";

  const finalOutput = findLastCellOutput(playbook, run);
  const supportingOutput = buildSupportingOutputMarkdown(playbook, run, finalOutput);

  return [finalOutput, supportingOutput].filter(Boolean).join("\n\n");
}

function findLastCellOutput(playbook: PlaybookV2, run?: PlaybookRunHistory): string {
  const summaries = run?.cellSummaries ?? [];
  if (!run) return "";

  const finalCellId = playbook.cells[playbook.cells.length - 1]?.id;
  const summary = (finalCellId ? summaries.find((item) => item.cellId === finalCellId) : undefined)
    ?? summaries[summaries.length - 1];
  if (!summary) return "";

  const content = summary.content?.trim();
  if (content) return content;

  if (summary.error) {
    return `## ${summary.label}\n\n${summary.error}`;
  }

  if ((summary.columns?.length ?? 0) > 0) {
    return [
      `## ${summary.label}`,
      buildChartBlock(summary),
      buildMarkdownTable(summary),
    ].filter(Boolean).join("\n\n");
  }

  return "";
}

function ReportOutput({ content }: { content: string }) {
  if (!content) {
    return (
      <EmptyState
        title="No report output yet"
        description="Run this playbook to generate the final report."
      />
    );
  }

  return (
    <article className="w-full max-w-none px-8 py-10 lg:px-12 xl:px-16">
      <div className="text-sm leading-relaxed prose prose-sm prose-neutral max-w-none">
        <MarkdownContent content={content} />
      </div>
    </article>
  );
}

type QueryOutput = {
  cellId: string;
  label: string;
  rowCount?: number;
  timeMs?: number;
  columns: string[];
  rows: Record<string, unknown>[];
  error?: string;
};

function buildQueryOutputs(run?: PlaybookRunHistory): QueryOutput[] {
  return (run?.cellSummaries ?? [])
    .filter((summary) => (summary.columns?.length ?? 0) > 0 || summary.error)
    .map((summary) => ({
      cellId: summary.cellId,
      label: summary.label,
      rowCount: summary.rowCount,
      timeMs: summary.timeMs,
      columns: summary.columns ?? [],
      rows: summary.preview ?? [],
      error: summary.error,
    }));
}

function buildSupportingOutputMarkdown(
  playbook: PlaybookV2,
  run: PlaybookRunHistory,
  finalOutput: string,
): string {
  const summaries = run.cellSummaries ?? [];
  const currentFinalCellId = playbook.cells[playbook.cells.length - 1]?.id;
  const finalSummary = (currentFinalCellId ? summaries.find((summary) => summary.cellId === currentFinalCellId) : undefined)
    ?? summaries[summaries.length - 1];
  const finalCellId = finalSummary?.cellId;
  const querySummaries = (run.cellSummaries ?? []).filter(
    (summary) =>
      summary.cellId !== finalCellId &&
      !summary.error &&
      (summary.columns?.length ?? 0) > 0 &&
      (summary.preview?.length ?? 0) > 0,
  );

  if (querySummaries.length === 0) return "";

  const hasCharts = /```chart\s/i.test(finalOutput);
  const hasTables = /(^|\n)\|.+\|\n\|[-|:\s]+\|/m.test(finalOutput);

  if (hasCharts && hasTables) return "";

  let chartCount = 0;
  const sections = querySummaries.map((summary) => {
    const chartBlock = !hasCharts && chartCount < 3 ? buildChartBlock(summary) : "";
    if (chartBlock) chartCount += 1;

    const parts = [
      `### ${summary.label}`,
      chartBlock,
      hasTables ? "" : buildMarkdownTable(summary),
    ].filter(Boolean);

    return parts.join("\n\n");
  });

  return ["## Supporting Data", ...sections].filter(Boolean).join("\n\n");
}

function buildChartBlock(summary: CellSummary): string {
  const columns = summary.columns ?? [];
  const rows = summary.preview ?? [];
  if (columns.length === 0 || rows.length === 0) return "";

  const spec = inferChartSpec(columns, rows, summary.label, {
    queryDescription: summary.label,
  });
  if (!spec) return "";

  return ["```chart", JSON.stringify(spec, null, 2), "```"].join("\n");
}

function buildMarkdownTable(summary: CellSummary): string {
  const columns = summary.columns ?? [];
  const rows = summary.preview ?? [];
  if (columns.length === 0 || rows.length === 0) return "";

  const header = `| ${columns.map(escapeMarkdownCell).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .slice(0, 20)
    .map((row) => `| ${columns.map((column) => escapeMarkdownCell(formatCellValue(row[column]))).join(" | ")} |`);

  return [header, separator, ...body].join("\n");
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function QueryOutputs({ outputs }: { outputs: QueryOutput[] }) {
  if (outputs.length === 0) {
    return (
      <EmptyState
        title="No query outputs"
        description="Run this playbook to inspect SQL result previews."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-6 py-8 lg:px-10">
      {outputs.map((output) => (
        <QueryOutputTable key={output.cellId} output={output} />
      ))}
    </div>
  );
}

function QueryOutputTable({ output }: { output: QueryOutput }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Table2 className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{output.label}</p>
          <p className="text-xs text-muted-foreground">
            {output.error
              ? "Error"
              : `${(output.rowCount ?? output.rows.length).toLocaleString()} rows${output.timeMs != null ? ` · ${output.timeMs}ms` : ""}`}
          </p>
        </div>
      </div>
      {output.error ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">{output.error}</p>
      ) : output.columns.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">No columns returned.</p>
      ) : output.rows.length === 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                {output.columns.map((column) => (
                  <th key={column} className="px-4 py-2.5 font-medium text-muted-foreground">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
          <p className="px-4 py-4 text-sm text-muted-foreground">No preview rows returned.</p>
        </div>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-max text-left text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-border">
                {output.columns.map((column) => (
                  <th key={column} className="px-4 py-2.5 font-medium text-muted-foreground">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {output.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border/50 last:border-b-0">
                  {output.columns.map((column) => (
                    <td key={column} className="max-w-[260px] truncate px-4 py-2.5 text-muted-foreground">
                      {formatCellValue(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
      <FileText className="size-10 text-muted-foreground" />
      <p className="mt-4 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function formatCellValue(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map(formatCellValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
