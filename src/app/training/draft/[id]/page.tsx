"use client";

import { type ReactNode, use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronRight, FileText, Globe, Loader2, Pencil, ShieldCheck } from "lucide-react";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import type { ScenarioDraft } from "@/features/roleplay/roleplay-draft-store";
import type { TrainingProgram } from "@/features/roleplay/roleplay-training-program-store";
import { MarkdownContent, parseInline } from "@/lib/markdown";

interface MarkdownSection {
  id: string;
  level: number;
  title: string;
  content: string;
  context: string;
  wordCount: number;
}

interface PolicyFactRow {
  label: string;
  value: string;
}

type PolicyFactRun =
  | { type: "bullets"; items: string[] }
  | { type: "rows"; rows: PolicyFactRow[] };

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "policy";
}

const ABSLI_BRIEF_POINTS = [
  "Aditya Birla Sun Life Insurance Company Limited (ABSLI) is a life insurance company under Aditya Birla Capital.",
  "It was incorporated on August 4, 2000 and commenced operations on January 17, 2001, giving it 25+ years of operating history.",
  "ABSLI is a 51:49 joint venture between the Aditya Birla Group and Sun Life Financial Inc., an international financial services organization from Canada.",
  "It offers life insurance products across customer life stages, including protection, savings, child future planning, retirement and pension, health, traditional term plans, and ULIPs.",
  "For this training flow, treat ABSLI as a regulated life insurer: every customer-facing claim should stay inside approved policy material and required disclosures.",
];

function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function splitMarkdownTableRow(row: string): string[] {
  let value = row.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);

  const cells: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (char === "\\" && next === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function cleanPreviewText(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*]\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLowValueLine(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "download prospectus") return true;
  if (normalized === "key features:" || normalized === "key features") return true;
  if (/^(source|prospectus|leaflet|policy contract|cis)\b/i.test(normalized)) return true;
  if (/\bdownload\b/i.test(normalized)) return true;
  return false;
}

function truncatePreview(value: string, maxLength = 150): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function formatListPreview(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function extractTableFields(content: string): string[] {
  const ignoredHeaders = new Set(["field", "condition", "value", "frequency", "premium bands", "annualized premium (rs.)"]);
  const fields: string[] = [];

  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed.includes("|") || /^[\s|:-]+$/.test(trimmed)) return;

    const [firstCell] = splitMarkdownTableRow(trimmed);
    const cleaned = cleanPreviewText(firstCell ?? "");
    if (!cleaned || ignoredHeaders.has(cleaned.toLowerCase())) return;
    if (!fields.some((field) => field.toLowerCase() === cleaned.toLowerCase())) {
      fields.push(cleaned);
    }
  });

  return fields.slice(0, 6);
}

function extractReadableLines(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("|") && !/^#{1,6}\s+/.test(line))
    .map(cleanPreviewText)
    .filter((line) => line && !isLowValueLine(line));
}

function firstSentenceFrom(lines: string[]): string {
  const paragraph = lines.join(" ");
  if (!paragraph) return "";
  const sentence = /.+?(?:[.!?](?=\s|$)|$)/.exec(paragraph)?.[0] ?? paragraph;
  return truncatePreview(sentence);
}

function buildSectionContext(title: string, content: string): string {
  const lines = extractReadableLines(content);
  const text = lines.join(" ");
  const uin = /\bUIN[:\s]+([A-Z0-9]+)\b/i.exec(text)?.[1];
  const tableFields = extractTableFields(content);
  const sentence = firstSentenceFrom(lines.filter((line) => !/^UIN[:\s]/i.test(line) && !/^Download\b/i.test(line)));

  if (uin && sentence) {
    return truncatePreview(`UIN ${uin}; ${sentence}`);
  }

  if (/rider/i.test(title) && sentence) {
    return truncatePreview(`Rider benefit: ${sentence}`);
  }

  if (tableFields.length > 0) {
    const label = tableFields.length === 1 ? "policy field" : "policy fields";
    return truncatePreview(`Covers ${tableFields.length} ${label}: ${formatListPreview(tableFields)}.`);
  }

  if (sentence) {
    return sentence;
  }

  return "Review extracted policy details in this section.";
}

