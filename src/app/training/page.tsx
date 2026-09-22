"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronRight,
  FileText,
  Globe,
  GraduationCap,
  Link as LinkIcon,
  Loader2,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import type { ScenarioDraft } from "@/features/roleplay/roleplay-draft-store";
import type { TrainingProgram } from "@/features/roleplay/roleplay-training-program-store";

type SourceMode = "url" | "file";
type IngestResult = {
  text: string;
  productLabel: string;
  source: string;
  truncated: boolean;
};
type DraftListResult = { drafts: ScenarioDraft[] };
type ProgramListResult = { programs: TrainingProgram[] };

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm";

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function TrainingPage() {
  const { datasetId } = useDataset();
  const router = useRouter();
  const roleplayEnabled = isRoleplayEnabled(datasetId);

  const [urlValues, setUrlValues] = useState<string[]>([""]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [ingesting, setIngesting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<ScenarioDraft[]>([]);
  const [savedPrograms, setSavedPrograms] = useState<TrainingProgram[]>([]);

  useEffect(() => {
    if (!roleplayEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const [draftResult, programResult] = await Promise.all([
          apiFetch<DraftListResult>("/api/roleplay/drafts", { skipModel: true }),
          apiFetch<ProgramListResult>("/api/roleplay/programs", { skipModel: true }),
        ]);
        if (cancelled) return;
        setSavedDrafts(draftResult.drafts);
        setSavedPrograms(programResult.programs);
      } catch (e) {
        console.error("[training] saved work load failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleplayEnabled, datasetId]);

  if (!roleplayEnabled) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <div className="mx-auto w-full max-w-5xl px-6 py-8">
          <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
            <GraduationCap className="size-10 text-muted-foreground" />
            <p className="font-medium text-foreground">Training is scoped to Life Insurance</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Switch to the Life Insurance dataset to configure phone-based SP and RO training.
            </p>
          </div>
        </div>
      </div>
    );
  }

  async function openDraft(result: IngestResult, mode: SourceMode) {
    const draft = await apiFetch<ScenarioDraft>("/api/roleplay/drafts", {
      method: "POST",
      skipModel: true,
      body: {
        text: result.text,
        productLabel: result.productLabel,
        source: result.source,
        sourceMode: mode,
        truncated: result.truncated,
      },
    });
    router.push(`/training/draft/${draft.id}`);
  }

  async function ingestUrl(url: string): Promise<IngestResult> {
    return apiFetch<IngestResult>("/api/roleplay/ingest", {
      method: "POST",
      body: { url },
      skipModel: true,
    });
  }

  async function ingestFile(file: File): Promise<IngestResult> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/roleplay/ingest", {
      method: "POST",
      headers: { "x-dataset-id": datasetId },
      body: form,
    });
    const data = (await res.json()) as Partial<IngestResult> & { error?: string };
    if (!res.ok) throw new Error(data.error || `Could not read ${file.name}.`);
    return data as IngestResult;
  }

  async function handleReviewSources() {
    if (ingesting) return;
    const urls = urlValues.map((value) => value.trim()).filter(Boolean);
    const files = selectedFiles;
    if (urls.length === 0 && files.length === 0) {
      setError("Add at least one URL or document.");
      return;
    }
    setError(null);
    setIngesting(true);
    try {
      const results = await Promise.all([
        ...urls.map((url) => ingestUrl(url)),
        ...files.map((file) => ingestFile(file)),
      ]);
      const labels = results.map((result, index) => result.productLabel || result.source || `Source ${index + 1}`);
      const combinedText = results
        .map((result, index) => {
          const title = labels[index];
          const source = result.source ? `Source: ${result.source}\n\n` : "";
          return `## ${title}\n\n${source}${result.text}`;
        })
        .join("\n\n---\n\n");
      await openDraft(
        {
          text: combinedText,
          productLabel: labels.length === 1 ? labels[0] : `${labels[0]} + ${labels.length - 1} more`,
          source: labels.join(", "),
          truncated: results.some((result) => result.truncated),
        },
        files.length > 0 ? "file" : "url",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read one of the sources.");
      setIngesting(false);
    }
  }

  function updateUrl(index: number, value: string) {
    setUrlValues((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function addUrl() {
    setUrlValues((prev) => [...prev, ""]);
  }

  function removeUrl(index: number) {
    setUrlValues((prev) => (prev.length === 1 ? [""] : prev.filter((_, itemIndex) => itemIndex !== index)));
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    setSelectedFiles((prev) => {
      const existing = new Set(prev.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const next = [...prev];
      Array.from(files).forEach((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!existing.has(key)) {
          existing.add(key);
          next.push(file);
        }
      });
      return next;
    });
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  const sourceCount = urlValues.filter((value) => value.trim()).length + selectedFiles.length;
  const hasSavedWork = savedDrafts.length > 0 || savedPrograms.length > 0;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <header className="mb-6">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <GraduationCap className="size-3.5" />
              Training
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-foreground">Create a phone training pack</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Start from approved product material. We will review the text next, then generate the phone scenarios.
            </p>
          </header>

          <section className="rounded-lg border border-border">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Source material</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Add one or more approved URLs and documents.
              </p>
            </div>

            <div className="space-y-6 p-4">
              <div className="rounded-lg border border-border p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
                    <Globe className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-foreground">Approved product URLs</h3>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                      Fetch product pages or policy sources, then approve the extracted ground truth.
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {urlValues.map((urlValue, index) => (
                    <div key={index} className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor={`training-source-url-${index}`}>
                        URL {index + 1}
                      </label>
                      <div className="flex gap-2">
                        <div className="relative min-w-0 flex-1">
                          <Globe className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input
                            id={`training-source-url-${index}`}
                            type="url"
                            value={urlValue}
                            onChange={(e) => updateUrl(index, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handleReviewSources();
                            }}
                            placeholder="https://lifeinsurance.adityabirlacapital.com/..."
                            className="min-h-10 w-full rounded-md border border-border bg-transparent pl-9 pr-3 text-sm text-foreground"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeUrl(index)}
                          className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                          disabled={urlValues.length === 1 && !urlValue.trim()}
                          aria-label={`Remove URL ${index + 1}`}
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addUrl}
                    disabled={ingesting}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Plus className="size-4" />
                    Add URL
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
                    <FileText className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-foreground">Document uploads</h3>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                      Upload PDF, DOCX, markdown, text, CSV, JSON, or HTML source material.
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={ingesting}
                    className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 text-center text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
                  >
                    <span className="flex size-9 items-center justify-center rounded-full border border-border">
                      <Upload className="size-4" />
                    </span>
                    <span className="text-sm font-medium">Choose documents</span>
                    <span className="text-xs text-muted-foreground">Multiple files supported</span>
                  </button>

                  {selectedFiles.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-border">
                      {selectedFiles.map((file, index) => (
                        <div
                          key={`${file.name}:${file.size}:${file.lastModified}`}
                          className={`flex items-center gap-3 px-3 py-2 text-sm ${index > 0 ? "border-t border-border" : ""}`}
                        >
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-foreground">{file.name}</span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {(file.size / 1024).toFixed(0)} KB
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFile(index)}
                            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label={`Remove ${file.name}`}
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {sourceCount === 0
                    ? "Add at least one source to continue."
                    : `${sourceCount} source${sourceCount === 1 ? "" : "s"} ready for review.`}
                </p>
                <button
                  type="button"
                  onClick={() => void handleReviewSources()}
                  disabled={sourceCount === 0 || ingesting}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity disabled:opacity-50"
                >
                  {ingesting ? <Loader2 className="size-4 animate-spin" /> : <LinkIcon className="size-4" />}
                  {ingesting ? "Reading sources..." : "Review sources"}
                </button>
              </div>
            </div>
          </section>

          {hasSavedWork && (
            <section className="mt-6 rounded-lg border border-border">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Saved training work</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Resume captured source reviews or reopen generated training programs.
                </p>
              </div>

              <div className="divide-y divide-border">
                {savedDrafts.map((draft) => (
                  <Link
                    key={draft.id}
                    href={`/training/draft/${draft.id}`}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/35"
                  >
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
                      {draft.sourceMode === "file" ? (
                        <FileText className="size-4 text-muted-foreground" />
                      ) : (
                        <Globe className="size-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-sm font-medium text-foreground">{draft.productLabel || "Captured source"}</p>
                        <span className="text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground">Needs review</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{draft.source || "Pasted text"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDate(draft.createdAt)}</p>
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}

                {savedPrograms.map((program) => (
                  <Link
                    key={program.id}
                    href={
                      program.modules[0]?.scenarioBundleId
                        ? `/training/scenario/${program.modules[0].scenarioBundleId}?section=overview`
                        : `/training/program/${program.id}`
                    }
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/35"
                  >
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
                      <GraduationCap className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-sm font-medium text-foreground">{program.productLabel}</p>
                        <span className="text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground">
                          {program.modules.length} modules
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{program.source || "Approved product facts"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDate(program.updatedAt)}</p>
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>{error}</span>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
            className="hidden"
          />
        </div>
      </main>
    </div>
  );
}
