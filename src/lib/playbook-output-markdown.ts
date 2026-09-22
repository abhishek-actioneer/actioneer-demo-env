import { inferChartSpec } from "@/lib/chart-inference";
import type { PlaybookRunHistory, PlaybookV2 } from "@/lib/playbook-types";

type CellSummary = NonNullable<PlaybookRunHistory["cellSummaries"]>[number];

export function buildPlaybookOutputMarkdown(playbook: PlaybookV2, run?: PlaybookRunHistory): string {
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

function formatCellValue(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map(formatCellValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
