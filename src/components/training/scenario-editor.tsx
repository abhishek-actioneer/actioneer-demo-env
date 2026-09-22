"use client";

/**
 * Trainer-edit surface for a generated roleplay scenario — split into sections.
 * ------------------------------------------------------------------------------
 * The AI derives traps + rubric + personas; a handler reviews and TUNES them here
 * before reps drill. Fully controlled — edits flow up via onChange callbacks, and
 * the parent recomputes the runnable scenarios (and scorer rubric) from these
 * exact values, so what the trainer approves is what gets run and graded.
 *
 * Progressive disclosure: each item is a CollapsibleCard (collapsed → title +
 * one-line summary; click to expand its fields). Textareas auto-grow so nothing
 * is clipped. Monochrome only (project rule).
 */

import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  ClipboardCheck,
  ListChecks,
  Plus,
  ShieldCheck,
  Trash2,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type {
  CoverageKind,
  Difficulty,
  Persona,
  RoleModule,
  RoleplayLanguage,
  ScenarioSpine,
} from "@/features/roleplay/roleplay-scenario";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const LANGUAGES: RoleplayLanguage[] = [
  "English",
  "Hindi",
  "Hinglish",
  "Kannada",
  "Odia",
  "Tamil",
];

const inputCls =
  "w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground";
const areaCls =
  "w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground leading-relaxed";

/** Textarea that grows to fit its content — no fixed rows, no clipping. */
function AutoTextarea({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={2}
      className={className}
      style={{ resize: "none", overflow: "hidden" }}
    />
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9.9px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function CollapsibleCard({
  title,
  summary,
  onRemove,
  children,
}: {
  title: string;
  summary?: string;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-stretch">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/30"
        >
          <ChevronRight
            className={`w-4 h-4 mt-0.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-foreground truncate">{title}</span>
            {!open && summary && (
              <span className="block text-xs text-muted-foreground truncate">{summary}</span>
            )}
          </span>
        </button>
        {onRemove && (
          <button
            onClick={onRemove}
            className="flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Remove"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-2.5 px-3 pb-3 pt-2 border-t border-border">{children}</div>
      )}
    </div>
  );
}

function SectionStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-20 rounded-lg border border-border px-3 py-2 text-right">
      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function TrainingEditorSection({
  icon: Icon,
  title,
  description,
  stats,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  stats?: Array<{ label: string; value: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {stats && stats.length > 0 && (
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
            {stats.map((stat) => (
              <SectionStat key={stat.label} label={stat.label} value={stat.value} />
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 self-start rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
    >
      <Plus className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

// ── Traps ────────────────────────────────────────────────────────────────────

export function TrapsSection({
  spine,
  onSpineChange,
}: {
  spine: ScenarioSpine;
  onSpineChange: (next: ScenarioSpine) => void;
}) {
  const traps = spine.traps;
  const update = (i: number, patch: Partial<(typeof traps)[number]>) =>
    onSpineChange({ ...spine, traps: traps.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });
  const add = () =>
    onSpineChange({
      ...spine,
      traps: [
        ...traps,
        { id: `trap-${traps.length + 1}`, label: "", bait: "", pass: "", fail: "", groundTruthRef: "" },
      ],
    });
  const remove = (i: number) => onSpineChange({ ...spine, traps: traps.filter((_, idx) => idx !== i) });

  return (
    <TrainingEditorSection
      icon={ShieldCheck}
      title="Guardrails"
      description="The claims the trainee must not over-promise. Each guardrail becomes a pass/fail gate during assessment."
      stats={[
        { label: "Traps", value: String(traps.length) },
        { label: "Gate", value: "Assess" },
      ]}
    >
      <div className="flex flex-col gap-2">
        {traps.map((t, i) => (
          <CollapsibleCard key={i} title={t.label || `Trap ${i + 1}`} summary={t.bait || t.pass} onRemove={() => remove(i)}>
            <Labeled label="Label">
              <input className={inputCls} value={t.label} onChange={(e) => update(i, { label: e.target.value })} />
            </Labeled>
            <Labeled label="Bait — what the customer says to tempt the violation">
              <AutoTextarea className={areaCls} value={t.bait} onChange={(e) => update(i, { bait: e.target.value })} />
            </Labeled>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Labeled label="Pass — compliant answer">
                <AutoTextarea className={areaCls} value={t.pass} onChange={(e) => update(i, { pass: e.target.value })} />
              </Labeled>
              <Labeled label="Fail — the violation to flag">
                <AutoTextarea className={areaCls} value={t.fail} onChange={(e) => update(i, { fail: e.target.value })} />
              </Labeled>
            </div>
            <Labeled label="Ground-truth reference (policy line it violates)">
              <AutoTextarea className={areaCls} value={t.groundTruthRef} onChange={(e) => update(i, { groundTruthRef: e.target.value })} />
            </Labeled>
          </CollapsibleCard>
        ))}
        <AddButton label="Add trap" onClick={add} />
      </div>
    </TrainingEditorSection>
  );
}

// ── Coverage plan (call agenda) ──────────────────────────────────────────────

const COVERAGE_KINDS: { value: CoverageKind; label: string }[] = [
  { value: "talking_point", label: "Talking point" },
  { value: "discovery", label: "Discovery (ask)" },
  { value: "disclosure", label: "Disclosure (must-say)" },
  { value: "objection", label: "Objection" },
];

const KIND_LABEL: Record<CoverageKind, string> = {
  talking_point: "Talking point",
  discovery: "Discovery",
  disclosure: "Disclosure",
  objection: "Objection",
};

export function PlanSection({
  spine,
  onSpineChange,
}: {
  spine: ScenarioSpine;
  onSpineChange: (next: ScenarioSpine) => void;
}) {
  const coverage = spine.coverage ?? [];
  const update = (i: number, patch: Partial<(typeof coverage)[number]>) =>
    onSpineChange({ ...spine, coverage: coverage.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  const add = () =>
    onSpineChange({
      ...spine,
      coverage: [
        ...coverage,
        { id: `cover-${coverage.length + 1}`, topic: "", kind: "talking_point", required: true, detail: "" },
      ],
    });
  const remove = (i: number) =>
    onSpineChange({ ...spine, coverage: coverage.filter((_, idx) => idx !== i) });
  const requiredCount = coverage.filter((c) => c.required).length;
  const disclosureCount = coverage.filter((c) => c.required && c.kind === "disclosure").length;

  return (
    <TrainingEditorSection
      icon={ListChecks}
      title="Call plan"
      description="The live-call agenda a good rep must actively cover. Required disclosures become assessment gates; other required items are scored competencies."
      stats={[
        { label: "Items", value: String(coverage.length) },
        { label: "Required", value: String(requiredCount) },
        { label: "Disclose", value: String(disclosureCount) },
      ]}
    >
      <div className="flex flex-col gap-2">
        {coverage.map((c, i) => (
          <CollapsibleCard
            key={i}
            title={c.topic || `Coverage item ${i + 1}`}
            summary={`${c.required ? "Required" : "Optional"} · ${KIND_LABEL[c.kind]}`}
            onRemove={() => remove(i)}
          >
            <Labeled label="Topic — what must be covered">
              <input className={inputCls} value={c.topic} onChange={(e) => update(i, { topic: e.target.value })} />
            </Labeled>
            <div className="flex flex-wrap items-end gap-3">
              <Labeled label="Kind">
                <select
                  className={`${inputCls} w-48`}
                  value={c.kind}
                  onChange={(e) => update(i, { kind: e.target.value as CoverageKind })}
                >
                  {COVERAGE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
              </Labeled>
              <button
                onClick={() => update(i, { required: !c.required })}
                className={`h-[34px] rounded-md border px-3 text-xs font-medium transition-colors ${
                  c.required
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.required ? "Required" : "Optional"}
              </button>
            </div>
            <Labeled label="Detail — what good coverage looks like">
              <AutoTextarea className={areaCls} value={c.detail ?? ""} onChange={(e) => update(i, { detail: e.target.value })} />
            </Labeled>
          </CollapsibleCard>
        ))}
        <AddButton label="Add coverage item" onClick={add} />
      </div>
    </TrainingEditorSection>
  );
}

