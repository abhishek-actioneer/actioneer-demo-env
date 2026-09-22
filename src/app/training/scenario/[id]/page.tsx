"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  BookOpenCheck,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  ListChecks,
  Loader2,
  PhoneCall,
  Save,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import {
  type Difficulty,
  type Persona,
  type RoleModule,
  type SavedScenarioBundle,
  type ScenarioSpine,
  type TraineeRole,
} from "@/features/roleplay/roleplay-scenario";
import { TrapsSection, RubricSection, PersonasSection, PlanSection } from "@/components/training/scenario-editor";
import { CallStudioSection } from "@/components/training/call-studio-section";
import { ProgramReview } from "@/components/training/program-review";
import type { TrainingProgram } from "@/features/roleplay/roleplay-training-program-store";

type SectionKey = "overview" | "plan" | "traps" | "rubric" | "personas" | "run";
type TrainingSectionTab = { key: SectionKey; label: string; count?: number; icon: LucideIcon };

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "policy";
}

function coerceSection(value: string | string[] | undefined): SectionKey {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "run" || raw === "plan" || raw === "traps" || raw === "rubric" || raw === "personas") return raw;
  return "overview";
}

export default function ScenarioWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const { id } = use(params);
  const query = use(searchParams);
  const initialSection = coerceSection(query.section);
  const { datasetId } = useDataset();

  // Loaded bundle → editable state.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [productLabel, setProductLabel] = useState("");
  const [policyFacts, setPolicyFacts] = useState("");
  const [role, setRole] = useState<TraineeRole>("SP");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [language, setLanguage] = useState("Hinglish");
  const [spine, setSpine] = useState<ScenarioSpine | null>(null);
  const [roleModule, setRoleModule] = useState<RoleModule | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);

  const [section, setSection] = useState<SectionKey>(initialSection);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useBreadcrumbTitle(name || "Training program");

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  // Load the bundle.
  useEffect(() => {
    if (!isRoleplayEnabled(datasetId)) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const b = await apiFetch<SavedScenarioBundle>(`/api/roleplay/scenarios/${id}`, { skipModel: true });
        if (cancelled) return;
        setName(b.name);
        setProductLabel(b.productLabel);
        setPolicyFacts(b.policyFacts);
        setRole(b.role);
        setDifficulty(b.difficulty);
        setLanguage(b.language);
        setSpine(b.spine);
        setRoleModule(b.roleModule);
        setPersonas(b.personas);
        setDirty(false);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load this scenario.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, datasetId]);

  // Dirty-tracking wrappers for the editor sections.
  const onSpineChange = (next: ScenarioSpine) => { setSpine(next); setDirty(true); };
  const onRoleModuleChange = (next: RoleModule) => { setRoleModule(next); setDirty(true); };
  const onPersonasChange = (next: Persona[]) => { setPersonas(next); setDirty(true); };

  async function handleSave() {
    if (!spine || !roleModule || personas.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiFetch<SavedScenarioBundle>(`/api/roleplay/scenarios/${id}`, {
        method: "PUT",
        body: {
          name: name.trim() || productLabel || spine.productLabel,
          productId: slugify(productLabel || spine.productLabel),
          productLabel: productLabel || spine.productLabel,
          role,
          difficulty,
          language,
          policyFacts,
          spine,
          roleModule,
          personas,
        },
      });
      setDirty(false);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save the scenario.");
    } finally {
      setSaving(false);
    }
  }

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (!isRoleplayEnabled(datasetId)) {
    return (
      <CenteredNote
        title="Training isn’t available for this dataset"
        body="AI roleplay training is scoped to the Life Insurance dataset. Switch datasets to use it."
      />
    );
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (loadError || !spine || !roleModule) {
    return (
      <CenteredNote
        title="Scenario not found"
        body={loadError ?? "This scenario may have been deleted."}
        backHref="/training"
      />
    );
  }

  const SECTIONS: TrainingSectionTab[] = [
    { key: "overview", label: "Program", icon: BookOpenCheck },
    { key: "run", label: "Phone calls", icon: PhoneCall },
    { key: "plan", label: "Call plan", count: (spine.coverage ?? []).length, icon: ListChecks },
    { key: "traps", label: "Guardrails", count: spine.traps.length, icon: ShieldCheck },
    { key: "rubric", label: "Scoring", count: roleModule.rubric.length, icon: ClipboardCheck },
    { key: "personas", label: "Customers", count: personas.length, icon: UsersRound },
  ];

  return (
    <div className="flex flex-col h-full min-w-0">
      <Tabs
        value={section}
        onValueChange={(value) => setSection(value as SectionKey)}
        className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-2">
          <TrainingTabList sections={SECTIONS} />
          <div className="ml-auto flex shrink-0 items-center gap-2 pr-3">
            <span className="hidden text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
              {role} · {difficulty}
            </span>
            {saveError && <span className="max-w-48 truncate text-xs text-foreground">⚠ {saveError}</span>}
            {justSaved && !dirty && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="w-3.5 h-3.5" /> Saved</span>
            )}
            {dirty && <span className="hidden text-xs text-muted-foreground md:inline">Unsaved changes</span>}
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
          </div>
        </div>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TabsContent value="overview" className="min-h-0 overflow-y-auto data-[state=inactive]:hidden">
            <ProgramTab
              bundleId={id}
              fallback={
                <div className="mx-auto w-full max-w-5xl px-6 py-6">
                  <OverviewSection
                    name={name}
                    onNameChange={(v) => { setName(v); setDirty(true); }}
                    productLabel={productLabel}
                    role={role}
                    difficulty={difficulty}
                    language={language}
                    personaCount={personas.length}
                    trapCount={spine.traps.length}
                    coverageCount={(spine.coverage ?? []).length}
                    policyFacts={policyFacts}
                    onPolicyFactsChange={(v) => { setPolicyFacts(v); setDirty(true); }}
                    roleModule={roleModule}
                    spine={spine}
                    onOpenPhoneCalls={() => setSection("run")}
                  />
                </div>
              }
            />
          </TabsContent>

          <TabsContent value="run" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
            <CallStudioSection bundleId={id} datasetId={datasetId} />
          </TabsContent>

          <TabsContent value="plan" className="min-h-0 overflow-y-auto data-[state=inactive]:hidden">
            <div className="mx-auto w-full max-w-5xl px-6 py-6">
              <PlanSection spine={spine} onSpineChange={onSpineChange} />
            </div>
          </TabsContent>

          <TabsContent value="traps" className="min-h-0 overflow-y-auto data-[state=inactive]:hidden">
            <div className="mx-auto w-full max-w-5xl px-6 py-6">
              <TrapsSection spine={spine} onSpineChange={onSpineChange} />
            </div>
          </TabsContent>

          <TabsContent value="rubric" className="min-h-0 overflow-y-auto data-[state=inactive]:hidden">
            <div className="mx-auto w-full max-w-5xl px-6 py-6">
              <RubricSection roleModule={roleModule} onRoleModuleChange={onRoleModuleChange} />
            </div>
          </TabsContent>

          <TabsContent value="personas" className="min-h-0 overflow-y-auto data-[state=inactive]:hidden">
            <div className="mx-auto w-full max-w-5xl px-6 py-6">
              <PersonasSection role={role} personas={personas} onPersonasChange={onPersonasChange} />
            </div>
          </TabsContent>
        </main>
      </Tabs>
    </div>
  );
}

