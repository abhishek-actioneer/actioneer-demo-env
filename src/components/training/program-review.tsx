"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BookOpenCheck,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  PhoneCall,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type {
  TrainingModuleReviewStatus,
  TrainingProgram,
  TrainingProgramModule,
} from "@/features/roleplay/roleplay-training-program-store";

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function moduleStatus(module: TrainingProgramModule): TrainingModuleReviewStatus {
  return module.reviewStatus ?? "needs_review";
}

function moduleStatusLabel(status: TrainingModuleReviewStatus): string {
  if (status === "approved") return "Approved";
  if (status === "changes_requested") return "Changes requested";
  return "Needs review";
}

/**
 * The image-#3 "phone training program" review body: role curriculum on the
 * left, module goal / next-step / approved-source rail on the right.
 *
 * Presentational only — shared by the standalone program page
 * (`/training/program/[id]`) and the scenario workspace "Program" tab so the
 * two stay identical. The host supplies its own page header/chrome.
 */
export function ProgramReview({ program }: { program: TrainingProgram }) {
  const approvedCount = program.modules.filter((module) => moduleStatus(module) === "approved").length;
  const hasChangesRequested = program.modules.some((module) => moduleStatus(module) === "changes_requested");
  const allApproved = program.modules.length > 0 && approvedCount === program.modules.length;

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Role curriculum</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each module shows the lesson, practice sequence, compliance wording, and assessment failures.
          </p>
        </div>

        <div className="mt-3 flex flex-col gap-4">
          {program.modules.map((module, index) => (
            <ModuleCard key={module.id} programId={program.id} module={module} defaultOpen={index === 0} />
          ))}
        </div>
      </section>

      <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
        <section className="rounded-lg border border-border p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
              <BookOpenCheck className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground">Module goal</h2>
              <div className="mt-3 space-y-4">
                {program.modules.map((module) => (
                  <div key={module.id}>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {module.role} · {module.title}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-foreground">{module.objective}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
              <UsersRound className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground">Next: add trainees</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {allApproved
                  ? "SP and RO modules are approved. Add trainee phone numbers, then launch practice or assessment calls."
                  : hasChangesRequested
                    ? "Resolve requested changes before adding trainees."
                    : `Approve ${program.modules.length - approvedCount} module${program.modules.length - approvedCount === 1 ? "" : "s"} before adding trainees.`}
              </p>
              <div className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {approvedCount}/{program.modules.length} approved
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
              <FileText className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground">Approved source</h2>
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Created</div>
                  <div className="mt-0.5 text-foreground">{formatDate(program.createdAt)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source</div>
                  <div className="mt-0.5 min-w-0 truncate text-foreground" title={program.source}>
                    {program.source || "Approved product facts"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

function ModuleCard({
  programId,
  module,
  defaultOpen = false,
}: {
  programId: string;
  module: TrainingProgramModule;
  defaultOpen?: boolean;
}) {
  const status = moduleStatus(module);
  const StatusIcon = status === "approved" ? CheckCircle2 : status === "changes_requested" ? AlertTriangle : ClipboardCheck;
  return (
    <details className="group/module rounded-lg border border-border bg-background" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 transition-colors hover:bg-muted/35 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open/module:rotate-90" />
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>{module.role} module</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                <StatusIcon className="size-3" />
                {moduleStatusLabel(status)}
              </span>
            </div>
            <h3 className="mt-1 text-base font-semibold text-foreground">{module.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{module.objective}</p>
            {status === "changes_requested" && module.reviewNote ? (
              <p className="mt-2 text-sm leading-relaxed text-foreground">{module.reviewNote}</p>
            ) : null}
          </div>
          <Link
            href={`/training/program/${programId}/module/${module.id}`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            Review module
            <ChevronRight className="size-3.5" />
          </Link>
        </div>
      </summary>

      <div className="divide-y divide-border">
        <CurriculumSection
          icon={ClipboardCheck}
          title={module.role === "RO" ? "What ROs will be taught" : "What SPs will be taught"}
          body={
            module.role === "RO"
              ? "Teach the RO to restart the conversation, correct expectations, handle objections, and move the customer to a clear next step."
              : "Teach the SP to open the branch conversation, discover the need, explain the product simply, and capture consent."
          }
          items={module.outcomes}
          empty="No teaching outcomes generated."
        />
        <CurriculumSection
          icon={PhoneCall}
          title="How the practice call will run"
          body="The simulated customer will create openings for these behaviours in a short phone conversation."
          items={module.callFlow}
          empty="No practice sequence generated."
          ordered
        />
        <CurriculumSection
          icon={FileText}
          title="Required wording to rehearse"
          body="These are the must-say compliance points the trainee should practise saying naturally."
          items={module.mandatoryDisclosures}
          empty="No mandatory disclosures generated."
        />
        <CurriculumSection
          icon={ShieldCheck}
          title="What fails the assessment"
          body="The trainee fails if they make these prohibited or misleading claims."
          items={module.guardrails}
          empty="No assessment failures generated."
        />
        <CurriculumSection
          icon={UsersRound}
          title="Customer simulation"
          body="The voice agent will use this customer setup to test the trainee."
          items={module.customerSituations}
          empty="No customer simulation generated."
        />
      </div>
    </details>
  );
}

function CurriculumSection({
  icon: Icon,
  title,
  body,
  items,
  empty,
  ordered = false,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  items: string[];
  empty: string;
  ordered?: boolean;
}) {
  const ListTag = ordered ? "ol" : "ul";
  return (
    <section className="p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border">
          <Icon className="size-3.5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
          {items.length > 0 ? (
            <ListTag className={`mt-3 space-y-2 text-sm leading-relaxed text-foreground/90 ${ordered ? "list-decimal pl-5" : ""}`}>
              {items.map((item, index) => (
                <li key={`${title}-${index}`} className={ordered ? "" : "flex gap-2"}>
                  {!ordered && <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" />}
                  <span>{item}</span>
                </li>
              ))}
            </ListTag>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
          )}
        </div>
      </div>
    </section>
  );
}