function sectionLevelLabel(level: number): string {
  if (level <= 2) return "Major section";
  if (level === 3) return "Detail";
  return "Subsection";
}

function stripSourceMetadata(value: string): string {
  return value
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== "---" && !/^Source:\s*/i.test(trimmed);
    })
    .join("\n")
    .trim();
}

function splitMarkdownIntoSections(content: string): MarkdownSection[] {
  const lines = content.split("\n");
  const sections: MarkdownSection[] = [];
  let current: { level: number; title: string; lines: string[] } | null = null;

  const pushCurrent = () => {
    if (!current) return;
    const body = stripSourceMetadata(current.lines.join("\n"));
    if (!body) return;
    sections.push({
      id: `${slugify(current.title)}-${sections.length}`,
      level: current.level,
      title: current.title,
      content: body,
      context: buildSectionContext(current.title, body),
      wordCount: countWords(body),
    });
  };

  lines.forEach((line) => {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      pushCurrent();
      current = {
        level: heading[1].length,
        title: heading[2].trim(),
        lines: [],
      };
      return;
    }

    if (!current) {
      current = { level: 2, title: "Document Overview", lines: [] };
    }
    current.lines.push(line);
  });

  pushCurrent();

  if (sections.length === 0 && content.trim()) {
    const body = stripSourceMetadata(content);
    if (!body) return [];
    return [
      {
        id: "document-overview-0",
        level: 2,
        title: "Document Overview",
        content: body,
        context: buildSectionContext("Document Overview", body),
        wordCount: countWords(body),
      },
    ];
  }

  return sections;
}