// ── Rubric & role framing ────────────────────────────────────────────────────

export function RubricSection({
  roleModule,
  onRoleModuleChange,
}: {
  roleModule: RoleModule;
  onRoleModuleChange: (next: RoleModule) => void;
}) {
  const rubric = roleModule.rubric;
  const update = (i: number, patch: Partial<(typeof rubric)[number]>) =>
    onRoleModuleChange({ ...roleModule, rubric: rubric.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  const add = () =>
    onRoleModuleChange({
      ...roleModule,
      rubric: [
        ...rubric,
        { id: `item-${rubric.length + 1}`, label: "", weight: 0, gate: false, pass: "", fail: "" },
      ],
    });
  const remove = (i: number) =>
    onRoleModuleChange({ ...roleModule, rubric: rubric.filter((_, idx) => idx !== i) });

  const weightSum = rubric.filter((r) => !r.gate).reduce((a, r) => a + (r.weight || 0), 0);
  const gateCount = rubric.filter((r) => r.gate).length;

  return (
    <TrainingEditorSection
      icon={ClipboardCheck}
      title="Scoring"
      description={`How the customer relates to the ${roleModule.role}, and how the trainee is graded after the phone call.`}
      stats={[
        { label: "Items", value: String(rubric.length) },
        { label: "Gates", value: String(gateCount) },
        { label: "Weight", value: weightSum.toFixed(2) },
      ]}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-background p-3">
          <Labeled label="Funnel stage">
            <input
              className={inputCls}
              value={roleModule.funnelStage}
              onChange={(e) => onRoleModuleChange({ ...roleModule, funnelStage: e.target.value })}
            />
          </Labeled>
          <Labeled label="Bot framing">
            <AutoTextarea
              className={areaCls}
              value={roleModule.botFraming}
              onChange={(e) => onRoleModuleChange({ ...roleModule, botFraming: e.target.value })}
            />
          </Labeled>
        </div>

        {rubric.map((it, i) => (
          <CollapsibleCard
            key={i}
            title={it.label || `Rubric item ${i + 1}`}
            summary={it.gate ? "Pass/fail gate" : `Weighted · ${(it.weight || 0).toFixed(2)}`}
            onRemove={() => remove(i)}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[180px] flex-1">
                <Labeled label="Label">
                  <input className={inputCls} value={it.label} onChange={(e) => update(i, { label: e.target.value })} />
                </Labeled>
              </div>
              <Labeled label="Weight">
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  disabled={it.gate}
                  className={`${inputCls} w-20 disabled:opacity-40`}
                  value={it.weight}
                  onChange={(e) => update(i, { weight: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })}
                />
              </Labeled>
              <button
                onClick={() => update(i, { gate: !it.gate, weight: !it.gate ? 0 : it.weight })}
                className={`h-[34px] rounded-md border px-3 text-xs font-medium transition-colors ${
                  it.gate
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {it.gate ? "Pass/fail gate" : "Weighted"}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Labeled label="Pass">
                <AutoTextarea className={areaCls} value={it.pass} onChange={(e) => update(i, { pass: e.target.value })} />
              </Labeled>
              <Labeled label="Fail">
                <AutoTextarea className={areaCls} value={it.fail} onChange={(e) => update(i, { fail: e.target.value })} />
              </Labeled>
            </div>
          </CollapsibleCard>
        ))}
        <AddButton label="Add rubric item" onClick={add} />
      </div>
    </TrainingEditorSection>
  );
}

// ── Personas ─────────────────────────────────────────────────────────────────

export function PersonasSection({
  role,
  personas,
  onPersonasChange,
}: {
  role: Persona["role"];
  personas: Persona[];
  onPersonasChange: (next: Persona[]) => void;
}) {
  const update = (i: number, patch: Partial<Persona>) =>
    onPersonasChange(personas.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const add = () =>
    onPersonasChange([
      ...personas,
      {
        id: `persona-${personas.length + 1}`,
        role,
        name: "",
        difficulty: "medium",
        language: personas[0]?.language ?? "Hinglish",
        characterPrompt: "",
        openingLine: "",
        arcNotes: "",
      },
    ]);
  const remove = (i: number) => onPersonasChange(personas.filter((_, idx) => idx !== i));
  const hardCount = personas.filter((p) => p.difficulty === "hard").length;

  return (
    <TrainingEditorSection
      icon={UsersRound}
      title="Customers"
      description="The personas the trainee speaks with on the phone. Each customer should pressure the trainee against the approved call plan and guardrails."
      stats={[
        { label: "Personas", value: String(personas.length) },
        { label: "Hard", value: String(hardCount) },
      ]}
    >
      <div className="flex flex-col gap-2">
        {personas.map((p, i) => (
          <CollapsibleCard
            key={i}
            title={p.name || `Persona ${i + 1}`}
            summary={`${p.difficulty} · ${p.language}${p.characterPrompt ? ` · ${p.characterPrompt.split("\n")[0]}` : ""}`}
            onRemove={() => remove(i)}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[160px] flex-1">
                <Labeled label="Name">
                  <input className={inputCls} value={p.name} onChange={(e) => update(i, { name: e.target.value })} />
                </Labeled>
              </div>
              <Labeled label="Difficulty">
                <select
                  className={`${inputCls} w-28`}
                  value={p.difficulty}
                  onChange={(e) => update(i, { difficulty: e.target.value as Difficulty })}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </Labeled>
              <Labeled label="Language">
                <select
                  className={`${inputCls} w-32`}
                  value={p.language}
                  onChange={(e) => update(i, { language: e.target.value as RoleplayLanguage })}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </Labeled>
            </div>
            <Labeled label="Character prompt">
              <AutoTextarea className={areaCls} value={p.characterPrompt} onChange={(e) => update(i, { characterPrompt: e.target.value })} />
            </Labeled>
            <Labeled label="Opening line">
              <AutoTextarea className={areaCls} value={p.openingLine} onChange={(e) => update(i, { openingLine: e.target.value })} />
            </Labeled>
            <Labeled label="Arc notes (how to bait the traps)">
              <AutoTextarea className={areaCls} value={p.arcNotes ?? ""} onChange={(e) => update(i, { arcNotes: e.target.value })} />
            </Labeled>
          </CollapsibleCard>
        ))}
        <AddButton label="Add persona" onClick={add} />
      </div>
    </TrainingEditorSection>
  );
}
