"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpenCheck, Loader2, PhoneCall } from "lucide-react";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import type { TrainingProgram } from "@/features/roleplay/roleplay-training-program-store";
import { ProgramReview } from "@/components/training/program-review";

export default function TrainingProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { datasetId } = useDataset();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [program, setProgram] = useState<TrainingProgram | null>(null);

  useBreadcrumbTitle(program?.productLabel ? `${program.productLabel} program` : "Training program");

  useEffect(() => {
    if (!isRoleplayEnabled(datasetId)) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const result = await apiFetch<TrainingProgram>(`/api/roleplay/programs/${id}`, { skipModel: true });
        if (cancelled) return;
        setProgram(result);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load this training program.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, datasetId]);

  if (!isRoleplayEnabled(datasetId)) {
    return (
      <CenteredNote
        title="Training isn't available for this dataset"
        body="AI roleplay training is scoped to the Life Insurance dataset. Switch datasets to use it."
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

  if (loadError || !program) {
    return (
      <CenteredNote
        title="Program not found"
        body={loadError ?? "This training program may have expired. Build it again from the approved facts."}
        backHref="/training"
      />
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-border px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <BookOpenCheck className="size-3.5" />
                Phone training program
              </div>
              <h1 className="mt-2 text-xl font-semibold text-foreground">{program.productLabel}</h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Review what SPs and ROs will be taught before adding trainees and launching calls.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link
                href="/training"
                className="inline-flex min-h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                New program
              </Link>
              <Link
                href={`/training/scenario/${program.modules[0]?.scenarioBundleId}?section=run`}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background"
              >
                <PhoneCall className="size-4" />
                Preview calls
              </Link>
            </div>
          </div>
        </div>

        <ProgramReview program={program} />
      </main>
    </div>
  );
}

function CenteredNote({ title, body, backHref }: { title: string; body: string; backHref?: string }) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <AlertTriangle className="size-8 text-muted-foreground" />
          <p className="font-medium text-foreground">{title}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
          {backHref && (
            <Link href={backHref} className="mt-2 text-sm text-foreground underline underline-offset-4">
              Back to Training
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
