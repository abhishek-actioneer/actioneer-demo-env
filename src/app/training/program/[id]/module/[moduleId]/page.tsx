"use client";

import { use, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Loader2,
  Pencil,
  PhoneCall,
  Plus,
  Save,
  ShieldCheck,
  Target,
  Trash2,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";
import { useDataset } from "@/lib/dataset-context";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import type {
  TrainingModuleReviewStatus,
  TrainingProgram,
  TrainingProgramModule,
} from "@/features/roleplay/roleplay-training-program-store";
import type {
  ComplianceTrap,
  CoverageItem,
  Persona,
  RubricItem,
  SavedScenarioBundle,
  TraineeRole,
} from "@/features/roleplay/roleplay-scenario";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function rolePlural(role: TraineeRole): string {
  return role === "RO" ? "ROs" : "SPs";
}

function moduleStatus(module: TrainingProgramModule): TrainingModuleReviewStatus {
  return module.reviewStatus ?? "needs_review";
}

function statusLabel(status: TrainingModuleReviewStatus): string {
  if (status === "approved") return "Approved";
  if (status === "changes_requested") return "Changes requested";
  return "Needs review";
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = value.replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";
}

interface ModuleEditDraft {
  title: string;
  objective: string;
  outcomes: string[];
  callFlow: string[];
  mandatoryDisclosures: string[];
  guardrails: string[];
  policyFacts: string;
  requiredCoverage: CoverageItem[];
  traps: ComplianceTrap[];
  roleRubric: RubricItem[];
  personas: Persona[];
}

function newCoverageItem(): CoverageItem {
  return {
    id: `coverage-${Date.now().toString(36)}`,
    topic: "",
    kind: "talking_point",
    required: true,
    detail: "",
  };
}

function newTrap(): ComplianceTrap {
  return {
    id: `trap-${Date.now().toString(36)}`,
    label: "",
    bait: "",
    pass: "",
    fail: "",
    groundTruthRef: "",
  };
}

function newRubricItem(): RubricItem {
  return {
    id: `rubric-${Date.now().toString(36)}`,
    label: "",
    weight: 0.1,
    pass: "",
    fail: "",
  };
}

function newPersona(role: TraineeRole): Persona {
  return {
    id: `customer-${Date.now().toString(36)}`,
    role,
    name: "",
    difficulty: "medium",
    language: "Hinglish",
    characterPrompt: "",
    openingLine: "",
    arcNotes: "",
  };
}

function buildEditDraft(
  program: TrainingProgram,
  trainingModule: TrainingProgramModule,
  bundle: SavedScenarioBundle | null,
): ModuleEditDraft {
  const coverage = bundle?.spine.coverage ?? [];
  const disclosureTopics = coverage
    .filter((item) => item.required && item.kind === "disclosure")
    .map((item) => item.topic);

  return {
    title: trainingModule.title,
    objective: trainingModule.objective,
    outcomes: [...trainingModule.outcomes],
    callFlow: [...trainingModule.callFlow],
    mandatoryDisclosures: unique([...trainingModule.mandatoryDisclosures, ...disclosureTopics]),
    guardrails: [...trainingModule.guardrails],
    policyFacts: bundle?.policyFacts || program.policyFacts,
    requiredCoverage: coverage
      .filter((item) => item.required && item.kind !== "disclosure")
      .map((item) => ({ ...item })),
    traps: (bundle?.spine.traps ?? []).map((trap) => ({ ...trap })),
    roleRubric: (bundle?.roleModule.rubric ?? []).map((item) => ({ ...item })),
    personas: (bundle?.personas ?? []).map((persona) => ({ ...persona })),
  };
}

function buildModuleFromDraft(module: TrainingProgramModule, draft: ModuleEditDraft): TrainingProgramModule {
  const customerSituations = draft.personas.length > 0
    ? draft.personas.map((persona) => `${persona.name || "Customer"}: ${persona.openingLine}`.trim())
    : module.customerSituations;

  return {
    ...module,
    title: draft.title.trim() || module.title,
    objective: draft.objective.trim() || module.objective,
    outcomes: unique(draft.outcomes),
    callFlow: unique(draft.callFlow),
    mandatoryDisclosures: unique(draft.mandatoryDisclosures),
    guardrails: draft.traps.length > 0
      ? unique(draft.traps.map((trap) => `${trap.label || "Compliance"}: ${trap.fail}`))
      : unique(draft.guardrails),
    customerSituations: unique(customerSituations),
  };
}

function buildDisclosureCoverageItems(existing: CoverageItem[], disclosures: string[]): CoverageItem[] {
  const existingDisclosures = existing.filter((item) => item.kind === "disclosure");
  return unique(disclosures).map((topic, index) => ({
    ...(existingDisclosures[index] ?? {
      id: `disclosure-${slugify(topic)}-${index + 1}`,
      kind: "disclosure" as const,
      required: true,
    }),
    topic,
    kind: "disclosure" as const,
    required: true,
  }));
}

export default function TrainingModuleReviewPage({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}) {
  const { id, moduleId } = use(params);
  const { datasetId } = useDataset();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [program, setProgram] = useState<TrainingProgram | null>(null);
  const [bundle, setBundle] = useState<SavedScenarioBundle | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<ModuleEditDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [requestNote, setRequestNote] = useState("");

  const trainingModule = useMemo(
    () => program?.modules.find((item) => item.id === moduleId) ?? null,
    [program, moduleId],
  );

  useBreadcrumbTitle(
    program && trainingModule
      ? `${program.productLabel} ${trainingModule.role} module`
      : "Module review",
  );

  useEffect(() => {
    if (!isRoleplayEnabled(datasetId)) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setBundleError(null);
    setProgram(null);
    setBundle(null);

    (async () => {
      try {
        const nextProgram = await apiFetch<TrainingProgram>(`/api/roleplay/programs/${id}`, { skipModel: true });
        if (cancelled) return;
        setProgram(nextProgram);

        const selectedModule = nextProgram.modules.find((item) => item.id === moduleId);
        if (!selectedModule) return;

        try {
          const nextBundle = await apiFetch<SavedScenarioBundle>(
            `/api/roleplay/scenarios/${selectedModule.scenarioBundleId}`,
            { skipModel: true },
          );
          if (!cancelled) setBundle(nextBundle);
        } catch (e) {
          if (!cancelled) {
            setBundleError(e instanceof Error ? e.message : "Couldn't load the scenario details.");
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load this module.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, moduleId, datasetId]);

  useEffect(() => {
    if (!program || !trainingModule || dirty) return;
    setEditDraft(buildEditDraft(program, trainingModule, bundle));
  }, [program, trainingModule, bundle, dirty]);

  function updateDraft(updater: (current: ModuleEditDraft) => ModuleEditDraft) {
    setEditDraft((current) => {
      if (!current) return current;
      return updater(current);
    });
    setDirty(true);
    setJustSaved(false);
    setSaveError(null);
  }

  function startEditing() {
    if (program && trainingModule && !editDraft) {
      setEditDraft(buildEditDraft(program, trainingModule, bundle));
    }
    setEditing(true);
  }

  function cancelEditing() {
    if (program && trainingModule) {
      setEditDraft(buildEditDraft(program, trainingModule, bundle));
    }
    setEditing(false);
    setDirty(false);
    setSaveError(null);
  }

  async function saveEdits(decision?: { status: TrainingModuleReviewStatus; note?: string }) {
    if (!program || !trainingModule) return;

    setSaving(true);
    setSaveError(null);
    try {
      const draft = editDraft ?? buildEditDraft(program, trainingModule, bundle);
      let nextModule = buildModuleFromDraft(trainingModule, draft);
      const now = Date.now();
      const reviewStatus = decision?.status ?? (dirty ? "needs_review" : moduleStatus(trainingModule));
      if (bundle) {
        nextModule = {
          ...nextModule,
          guardrails: unique(
            draft.traps
              .filter((trap) => trap.label.trim() || trap.fail.trim())
              .map((trap) => `${trap.label || "Compliance"}: ${trap.fail}`),
          ),
        };
      }
      nextModule = {
        ...nextModule,
        reviewStatus,
        reviewNote: decision ? (decision.note ?? "").trim() : trainingModule.reviewNote,
        reviewedAt: decision ? now : reviewStatus === "needs_review" ? undefined : trainingModule.reviewedAt,
      };
      const nextModules = program.modules.map((module) => (module.id === nextModule.id ? nextModule : module));
      let nextBundle = bundle;

      if (bundle) {
        const existingCoverage = bundle.spine.coverage ?? [];
        const optionalCoverage = existingCoverage.filter((item) => !item.required);
        const disclosureCoverage = buildDisclosureCoverageItems(existingCoverage, draft.mandatoryDisclosures);
        nextBundle = {
          ...bundle,
          policyFacts: draft.policyFacts,
          spine: {
            ...bundle.spine,
            policyFacts: draft.policyFacts,
            coverage: [
              ...draft.requiredCoverage
                .filter((item) => item.topic.trim())
                .map((item, index) => ({
                  ...item,
                  id: item.id || `coverage-${index + 1}`,
                  topic: item.topic.trim(),
                  detail: item.detail?.trim(),
                  required: true,
                })),
              ...disclosureCoverage,
              ...optionalCoverage,
            ],
            traps: draft.traps
              .filter((trap) => trap.label.trim() || trap.fail.trim())
              .map((trap, index) => ({
                ...trap,
                id: trap.id || `trap-${index + 1}`,
                label: trap.label.trim() || `Compliance ${index + 1}`,
                bait: trap.bait.trim(),
                pass: trap.pass.trim(),
                fail: trap.fail.trim(),
                groundTruthRef: trap.groundTruthRef.trim(),
              })),
          },
          roleModule: {
            ...bundle.roleModule,
            rubric: draft.roleRubric
              .filter((item) => item.label.trim() || item.pass.trim() || item.fail.trim())
              .map((item, index) => ({
                ...item,
                id: item.id || `rubric-${index + 1}`,
                label: item.label.trim() || `Rubric ${index + 1}`,
                pass: item.pass.trim(),
                fail: item.fail.trim(),
                weight: Number.isFinite(item.weight) ? item.weight : 0,
              })),
          },
          personas: draft.personas
            .filter((persona) => persona.name.trim() || persona.openingLine.trim() || persona.characterPrompt.trim())
            .map((persona, index) => ({
              ...persona,
              id: persona.id || `customer-${index + 1}`,
              role: trainingModule.role,
              name: persona.name.trim() || `Customer ${index + 1}`,
              characterPrompt: persona.characterPrompt.trim(),
              openingLine: persona.openingLine.trim(),
              arcNotes: persona.arcNotes?.trim(),
            })),
          updatedAt: Date.now(),
        };

        const savedBundle = await apiFetch<SavedScenarioBundle>(`/api/roleplay/scenarios/${bundle.id}`, {
          method: "PUT",
          skipModel: true,
          body: {
            name: nextBundle.name,
            productId: nextBundle.productId,
            productLabel: nextBundle.productLabel,
            role: nextBundle.role,
            difficulty: nextBundle.difficulty,
            language: nextBundle.language,
            policyFacts: nextBundle.policyFacts,
            spine: nextBundle.spine,
            roleModule: nextBundle.roleModule,
            personas: nextBundle.personas.length > 0 ? nextBundle.personas : bundle.personas,
          },
        });
        nextBundle = savedBundle;
        setBundle(savedBundle);
      }

      const savedProgram = await apiFetch<TrainingProgram>(`/api/roleplay/programs/${program.id}`, {
        method: "PUT",
        skipModel: true,
        body: {
          productLabel: program.productLabel,
          source: program.source,
          policyFacts: draft.policyFacts,
          status: program.status,
          modules: nextModules.map((module) => ({
            ...module,
            reviewedAt: module.reviewedAt ?? null,
          })),
        },
      });

      setProgram(savedProgram);
      const savedModule = savedProgram.modules.find((module) => module.id === moduleId) ?? nextModule;
      setEditDraft(buildEditDraft(savedProgram, savedModule, nextBundle));
      setEditing(false);
      setDirty(false);
      setRequestChangesOpen(false);
      setRequestNote("");
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save module edits.");
    } finally {
      setSaving(false);
    }
  }

  function approveModule() {
    void saveEdits({ status: "approved", note: "" });
  }

  function openRequestChangesDialog() {
    setRequestNote(trainingModule?.reviewNote ?? "");
    setRequestChangesOpen(true);
    setSaveError(null);
  }

  function requestChanges() {
    const note = requestNote.trim();
    if (!note) {
      setSaveError("Add a short note explaining what needs to change.");
      return;
    }
    void saveEdits({ status: "changes_requested", note });
  }

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

  if (!trainingModule) {
    return (
      <CenteredNote
        title="Module not found"
        body="This program no longer contains the selected module."
        backHref={`/training/program/${program.id}`}
      />
    );
  }

  const reviewDraft = editDraft ?? buildEditDraft(program, trainingModule, bundle);
  const requiredDisclosures = reviewDraft.mandatoryDisclosures;
  const requiredCoverage = reviewDraft.requiredCoverage;
  const sourceFacts = reviewDraft.policyFacts;
  const personas = reviewDraft.personas;
  const roleLabel = rolePlural(trainingModule.role);
  const currentStatus = moduleStatus(trainingModule);
  const DecisionIcon =
    currentStatus === "approved" ? CheckCircle2 : currentStatus === "changes_requested" ? AlertTriangle : ClipboardCheck;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-border px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <Link
                href={`/training/program/${program.id}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
                Program overview
              </Link>
              <div className="mt-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <BookOpenCheck className="size-3.5" />
                {trainingModule.role} module review
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                  {currentStatus === "approved" ? (
                    <CheckCircle2 className="size-3" />
                  ) : currentStatus === "changes_requested" ? (
                    <AlertTriangle className="size-3" />
                  ) : (
                    <ClipboardCheck className="size-3" />
                  )}
                  {statusLabel(currentStatus)}
                </span>
              </div>
              <h1 className="mt-2 text-xl font-semibold text-foreground">{reviewDraft.title}</h1>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {reviewDraft.objective}
              </p>
              {(saveError || justSaved || dirty) && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {saveError ? <span className="text-foreground">{saveError}</span> : justSaved ? "Saved" : "Unsaved changes"}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={cancelEditing}
                    disabled={saving}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <X className="size-4" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEdits()}
                    disabled={saving || !dirty}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    Save changes
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={startEditing}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <Pencil className="size-4" />
                    Edit module
                  </button>
                  <button
                    type="button"
                    onClick={openRequestChangesDialog}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <AlertTriangle className="size-4" />
                    Request changes
                  </button>
                  <button
                    type="button"
                    onClick={approveModule}
                    disabled={saving || currentStatus === "approved"}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    {currentStatus === "approved" ? "Approved" : "Approve module"}
                  </button>
                  <Link
                    href={`/training/program/${program.id}`}
                    className="inline-flex min-h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    Back to program
                  </Link>
                </>
              )}
              <Link
                href={`/training/scenario/${trainingModule.scenarioBundleId}?section=run`}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background"
              >
                <PhoneCall className="size-4" />
                Preview calls
              </Link>
            </div>
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="flex min-w-0 flex-col gap-5">
            {bundleError && (
              <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{bundleError} Showing the approved curriculum summary only.</span>
              </div>
            )}

            <ReviewSection
              icon={Target}
              title="Module goal"
              description={`The approved outcome for this ${trainingModule.role} training module.`}
            >
              {editing ? (
                <div className="space-y-3">
                  <TextField
                    label="Module title"
                    value={reviewDraft.title}
                    onChange={(value) => updateDraft((current) => ({ ...current, title: value }))}
                  />
                  <TextAreaField
                    label="Goal"
                    value={reviewDraft.objective}
                    onChange={(value) => updateDraft((current) => ({ ...current, objective: value }))}
                    rows={3}
                  />
                </div>
              ) : (
                <p className="text-base leading-relaxed text-foreground">{reviewDraft.objective}</p>
              )}
            </ReviewSection>

            <ReviewSection
              icon={ClipboardCheck}
              title={`What ${roleLabel} will be taught`}
              description="The lesson should make these behaviours explicit before the trainee reaches a live assessment call."
            >
              {editing ? (
                <StringListEditor
                  items={reviewDraft.outcomes}
                  addLabel="Add outcome"
                  emptyItem="New teaching outcome"
                  onChange={(outcomes) => updateDraft((current) => ({ ...current, outcomes }))}
                />
              ) : (
                <PlainList items={reviewDraft.outcomes} empty="No teaching outcomes generated." />
              )}
            </ReviewSection>

            <ReviewSection
              icon={PhoneCall}
              title="Conversation sequence"
              description="The simulated customer will create openings for this sequence during practice and assessment calls."
            >
              {editing ? (
                <StringListEditor
                  items={reviewDraft.callFlow}
                  addLabel="Add step"
                  emptyItem="New conversation step"
                  ordered
                  onChange={(callFlow) => updateDraft((current) => ({ ...current, callFlow }))}
                />
              ) : (
                <OrderedPath items={reviewDraft.callFlow} empty="No conversation sequence generated." />
              )}
            </ReviewSection>

            <ReviewSection
              icon={FileText}
              title="Required wording"
              description={`${roleLabel} must be able to say these compliance points naturally, without inventing extra promises.`}
            >
              {editing ? (
                <StringListEditor
                  items={requiredDisclosures}
                  addLabel="Add disclosure"
                  emptyItem="New required wording"
                  onChange={(mandatoryDisclosures) => updateDraft((current) => ({ ...current, mandatoryDisclosures }))}
                />
              ) : (
                <PlainList items={requiredDisclosures} empty="No mandatory disclosures generated." />
              )}
            </ReviewSection>

            <ReviewSection
              icon={ShieldCheck}
              title="Assessment fail conditions"
              description="These claims or misses should fail the assessment even if the rest of the call sounds smooth."
            >
              {editing ? (
                reviewDraft.traps.length > 0 || bundle ? (
                  <TrapEditor
                    traps={reviewDraft.traps}
                    onChange={(traps) => updateDraft((current) => ({ ...current, traps }))}
                  />
                ) : (
                  <StringListEditor
                    items={reviewDraft.guardrails}
                    addLabel="Add fail condition"
                    emptyItem="New fail condition"
                    onChange={(guardrails) => updateDraft((current) => ({ ...current, guardrails }))}
                  />
                )
              ) : (
                <FailConditions items={reviewDraft.guardrails} traps={reviewDraft.traps} />
              )}
            </ReviewSection>

            <ReviewSection
              icon={ClipboardCheck}
              title="Scoring rubric"
              description="This is the role-specific scoring logic the assessment judge will apply after a call transcript is captured."
            >
              {editing ? (
                <div className="space-y-5">
                  <CoverageEditor
                    items={requiredCoverage}
                    onChange={(items) => updateDraft((current) => ({ ...current, requiredCoverage: items }))}
                  />
                  <RubricEditor
                    items={reviewDraft.roleRubric}
                    onChange={(items) => updateDraft((current) => ({ ...current, roleRubric: items }))}
                  />
                </div>
              ) : (
                <RubricReview roleItems={reviewDraft.roleRubric} requiredCoverage={requiredCoverage} />
              )}
            </ReviewSection>

            <ReviewSection
              icon={UsersRound}
              title="Customer simulations"
              description="These customer setups are used to test whether the trainee can apply the module under realistic pressure."
            >
              {editing ? (
                <PersonaEditor
                  role={trainingModule.role}
                  personas={personas}
                  onChange={(nextPersonas) => updateDraft((current) => ({ ...current, personas: nextPersonas }))}
                />
              ) : (
                <CustomerSituations personas={personas} fallback={trainingModule.customerSituations} />
              )}
            </ReviewSection>

            <ApprovedFactsSection
              text={sourceFacts}
              editing={editing}
              onChange={(policyFacts) => updateDraft((current) => ({ ...current, policyFacts }))}
            />
          </section>

          <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
            <SideCard icon={DecisionIcon} title="Review decision">
              <div className="space-y-3 text-sm">
                <KeyValue label="Status" value={statusLabel(currentStatus)} />
                {trainingModule.reviewedAt ? <KeyValue label="Reviewed" value={formatDate(trainingModule.reviewedAt)} /> : null}
                {trainingModule.reviewNote ? (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Note</div>
                    <p className="mt-1 leading-relaxed text-foreground">{trainingModule.reviewNote}</p>
                  </div>
                ) : null}
              </div>
              {editing ? (
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Save or cancel edits before approving or requesting changes.
                </p>
              ) : (
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={approveModule}
                    disabled={saving || currentStatus === "approved"}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    {currentStatus === "approved" ? "Approved" : "Approve module"}
                  </button>
                  <button
                    type="button"
                    onClick={openRequestChangesDialog}
                    disabled={saving}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <AlertTriangle className="size-4" />
                    Request changes
                  </button>
                </div>
              )}
            </SideCard>

            {editing && (
              <SideCard icon={Pencil} title="Editing">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {dirty ? "Unsaved changes" : "No changes yet"}
                </p>
                {saveError && <p className="mt-2 text-sm leading-relaxed text-foreground">{saveError}</p>}
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void saveEdits()}
                    disabled={saving || !dirty}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    Save changes
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditing}
                    disabled={saving}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <X className="size-4" />
                    Cancel
                  </button>
                </div>
              </SideCard>
            )}

            <SideCard icon={BookOpenCheck} title="Review scope">
              <div className="space-y-3 text-sm">
                <KeyValue label="Product" value={program.productLabel} />
                <KeyValue label="Role" value={`${trainingModule.role} module`} />
                <KeyValue label="Level" value={bundle ? `${bundle.difficulty} · ${bundle.language}` : "Assessment ready"} />
              </div>
            </SideCard>

            <SideCard icon={CheckCircle2} title="Review checklist">
              <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  <span>The role goal matches what {roleLabel} need to do.</span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  <span>Required disclosures are teachable in a phone call.</span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  <span>Fail conditions are specific enough to score.</span>
                </li>
              </ul>
            </SideCard>

            <SideCard icon={PhoneCall} title="Next step">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Return to the program when the module reads correctly, or preview the call experience before adding trainees.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <Link
                  href={`/training/program/${program.id}`}
                  className="inline-flex min-h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Back to program
                </Link>
                <Link
                  href={`/training/scenario/${trainingModule.scenarioBundleId}?section=run`}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background"
                >
                  <PhoneCall className="size-4" />
                  Preview calls
                </Link>
              </div>
            </SideCard>

            <SideCard icon={FileText} title="Approved source">
              <div className="space-y-3 text-sm">
                <KeyValue label="Created" value={formatDate(program.createdAt)} />
                <KeyValue label="Source" value={program.source || "Approved product facts"} truncate />
              </div>
            </SideCard>
          </aside>
        </div>
      </main>
      <Dialog
        open={requestChangesOpen}
        onOpenChange={(open) => {
          if (saving) return;
          setRequestChangesOpen(open);
          if (!open) {
            setRequestNote("");
            setSaveError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request module changes</DialogTitle>
            <DialogDescription>
              Add the reviewer note that explains what must be corrected before this module can be approved.
            </DialogDescription>
          </DialogHeader>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reviewer note</span>
            <textarea
              value={requestNote}
              rows={5}
              onChange={(event) => {
                setRequestNote(event.target.value);
                setSaveError(null);
              }}
              className="mt-1 w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground"
              placeholder="Example: Simplify the consent step and add the surrender-charge disclosure."
            />
          </label>
          {saveError ? <p className="text-sm leading-relaxed text-foreground">{saveError}</p> : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setRequestChangesOpen(false);
                setRequestNote("");
                setSaveError(null);
              }}
              disabled={saving}
              className="inline-flex min-h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={requestChanges}
              disabled={saving || !requestNote.trim()}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
              Request changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

function PlainList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <ul className="space-y-2.5 text-sm leading-relaxed text-foreground">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2.5">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function OrderedPath({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <ol className="space-y-3 text-sm leading-relaxed text-foreground">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
          <div className="flex flex-col items-center">
            <span className="flex size-7 items-center justify-center rounded-full border border-border text-[9.9px] text-muted-foreground">
              {index + 1}
            </span>
            {index < items.length - 1 && <span className="h-7 w-px bg-border" />}
          </div>
          <span className="pt-1">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function FailConditions({ items, traps }: { items: string[]; traps: ComplianceTrap[] }) {
  const values = unique([
    ...items,
    ...traps.map((trap) => `${trap.label}: ${trap.fail}`),
  ]);

  if (values.length === 0) {
    return <p className="text-sm text-muted-foreground">No assessment failures generated.</p>;
  }

  return (
    <ul className="space-y-2.5 text-sm leading-relaxed text-foreground">
      {values.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function RubricReview({
  roleItems,
  requiredCoverage,
}: {
  roleItems: RubricItem[];
  requiredCoverage: CoverageItem[];
}) {
  if (roleItems.length === 0 && requiredCoverage.length === 0) {
    return <p className="text-sm text-muted-foreground">No scoring rubric generated.</p>;
  }

  return (
    <div className="space-y-5">
      {roleItems.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Role rubric</h3>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {roleItems.map((item) => (
              <RubricRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {requiredCoverage.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Required coverage</h3>
          <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-foreground">
            {requiredCoverage.map((item) => (
              <li key={item.id} className="flex gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="font-medium">{item.topic}</span>
                  {item.detail ? <span className="text-muted-foreground"> · {item.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RubricRow({ item }: { item: RubricItem }) {
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{item.label}</span>
        {item.gate && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground">
            Gate
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-3 text-sm leading-relaxed lg:grid-cols-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pass</div>
          <p className="mt-0.5 text-foreground">{item.pass}</p>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fail</div>
          <p className="mt-0.5 text-muted-foreground">{item.fail}</p>
        </div>
      </div>
    </div>
  );
}

function CustomerSituations({
  personas,
  fallback,
}: {
  personas: Persona[];
  fallback: TrainingProgramModule["customerSituations"];
}) {
  if (personas.length > 0) {
    return (
      <div className="divide-y divide-border border-y border-border">
        {personas.map((persona) => (
          <div key={persona.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-foreground">{persona.name}</h3>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {persona.difficulty} · {persona.language}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{persona.openingLine}</p>
            {persona.arcNotes ? (
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{persona.arcNotes}</p>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return <PlainList items={fallback} empty="No customer simulation generated." />;
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-10 w-full rounded-md border border-border bg-transparent px-3 text-sm text-foreground"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground"
      />
    </label>
  );
}

function StringListEditor({
  items,
  onChange,
  addLabel,
  emptyItem,
  ordered = false,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  addLabel: string;
  emptyItem: string;
  ordered?: boolean;
}) {
  function updateItem(index: number, value: string) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="space-y-3">
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_32px] gap-2">
              <div className="relative">
                {ordered && (
                  <span className="absolute left-3 top-3 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                )}
                <textarea
                  value={item}
                  rows={2}
                  onChange={(event) => updateItem(index, event.target.value)}
                  className={`w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground ${
                    ordered ? "pl-8" : ""
                  }`}
                />
              </div>
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Remove item"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No items yet.</p>
      )}

      <button
        type="button"
        onClick={() => onChange([...items, emptyItem])}
        className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        <Plus className="size-3.5" />
        {addLabel}
      </button>
    </div>
  );
}

function CoverageEditor({
  items,
  onChange,
}: {
  items: CoverageItem[];
  onChange: (items: CoverageItem[]) => void;
}) {
  function updateItem(index: number, patch: Partial<CoverageItem>) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Required coverage</h3>
        <button
          type="button"
          onClick={() => onChange([...items, newCoverageItem()])}
          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Plus className="size-3.5" />
          Add coverage
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {items.length === 0 && <p className="text-sm text-muted-foreground">No required coverage yet.</p>}
        {items.map((item, index) => (
          <div key={item.id || index} className="rounded-md border border-border p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-3">
                <TextAreaField
                  label="Topic"
                  value={item.topic}
                  rows={2}
                  onChange={(value) => updateItem(index, { topic: value })}
                />
                <TextAreaField
                  label="Detail"
                  value={item.detail ?? ""}
                  rows={2}
                  onChange={(value) => updateItem(index, { detail: value })}
                />
              </div>
              <button
                type="button"
                onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Remove coverage"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrapEditor({ traps, onChange }: { traps: ComplianceTrap[]; onChange: (traps: ComplianceTrap[]) => void }) {
  function updateTrap(index: number, patch: Partial<ComplianceTrap>) {
    onChange(traps.map((trap, trapIndex) => (trapIndex === index ? { ...trap, ...patch } : trap)));
  }

  return (
    <div className="space-y-3">
      {traps.length === 0 && <p className="text-sm text-muted-foreground">No fail conditions yet.</p>}
      {traps.map((trap, index) => (
        <div key={trap.id || index} className="rounded-md border border-border p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-3">
              <TextField label="Label" value={trap.label} onChange={(value) => updateTrap(index, { label: value })} />
              <TextAreaField label="Customer bait" value={trap.bait} rows={2} onChange={(value) => updateTrap(index, { bait: value })} />
              <TextAreaField label="Pass" value={trap.pass} rows={2} onChange={(value) => updateTrap(index, { pass: value })} />
              <TextAreaField label="Fail" value={trap.fail} rows={2} onChange={(value) => updateTrap(index, { fail: value })} />
              <TextField
                label="Source ref"
                value={trap.groundTruthRef}
                onChange={(value) => updateTrap(index, { groundTruthRef: value })}
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(traps.filter((_, trapIndex) => trapIndex !== index))}
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Remove fail condition"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...traps, newTrap()])}
        className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        <Plus className="size-3.5" />
        Add fail condition
      </button>
    </div>
  );
}

function RubricEditor({ items, onChange }: { items: RubricItem[]; onChange: (items: RubricItem[]) => void }) {
  function updateItem(index: number, patch: Partial<RubricItem>) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Role rubric</h3>
        <button
          type="button"
          onClick={() => onChange([...items, newRubricItem()])}
          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Plus className="size-3.5" />
          Add rubric item
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {items.length === 0 && <p className="text-sm text-muted-foreground">No rubric items yet.</p>}
        {items.map((item, index) => (
          <div key={item.id || index} className="rounded-md border border-border p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-3">
                <TextField label="Label" value={item.label} onChange={(value) => updateItem(index, { label: value })} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
                  <label className="block">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Weight</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={item.weight}
                      onChange={(event) => updateItem(index, { weight: Number(event.target.value) })}
                      className="mt-1 min-h-10 w-full rounded-md border border-border bg-transparent px-3 text-sm text-foreground"
                    />
                  </label>
                  <label className="mt-6 flex min-h-10 items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={Boolean(item.gate)}
                      onChange={(event) => updateItem(index, { gate: event.target.checked || undefined })}
                      className="size-4"
                    />
                    Hard gate
                  </label>
                </div>
                <TextAreaField label="Pass" value={item.pass} rows={2} onChange={(value) => updateItem(index, { pass: value })} />
                <TextAreaField label="Fail" value={item.fail} rows={2} onChange={(value) => updateItem(index, { fail: value })} />
              </div>
              <button
                type="button"
                onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Remove rubric item"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PersonaEditor({
  role,
  personas,
  onChange,
}: {
  role: TraineeRole;
  personas: Persona[];
  onChange: (personas: Persona[]) => void;
}) {
  function updatePersona(index: number, patch: Partial<Persona>) {
    onChange(personas.map((persona, personaIndex) => (personaIndex === index ? { ...persona, ...patch } : persona)));
  }

  return (
    <div className="space-y-3">
      {personas.length === 0 && <p className="text-sm text-muted-foreground">No customer simulations yet.</p>}
      {personas.map((persona, index) => (
        <div key={persona.id || index} className="rounded-md border border-border p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-3">
              <TextField label="Customer name" value={persona.name} onChange={(value) => updatePersona(index, { name: value })} />
              <TextAreaField
                label="Opening line"
                value={persona.openingLine}
                rows={2}
                onChange={(value) => updatePersona(index, { openingLine: value })}
              />
              <TextAreaField
                label="Character"
                value={persona.characterPrompt}
                rows={4}
                onChange={(value) => updatePersona(index, { characterPrompt: value })}
              />
              <TextAreaField
                label="Arc notes"
                value={persona.arcNotes ?? ""}
                rows={3}
                onChange={(value) => updatePersona(index, { arcNotes: value })}
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(personas.filter((_, personaIndex) => personaIndex !== index))}
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Remove customer"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...personas, newPersona(role)])}
        className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        <Plus className="size-3.5" />
        Add customer
      </button>
    </div>
  );
}

function ApprovedFactsSection({
  text,
  editing = false,
  onChange,
}: {
  text: string;
  editing?: boolean;
  onChange?: (text: string) => void;
}) {
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
          <FileText className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">Approved source facts</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{text.length.toLocaleString()} characters</p>
        </div>
        <span className="text-sm font-medium text-foreground">Open</span>
      </summary>
      <div className="border-t border-border p-5">
        {editing ? (
          <textarea
            value={text}
            rows={16}
            onChange={(event) => onChange?.(event.target.value)}
            className="w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs leading-relaxed text-foreground"
          />
        ) : (
          <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 font-mono text-xs leading-relaxed text-foreground">
            {text || "No source facts available."}
          </div>
        )}
      </div>
    </details>
  );
}

function SideCard({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

function KeyValue({ label, value, truncate = false }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-foreground ${truncate ? "truncate" : ""}`} title={truncate ? value : undefined}>
        {value}
      </div>
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