export default function DraftReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { datasetId } = useDataset();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScenarioDraft | null>(null);

  const [productLabel, setProductLabel] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [editingText, setEditingText] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBreadcrumbTitle("Approve ground truth");

  useEffect(() => {
    if (!isRoleplayEnabled(datasetId)) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const d = await apiFetch<ScenarioDraft>(`/api/roleplay/drafts/${id}`, { skipModel: true });
        if (cancelled) return;
        const draftText = typeof (d as { text?: unknown }).text === "string" ? d.text : "";
        if (!draftText) {
          throw new Error("This draft was created with a newer review format. Fetch the source again.");
        }
        setDraft(d);
        setProductLabel(d.productLabel);
        setPolicyText(draftText);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load this draft.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, datasetId]);

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
      const program = await apiFetch<TrainingProgram>("/api/roleplay/programs", {
        method: "POST",
        body: {
          policyFacts: policyText,
          productLabel,
          source: draft?.source ?? "",
        },
      });
      void apiFetch(`/api/roleplay/drafts/${id}`, { method: "DELETE", skipModel: true }).catch(() => {});
      const firstBundleId = program.modules[0]?.scenarioBundleId;
      router.push(
        firstBundleId
          ? `/training/scenario/${firstBundleId}?section=overview`
          : `/training/program/${program.id}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Program generation failed");
      setGenerating(false);
    }
  }

  const markdownSections = useMemo(() => splitMarkdownIntoSections(policyText), [policyText]);
  const canGenerate = policyText.trim().length >= 40 && !generating;

  if (!isRoleplayEnabled(datasetId)) {
    return (
      <CenteredNote
        title="Training isn't available for this dataset"
        body="AI roleplay training is scoped to the Life Insurance dataset. Switch datasets to use it."
        backHref="/training"
      />
    );
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (loadError || !draft) {
    return (
      <CenteredNote
        title="Draft not found"
        body={loadError ?? "This capture may have expired. Fetch the source again."}
        backHref="/training"
      />
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div className="flex w-full flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
              {draft.sourceMode === "file" ? (
                <FileText className="size-4 text-foreground" />
              ) : (
                <Globe className="size-4 text-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <ShieldCheck className="size-3.5" />
                Product ground truth
              </div>
              <p className="mt-0.5 truncate text-[9.9px] text-muted-foreground" title={draft.source}>
                {draft.source || "Pasted text"}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-start gap-3 sm:ml-auto sm:justify-end">
              <button
                type="button"
                onClick={() => setEditingText((value) => !value)}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[9.9px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {editingText ? (
                  <>
                    <Check className="size-3" /> Done
                  </>
                ) : (
                  <>
                    <Pencil className="size-3" /> Edit
                  </>
                )}
              </button>
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="flex min-h-8 items-center gap-2 rounded-md bg-foreground px-3 text-[9.9px] font-medium text-background transition-opacity disabled:opacity-50"
              >
                {generating && <Loader2 className="size-3 animate-spin" />}
                {generating ? "Building program..." : "Build phone training program"}
              </button>
            </div>
          </div>
          {error && (
            <div className="border-t border-border px-6 py-2 text-right text-xs text-foreground" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="w-full px-6 py-6">
          {editingText ? (
            <textarea
              value={policyText}
              onChange={(e) => setPolicyText(e.target.value)}
              rows={24}
              autoFocus
              className="block w-full resize-y bg-transparent font-mono text-sm leading-relaxed text-foreground focus:outline-none"
              placeholder="Extracted text will appear here for review..."
            />
          ) : (
            <MarkdownAccordion sections={markdownSections} />
          )}
        </div>
      </main>
    </div>
  );
}

function MarkdownAccordion({ sections }: { sections: MarkdownSection[] }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Training context</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Company brief and extracted document sections</p>
        </div>
      </div>

      <div className="space-y-2">
        <AbsliBriefAccordion />
        {sections.map((section) => (
          <details key={section.id} className="group rounded-lg border border-border bg-background">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{section.title}</span>
                  <span className="shrink-0 text-[9.9px] text-muted-foreground">{sectionLevelLabel(section.level)}</span>
                </div>
              </div>
              <span className="hidden shrink-0 text-[9.9px] text-muted-foreground tabular-nums sm:inline">
                {section.wordCount.toLocaleString()} words
              </span>
            </summary>
            <div className="border-t border-border py-4 pl-8 pr-4">
              <TrainingSectionContent content={section.content} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function TrainingSectionContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: ReactNode[] = [];
  let bulletItems: string[] = [];
  let index = 0;
  let key = 0;

  const flushBullets = () => {
    if (bulletItems.length === 0) return;
    elements.push(<PolicyFactList key={`facts-${key++}`} items={bulletItems} />);
    bulletItems = [];
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushBullets();
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushBullets();
      const blockLines = [line];
      index += 1;
      while (index < lines.length) {
        blockLines.push(lines[index]);
        if (lines[index].trim() === "```") {
          index += 1;
          break;
        }
        index += 1;
      }
      elements.push(
        <div key={`markdown-${key++}`} className="text-sm leading-relaxed text-foreground/90">
          <MarkdownContent content={blockLines.join("\n")} />
        </div>,
      );
      continue;
    }

    if (trimmed.includes("|") && index + 1 < lines.length && lines[index + 1]?.trim().match(/^\|[-|:\s]+\|$/)) {
      flushBullets();
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].includes("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      elements.push(
        <div key={`table-${key++}`} className="text-sm leading-relaxed text-foreground/90">
          <MarkdownContent content={tableLines.join("\n")} />
        </div>,
      );
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      flushBullets();
      elements.push(
        <p key={`heading-${key++}`} className="mb-2 text-sm font-medium leading-relaxed text-foreground">
          {parseInline(trimmed.replace(/^#{1,6}\s+/, ""))}
        </p>,
      );
      index += 1;
      continue;
    }

    const labelMatch = /^\*\*([^*]+)\*\*:?\s*$/.exec(trimmed);
    if (labelMatch) {
      flushBullets();
      elements.push(
        <p key={`label-${key++}`} className="text-sm font-medium leading-relaxed text-foreground">
          {labelMatch[1]}
        </p>,
      );
      index += 1;
      continue;
    }

    const plainLabelMatch = /^([A-Z][A-Za-z0-9 '&()/.-]{2,80}):$/.exec(trimmed);
    if (plainLabelMatch) {
      flushBullets();
      elements.push(
        <p key={`label-${key++}`} className="text-sm font-medium leading-relaxed text-foreground">
          {plainLabelMatch[1]}
        </p>,
      );
      index += 1;
      continue;
    }

    bulletItems.push(trimmed.replace(/^\d+\.\s+/, "").replace(/^[-*]\s+/, ""));
    index += 1;
  }

  flushBullets();

  return <div className="space-y-3">{elements}</div>;
}

function shouldJoinPolicyFact(current: string, next: string): boolean {
  if (/^\d+$/.test(current)) return true;
  if (current.endsWith(":")) return false;
  if (/^[a-z(]/.test(next)) return true;
  return current.length <= 80 && !/[.!?;)]$/.test(current) && /^[a-z]/.test(next);
}

function compactPolicyFactItems(items: string[]): string[] {
  const compacted: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    let item = items[index].replace(/\s+/g, " ").trim();
    while (index + 1 < items.length) {
      const next = items[index + 1].replace(/\s+/g, " ").trim();
      if (!item || !next || !shouldJoinPolicyFact(item, next)) break;
      item = `${item} ${next}`;
      index += 1;
    }
    if (item) compacted.push(item);
  }
  return compacted;
}

function parsePolicyFactRow(item: string): PolicyFactRow | null {
  const cleaned = item.replace(/\s+/g, " ").trim();
  const keyValue = /^([^:]{2,64}):\s+(.+)$/.exec(cleaned);
  if (keyValue) {
    const label = keyValue[1].trim();
    const value = keyValue[2].trim();
    if (!value || /^(for|if|when|where|you|note|example)\b/i.test(label)) return null;
    return { label, value };
  }

  const loading = /^([A-Za-z][A-Za-z -]{2,32})\s+(\d+(?:\.\d+)?%\.?)$/.exec(cleaned);
  if (loading) {
    return {
      label: loading[1].trim(),
      value: loading[2].trim(),
    };
  }

  return null;
}

function splitPolicyFactRuns(items: string[]): PolicyFactRun[] {
  const runs: PolicyFactRun[] = [];
  let bullets: string[] = [];
  let rows: PolicyFactRow[] = [];

  const flushBullets = () => {
    if (bullets.length > 0) {
      runs.push({ type: "bullets", items: bullets });
      bullets = [];
    }
  };

  const flushRows = () => {
    if (rows.length >= 2) {
      runs.push({ type: "rows", rows });
    } else if (rows.length === 1) {
      bullets.push(`${rows[0].label}: ${rows[0].value}`);
    }
    rows = [];
  };

  items.forEach((item) => {
    const row = parsePolicyFactRow(item);
    if (row) {
      flushBullets();
      rows.push(row);
      return;
    }

    flushRows();
    bullets.push(item);
  });

  flushRows();
  flushBullets();

  return runs;
}

function PolicyFactList({ items }: { items: string[] }) {
  const compactedItems = compactPolicyFactItems(items);
  const runs = splitPolicyFactRuns(compactedItems);
  return (
    <div className="space-y-3">
      {runs.map((run, runIndex) => {
        if (run.type === "rows") {
          return <PolicyFactRows key={`rows-${runIndex}`} rows={run.rows} />;
        }

        return (
          <ul key={`bullets-${runIndex}`} className="space-y-2 text-sm leading-relaxed text-foreground/90">
            {run.items.map((item, index) => (
              <li key={`${item}-${index}`} className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                <span>{parseInline(item)}</span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

function PolicyFactRows({ rows }: { rows: PolicyFactRow[] }) {
  return (
    <dl className="overflow-hidden rounded-md border border-border text-sm">
      {rows.map((row, index) => (
        <div
          key={`${row.label}-${index}`}
          className="grid gap-1 border-t border-border px-3 py-2 first:border-t-0 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-4"
        >
          <dt className="font-medium leading-relaxed text-foreground">{parseInline(row.label)}</dt>
          <dd className="min-w-0 leading-relaxed text-foreground/85">{parseInline(row.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function AbsliBriefAccordion() {
  return (
    <details className="group rounded-lg border border-border bg-background">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">About ABSLI</span>
            <span className="shrink-0 text-[9.9px] text-muted-foreground">Company brief</span>
          </div>
        </div>
      </summary>
      <div className="border-t border-border py-4 pl-8 pr-4">
        <PolicyFactList items={ABSLI_BRIEF_POINTS} />
      </div>
    </details>
  );
}

function CenteredNote({ title, body, backHref }: { title: string; body: string; backHref?: string }) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <p className="font-medium text-foreground">{title}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
          {backHref && (
            <Link
              href={backHref}
              className="mt-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Back to Training
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