function TrainingTabList({ sections }: { sections: TrainingSectionTab[] }) {
  return (
    <TabsList
      variant="line"
      aria-label="Training scenario sections"
      className="h-12 min-w-0 flex-1 items-stretch justify-start gap-1 overflow-x-auto rounded-none px-4 py-0"
    >
      {sections.map((section) => {
        const Icon = section.icon;
        return (
          <TabsTrigger
            key={section.key}
            value={section.key}
            className="group/training-tab h-auto flex-none self-stretch rounded-none px-2.5 text-[11.7px] after:hidden data-[state=active]:font-semibold"
          >
            <Icon className="size-3.5" />
            <span>{section.label}</span>
            {section.count !== undefined && (
              <span className="ml-0.5 text-[9.9px] tabular-nums text-muted-foreground">{section.count}</span>
            )}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-[-1px] hidden h-px bg-foreground group-data-[state=active]/training-tab:block"
            />
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}

// ── Section panels ─────────────────────────────────────────────────────────

/**
 * "Program" tab. Loads the training program this scenario belongs to (matched
 * by scenario bundle id) and renders the shared program-review flow. Falls back
 * to the standalone scenario overview when the scenario isn't part of a program.
 */
function ProgramTab({ bundleId, fallback }: { bundleId: string; fallback: ReactNode }) {
  const { datasetId } = useDataset();
  const [loading, setLoading] = useState(true);
  const [program, setProgram] = useState<TrainingProgram | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProgram(null);
    (async () => {
      try {
        const result = await apiFetch<{ programs: TrainingProgram[] }>("/api/roleplay/programs", { skipModel: true });
        if (cancelled) return;
        const parent =
          result.programs.find((candidate) => candidate.modules.some((module) => module.scenarioBundleId === bundleId)) ??
          null;
        setProgram(parent);
      } catch {
        if (!cancelled) setProgram(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bundleId, datasetId]);

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (program) {
    return <ProgramReview program={program} />;
  }

  return <>{fallback}</>;
}

function OverviewSection({
  name,
  onNameChange,
  productLabel,
  role,
  difficulty,
  language,
  personaCount,
  trapCount,
  coverageCount,
  policyFacts,
  onPolicyFactsChange,
  roleModule,
  spine,
  onOpenPhoneCalls,
}: {
  name: string;
  onNameChange: (v: string) => void;
  productLabel: string;
  role: string;
  difficulty: string;
  language: string;
  personaCount: number;
  trapCount: number;
  coverageCount: number;
  policyFacts: string;
  onPolicyFactsChange: (v: string) => void;
  roleModule: RoleModule;
  spine: ScenarioSpine;
  onOpenPhoneCalls: () => void;
}) {
  const [showFacts, setShowFacts] = useState(false);
  const mandatoryDisclosures = (spine.coverage ?? []).filter((item) => item.required && item.kind === "disclosure").length;
  const roleGates = roleModule.rubric.filter((item) => item.gate).length;
  const totalGates = roleGates + trapCount + mandatoryDisclosures;
  const roleObjective =
    role === "RO"
      ? "Warm follow-up: reset context, handle objections, stay consistent with the SP, and earn a concrete next step."
      : "Branch-first contact: explain the product from scratch, discover need, and capture explicit consent.";
  const callMoments =
    role === "RO"
      ? ["Customer remembers the branch pitch", "Return and lock-in objection", "Carry-forward consistency check", "Callback / BOAT next step"]
      : ["FD-renewal walk-in", "Need discovery", "Simple product explanation", "Consent before lead entry"];
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border px-2 py-0.5 text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground">
                Phone assessment program
              </span>
              <span className="text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground">
                {role} · {difficulty} · {language}
              </span>
            </div>
            <h1 className="mt-3 text-xl font-semibold text-foreground">{productLabel || "Training program"}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{roleObjective}</p>
          </div>
          <button
            type="button"
            onClick={onOpenPhoneCalls}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-foreground px-3.5 py-2 text-sm font-medium text-background"
          >
            <PhoneCall className="size-4" />
            Start phone calls
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ProgramStat label="Customers" value={String(personaCount)} detail="personas ready" />
          <ProgramStat label="Call plan" value={String(coverageCount)} detail="items to cover" />
          <ProgramStat label="Hard gates" value={String(totalGates)} detail="fail conditions" />
          <ProgramStat label="Evidence" value="Transcript" detail="recording backed" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <PhoneCall className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">What the call tests</h2>
          </div>
          <div className="flex flex-col gap-3">
            {callMoments.map((moment, index) => (
              <div key={moment} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
                <div className="flex flex-col items-center">
                  <span className="flex size-6 items-center justify-center rounded-full border border-border text-[9.9px] text-muted-foreground">
                    {index + 1}
                  </span>
                  {index < callMoments.length - 1 && <span className="h-8 w-px bg-border" />}
                </div>
                <div className="pb-3 text-sm text-foreground">{moment}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Pass / fail logic</h2>
          </div>
          <div className="flex flex-col gap-2">
            <GateRow label="Role gates" value={`${roleGates} required`} />
            <GateRow label="Compliance traps" value={`${trapCount} forbidden claims`} />
            <GateRow label="Mandatory disclosures" value={`${mandatoryDisclosures} must-say`} />
            <GateRow label="Scored competencies" value={`${roleModule.rubric.filter((item) => !item.gate).length} weighted`} />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            A smooth call can still fail if the trainee promises a prohibited benefit, skips a required disclosure,
            or fails the role gate.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="mb-3 flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Program details</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <label className="flex flex-col gap-1">
            <span className="text-[9.9px] uppercase tracking-wide text-muted-foreground">Program name</span>
            <input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="min-h-10 rounded-md border border-border bg-transparent px-3 text-sm text-foreground"
              placeholder="e.g. Anmol Akshaya SP certification"
            />
          </label>
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-[9.9px] uppercase tracking-wide text-muted-foreground">Product</div>
            <div className="mt-0.5 truncate text-sm font-medium text-foreground">{productLabel || "Policy"}</div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <button
            onClick={() => setShowFacts((s) => !s)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
          >
            <FileText className="size-3.5 text-muted-foreground" />
            <span className="text-sm text-foreground">Approved product facts</span>
            <span className="ml-auto text-[9.9px] text-muted-foreground">
              {policyFacts.length.toLocaleString()} chars · {showFacts ? "hide" : "show"}
            </span>
          </button>
          {showFacts && (
            <div className="border-t border-border p-3">
              <textarea
                value={policyFacts}
                onChange={(e) => onPolicyFactsChange(e.target.value)}
                rows={12}
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-sm leading-relaxed text-foreground"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgramStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-[9.9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function GateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm text-foreground">{label}</span>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{value}</span>
    </div>
  );
}

function CenteredNote({ title, body, backHref }: { title: string; body: string; backHref?: string }) {
  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="max-w-5xl mx-auto px-6 py-8 w-full">
        <div className="flex flex-col items-center justify-center text-center h-[60vh] gap-3">
          <p className="text-foreground font-medium">{title}</p>
          <p className="text-sm text-muted-foreground max-w-sm">{body}</p>
          {backHref && (
            <Link href={backHref} className="text-sm text-foreground underline underline-offset-4">
              ← Back to Training
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
